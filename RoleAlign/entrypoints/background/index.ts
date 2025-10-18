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
        const jobDescPatterns = [
          /<div[^>]*id="job-details"[^>]*>([\s\S]*?)(?=<\/div>\s*<\/div>\s*(?:<\/div>)*\s*$)/i,
          /<div[^>]*class="[^"]*jobs-box__html-content[^"]*"[^>]*>([\s\S]*)/i,
          /(About the job[\s\S]*?)(?=<\/div>\s*<\/div>|$)/i,
          /<div[^>]*>[\s\S]*?(About the job[\s\S]*?(?:Requirements|Experience|Skills|Qualifications)[\s\S]*?)</i,
          /<div[^>]*class="[^"]*jobs-description-content__text[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
          /<div[^>]*class="[^"]*jobs-description__container[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
          /<section[^>]*class="[^"]*jobs-description[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
        ];

        for (const [idx, pattern] of jobDescPatterns.entries()) {
          const m = html.match(pattern);
          if (m && m[1] && m[1].trim().length > 50) {
            jobDescriptionHTML = m[1];
            log.info("Found job description block", {
              patternIndex: idx + 1,
              htmlLength: jobDescriptionHTML.length,
              preview: jobDescriptionHTML.substring(0, 180) + "...",
            });
            break;
          }
        }
        if (!jobDescriptionHTML) {
          return errorRes(req, "BadRequest", "Could not locate a job description section in the page HTML");
        }

        // 4) Clean to plain text for AI
        const cleanedJobText = jobDescriptionHTML
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (cleanedJobText.length < 100) {
          return errorRes(req, "BadRequest", `Job description too short (${cleanedJobText.length} chars)`);
        }

        // 5) Extract skills using AI with deterministic prompt
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

        let extractedSkills: string[] = [];
        try {
          const skillsResult = await AI.Prompt.json<string[]>(skillsPrompt, {
            timeoutMs: 60_000,
            schema: {
              type: "array",
              items: { type: "string" }
            }
          });

          if (Array.isArray(skillsResult)) {
            extractedSkills = skillsResult
              .filter(skill => typeof skill === 'string' && skill.trim().length > 0)
              .map(skill => skill.trim())
              .filter((skill, index, arr) => arr.indexOf(skill) === index) // Remove duplicates
              .sort();
          }

          log.info("Skills extracted from job description", {
            skillsCount: extractedSkills.length,
            skills: extractedSkills
          });
        } catch (skillError: any) {
          log.warn("AI skill extraction failed, using regex fallback", { error: skillError?.message });
          
          // Fallback: regex-based skill extraction
          extractedSkills = extractSkillsWithRegex(cleanedJobText);
          log.info("Regex fallback skills extracted", {
            skillsCount: extractedSkills.length,
            skills: extractedSkills
          });
        }

        // 6) Extract basic job metadata (title, company) from HTML patterns
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

        log.info("Job metadata extracted", { jobTitle, companyName });

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

    // ── 2) AI prompt (single, strict, domain-agnostic) ─────────────────────
    function buildPrompt(cvLower: string[], jobLower: string[]) {
      // We send lowercased items to the model for stable matching, but we will map back to originals afterwards.
      return `
You are a meticulous recruiter matching candidate skills to job requirements using ONLY the two provided lists of strings.

OBJECTIVE
Return high-quality pairings between items in CANDIDATE SKILLS and JOB SKILLS. Use string evidence plus widely recognized
general patterns a careful human would accept (no external knowledge, no hallucination). Your goal is coverage: for each
JOB skill, include a match if there is a clearly justifiable overlap in meaning based on the strings themselves.

ALLOWED EVIDENCE (domain-agnostic)
A) STRING-NORMALIZATION EQUIVALENCE
   - case-insensitive; trim spaces; unify multiple spaces; ignore trivial punctuation; handle hyphen/slash/underscore variants;
     singular/plural; simple lemmatization (e.g., optimization/optimizing/optimize).
   - Examples: "ci/cd" ↔ "ci cd"; "oauth2" ↔ "oauth 2.0"; "apis" ↔ "api"; "performance optimization" ↔ "performance optimizing".

B) HEAD–MODIFIER CONTAINMENT (general ↔ specific)
   - A phrase is the same skill as its head or a strict specialization of it when the modifier only narrows scope.
   - Examples: "api integrations" ↔ "api"; "ui/ux design" ↔ "ui/ux"; "mobile performance optimization" ↔ "performance optimization";
               "android ui frameworks" ↔ "android".

C) ABBREVIATION / EXPANSION
   - Clear short ↔ long forms that obviously denote the same concept in string form.
   - Examples: "gcp" ↔ "google cloud platform"; "hl7" ↔ "health level 7".

D) CONCEPT ↔ IMPLEMENTATION (built-on / enabler)
   - A generic capability or practice can map to a concrete enabling technology or framework, and vice versa, when the
     connection is apparent from the strings. (This is domain-agnostic: do not invent relations; rely on obvious name cues.)
   - Examples: "real-time communication" ↔ "websocket"; "mocking" ↔ "mockito"; "unit testing" ↔ "junit";
               "orm / object-relational mapping" ↔ "hibernate"; "embedded database" ↔ "sqlite".

E) PLATFORM / FAMILY MEMBERSHIP (explicitly named)
   - A platform term can match a family term that explicitly names that platform (and vice versa).
   - Examples: "android" ↔ "androidx libraries"; "salesforce" ↔ "salesforce apex".
   - Disallow cross-vendor/platform (e.g., "aws" ↔ "gcp") unless the strings explicitly denote the same standard.

DISALLOWED
- Cross-vendor or unrelated ecosystems (e.g., "aws" ↔ "gcp", "firebase" ↔ "cloudflare") unless the strings clearly denote the same thing.
- Vague business/quality outcomes with no string link (e.g., "git" ↔ "scalable builds").
- Any invention of new skills not in the inputs, or mapping to categories not present in the inputs.

COVERAGE POLICY
- For each JOB skill, attempt to find the **single best** candidate match using the hierarchy:
  1) String-normalization equivalence (A).
  2) Head–modifier containment (B) OR abbreviation/expansion (C).
  3) Concept ↔ implementation (D).
  4) Platform/family membership (E), only if explicitly named in both terms or clearly the same family by string.
- If multiple candidate items qualify, choose the one with the strongest relation and assign the appropriate confidence.
- If nothing qualifies under A–E, do not match that job item.

CONFIDENCE (choose one per pair)
- 1.00  exact/normalized string equivalence (A only) → matchType:"exact"
- 0.95  abbreviation/expansion or minor formatting variants (A + C) → matchType:"exact"
- 0.90  clear head–modifier containment (B) → matchType:"semantic"
- 0.88  explicit platform family membership (E) → matchType:"semantic"
- 0.85  clear concept↔implementation (D) → matchType:"semantic"
- 0.80–0.84 weaker but defensible overlap based on strings (use sparingly) → matchType:"semantic"

OUTPUT — VALID JSON ONLY (no markdown, no comments, no prose):
{
  "matches": [
    {"userSkill":"<string from candidate list>","jobSkill":"<string from job list>","matchType":"exact|semantic","confidence":0.7-1.0}
  ]
}

VALIDATION
- Every "userSkill" must exist in the candidate list exactly as provided (case-insensitive).
- Every "jobSkill" must exist in the job list exactly as provided (case-insensitive).
- Do not output items not present in the input lists.

EXAMPLES (illustrative across domains; do not invent beyond strings):
- "api integration" (candidate) ↔ "api" (job)                          → semantic 0.90
- "ui/ux design" (candidate) ↔ "ui/ux" (job)                            → semantic 0.90
- "performance optimization" (candidate) ↔ "app performance optimization" (job) → semantic 0.90
- "real-time communication" (job) ↔ "websocket" (candidate)             → semantic 0.85
- "embedded database" (job) ↔ "sqlite" (candidate)                      → semantic 0.85
- "android" (candidate) ↔ "androidx libraries" (job)                    → semantic 0.88
- "google cloud platform" ↔ "gcp"                                       → exact    0.95
- (NOT ALLOWED) "aws" ↔ "gcp"                                           → reject
- (NOT ALLOWED) "git" ↔ "scalable builds"                               → reject

CANDIDATE SKILLS (lowercase):
${cvLower.join(", ")}

JOB SKILLS (lowercase):
${jobLower.join(", ")}
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

    async function runMatchPrompt(cvLower: string[], jobLower: string[]) {
      const prompt = buildPrompt(cvLower, jobLower);
      return AI.Prompt.json<{ matches: Array<{userSkill: string; jobSkill: string; matchType: "exact"|"semantic"; confidence: number}> }>(
        prompt,
        { schema, timeoutMs: 120_000 }
      );
    }

    // First attempt
    let ai = await runMatchPrompt(cvListLower, jobListLower).catch((e: any) => {
      log.warn("AI match pass failed (attempt 1)", { error: e?.message });
      return null;
    });

    // Optional single retry with a stricter preamble if needed
    if (!ai || !Array.isArray(ai.matches)) {
      const stricter = `
IMPORTANT: You must return valid JSON matching the schema exactly. Do not include any text outside the JSON.
Perform only string-based equivalence as described. No external knowledge, no new terms.

`.concat(buildPrompt(cvListLower, jobListLower));
      ai = await AI.Prompt.json<{ matches: Array<{userSkill: string; jobSkill: string; matchType: "exact"|"semantic"; confidence: number}> }>(
        stricter,
        { schema, timeoutMs: 120_000 }
      ).catch((e: any) => {
        log.error("AI match pass failed (attempt 2)", { error: e?.message });
        return null;
      });
    }

    if (!ai || !Array.isArray(ai.matches)) {
      return errorRes(req, "Internal", "AI did not produce a valid match set.");
    }

    // ── 3) Validate & map back to original casing ──────────────────────────
    const seenPairs = new Set<string>();
    const matchedSkills: Array<{
      userSkill: string;
      jobSkill: string;
      confidence: number;
      semantic: boolean;
    }> = [];

    for (const m of ai.matches) {
      if (!m || typeof m.userSkill !== "string" || typeof m.jobSkill !== "string") continue;
      const uLow = m.userSkill.trim().toLowerCase();
      const jLow = m.jobSkill.trim().toLowerCase();

      if (!cvLowerToOrig.has(uLow) || !jobLowerToOrig.has(jLow)) continue; // must come from provided lists
      if (typeof m.confidence !== "number" || m.confidence < 0.7 || m.confidence > 1.0) continue;

      const key = `${uLow}→${jLow}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);

      matchedSkills.push({
        userSkill: cvLowerToOrig.get(uLow)!,
        jobSkill: jobLowerToOrig.get(jLow)!,
        confidence: Math.max(0.7, Math.min(1, m.confidence)),
        semantic: m.matchType === "semantic"
      });
    }

    // Compute missing from job list
    const matchedJobSet = new Set(matchedSkills.map(m => m.jobSkill.toLowerCase()));
    const missingSkills = Array.from(jobLowerToOrig.values()).filter(js => !matchedJobSet.has(js.toLowerCase()));

    // ── 4) Score (confidence-weighted over unique job skills) ──────────────
    const totalJobSkills = jobListLower.length;
    const matchedCount = matchedSkills.length;
    const confidenceWeight = matchedSkills.reduce((sum, m) => sum + m.confidence, 0);
    const rawScore = totalJobSkills > 0 ? (confidenceWeight / totalJobSkills) : 0;
    const enhancedScore = Math.min(Math.round(rawScore * 100), 100);

    const reasons = [
      `Matched ${matchedCount}/${totalJobSkills} required skills (${enhancedScore}%)`,
      `AI-only semantic/string-equivalence matching (no hardcoded aliases)`,
      `Confidence-weighted scoring from model outputs`
    ];
    if (matchedSkills.some(m => m.semantic)) {
      reasons.push(`Found ${matchedSkills.filter(m => m.semantic).length} semantic matches (e.g., head–modifier or abbreviation forms)`);
    }

    const result = {
      score: enhancedScore,
      reasons,
      facets: {
        totalJobSkills,
        matchedCount,
        missingCount: missingSkills.length,
        confidenceWeight,
        preExtractedSkills: jobSkillsRaw.length,
        semanticMatching: true
      },
      matchDetails: {
        matchedSkills,
        missingSkills,
        aiReasoning: `Single-pass AI matching with strict schema over normalized strings.`
      }
    };

    log.info("SCORE_MATCH_ENHANCED completed", {
      score: enhancedScore,
      matched: matchedCount,
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