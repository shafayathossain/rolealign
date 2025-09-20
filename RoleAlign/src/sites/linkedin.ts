// src/sites/linkedin.ts
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

/** Parse LinkedIn relative dates like "3 days ago", "Just now", "1 week ago" */
function parseLinkedInRelativeDate(s?: string): string | undefined {
  if (!s) return undefined;
  const t = s.trim().toLowerCase();

  if (!t || /just now|moments? ago|today/.test(t)) return new Date().toISOString();

  // Examples: "3 days ago", "1 day ago", "2 weeks ago", "1 month ago"
  const m = t.match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/);
  if (!m) return undefined;

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

  if (!ms) return undefined;
  return new Date(d.getTime() - ms).toISOString();
}

/** Best-effort cleanup for noisy chip strings */
function cleanTag(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/* ──────────────────────── Adapter ───────────────────────── */

export const LinkedInAdapter: SiteAdapter = {
  site: "linkedin",

  async parse(input): Promise<ParseJobResult> {
    try {
      const doc = input.html ? domFromHtml(input.html) : (input.root as Document) ?? document;
      const root = (input.root as ParentNode) ?? doc;

      // Known LinkedIn variants (they change these a lot)
      const titleSel = [
        "h1.top-card-layout__title",
        "h1.job-details-jobs-unified-top-card__job-title",
        "h1.jobs-unified-top-card__job-title",
        "h1"
      ];
      const companySel = [
        "a.topcard__org-name-link",
        ".top-card-layout__entity-info .topcard__flavor a",
        "a.job-details-jobs-unified-top-card__primary-description",
        ".jobs-unified-top-card__company-name a",
        ".jobs-unified-top-card__company-name"
      ];
      const locationSel = [
        ".top-card__flavor--bullet",
        ".top-card-layout__entity-info .topcard__flavor--bullet",
        ".jobs-unified-top-card__subtitle-primary-grouping .jobs-unified-top-card__bullet",
        ".jobs-unified-top-card__workplace-type"
      ];
      const descriptionSel = [
        "#job-details", // common in older layouts
        ".jobs-description__container",
        ".jobs-box__html-content",
        ".jobs-description-content__text",
        "[data-test-description-section]",
      ];
      const postedSel = [
        ".posted-time-ago__text",
        ".jobs-unified-top-card__subtitle-primary-grouping span",
        "[data-test-posted-date]"
      ];
      const chipSel = [
        ".job-details-jobs-unified-top-card__job-insight",
        ".jobs-unified-top-card__job-insight",
        ".top-card-layout__entity-info .topcard__flavor",
      ];
      const compSel = [
        "[data-test-description-section-salary]",
        ".jobs-unified-top-card__job-insight",
        ".jobs-description__container",
        ".jobs-box__html-content"
      ];

      const titleEl = first<HTMLElement>(root, titleSel);
      const companyEl = first<HTMLElement>(root, companySel);
      const locEl = first<HTMLElement>(root, locationSel);
      const descEl = first<HTMLElement>(root, descriptionSel) ?? root.querySelector("main") ?? root.body ?? root as Element;
      const chips = all<HTMLElement>(root, chipSel);
      const compBlocks = all<HTMLElement>(root, compSel);
      const postedEl = first<HTMLElement>(root, postedSel);

      const title = text(titleEl);
      const company = text(companyEl);
      const locRaw = text(locEl);
      const location = parseLocation(locRaw);
      const descriptionHtml = html(descEl);
      const descriptionMarkdown = asMarkdownFromContainer(descEl);
      const descriptionText = (descEl?.textContent ?? "").replace(/\s+/g, " ").trim();

      // Extract compensation from any visible chip or comp block
      const compRaw = [
        ...chips.map(c => c.innerText || ""),
        ...compBlocks.map(c => c.innerText || ""),
        descriptionText
      ].join(" | ");
      const compensation = extractCompensation(compRaw);

      // Tags (remote, visa, benefits, etc.)
      const tags = Array.from(new Set(
        chips.map((c) => cleanTag(c.innerText || ""))
             .filter(Boolean)
             .slice(0, 20)
      ));

      // Infer facets
      const employmentType = inferEmploymentType([title, ...tags].join(" · "));
      const seniority = inferSeniority([title, ...tags].join(" · "));

      // Dates
      const postedAt = parseLinkedInRelativeDate(text(postedEl));
      const lastSeenAt = (input.now?.() ?? nowIso());

      // Skills
      const inferredSkills = inferSkills([title, descriptionText].join("\n"));

      const url = input.url;
      const id = stableIdFrom(url, title, company);

      const job: JobNormalized = {
        id,
        url,
        site: "linkedin",
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
      return { ok: false, error: "LinkedIn parse failed", details: e?.message ?? String(e) };
    }
  },
};

export default LinkedInAdapter;
