/* src/ai/typesafe.ts
   Runtime helpers for Chrome Built-in AI:
   - presence & availability checks
   - download gating with progress
   - timeouts, aborts, retries
   - structured JSON prompting
   - streaming aggregation
   - normalized AIError
*/

import { Logger } from "../util/logger";

// ---------- Types & Config ----------

export interface DownloadOpts {
  onDownloadProgress?: (percent: number) => void;
}

export interface CreateOptsBase extends DownloadOpts {
  /** If true, we never fallback to server/undefined — reject instead. */
  requireOnDevice?: boolean;
  /** Overall timeout (ms) for create+download. */
  timeoutMs?: number;
  /** Abort signal for create+download. */
  signal?: AbortSignal;
}

export interface RetryOpts {
  retries?: number;          // default 0
  baseDelayMs?: number;      // default 250
  maxDelayMs?: number;       // default 5_000
  jitter?: boolean;          // default true
}

export interface PromptOpts extends DownloadOpts {
  signal?: AbortSignal;
  timeoutMs?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  candidateCount?: number;
  responseMimeType?: string;
  responseSchema?: AIJsonSchema;
  systemPrompt?: string;
  vendor?: Record<string, unknown>;
}

export interface StreamCollectResult {
  text: string;
  usage?: AITokenUsage;
  safety?: AISafetyAnnotation[];
  modelId?: string | undefined;
}

export type Loggable = Pick<Logger, "info" | "warn" | "error" | "debug"> | Console;

// ---------- Error Normalization ----------

export function normalizeError(e: unknown, note?: string): AIError {
  const base: AIError = {
    name: "AIError",
    message: (e as any)?.message ?? String(e),
    code: "Internal",
  };

  const msg = (e as any)?.message ?? "";
  const name = (e as any)?.name ?? "";

  if (note) base.message = `${note}: ${base.message}`;

  if (name === "AbortError") {
    base.code = "Cancelled";
  } else if (/timed? ?out/i.test(msg)) {
    base.code = "Timeout";
  } else if (/permission/i.test(msg) || name === "NotAllowedError") {
    base.code = "PermissionDenied";
  } else if (/rate/i.test(msg)) {
    base.code = "RateLimited";
  } else if (/download/i.test(msg)) {
    base.code = "DownloadRequired";
  } else if (/not\s*support|unsupported|unavailable/i.test(msg)) {
    base.code = "NotSupported";
  }

  (base as any).details = (e as any)?.details ?? undefined;
  return base;
}

// ---------- Core Utils (timeout, abort, retry) ----------

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
  tag = "operation",
): Promise<T> {
  if (!ms) return promise;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const to = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(normalizeError(new Error(`${tag} timed out after ${ms}ms`), "Timeout"));
      }
    }, ms);

    const abortHandler = () => {
      if (!settled) {
        settled = true;
        clearTimeout(to);
        reject(normalizeError(new DOMException("Aborted", "AbortError"), "Aborted"));
      }
    };
    signal?.addEventListener("abort", abortHandler, { once: true });

    promise
      .then((v) => {
        if (!settled) {
          settled = true;
          clearTimeout(to);
          signal?.removeEventListener("abort", abortHandler);
          resolve(v);
        }
      })
      .catch((e) => {
        if (!settled) {
          settled = true;
          clearTimeout(to);
          signal?.removeEventListener("abort", abortHandler);
          reject(normalizeError(e));
        }
      });
  });
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  { retries = 0, baseDelayMs = 250, maxDelayMs = 5_000, jitter = true }: RetryOpts = {},
  signal?: AbortSignal,
  log?: Loggable,
): Promise<T> {
  let attempt = 0;
  let lastErr: unknown;

  while (attempt <= retries) {
    if (signal?.aborted) throw normalizeError(new DOMException("Aborted", "AbortError"));

    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      const err = normalizeError(e);
      const isRetryable =
        err.code === "RateLimited" ||
        err.code === "Internal" ||
        err.code === "DownloadRequired" ||
        err.code === "Timeout";

      if (!isRetryable || attempt === retries) {
        throw err;
      }
      const expo = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      const delay = jitter ? Math.floor(expo * (0.5 + Math.random() * 0.75)) : expo;
      log?.warn?.(`[AI] retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`, err);

      await new Promise<void>((r) => {
        const id = setTimeout(() => r(), delay);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(id);
            r();
          },
          { once: true },
        );
      });

      attempt++;
    }
  }
  // Should never reach here
  throw normalizeError(lastErr ?? new Error("Unknown error"));
}

// ---------- Availability & Create helpers ----------

export function assertAIAvailable(): AI {
  if (!globalThis.ai) throw normalizeError(new Error("Chrome Built-in AI not available in this context"), "NotSupported");
  return globalThis.ai!;
}

async function ensureCapability<T extends { available: AIAvailability }>(
  canCreate: (opts?: any) => Promise<T>,
  opts?: any,
  cfg?: CreateOptsBase,
): Promise<T> {
  const cap = await withTimeout(canCreate(opts), cfg?.timeoutMs ?? 0, cfg?.signal, "canCreate");
  if (cap.available === "no") {
    if (cfg?.requireOnDevice) throw normalizeError(new Error("Model not available on device"), "ModelUnavailable");
  }
  return cap;
}

/**
 * If available === "after-download", attempt to create the session
 * so the runtime can download the on-device model. We then return the session.
 */
async function createWithDownload<T>(
  create: (opts?: any) => Promise<T & { destroy?: () => void | Promise<void> }>,
  opts?: any,
  cfg?: CreateOptsBase,
): Promise<T> {
  const session = await withTimeout(create({ ...opts, onDownloadProgress: cfg?.onDownloadProgress }), cfg?.timeoutMs ?? 0, cfg?.signal, "create");
  return session;
}

/** Language model session safe-creator (capability gate + optional download). */
export async function createLanguageModelSafe(
  opts?: Partial<AILanguageModelCreateOptions>,
  cfg?: CreateOptsBase,
): Promise<AILanguageModel> {
  const ai = assertAIAvailable();
  await ensureCapability(ai.languageModel.canCreate, opts, cfg);
  return await createWithDownload(ai.languageModel.create, opts, cfg);
}

/** Summarizer session safe-creator (capability gate + optional download). */
export async function createSummarizerSafe(
  opts?: Partial<AISummarizerCreateOptions>,
  cfg?: CreateOptsBase,
): Promise<AISummarizer> {
  const ai = assertAIAvailable();
  await ensureCapability(ai.summarizer.canCreate, opts, cfg);
  return await createWithDownload(ai.summarizer.create, opts, cfg);
}

/** Translator session safe-creator (capability gate + optional download). */
export async function createTranslatorSafe(
  opts: AITranslatorCreateOptions,
  cfg?: CreateOptsBase,
): Promise<AITranslator> {
  const ai = assertAIAvailable();
  await ensureCapability(ai.translator.canCreate, opts, cfg);
  return await createWithDownload(ai.translator.create, opts, cfg);
}

// ---------- Prompting helpers (text, JSON, streaming) ----------

/** Attempt to JSON.parse, falling back with good error messaging. */
export function parseJsonSafe<T = unknown>(raw: string): { ok: true; value: T } | { ok: false; error: AIError } {
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch (e) {
    return { ok: false, error: normalizeError(e, "Invalid JSON") };
  }
}

/** Ultra-light schema validator (recursive subset) */
export function validateAgainstSchema(value: unknown, schema?: AIJsonSchema): { ok: true } | { ok: false; reason: string } {
  if (!schema) return { ok: true };
  try {
    const ok = validateSchemaInner(value, schema);
    return ok ? { ok: true } : { ok: false, reason: "Schema validation failed" };
  } catch (e) {
    return { ok: false, reason: (e as any)?.message ?? String(e) };
  }
}

function validateSchemaInner(value: any, schema: AIJsonSchema): boolean {
  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in value)) return false;
      }
    }
    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in value && !validateSchemaInner(value[k], sub)) return false;
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const k of Object.keys(value)) if (!allowed.has(k)) return false;
    }
    return true;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    if (Array.isArray(schema.items)) {
      // tuple-style: enforce length and each item
      if (value.length < schema.items.length) return false;
      for (let i = 0; i < schema.items.length; i++) {
        if (!validateSchemaInner(value[i], schema.items[i])) return false;
      }
      return true;
    }
    if (schema.items) {
      return value.every((el) => validateSchemaInner(el, schema.items as AIJsonSchema));
    }
    return true;
  }

  if (schema.type === "string") return typeof value === "string";
  if (schema.type === "number" || schema.type === "integer") return typeof value === "number";
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "null") return value === null;

  // If no type specified, accept anything
  return true;
}

/** Single-turn text generation (returns best candidate text). */
export async function promptText(
  model: AILanguageModel,
  input: string | AIMessage[] | AIContentPart[],
  opts?: PromptOpts,
): Promise<AILanguageModelResponse> {
  const res = await withTimeout(
    model.prompt(input, opts),
    opts?.timeoutMs ?? 0,
    opts?.signal,
    "prompt",
  );
  return res;
}

/** Structured output with JSON schema (safe parse + schema check). */
export async function promptJson<T = unknown>(
  model: AILanguageModel,
  input: string | AIMessage[] | AIContentPart[],
  schema?: AIJsonSchema,
  opts?: PromptOpts,
  log?: Loggable,
): Promise<{ object: T; raw: string; usage?: AITokenUsage; safety?: AISafetyAnnotation[] }> {
  const res = await withTimeout(
    model.prompt(input, {
      ...(opts ?? {}),
      responseMimeType: "application/json",
      responseSchema: schema,
    }),
    opts?.timeoutMs ?? 0,
    opts?.signal,
    "prompt(json)",
  );

  const raw = (res.data && typeof res.data === "string") ? (res.data as string)
           : (typeof res.text === "string" ? res.text : JSON.stringify(res.data ?? res.candidates?.[0]?.data ?? res.candidates?.[0]?.text ?? ""));

  const parsed = typeof res.data !== "undefined" && typeof res.data !== "string"
    ? { ok: true as const, value: res.data as T }
    : parseJsonSafe<T>(raw);

  if (!parsed.ok) {
    log?.warn?.("[AI] JSON parse failed; returning raw text", parsed.error);
    throw parsed.error;
  }

  const valid = validateAgainstSchema(parsed.value, schema);
  if (!valid.ok) {
    log?.warn?.("[AI] JSON schema validation failed", valid.reason);
    // Depending on policy, either throw or return the parsed anyway; we throw:
    throw normalizeError(new Error(valid.reason), "BadInput");
  }

  return { object: parsed.value, raw, usage: res.usage, safety: res.safety };
}

/** Collect a streaming response into a single string. */
export async function streamCollectText(
  model: AILanguageModel,
  input: string | AIMessage[] | AIContentPart[],
  opts?: PromptOpts,
): Promise<StreamCollectResult> {
  if (!model.stream) {
    const res = await promptText(model, input, opts);
    return {
      text: res.text ?? res.candidates?.[0]?.text ?? "",
      usage: res.usage,
      safety: res.safety,
      modelId: res.modelId,
    };
  }

  const chunks: string[] = [];
  let usage: AITokenUsage | undefined;
  let safety: AISafetyAnnotation[] | undefined;

  const it = model.stream(input, opts)!;
  const timeoutMs = opts?.timeoutMs ?? 0;
  const signal = opts?.signal;

  const consume = async () => {
    for await (const ch of it) {
      if (typeof ch.deltaText === "string") chunks.push(ch.deltaText);
      if (ch.usage) usage = ch.usage;
      if (ch.safety) safety = ch.safety;
    }
  };

  await withTimeout(consume(), timeoutMs, signal, "stream");
  return { text: chunks.join(""), usage, safety };
}

// ---------- High-level convenience wrappers ----------

/**
 * One-shot text generation:
 *  - ensures model availability & download
 *  - handles retries/timeouts/abort
 */
export async function oneShotText(
  input: string | AIMessage[] | AIContentPart[],
  createOpts?: Partial<AILanguageModelCreateOptions>,
  runOpts?: PromptOpts,
  retryOpts?: RetryOpts,
  log?: Loggable,
): Promise<string> {
  const session = await retry(
    async () => createLanguageModelSafe(createOpts, { timeoutMs: createOpts?.onDownloadProgress ? undefined : runOpts?.timeoutMs }),
    retryOpts,
    runOpts?.signal,
    log,
  );

  try {
    const res = await promptText(session, input, runOpts);
    return res.text ?? res.candidates?.[0]?.text ?? "";
  } finally {
    await session.destroy?.();
  }
}

/**
 * One-shot JSON (structured) generation, with schema validation.
 */
export async function oneShotJson<T = unknown>(
  input: string | AIMessage[] | AIContentPart[],
  schema?: AIJsonSchema,
  createOpts?: Partial<AILanguageModelCreateOptions>,
  runOpts?: PromptOpts,
  retryOpts?: RetryOpts,
  log?: Loggable,
): Promise<T> {
  const session = await retry(
    async () => createLanguageModelSafe(createOpts, { timeoutMs: createOpts?.onDownloadProgress ? undefined : runOpts?.timeoutMs }),
    retryOpts,
    runOpts?.signal,
    log,
  );

  try {
    const { object } = await promptJson<T>(session, input, schema, runOpts, log);
    return object;
  } finally {
    await session.destroy?.();
  }
}

/**
 * One-shot summarization; ensures availability & download.
 */
export async function oneShotSummarize(
  input: string,
  createOpts?: Partial<AISummarizerCreateOptions>,
  runOpts?: AISummarizerRequestOptions & { timeoutMs?: number },
  retryOpts?: RetryOpts,
  log?: Loggable,
): Promise<string> {
  const session = await retry(
    async () => createSummarizerSafe(createOpts, { onDownloadProgress: createOpts?.onDownloadProgress, timeoutMs: runOpts?.timeoutMs }),
    retryOpts,
    runOpts?.signal as any,
    log,
  );

  try {
    const out = await withTimeout(session.summarize(input, runOpts), runOpts?.timeoutMs ?? 0, runOpts?.signal as any, "summarize");
    return out;
  } finally {
    await session.destroy?.();
  }
}

/**
 * One-shot translation; ensures availability & download.
 */
export async function oneShotTranslate(
  text: string,
  createOpts: AITranslatorCreateOptions,
  runOpts?: { signal?: AbortSignal; timeoutMs?: number },
  retryOpts?: RetryOpts,
  log?: Loggable,
): Promise<string> {
  const session = await retry(
    async () => createTranslatorSafe(createOpts, { onDownloadProgress: createOpts?.onDownloadProgress, timeoutMs: runOpts?.timeoutMs }),
    retryOpts,
    runOpts?.signal,
    log,
  );

  try {
    const out = await withTimeout(session.translate(text, { signal: runOpts?.signal }), runOpts?.timeoutMs ?? 0, runOpts?.signal, "translate");
    return out;
  } finally {
    await session.destroy?.();
  }
}
