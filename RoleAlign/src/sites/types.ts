// src/sites/types.ts
/**
 * Shared contracts + helpers for site adapters (LinkedIn, Indeed, ...).
 *
 * Adapters should convert messy, site-specific DOM into a normalized job object
 * we can feed into summarization/scoring and UI. Keep these types stable.
 */

export type SiteId = "linkedin" | "indeed" | "other";

/** ISO 8601 date string (UTC recommended). */
export type IsoDate = string;

/** Minimal money representation; keep raw for transparency. */
export interface MoneyRange {
  currency?: string;           // "USD", "EUR", "BDT", ...
  min?: number;                // numeric, same currency
  max?: number;
  period?: "hour" | "day" | "month" | "year" | "total";
  raw?: string;                // original unparsed text
}

/** Structured location; many postings are remote/hybrid. */
export interface JobLocation {
  raw?: string;                // as seen on the page
  city?: string;
  region?: string;             // state/province
  country?: string;
  remote?: boolean;
  hybrid?: boolean;
  onsite?: boolean;
}

/** Seniority and type are often useful facets. */
export type Seniority =
  | "internship"
  | "entry"
  | "associate"
  | "mid"
  | "senior"
  | "lead"
  | "manager"
  | "director"
  | "vp"
  | "cxo"
  | "unknown";

export type EmploymentType =
  | "full-time"
  | "part-time"
  | "contract"
  | "temporary"
  | "internship"
  | "apprenticeship"
  | "volunteer"
  | "other"
  | "unknown";

/** Unified job record after parsing a site page. */
export interface JobNormalized {
  /** Stable-ish id if we can compute one (e.g., from URL). */
  id?: string;
  url: string;
  site: SiteId;

  title?: string;
  company?: string;
  location?: JobLocation;

  /** Where in the org does this sit (if extractable). */
  seniority?: Seniority;
  employmentType?: EmploymentType;

  /** Compensation if visible. Prefer normalized + keep raw. */
  compensation?: MoneyRange[];
  /** One-line chips/badges e.g., "Remote", "Visa sponsorship", etc. */
  tags?: string[];

  /** Full job body as markdown (preferred) and plaintext/raw fallback. */
  descriptionMarkdown?: string;
  descriptionText?: string;
  descriptionHtml?: string;

  /** Short list of skills/tech derived from body. */
  inferredSkills?: string[];

  /** When posted, if extractable. */
  postedAt?: IsoDate;
  /** When we parsed this. */
  lastSeenAt: IsoDate;

  /** Extra fields the adapter wants to preserve (debug, site ids, etc.) */
  extras?: Record<string, unknown>;
}

/** Result contract for adapters. */
export interface ParseJobResult {
  ok: true;
  job: JobNormalized;
} | {
  ok: false;
  error: string;
  details?: unknown;
}

/** Adapter interface each site module must implement. */
export interface SiteAdapter {
  site: SiteId;
  /**
   * Parse the current DOM (or provided HTML) into a normalized job.
   * Implementations must be resilient to missing elements and A/B variants.
   */
  parse(input: {
    url: string;
    /** If provided, parse from this HTML; otherwise read from document. */
    html?: string;
    /** Optional root element for partial parses (testing). */
    root?: ParentNode;
    /** Optional now-ISO provider (useful for tests). */
    now?: () => string;
  }): Promise<ParseJobResult>;
}

/* ───────────────────────── Utilities for adapters ───────────────────────── */

/** ISO timestamp helper (UTC). */
export function nowIso(): IsoDate {
  return new Date().toISOString();
}

/** Very defensive text getter. */
export function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Grab innerHTML safely (string or empty). */
export function html(el: Element | null | undefined): string {
  return (el as HTMLElement | null)?.innerHTML ?? "";
}

/** Plaintext → markdown-lite: preserve bullet/heading semantics roughly. */
export function asMarkdownFromContainer(root: Element): string {
  // Convert headings and list items into markdown-ish output.
  // Keep it simple and robust; avoid bringing heavy libs into content scripts.
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);

  let lastWasLi = false;
  while (walker.nextNode()) {
    const node = walker.currentNode as HTMLElement | Text;

    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t) out.push(t);
      continue;
    }

    const el = node as HTMLElement;
    const name = el.tagName.toLowerCase();

    if (["h1", "h2", "h3"].includes(name)) {
      const level = name === "h1" ? "#" : name === "h2" ? "##" : "###";
      const t = text(el);
      if (t) out.push(`${level} ${t}\n`);
      lastWasLi = false;
      continue;
    }
    if (["li"].includes(name)) {
      const t = text(el);
      if (t) out.push(`- ${t}`);
      lastWasLi = true;
      continue;
    }
    if (["p", "div", "section"].includes(name)) {
      const t = text(el);
      if (t) out.push(lastWasLi ? `  ${t}` : t);
      lastWasLi = false;
      continue;
    }
    // Ignore scripts/styles/etc by default; walker won’t show them if filtered.
  }

  // Join and squeeze blank lines
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Best-effort skill extraction (fast heuristic). */
const SKILL_DICTIONARY = [
  // Core CS / languages
  "python","java","javascript","typescript","c","c++","c#","go","rust","ruby","php","kotlin","swift","scala","sql",
  // Web/FE
  "react","next.js","nextjs","vue","nuxt","angular","svelte","rxjs","redux","tailwind","webpack","vite","rollup",
  // BE
  "node","express","spring","django","flask","fastapi",".net",".net core","laravel","rails",
  // Data/ML/AI
  "pandas","numpy","scikit-learn","tensorflow","pytorch","ml","machine learning","llm","rag","nlp","opencv",
  // Cloud/DevOps
  "aws","gcp","azure","kubernetes","docker","terraform","ansible","jenkins","gitlab ci","github actions",
  // Databases
  "postgres","mysql","mariadb","sqlite","mongodb","redis","elasticsearch","snowflake","bigquery","redshift",
  // Mobile
  "android","ios","react native","flutter",
  // Testing
  "jest","mocha","chai","pytest","playwright","cypress",
  // Other
  "graphql","grpc","rest","http","oauth","jwt","linux","bash","shell","jira","jira","confluence"
];

export function inferSkills(textBody: string): string[] {
  const body = ` ${textBody.toLowerCase()} `;
  const hits = new Set<string>();

  for (const token of SKILL_DICTIONARY) {
    // word-boundary-ish match, but allow tokens like "c++" and ".net"
    const safe = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9+.])(${safe})([^a-z0-9+. ]|$)`, "i");
    if (re.test(body)) hits.add(token);
  }

  // Simple normalization: next.js → nextjs
  const norm = Array.from(hits).map((s) => (s === "next.js" ? "nextjs" : s));
  return Array.from(new Set(norm)).sort();
}

/** Parse money ranges from free text. Very permissive and multi-locale tolerant. */
export function extractCompensation(raw: string): MoneyRange[] {
  const out: MoneyRange[] = [];
  const s = raw.replace(/\s+/g, " ");

  // Heuristics: currency symbol + number, range optional, period optional
  // Examples: "$120k–$150k/year", "€80,000 - €95,000 per year", "BDT 60,000/mo"
  const re =
    /(?:USD|EUR|GBP|BDT|INR|\$|€|£)?\s*([€$£]|USD|EUR|GBP|BDT|INR)?\s*([\d,.]+)\s*(k|K|m|M)?\s*(?:[-–—~to]{1,3}\s*(?:[€$£]|USD|EUR|GBP|BDT|INR)?\s*([\d,.]+)\s*(k|K|m|M)?)?\s*(?:\/|\sper\s)?\s*(hour|day|month|year|yr|annum|total)?/gi;

  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const [, currSym, symOnly, n1, mult1, n2, mult2, periodRaw] = [
      m[0],
      m[1], // currency (symbol or code)
      m[2], // symbol (alternative capture)
      m[3], // min
      m[4], // min multiplier
      m[5], // max
      m[6], // max multiplier
      m[7], // period
    ] as any;

    const currency = normalizeCurrency(currSym || symOnly);
    const min = parseCompNumber(n1, mult1);
    const max = n2 ? parseCompNumber(n2, mult2) : undefined;
    const period = normalizePeriod(periodRaw);

    if (!min && !max) continue;
    out.push({ currency, min: min ?? undefined, max, period, raw: m[0] });
  }

  return mergeSimilarRanges(out);
}

function normalizeCurrency(s?: string): string | undefined {
  if (!s) return undefined;
  const up = s.toUpperCase();
  if (["USD", "$"].includes(up)) return "USD";
  if (["EUR", "€"].includes(up)) return "EUR";
  if (["GBP", "£"].includes(up)) return "GBP";
  if (["BDT"].includes(up)) return "BDT";
  if (["INR"].includes(up)) return "INR";
  return up.replace(/[^A-Z]/g, "") || undefined;
}
function parseCompNumber(n?: string, mult?: string): number | null {
  if (!n) return null;
  let v = Number(n.replace(/[,]/g, ""));
  if (!isFinite(v)) return null;
  if (mult?.toLowerCase() === "k") v *= 1_000;
  if (mult?.toLowerCase() === "m") v *= 1_000_000;
  return v;
}
function normalizePeriod(p?: string): MoneyRange["period"] {
  if (!p) return undefined;
  const t = p.toLowerCase();
  if (t.startsWith("hour")) return "hour";
  if (t.startsWith("day")) return "day";
  if (t.startsWith("month")) return "month";
  if (t.startsWith("year") || t.startsWith("yr") || t.includes("annum")) return "year";
  if (t.startsWith("total")) return "total";
  return undefined;
}
/** Combine overlapping duplicates (same currency/period). */
function mergeSimilarRanges(ranges: MoneyRange[]): MoneyRange[] {
  const key = (r: MoneyRange) => `${r.currency ?? ""}|${r.period ?? ""}`;
  const map = new Map<string, MoneyRange>();
  for (const r of ranges) {
    const k = key(r);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, { ...r });
      continue;
    }
    map.set(k, {
      currency: r.currency ?? prev.currency,
      period: r.period ?? prev.period,
      min: Math.min(prev.min ?? Infinity, r.min ?? Infinity),
      max: Math.max(prev.max ?? -Infinity, r.max ?? -Infinity),
      raw: [prev.raw, r.raw].filter(Boolean).join(" | "),
    });
  }
  return Array.from(map.values()).map((r) => {
    const min = isFinite(r.min as number) ? r.min : undefined;
    const max = isFinite(r.max as number) ? r.max : undefined;
    return { ...r, min, max };
  });
}

/** Guess seniority from text chips/title lines. */
export function inferSeniority(s: string): Seniority {
  const t = ` ${s.toLowerCase()} `;
  if (/\bintern(ship)?\b/.test(t)) return "internship";
  if (/\bjunior|entry\b/.test(t)) return "entry";
  if (/\bmid(-|\s)?level\b/.test(t)) return "mid";
  if (/\bsenior|sr\.?\b/.test(t)) return "senior";
  if (/\blead\b/.test(t)) return "lead";
  if (/\bmanager|mgr\b/.test(t)) return "manager";
  if (/\bdirector\b/.test(t)) return "director";
  if (/\bvice president|vp\b/.test(t)) return "vp";
  if (/\bchief|cxo|cto|cpo|cfo|ceo\b/.test(t)) return "cxo";
  return "unknown";
}

/** Guess employment type. */
export function inferEmploymentType(s: string): EmploymentType {
  const t = s.toLowerCase();
  if (/\bfull[\s-]?time\b/.test(t)) return "full-time";
  if (/\bpart[\s-]?time\b/.test(t)) return "part-time";
  if (/\bcontract\b/.test(t)) return "contract";
  if (/\btemporary|temp\b/.test(t)) return "temporary";
  if (/\bintern(ship)?\b/.test(t)) return "internship";
  if (/\bapprentice(ship)?\b/.test(t)) return "apprenticeship";
  if (/\bvolunteer\b/.test(t)) return "volunteer";
  return "unknown";
}

/** Lightly normalize a location string. */
export function parseLocation(raw?: string): JobLocation | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  const lower = ` ${t.toLowerCase()} `;
  const loc: JobLocation = { raw: t };
  loc.remote = /\bremote\b/.test(lower);
  loc.hybrid = /\bhybrid\b/.test(lower);
  loc.onsite = /\bon[-\s]?site\b/.test(lower);
  // naive split by commas; adapters can refine per site specifics
  const parts = t.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) {
    loc.city = parts[0];
  } else if (parts.length === 2) {
    [loc.city, loc.country] = parts;
    // US style: City, ST
    if (parts[1].length <= 3) {
      loc.region = parts[1];
      loc.country = undefined;
    }
  } else if (parts.length >= 3) {
    [loc.city, loc.region] = parts;
    loc.country = parts.slice(2).join(", ");
  }
  return loc;
}

/** Utility to build a stable-ish id from URL or data. */
export function stableIdFrom(url: string, title?: string, company?: string): string {
  const base = `${url}::${title ?? ""}::${company ?? ""}`.toLowerCase();
  // Fast hash (FNV-1a-ish)
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < base.length; i++) {
    hash ^= base.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}
