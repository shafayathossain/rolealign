
import { kv } from "../src/storage/kv";
import { AI } from "../src/ai/chrome-ai";
import { Logger } from "../src/util/logger";

const log = new Logger({ namespace: "cs:indeed", level: "info", persist: false });

// Indeed job details typically live on /viewjob
const jobsPattern = new MatchPattern([
  "https://www.indeed.com/viewjob*",
  "https://www.indeed.com/*/viewjob*",
]);

/** ctx-aware sleep so timers stop when content script invalidates */
function sleep(ctx: any, ms: number) {
  return new Promise<void>((resolve) => ctx.setTimeout(resolve, ms));
}

/** Wait for selector with ctx timers to avoid “context invalidated” issues */
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

/** Extract job title/company/description from Indeed DOM */
function extractIndeedJob(): { title?: string; company?: string; body: string } | null {
  const title =
    (document.querySelector("h1")?.textContent ?? "") ||
    (document.querySelector("[data-testid='jobsearch-JobInfoHeader-title']")?.textContent ?? "") ||
    (document.querySelector("[data-testid='jobTitle']")?.textContent ?? "") ||
    undefined;

  const company =
    (document.querySelector("[data-testid='companyName']")?.textContent ?? "") ||
    (document.querySelector("[data-testid='jobsearch-CompanyInfoWithoutHeaderImage-companyName']")?.textContent ?? "") ||
    (document.querySelector("[data-company-name]")?.textContent ?? "") ||
    undefined;

  const bodyEl =
    document.querySelector("#jobDescriptionText") ||
    document.querySelector("[data-testid='jobDescriptionText']") ||
    document.querySelector("div.jobsearch-JobComponent-description") ||
    document.querySelector("section[aria-label='Job details']") ||
    document.querySelector("section[id*='jobDescription']");

  const raw = bodyEl?.textContent?.trim() ?? "";
  const body = raw.replace(/\n{3,}/g, "\n\n");

  if (!body) return null;
  return { title, company, body };
}

async function summarizeAndSave(ctx: any, url: string) {
  await waitForEl(ctx, "#jobDescriptionText, [data-testid='jobDescriptionText'], h1, main, section", 8_000);

  const job = extractIndeedJob();
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
      site: "Indeed",
      url,
      markdown: md,
    });

    log.info("Saved lastJobSummary", { len: md.length, url });
  } catch (e: any) {
    log.error("Summarize failed", { error: e?.message ?? String(e) });
  }
}

export default defineContentScript({
  matches: [
    "https://www.indeed.com/*",
    ...(import.meta.env.DEV ? ["http://localhost*"] : []),
],
includeGlobs: [
    ...(import.meta.env.DEV ? ["*://localhost:3000/mock/indeed.html"] : []),
  ],
  runAt: "document_idle",
  world: "ISOLATED",
  registration: "manifest",
  // If you inject UI/CSS later, set cssInjectionMode: "ui" and import the CSS at top.

  async main(ctx) {
    const url = location.href;

    // Initial load
    if (jobsPattern.includes(url)) {
      log.info("Indeed job URL detected (initial)", { url });
      await summarizeAndSave(ctx, url);
    } else {
      log.debug("Non-job Indeed page", { url });
    }

    // SPA navigation
    ctx.addEventListener(window as any, "wxt:locationchange", ({ newUrl }: any) => {
      if (jobsPattern.includes(newUrl)) {
        log.info("Indeed job URL detected (SPA nav)", { newUrl });
        summarizeAndSave(ctx, newUrl); // fire-and-forget; ctx controls timers
      } else {
        log.debug("Navigated to non-job page", { newUrl });
      }
    });
  },
});
