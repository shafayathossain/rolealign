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
  GenerateTailoredCvReq,
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
        
        // Build structured CV from processed sections
        const cv = {
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
            summarySkipped: true
          }
        };
        
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
        
        // Parse job using site adapter
        const parseResult = await adapter.parse({ url, html });
        
        if (!parseResult.ok) {
          log.error("Site adapter parsing failed", { 
            site, 
            error: parseResult.error, 
            details: parseResult.details 
          });
          return errorRes(req, "Internal", `Failed to parse ${site} job page: ${parseResult.error}`);
        }
        
        const job = parseResult.job;
        
        log.info("ANALYZE_JOB ok", {
          site: job.site,
          title: job.title,
          company: job.company,
          location: job.location?.raw,
          skillsCount: job.inferredSkills?.length ?? 0,
          descLen: job.descriptionText?.length ?? 0,
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
    
    addHandler("LOG_EVENT", async (req: LogEventReq) => {
      const { level, msg, extra } = req.payload;
      log[level]?.(msg, extra);
      return okRes(req, { recorded: true });
    });

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