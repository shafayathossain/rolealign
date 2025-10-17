export {};


/**
 * Unified wrappers for Chrome on-device AI APIs (Prompt / Summarizer / Translator)
 * with robust logging, availability checks, download progress, timeouts,
 * singleton caching, and safe JSON parsing.
 */

import { Logger } from "../util/logger";

const log = new Logger({ namespace: "ai", level: "debug", persist: true });

export type Availability = "readily" | "no" | "after-download";

export interface ProgressEventLike {
  loaded?: number; // 0..1
}
export interface ProgressCallbacks {
  /** Progress percent 0..100 while the model downloads */
  onDownloadProgress?: (percent: number) => void;
}

export class AIUnavailableError extends Error {
  constructor(api: string, hint?: string) {
    super(`[${api}] unavailable. ${hint ?? ""}`.trim());
    this.name = "AIUnavailableError";
  }
}

/* ─────────────────────────  Internals  ───────────────────────── */

function withTimeout<T>(
  p: Promise<T>,
  ms = 30_000,
  label = "AI call",
): Promise<T> {
  let timer: any;
  const timeout = new Promise<T>((_, rej) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms} ms`);
      log.warn(label, "timeout", { ms });
      rej(err);
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

function makeMonitor(name: string, cb?: ProgressCallbacks["onDownloadProgress"]) {
  return (target: EventTarget) => {
    if (!cb) return;
    target.addEventListener("downloadprogress", (e: Event) => {
      const any = e as unknown as ProgressEventLike;
      const pct = Math.max(0, Math.min(100, Math.round((any.loaded ?? 0) * 100)));
      cb(pct);
      // Verbose, but invaluable for first-run UX:
      log.debug(`${name} downloadprogress`, { pct });
    });
  };
}

function cleanJsonFence(s: string) {
  const trimmed = s.trim();
  
  // Remove markdown code fences more aggressively
  let cleaned = trimmed;
  
  // Handle multiline code fences
  cleaned = cleaned.replace(/^```[a-z]*\n?/i, ''); // Remove ```json or ```anything at start
  cleaned = cleaned.replace(/\n?```\s*$/i, ''); // Remove ``` at end
  
  // Remove inline backticks
  cleaned = cleaned.replace(/^`+|`+$/g, '');
  
  // Trim whitespace and newlines
  cleaned = cleaned.trim();
  
  // If it still starts with backticks, remove them
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  
  // Final trim
  cleaned = cleaned.trim();
  
  try {
    return JSON.parse(cleaned);
  } catch (e1) {
    // If that fails, try the original trimmed version
    try {
      return JSON.parse(trimmed);
    } catch (e2) {
      log.error("JSON parse failed from model output", { 
        original: s.substring(0, 200) + "...",
        trimmed: trimmed.substring(0, 200) + "...",
        cleaned: cleaned.substring(0, 200) + "..."
      });
      throw e2;
    }
  }
}

/* ─────────────────────────  PROMPT API  ───────────────────────── */

let promptSessionSingleton: any = null;

export interface PromptOptions extends ProgressCallbacks {
  timeoutMs?: number;
}
export interface PromptJsonOptions extends PromptOptions {
  schema: unknown;
}

async function ensurePromptSession(opts?: ProgressCallbacks) {
  // Use the official LanguageModel API (Chrome 127+)
  if (typeof (globalThis as any).LanguageModel === "undefined") {
    log.warn("Chrome LanguageModel API not available");
    throw new AIUnavailableError(
      "Prompt API",
      "Chrome built-in AI is not available. Enable chrome://flags/#prompt-api-for-gemini-nano",
    );
  }
  
  const LanguageModel = (globalThis as any).LanguageModel;
  const availability = await LanguageModel.availability();
  log.debug("LanguageModel.availability()", { availability });
  
  if (availability === "unavailable") {
    throw new AIUnavailableError(
      "Prompt API",
      "Language model is not available on this device.",
    );
  }
  
  if (!promptSessionSingleton) {
    log.info("Creating Language Model session (first use)");
    
    // Handle downloadable state (requires user activation)
    if (availability === "downloadable") {
      log.info("Model needs download, checking user activation...");
      if (!(globalThis as any).navigator?.userActivation?.isActive) {
        throw new AIUnavailableError(
          "Prompt API", 
          "Model download requires user activation (click, tap, key press)"
        );
      }
    }
    
    promptSessionSingleton = await LanguageModel.create({
      monitor: opts?.onDownloadProgress ? (m: any) => {
        m.addEventListener('downloadprogress', (e: any) => {
          const percent = Math.round(e.loaded * 100);
          opts.onDownloadProgress?.(percent);
        });
      } : undefined,
    });
    log.info("Language Model session ready");
  } else {
    log.debug("Reusing Language Model session");
  }
  return promptSessionSingleton!;
}

function releasePromptSession() {
  if (promptSessionSingleton) {
    log.debug("Releasing Language Model session");
    try {
      // Try to destroy/close the session if methods are available
      if (typeof promptSessionSingleton.destroy === 'function') {
        promptSessionSingleton.destroy();
      } else if (typeof promptSessionSingleton.close === 'function') {
        promptSessionSingleton.close();
      }
    } catch (err) {
      log.warn("Error releasing session", err);
    }
    promptSessionSingleton = null;
    log.debug("Language Model session released");
  }
}

export const Prompt = {
  async text(input: string, opts: PromptOptions = {}): Promise<string> {
    log.debug("Prompt.text()", { len: input.length });
    const session = await ensurePromptSession(opts);
    
    const requestOptions: any = {};
    if (opts.timeoutMs) {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), opts.timeoutMs);
      requestOptions.signal = controller.signal;
    }
    
    try {
      const response = await session.prompt(input, requestOptions);
      const text = response.text || response;
      log.debug("Prompt.text() ok", { outLen: text?.length ?? 0 });
      return text;
    } catch (err) {
      log.error("Prompt.text() failed", err);
      throw err;
    }
  },

  async json<T = unknown>(
    input: string,
    { schema, timeoutMs, onDownloadProgress }: PromptJsonOptions,
  ): Promise<T> {
    log.debug("Prompt.json()", { len: input.length });
    const session = await ensurePromptSession({ onDownloadProgress });
    
    const requestOptions: any = {
      responseMimeType: "application/json",
    };
    
    if (schema) {
      requestOptions.responseSchema = schema;
    }
    
    if (timeoutMs) {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), timeoutMs);
      requestOptions.signal = controller.signal;
    }
    
    try {
      const response = await session.prompt(input, requestOptions);
      const text = response.text || response;
      const parsed = cleanJsonFence(text) as T;
      log.debug("Prompt.json() ok");
      return parsed;
    } catch (err) {
      log.error("Prompt.json() failed", err);
      throw err;
    }
  },

  async extractCv<T = {
    name?: string;
    email?: string;
    phone?: string;
    skills?: string[];
    experience?: Array<{ title?: string; company?: string; start?: string; end?: string; bullets?: string[] }>;
    education?: Array<{ degree?: string; major?: string; university?: string; years?: string }>;
    projects?: Array<{ name?: string; technologies?: string[]; description?: string }>;
  }>(
    cvRawText: string,
    opts: PromptOptions & { schema?: unknown } = {},
  ): Promise<T> {
    const schema =
      opts.schema ??
      ({
        type: "object",
        properties: {
          name: { type: "string", description: "Full name of the person (REQUIRED - must be found)" },
          email: { type: "string", description: "Email address (REQUIRED - look carefully in contact details)" },
          phone: { type: "string", description: "Phone number including country code (REQUIRED - look in contact section)" },
          skills: { 
            type: "array", 
            items: { type: "string" },
            description: "List of technical skills, programming languages, tools, and technologies"
          },
          experience: {
            type: "array",
            description: "Work experience and positions",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Job title or position" },
                company: { type: "string", description: "Company name" },
                start: { type: "string", description: "Start date (e.g., 'January 2020', '2020')" },
                end: { type: "string", description: "End date or 'Present' for current positions" },
                bullets: { 
                  type: "array", 
                  items: { type: "string" },
                  description: "Key responsibilities and achievements"
                },
              },
            },
          },
          education: { 
            type: "array",
            description: "Educational background",
            items: {
              type: "object",
              properties: {
                degree: { type: "string", description: "Degree name (e.g., 'B.Sc in CSE', 'Master of Science')" },
                major: { type: "string", description: "Field of study or major" },
                university: { type: "string", description: "University or institution name" },
                years: { type: "string", description: "Years attended (e.g., '2013-2017', '2020-2022')" },
              },
            },
          },
          projects: {
            type: "array",
            description: "Notable projects or portfolio items",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Project name" },
                technologies: { 
                  type: "array",
                  items: { type: "string" },
                  description: "Technologies used in the project"
                },
                description: { type: "string", description: "Project description including all technical responsibilities and achievements" },
                responsibilities: {
                  type: "array",
                  items: { type: "string" },
                  description: "List of technical responsibilities and achievements for the project"
                }
              },
              required: ["name"]
            },
          },
        },
        required: ["name", "email", "phone", "skills", "experience"],
      } as const);

    log.info("Prompt.extractCv()", { len: cvRawText.length });
    return Prompt.json<T>(
      `You are a CV/resume parsing assistant. Extract ALL information from this CV into a structured JSON format.\n\n` +
        `CRITICAL REQUIREMENTS:\n` +
        `1. CONTACT DETAILS: Find and extract the person's name, email address, and phone number EXACTLY as written\n` +
        `2. WORK EXPERIENCE: Extract ALL job positions with company names, job titles, start/end dates, and responsibilities\n` +
        `3. EDUCATION: Parse degree information including degree name, field of study, university, and years\n` +
        `4. PROJECTS: Find ALL projects with their names, technologies, and FULL descriptions/responsibilities\n` +
        `5. SKILLS: Extract ALL technical skills, programming languages, and tools mentioned ANYWHERE in the CV\n\n` +
        `COMPREHENSIVE SKILL EXTRACTION:\n` +
        `- Extract skills from dedicated skills/technologies sections\n` +
        `- Parse technologies and tools mentioned in project descriptions and responsibilities\n` +
        `- Extract programming languages, frameworks, libraries from work experience responsibilities\n` +
        `- Include tools, platforms, databases, cloud services mentioned throughout\n` +
        `- Capture both explicit skill lists and skills mentioned in context (e.g., "developed using React")\n\n` +
        `PARSING INSTRUCTIONS:\n` +
        `- Look for contact information in headers, footers, or dedicated contact sections\n` +
        `- Employment history may be under "Employment History", "Work Experience", or "Experience"\n` +
        `- Parse ALL job positions, even if they have the same company\n` +
        `- Extract start and end dates in the format shown (e.g., "September 2023 - June 2025")\n` +
        `- For projects: Extract project name, technologies list, and ALL bullet points or descriptions under "Technical Responsibilities"\n` +
        `- Projects may have "Technical Responsibilities" - extract these as either description text or responsibilities array\n` +
        `- For projects technologies field: include both explicit tech lists AND technologies mentioned in descriptions\n\n` +
        `Return ONLY valid JSON following the provided schema. No explanations or prose.\n\n` +
        `CV TEXT TO PARSE:\n${cvRawText}`,
      { schema, timeoutMs: opts.timeoutMs ?? 120_000, onDownloadProgress: opts.onDownloadProgress },
    );
  },
};

/* ────────────────────────  SUMMARIZER API  ─────────────────────── */

type SummarizerInstance = {
  summarize: (text: string, options?: { context?: string }) => Promise<string>;
};
let summarizerSingleton: SummarizerInstance | null = null;

export interface SummarizeOptions extends ProgressCallbacks {
  type?: "key-points" | "generic";
  format?: "markdown" | "plain-text";
  length?: "short" | "medium" | "long";
  context?: string;
  timeoutMs?: number;
}

async function ensureSummarizer(
  opts?: Omit<SummarizeOptions, "context" | "timeoutMs">,
) {
  // Use the official Summarizer API (Chrome 138+)
  if (typeof (globalThis as any).Summarizer === "undefined") {
    log.warn("Chrome Summarizer API not available");
    throw new AIUnavailableError(
      "Summarizer API",
      "Chrome built-in Summarizer is not available. Enable chrome://flags/#summarization-api-for-gemini-nano",
    );
  }
  
  const Summarizer = (globalThis as any).Summarizer;
  const availability = await Summarizer.availability();
  
  log.debug("Summarizer.availability()", { availability });
  
  if (availability === "unavailable") {
    throw new AIUnavailableError("Summarizer API", "Summarizer is not available on this device.");
  }
  
  if (!summarizerSingleton) {
    log.info("Creating Summarizer instance (first use)", {
      type: opts?.type ?? "key-points",
      format: opts?.format ?? "markdown",
      length: opts?.length ?? "short",
    });
    
    // Handle downloadable state (requires user activation)
    if (availability === "downloadable") {
      log.info("Summarizer model needs download, checking user activation...");
      if (!(globalThis as any).navigator?.userActivation?.isActive) {
        throw new AIUnavailableError(
          "Summarizer API", 
          "Model download requires user activation (click, tap, key press)"
        );
      }
    }
    
    summarizerSingleton = await Summarizer.create({
      type: opts?.type ?? "key-points",
      format: opts?.format ?? "markdown",
      length: opts?.length ?? "short",
      monitor: opts?.onDownloadProgress ? (m: any) => {
        m.addEventListener('downloadprogress', (e: any) => {
          const percent = Math.round(e.loaded * 100);
          opts.onDownloadProgress?.(percent);
        });
      } : undefined,
    });
    log.info("Summarizer ready");
  } else {
    log.debug("Reusing Summarizer instance");
  }
  return summarizerSingleton!;
}

export const Summarize = {
  async jobRequirements(jobText: string, opts: SummarizeOptions = {}): Promise<string> {
    log.info("Summarize.jobRequirements()", { len: jobText.length });
    const s = await ensureSummarizer(opts);
    
    const requestOptions: any = {};
    if (opts.timeoutMs) {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), opts.timeoutMs);
      requestOptions.signal = controller.signal;
    }
    
    // Add context as a prefix to the job text for better summarization
    const contextualText = opts.context 
      ? `${opts.context}\n\n${jobText}`
      : `Extract 5–10 MUST-HAVE requirements and core skills for this role as bullet points.\n\n${jobText}`;
    
    try {
      const out = await s.summarize(contextualText, requestOptions);
      log.debug("Summarize.jobRequirements() ok", { outLen: out?.length ?? 0 });
      return out;
    } catch (err) {
      log.error("Summarize.jobRequirements() failed", err);
      throw err;
    }
  },

  async text(text: string, opts: SummarizeOptions = {}): Promise<string> {
    log.debug("Summarize.text()", { len: text.length });
    const s = await ensureSummarizer(opts);
    
    const requestOptions: any = {};
    if (opts.timeoutMs) {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), opts.timeoutMs);
      requestOptions.signal = controller.signal;
    }
    
    try {
      const out = await s.summarize(text, requestOptions);
      log.debug("Summarize.text() ok");
      return out;
    } catch (err) {
      log.error("Summarize.text() failed", err);
      throw err;
    }
  },
};

/* ─────────────────────────  TRANSLATOR API  ─────────────────────── */

type TranslatorInstance = { translate: (text: string) => Promise<string> };
const translatorCache = new Map<string, TranslatorInstance>();

export interface TranslateOptions extends ProgressCallbacks {
  timeoutMs?: number;
}

function tkey(src: string, dst: string) {
  return `${src}→${dst}`;
}

async function ensureTranslator(
  sourceLanguage: string,
  targetLanguage: string,
  opts?: TranslateOptions,
) {
  const ai = (globalThis as any).ai || (typeof window !== "undefined" ? window.ai : undefined);
  
  if (typeof ai?.translator === "undefined") {
    log.warn("Chrome AI Translator API not available");
    throw new AIUnavailableError("Translator API", "Chrome built-in Translator is not available.");
  }
  
  const capabilities = await ai.translator.canCreate({
    source: sourceLanguage,
    target: targetLanguage,
  });
  
  log.debug("Translator.canCreate()", { sourceLanguage, targetLanguage, capabilities });
  
  if (capabilities.available === "no") {
    throw new AIUnavailableError(
      "Translator API",
      `Translation not available for ${sourceLanguage}→${targetLanguage}.`,
    );
  }
  
  const key = tkey(sourceLanguage, targetLanguage);
  const cached = translatorCache.get(key);
  if (cached) {
    log.debug("Reusing Translator instance", { key });
    return cached;
  }

  log.info("Creating Translator instance", { sourceLanguage, targetLanguage });
  const instance = await ai.translator.create({
    source: sourceLanguage,
    target: targetLanguage,
    onDownloadProgress: opts?.onDownloadProgress,
  });
  translatorCache.set(key, instance);
  log.info("Translator ready", { key });
  return instance;
}

export const Translate = {
  async text(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    opts: TranslateOptions = {},
  ): Promise<string> {
    log.debug("Translate.text()", {
      len: text.length,
      sourceLanguage,
      targetLanguage,
    });
    const t = await ensureTranslator(sourceLanguage, targetLanguage, opts);
    
    const requestOptions: any = {};
    if (opts.timeoutMs) {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), opts.timeoutMs);
      requestOptions.signal = controller.signal;
    }
    
    try {
      const out = await t.translate(text, requestOptions);
      log.debug("Translate.text() ok", { outLen: out?.length ?? 0 });
      return out;
    } catch (err) {
      log.error("Translate.text() failed", err);
      throw err;
    }
  },
};

/* ───────────────────────  OPTIONAL: DETECTOR  ────────────────────── */

export async function detectLanguage(text: string): Promise<string | null> {
  // @ts-ignore Only if provided by runtime
  const Detector = (globalThis as any).LanguageDetector as
    | { detect: (t: string) => Promise<{ language: string; confidence: number }> }
    | undefined;

  if (!Detector) {
    log.debug("LanguageDetector not available");
    return null;
  }
  try {
    log.debug("LanguageDetector.detect()", { len: text.length });
    const res = await withTimeout(Detector.detect(text), 5_000, "LanguageDetector.detect");
    log.debug("LanguageDetector.detect() ok", res);
    return res?.language ?? null;
  } catch (err) {
    log.warn("LanguageDetector.detect() failed", err);
    return null;
  }
}

/* ─────────────────────────  AVAIL HELPERS  ───────────────────────── */

export const AvailabilityHelpers = {
  async prompt(): Promise<string> {
    if (typeof (globalThis as any).LanguageModel === "undefined") return "api-missing";
    try {
      const LanguageModel = (globalThis as any).LanguageModel;
      const availability = await LanguageModel.availability();
      log.debug("Availability.prompt()", { availability });
      return availability; // "available", "downloadable", "downloading", "unavailable"
    } catch (e) {
      log.error("Failed to check prompt availability", e);
      return "unavailable";
    }
  },
  async summarizer(): Promise<string> {
    if (typeof (globalThis as any).Summarizer === "undefined") return "api-missing";
    try {
      const Summarizer = (globalThis as any).Summarizer;
      const availability = await Summarizer.availability();
      log.debug("Availability.summarizer()", { availability });
      return availability; // "available", "downloadable", "downloading", "unavailable"
    } catch (e) {
      log.error("Failed to check summarizer availability", e);
      return "unavailable";
    }
  },
  async translator(src = "en", dst = "de"): Promise<Availability | "api-missing"> {
    const ai = (globalThis as any).ai || (typeof window !== "undefined" ? window.ai : undefined);
    if (typeof ai?.translator === "undefined") return "api-missing";
    try {
      const capabilities = await ai.translator.canCreate({ source: src, target: dst });
      log.debug("Availability.translator()", { src, dst, availability: capabilities.available });
      return capabilities.available;
    } catch (e) {
      log.error("Failed to check translator availability", e);
      return "no";
    }
  },
};

/* ───────────────────────────  FACADE  ────────────────────────────── */

export const AI = {
  Prompt,
  Summarize,
  Translate,
  Availability: AvailabilityHelpers,
  detectLanguage,
  releasePromptSession,
};
