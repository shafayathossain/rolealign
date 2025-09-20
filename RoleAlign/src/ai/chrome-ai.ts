// types/chrome-ai.d.ts
export {};

declare global {
  /** Chrome Prompt API (Gemini Nano) */
  const LanguageModel: {
    availability(): Promise<"available" | "unavailable" | "after-download">;
    create(opts?: {
      monitor?: (m: EventTarget) => void;
    }): Promise<{
      prompt(
        input: string,
        options?: { responseConstraint?: unknown }
      ): Promise<string>;
    }>;
  } | undefined;

  /** Chrome Summarizer API */
  const Summarizer: {
    availability(): Promise<"available" | "unavailable" | "after-download">;
    create(opts?: {
      type?: "generic" | "key-points";
      format?: "plain-text" | "markdown";
      length?: "short" | "medium" | "long";
      monitor?: (m: EventTarget) => void;
    }): Promise<{
      summarize(text: string, options?: { context?: string }): Promise<string>;
    }>;
  } | undefined;

  /** Chrome Translator API */
  const Translator: {
    availability(opts: {
      sourceLanguage: string;
      targetLanguage: string;
    }): Promise<"available" | "unavailable" | "after-download">;
    create(opts: {
      sourceLanguage: string;
      targetLanguage: string;
      monitor?: (m: EventTarget) => void;
    }): Promise<{
      translate(text: string): Promise<string>;
    }>;
  } | undefined;
}


/**
 * Unified wrappers for Chrome on-device AI APIs (Prompt / Summarizer / Translator)
 * with robust logging, availability checks, download progress, timeouts,
 * singleton caching, and safe JSON parsing.
 */

import { Logger } from "../util/logger";

const log = new Logger({ namespace: "ai", level: "debug", persist: false });

export type Availability = "available" | "unavailable" | "after-download";

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
  const fenced = trimmed.replace(/^```json\s*|\s*```$/gim, "");
  try {
    return JSON.parse(fenced);
  } catch (e1) {
    try {
      return JSON.parse(trimmed);
    } catch (e2) {
      log.error("JSON parse failed from model output", { trimmed });
      throw e2;
    }
  }
}

/* ─────────────────────────  PROMPT API  ───────────────────────── */

let promptSessionSingleton:
  | {
      prompt: (
        input: string,
        options?: { responseConstraint?: unknown },
      ) => Promise<string>;
    }
  | null = null;

export interface PromptOptions extends ProgressCallbacks {
  timeoutMs?: number;
}
export interface PromptJsonOptions extends PromptOptions {
  schema: unknown;
}

async function ensurePromptSession(opts?: ProgressCallbacks) {
  if (typeof LanguageModel === "undefined") {
    log.warn("Prompt API global missing (LanguageModel undefined)");
    throw new AIUnavailableError(
      "Prompt API",
      "Update Chrome; ensure built-in AI is available.",
    );
  }
  const availability = await LanguageModel.availability();
  log.debug("Prompt.availability()", { availability });
  if (availability === "unavailable") {
    throw new AIUnavailableError(
      "Prompt API",
      "On-device model unavailable on this device/runtime.",
    );
  }
  if (!promptSessionSingleton) {
    log.info("Creating Prompt session (first use)");
    promptSessionSingleton = await LanguageModel.create({
      monitor: makeMonitor("Prompt", opts?.onDownloadProgress),
    });
    log.info("Prompt session ready");
  } else {
    log.debug("Reusing Prompt session");
  }
  return promptSessionSingleton!;
}

export const Prompt = {
  async text(input: string, opts: PromptOptions = {}): Promise<string> {
    log.debug("Prompt.text()", { len: input.length });
    const session = await ensurePromptSession(opts);
    const p = session.prompt(input);
    try {
      const out = opts.timeoutMs ? await withTimeout(p, opts.timeoutMs, "Prompt.text") : await p;
      log.debug("Prompt.text() ok", { outLen: out?.length ?? 0 });
      return out;
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
    const p = session.prompt(input, { responseConstraint: schema });
    try {
      const out = timeoutMs ? await withTimeout(p, timeoutMs, "Prompt.json") : await p;
      const parsed = cleanJsonFence(out) as T;
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
    education?: string[];
  }>(
    cvRawText: string,
    opts: PromptOptions & { schema?: unknown } = {},
  ): Promise<T> {
    const schema =
      opts.schema ??
      ({
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          skills: { type: "array", items: { type: "string" } },
          experience: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                company: { type: "string" },
                start: { type: "string" },
                end: { type: "string" },
                bullets: { type: "array", items: { type: "string" } },
              },
            },
          },
          education: { type: "array", items: { type: "string" } },
        },
        required: ["skills"],
      } as const);

    log.info("Prompt.extractCv()", { len: cvRawText.length });
    return Prompt.json<T>(
      `Extract a STRICT JSON object with the following fields from this CV (resume).\n` +
        `Return ONLY JSON, no prose.\n\nCV:\n${cvRawText}`,
      { schema, timeoutMs: opts.timeoutMs ?? 30_000, onDownloadProgress: opts.onDownloadProgress },
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
  if (typeof Summarizer === "undefined") {
    log.warn("Summarizer API global missing");
    throw new AIUnavailableError(
      "Summarizer API",
      "Update Chrome; ensure built-in AI is available.",
    );
  }
  const availability = await Summarizer.availability();
  log.debug("Summarizer.availability()", { availability });
  if (availability === "unavailable") {
    throw new AIUnavailableError("Summarizer API", "On-device summarizer unavailable.");
  }
  if (!summarizerSingleton) {
    log.info("Creating Summarizer instance (first use)", {
      type: opts?.type ?? "key-points",
      format: opts?.format ?? "markdown",
      length: opts?.length ?? "short",
    });
    summarizerSingleton = await Summarizer.create({
      type: opts?.type ?? "key-points",
      format: opts?.format ?? "markdown",
      length: opts?.length ?? "short",
      monitor: makeMonitor("Summarizer", opts?.onDownloadProgress),
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
    const p = s.summarize(jobText, {
      context:
        opts.context ??
        "Extract 5–10 MUST-HAVE requirements and core skills for this role as bullet points.",
    });
    try {
      const out = opts.timeoutMs
        ? await withTimeout(p, opts.timeoutMs, "Summarize.jobRequirements")
        : await p;
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
    const p = s.summarize(text, { context: opts.context });
    try {
      const out = opts.timeoutMs ? await withTimeout(p, opts.timeoutMs, "Summarize.text") : await p;
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
  if (typeof Translator === "undefined") {
    log.warn("Translator API global missing");
    throw new AIUnavailableError("Translator API", "Update Chrome to a recent version.");
  }
  const availability = await Translator.availability({ sourceLanguage, targetLanguage });
  log.debug("Translator.availability()", { sourceLanguage, targetLanguage, availability });
  if (availability === "unavailable") {
    throw new AIUnavailableError(
      "Translator API",
      `Model not available for ${sourceLanguage}→${targetLanguage}.`,
    );
  }
  const key = tkey(sourceLanguage, targetLanguage);
  const cached = translatorCache.get(key);
  if (cached) {
    log.debug("Reusing Translator instance", { key });
    return cached;
  }

  log.info("Creating Translator instance", { sourceLanguage, targetLanguage });
  const instance = await Translator.create({
    sourceLanguage,
    targetLanguage,
    monitor: makeMonitor("Translator", opts?.onDownloadProgress),
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
    const p = t.translate(text);
    try {
      const out = opts.timeoutMs ? await withTimeout(p, opts.timeoutMs, "Translate.text") : await p;
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
  async prompt(): Promise<Availability | "api-missing"> {
    if (typeof LanguageModel === "undefined") return "api-missing";
    const a = await LanguageModel.availability();
    log.debug("Availability.prompt()", { availability: a });
    return a;
  },
  async summarizer(): Promise<Availability | "api-missing"> {
    if (typeof Summarizer === "undefined") return "api-missing";
    const a = await Summarizer.availability();
    log.debug("Availability.summarizer()", { availability: a });
    return a;
  },
  async translator(src = "en", dst = "de"): Promise<Availability | "api-missing"> {
    if (typeof Translator === "undefined") return "api-missing";
    const a = await Translator.availability({ sourceLanguage: src, targetLanguage: dst });
    log.debug("Availability.translator()", { src, dst, availability: a });
    return a;
  },
};

/* ───────────────────────────  FACADE  ────────────────────────────── */

export const AI = {
  Prompt,
  Summarize,
  Translate,
  Availability: AvailabilityHelpers,
  detectLanguage,
};
