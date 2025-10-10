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
              
              structuredData = await AI.Prompt.text(extractPrompt, { timeoutMs: 30000 });
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
              
              structuredData = await AI.Prompt.text(extractPrompt, { timeoutMs: 30000 });
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
              
              structuredData = await AI.Prompt.text(extractPrompt, { timeoutMs: 30000 });
            } else {
              // For other sections, use summarization to clean up while preserving key info
              structuredData = await AI.Summarize.text(text, {
                type: "key-points",
                format: "markdown", 
                length: "medium",
                timeoutMs: 30000
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
              const skillsText = await AI.Prompt.text(skillsPrompt, { timeoutMs: 15000 });
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
          
          // Look for the job description div with the exact classes you specified
          const jobDescMatch = html.match(/<div[^>]*class="[^"]*jobs-box__html-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
          if (jobDescMatch) {
            jobDescriptionHTML = jobDescMatch[1];
            log.info("Found job description div", {
              htmlLength: jobDescriptionHTML.length,
              htmlPreview: jobDescriptionHTML.substring(0, 200) + "..."
            });
          } else {
            // Fallback: look for other job description containers
            const fallbackMatches = [
              /<div[^>]*class="[^"]*jobs-description-content__text[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
              /<div[^>]*class="[^"]*jobs-description__container[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
              /<section[^>]*class="[^"]*jobs-description[^"]*"[^>]*>([\s\S]*?)<\/section>/i
            ];
            
            for (const pattern of fallbackMatches) {
              const match = html.match(pattern);
              if (match) {
                jobDescriptionHTML = match[1];
                log.info("Found job description with fallback pattern", {
                  htmlLength: jobDescriptionHTML.length
                });
                break;
              }
            }
          }
          
          if (!jobDescriptionHTML) {
            throw new Error("Could not find job description content in LinkedIn page");
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
          
          // Take the job description text for summarization
          const textForSummarization = cleanedJobText;
          
          // Store cleanedJobText for later use
          const cleanedText = cleanedJobText;
          
          log.info("Starting Summarization API call", {
            textLength: textForSummarization.length,
            context: "Extract job details from LinkedIn page"
          });
          
          // Use Summarization API to extract job details - focusing only on the actual job content
          const jobSummary = await AI.Summarize.text(textForSummarization, {
            type: "key-points",
            format: "markdown", 
            length: "long",
            context: "Extract job requirements, technical skills, responsibilities, and qualifications from this job posting. Focus ONLY on technical skills like programming languages, frameworks, tools, databases, cloud platforms, development methodologies, and specific technologies required for this position. Ignore any LinkedIn platform content or unrelated information.",
            timeoutMs: 30000
          });
          
          log.info("✅ Summarize API response received successfully", {
            inputLength: textForSummarization.length,
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
                timeoutMs: 15000,
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
              originalTextLength: cleanedText.length
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
      
      const method: "deterministic" | "ai" | "blend" =
      useAI === true ? "blend" : "deterministic";
      
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
          
          // Use Chrome's AI APIs if available, otherwise fall back to regex
          if (useAI && promptAvailable !== "no" && summarizerAvailable !== "no") {
            try {
              log.debug("Using Chrome Summarization + Prompt APIs for skill extraction");
            
            // First, use Summarization API to extract key technical points
            let technicalSummary = await AI.Summarize.text(chunk, {
              type: "key-points",
              format: "markdown", 
              length: "long",
              context: "You are extracting technical requirements from a job posting. Focus ONLY on technical skills, technologies, frameworks, programming languages, platforms, and development tools that are explicitly mentioned. IGNORE company information, job responsibilities, soft skills, and general business content. Extract technical terms exactly as written: React Native, Flutter, Android, iOS, Java, Swift, Kotlin, API, CI/CD, etc. Prioritize concrete technical requirements over general descriptions.",
              timeoutMs: 20000
            });
            
            log.debug("Summarization API response", {
              summary: technicalSummary,
              length: technicalSummary.length
            });
            
            // Check if summarization failed
            const summarizationFailures = [
              'AI is currently unable to analyze',
              'unable to process',
              'cannot analyze',
              'error occurred',
              'failed to analyze'
            ];
            
            const isSummarizationError = summarizationFailures.some(phrase => 
              technicalSummary.toLowerCase().includes(phrase.toLowerCase())
            );
            
            if (isSummarizationError || technicalSummary.trim().length < 50) {
              log.warn("Summarization API failed, using original chunk directly", {
                summary: technicalSummary,
                chunkLength: cleanedJobText.length
              });
              // Use the original job text instead of the failed summary
              technicalSummary = cleanedJobText;
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
            
            const chunkSkillsText = await AI.Prompt.text(skillsPrompt, { timeoutMs: 15000 });
            
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
            
            const skillMatchingPrompt = `You are a skill matching algorithm. Apply these pattern-based rules consistently to find matches between any skills.

CANDIDATE SKILLS:
${cvSkills.join(', ')}

JOB REQUIRED SKILLS:  
${uniqueJobSkills.join(', ')}

PATTERN-BASED MATCHING RULES (apply in order):

RULE 1 - EXACT STRING MATCHES (case-insensitive):
- If candidate skill and job skill are identical when lowercased → EXACT MATCH (confidence: 1.0)
- Examples: "iOS" ↔ "ios", "JavaScript" ↔ "javascript"

RULE 2 - PLATFORM DEVELOPMENT PATTERN:
- If candidate has "[Platform] Development" and job needs "[Platform]" → SEMANTIC MATCH (confidence: 0.9)
- Pattern: "X Development" matches "X" where X is a platform/technology name
- Examples: "Android Development" ↔ "Android", "Web Development" ↔ "Web"

RULE 3 - API SKILLS PATTERN:
- If candidate has API-related skill and job needs API-related skill → SEMANTIC MATCH (confidence: 0.8)
- Patterns: "API Integration" ↔ "REST API", "API Integration" ↔ "API services"
- Any skill containing "API" can match other "API" skills if contextually related

RULE 4 - FRAMEWORK SPECIALIZATION PATTERN:
- If candidate has specific framework and job needs generic framework category → SEMANTIC MATCH (confidence: 0.7)
- Pattern: Specific framework matches "Mobile Frameworks", "Web Frameworks", etc.
- Examples: Any mobile framework matches "Mobile Frameworks"

RULE 5 - TESTING/QA PATTERN:
- If candidate has testing-related skill and job needs testing-related skill → SEMANTIC MATCH (confidence: 0.8)
- Patterns: Skills containing "test", "testing", "quality", "QA" match each other

RULE 6 - TOOL/METHODOLOGY PATTERN:
- If skills are related development tools or methodologies → SEMANTIC MATCH (confidence: 0.7)
- Examples: "DevOps" ↔ "CI/CD", deployment-related skills

ALGORITHM INSTRUCTIONS:
1. For each job skill, check against ALL candidate skills
2. Apply rules 1-6 in order, take first match found
3. Use exact confidence values specified
4. Be consistent - same input should always produce same output
5. Only match if there's genuine technical relationship

OUTPUT FORMAT:
[{
  "userSkill": "exact skill from candidate list",
  "jobSkill": "exact skill from job requirements",
  "matchType": "exact" or "semantic",
  "confidence": 0.8-1.0
}]

Be extremely conservative - no false positives.`;
            
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
            }>>(skillMatchingPrompt, { schema, timeoutMs: 20000 });
            
            log.debug("AI skill matching response", {
              matches: aiMatches,
              matchCount: aiMatches?.length || 0
            });
            
            // Validate and process AI matches
            if (Array.isArray(aiMatches)) {
              for (const match of aiMatches) {
                // More flexible validation for semantic matches
                let userSkillExists = false;
                let jobSkillExists = false;
                
                if (match.matchType === 'exact') {
                  // For exact matches, require exact string match
                  userSkillExists = cvSkills.some(skill => 
                    skill.toLowerCase().trim() === match.userSkill.toLowerCase().trim()
                  );
                  jobSkillExists = uniqueJobSkills.some(skill => 
                    skill.toLowerCase().trim() === match.jobSkill.toLowerCase().trim()
                  );
                } else {
                  // For semantic matches, be more flexible
                  userSkillExists = cvSkills.some(skill => {
                    const skillLower = skill.toLowerCase().trim();
                    const matchLower = match.userSkill.toLowerCase().trim();
                    return skillLower === matchLower || 
                           skillLower.includes(matchLower) || 
                           matchLower.includes(skillLower);
                  });
                  
                  jobSkillExists = uniqueJobSkills.some(skill => {
                    const skillLower = skill.toLowerCase().trim();
                    const matchLower = match.jobSkill.toLowerCase().trim();
                    return skillLower === matchLower || 
                           skillLower.includes(matchLower) || 
                           matchLower.includes(skillLower);
                  });
                }
                
                if (userSkillExists && jobSkillExists) {
                  matchedSkills.push({
                    userSkill: match.userSkill,
                    jobSkill: match.jobSkill,
                    confidence: Math.max(0, Math.min(1, match.confidence || 0.8)),
                    semantic: match.matchType === "semantic"
                  });
                  
                  log.debug("AI skill match validated", {
                    userSkill: match.userSkill,
                    jobSkill: match.jobSkill,
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
        
        return okRes(req, result);
        
      } catch (error: any) {
        log.error("SCORE_MATCH_ENHANCED failed", {
          error: error?.message,
          stack: error?.stack
        });
        throw error;
      }
    });
    
    addHandler("GENERATE_TAILORED_CV", async (req: GenerateTailoredCvReq) => {
      const { cv, job, targetFormat } = req.payload;
      
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