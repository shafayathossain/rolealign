
import { kv } from "../src/storage/kv";
import { AI } from "../src/ai/chrome-ai";
import { Logger } from "../src/util/logger";

const log = new Logger({ namespace: "cs:linkedin", level: "info", persist: false });

// Match both detail pages and job lists' detail panes
const jobsPattern = new MatchPattern([
  "https://www.linkedin.com/*/jobs/*",
  "https://www.linkedin.com/jobs/*",
]);

/** ctx-aware sleep (stops if content script invalidates) */
function sleep(ctx: any, ms: number) {
  return new Promise<void>((resolve) => {
    ctx.setTimeout(resolve, ms);
  });
}

/** Wait for a selector using ctx timers to avoid “context invalidated” issues */
async function waitForEl(
  ctx: any,
  selector: string,
  timeoutMs = 12_000,
  pollMs = 150,
): Promise<Element | null> {
  const start = Date.now();
  while (ctx.isValid && Date.now() - start < timeoutMs) {
    const el = document.querySelector(selector);
    if (el) return el;
    await sleep(ctx, pollMs);
  }
  return null;
}

/** Extract raw job text from LinkedIn DOM (robust to minor DOM changes) */
function extractLinkedInJob(): { title?: string; company?: string; body: string } | null {
  const title =
    (document.querySelector("h1")?.textContent ?? "") ||
    (document.querySelector("[data-test-job-title]")?.textContent ?? "") ||
    (document.querySelector(".job-details-jobs-unified-top-card__job-title")?.textContent ?? "") ||
    undefined;

  const company =
    (document.querySelector("[data-test-company-name]")?.textContent ?? "") ||
    (document.querySelector("a.topcard__org-name-link")?.textContent ?? "") ||
    (document.querySelector(".job-details-jobs-unified-top-card__company-name a")?.textContent ?? "") ||
    undefined;

  // Description containers (pick first with meaningful text)
  const bodyEl =
    document.querySelector(".jobs-description__container") ||
    document.querySelector(".jobs-description-content__text") ||
    document.querySelector("[data-test-description]") ||
    document.querySelector("section.jobs-description") ||
    document.querySelector("#job-details") ||
    document.querySelector("div[class*='description']");

  const raw = bodyEl?.textContent?.trim() ?? "";
  const body = raw.replace(/\n{3,}/g, "\n\n"); // normalize excessive gaps

  if (!body) return null;
  return { title, company, body };
}

/** Summarize + persist */
async function summarizeAndSave(ctx: any, url: string) {
  // Ensure there is at least *some* DOM ready
  await waitForEl(ctx, "section, main, #job-details, .jobs-description__container", 8_000);

  const job = extractLinkedInJob();
  if (!job) {
    log.warn("No job description found");
    return;
  }

  const header = [job.title, job.company].filter(Boolean).join(" — ");
  const promptText = header ? `${header}\n\n${job.body}` : job.body;

  try {
    const md = await AI.Summarize.jobRequirements(promptText, {
      onDownloadProgress: (p) => log.debug("Summarizer download", { p }),
      type: "key-points",
      format: "markdown",
      length: "short",
      timeoutMs: 12_000,
    });

    await kv.set("lastJobSummary", {
      site: "LinkedIn",
      url,
      markdown: md,
    });

    log.info("Saved lastJobSummary", { len: md.length, url });
  } catch (e: any) {
    log.error("Summarize failed", { error: e?.message ?? String(e) });
  }
}

export default defineContentScript({
  // WXT will generate manifest from this:
  matches: ["https://www.linkedin.com/*"],
  runAt: "document_idle",
  world: "ISOLATED",
  registration: "manifest",
  // If you later add content CSS for a UI, set cssInjectionMode: "ui" and import the CSS.

  async main(ctx) {
    const url = location.href;

    // Initial mount (full reload / first load)
    if (jobsPattern.includes(url)) {
      log.info("LinkedIn job URL detected (initial)", { url });
      await summarizeAndSave(ctx, url);
    } else {
      log.debug("Non-job LinkedIn page", { url });
    }

    // Handle SPA navigation (history API route changes)
    ctx.addEventListener(window as any, "wxt:locationchange", ({ newUrl }: any) => {
      // Using the pattern is safer than string includes
      if (jobsPattern.includes(newUrl)) {
        log.info("LinkedIn job URL detected (SPA nav)", { newUrl });
        // Fire and forget; ctx keeps timers scoped
        summarizeAndSave(ctx, newUrl);
      } else {
        log.debug("Navigated to non-job page", { newUrl });
      }
    });
  },
});
