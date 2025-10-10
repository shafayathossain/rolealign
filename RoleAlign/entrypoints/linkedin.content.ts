
import { send } from "../src/messaging/bus";
import { Logger } from "../src/util/logger";

const log = new Logger({ namespace: "cs:linkedin", level: "debug", persist: true });

// Helper function to check if URL is a LinkedIn job page
function isJobPage(url: string | any): boolean {
  if (typeof url !== 'string') {
    log.warn('isJobPage received non-string URL', { url, type: typeof url });
    return false;
  }
  return url.includes('/jobs/') && 
         (url.includes('linkedin.com/jobs/') || url.includes('linkedin.com/') && url.includes('/jobs/'));
}

/** ctx-aware sleep (stops if content script invalidates) */
function sleep(ctx: any, ms: number) {
  return new Promise<void>((resolve) => {
    ctx.setTimeout(resolve, ms);
  });
}

/** Wait for DOM elements to be ready */
async function waitForEl(
  ctx: any,
  selector: string,
  timeoutMs = 12_000,
  pollMs = 150,
  minContentLength = 0
): Promise<Element | null> {
  const start = Date.now();
  while (ctx.isValid && Date.now() - start < timeoutMs) {
    const el = document.querySelector(selector);
    if (el) {
      // If minContentLength specified, wait for actual content
      if (minContentLength > 0) {
        const contentLength = el.textContent?.trim().length || 0;
        if (contentLength >= minContentLength) {
          return el;
        }
      } else {
        return el;
      }
    }
    await sleep(ctx, pollMs);
  }
  return null;
}

/** Create and display processing indicator */
function createProcessingIndicator(): HTMLElement {
  // Remove existing indicators/badges
  const existing = document.querySelector("#rolealign-indicator");
  if (existing) existing.remove();
  const existingBadge = document.querySelector("#rolealign-badge");
  if (existingBadge) existingBadge.remove();

  const indicator = document.createElement("div");
  indicator.id = "rolealign-indicator";
  indicator.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 16px 20px;
    border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    z-index: 10000;
    user-select: none;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.1);
    animation: pulse 2s infinite;
  `;
  
  indicator.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <div style="width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.3); border-top: 2px solid white; border-radius: 50%; animation: spin 1s linear infinite;"></div>
      <div>
        <div style="font-size: 14px; margin-bottom: 2px;">RoleAlign</div>
        <div style="font-size: 11px; opacity: 0.9;">Analyzing job match...</div>
      </div>
    </div>
  `;

  // Add CSS animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.8; }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(indicator);
  return indicator;
}

/** Create and display match score badge */
function createBadge(score: number, matchDetails?: any): HTMLElement {
  // Remove existing badge
  const existing = document.querySelector("#rolealign-badge");
  if (existing) existing.remove();

  const badge = document.createElement("div");
  badge.id = "rolealign-badge";
  badge.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #0073b1;
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
    log.info("Badge clicked - showing detailed match breakdown");
    showMatchDetails(matchDetails);
  });

  document.body.appendChild(badge);
  return badge;
}

/** Show detailed match breakdown popup */
function showMatchDetails(matchDetails: any) {
  if (!matchDetails) {
    log.warn("No match details available");
    return;
  }

  // Remove existing popup
  const existing = document.querySelector("#rolealign-popup");
  if (existing) existing.remove();

  const popup = document.createElement("div");
  popup.id = "rolealign-popup";
  popup.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.6);
    z-index: 20000;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
  `;

  const modal = document.createElement("div");
  modal.style.cssText = `
    background: white;
    border-radius: 16px;
    padding: 24px;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    margin: 20px;
  `;

  const matchedSkills = matchDetails.matchedSkills || [];
  const missingSkills = matchDetails.missingSkills || [];
  const aiReasoning = matchDetails.aiReasoning || "";

  modal.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <h2 style="margin: 0; color: #333; font-size: 20px;">🎯 Job Match Analysis</h2>
      <button id="close-popup" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666;">&times;</button>
    </div>
    
    <div style="margin-bottom: 20px;">
      <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; border-left: 4px solid #22c55e; margin-bottom: 16px;">
        <h3 style="margin: 0 0 8px 0; color: #16a34a; font-size: 16px;">✅ Matched Skills (${matchedSkills.length})</h3>
        <div style="display: flex; flex-wrap: wrap; gap: 6px;">
          ${matchedSkills.map((skill: any) => `
            <span style="background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500;">
              ${typeof skill === 'string' ? skill : skill.userSkill}
              ${typeof skill === 'object' && skill.jobSkill !== skill.userSkill ? ` → ${skill.jobSkill}` : ''}
            </span>
          `).join('')}
        </div>
      </div>
      
      <div style="background: #fef2f2; padding: 16px; border-radius: 8px; border-left: 4px solid #ef4444;">
        <h3 style="margin: 0 0 8px 0; color: #dc2626; font-size: 16px;">❌ Missing Skills (${missingSkills.length})</h3>
        <div style="display: flex; flex-wrap: wrap; gap: 6px;">
          ${missingSkills.map((skill: string) => `
            <span style="background: #fee2e2; color: #dc2626; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500;">
              ${skill}
            </span>
          `).join('')}
        </div>
      </div>
    </div>
    
    ${aiReasoning ? `
      <div style="background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0;">
        <h3 style="margin: 0 0 8px 0; color: #475569; font-size: 16px;">🤖 AI Analysis</h3>
        <p style="margin: 0; color: #64748b; font-size: 14px; line-height: 1.5;">${aiReasoning}</p>
      </div>
    ` : ''}
  `;

  popup.appendChild(modal);
  document.body.appendChild(popup);

  // Close popup handlers
  popup.addEventListener('click', (e) => {
    if (e.target === popup) popup.remove();
  });
  
  const closeBtn = modal.querySelector('#close-popup');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => popup.remove());
  }
}

/** Chunk large job descriptions for processing */
function chunkText(text: string, maxChunkSize: number = 2000): string[] {
  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChunkSize;
    
    // Try to break at sentence boundaries
    if (end < text.length) {
      const lastSentence = text.lastIndexOf('.', end);
      const lastNewline = text.lastIndexOf('\n', end);
      const breakPoint = Math.max(lastSentence, lastNewline);
      
      if (breakPoint > start + maxChunkSize * 0.5) {
        end = breakPoint + 1;
      }
    }
    
    chunks.push(text.slice(start, end).trim());
    start = end;
  }

  log.debug(`Chunked job description into ${chunks.length} parts`, {
    totalLength: text.length,
    chunkSizes: chunks.map(c => c.length)
  });

  return chunks;
}

/** Analyze job page and show score */
async function analyzeJobPage(ctx: any, url: string) {
  let processingIndicator: HTMLElement | null = null;
  
  try {
    log.info("🚀 Starting job page analysis", { 
      url, 
      contextValid: ctx.isValid,
      timestamp: new Date().toISOString() 
    });
    
    // Show processing indicator immediately
    processingIndicator = createProcessingIndicator();
    log.debug("✅ Processing indicator created and displayed");
    
    // Wait for job description container to load with actual content
    log.debug("Waiting for job description to load...");
    
    // First wait for the job view container to exist
    const jobView = await waitForEl(ctx,
      ".jobs-search__job-details, .job-view-layout, .jobs-home__content, .jobs-search-results-list",
      10_000,
      250
    );
    
    if (jobView) {
      log.debug("Job view container found, waiting for description content...");
    }
    
    const descContainer = await waitForEl(ctx, 
      ".jobs-description__container, .jobs-box__html-content, .jobs-description-content__text, #job-details, .jobs-description", 
      15_000,  // Increased timeout to 15 seconds
      250,     // Poll every 250ms
      100      // Wait for at least 100 characters of content
    );
    
    if (!descContainer) {
      log.warn("Job description container not found after waiting");
    } else {
      log.debug("Job description container found", {
        selector: descContainer.className || descContainer.id,
        contentLength: descContainer.textContent?.length
      });
      
      // Additional wait to ensure all content is fully rendered
      await sleep(ctx, 2000);
      
      // Also wait for job title to be present
      const titleEl = await waitForEl(ctx, 
        "h1.top-card-layout__title, h1.job-details-jobs-unified-top-card__job-title, h1.jobs-unified-top-card__job-title, h1",
        5000,
        150,
        5  // At least 5 characters for title
      );
      
      if (titleEl) {
        log.debug("Job title found", { 
          title: titleEl.textContent?.trim() 
        });
      }
    }

    log.info("Analyzing LinkedIn job page", { url });

    // Capture current page HTML
    const pageHtml = document.documentElement.outerHTML;
    log.debug("Captured page HTML", { 
      htmlLength: pageHtml.length,
      hasContent: pageHtml.length > 1000 
    });
    
    // Send job analysis request to background with HTML
    const result = await send("content", "ANALYZE_JOB", {
      site: "linkedin",
      url: url,
      html: pageHtml
    }, { 
      timeoutMs: 30_000 
    });

    log.info("Job analysis completed", { 
      title: result.job?.title, 
      company: result.job?.company,
      descriptionLength: result.job?.description?.length 
    });

    // Get stored CV for scoring
    const cvResult = await send("content", "GET_CV", {}, { timeoutMs: 5_000 });
    
    if (!cvResult.cv) {
      log.warn("No CV found - user needs to upload CV first");
      if (processingIndicator) processingIndicator.remove();
      return;
    }

    // Check if job description is large and needs chunking
    const jobDescription = result.job?.description || '';
    const chunks = chunkText(jobDescription, 2000);
    
    log.info(`Processing job description in ${chunks.length} chunk(s)`, {
      totalLength: jobDescription.length,
      needsChunking: chunks.length > 1
    });

    // Enhanced scoring with AI semantic matching
    const scoreResult = await send("content", "SCORE_MATCH_ENHANCED", {
      cv: cvResult.cv,
      job: result.job,
      chunks: chunks,
      useAI: true,
      semanticMatching: true
    }, { 
      timeoutMs: 45_000 // Longer timeout for chunked processing
    });

    log.info("Enhanced match score computed", { 
      score: scoreResult.score,
      matchedSkills: scoreResult.matchDetails?.matchedSkills?.length,
      missingSkills: scoreResult.matchDetails?.missingSkills?.length
    });

    // Remove processing indicator
    if (processingIndicator) {
      processingIndicator.remove();
      processingIndicator = null;
    }

    // Display badge with score and match details
    createBadge(scoreResult.score, scoreResult.matchDetails);

  } catch (e: any) {
    log.error("Job analysis failed", { 
      error: e?.message ?? String(e),
      errorType: e?.name,
      errorStack: e?.stack,
      errorDetails: e
    });
    
    // Remove processing indicator on error
    if (processingIndicator) {
      processingIndicator.remove();
    }
    
    // Show error badge
    const errorBadge = document.createElement("div");
    errorBadge.id = "rolealign-badge";
    errorBadge.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #ef4444;
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
    `;
    errorBadge.innerHTML = `
      <div style="text-align: center;">
        <div style="font-size: 16px; margin-bottom: 4px;">❌</div>
        <div style="font-size: 11px;">Analysis Failed</div>
      </div>
    `;
    document.body.appendChild(errorBadge);
    
    // Auto-remove error badge after 5 seconds
    setTimeout(() => {
      errorBadge.remove();
    }, 5000);
  }
}

export default defineContentScript({
  // WXT will generate manifest from this:
  matches: ["https://www.linkedin.com/*"],
  runAt: "document_idle",
  world: "ISOLATED",
  registration: "manifest",

  async main(ctx) {
    log.info("LinkedIn content script initialized", { 
      url: location.href,
      userAgent: navigator.userAgent,
      contextValid: ctx.isValid 
    });

    const url = location.href;

    // Initial mount (full reload / first load)
    if (isJobPage(url)) {
      log.info("LinkedIn job URL detected (initial)", { url });
      analyzeJobPage(ctx, url);
    } else {
      log.debug("Non-job LinkedIn page", { url });
    }

    // Handle SPA navigation (history API route changes)
    ctx.addEventListener(window as any, "wxt:locationchange", ({ newUrl }: any) => {
      log.debug("Navigation event received", { 
        newUrl, 
        type: typeof newUrl, 
        currentUrl: location.href 
      });
      
      if (isJobPage(newUrl)) {
        log.info("LinkedIn job URL detected (SPA nav)", { newUrl });
        // Remove any existing badge/indicator when navigating to new job
        const existingBadge = document.querySelector("#rolealign-badge");
        if (existingBadge) existingBadge.remove();
        const existingIndicator = document.querySelector("#rolealign-indicator");
        if (existingIndicator) existingIndicator.remove();
        // Analyze new job page
        analyzeJobPage(ctx, newUrl);
      } else {
        log.debug("Navigated to non-job page", { newUrl });
        // Remove badge/indicator when leaving job pages
        const existingBadge = document.querySelector("#rolealign-badge");
        if (existingBadge) existingBadge.remove();
        const existingIndicator = document.querySelector("#rolealign-indicator");
        if (existingIndicator) existingIndicator.remove();
      }
    });
  },
});
