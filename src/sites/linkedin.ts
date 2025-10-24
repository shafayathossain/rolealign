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
      if (!input.html && !input.root) {
        return { ok: false, error: "LinkedIn parse failed", details: "No HTML or root element provided" };
      }
      
      const doc = input.html ? domFromHtml(input.html) : (input.root as Document) ?? document;
      const root = (input.root as ParentNode) ?? doc;
      
      console.log("[LinkedIn Adapter] Parsing with input", {
        hasHtml: !!input.html,
        htmlLength: input.html?.length,
        hasRoot: !!input.root,
        url: input.url,
        htmlPreview: input.html?.substring(0, 200) + "..."
      });

      // Known LinkedIn variants (they change these a lot)
      const titleSel = [
        "h1.top-card-layout__title",
        "h1.job-details-jobs-unified-top-card__job-title",
        "h1.jobs-unified-top-card__job-title",
        "h1.t-24.t-bold.inline",
        "[data-test-job-title]",
        ".jobs-unified-top-card h1",
        ".job-details h1",
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
        ".jobs-description",
        ".job-view-layout .jobs-description",
        "[id^='job-details-']",
        ".description__text",
        "section.core-section-container"
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
      const descEl = first<HTMLElement>(root, descriptionSel) ?? root.querySelector("main") ?? doc.querySelector("main") ?? doc.body ?? root as Element;
      const chips = all<HTMLElement>(root, chipSel);
      const compBlocks = all<HTMLElement>(root, compSel);
      const postedEl = first<HTMLElement>(root, postedSel);
      
      console.log("[LinkedIn Adapter] Found elements", {
        title: !!titleEl,
        company: !!companyEl,
        location: !!locEl,
        description: !!descEl,
        chipsCount: chips.length,
        compBlocksCount: compBlocks.length,
        posted: !!postedEl
      });

      let title: string | undefined;
      let company: string | undefined;
      let locRaw: string | undefined;
      let location: any;
      let descriptionHtml: string | undefined;
      let descriptionMarkdown: string | undefined;
      let descriptionText: string = "";
      
      try {
        title = text(titleEl);
      } catch (e) {
        console.warn("[LinkedIn Adapter] Failed to extract title", e);
        title = titleEl?.textContent?.trim();
      }
      
      try {
        company = text(companyEl);
      } catch (e) {
        console.warn("[LinkedIn Adapter] Failed to extract company", e);
        company = companyEl?.textContent?.trim();
      }
      
      try {
        locRaw = text(locEl);
        location = parseLocation(locRaw);
      } catch (e) {
        console.warn("[LinkedIn Adapter] Failed to extract location", e);
        locRaw = locEl?.textContent?.trim();
        location = { raw: locRaw };
      }
      
      try {
        descriptionHtml = html(descEl);
      } catch (e) {
        console.warn("[LinkedIn Adapter] Failed to extract HTML description", e);
        descriptionHtml = descEl?.innerHTML || "";
      }
      
      try {
        descriptionMarkdown = asMarkdownFromContainer(descEl);
      } catch (e) {
        console.warn("[LinkedIn Adapter] Failed to convert to markdown", e);
        descriptionMarkdown = descEl?.textContent?.trim() || "";
      }
      
      try {
        descriptionText = (descEl?.textContent ?? "").replace(/\s+/g, " ").trim();
      } catch (e) {
        console.warn("[LinkedIn Adapter] Failed to extract text description", e);
        descriptionText = "";
      }
      
      console.log("[LinkedIn Adapter] Extracted content", {
        titleText: title,
        companyText: company,
        titleLength: title?.length,
        companyLength: company?.length,
        descriptionLength: descriptionText?.length,
        descriptionPreview: descriptionText?.substring(0, 200) + "...",
        descElTagName: descEl?.tagName,
        descElClasses: descEl?.className
      });

      // Extract compensation from any visible chip or comp block
      let compensation: any[] = [];
      try {
        const compRaw = [
          ...chips.map(c => c.innerText || ""),
          ...compBlocks.map(c => c.innerText || ""),
          descriptionText
        ].join(" | ");
        compensation = extractCompensation(compRaw);
      } catch (e) {
        console.warn("[LinkedIn Adapter] Failed to extract compensation", e);
      }

      // Tags (remote, visa, benefits, etc.)
      let tags: string[] = [];
      try {
        tags = Array.from(new Set(
          chips.map((c) => cleanTag(c.innerText || ""))
               .filter(Boolean)
               .slice(0, 20)
        ));
      } catch (e) {
        console.warn("[LinkedIn Adapter] Failed to extract tags", e);
      }

      // Infer facets
      let employmentType: any;
      let seniority: any;
      try {
        employmentType = inferEmploymentType([title, ...tags].join(" · "));
        seniority = inferSeniority([title, ...tags].join(" · "));
      } catch (e) {
        console.warn("[LinkedIn Adapter] Failed to infer employment type/seniority", e);
      }

      // Dates
      let postedAt: string | undefined;
      let lastSeenAt: string;
      try {
        postedAt = parseLinkedInRelativeDate(text(postedEl));
        lastSeenAt = (input.now?.() ?? nowIso());
      } catch (e) {
        console.warn("[LinkedIn Adapter] Failed to parse dates", e);
        lastSeenAt = new Date().toISOString();
      }

      // Skills
      let inferredSkills: string[] = [];
      try {
        inferredSkills = await inferSkills([title || "", descriptionText || ""].filter(Boolean).join("\n"));
      } catch (e) {
        console.warn("[LinkedIn Adapter] Failed to infer skills", e);
      }

      const url = input.url || "";
      let id: string;
      try {
        id = stableIdFrom(url, title, company);
      } catch (idError) {
        console.error("[LinkedIn Adapter] Failed to generate ID", idError);
        id = `linkedin-job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      }

      // More aggressive content search if standard selectors fail
      if (!title && !company && !descriptionText) {
        console.log("[LinkedIn Adapter] WARNING: No standard content found, trying aggressive search", {
          titleText: title,
          companyText: company,
          descTextLen: descriptionText?.length,
          hasDescEl: !!descEl,
          pageBodyLen: doc.body?.textContent?.length
        });
        
        // Try more aggressive title search
        if (!title) {
          const titleSelectors = ['h1', '[data-test*="job-title"]', '.job-title', '.jobs-unified-top-card h1'];
          for (const sel of titleSelectors) {
            const el = doc.querySelector(sel);
            if (el?.textContent?.trim()) {
              title = el.textContent.trim();
              console.log(`[LinkedIn Adapter] Found title with selector "${sel}": ${title}`);
              break;
            }
          }
        }
        
        // Try more aggressive company search  
        if (!company) {
          const companySelectors = ['.jobs-unified-top-card__company-name', '.topcard__org-name-link', '[data-test*="company"]', 'a[href*="/company/"]'];
          for (const sel of companySelectors) {
            const el = doc.querySelector(sel);
            if (el?.textContent?.trim()) {
              company = el.textContent.trim();
              console.log(`[LinkedIn Adapter] Found company with selector "${sel}": ${company}`);
              break;
            }
          }
        }
        
        // Try more aggressive description search
        if (!descriptionText) {
          const descSelectors = [
            '.jobs-description__container', 
            '.jobs-box__html-content',
            '[data-test*="description"]',
            '.jobs-description',
            '.description'
          ];
          
          for (const sel of descSelectors) {
            const el = doc.querySelector(sel);
            if (el?.textContent?.trim() && el.textContent.trim().length > 100) {
              descriptionText = el.textContent.trim().replace(/\s+/g, ' ');
              console.log(`[LinkedIn Adapter] Found description with selector "${sel}": ${descriptionText.length} chars`);
              break;
            }
          }
        }
        
        // If still no content, try extracting from entire page body
        if (!descriptionText) {
          const bodyText = doc.body?.textContent || "";
          if (bodyText.length > 100) {
            // Look for job-related content in page text
            const jobKeywords = ['responsibilities', 'requirements', 'qualifications', 'experience', 'skills'];
            let bestMatch = "";
            let bestMatchLength = 0;
            
            for (const keyword of jobKeywords) {
              const index = bodyText.toLowerCase().indexOf(keyword);
              if (index > -1) {
                const excerpt = bodyText.substring(index, index + 2000);
                if (excerpt.length > bestMatchLength) {
                  bestMatch = excerpt;
                  bestMatchLength = excerpt.length;
                }
              }
            }
            
            if (bestMatch) {
              descriptionText = bestMatch.replace(/\s+/g, ' ').trim();
              console.log(`[LinkedIn Adapter] Extracted job content from page body: ${descriptionText.length} chars`);
            }
          }
        }
        
        // Final validation
        if (!descriptionText || descriptionText.length < 50) {
          console.log("[LinkedIn Adapter] Failed to extract meaningful content");
          return { ok: false, error: "LinkedIn parse failed", details: "No meaningful job content found" };
        }
      }
      
      const job: JobNormalized = {
        id,
        url,
        site: "linkedin",
        title: title || "LinkedIn Job",
        company: company || "Company",
        location: location || undefined,
        seniority: seniority || undefined,
        employmentType: employmentType || undefined,
        compensation: compensation && compensation.length ? compensation : undefined,
        tags: tags && tags.length ? tags : undefined,
        descriptionText: descriptionText || "No description available",
        descriptionMarkdown: descriptionMarkdown || undefined,
        descriptionHtml: descriptionHtml || undefined,
        inferredSkills: inferredSkills && inferredSkills.length ? inferredSkills : undefined,
        postedAt: postedAt || undefined,
        lastSeenAt,
        extras: {},
      };
      
      console.log("[LinkedIn Adapter] Successfully parsed job", {
        id: job.id,
        title: job.title,
        company: job.company,
        hasDescription: !!job.description,
        skillsCount: job.inferredSkills?.length || 0
      });

      return { ok: true, job };
    } catch (e: any) {
      console.error("[LinkedIn Adapter] Parse error caught", {
        error: e,
        message: e?.message,
        stack: e?.stack,
        name: e?.name
      });
      
      // Try to provide minimal fallback data
      try {
        const emergencyJob: JobNormalized = {
          id: stableIdFrom(input.url || "unknown", "LinkedIn Job", "Company"),
          url: input.url || "unknown",
          site: "linkedin",
          title: "LinkedIn Job (Parse Error)",
          company: "Company",
          descriptionText: "Job description could not be parsed due to an error.",
          lastSeenAt: nowIso(),
          extras: { 
            parseError: true,
            errorMessage: e?.message || String(e)
          },
        };
        
        console.log("[LinkedIn Adapter] Returning emergency fallback job data");
        return { ok: true, job: emergencyJob };
      } catch (fallbackError) {
        console.error("[LinkedIn Adapter] Even fallback failed", fallbackError);
        return { ok: false, error: "LinkedIn parse failed", details: e?.message ?? String(e) };
      }
    }
  },
};

export default LinkedInAdapter;
