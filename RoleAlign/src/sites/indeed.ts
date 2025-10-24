// src/sites/indeed.ts
import {
  SiteAdapter,
  ParseJobResult,
  JobNormalized,
  nowIso,
  text,
  html,
  asMarkdownFromContainer,
  extractCompensation,
  inferSkills,
  parseLocation,
  inferEmploymentType,
  inferSeniority,
  stableIdFrom,
} from "./types";

/* ───────────────────────── Helpers ───────────────────────── */

function first<T extends Element>(root: ParentNode, selectors: string[]): T | null {
  for (const sel of selectors) {
    const el = root.querySelector<T>(sel);
    if (el) return el;
  }
  return null;
}

function all<T extends Element>(root: ParentNode, selectors: string[]): T[] {
  for (const sel of selectors) {
    const els = Array.from(root.querySelectorAll<T>(sel));
    if (els.length) return els;
  }
  return [];
}

function domFromHtml(htmlStr: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(htmlStr, "text/html");
}

/** Parse Indeed relative/absolute date phrases from footer/metadata */
function parseIndeedPostedAt(s?: string): string | undefined {
  if (!s) return undefined;
  const t = s.toLowerCase();

  // Common patterns: "Just posted", "Posted 2 days ago", "30+ days ago"
  if (/just posted|today/.test(t)) return new Date().toISOString();

  const m = t.match(/posted\s+(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2];
    const d = new Date();
    const ms =
      unit === "minute" ? n * 60_000 :
      unit === "hour"   ? n * 3_600_000 :
      unit === "day"    ? n * 86_400_000 :
      unit === "week"   ? n * 7 * 86_400_000 :
      unit === "month"  ? n * 30 * 86_400_000 :
      unit === "year"   ? n * 365 * 86_400_000 :
      0;

    return new Date(d.getTime() - ms).toISOString();
  }

  if (/30\+\s*days\s+ago/.test(t)) {
    const d = new Date();
    return new Date(d.getTime() - 40 * 86_400_000).toISOString(); // conservative
  }

  return undefined;
}

function cleanTag(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/* ──────────────────────── Adapter ───────────────────────── */

export const IndeedAdapter: SiteAdapter = {
  site: "indeed",

  async parse(input): Promise<ParseJobResult> {
    try {
      const doc = input.html ? domFromHtml(input.html) : (input.root as Document) ?? document;
      const root = (input.root as ParentNode) ?? doc;

      // Indeed (US & intl) variants
      const titleSel = [
        "h1.jobsearch-JobInfoHeader-title",
        "h1.jobsearch-JobInfoHeader-title-container span",
        "h1"
      ];
      const companySel = [
        ".jobsearch-CompanyInfoWithoutHeaderImage div a",
        ".jobsearch-CompanyInfoWithoutHeaderImage div span",
        ".jobsearch-InlineCompanyRating div a",
        ".jobsearch-InlineCompanyRating div span"
      ];
      const locationSel = [
        ".jobsearch-CompanyInfoWithoutHeaderImage div ~ div",
        ".jobsearch-InlineCompanyRating div ~ div",
        "[data-testid='inlineHeader-companyLocation']"
      ];
      const descriptionSel = [
        "#jobDescriptionText",
        "[data-testid='jobsearch-JobComponent-description']",
        ".jobsearch-JobComponent-description",
        "article"
      ];
      const postedSel = [
        ".jobsearch-JobMetadataFooter",
        "[data-testid='jobsearch-JobMetadataFooter']",
        ".jobsearch-JobInfoHeader-subtitle"
      ];
      const chipSel = [
        ".jobsearch-JobDescriptionSection-sectionItem",
        ".jobsearch-JobInfoHeader-subtitle",
        "[data-testid='jobsearch-JobDescriptionSection-sectionItem']"
      ];
      const compSel = [
        "[data-testid='salary-snippet-container']",
        ".jobsearch-JobDescriptionSection-sectionItem",
        ".salary-snippet-container",
        ".jobsearch-JobMetadataHeader-item"
      ];

      const titleEl = first<HTMLElement>(root, titleSel);
      const companyEl = first<HTMLElement>(root, companySel);
      const locEl = first<HTMLElement>(root, locationSel);
      const descEl = first<HTMLElement>(root, descriptionSel) ?? root.body ?? (root as Element);
      const postedEl = first<HTMLElement>(root, postedSel);
      const chips = all<HTMLElement>(root, chipSel);
      const compBlocks = all<HTMLElement>(root, compSel);

      const title = text(titleEl);
      const company = text(companyEl);
      const locRaw = text(locEl);
      const location = parseLocation(locRaw);

      const descriptionHtml = html(descEl);
      const descriptionMarkdown = asMarkdownFromContainer(descEl);
      const descriptionText = (descEl?.textContent ?? "").replace(/\s+/g, " ").trim();

      const compRaw = [
        ...chips.map(c => c.innerText || ""),
        ...compBlocks.map(c => c.innerText || ""),
        descriptionText
      ].join(" | ");
      const compensation = extractCompensation(compRaw);

      const tags = Array.from(new Set(
        chips.map((c) => cleanTag(c.innerText || "")).filter(Boolean).slice(0, 20)
      ));

      const employmentType = inferEmploymentType([title, ...tags].join(" · "));
      const seniority = inferSeniority([title, ...tags].join(" · "));

      const postedAt = parseIndeedPostedAt([text(postedEl), ...chips.map(c => c.innerText || "")].join(" | "));
      const lastSeenAt = (input.now?.() ?? nowIso());

      const inferredSkills = await inferSkills([title, descriptionText].join("\n"));

      const url = input.url;
      const id = stableIdFrom(url, title, company);

      const job: JobNormalized = {
        id,
        url,
        site: "indeed",
        title: title || undefined,
        company: company || undefined,
        location,
        seniority,
        employmentType,
        compensation: compensation.length ? compensation : undefined,
        tags: tags.length ? tags : undefined,
        descriptionMarkdown,
        descriptionText,
        descriptionHtml,
        inferredSkills: inferredSkills.length ? inferredSkills : undefined,
        postedAt,
        lastSeenAt,
        extras: {},
      };

      return { ok: true, job };
    } catch (e: any) {
      return { ok: false, error: "Indeed parse failed", details: e?.message ?? String(e) };
    }
  },
};

export default IndeedAdapter;
