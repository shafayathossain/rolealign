
import { send } from "../src/messaging/bus";
import { Logger } from "../src/util/logger";

const log = new Logger({ namespace: "cs:indeed", level: "debug", persist: true });

// Indeed job details typically live on /viewjob
const jobsPattern = new MatchPattern([
  "https://www.indeed.com/viewjob*",
  "https://www.indeed.com/*/viewjob*",
]);

/** ctx-aware sleep so timers stop when content script invalidates */
function sleep(ctx: any, ms: number) {
  return new Promise<void>((resolve) => ctx.setTimeout(resolve, ms));
}

/** Wait for selector with ctx timers to avoid "context invalidated" issues */
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

/** Create and display match score badge */
function createBadge(score: number): HTMLElement {
  // Remove existing badge
  const existing = document.querySelector("#rolealign-badge");
  if (existing) existing.remove();

  const badge = document.createElement("div");
  badge.id = "rolealign-badge";
  badge.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #2557a7;
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    cursor: pointer;
    z-index: 10000;
    user-select: none;
    transition: all 0.3s ease;
  `;
  
  badge.innerHTML = `
    <div style="text-align: center;">
      <div style="font-size: 18px; margin-bottom: 4px;">${score}%</div>
      <div style="font-size: 11px; opacity: 0.9;">Match Score</div>
    </div>
  `;

  badge.addEventListener("mouseenter", () => {
    badge.style.transform = "scale(1.05)";
    badge.style.boxShadow = "0 6px 20px rgba(0,0,0,0.2)";
  });

  badge.addEventListener("mouseleave", () => {
    badge.style.transform = "scale(1)";
    badge.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
  });

  badge.addEventListener("click", () => {
    log.info("Badge clicked - TODO: Show detailed match breakdown");
    // TODO: Show detailed popup with matched/missing skills
  });

  document.body.appendChild(badge);
  return badge;
}

/** Analyze job page and show score */
async function analyzeJobPage(ctx: any, url: string) {
  try {
    // Wait for job content to load
    await waitForEl(ctx, "#jobDescriptionText, [data-testid='jobDescriptionText'], h1, main, section", 8_000);

    log.info("Analyzing Indeed job page", { url });

    // Send job analysis request to background
    const result = await send("content", "ANALYZE_JOB", {
      site: "indeed",
      url: url
    }, { 
      timeoutMs: 120_000 
    });

    log.info("Job analysis completed", { 
      title: result.job?.title, 
      company: result.job?.company 
    });

    // Get stored CV for scoring
    const cvResult = await send("content", "GET_CV", {}, { timeoutMs: 5_000 });
    
    if (!cvResult.cv) {
      log.warn("No CV found - user needs to upload CV first");
      return;
    }

    // Compute match score
    const scoreResult = await send("content", "SCORE_MATCH", {
      cv: cvResult.cv,
      job: result.job,
      useAI: true
    }, { 
      timeoutMs: 20_000 
    });

    log.info("Match score computed", { score: scoreResult.score });

    // Display badge with score
    createBadge(scoreResult.score);

  } catch (e: any) {
    log.error("Job analysis failed", { error: e?.message ?? String(e) });
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

  async main(ctx) {
    const url = location.href;

    // Initial load
    if (jobsPattern.includes(url)) {
      log.info("Indeed job URL detected (initial)", { url });
      analyzeJobPage(ctx, url);
    } else {
      log.debug("Non-job Indeed page", { url });
    }

    // SPA navigation
    ctx.addEventListener(window as any, "wxt:locationchange", ({ newUrl }: any) => {
      if (jobsPattern.includes(newUrl)) {
        log.info("Indeed job URL detected (SPA nav)", { newUrl });
        // Remove any existing badge when navigating to new job
        const existing = document.querySelector("#rolealign-badge");
        if (existing) existing.remove();
        // Analyze new job page
        analyzeJobPage(ctx, newUrl);
      } else {
        log.debug("Navigated to non-job page", { newUrl });
        // Remove badge when leaving job pages
        const existing = document.querySelector("#rolealign-badge");
        if (existing) existing.remove();
      }
    });
  },
});
