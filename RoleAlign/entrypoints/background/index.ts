// entrypoints/background/index.ts
import { Logger } from "../../src/util/logger";
import { listen, addHandler } from "../../src/messaging/bus";
import type {
  PingReq,
  GetVersionReq,
  ExtractCvReq,
  SaveCvReq,
  GetCvReq,
  AnalyzeJobReq,
  ScoreMatchReq,
  GenerateTailoredCvReq,
} from "../../src/messaging/types";
import { AI } from "../../src/ai/chrome-ai";
import * as KV from "../../src/storage/kv";
import { computeScore } from "../../src/match/score";

/* ─────────────────────────  Boot / lifecycle  ───────────────────────── */

const log = new Logger({ namespace: "bg", level: "info", persist: false });

export default defineBackground(() => {
  log.info("Background started");
  
  // Global guards (service worker)
  self.addEventListener?.("unhandledrejection", (ev: any) => {
    log.error("unhandledrejection", ev?.reason ?? ev);
  });
  self.addEventListener?.("error", (ev: any) => {
    log.error("global error", {
      message: ev?.message,
      filename: ev?.filename,
      lineno: ev?.lineno,
      colno: ev?.colno,
    });
  });
  
  chrome.runtime.onInstalled.addListener((details) => {
    log.info("onInstalled", { reason: details.reason });
  });
  chrome.runtime.onStartup?.addListener?.(() => log.info("onStartup"));
  
  // Start the typed bus (idempotent)
  listen();
  
  /* ─────────────────────  Message handlers (typed)  ───────────────────── */
  
  addHandler("PING", async (req: PingReq) => ({
    v: req.v,
    id: req.id,
    from: "background",
    to: req.from,
    tabId: req.tabId,
    type: "PING:RES",
    ok: true,
    result: { pong: Date.now() },
  }));
  
  addHandler("GET_VERSION", async (req: GetVersionReq) => {
    const version = chrome.runtime.getManifest().version;
    return {
      v: req.v,
      id: req.id,
      from: "background",
      to: req.from,
      tabId: req.tabId,
      type: "GET_VERSION:RES",
      ok: true,
      result: { version },
    };
  });
  
  addHandler("EXTRACT_CV", async (req: ExtractCvReq) => {
    const raw = (req.payload.raw ?? "").trim();
    if (!raw) {
      return errorRes(req, "BadRequest", "Empty CV text");
    }
    log.info("EXTRACT_CV", { length: raw.length });
    
    const cv = await AI.Prompt.extractCv(raw, {
      timeoutMs: 30_000,
      onDownloadProgress: (p) => log.debug("Prompt model download", { p }),
    });
    
    return okRes(req, { cv });
  });
  
  addHandler("SAVE_CV", async (req: SaveCvReq) => {
    await KV.set("cv", req.payload.cv);
    return okRes(req, { saved: true });
  });
  
  addHandler("GET_CV", async (req: GetCvReq) => {
    const cv = await KV.get("cv");
    return okRes(req, { cv });
  });
  
  addHandler("ANALYZE_JOB", async (req: AnalyzeJobReq) => {
    const { site, url, html } = req.payload;
    if (!html || !html.trim()) {
      return errorRes(req, "BadRequest", "Missing HTML for analysis");
    }
    
    try {
      const doc = html; // keep original
      const jsonLd = extractFirstJobPostingJsonLd(doc);
      let job = jsonLd ? normalizeFromJsonLd(jsonLd) : null;
      
      if (!job) {
        // Site-specific fallbacks
        if (site === "linkedin") job = parseLinkedInFallback(doc);
        else if (site === "indeed") job = parseIndeedFallback(doc);
      }
      
      // Final generic fallbacks if still missing critical fields
      job = ensureJobDefaults(job, url);
      
      log.info("ANALYZE_JOB ok", {
        title: job.title,
        company: job.company,
        loc: job.location,
        skillsCount: job.skills?.length ?? 0,
        descLen: job.description?.length ?? 0,
      });
      
      return okRes(req, { job });
    } catch (e: any) {
      log.error("ANALYZE_JOB failed", { msg: e?.message });
      return errorRes(req, "Internal", "Failed to analyze job page", { msg: e?.message });
    }
  });
  
  addHandler("SCORE_MATCH", async (req) => {
    const { cv, job, useAI, blendAlpha, timeoutMs } = req.payload as any;
    
    const input = toScoreInput(cv, job);
    
    const method: "deterministic" | "ai" | "blend" =
    useAI === true ? "blend" : "deterministic";
    
    const result = await computeScore(input, {
      method,
      blendAlpha: typeof blendAlpha === "number" ? blendAlpha : 0.6,
      timeoutMs: typeof timeoutMs === "number" ? timeoutMs : 15000,
      
      // sensible deterministic options:
      mustHaveHints: ["must", "required", "mandatory", "need to"],
      mustHaveWeight: 2,
      stopwords: undefined,
      strictTerms: false,
    });
    
    log.info("SCORE_MATCH", { score: result.score, method: result.method });
    
    return {
      v: req.v,
      id: req.id,
      from: "background",
      to: req.from as any,
      tabId: req.tabId,
      type: "SCORE_MATCH:RES",
      ok: true,
      result: {
        score: result.score,
        reasons: result.rationale ?? undefined,
        facets: {
          matched: result.matchedTerms,
          missing: result.missingTerms,
          deterministicScore: result.deterministicScore,
          aiScore: result.aiScore,
          method: result.method,
        },
      },
    };
  });
  
  addHandler("GENERATE_TAILORED_CV", async (req: GenerateTailoredCvReq) => {
    const { cv, job, targetFormat } = req.payload;
    
    const prompt =
    `You are a resume tailoring assistant.\n` +
    `Rewrite and reorganize the user's CV to match the job while staying 100% truthful.\n` +
    `Emphasize relevant skills/experience, de-emphasize irrelevant parts.\n` +
    `Output format: ${targetFormat ?? "plain-text"}\n\n` +
    `JOB (JSON):\n${JSON.stringify(job)}\n\n` +
    `CV (JSON):\n${JSON.stringify(cv)}\n\n` +
    `Return only the final CV text.`;
    
    const text = await AI.Prompt.text(prompt, { timeoutMs: 35_000 });
    const downloadName = "RoleAlign-CV.txt";
    
    log.info("GENERATE_TAILORED_CV ok", { chars: text.length });
    return okRes(req, { text, downloadName });
  });
});

/* ─────────────────────────  Helpers  ───────────────────────── */

type ErrCode =
| "BadRequest"
| "NotFound"
| "Timeout"
| "Internal"
| "Unavailable"
| "PermissionDenied";

function okRes<K extends string, R>(
  req: { v: number; id: string; from: string; tabId?: number; type: K },
  result: R,
) {
  return {
    v: req.v,
    id: req.id,
    from: "background" as const,
    to: req.from as any,
    tabId: req.tabId,
    type: `${req.type}:RES` as `${K}:RES`,
    ok: true as const,
    result,
  };
}

function errorRes<K extends string>(
  req: { v: number; id: string; from: string; tabId?: number; type: K },
  code: ErrCode,
  message: string,
  details?: unknown,
) {
  return {
    v: req.v,
    id: req.id,
    from: "background" as const,
    to: req.from as any,
    tabId: req.tabId,
    type: `${req.type}:RES` as `${K}:RES`,
    ok: false as const,
    error: { code, message, details },
  };
}

/* ─────────────────  Job parsing / normalization  ───────────────── */

/** Attempt to parse the first JSON-LD jobPosting block from HTML (as text). */
function extractFirstJobPostingJsonLd(html: string): any | null {
  try {
    const scriptRegex =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = scriptRegex.exec(html))) {
      const raw = match[1].trim();
      // Many sites embed arrays; others embed objects with @type jobPosting
      const obj = JSON.parse(sanitizeJsonLd(raw));
      const candidates = Array.isArray(obj) ? obj : [obj];
      for (const o of candidates) {
        if (
          o &&
          (o["@type"] === "JobPosting" ||
            (Array.isArray(o["@type"]) && o["@type"].includes("JobPosting")))
          ) {
            return o;
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }
  
  function sanitizeJsonLd(s: string) {
    // Remove HTML comments inside JSON-LD, and unescape common entities
    return s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  }
  
  function normalizeFromJsonLd(o: any) {
    const title =
    o?.title ??
    o?.name ??
    o?.positionTitle ??
    "";
    const company =
    o?.hiringOrganization?.name ??
    o?.hiringOrganization ??
    o?.organization?.name ??
    "";
    const location =
    o?.jobLocation?.address?.addressLocality ??
    o?.jobLocation?.address?.addressRegion ??
    o?.jobLocation?.address?.addressCountry ??
    o?.jobLocation?.address?.addressLocality ??
    o?.jobLocation?.address ??
    o?.applicantLocationRequirements ??
    "";
    const description = stripHtml(o?.description ?? "");
    const skills = extractSkills(description);
    
    return {
      title: asText(title),
      company: asText(company),
      location: asText(location),
      description,
      skills,
    };
  }
  
  function toScoreInput(cv: RoleAlignCV, job: RoleAlignJob) {
    const cvSkills = Array.isArray(cv?.skills) ? cv!.skills : [];
    const jobMdFromDesc = (job?.description ?? "").trim();
    const jobSkillsLine =
    Array.isArray(job?.skills) && job!.skills!.length
    ? `\n\n**Skills (parsed):** ${job!.skills!.join(", ")}`
    : "";
    const jobMarkdown = jobMdFromDesc + jobSkillsLine;
    const cvEvidence = Array.isArray(cv?.evidence) ? cv!.evidence!.slice(0, 100) : [];
    return { cvSkills, jobMarkdown, cvEvidence };
  }
  
  function parseLinkedInFallback(html: string) {
    // LinkedIn often renders JSON in "decoratedJobPosting" or similar; fallback to some simple tags.
    const title =
    getTagText(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ??
    getOgContent(html, "og:title") ??
    "";
    const company =
    getTagText(html, /<a[^>]+data-tracking-control-name=["']public_jobs_topcard-org-name["'][^>]*>([\s\S]*?)<\/a>/i) ??
    getTagText(html, /"companyName":"([^"]+)"/i) ??
    "";
    const desc =
    getTagText(html, /<div[^>]+class=["'][^"']*description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ??
    getTagText(html, /<section[^>]+class=["'][^"']*description[^"']*["'][^>]*>([\s\S]*?)<\/section>/i) ??
    "";
    const location =
    getTagText(html, /"jobLocation":"([^"]+)"/i) ??
    getTagText(html, /"formattedLocation":"([^"]+)"/i) ??
    getOgContent(html, "og:locale") ??
    "";
    const description = stripHtml(desc);
    const skills = extractSkills(description);
    
    return {
      title: asText(title),
      company: asText(company),
      location: asText(location),
      description,
      skills,
    };
  }
  
  function parseIndeedFallback(html: string) {
    const title =
    getTagText(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ??
    getOgContent(html, "og:title") ??
    "";
    const company =
    getTagText(html, /<div[^>]+data-testid=["']inlineHeader-companyName["'][^>]*>([\s\S]*?)<\/div>/i) ??
    getTagText(html, /"hiringOrganization"\s*:\s*{"name":"([^"]+)"}/i) ??
    "";
    const loc =
    getTagText(html, /data-testid=["']inlineHeader-companyLocation["'][^>]*>([\s\S]*?)<\/div>/i) ??
    getTagText(html, /"jobLocation"\s*:\s*{"address":{"addressLocality":"([^"]+)"}/i) ??
    "";
    const desc =
    getTagText(html, /<div[^>]+id=["']jobDescriptionText["'][^>]*>([\s\S]*?)<\/div>/i) ??
    "";
    const description = stripHtml(desc);
    const skills = extractSkills(description);
    
    return {
      title: asText(title),
      company: asText(company),
      location: asText(loc),
      description,
      skills,
    };
  }
  
  function ensureJobDefaults(job: any, url: string) {
    const safe = job ?? {};
    const title = asText(safe.title) || "Untitled Role";
    const company = asText(safe.company) || "";
    const location = asText(safe.location) || "";
    const description =
    (typeof safe.description === "string" ? safe.description : "") || "";
    const skills = Array.isArray(safe.skills) ? safe.skills : extractSkills(description);
    
    return { title, company, location, description, skills, url };
  }
  
  /* ───────────────  Low-level HTML utilities (no DOM needed) ─────────────── */
  
  function getTagText(html: string, regex: RegExp): string | null {
    const m = regex.exec(html);
    if (!m || !m[1]) return null;
    return stripHtml(m[1]);
  }
  
  function stripHtml(s: string): string {
    if (!s) return "";
    return s
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  }
  
  function getOgContent(html: string, property: string): string | null {
    const re = new RegExp(
      `<meta[^>]+property=["']${escapeRegExp(property)}["'][^>]+content=["']([^"']+)["']`,
      "i",
    );
    const m = re.exec(html);
    return m?.[1] ?? null;
  }
  
  function escapeRegExp(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  
  /** Very simple keyword-based extractor; you can augment with your controlled vocabulary */
  const COMMON_SKILLS = [
    "javascript",
    "typescript",
    "react",
    "node",
    "python",
    "java",
    "go",
    "c++",
    "c#",
    "sql",
    "aws",
    "gcp",
    "azure",
    "docker",
    "kubernetes",
    "graphql",
    "rest",
    "ci/cd",
    "machine learning",
    "nlp",
    "security",
    "testing",
    "jest",
    "cypress",
    "playwright",
    "html",
    "css",
    "tailwind",
    "redux",
    "next.js",
    "vite",
  ];
  
  function extractSkills(text: string): string[] {
    if (!text) return [];
    const lc = text.toLowerCase();
    const found = new Set<string>();
    for (const kw of COMMON_SKILLS) {
      if (lc.includes(kw)) found.add(kw);
    }
    // also catch patterns like "5+ years of X"
    const yearsRe = /\b(\d+)\+?\s*(?:years|yrs)\s+of\s+([a-zA-Z0-9\-\+\.#\/ ]{2,})\b/gi;
    let m: RegExpExecArray | null;
    while ((m = yearsRe.exec(text))) {
      const skill = m[2].toLowerCase().trim();
      if (skill && skill.length <= 40) found.add(skill);
    }
    return Array.from(found).slice(0, 50);
  }
  
  function asText(x: unknown): string {
    return typeof x === "string" ? x.trim() : "";
  }
  
  
  type RoleAlignCV = {
    skills?: string[];
    evidence?: string[];  // optional: bullet points, role summaries, etc.
  };
  type RoleAlignJob = {
    description?: string;
    skills?: string[];
  };