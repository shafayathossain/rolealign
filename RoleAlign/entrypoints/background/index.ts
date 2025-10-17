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
        // If no HTML provided, try to capture it from the active tab
        if (!html?.trim() && req.tabId) {
          try {
            log.debug("Capturing HTML from tab", { tabId: req.tabId });
            const results = await chrome.scripting.executeScript({
              target: { tabId: req.tabId },
              func: () => document.documentElement.outerHTML
            });
            html = results?.[0]?.result || '';
          } catch (e: any) {
            log.warn("Failed to capture HTML from tab", { tabId: req.tabId, error: e?.message });
          }
        }
        
        if (!html?.trim()) {
          return errorRes(req, "BadRequest", "No HTML available for analysis");
        }
        
        // Use appropriate site adapter
        let adapter;
        if (site === "linkedin") {
          adapter = LinkedInAdapter;
        } else if (site === "indeed") {
          adapter = IndeedAdapter;
        } else {
          return errorRes(req, "BadRequest", `Unsupported site: ${site}`);
        }
        
        // Check AI availability first
        let summarizerAvailable, promptAvailable;
        
        try {
          summarizerAvailable = await AI.Availability.summarizer();
          promptAvailable = await AI.Availability.prompt();
          
          log.info("AI availability check completed", {
            summarizer: summarizerAvailable,
            prompt: promptAvailable
          });
        } catch (availError: any) {
          log.error("Failed to check AI availability", {
            error: availError?.message,
            stack: availError?.stack
          });
          throw new Error(`AI availability check failed: ${availError?.message}`);
        }
        
        if (summarizerAvailable === "no") {
          log.error("Summarizer API not available", { 
            availability: summarizerAvailable,
            message: "Please ensure Chrome AI flags are enabled"
          });
          throw new Error(`Summarizer API not available: ${summarizerAvailable}. Enable chrome://flags/#summarization-api-for-gemini-nano`);
        }
        
        if (summarizerAvailable === "after-download") {
          log.warn("Summarizer API requires download", { availability: summarizerAvailable });
          // Continue anyway - the AI.Summarize.text call will handle the download
        }
        
        // Skip traditional parsing and use AI directly for job extraction
        log.info("Using AI-first approach to extract job information from HTML");
        
        try {
          // Extract job description from the specific div class
          log.info("Extracting job description from specific LinkedIn div");
          
          let jobDescriptionHTML = '';
          let jobTitleText = '';
          let companyNameText = '';
          
          // Enhanced job description extraction - capture much more content
          const jobDescPatterns = [
            // Primary: Capture everything from job-details div to end of content
            /<div[^>]*id="job-details"[^>]*>([\s\S]*?)(?=<\/div>\s*<\/div>\s*(?:<\/div>)*\s*$)/i,
            // Alternative: Look for the full container with all nested content
            /<div[^>]*class="[^"]*jobs-box__html-content[^"]*"[^>]*>([\s\S]*)/i,
            // Capture from "About the job" to end of significant content
            /(About the job[\s\S]*?)(?=<\/div>\s*<\/div>|$)/i,
            // Look for substantial text blocks that include job requirements
            /<div[^>]*>[\s\S]*?(About the job[\s\S]*?(?:Requirements|Experience|Skills|Qualifications)[\s\S]*?)</i,
            // Standard fallbacks
            /<div[^>]*class="[^"]*jobs-description-content__text[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<div[^>]*class="[^"]*jobs-description__container[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<section[^>]*class="[^"]*jobs-description[^"]*"[^>]*>([\s\S]*?)<\/section>/i
          ];
          
          for (const [index, pattern] of jobDescPatterns.entries()) {
            const match = html.match(pattern);
            if (match && match[1] && match[1].trim().length > 50) {
              jobDescriptionHTML = match[1];
              log.info(`Found job description with pattern ${index + 1}`, {
                htmlLength: jobDescriptionHTML.length,
                htmlPreview: jobDescriptionHTML.substring(0, 200) + "...",
                patternUsed: `pattern_${index + 1}`
              });
              break;
            }
          }
          
          // If no patterns worked, try a more liberal approach for the specific structure we see
          if (!jobDescriptionHTML) {
            log.warn("Standard patterns failed, trying liberal extraction", {
              htmlLength: html.length,
              hasJobDetails: html.includes('id="job-details"'),
              hasJobsBox: html.includes('jobs-box__html-content')
            });
            
            // Try multiple liberal extraction approaches
            const liberalPatterns = [
              // Capture everything after job-details opening tag
              /id="job-details"[^>]*>([\s\S]*)/i,
              // Capture from About the job onwards
              /(About the job[\s\S]*)/i,
              // Capture any large text block containing job keywords
              /([\s\S]*(?:responsibilities|requirements|experience|skills|qualifications)[\s\S]*)/i
            ];
            
            for (const pattern of liberalPatterns) {
              const liberalMatch = html.match(pattern);
              if (liberalMatch && liberalMatch[1] && liberalMatch[1].trim().length > 200) {
                jobDescriptionHTML = liberalMatch[1];
                log.info("Found job description with liberal extraction", {
                  htmlLength: jobDescriptionHTML.length,
                  htmlPreview: jobDescriptionHTML.substring(0, 200) + "..."
                });
                break;
              }
            }
            
            if (!jobDescriptionHTML) {
              throw new Error("Could not find job description content in LinkedIn page");
            }
          }
          
          // Also extract job title and company more accurately
          const titleMatches = [
            /<h1[^>]*class="[^"]*job-details-jobs-unified-top-card__job-title[^"]*"[^>]*>([^<]+)<\/h1>/i,
            /<h1[^>]*class="[^"]*jobs-unified-top-card__job-title[^"]*"[^>]*>([^<]+)<\/h1>/i,
            /<h1[^>]*>([^<]*(?:developer|engineer|analyst|manager|specialist)[^<]*)<\/h1>/i
          ];
          
          for (const pattern of titleMatches) {
            const match = html.match(pattern);
            if (match) {
              jobTitleText = match[1].trim();
              log.debug("Extracted job title", { title: jobTitleText });
              break;
            }
          }
          
          const companyMatches = [
            /<a[^>]*class="[^"]*jobs-unified-top-card__company-name[^"]*"[^>]*>([^<]+)<\/a>/i,
            /<span[^>]*class="[^"]*jobs-unified-top-card__company-name[^"]*"[^>]*>([^<]+)<\/span>/i,
            /<div[^>]*class="[^"]*jobs-unified-top-card__company-name[^"]*"[^>]*>([^<]+)<\/div>/i
          ];
          
          for (const pattern of companyMatches) {
            const match = html.match(pattern);
            if (match) {
              companyNameText = match[1].trim();
              log.debug("Extracted company name", { company: companyNameText });
              break;
            }
          }
          
          // Clean the job description HTML to get text content
          const cleanedJobText = jobDescriptionHTML
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles
            .replace(/<[^>]+>/g, ' ') // Remove HTML tags
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
          
          log.info("Job description extracted and cleaned", { 
            originalHTMLLength: jobDescriptionHTML.length,
            cleanedLength: cleanedJobText.length,
            preview: cleanedJobText.substring(0, 300) + "...",
            extractedTitle: jobTitleText,
            extractedCompany: companyNameText
          });
          
          if (cleanedJobText.length < 100) {
            throw new Error(`Job description too short (${cleanedJobText.length} chars): ${cleanedJobText}`);
          }
          
          // INNOVATIVE SOLUTION: Sliding window technique with dynamic chunking
          log.info("Using sliding window approach for content extraction", {
            contentLength: cleanedJobText.length
          });
          
          let jobSummary = "";
          const WINDOW_SIZE = 10000; // Balanced size - larger but still within Chrome AI limits
          const OVERLAP = 1000; // Proportional overlap to maintain context
          const MAX_WINDOWS = 6; // Reasonable maximum for large content
          const TIMEOUT_PER_WINDOW = 60000; // 60 seconds per window
          
          // Pre-calculate window count for timeout estimation
          let estimatedWindowCount = Math.ceil(cleanedJobText.length / (WINDOW_SIZE - OVERLAP));
          estimatedWindowCount = Math.min(estimatedWindowCount, MAX_WINDOWS);
          
          // For very large content, use more aggressive chunking
          if (cleanedJobText.length > 150000) {
            log.info("Large content detected, using aggressive chunking", {
              contentLength: cleanedJobText.length
            });
          }
          
          const estimatedTimeout = estimatedWindowCount * TIMEOUT_PER_WINDOW;
          const safetyBuffer = 30000; // 30 second safety buffer
          const totalEstimatedTime = estimatedTimeout + safetyBuffer;
          
          log.info("Pre-calculated window estimation for timeout", {
            contentLength: cleanedJobText.length,
            estimatedWindowCount,
            timeoutPerWindow: TIMEOUT_PER_WINDOW,
            estimatedTimeout,
            totalEstimatedTime
          });
          
          try {
            // Check API availability
            const promptAvail = await AI.Availability.prompt();
            const useAI = promptAvail !== "no" && promptAvail !== "unavailable";
            
            if (useAI) {
              log.info("Processing content with sliding window technique");
              
              // Create sliding windows of content
              const windows: string[] = [];
              let position = 0;
              
              while (position < cleanedJobText.length && windows.length < MAX_WINDOWS) {
                const windowEnd = Math.min(position + WINDOW_SIZE, cleanedJobText.length);
                const window = cleanedJobText.substring(position, windowEnd);
                
                // Find natural break point - prioritize paragraph breaks for better context
                if (windowEnd < cleanedJobText.length && windows.length < MAX_WINDOWS - 1) {
                  // Look for paragraph breaks first (better context preservation)
                  const paragraphBreak = window.lastIndexOf('\n\n');
                  const sentenceBreak = window.lastIndexOf('. ');
                  const lineBreak = window.lastIndexOf('\n');
                  
                  const breakPoint = paragraphBreak > WINDOW_SIZE * 0.6 ? paragraphBreak : 
                                   sentenceBreak > WINDOW_SIZE * 0.6 ? sentenceBreak + 1 : 
                                   lineBreak > WINDOW_SIZE * 0.6 ? lineBreak : -1;
                  
                  if (breakPoint > 0) {
                    windows.push(window.substring(0, breakPoint + 1));
                    position += breakPoint + 1 - OVERLAP;
                  } else {
                    windows.push(window);
                    position += WINDOW_SIZE - OVERLAP;
                  }
                } else {
                  // Last window or forced break - take the rest
                  windows.push(window);
                  break;
                }
              }
              
              log.info("Created content windows", {
                windowCount: windows.length,
                windowSizes: windows.map(w => w.length),
                actualVsEstimated: `${windows.length}/${estimatedWindowCount}`
              });
              
              // Process each window and collect insights
              const insights: string[] = [];
              
              for (let i = 0; i < windows.length; i++) {
                try {
                  const windowPrompt = `Extract job info from text:

${windows[i]}

List: title, company, skills, requirements. If none found, say "Nothing".`;
                  
                  const windowResult = await AI.Prompt.text(windowPrompt, {
                    timeoutMs: TIMEOUT_PER_WINDOW
                  });
                  
                  if (!windowResult.toLowerCase().includes('nothing') && windowResult.trim().length > 5) {
                    insights.push(windowResult);
                  }
                  
                  log.debug(`Processed window ${i + 1}/${windows.length}`);
                  
                } catch (windowError: any) {
                  log.warn(`Window ${i + 1} processing failed`, {
                    error: windowError?.message
                  });
                }
              }
              
              // Combine insights from all windows
              if (insights.length > 0) {
                jobSummary = insights.join('\n\n');
                log.info("Successfully extracted job information from windows", {
                  insightsCount: insights.length
                });
              } else {
                throw new Error("No insights extracted from windows");
              }
              
            } else {
              throw new Error("AI not available");
            }
            
          } catch (error: any) {
            log.warn("AI processing failed, using statistical extraction", {
              error: error?.message
            });
            
            // FALLBACK: Statistical extraction based on sentence patterns
            const sentences = cleanedJobText.split(/[.!?]\s+/);
            const sentenceScores = new Map<string, number>();
            
            // Score sentences by relevance indicators (no hardcoded keywords)
            for (const sentence of sentences) {
              if (sentence.length < 20 || sentence.length > 500) continue;
              
              let score = 0;
              
              // Check for capitalized words (often important terms)
              const capitalizedWords = (sentence.match(/\b[A-Z][a-zA-Z]+\b/g) || []).length;
              score += capitalizedWords * 2;
              
              // Check for numbers (experience years, team size, etc)
              const numbers = (sentence.match(/\b\d+\b/g) || []).length;
              score += numbers * 3;
              
              // Check for punctuation patterns (lists, requirements)
              if (sentence.includes(':')) score += 5;
              if (sentence.includes(',')) score += 1;
              if (sentence.includes('•') || sentence.includes('-')) score += 3;
              
              // Length bonus (moderate length sentences often contain key info)
              if (sentence.length > 50 && sentence.length < 200) score += 2;
              
              sentenceScores.set(sentence, score);
            }
            
            // Get top scoring sentences
            const topSentences = Array.from(sentenceScores.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 30)
              .map(([sentence]) => `• ${sentence.trim()}`);
            
            jobSummary = topSentences.join('\n') || "Unable to extract job information.";
            
            log.info("Statistical extraction completed", {
              totalSentences: sentences.length,
              extractedSentences: topSentences.length
            });
          }
          
          // Store cleanedJobText for later use
          const cleanedText = cleanedJobText;
          
          log.info("✅ Job extraction completed", {
            originalLength: cleanedJobText.length,
            summaryLength: jobSummary.length,
            summaryPreview: jobSummary.substring(0, 300) + "...",
            fullSummary: jobSummary
          });
          
          if (!jobSummary || jobSummary.trim().length < 50) {
            throw new Error("Summarization API returned empty or too short result");
          }
          
          // Use the extracted title and company, with fallbacks
          let jobTitle = jobTitleText || "Job Title";
          let companyName = companyNameText || "Company";
          
          // If Prompt API is available, try to extract more details from summary
          if (promptAvailable !== "no") {
            try {
              log.info("Using Prompt API to extract structured job details");
              
              const jobDetailsPrompt = `Extract job details from this LinkedIn job summary:

${jobSummary}

Return ONLY a valid JSON object (no markdown, no code fences) with job title and company name:
{
  "title": "exact job title from the posting",
  "company": "company name"
}`;

              const jobDetails = await AI.Prompt.json(jobDetailsPrompt, { 
                timeoutMs: 60000,
                schema: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    company: { type: "string" }
                  },
                  required: ["title", "company"]
                }
              });
              
              if (jobDetails.title && jobDetails.title.trim()) {
                jobTitle = jobDetails.title.trim();
              }
              if (jobDetails.company && jobDetails.company.trim()) {
                companyName = jobDetails.company.trim();
              }
              
              log.info("✅ Prompt API job details extracted", { 
                title: jobTitle, 
                company: companyName,
                promptResult: jobDetails
              });
              
            } catch (promptError: any) {
              log.warn("Prompt API failed, using extracted values from HTML", { 
                error: promptError?.message,
                fallbackTitle: jobTitle,
                fallbackCompany: companyName
              });
            }
          }
          
          // Create job object with AI-extracted content
          const job = {
            id: `ai-job-${Date.now()}`,
            url,
            site,
            title: jobTitle,
            company: companyName,
            description: jobSummary,
            descriptionText: jobSummary,
            descriptionMarkdown: jobSummary,
            lastSeenAt: new Date().toISOString(),
            extras: { 
              aiExtracted: true,
              summarizerUsed: true,
              originalTextLength: cleanedText.length,
              windowCount: estimatedWindowCount,
              estimatedTimeoutMs: totalEstimatedTime,
              timeoutPerWindow: TIMEOUT_PER_WINDOW
            }
          };
          
          log.info("🎉 AI job extraction completed successfully", {
            title: job.title,
            company: job.company,
            descriptionLength: job.description.length,
            summaryPreview: job.description.substring(0, 200) + "..."
          });
          
          return okRes(req, { job });
          
        } catch (aiError: any) {
          log.error("AI-based job extraction failed", {
            error: aiError?.message,
            stack: aiError?.stack
          });
          
          // Fallback to emergency job data
          const emergencyJob = {
            id: `${site}-emergency-${Date.now()}`,
            url: url || "unknown",
            site: site,
            title: "Job Analysis Failed",
            company: "Company",
            description: "Unable to analyze job content with AI.",
            descriptionText: "Unable to analyze job content with AI.",
            inferredSkills: [],
            lastSeenAt: new Date().toISOString(),
            extras: {
              parseError: true,
              errorMessage: aiError?.message || String(aiError)
            }
          };
          
          log.warn("Returning emergency fallback job data");
          return okRes(req, { job: emergencyJob });
        }
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
      const { cv, job, chunks, useAI, semanticMatching } = req.payload;
      
      log.info("SCORE_MATCH_ENHANCED started", {
        jobChunks: chunks.length,
        useAI,
        semanticMatching,
        cvSkillsCount: cv?.skills?.length || 0
      });
      
      try {
        // Basic scoring input preparation
        const input = toScoreInput(cv, job);
        const cvSkills = cv?.skills || [];
        
        // Process job description in chunks to extract skills
        let combinedJobSkills: string[] = [];
        let combinedJobText = '';
        
        // Check AI availability first
        const promptAvailable = await AI.Availability.prompt();
        const summarizerAvailable = await AI.Availability.summarizer();
        
        log.info("Chrome AI availability check", {
          prompt: promptAvailable,
          summarizer: summarizerAvailable
        });
        
        for (const [index, chunk] of chunks.entries()) {
          log.debug(`Processing chunk ${index + 1}/${chunks.length}`, {
            chunkLength: chunk.length
          });
          
          // Use sliding window for skill extraction too
          if (useAI && promptAvailable !== "no") {
            try {
              log.debug("Using windowed skill extraction");
              
              const SKILL_WINDOW = 4000; // Smaller windows for skill extraction
              let technicalSummary = '';
              
              if (chunk.length > SKILL_WINDOW) {
                // Take multiple samples from different parts of the chunk
                const samples: string[] = [];
                const sampleCount = 3;
                const step = Math.floor(chunk.length / sampleCount);
                
                for (let i = 0; i < sampleCount; i++) {
                  const start = i * step;
                  const end = Math.min(start + SKILL_WINDOW, chunk.length);
                  samples.push(chunk.substring(start, end));
                }
                
                // Process each sample and combine results
                const allSkills: string[] = [];
                
                for (const sample of samples) {
                  try {
                    const samplePrompt = `Extract technical terms from this text. List any technologies, tools, languages, or frameworks mentioned.

Text:
${sample}

List found terms (comma-separated):`;
                    
                    const sampleResult = await AI.Prompt.text(samplePrompt, {
                      timeoutMs: 30000
                    });
                    
                    const skills = sampleResult.split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 0);
                    allSkills.push(...skills);
                  } catch (sampleError) {
                    log.debug("Sample extraction failed", { error: sampleError });
                  }
                }
                
                // Deduplicate skills
                const uniqueSkills = [...new Set(allSkills)];
                technicalSummary = uniqueSkills.join(', ');
                
                log.debug("Windowed skill extraction complete", {
                  samplesProcessed: samples.length,
                  skillsFound: uniqueSkills.length
                });
              } else {
                // Chunk is small enough to process directly
                const skillPrompt = `Extract technical terms from this text. List any technologies, tools, languages, or frameworks mentioned.

Text:
${chunk}

List found terms (comma-separated):`;
                
                technicalSummary = await AI.Prompt.text(skillPrompt, {
                  timeoutMs: 60000
                });
              }
              
              log.debug("Skill extraction response received", {
                summaryLength: technicalSummary.length
              });
            
            log.debug("Summarization API response", {
              summary: technicalSummary,
              length: technicalSummary.length
            });
            
            // Check if extraction returned valid results
            const isValidResponse = technicalSummary && 
              technicalSummary.trim().length > 5 && 
              !technicalSummary.toLowerCase().includes('error') &&
              !technicalSummary.toLowerCase().includes('unable');
            
            if (!isValidResponse) {
              log.warn("Invalid AI response, using statistical extraction");
              
              // Statistical extraction: find capitalized terms that appear multiple times
              const words = chunk.split(/\s+/);
              const termFrequency = new Map<string, number>();
              
              for (const word of words) {
                // Clean the word
                const cleaned = word.replace(/[^a-zA-Z0-9\.\-\_]/g, '');
                
                // Check if it looks like a technical term (capitalized, contains numbers, or has special patterns)
                if (cleaned.length > 2 && cleaned.length < 30) {
                  const hasCapital = /[A-Z]/.test(cleaned);
                  const hasNumber = /\d/.test(cleaned);
                  const hasDot = cleaned.includes('.');
                  const hasHyphen = cleaned.includes('-');
                  
                  if (hasCapital || hasNumber || hasDot || hasHyphen) {
                    const key = cleaned.toLowerCase();
                    termFrequency.set(key, (termFrequency.get(key) || 0) + 1);
                  }
                }
              }
              
              // Get terms that appear at least twice
              const frequentTerms = Array.from(termFrequency.entries())
                .filter(([_, count]) => count >= 2)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 30)
                .map(([term]) => term);
              
              technicalSummary = frequentTerms.join(', ');
            }
            
            // Then use Prompt API to extract specific skills from the summary
            const skillsPrompt = `You are a technical skill extractor. Extract EXACTLY what is written in the job summary. Follow these systematic steps:

Job Summary:
${technicalSummary}

SYSTEMATIC EXTRACTION PROCESS:

STEP 1: Scan for FRAMEWORK/LIBRARY NAMES:
- Look for proper nouns that are technical frameworks or libraries
- Examples of patterns: CamelCase names, compound technical terms
- Extract exactly as written, preserving spacing and capitalization
- Include any framework mentioned after words like "experience with", "proficiency in", "knowledge of"

STEP 2: Scan for PROGRAMMING LANGUAGES:
- Look for language names (typically capitalized proper nouns in technical context)
- Extract exactly as written

STEP 3: Scan for PLATFORMS/OPERATING SYSTEMS:
- Look for platform names mentioned in technical context
- Extract exactly as written

STEP 4: Scan for DEVELOPMENT TOOLS/PROCESSES:
- Look for technical tools, methodologies, or processes
- Include compound terms with slashes, hyphens, or spaces
- Extract exactly as written

STEP 5: Scan for API/SERVICE TERMS:
- Look for API-related terms, service architectures
- Include compound terms like "REST API", "API services"
- Extract exactly as written

STEP 6: Scan for DATABASE/DATA TECHNOLOGIES:
- Look for database names, data processing technologies
- Include compound terms like "Big Data"
- Extract exactly as written

CONSISTENT EXTRACTION RULES:
- Extract ONLY explicit technical terms that appear in the text
- Preserve exact capitalization, spacing, and punctuation
- Include compound terms as complete units
- NO inference beyond what's literally written
- NO soft skills, company names, job responsibilities
- NO generic categories - extract specific terms only

OUTPUT FORMAT: Comma-separated list of exact technical terms as they appear in the text

WHAT TO EXCLUDE:
❌ Soft skills (communication, problem-solving, collaboration)
❌ Company names (Notewise, etc.)
❌ Job responsibilities (lead development, code reviews)
❌ Education requirements (Bachelor's degree)
❌ Experience levels (5+ years, Senior)
❌ General terms (mobile, cloud, AI) unless they're specific technical requirements
❌ Business terms (stakeholders, management, QA)
❌ Inferred/related technologies not explicitly mentioned

EXAMPLE:
Text: "experience with UIKit, SwiftUI, Core Graphics"
Extract: UIKit, SwiftUI, Core Graphics
Do NOT extract: iOS development, Xcode, Interface Builder

OUTPUT: Comma-separated list of exact technical terms from the text

Technical Skills:`;
            
            const chunkSkillsText = await AI.Prompt.text(skillsPrompt, { timeoutMs: 60000 });
            
            log.debug("Prompt API response for skills extraction", {
              response: chunkSkillsText,
              length: chunkSkillsText.length
            });
            
            // Validate AI response - check for error messages or invalid responses
            const invalidPhrases = ['sorry', 'cannot', 'unable', 'i cannot', 'no skills', 'not mentioned'];
            const isErrorResponse = invalidPhrases.some(phrase => 
              chunkSkillsText.toLowerCase().includes(phrase)
            ) || chunkSkillsText.trim().length < 5;
            
            if (isErrorResponse) {
              log.warn("AI returned error/empty response, falling back to regex extraction", {
                response: chunkSkillsText
              });
              throw new Error("AI returned invalid response");
            }
            
            const chunkSkills = chunkSkillsText
              .split(/[,\n]/)
              .map(skill => skill.trim().replace(/^[•\-\*]\s*/, '')) // Remove bullet points
              .filter(skill => skill && skill.length > 1 && skill.length < 50 && !skill.toLowerCase().includes('skill'));
            
            combinedJobSkills.push(...chunkSkills);
            combinedJobText += chunk + ' ';
            
            log.debug(`Skills extracted from chunk ${index + 1}`, {
              skillsCount: chunkSkills.length,
              skills: chunkSkills
            });
            
            } catch (chunkError: any) {
              log.warn(`Chrome AI failed to extract skills from chunk ${index + 1}, using regex fallback`, {
                error: chunkError?.message
              });
              
              // Fallback: regex-based skill extraction
              const regexSkills = extractSkillsWithRegex(chunk);
              combinedJobSkills.push(...regexSkills);
              combinedJobText += chunk + ' ';
              
              log.debug(`Regex fallback extracted ${regexSkills.length} skills`, {
                skills: regexSkills
              });
            }
          } else {
            // AI not available or disabled, use regex extraction
            log.debug(`Chrome AI not available or disabled (prompt: ${promptAvailable}, summarizer: ${summarizerAvailable}), using regex extraction`);
            
            const regexSkills = extractSkillsWithRegex(chunk);
            combinedJobSkills.push(...regexSkills);
            combinedJobText += chunk + ' ';
            
            log.debug(`Regex extraction found ${regexSkills.length} skills`, {
              skills: regexSkills
            });
          }
        }
        
        // Deduplicate job skills
        const uniqueJobSkills = [...new Set(combinedJobSkills.map(s => s.toLowerCase()))];
        
        log.info("Job skills extraction completed", {
          totalSkillsExtracted: combinedJobSkills.length,
          uniqueSkills: uniqueJobSkills.length,
          skills: uniqueJobSkills
        });
        
        // Perform semantic skill matching using AI
        let matchedSkills: Array<{
          userSkill: string;
          jobSkill: string;
          confidence: number;
          semantic: boolean;
        }> = [];
        
        let missingSkills: string[] = [];
        let aiReasoning = '';
        
        // Use AI-driven skill matching for maximum scalability
        log.debug("Using AI-driven skill matching with no hardcoded patterns");
        
        const cvSkillsLower = cvSkills.map(s => s.toLowerCase().trim());
        
        log.info("Performing AI-driven skill matching", {
          candidateSkills: cvSkills,
          jobSkills: uniqueJobSkills,
          candidateSkillsCount: cvSkills.length,
          jobSkillsCount: uniqueJobSkills.length
        });
        
        // Use AI to determine skill matches with no hardcoded patterns
        if (useAI && promptAvailable !== "no" && cvSkills.length > 0 && uniqueJobSkills.length > 0) {
          try {
            log.debug("Using AI for skill matching analysis");
            
            // Convert skills to lowercase for AI matching to eliminate case sensitivity issues
            const cvSkillsLower = cvSkills.map(skill => skill.toLowerCase());
            const jobSkillsLower = uniqueJobSkills.map(skill => skill.toLowerCase());
            
            const skillMatchingPrompt = `You are an expert technical recruiter matching candidate skills with job requirements. Your goal is to find ALL possible matches between the two lists below.

CANDIDATE SKILLS (lowercase):
${cvSkillsLower.join(', ')}

JOB REQUIRED SKILLS (lowercase):
${jobSkillsLower.join(', ')}

MATCHING PHILOSOPHY:
Think like an experienced tech recruiter who understands that skills are interconnected. Many technologies come as a package - when someone knows one technology, they inherently know related technologies. Be generous in your matching while remaining technically accurate.

MATCHING TYPES TO APPLY:

1. EXACT MATCHES: 
   Skills that are identical or differ only in formatting/capitalization.
   Confidence: 1.0

2. SUBSET/SUPERSET MATCHES:
   When a candidate skill contains or is contained within a job skill.
   Examples: "software development" contains "development", "api integration" contains "api"
   Confidence: 0.9

3. ECOSYSTEM MATCHES:
   Skills that are part of the same technology ecosystem or toolchain.
   - Development platforms always include their standard tools (IDEs, build systems, deployment platforms)
   - Cloud platforms include their messaging services
   - Databases with specific variants (SQL includes all SQL variants)
   - Version control systems that serve similar purposes
   Confidence: 0.85

4. SEMANTIC EQUIVALENTS:
   Different names for the same technology or concept.
   - Abbreviations and their full forms
   - Common alternative names for the same technology
   - Related methodologies that overlap significantly
   Confidence: 0.9

5. IMPLICIT KNOWLEDGE:
   Skills that are inherently known if you know another skill.
   - Knowing a specific implementation implies knowing the general concept
   - Knowing a framework implies knowing its configuration and build tools
   - Knowing a platform implies knowing its deployment mechanisms
   Confidence: 0.8

REASONING APPROACH:
- If someone has experience with a mobile platform, they know its entire toolchain
- If someone knows a cloud service, they know its related services
- If someone knows a database, they know its query language
- If someone knows a framework, they know its ecosystem tools
- Version control systems are often interchangeable in terms of concepts
- API knowledge transfers across different API types
- Testing frameworks knowledge transfers across similar frameworks

OUTPUT REQUIREMENTS:
Return ONLY a raw JSON array - no markdown, no code fences, no backticks, no explanations.
Start your response with [ and end with ]
Each match must use the EXACT strings from the lists above.
Format: [{"userSkill":"exact string from candidate list","jobSkill":"exact string from job list","matchType":"exact/semantic","confidence":0.7-1.0}]

CRITICAL: Do NOT wrap the JSON in markdown code fences or backticks. Return raw JSON only.
Be thorough - find EVERY possible valid match. Think about what skills naturally come together in real-world development.`;
            
            const schema = {
              type: "array",
              items: {
                type: "object",
                properties: {
                  userSkill: { type: "string" },
                  jobSkill: { type: "string" },
                  matchType: { type: "string", enum: ["exact", "semantic"] },
                  confidence: { type: "number", minimum: 0, maximum: 1 }
                },
                required: ["userSkill", "jobSkill", "matchType", "confidence"]
              }
            };
            
            const aiMatches = await AI.Prompt.json<Array<{
              userSkill: string;
              jobSkill: string;
              matchType: string;
              confidence: number;
            }>>(skillMatchingPrompt, { schema, timeoutMs: 120000 }); // Increased timeout to 2 minutes
            
            log.debug("AI skill matching response", {
              matches: aiMatches,
              matchCount: aiMatches?.length || 0
            });
            
            // Validate and process AI matches (AI returns lowercase, map back to original case)
            if (Array.isArray(aiMatches)) {
              for (const match of aiMatches) {
                // Find the original case versions of the skills
                const originalUserSkill = cvSkills.find(skill => 
                  skill.toLowerCase() === match.userSkill.toLowerCase()
                );
                
                const originalJobSkill = uniqueJobSkills.find(skill => 
                  skill.toLowerCase() === match.jobSkill.toLowerCase()
                );
                
                // Validate that both skills exist in lowercase lists
                const userSkillExists = cvSkillsLower.includes(match.userSkill.toLowerCase());
                const jobSkillExists = jobSkillsLower.includes(match.jobSkill.toLowerCase());
                
                if (userSkillExists && jobSkillExists && originalUserSkill && originalJobSkill) {
                  matchedSkills.push({
                    userSkill: originalUserSkill,  // Use original case
                    jobSkill: originalJobSkill,    // Use original case
                    confidence: Math.max(0, Math.min(1, match.confidence || 0.8)),
                    semantic: match.matchType === "semantic"
                  });
                  
                  log.debug("AI skill match validated", {
                    userSkill: originalUserSkill,
                    jobSkill: originalJobSkill,
                    type: match.matchType,
                    confidence: match.confidence
                  });
                } else {
                  log.warn("AI returned invalid skill match", {
                    match,
                    userSkillExists,
                    jobSkillExists,
                    userSkillsPreview: cvSkills.slice(0, 10),
                    jobSkillsPreview: uniqueJobSkills,
                    matchedUserSkill: match.userSkill,
                    matchedJobSkill: match.jobSkill
                  });
                }
              }
              
              // Determine missing skills
              const matchedJobSkills = matchedSkills.map(m => m.jobSkill.toLowerCase().trim());
              missingSkills = uniqueJobSkills.filter(jobSkill => 
                !matchedJobSkills.includes(jobSkill.toLowerCase().trim())
              );
              
              aiReasoning = `AI analyzed ${cvSkills.length} candidate skills against ${uniqueJobSkills.length} job requirements. Found ${matchedSkills.length} valid matches with no hallucinations.`;
              
            } else {
              throw new Error("AI returned invalid match format");
            }
            
          } catch (aiError: any) {
            log.warn("AI skill matching failed, using basic exact matching", {
              error: aiError?.message
            });
            
            // Fallback to basic exact matching without hardcoded patterns
            for (const jobSkill of uniqueJobSkills) {
              const jobSkillLower = jobSkill.toLowerCase().trim();
              
              // Only exact matches - no hardcoded variations
              const exactMatchIndex = cvSkillsLower.findIndex(cvSkill => 
                cvSkill === jobSkillLower
              );
              
              if (exactMatchIndex !== -1) {
                const originalSkill = cvSkills[exactMatchIndex];
                matchedSkills.push({
                  userSkill: originalSkill,
                  jobSkill: jobSkill,
                  confidence: 1.0,
                  semantic: false
                });
                
                log.debug("Basic exact skill match", {
                  userSkill: originalSkill,
                  jobSkill: jobSkill
                });
              } else {
                missingSkills.push(jobSkill);
              }
            }
            
            aiReasoning = "Fallback to basic exact matching due to AI unavailability. No semantic matching performed.";
          }
        } else {
          log.debug("AI disabled or unavailable, using basic exact matching");
          
          // Basic exact matching when AI is disabled
          for (const jobSkill of uniqueJobSkills) {
            const jobSkillLower = jobSkill.toLowerCase().trim();
            
            const exactMatchIndex = cvSkillsLower.findIndex(cvSkill => 
              cvSkill === jobSkillLower
            );
            
            if (exactMatchIndex !== -1) {
              const originalSkill = cvSkills[exactMatchIndex];
              matchedSkills.push({
                userSkill: originalSkill,
                jobSkill: jobSkill,
                confidence: 1.0,
                semantic: false
              });
            } else {
              missingSkills.push(jobSkill);
            }
          }
          
          aiReasoning = "Basic exact matching only - AI disabled or unavailable.";
        }
        
        
        // Calculate enhanced score based on matches
        const totalJobSkills = uniqueJobSkills.length;
        const matchedCount = matchedSkills.length;
        const confidenceWeight = matchedSkills.reduce((sum, m) => sum + m.confidence, 0);
        
        const rawScore = totalJobSkills > 0 ? (confidenceWeight / totalJobSkills) : 0;
        const enhancedScore = Math.min(Math.round(rawScore * 100), 100);
        
        // Generate comprehensive reasons
        const reasons = [
          `Matched ${matchedCount}/${totalJobSkills} required skills (${enhancedScore}%)`,
          `Processed ${chunks.length} chunks of job description`,
          `Used ${semanticMatching ? 'AI semantic' : 'basic'} matching`
        ];
        
        if (matchedSkills.some(m => m.semantic)) {
          reasons.push(`Found ${matchedSkills.filter(m => m.semantic).length} semantic skill matches`);
        }
        
        const result = {
          score: enhancedScore,
          reasons,
          facets: {
            totalJobSkills,
            matchedCount,
            missingCount: missingSkills.length,
            confidenceWeight,
            chunksProcessed: chunks.length,
            semanticMatching
          },
          matchDetails: {
            matchedSkills,
            missingSkills,
            aiReasoning
          }
        };
        
        log.info("SCORE_MATCH_ENHANCED completed", {
          score: enhancedScore,
          matched: matchedCount,
          missing: missingSkills.length,
          confidence: confidenceWeight / matchedCount
        });
        
        // Release AI session to improve performance for next scoring
        AI.releasePromptSession();
        
        return okRes(req, result);
        
      } catch (error: any) {
        log.error("SCORE_MATCH_ENHANCED failed", {
          error: error?.message,
          stack: error?.stack
        });
        
        // Release AI session even on error to prevent performance degradation
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

    // Add global message listener for CV builder AI API calls
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
            result = await AI.Prompt.text(message.prompt, message.options || {});
            sendResponse({ result });
            break;

          case 'AI_SUMMARIZE_TEXT':
            result = await AI.Summarize.text(message.text, message.options || {});
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