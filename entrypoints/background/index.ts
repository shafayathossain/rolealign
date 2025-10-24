// entrypoints/background/index.ts
import { Logger } from "../../src/util/logger";
import { listen, addHandler } from "../../src/messaging/bus";
import type {
  PingReq,
  GetVersionReq,
  ExtractCvReq,
  ProcessCvSectionsReq,
  SaveCvReq,
  GetCvReq,
  AnalyzeJobReq,
  ScoreMatchReq,
  ScoreMatchEnhancedReq,
  GenerateTailoredCvReq,
  OpenCvBuilderReq,
  LogEventReq,
} from "../../src/messaging/types";
import { AI } from "../../src/ai/chrome-ai";
import { kv } from "../../src/storage/kv";
import { computeScore } from "../../src/match/score";
import LinkedInAdapter from "../../src/sites/linkedin";
import IndeedAdapter from "../../src/sites/indeed";
import type { JobNormalized } from "../../src/sites/types";

export default defineBackground({
  main() {
    /* ─────────────────────────  Boot / lifecycle  ───────────────────────── */
    
    const log = new Logger({ namespace: "bg", level: "debug", persist: true });
    
    log.info("Background started");
    
    // Handle extension icon click - open full interface in new tab
    chrome.action.onClicked.addListener(async (tab) => {
      try {
        log.info("Extension icon clicked, opening RoleAlign interface");
        
        // Create a new tab with the popup interface
        const newTab = await chrome.tabs.create({
          url: chrome.runtime.getURL('popup.html'),
          active: true
        });
        
        log.info("RoleAlign interface opened in new tab", { tabId: newTab.id });
      } catch (error) {
        log.error("Failed to open RoleAlign interface", error);
      }
    });
    
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
    
    // Helper functions for skill extraction and merging
    function extractSkillsFromProjects(projects: any[]): string[] {
      const skills: string[] = [];
      
      projects.forEach(project => {
        // Extract from technologies array
        if (Array.isArray(project.technologies)) {
          skills.push(...project.technologies);
        }
        
        // Extract from description text using simple keyword matching
        const description = project.description || '';
        const responsibilities = Array.isArray(project.responsibilities) 
        ? project.responsibilities.join(' ') 
        : '';
        const fullText = `${description} ${responsibilities}`.toLowerCase();
        
        // Common tech keywords to extract
        const techKeywords = [
          'react', 'vue', 'angular', 'javascript', 'typescript', 'node.js', 'nodejs', 'python', 'java', 'c++', 'c#', 'go', 'rust',
          'html', 'css', 'sass', 'scss', 'tailwind', 'bootstrap', 'material-ui', 'mui',
          'express', 'fastapi', 'django', 'flask', 'spring', 'laravel', 'rails',
          'mongodb', 'postgresql', 'mysql', 'sqlite', 'redis', 'elasticsearch',
          'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'ansible',
          'git', 'github', 'gitlab', 'jenkins', 'travis', 'circleci',
          'figma', 'sketch', 'photoshop', 'illustrator',
          'firebase', 'supabase', 'vercel', 'netlify', 'heroku',
          'graphql', 'rest', 'api', 'microservices', 'websocket'
        ];
        
        techKeywords.forEach(keyword => {
          if (fullText.includes(keyword)) {
            skills.push(keyword);
          }
        });
      });
      
      return skills;
    }
    
    function extractSkillsFromExperience(experience: any[]): string[] {
      const skills: string[] = [];
      
      experience.forEach(exp => {
        const bullets = Array.isArray(exp.bullets) ? exp.bullets.join(' ') : '';
        const responsibilities = Array.isArray(exp.responsibilities) ? exp.responsibilities.join(' ') : '';
        const fullText = `${bullets} ${responsibilities}`.toLowerCase();
        
        // Same tech keywords as projects
        const techKeywords = [
          'react', 'vue', 'angular', 'javascript', 'typescript', 'node.js', 'nodejs', 'python', 'java', 'c++', 'c#', 'go', 'rust',
          'html', 'css', 'sass', 'scss', 'tailwind', 'bootstrap', 'material-ui', 'mui',
          'express', 'fastapi', 'django', 'flask', 'spring', 'laravel', 'rails',
          'mongodb', 'postgresql', 'mysql', 'sqlite', 'redis', 'elasticsearch',
          'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'ansible',
          'git', 'github', 'gitlab', 'jenkins', 'travis', 'circleci',
          'figma', 'sketch', 'photoshop', 'illustrator',
          'firebase', 'supabase', 'vercel', 'netlify', 'heroku',
          'graphql', 'rest', 'api', 'microservices', 'websocket'
        ];
        
        techKeywords.forEach(keyword => {
          if (fullText.includes(keyword)) {
            skills.push(keyword);
          }
        });
      });
      
      return skills;
    }
    
    function deduplicateSkills(skills: any[]): string[] {
      // Convert to lowercase for comparison, but preserve original case
      const seen = new Set<string>();
      const result: string[] = [];
      
      skills.forEach(skill => {
        // Ensure skill is a string before processing
        const skillStr = typeof skill === 'string' ? skill : String(skill || '');
        if (!skillStr) return;
        
        const normalized = skillStr.toLowerCase().trim();
        if (normalized && !seen.has(normalized)) {
          seen.add(normalized);
          result.push(skillStr.trim());
        }
      });
      
      return result.sort();
    }
    
    // Normalize AI CV response to expected structure
    function normalizeCvResponse(rawCv: any): any {
      if (!rawCv) return rawCv;
      
      log.debug("Raw AI response before normalization", {
        fields: Object.keys(rawCv),
        rawCv: JSON.stringify(rawCv, null, 2).substring(0, 1000)
      });
      
      const result: any = {};
      
      // Handle personal information from multiple possible sources
      const contactInfo = rawCv.contact || rawCv.contact_details || rawCv.personal_information || rawCv;
      result.name = contactInfo?.name || rawCv.name;
      result.email = contactInfo?.email || rawCv.email;
      result.phone = contactInfo?.phone || rawCv.phone;
      
      // Handle work experience from multiple possible sources FIRST
      const workExp = rawCv.work_experience || rawCv.employment_history || rawCv.experience;
      if (workExp && Array.isArray(workExp)) {
        result.experience = workExp;
      } else if (Array.isArray(rawCv.experience)) {
        result.experience = rawCv.experience;
      } else {
        result.experience = [];
      }
      
      // Handle skills - merge from multiple sources
      const profileSkills = Array.isArray(rawCv.skills) ? rawCv.skills : [];
      const projectSkills = extractSkillsFromProjects(rawCv.projects || []);
      const experienceSkills = extractSkillsFromExperience(result.experience || []);
      
      // Merge and deduplicate all skills
      result.skills = deduplicateSkills([...profileSkills, ...projectSkills, ...experienceSkills]);
      
      // Log skill extraction details
      log.debug("Skill extraction breakdown", {
        profileSkills,
        projectSkills,
        experienceSkills,
        finalSkills: result.skills
      });
      
      // Handle education (convert single object to array if needed)
      if (Array.isArray(rawCv.education)) {
        result.education = rawCv.education;
      } else if (rawCv.education && typeof rawCv.education === 'object') {
        result.education = [rawCv.education];
      } else {
        result.education = [];
      }
      
      // Handle projects
      result.projects = rawCv.projects || [];
      
      // Copy any other fields that might be useful
      Object.keys(rawCv).forEach(key => {
        if (!['personal_information', 'employment_history', 'summary', 'contact_details', 'contact', 'work_experience'].includes(key) && 
        !result.hasOwnProperty(key)) {
          result[key] = rawCv[key];
        }
      });
      
      log.debug("CV normalization", {
        originalFields: Object.keys(rawCv),
        normalizedFields: Object.keys(result),
        experienceCount: result.experience?.length || 0,
        projectsCount: result.projects?.length || 0,
        contactExtracted: {
          name: !!result.name,
          email: !!result.email,
          phone: !!result.phone
        },
        skillExtraction: {
          profileSkillsCount: profileSkills.length,
          projectSkillsCount: projectSkills.length,
          experienceSkillsCount: experienceSkills.length,
          totalUniqueSkills: result.skills?.length || 0,
          mergedSkills: result.skills || []
        }
      });
      
      return result;
    }
    
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
        log.warn("EXTRACT_CV: Empty CV text provided");
        return errorRes(req, "BadRequest", "Empty CV text");
      }
      
      log.info("EXTRACT_CV started", { 
        textLength: raw.length,
        tabId: req.tabId,
        requestId: req.id 
      });
      
      try {
        const rawCv = await AI.Prompt.extractCv(raw, {
          timeoutMs: 120_000, // 2 minutes for CV processing
          onDownloadProgress: (p) => log.debug("Prompt model download", { p }),
        });
        
        // Normalize the AI response to expected structure
        const cv = normalizeCvResponse(rawCv);
        
        // Comprehensive logging of extracted CV data
        log.info("EXTRACT_CV completed successfully", {
          requestId: req.id,
          extractedFields: Object.keys(cv || {}),
          personalInfo: {
            hasName: !!(cv as any)?.name,
            hasEmail: !!(cv as any)?.email,
            hasPhone: !!(cv as any)?.phone,
            name: (cv as any)?.name || "not provided",
            email: (cv as any)?.email || "not provided"
          },
          skills: {
            count: (cv as any)?.skills?.length || 0,
            skills: (cv as any)?.skills || []
          },
          experience: {
            count: (cv as any)?.experience?.length || 0,
            positions: ((cv as any)?.experience || []).map((exp: any) => ({
              title: exp?.title || exp?.job_title || exp?.position || "unknown",
              company: exp?.company || "unknown",
              duration: exp?.dates || exp?.duration || 
              (exp?.start_date && exp?.end_date ? `${exp.start_date} - ${exp.end_date}` : 
                exp?.start && exp?.end ? `${exp.start} - ${exp.end}` : "? - ?"),
                responsibilities: exp?.responsibilities || exp?.bullets || []
              }))
            },
            education: {
              count: (cv as any)?.education?.length || 0,
              items: (cv as any)?.education || []
            },
            projects: {
              count: (cv as any)?.projects?.length || 0,
              items: ((cv as any)?.projects || []).map((proj: any) => ({
                name: proj?.name || proj?.title || "unknown",
                technologies: proj?.technologies || proj?.tech_stack || [],
                description: proj?.description || proj?.responsibilities || proj?.technical_responsibilities
                ? (typeof (proj?.description || proj?.responsibilities || proj?.technical_responsibilities) === 'string' 
                ? (proj?.description || proj?.responsibilities || proj?.technical_responsibilities).substring(0, 100) + "..." 
                : Array.isArray(proj?.responsibilities || proj?.technical_responsibilities)
                ? (proj?.responsibilities || proj?.technical_responsibilities).join('; ').substring(0, 100) + "..."
                : "no description")
                : "no description"
              }))
            }
          });
          
          return okRes(req, { cv });
        } catch (error: any) {
          log.error("EXTRACT_CV failed", {
            requestId: req.id,
            error: error?.message,
            stack: error?.stack,
            textLength: raw.length
          });
          throw error;
        }
      });
      
      addHandler("PROCESS_CV_SECTIONS", async (req: ProcessCvSectionsReq) => {
        const { sections } = req.payload;
        
        log.info("PROCESS_CV_SECTIONS started", {
          requestId: req.id,
          sectionsProvided: Object.keys(sections).filter(k => sections[k as keyof typeof sections]?.trim())
        });
        
        try {
          // Check AI availability first
          const promptAvailable = await AI.Availability.prompt();
          log.debug("Prompt API availability for CV processing", { availability: promptAvailable });
          
          if (promptAvailable === "no" || promptAvailable === "api-missing") {
            throw new Error(`Prompt API not available: ${promptAvailable}. Enable chrome://flags/#prompt-api-for-gemini-nano and restart Chrome.`);
          }
          const processedSections: any = {};
          const extractedSkills: string[] = [];
          
          // Process each section separately (skip summary as it will be AI-generated)
          for (const [sectionName, text] of Object.entries(sections)) {
            if (!text?.trim()) {
              log.debug(`Skipping empty section: ${sectionName}`);
              continue;
            }
            
            // Skip professional summary - will be generated by AI later
            if (sectionName === 'summary') {
              log.debug("Skipping summary section - will be AI-generated");
              continue;
            }
            
            log.debug(`Processing section: ${sectionName}`, { length: text.length });
            
            try {
              // Use Prompt API to extract structured data instead of just summarizing
              let structuredData;
              
              if (sectionName === 'experience') {
                const extractPrompt = `Extract work experience details from this text into a structured format. Preserve ALL specific details including company names, job titles, exact dates, and specific responsibilities. Format as JSON:
                
{
  "positions": [
    {
      "company": "exact company name",
      "title": "exact job title", 
      "period": "exact dates/period",
      "responsibilities": ["specific responsibility 1", "specific responsibility 2"]
    }
  ]
}
                
Text: ${text}`;
                
                structuredData = await AI.Prompt.text(extractPrompt, { timeoutMs: 60000 });
              } else if (sectionName === 'projects') {
                const extractPrompt = `Extract project details from this text into a structured format. Preserve ALL specific details including project names, technologies, and achievements. Format as JSON:
                
{
  "projects": [
    {
      "name": "exact project name",
      "technologies": ["tech1", "tech2"],
      "responsibilities": ["specific achievement 1", "specific achievement 2"]
    }
  ]
}
                
Text: ${text}`;
                
                structuredData = await AI.Prompt.text(extractPrompt, { timeoutMs: 60000 });
              } else if (sectionName === 'education') {
                const extractPrompt = `Extract education details from this text into a structured format. Preserve ALL specific details including institution names, degrees, and dates. Format as JSON:
                
{
  "education": [
    {
      "degree": "exact degree name",
      "institution": "exact institution name",
      "location": "location if mentioned",
      "period": "exact dates/period"
    }
  ]
}
                
Text: ${text}`;
                
                structuredData = await AI.Prompt.text(extractPrompt, { timeoutMs: 60000 });
              } else {
                // For other sections, use summarization to clean up while preserving key info
                structuredData = await AI.Summarize.text(text, {
                  type: "key-points",
                  format: "markdown", 
                  length: "medium",
                  timeoutMs: 60000
                });
              }
              
              processedSections[sectionName] = {
                original: text,
                structured: structuredData,
                processed: true
              };
              
              // Extract skills from each section using prompt API
              try {
                const skillsPrompt = `Extract technical skills, technologies, tools, and programming languages from this text. Return only a comma-separated list of skills, no explanations:\n\n${text}`;
                const skillsText = await AI.Prompt.text(skillsPrompt, { timeoutMs: 60000 });
                const sectionSkills = skillsText
                .split(',')
                .map(skill => skill.trim())
                .filter(skill => skill && skill.length > 1 && skill.length < 50);
                
                extractedSkills.push(...sectionSkills);
                
                log.debug(`Skills extracted from ${sectionName}`, { 
                  count: sectionSkills.length,
                  skills: sectionSkills
                });
                
              } catch (skillError: any) {
                log.warn(`Failed to extract skills from ${sectionName}`, { error: skillError?.message });
              }
              
              log.debug(`Section ${sectionName} processed successfully`, {
                originalLength: text.length,
                structuredDataLength: typeof structuredData === 'string' ? structuredData.length : JSON.stringify(structuredData).length
              });
              
            } catch (sectionError: any) {
              log.warn(`Failed to process section ${sectionName}`, {
                error: sectionError?.message,
                fallbackToOriginal: true
              });
              
              // Fallback to original text if processing fails
              processedSections[sectionName] = {
                original: text,
                structured: text,
                processed: false,
                error: sectionError?.message
              };
            }
          }
          
          // Deduplicate and clean skills
          const uniqueSkills = deduplicateSkills(extractedSkills);
          
          // Extract email from personal info for storage
          let email = null;
          try {
            const personalInfoText = sections.personalInfo || '';
            const emailMatch = personalInfoText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            email = emailMatch ? emailMatch[1] : null;
            log.info("Email extracted from personal info", { email, found: !!email });
          } catch (e) {
            log.warn("Failed to extract email from personal info", e);
          }
          
          // Build structured CV from processed sections
          const cv = {
            // Include email for storage association
            email: email,
            
            // Personal info (keep as-is, just cleaned up)
            personalInfo: processedSections.personalInfo?.structured || sections.personalInfo,
            
            // Experience structured data (JSON or text)
            experience: processedSections.experience?.structured || sections.experience,
            
            // Education structured data (JSON or text)
            education: processedSections.education?.structured || sections.education,
            
            // Projects structured data (JSON or text)
            projects: processedSections.projects?.structured || sections.projects,
            
            // Combined and deduplicated skills from all sections + original skills field
            skills: uniqueSkills,
            
            // Include processing metadata
            processingDetails: {
              sectionsProcessed: Object.keys(processedSections),
              totalSections: Object.keys(sections).filter(k => sections[k as keyof typeof sections]?.trim()).length,
              skillsExtracted: extractedSkills.length,
              uniqueSkillsCount: uniqueSkills.length,
              processingMethod: "structured-extraction-and-skill-extraction",
              summarySkipped: true,
              email: email
            }
          };
          
          // Automatically save the processed CV
          try {
            if (email) {
              const emailKey = `cv:${email}`;
              await kv.set(emailKey, cv);
              await kv.set("cv", cv); // Also save as default
              log.info("CV automatically saved with email association", { 
                email, 
                emailKey, 
                skillsCount: cv.skills.length,
                sectionsCount: Object.keys(processedSections).length
              });
            } else {
              await kv.set("cv", cv);
              log.info("CV automatically saved as default (no email found)", { 
                skillsCount: cv.skills.length,
                sectionsCount: Object.keys(processedSections).length
              });
            }
          } catch (saveError) {
            log.error("Failed to automatically save processed CV", saveError);
            // Continue anyway, return the CV data to popup
          }
          
          log.info("PROCESS_CV_SECTIONS completed successfully", {
            requestId: req.id,
            sectionsProcessed: Object.keys(processedSections).length,
            totalSkillsExtracted: extractedSkills.length,
            uniqueSkills: uniqueSkills.length,
            processingResults: Object.entries(processedSections).map(([name, data]: [string, any]) => ({
              section: name,
              processed: data.processed,
              originalLength: data.original?.length || 0,
              structuredDataLength: typeof data.structured === 'string' ? data.structured.length : JSON.stringify(data.structured || {}).length
            }))
          });
          
          return okRes(req, { cv });
          
        } catch (error: any) {
          log.error("PROCESS_CV_SECTIONS failed", {
            requestId: req.id,
            error: error?.message,
            stack: error?.stack
          });
          throw error;
        }
      });
      
      addHandler("SAVE_CV", async (req: SaveCvReq) => {
        const cv = req.payload.cv;
        const email = cv?.email;
        
        if (!email) {
          log.warn("SAVE_CV: No email found in CV, saving as default");
          await kv.set("cv", cv);
          return okRes(req, { saved: true, key: "cv" });
        }
        
        // Save both by email and as default (most recent)
        const emailKey = `cv:${email}`;
        await kv.set(emailKey, cv);
        await kv.set("cv", cv); // Also save as default
        
        log.info("SAVE_CV: CV saved", { 
          email, 
          emailKey, 
          hasName: !!cv?.name,
          skillsCount: cv?.skills?.length || 0 
        });
        
        return okRes(req, { saved: true, key: emailKey });
      });
      
      addHandler("GET_CV", async (req: GetCvReq) => {
        const email = req.payload?.email;
        
        if (email) {
          const emailKey = `cv:${email}`;
          const cv = await kv.get(emailKey, null);
          log.info("GET_CV: Retrieved CV by email", { email, emailKey, found: !!cv });
          return okRes(req, { cv, source: emailKey });
        }
        
        // Default - get most recent CV
        const cv = await kv.get("cv", null);
        log.info("GET_CV: Retrieved default CV", { found: !!cv });
        return okRes(req, { cv, source: "cv" });
      });
      
      addHandler("ANALYZE_JOB", async (req: AnalyzeJobReq) => {
        const { site, url } = req.payload;
        let { html } = req.payload;
        
        try {
          // 0) Validate site
          if (site !== "linkedin" && site !== "indeed") {
            return errorRes(req, "BadRequest", `Unsupported site: ${site}`);
          }
          
          // 1) Capture HTML if not provided
          if (!html?.trim() && req.tabId) {
            try {
              log.debug("Capturing HTML from tab", { tabId: req.tabId });
              const results = await chrome.scripting.executeScript({
                target: { tabId: req.tabId },
                func: () => document.documentElement.outerHTML,
              });
              html = results?.[0]?.result || "";
            } catch (e: any) {
              log.warn("Failed to capture HTML from tab", { tabId: req.tabId, error: e?.message });
            }
          }
          if (!html?.trim()) {
            return errorRes(req, "BadRequest", "No HTML available for analysis");
          }
          
          // 2) Check Prompt API availability for skill extraction
          let promptAvailable: string | undefined;
          try {
            promptAvailable = await AI.Availability.prompt();
            log.info("AI availability", { promptAvailable });
          } catch (availError: any) {
            log.error("AI availability check failed", { error: availError?.message, stack: availError?.stack });
            return errorRes(req, "Unavailable", `AI availability check failed: ${availError?.message}`);
          }
          
          const promptReady = promptAvailable && promptAvailable !== "no" && promptAvailable !== "api-missing";
          
          if (!promptReady) {
            log.error("Chrome AI not ready; aborting job analysis", { promptAvailable });
            return errorRes(
              req,
              "Unavailable",
              "Chrome AI is not available. Enable the built-in AI flags and restart Chrome.",
              {
                promptAvailable,
                instructions: [
                  "chrome://flags/#prompt-api-for-gemini-nano → Enabled",
                ],
              }
            );
          }
          
          // 3) Extract job description text from HTML
          let jobDescriptionHTML = "";
          
          // Custom function to extract content from expandable-text-box with proper span matching
          function extractExpandableTextBox(html: string): string | null {
            const regex = /<span[^>]*data-testid="expandable-text-box"[^>]*>/gi;
            let match;
            
            while ((match = regex.exec(html)) !== null) {
              const startPos = match.index + match[0].length;
              let depth = 1;
              let pos = startPos;
              
              // Count nested spans to find the correct closing span
              while (pos < html.length && depth > 0) {
                const openSpan = html.indexOf('<span', pos);
                const closeSpan = html.indexOf('</span>', pos);
                
                if (closeSpan === -1) break;
                
                if (openSpan !== -1 && openSpan < closeSpan) {
                  depth++;
                  pos = openSpan + 5;
                } else {
                  depth--;
                  if (depth === 0) {
                    const content = html.substring(startPos, closeSpan).trim();
                    if (content.length > 100) {
                      log.info("Custom expandable-text-box extraction successful", {
                        contentLength: content.length,
                        preview: content.substring(0, 200) + "..."
                      });
                      return content;
                    }
                  }
                  pos = closeSpan + 7;
                }
              }
            }
            
            return null;
          }
          
          // Try custom extraction first
          const customExtraction = extractExpandableTextBox(html);
          if (customExtraction) {
            jobDescriptionHTML = customExtraction;
            log.info("Using custom expandable-text-box extraction", {
              htmlLength: jobDescriptionHTML.length,
              preview: jobDescriptionHTML.substring(0, 180) + "..."
            });
          } else {
            // Fallback to regex patterns
            const jobDescPatterns = [
            // PRIORITY: Article container pattern (works best with current LinkedIn structure)
            /<article[^>]*class="[^"]*jobs-description__container[^"]*"[^>]*>([\s\S]*?)<\/article>/i,
            
            // Most specific div patterns - handle nested div structures properly
            // NEW: Target the exact structure with id="job-details" and jobs-box__html-content class
            /<div[^>]*id="job-details"[^>]*class="[^"]*jobs-box__html-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<div[^>]*class="[^"]*jobs-box__html-content[^"]*"[^>]*id="job-details"[^>]*>([\s\S]*?)<\/div>/i,
            /<div[^>]*(?:class="[^"]*jobs-box__html-content[^"]*"|id="job-details")[^>]*>([\s\S]*?)<\/div>/i,
            /<div[^>]*class="[^"]*jobs-description-content__text[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<div[^>]*class="[^"]*jobs-description__container[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<section[^>]*class="[^"]*jobs-description[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
            
            // ID-based patterns (more reliable)
            /<div[^>]*id="job-details"[^>]*>([\s\S]*?)<\/div>/i,
            
            // PRIORITY: New LinkedIn obfuscated structure - find expandable text box that contains substantial content
            // Look for the entire content inside expandable-text-box using balanced matching
            /<span[^>]*data-testid="expandable-text-box"[^>]*>([\s\S]*?)<\/span>\s*<\/p>/i,
            
            // New LinkedIn structure - look for "About the job" h2 and capture the following expandable text box content
            /<h2[^>]*>[^<]*About the job[^<]*<\/h2>[\s\S]*?<span[^>]*data-testid="expandable-text-box"[^>]*>([\s\S]*?)<\/span>/i,
            
            // Handle obfuscated class names and expandable text boxes (newer LinkedIn) - but be more specific
            /<p[^>]*class="[^"]*"[^>]*>\s*<span[^>]*data-testid="expandable-text-box"[^>]*>([\s\S]*?)<\/span>\s*<\/p>/i,
            
            // Broader expandable text box pattern (fallback)
            /<span[^>]*data-testid="expandable-text-box"[^>]*>([\s\S]*?)<\/span>/i,
            
            // Content-based patterns - look for "About the job" heading and capture following content
            /<h2[^>]*>[^<]*About the job[^<]*<\/h2>([\s\S]*?)(?=<\/div>|<\/article>|<div[^>]*class="jobs-description__details|$)/i,
            /<div[^>]*>[^<]*About the job[^<]*<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>/i,
            
            // Fallback: broader "About the job" capture
            /About the job([\s\S]*?)(?=<\/div>|<div[^>]*class=|<\/article>|<\/span>|$)/i,
          ];
          
          for (const [idx, pattern] of jobDescPatterns.entries()) {
            const m = html.match(pattern);
            if (m && m[1]) {
              const trimmedContent = m[1].trim();
              log.info("Pattern matched", {
                patternIndex: idx + 1,
                matchedLength: trimmedContent.length,
                matchedPreview: trimmedContent.substring(0, 200) + "...",
                patternDescription: [
                  "jobs-box__html-content or job-details div",
                  "jobs-description-content__text div", 
                  "jobs-description__container article",
                  "jobs-description__container div",
                  "jobs-description section",
                  "job-details id div",
                  "PRIORITY: obfuscated expandable-text-box span",
                  "About the job h2 + expandable-text-box span",
                  "paragraph + expandable-text-box span",
                  "expandable-text-box span (fallback)",
                  "About the job h2 + content",
                  "About the job div + content",
                  "About the job fallback"
                ][idx]
              });
              
              if (trimmedContent.length > 50) {
                jobDescriptionHTML = m[1];
                log.info("Selected job description block", {
                  patternIndex: idx + 1,
                  htmlLength: jobDescriptionHTML.length,
                  totalPageLength: html.length,
                  extractionRatio: Math.round((jobDescriptionHTML.length / html.length) * 100),
                  preview: jobDescriptionHTML.substring(0, 180) + "...",
                });
              
                // Warn if we're extracting too much (likely capturing whole page)
                if (jobDescriptionHTML.length > html.length * 0.5) {
                  log.warn("Job description extraction seems too large - may be capturing whole page", {
                    extractedLength: jobDescriptionHTML.length,
                    totalLength: html.length,
                    ratio: Math.round((jobDescriptionHTML.length / html.length) * 100) + "%"
                  });
                }
                break;
              }
            }
          }
          }
          if (!jobDescriptionHTML) {
            return errorRes(req, "BadRequest", "Could not locate a job description section in the page HTML");
          }
          
          // If we captured too much content, try a more conservative approach
          if (jobDescriptionHTML.length > html.length * 0.6) {
            log.warn("Extracted content is too large, trying conservative extraction");
            
            // Try to find just the text content after "About the job"
            const aboutJobMatch = html.match(/About the job.*?<\/h\d+>.*?<div[^>]*>([\s\S]*?)<\/div>/i);
            if (aboutJobMatch && aboutJobMatch[1] && aboutJobMatch[1].trim().length > 50 && aboutJobMatch[1].length < jobDescriptionHTML.length) {
              jobDescriptionHTML = aboutJobMatch[1];
              log.info("Used conservative extraction", {
                newLength: jobDescriptionHTML.length,
                reduction: Math.round(((html.length - jobDescriptionHTML.length) / html.length) * 100) + "%"
              });
            }
          }
          
          // 4) Clean to plain text for AI
          const cleanedJobText = jobDescriptionHTML
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "") // Remove scripts
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")   // Remove styles
          .replace(/<\/?(div|section|article|header|footer|nav|aside)[^>]*>/gi, "\n") // Convert block elements to newlines
          .replace(/<\/?(p|br)[^>]*>/gi, "\n")              // Convert paragraphs and breaks to newlines
          .replace(/<\/?(h[1-6])[^>]*>/gi, "\n")            // Convert headings to newlines
          .replace(/<[^>]+>/g, " ")                          // Remove remaining HTML tags
          .replace(/\n\s*\n/g, "\n")                        // Collapse multiple newlines
          .replace(/\s+/g, " ")                             // Collapse multiple spaces
          .replace(/\n\s*/g, "\n")                          // Clean up line starts
          .trim();
          
          if (cleanedJobText.length < 100) {
            return errorRes(req, "BadRequest", `Job description too short (${cleanedJobText.length} chars)`);
          }
          
          log.info("Job description text extracted and cleaned", {
            originalHtmlLength: jobDescriptionHTML.length,
            cleanedTextLength: cleanedJobText.length,
            compressionRatio: Math.round((cleanedJobText.length / jobDescriptionHTML.length) * 100),
            preview: cleanedJobText.substring(0, 200) + "...",
            textStartsWith: cleanedJobText.substring(0, 50)
          });
          
          // 5) Parallel processing: skills extraction + metadata extraction
          const extractSkillsTask = async (): Promise<string[]> => {
            // Check if job description is too large and needs chunking
            const MAX_SINGLE_PROMPT_SIZE = 8000; // Conservative limit for single AI call
            
            if (cleanedJobText.length <= MAX_SINGLE_PROMPT_SIZE) {
              // Single AI call for normal-sized job descriptions
              const skillsPrompt = `You are a deterministic extractor of key domain-specific terms from job descriptions.
              
INPUT TEXT:
<<<
              ${cleanedJobText}
>>>
              
GOAL
Extract ONLY the explicit hard skills, tools, techniques, technologies, processes, standards, certifications, methods, or materials mentioned in the text.
              
RULES
- Include a term only if it appears exactly as written in the text.
- Preserve full multi-word phrases (e.g., "root cause analysis", "Google Cloud Platform", "BLS certification").
- Keep punctuation and symbols (e.g., "C++", "ISO/IEC 27001", "FAA Part 107").
- Exclude generic roles, soft skills, responsibilities, degrees, years, locations, and companies.
- Exclude inferred or related terms not explicitly mentioned.
              
OUTPUT REQUIREMENTS
- Return a valid JSON array of strings only.
- Each element is one unique skill keyword.
- Remove duplicates, trim whitespace, and sort alphabetically.
- No markdown, no explanation, no extra text.
              
Example output:
["AutoCAD", "BLS certification", "C++", "Lean Manufacturing", "Python", "Root Cause Analysis"]`;
              
              try {
                const skillsResult = await AI.Prompt.json<string[]>(skillsPrompt, {
                  timeoutMs: 60_000,
                  schema: {
                    type: "array",
                    items: { type: "string" }
                  }
                });
                
                if (Array.isArray(skillsResult)) {
                  return skillsResult
                  .filter(skill => typeof skill === 'string' && skill.trim().length > 0)
                  .map(skill => skill.trim())
                  .filter((skill, index, arr) => arr.indexOf(skill) === index) // Remove duplicates
                  .sort();
                }
              } catch (skillError: any) {
                log.warn("AI skill extraction failed, using regex fallback", { error: skillError?.message });
                return extractSkillsWithRegex(cleanedJobText);
              }
            } else {
              // Parallel chunked processing for very large job descriptions
              log.info("Large job description detected, using parallel chunked processing", {
                textLength: cleanedJobText.length,
                maxSingleSize: MAX_SINGLE_PROMPT_SIZE
              });
              
              const CHUNK_SIZE = 3000;
              const OVERLAP = 200;
              const chunks: string[] = [];
              
              for (let i = 0; i < cleanedJobText.length; i += CHUNK_SIZE - OVERLAP) {
                const end = Math.min(i + CHUNK_SIZE, cleanedJobText.length);
                const chunk = cleanedJobText.slice(i, end);
                if (chunk.trim().length > 100) { // Only include substantial chunks
                  chunks.push(chunk);
                }
              }
              
              log.info(`Processing ${chunks.length} chunks in parallel`);
              
              // Process all chunks in parallel
              const chunkPromises = chunks.map(async (chunk, index) => {
                const chunkPrompt = `You are a deterministic extractor of key domain-specific terms from job descriptions.
                
INPUT TEXT:
<<<
                ${chunk}
>>>
                
GOAL
Extract ONLY the explicit hard skills, tools, techniques, technologies, processes, standards, certifications, methods, or materials mentioned in the text.
                
RULES
- Include a term only if it appears exactly as written in the text.
- Preserve full multi-word phrases (e.g., "root cause analysis", "Google Cloud Platform", "BLS certification").
- Keep punctuation and symbols (e.g., "C++", "ISO/IEC 27001", "FAA Part 107").
- Exclude generic roles, soft skills, responsibilities, degrees, years, locations, and companies.
- Exclude inferred or related terms not explicitly mentioned.
                
OUTPUT REQUIREMENTS
- Return a valid JSON array of strings only.
- Each element is one unique skill keyword.
- Remove duplicates, trim whitespace, and sort alphabetically.
- No markdown, no explanation, no extra text.
                
Example output:
["AutoCAD", "BLS certification", "C++", "Lean Manufacturing", "Python", "Root Cause Analysis"]`;
                
                try {
                  const chunkResult = await AI.Prompt.json<string[]>(chunkPrompt, {
                    timeoutMs: 60_000,
                    schema: {
                      type: "array",
                      items: { type: "string" }
                    }
                  });
                  
                  if (Array.isArray(chunkResult)) {
                    const skills = chunkResult
                    .filter(skill => typeof skill === 'string' && skill.trim().length > 0)
                    .map(skill => skill.trim());
                    
                    log.debug(`Chunk ${index + 1}/${chunks.length} processed`, {
                      skillsFound: skills.length
                    });
                    
                    return skills;
                  }
                  return [];
                } catch (chunkError: any) {
                  log.warn(`Chunk ${index + 1} failed, using regex fallback`, { error: chunkError?.message });
                  return extractSkillsWithRegex(chunk);
                }
              });
              
              // Wait for all chunks to complete
              const chunkResults = await Promise.all(chunkPromises);
              
              // Merge and deduplicate all skills from chunks
              const allSkills = chunkResults.flat();
              const uniqueSkills = [...new Set(allSkills)].sort();
              
              log.info("Parallel chunked skill extraction completed", {
                chunksProcessed: chunks.length,
                totalSkillsFound: allSkills.length,
                uniqueSkills: uniqueSkills.length
              });
              
              return uniqueSkills;
            }
            
            return [];
          };
          
          // 6) Extract basic job metadata (title, company) from HTML patterns
          const extractMetadataTask = async (): Promise<{ jobTitle: string; companyName: string }> => {
            let jobTitle = "Job Title";
            let companyName = "Company";
            
            // Try to extract title from common LinkedIn/Indeed patterns
            const titlePatterns = [
              /<h1[^>]*class="[^"]*job[^"]*title[^"]*"[^>]*>([^<]+)</i,
              /<h1[^>]*class="[^"]*top-card[^"]*title[^"]*"[^>]*>([^<]+)</i,
              /<h1[^>]*>([^<]+)</i,
            ];
            
            for (const pattern of titlePatterns) {
              const match = html.match(pattern);
              if (match && match[1]?.trim()) {
                jobTitle = match[1].trim();
                break;
              }
            }
            
            // Try to extract company from common patterns
            const companyPatterns = [
              /<a[^>]*class="[^"]*topcard__org-name[^"]*"[^>]*>([^<]+)</i,
              /<a[^>]*class="[^"]*company[^"]*name[^"]*"[^>]*>([^<]+)</i,
              /<span[^>]*class="[^"]*company[^"]*"[^>]*>([^<]+)</i,
            ];
            
            for (const pattern of companyPatterns) {
              const match = html.match(pattern);
              if (match && match[1]?.trim()) {
                companyName = match[1].trim();
                break;
              }
            }
            
            return { jobTitle, companyName };
          };
          
          // Execute both tasks in parallel
          const [extractedSkills, metadata] = await Promise.all([
            extractSkillsTask(),
            extractMetadataTask()
          ]);
          
          const { jobTitle, companyName } = metadata;
          
          log.info("Skills and metadata extraction completed", {
            skillsCount: extractedSkills.length,
            skills: extractedSkills,
            jobTitle,
            companyName
          });
          
          // 7) Build result focused on skills
          const job = {
            id: `skills-job-${Date.now()}`,
            url,
            site,
            title: jobTitle,
            company: companyName,
            description: cleanedJobText,
            descriptionText: cleanedJobText,
            descriptionMarkdown: cleanedJobText,
            inferredSkills: extractedSkills,
            lastSeenAt: new Date().toISOString(),
            extras: {
              skillsExtracted: true,
              originalTextLength: cleanedJobText.length,
              skillsCount: extractedSkills.length,
            },
          };
          
          log.info("Job analysis completed", {
            title: job.title,
            company: job.company,
            skillsExtracted: extractedSkills.length,
            textLength: cleanedJobText.length
          });
          
          return okRes(req, { job });
        } catch (e: any) {
          log.error("ANALYZE_JOB failed", { msg: e?.message, stack: e?.stack });
          return errorRes(req, "Internal", "Failed to analyze job page", { msg: e?.message });
        }
      });
      
      
      addHandler("SCORE_MATCH", async (req) => {
        const { cv, job, useAI, blendAlpha, timeoutMs } = req.payload as any;
        
        const input = toScoreInput(cv, job);
        
        let method: "deterministic" | "ai" | "blend" = "deterministic";
        
        // Check AI availability if AI scoring is requested
        if (useAI === true) {
          try {
            const promptAvailable = await AI.Availability.prompt();
            log.debug("Prompt API availability for scoring", { availability: promptAvailable });
            
            if (promptAvailable === "available" || promptAvailable === "downloadable") {
              method = "blend";
            } else {
              log.warn("Prompt API not available for scoring, falling back to deterministic", { 
                availability: promptAvailable 
              });
              method = "deterministic";
            }
          } catch (availError: any) {
            log.warn("Failed to check AI availability for scoring, using deterministic", {
              error: availError?.message
            });
            method = "deterministic";
          }
        }
        
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
      
      // Helper function for regex-based skill extraction (removed hardcoded skills)
      function extractSkillsWithRegex(text: string): string[] {
        // This function is now a fallback that extracts general patterns
        // but relies on AI for actual skill identification
        const skills: string[] = [];
        
        // Extract words that could be technologies (no hardcoded skill lists)
        const technicalPatterns = [
          // Capitalized technical terms (common pattern for technologies)
          /\b[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*\b/g,
          // Common tech suffixes
          /\b\w+(?:\.js|\.ts|\.py|\.java|\.swift|\.kt)\b/gi,
          // Version numbers (often indicate technologies)
          /\b\w+\s+\d+(?:\.\d+)*\b/gi
        ];
        
        technicalPatterns.forEach(pattern => {
          const matches = text.match(pattern);
          if (matches) {
            skills.push(...matches.map(match => match.trim()));
          }
        });
        
        // Clean and deduplicate
        return [...new Set(skills
          .map(skill => skill.trim())
          .filter(skill => skill && skill.length > 1 && skill.length < 30)
        )];
      }
      
      addHandler("SCORE_MATCH_ENHANCED", async (req: ScoreMatchEnhancedReq) => {
        const { cv, job, useAI, semanticMatching } = req.payload;
        
        log.info("SCORE_MATCH_ENHANCED started", {
          useAI,
          semanticMatching,
          cvSkillsCount: Array.isArray(cv?.skills) ? cv.skills.length : 0,
          jobSkillsCount: Array.isArray((job as any)?.inferredSkills) ? (job as any).inferredSkills.length : 0
        });
        
        try {
          // ── 0) Require Prompt API (AI-only scoring) ────────────────────────────
          const promptAvailable = await AI.Availability.prompt().catch((e: any) => {
            log.error("Prompt availability check failed", { error: e?.message });
            return "no";
          });
          if (promptAvailable === "no" || promptAvailable === "api-missing") {
            return errorRes(req, "Unavailable", "Prompt API is not available. Enable chrome://flags/#prompt-api-for-gemini-nano and restart Chrome.", { promptAvailable });
          }
          
          if (useAI === false) {
            return errorRes(req, "Unavailable", "AI matching was disabled by caller (useAI=false). Enable AI to compute score.");
          }
          
          // ── 1) Inputs ──────────────────────────────────────────────────────────
          const cvSkills: string[] = Array.isArray(cv?.skills) ? cv.skills : [];
          const jobSkillsRaw: string[] = Array.isArray((job as any)?.inferredSkills) ? (job as any).inferredSkills : [];
          
          if (cvSkills.length === 0) {
            return errorRes(req, "BadRequest", "No candidate skills found in CV for scoring.");
          }
          if (jobSkillsRaw.length === 0) {
            return errorRes(req, "BadRequest", "No job skills available (job.inferredSkills is empty). Run ANALYZE_JOB first.");
          }
          
          // De-dupe while preserving originals
          const cvLowerToOrig = new Map<string, string>();
          for (const s of cvSkills) {
            const k = (s ?? "").trim().toLowerCase();
            if (k) cvLowerToOrig.set(k, s.trim());
          }
          const jobLowerToOrig = new Map<string, string>();
          for (const s of jobSkillsRaw) {
            const k = (s ?? "").trim().toLowerCase();
            if (k) jobLowerToOrig.set(k, s.trim());
          }
          
          const cvListLower = Array.from(cvLowerToOrig.keys());
          const jobListLower = Array.from(jobLowerToOrig.keys());
          
          log.info("Scoring with normalized lists", {
            cvUnique: cvListLower.length,
            jobUnique: jobListLower.length
          });
          
          // ── 2) Enhanced matching with fallback strategies ────────────────────
          
          // Enhanced normalization function
          function normalizeSkill(skill: string): string {
            return skill.toLowerCase()
            .trim()
            .replace(/[\/\-_\s]+/g, ' ')  // Normalize separators to spaces
            .replace(/\s+/g, ' ')         // Collapse multiple spaces
            .replace(/[()]/g, '')         // Remove parentheses
            .trim();
          }
          
          // Create enhanced normalization maps
          const cvNormalizedToOrig = new Map<string, string>();
          const jobNormalizedToOrig = new Map<string, string>();
          
          for (const s of cvSkills) {
            const normalized = normalizeSkill(s);
            if (normalized) cvNormalizedToOrig.set(normalized, s.trim());
          }
          for (const s of jobSkillsRaw) {
            const normalized = normalizeSkill(s);
            if (normalized) jobNormalizedToOrig.set(normalized, s.trim());
          }
          
          const cvNormalizedList = Array.from(cvNormalizedToOrig.keys());
          const jobNormalizedList = Array.from(jobNormalizedToOrig.keys());
          
          // Deterministic exact matching first
          function findExactMatches(): Array<{userSkill: string; jobSkill: string; confidence: number; semantic: boolean}> {
            const exactMatches: Array<{userSkill: string; jobSkill: string; confidence: number; semantic: boolean}> = [];
            const matchedJobSkills = new Set<string>();
            
            for (const jobNormalized of jobNormalizedList) {
              if (matchedJobSkills.has(jobNormalized)) continue;
              
              // Try exact normalized match
              if (cvNormalizedToOrig.has(jobNormalized)) {
                exactMatches.push({
                  userSkill: cvNormalizedToOrig.get(jobNormalized)!,
                  jobSkill: jobNormalizedToOrig.get(jobNormalized)!,
                  confidence: 1.0,
                  semantic: false
                });
                matchedJobSkills.add(jobNormalized);
                continue;
              }
              
              // Enhanced substring/containment matches with semantic understanding
              const jobWords = jobNormalized.split(' ').filter(w => w.length > 2);
              
              for (const cvNormalized of cvNormalizedList) {
                const cvWords = cvNormalized.split(' ').filter(w => w.length > 2);
                
                // Check if job skill is contained in CV skill (e.g., "kotlin" in "kotlin and java")
                if (cvNormalized.includes(jobNormalized)) {
                  exactMatches.push({
                    userSkill: cvNormalizedToOrig.get(cvNormalized)!,
                    jobSkill: jobNormalizedToOrig.get(jobNormalized)!,
                    confidence: 0.95,
                    semantic: false
                  });
                  matchedJobSkills.add(jobNormalized);
                  break;
                }
                
                // Check if CV skill is contained in job skill (e.g., "android" in "android development")
                if (jobNormalized.includes(cvNormalized)) {
                  exactMatches.push({
                    userSkill: cvNormalizedToOrig.get(cvNormalized)!,
                    jobSkill: jobNormalizedToOrig.get(jobNormalized)!,
                    confidence: 0.95,
                    semantic: false
                  });
                  matchedJobSkills.add(jobNormalized);
                  break;
                }
                
                // Enhanced word overlap with root word matching
                if (jobWords.length > 0 && cvWords.length > 0) {
                  const sharedWords = jobWords.filter(w => cvWords.includes(w));
                  const overlapRatio = sharedWords.length / Math.min(jobWords.length, cvWords.length);
                  
                  // High overlap threshold for exact matches
                  if (overlapRatio >= 0.8 && sharedWords.length >= 2) {
                    exactMatches.push({
                      userSkill: cvNormalizedToOrig.get(cvNormalized)!,
                      jobSkill: jobNormalizedToOrig.get(jobNormalized)!,
                      confidence: 0.9,
                      semantic: true
                    });
                    matchedJobSkills.add(jobNormalized);
                    break;
                  }
                  
                  // Lower threshold for significant word matches (captures domain relationships)
                  if (overlapRatio >= 0.5 && sharedWords.length >= 1) {
                    // Check if shared words indicate strong domain relationship
                    const hasSignificantSharedWord = sharedWords.some(word => 
                      word.length >= 4 && // Meaningful length
                      !['with', 'using', 'for', 'and', 'the', 'development', 'programming'].includes(word) // Not generic
                    );
                    
                    if (hasSignificantSharedWord) {
                      exactMatches.push({
                        userSkill: cvNormalizedToOrig.get(cvNormalized)!,
                        jobSkill: jobNormalizedToOrig.get(jobNormalized)!,
                        confidence: 0.85,
                        semantic: true
                      });
                      matchedJobSkills.add(jobNormalized);
                      break;
                    }
                  }
                }
                
                // Root word/stem matching for different variations
                const checkRootMatch = (word1: string, word2: string): boolean => {
                  if (word1.length < 4 || word2.length < 4) return false;
                  
                  // Simple stem matching - first 4-6 characters
                  const stem1 = word1.substring(0, Math.min(6, word1.length - 1));
                  const stem2 = word2.substring(0, Math.min(6, word2.length - 1));
                  
                  return stem1 === stem2 && stem1.length >= 4;
                };
                
                // Check for root word matches between job and CV skills
                for (const jobWord of jobWords) {
                  for (const cvWord of cvWords) {
                    if (checkRootMatch(jobWord, cvWord)) {
                      exactMatches.push({
                        userSkill: cvNormalizedToOrig.get(cvNormalized)!,
                        jobSkill: jobNormalizedToOrig.get(jobNormalized)!,
                        confidence: 0.88,
                        semantic: true
                      });
                      matchedJobSkills.add(jobNormalized);
                      break;
                    }
                  }
                  if (matchedJobSkills.has(jobNormalized)) break;
                }
                
                if (matchedJobSkills.has(jobNormalized)) break;
              }
            }
            
            return exactMatches;
          }
          
          function buildPrompt(cvNormalized: string[], jobNormalized: string[], alreadyMatched: Set<string>) {
            const remainingJobSkills = jobNormalized.filter(j => !alreadyMatched.has(j));
            
            if (remainingJobSkills.length === 0) {
              return null; // No remaining skills to match
            }
            
            return `
You are an expert technical recruiter with deep multi-domain knowledge.  
Your task is to match candidate skills to job requirements by understanding *practical*, *ecosystem*, and *implicit* relationships between technologies, frameworks, tools, and methodologies.

CORE PRINCIPLE:
If an experienced professional who uses the candidate’s listed skills would *naturally* already know or use the job skill in day-to-day work, treat it as MATCHED — even if it is not explicitly listed.

────────────────────────────
SEMANTIC RELATIONSHIP CATEGORIES
────────────────────────────

1. **Direct Equivalence**
   - Same or variant naming: plural/singular, abbreviation, alternate notation
   - Subset ↔ superset relationships where one clearly includes the other
   - Example: "coroutines" ↔ "Coroutine", "Google Play Service" ↔ "Google Play Services"

2. **Ecosystem Relationship**
   - A platform, framework, or language implies knowledge of its SDKs, tools, and libraries
   - Example: "Android" covers "AndroidX", "Room", "DataStore", "UI frameworks", "OkHttp", "Retrofit", "Hilt"
   - "Flutter" covers "Dart", "Firebase", "Widgets", "UI frameworks", "Third-party SDKs"

3. **Functional Equivalence / Practical Coverage**
   - When one skill inherently requires or subsumes another in real practice
   - Example: "Networking" ↔ "Retrofit", "OkHttp", "HTTP clients", "API Integration"
   - "Testing" ↔ "JUnit", "Espresso", "Mockito"
   - "Dependency Injection" ↔ "Hilt", "Dagger"
   - "Database / Persistence" ↔ "Room", "SQLite", "Core-Data"

4. **Domain Competency Inference**
   - Domain mastery implies knowledge of standard tools and patterns
   - Example: "Android Development" → understands its SDKs, UI frameworks, testing, networking
   - "Mobile App Development" → covers Android/iOS related SDKs, APIs, testing, deployment

────────────────────────────
MATCHING STRATEGY
────────────────────────────
- For every job skill, look for any candidate skill that would make that job skill *redundant to list* for an experienced developer.
- If the job skill is a more specific instance of a broader candidate skill, consider it covered.
- If multiple candidate skills together imply the job skill (e.g., “Retrofit” + “API Integration” → “Networking”), count it as matched.
- Prefer *practical overlap* over lexical similarity.

────────────────────────────
CONFIDENCE SCALE
────────────────────────────
- **1.00 – 0.95** → Exact or naming variant
- **0.94 – 0.87** → Strong ecosystem / functional overlap (tools commonly used together)
- **0.86 – 0.80** → Practical or implicit coverage through related experience

────────────────────────────
CRITICAL BEHAVIOR
────────────────────────────
✅ If a candidate has a general skill (e.g., "Networking"), all its concrete implementations (e.g., "OkHttp", "Retrofit") are considered MATCHED.  
✅ If a candidate has an implementation (e.g., "Retrofit"), the general concept ("Networking") is also considered MATCHED.  
✅ If a candidate has a framework, assume core SDKs, testing, and DI tools for that framework are covered (e.g., Android ↔ AndroidX, Hilt, Room, DataStore).  
✅ Avoid double-counting. One broad skill can satisfy multiple related job skills.

❌ Do NOT match skills from unrelated ecosystems (e.g., AWS ↔ GCP, React ↔ Flutter)  
❌ Do NOT match abstract soft skills (“team leadership”)  
❌ Do NOT invent technologies not in the lists

────────────────────────────
OUTPUT REQUIREMENTS
────────────────────────────
Return **valid JSON only** (no markdown, prose, or comments):

{
  "matches": [
    {"userSkill":"<exact string from candidate list>",
     "jobSkill":"<exact string from job list>",
     "matchType":"semantic",
     "confidence":0.8-1.0}
  ]
}

────────────────────────────
CANDIDATE SKILLS (lowercase):
${cvNormalized.join(", ")}

REMAINING JOB SKILLS (lowercase):
${remainingJobSkills.join(", ")}
`.trim();
          }
          
          const schema = {
            type: "object",
            properties: {
              matches: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    userSkill: { type: "string" },
                    jobSkill:  { type: "string" },
                    matchType: { type: "string", enum: ["exact", "semantic"] },
                    confidence:{ type: "number", minimum: 0.7, maximum: 1.0 }
                  },
                  required: ["userSkill", "jobSkill", "matchType", "confidence"]
                }
              }
            },
            required: ["matches"]
          } as const;
          
          // Step 1: Find exact/deterministic matches
          const exactMatches = findExactMatches();
          const matchedJobNormalized = new Set(exactMatches.map(m => normalizeSkill(m.jobSkill)));
          
          log.info("Exact matching results", {
            exactMatches: exactMatches.length,
            remainingJobSkills: jobNormalizedList.length - matchedJobNormalized.size
          });
          
          let allMatches = [...exactMatches];
          
          // Step 2: AI semantic matching for remaining skills
          const aiPrompt = buildPrompt(cvNormalizedList, jobNormalizedList, matchedJobNormalized);
          
          if (aiPrompt) {
            try {
              const ai = await AI.Prompt.json<{ matches: Array<{userSkill: string; jobSkill: string; matchType: "semantic"; confidence: number}> }>(
                aiPrompt,
                { schema, timeoutMs: 120_000 }
              );
              
              if (ai && Array.isArray(ai.matches)) {
                const seenPairs = new Set<string>();
                
                for (const m of ai.matches) {
                  if (!m || typeof m.userSkill !== "string" || typeof m.jobSkill !== "string") continue;
                  
                  const userNormalized = normalizeSkill(m.userSkill);
                  const jobNormalized = normalizeSkill(m.jobSkill);
                  
                  // Validate that skills exist in our normalized maps
                  if (!cvNormalizedToOrig.has(userNormalized) || !jobNormalizedToOrig.has(jobNormalized)) {
                    log.warn("AI suggested non-existent skill", { userSkill: m.userSkill, jobSkill: m.jobSkill });
                    continue;
                  }
                  
                  // Check if already matched by exact matching
                  if (matchedJobNormalized.has(jobNormalized)) continue;
                  
                  if (typeof m.confidence !== "number" || m.confidence < 0.7 || m.confidence > 1.0) continue;
                  
                  const key = `${userNormalized}→${jobNormalized}`;
                  if (seenPairs.has(key)) continue;
                  seenPairs.add(key);
                  
                  allMatches.push({
                    userSkill: cvNormalizedToOrig.get(userNormalized)!,
                    jobSkill: jobNormalizedToOrig.get(jobNormalized)!,
                    confidence: Math.max(0.7, Math.min(1, m.confidence)),
                    semantic: true
                  });
                }
              }
            } catch (e: any) {
              log.warn("AI semantic matching failed", { error: e?.message });
              // Continue with just exact matches
            }
          }
          
          // Compute missing from job list
          const matchedJobSet = new Set(allMatches.map(m => normalizeSkill(m.jobSkill)));
          const missingSkills = Array.from(jobNormalizedToOrig.values()).filter(js => !matchedJobSet.has(normalizeSkill(js)));
          
          // ── 4) Score (confidence-weighted over unique job skills) ──────────────
          const totalJobSkills = jobNormalizedList.length;
          const matchedCount = allMatches.length;
          const confidenceWeight = allMatches.reduce((sum, m) => sum + m.confidence, 0);
          const rawScore = totalJobSkills > 0 ? (confidenceWeight / totalJobSkills) : 0;
          const enhancedScore = Math.min(Math.round(rawScore * 100), 100);
          
          const exactMatchCount = allMatches.filter(m => !m.semantic).length;
          const semanticMatchCount = allMatches.filter(m => m.semantic).length;
          
          const reasons = [
            `Matched ${matchedCount}/${totalJobSkills} required skills (${enhancedScore}%)`,
            `Enhanced matching: ${exactMatchCount} exact + ${semanticMatchCount} semantic matches`,
            `Hybrid approach: deterministic normalization + AI semantic matching`
          ];
          
          if (exactMatchCount > 0) {
            reasons.push(`${exactMatchCount} exact matches through improved normalization`);
          }
          if (semanticMatchCount > 0) {
            reasons.push(`${semanticMatchCount} semantic matches through AI analysis`);
          }
          
          const result = {
            score: enhancedScore,
            reasons,
            facets: {
              totalJobSkills,
              matchedCount,
              missingCount: missingSkills.length,
              confidenceWeight,
              exactMatches: exactMatchCount,
              semanticMatches: semanticMatchCount,
              preExtractedSkills: jobSkillsRaw.length,
              enhancedNormalization: true
            },
            matchDetails: {
              matchedSkills: allMatches,
              missingSkills,
              aiReasoning: `Hybrid matching: deterministic exact matching with enhanced normalization, followed by AI semantic matching for remaining skills.`
            }
          };
          
          log.info("SCORE_MATCH_ENHANCED completed", {
            score: enhancedScore,
            matched: matchedCount,
            exactMatches: exactMatchCount,
            semanticMatches: semanticMatchCount,
            missing: missingSkills.length,
            avgConfidence: matchedCount ? (confidenceWeight / matchedCount).toFixed(2) : 0
          });
          
          AI.releasePromptSession();
          return okRes(req, result);
          
        } catch (error: any) {
          log.error("SCORE_MATCH_ENHANCED failed", { error: error?.message, stack: error?.stack });
          AI.releasePromptSession();
          throw error;
        }
      });
      
      
      addHandler("GENERATE_TAILORED_CV", async (req: GenerateTailoredCvReq) => {
        const { cv, job, targetFormat } = req.payload;
        
        try {
          // Check AI availability first
          const promptAvailable = await AI.Availability.prompt();
          log.debug("Prompt API availability for tailored CV generation", { availability: promptAvailable });
          
          if (promptAvailable === "no" || promptAvailable === "api-missing") {
            throw new Error(`Prompt API not available: ${promptAvailable}. Enable chrome://flags/#prompt-api-for-gemini-nano and restart Chrome.`);
          }
          
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
        } catch (e: any) {
          log.error("GENERATE_TAILORED_CV failed", { msg: e?.message, stack: e?.stack });
          return errorRes(req, "Internal", "Failed to generate tailored CV", { msg: e?.message });
        }
      });
      
      addHandler("OPEN_CV_BUILDER", async (req: OpenCvBuilderReq) => {
        const { jobData } = req.payload;
        
        try {
          // Generate unique session ID for this CV builder session
          const sessionId = `cv-builder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          
          // Store job data in chrome storage with session ID
          await chrome.storage.local.set({
            [sessionId]: {
              jobData,
              timestamp: Date.now(),
              expires: Date.now() + (5 * 60 * 1000) // Expire after 5 minutes
            }
          });
          
          log.info("Stored job data in chrome storage", { 
            sessionId, 
            dataSize: JSON.stringify(jobData).length 
          });
          
          // Create CV builder URL with just the session ID
          const cvBuilderUrl = chrome.runtime.getURL(`cv-builder.html?session=${sessionId}`);
          
          log.info("Opening CV Builder in new tab", { url: cvBuilderUrl, sessionId });
          
          // Create new tab with the CV builder page
          await chrome.tabs.create({
            url: cvBuilderUrl,
            active: true
          });
          
          return okRes(req, { opened: true });
        } catch (error) {
          log.error("Failed to open CV Builder", { error });
          throw error;
        }
      });
      
      addHandler("LOG_EVENT", async (req: LogEventReq) => {
        const { level, msg, extra } = req.payload;
        log[level]?.(msg, extra);
        return okRes(req, { recorded: true });
      });
      
      // Add global message listener for CV builder AI API calls only
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type?.startsWith('AI_')) {
          handleAIMessage(message, sender, sendResponse);
          return true; // Keep the message channel open for async response
        }
      });
      
      async function handleAIMessage(message: any, sender: any, sendResponse: any) {
        try {
          let result;
          
          switch (message.type) {
            case 'AI_PROMPT_TEXT':
            // Add timeout for AI calls
            result = await Promise.race([
              AI.Prompt.text(message.prompt, { ...message.options, timeoutMs: 15000 }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('AI call timeout')), 20000))
            ]);
            sendResponse({ result });
            break;
            
            case 'AI_SUMMARIZE_TEXT':
            // Add timeout for AI calls
            result = await Promise.race([
              AI.Summarize.text(message.text, { ...message.options, timeoutMs: 15000 }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('AI call timeout')), 20000))
            ]);
            sendResponse({ result });
            break;
            
            case 'AI_AVAILABILITY_PROMPT':
            result = await AI.Availability.prompt();
            sendResponse({ result });
            break;
            
            case 'AI_AVAILABILITY_SUMMARIZER':
            result = await AI.Availability.summarizer();
            sendResponse({ result });
            break;
            
            default:
            sendResponse({ error: `Unknown AI API type: ${message.type}` });
            break;
          }
        } catch (error: any) {
          log.error(`AI API call failed: ${message.type}`, { error: error?.message });
          sendResponse({ error: error?.message || 'AI API call failed' });
        }
      }
      
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
      
      /* ─────────────────  Scoring helpers  ───────────────── */
      
      function toScoreInput(cv: any, job: JobNormalized) {
        const cvSkills = Array.isArray(cv?.skills) ? cv.skills : [];
        
        // Use the structured job data from site adapters
        const jobMdFromDesc = job.descriptionMarkdown || job.descriptionText || "";
        const jobSkillsLine = 
        Array.isArray(job.inferredSkills) && job.inferredSkills.length
        ? `\n\n**Skills (parsed):** ${job.inferredSkills.join(", ")}`
        : "";
        const jobMarkdown = jobMdFromDesc.trim() + jobSkillsLine;
        
        const cvEvidence = Array.isArray(cv?.evidence) ? cv.evidence.slice(0, 100) : [];
        return { cvSkills, jobMarkdown, cvEvidence };
      }
    },
  });