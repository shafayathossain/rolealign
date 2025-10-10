
import { send } from "../src/messaging/bus";
import { Logger } from "../src/util/logger";

const log = new Logger({ namespace: "cs:linkedin", level: "debug", persist: true });

// Track current analysis to allow cancellation
let currentAnalysis: {
  url: string;
  cancelled: boolean;
  abortController?: AbortController;
} | null = null;

// Helper function to check if URL is a LinkedIn job page
function isJobPage(url: string | any): boolean {
  if (typeof url !== 'string') {
    log.warn('isJobPage received non-string URL', { url, type: typeof url });
    return false;
  }
  return url.includes('/jobs/') && 
         (url.includes('linkedin.com/jobs/') || url.includes('linkedin.com/') && url.includes('/jobs/'));
}

// Cancel any ongoing analysis
function cancelCurrentAnalysis() {
  if (currentAnalysis && !currentAnalysis.cancelled) {
    log.info("Cancelling ongoing analysis", { url: currentAnalysis.url });
    currentAnalysis.cancelled = true;
    if (currentAnalysis.abortController) {
      currentAnalysis.abortController.abort();
    }
    
    // Remove any processing indicators
    const indicator = document.querySelector("#rolealign-indicator");
    if (indicator) indicator.remove();
  }
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
    <div style="position: relative;">
      <button id="badge-close" style="
        position: absolute;
        top: -8px;
        right: -8px;
        background: rgba(255,255,255,0.9);
        color: #666;
        border: none;
        border-radius: 50%;
        width: 20px;
        height: 20px;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        transition: all 0.2s ease;
      " onmouseover="this.style.background='rgba(255,255,255,1)'; this.style.color='#333';" 
         onmouseout="this.style.background='rgba(255,255,255,0.9)'; this.style.color='#666';">×</button>
      <div style="text-align: center; padding: 4px;">
        <div style="font-size: 18px; margin-bottom: 4px;">${score}%</div>
        <div style="font-size: 11px; opacity: 0.9;">Match Score</div>
      </div>
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

  // Add close button functionality
  const closeBtn = badge.querySelector('#badge-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent badge click
      log.info("Badge close button clicked");
      badge.remove();
    });
  }

  badge.addEventListener("click", (e) => {
    // Don't trigger if close button was clicked
    if ((e.target as Element)?.id === 'badge-close') return;
    log.info("Badge clicked - showing detailed match breakdown");
    showMatchDetails(matchDetails, score);
  });

  document.body.appendChild(badge);
  return badge;
}

/** Show detailed match breakdown popup */
function showMatchDetails(matchDetails: any, score?: number) {
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
    max-width: 700px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    margin: 20px;
  `;

  const matchedSkills = matchDetails.matchedSkills || [];
  const missingSkills = matchDetails.missingSkills || [];
  const aiReasoning = matchDetails.aiReasoning || "";
  const jobInfo = matchDetails.jobInfo || {};

  // Extract job information from the current page or passed data
  const jobTitle = jobInfo.title || document.querySelector('h1.top-card-layout__title, h1.job-details-jobs-unified-top-card__job-title, h1.jobs-unified-top-card__job-title, h1')?.textContent?.trim() || 'Job Title';
  const companyName = jobInfo.company || document.querySelector('.topcard__org-name-link, .job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name')?.textContent?.trim() || 'Company';
  const jobUrl = jobInfo.url || location.href;

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

  // Add job information section after the header
  const headerDiv = modal.querySelector('div[style*="margin-bottom: 20px"]');
  if (headerDiv) {
    const jobInfoHTML = `
      <div style="background: #f8fafc; padding: 16px; border-radius: 12px; margin-bottom: 20px; border: 1px solid #e2e8f0;">
        <h3 style="margin: 0 0 12px 0; color: #1e293b; font-size: 18px; display: flex; align-items: center;">
          <span style="margin-right: 8px;">💼</span> Job Information
        </h3>
        <div>
          <div style="margin-bottom: 8px;">
            <strong style="color: #374151; font-size: 14px;">Position:</strong>
            <span style="color: #1f2937; font-size: 14px; margin-left: 8px;">${jobTitle}</span>
          </div>
          <div style="margin-bottom: 8px;">
            <strong style="color: #374151; font-size: 14px;">Company:</strong>
            <span style="color: #1f2937; font-size: 14px; margin-left: 8px;">${companyName}</span>
          </div>
          <div style="margin-bottom: 8px;">
            <strong style="color: #374151; font-size: 14px;">LinkedIn URL:</strong>
            <a href="${jobUrl}" target="_blank" style="color: #0073b1; font-size: 13px; margin-left: 8px; text-decoration: none; word-break: break-all;" 
               onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
              ${jobUrl}
            </a>
          </div>
        </div>
      </div>
    `;
    headerDiv.insertAdjacentHTML('afterend', jobInfoHTML);
  }

  // Add Tailored CV button if score is 80% or higher
  if (score && score >= 80) {
    const tailoredCVButtonHTML = `
      <div style="margin: 20px 0;">
        <button id="tailored-cv-btn" style="
          background: linear-gradient(45deg, #4f46e5, #7c3aed);
          color: white;
          border: none;
          padding: 14px 28px;
          border-radius: 10px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          width: 100%;
          transition: all 0.3s ease;
          box-shadow: 0 4px 15px rgba(79, 70, 229, 0.3);
        " onmouseover="this.style.transform='scale(1.02)'; this.style.boxShadow='0 6px 20px rgba(79, 70, 229, 0.4)';" 
           onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 4px 15px rgba(79, 70, 229, 0.3)';">
          🎯 Generate Tailored CV
        </button>
      </div>
    `;
    
    // Insert the button after the job info section
    const lastSection = modal.querySelector('div[style*="margin-bottom: 20px"]');
    if (lastSection) {
      lastSection.insertAdjacentHTML('afterend', tailoredCVButtonHTML);
    }

    // Add click handler for the Tailored CV button
    const tailoredCVBtn = modal.querySelector('#tailored-cv-btn');
    if (tailoredCVBtn) {
      tailoredCVBtn.addEventListener('click', () => {
        log.info("Tailored CV button clicked", { score, jobInfo });
        openCVBuilder(score, jobTitle, companyName, jobUrl, matchDetails);
      });
    }
  }

  // Close popup handlers
  popup.addEventListener('click', (e) => {
    if (e.target === popup) popup.remove();
  });
  
  const closeBtn = modal.querySelector('#close-popup');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => popup.remove());
  }
}

/** Open CV Builder page with job information */
async function openCVBuilder(score: number, jobTitle: string, companyName: string, jobUrl: string, matchDetails: any) {
  try {
    // Extract job description HTML from the current page
    const jobDescriptionElement = document.querySelector('.jobs-box__html-content');
    const jobDescriptionHTML = jobDescriptionElement ? jobDescriptionElement.innerHTML : '';
    const jobDescriptionText = jobDescriptionElement ? jobDescriptionElement.textContent?.trim() : '';

    const jobData = {
      title: jobTitle,
      company: companyName,
      url: jobUrl,
      matchScore: score,
      matchDetails: {
        ...matchDetails,
        jobDescriptionHTML: jobDescriptionHTML,
        jobDescriptionText: jobDescriptionText
      }
    };

    log.info("Opening CV Builder with job description", { 
      jobData,
      htmlLength: jobDescriptionHTML.length,
      textLength: jobDescriptionText?.length || 0
    });
    
    // Use messaging to ask background script to open the CV builder page
    await send("content", "OPEN_CV_BUILDER", { jobData }, { timeoutMs: 5000 });
    
  } catch (error) {
    log.error("Failed to open CV Builder", { error });
    
    // Fallback: show simple alert
    alert("CV Builder will be available soon! Your match score is " + score + "%");
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
  // Cancel any previous analysis
  cancelCurrentAnalysis();
  
  // Set up new analysis tracking
  const abortController = new AbortController();
  currentAnalysis = {
    url,
    cancelled: false,
    abortController
  };
  
  let processingIndicator: HTMLElement | null = null;
  
  try {
    log.info("🚀 Starting job page analysis", { 
      url, 
      contextValid: ctx.isValid,
      timestamp: new Date().toISOString() 
    });
    
    // Check if cancelled early
    if (currentAnalysis.cancelled) {
      log.info("Analysis cancelled before starting");
      return;
    }
    
    // Show processing indicator immediately
    processingIndicator = createProcessingIndicator();
    log.debug("✅ Processing indicator created and displayed");
    
    // Wait for job description container to load with actual content
    log.debug("Waiting for job description to load...");
    
    // Check if cancelled
    if (currentAnalysis?.cancelled) {
      log.info("Analysis cancelled during DOM waiting");
      return;
    }
    
    // First wait for the job view container to exist
    const jobView = await waitForEl(ctx,
      ".jobs-search__job-details, .job-view-layout, .jobs-home__content, .jobs-search-results-list",
      10_000,
      250
    );
    
    // Check if cancelled after waiting
    if (currentAnalysis?.cancelled) {
      log.info("Analysis cancelled after waiting for job view");
      return;
    }
    
    if (jobView) {
      log.debug("Job view container found, waiting for description content...");
    }
    
    const descContainer = await waitForEl(ctx, 
      ".jobs-description__container, .jobs-box__html-content, .jobs-description-content__text, #job-details, .jobs-description", 
      15_000,  // Increased timeout to 15 seconds
      250,     // Poll every 250ms
      100      // Wait for at least 100 characters of content
    );
    
    // Check if cancelled after waiting for description
    if (currentAnalysis?.cancelled) {
      log.info("Analysis cancelled after waiting for description");
      return;
    }
    
    if (!descContainer) {
      log.warn("Job description container not found after waiting");
    } else {
      log.debug("Job description container found", {
        selector: descContainer.className || descContainer.id,
        contentLength: descContainer.textContent?.length
      });
      
      // Additional wait to ensure all content is fully rendered
      await sleep(ctx, 2000);
      
      // Check if cancelled after sleep
      if (currentAnalysis?.cancelled) {
        log.info("Analysis cancelled during content wait");
        return;
      }
      
      // Also wait for job title to be present
      const titleEl = await waitForEl(ctx, 
        "h1.top-card-layout__title, h1.job-details-jobs-unified-top-card__job-title, h1.jobs-unified-top-card__job-title, h1",
        5000,
        150,
        5  // At least 5 characters for title
      );
      
      // Check if cancelled after waiting for title
      if (currentAnalysis?.cancelled) {
        log.info("Analysis cancelled after waiting for title");
        return;
      }
      
      if (titleEl) {
        log.debug("Job title found", { 
          title: titleEl.textContent?.trim() 
        });
      }
    }

    log.info("Analyzing LinkedIn job page", { url });

    // Check if cancelled before starting analysis
    if (currentAnalysis?.cancelled) {
      log.info("Analysis cancelled before starting job analysis");
      return;
    }

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
      timeoutMs: 30_000,
      abortSignal: currentAnalysis.abortController?.signal
    });

    // Check if cancelled after job analysis
    if (currentAnalysis?.cancelled) {
      log.info("Analysis cancelled after job analysis");
      return;
    }

    log.info("Job analysis completed", { 
      title: result.job?.title, 
      company: result.job?.company,
      descriptionLength: result.job?.description?.length 
    });

    // Get stored CV for scoring
    const cvResult = await send("content", "GET_CV", {}, { 
      timeoutMs: 5_000,
      abortSignal: currentAnalysis.abortController?.signal
    });
    
    // Check if cancelled after CV retrieval
    if (currentAnalysis?.cancelled) {
      log.info("Analysis cancelled after CV retrieval");
      return;
    }
    
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

    // Check if cancelled before scoring
    if (currentAnalysis?.cancelled) {
      log.info("Analysis cancelled before scoring");
      return;
    }

    // Enhanced scoring with AI semantic matching
    const scoreResult = await send("content", "SCORE_MATCH_ENHANCED", {
      cv: cvResult.cv,
      job: result.job,
      chunks: chunks,
      useAI: true,
      semanticMatching: true
    }, { 
      timeoutMs: 45_000, // Longer timeout for chunked processing
      abortSignal: currentAnalysis.abortController?.signal
    });

    // Check if cancelled after scoring
    if (currentAnalysis?.cancelled) {
      log.info("Analysis cancelled after scoring");
      return;
    }

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

    // Final check before showing results
    if (currentAnalysis?.cancelled) {
      log.info("Analysis cancelled before showing results");
      return;
    }

    // Enhance match details with job information
    const enhancedMatchDetails = {
      ...scoreResult.matchDetails,
      jobInfo: {
        title: result.job?.title,
        company: result.job?.company,
        url: url
      }
    };

    // Display badge with score and enhanced match details
    createBadge(scoreResult.score, enhancedMatchDetails);
    
    // Mark analysis as completed
    if (currentAnalysis && currentAnalysis.url === url) {
      currentAnalysis = null;
    }

  } catch (e: any) {
    // Check if this was a cancelled operation
    if (currentAnalysis?.cancelled || e?.name === 'AbortError') {
      log.info("Analysis was cancelled", { url });
      if (processingIndicator) {
        processingIndicator.remove();
      }
      return;
    }
    
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
    
    // Don't show error badge if analysis was cancelled
    if (!currentAnalysis?.cancelled) {
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
  } finally {
    // Clean up analysis tracking
    if (currentAnalysis && currentAnalysis.url === url) {
      currentAnalysis = null;
    }
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

    let lastUrl = location.href;

    // Function to handle URL changes
    function handleUrlChange(newUrl: string, source: string) {
      if (newUrl === lastUrl) return;
      
      log.debug(`URL change detected (${source})`, { 
        oldUrl: lastUrl,
        newUrl, 
        currentUrl: location.href 
      });
      
      lastUrl = newUrl;
      
      if (isJobPage(newUrl)) {
        log.info(`LinkedIn job URL detected (${source})`, { newUrl });
        // Cancel any ongoing analysis and remove UI elements
        cancelCurrentAnalysis();
        const existingBadge = document.querySelector("#rolealign-badge");
        if (existingBadge) existingBadge.remove();
        const existingIndicator = document.querySelector("#rolealign-indicator");
        if (existingIndicator) existingIndicator.remove();
        
        // Start new analysis after a short delay to ensure DOM is updated
        setTimeout(() => {
          if (ctx.isValid && location.href === newUrl) {
            analyzeJobPage(ctx, newUrl);
          }
        }, 500);
      } else {
        log.debug(`Navigated to non-job page (${source})`, { newUrl });
        // Cancel analysis and remove UI when leaving job pages
        cancelCurrentAnalysis();
        const existingBadge = document.querySelector("#rolealign-badge");
        if (existingBadge) existingBadge.remove();
        const existingIndicator = document.querySelector("#rolealign-indicator");
        if (existingIndicator) existingIndicator.remove();
      }
    }

    // Initial mount (full reload / first load)
    if (isJobPage(lastUrl)) {
      log.info("LinkedIn job URL detected (initial)", { url: lastUrl });
      analyzeJobPage(ctx, lastUrl);
    } else {
      log.debug("Non-job LinkedIn page", { url: lastUrl });
    }

    // Handle SPA navigation (history API route changes)
    ctx.addEventListener(window as any, "wxt:locationchange", ({ newUrl }: any) => {
      handleUrlChange(newUrl, "wxt:locationchange");
    });

    // Additional URL change detection methods for more robust coverage
    
    // Listen for popstate events (back/forward navigation)
    ctx.addEventListener(window, "popstate", () => {
      handleUrlChange(location.href, "popstate");
    });

    // Listen for pushstate/replacestate events (programmatic navigation)
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = function(...args) {
      originalPushState.apply(history, args);
      setTimeout(() => handleUrlChange(location.href, "pushState"), 0);
    };
    
    history.replaceState = function(...args) {
      originalReplaceState.apply(history, args);
      setTimeout(() => handleUrlChange(location.href, "replaceState"), 0);
    };

    // Fallback: Poll for URL changes every 2 seconds
    const urlPollInterval = setInterval(() => {
      if (!ctx.isValid) {
        clearInterval(urlPollInterval);
        return;
      }
      handleUrlChange(location.href, "polling");
    }, 2000);

    // Listen for DOM mutations that might indicate content changes
    const observer = new MutationObserver((mutations) => {
      // Check if job content area has changed
      const hasJobContentChange = mutations.some(mutation => {
        if (mutation.type === 'childList') {
          return Array.from(mutation.addedNodes).some(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as Element;
              return el.matches?.('.jobs-description, .jobs-box__html-content, .job-details') ||
                     el.querySelector?.('.jobs-description, .jobs-box__html-content, .job-details');
            }
            return false;
          });
        }
        return false;
      });

      if (hasJobContentChange && isJobPage(location.href)) {
        log.debug("Job content change detected, refreshing analysis");
        handleUrlChange(location.href, "DOM mutation");
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Cleanup on context invalidation
    ctx.onInvalidated(() => {
      log.info("Context invalidated, cleaning up");
      cancelCurrentAnalysis();
      clearInterval(urlPollInterval);
      observer.disconnect();
      
      // Restore original history methods
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    });
  },
});
