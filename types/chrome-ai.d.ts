/* types/chrome-ai.d.ts
   Production-ready ambient types for Chromium Built-in AI (Gemini Nano & friends).
   These are designed to be STRONG but FORGIVING: if Chrome adds fields, nothing breaks.
*/

export {};

declare global {
  /** Global AI entrypoint exposed by Chromium with Built-in AI enabled. */
  const ai: AI | undefined;
  interface Window { ai?: AI }

  // ===== Common =============================================================

  /** Availability state for model families. */
  type AIAvailability = "no" | "readily" | "after-download";

  /** High-level error codes we normalize to (map vendor codes to these if needed). */
  type AIErrorCode =
    | "ModelUnavailable"
    | "DownloadRequired"
    | "PermissionDenied"
    | "Cancelled"
    | "Timeout"
    | "BadInput"
    | "RateLimited"
    | "Internal"
    | "NotSupported";

  /** Error shape thrown/rejected by AI subsystems. */
  interface AIError extends Error {
    name: "AIError";
    code: AIErrorCode;
    cause?: unknown;
    details?: Record<string, unknown>;
  }

  /** Progress callback shape (0–100). */
  type AIDownloadProgress = (percent: number) => void;

  /** Token usage / metadata (if provided by the runtime). */
  interface AITokenUsage {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    [k: string]: unknown;
  }

  /** Safety annotation (if provided). */
  interface AISafetyAnnotation {
    category:
      | "hate"
      | "self-harm"
      | "sexual"
      | "violence"
      | "harassment"
      | "dangerous"
      | string;
    probability?: "low" | "medium" | "high";
    blocked?: boolean;
    [k: string]: unknown;
  }

  // ===== Multimodal message format =========================================

  interface AITextPart { type: "text"; text: string }
  interface AIImagePart {
    type: "image";
    /** Blob, File, or ImageBitmap */
    data: Blob | ImageBitmap | ImageData | ArrayBufferView;
    /** Optional mime (e.g. "image/png") to help decoders. */
    mimeType?: string;
  }
  interface AIAudioPart {
    type: "audio";
    /** AudioBuffer, Blob (wav/mp3), or raw PCM buffer. */
    data: AudioBuffer | Blob | ArrayBuffer | ArrayBufferView;
    mimeType?: string;
    /** Sample rate hint if raw PCM, etc. */
    sampleRateHz?: number;
  }

  type AIContentPart = AITextPart | AIImagePart | AIAudioPart;

  interface AIUserMessage {
    role: "user";
    content: AIContentPart[]; // at least one
  }
  interface AISystemMessage {
    role: "system";
    content: AITextPart[]; // system text only
  }
  interface AIAssistantMessage {
    role: "assistant";
    content: AIContentPart[];
  }
  type AIMessage = AIUserMessage | AISystemMessage | AIAssistantMessage;

  // ===== JSON / Structured output ==========================================

  /** JSON schema-ish descriptor for structured output; permissive. */
  interface AIJsonSchema {
    $schema?: string;
    type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
    properties?: Record<string, AIJsonSchema>;
    items?: AIJsonSchema | AIJsonSchema[];
    required?: string[];
    enum?: (string | number | boolean | null)[];
    description?: string;
    additionalProperties?: boolean | AIJsonSchema;
    [k: string]: unknown;
  }

  // ===== Prompt / Language Model ===========================================

  interface AILanguageModelCapabilities {
    available: AIAvailability;
    /** Bytes to download if available == "after-download" (hint). */
    estimatedDownloadBytes?: number;
    /** Model id/name (e.g., "gemini-nano") if exposed. */
    modelId?: string;
    /** Whether JSON/structured output is supported. */
    structuredOutput?: boolean;
    /** Max input tokens (hint). */
    maxInputTokens?: number;
    /** Max output tokens (hint). */
    maxOutputTokens?: number;
    [k: string]: unknown;
  }

  interface AILanguageModelCreateOptions {
    /** Optional system instructions (applied to the session). */
    systemPrompt?: string;
    /** Optional worker URL for isolation; if supported by the browser. */
    workerUrl?: string;
    /** Called as the on-device model downloads. */
    onDownloadProgress?: AIDownloadProgress;
    /** Whether to prefer on-device strictly; if not, reject rather than fallback. */
    requireOnDevice?: boolean;
    /** Vendor-specific passthrough. */
    vendor?: Record<string, unknown>;
  }

  interface AILanguageModelRequestOptions {
    /** Abortable. */
    signal?: AbortSignal;
    /** Typical decoding controls. */
    temperature?: number;
    topP?: number;
    topK?: number;
    maxTokens?: number;
    /** Number of candidates to return if supported. */
    candidateCount?: number;
    /** Force JSON output; provide a schema to validate/coerce if available. */
    responseMimeType?: "application/json" | "text/plain" | string;
    responseSchema?: AIJsonSchema;
    /** Per-request system override. */
    systemPrompt?: string;
    /** For one-shot calls: download progress callback. */
    onDownloadProgress?: AIDownloadProgress;
    vendor?: Record<string, unknown>;
  }

  interface AICandidate {
    text?: string;                 // Primary text when mime=="text/plain"
    data?: unknown;                // Parsed JSON/object when mime=="application/json"
    finishReason?: "stop" | "length" | "safety" | "other";
    safety?: AISafetyAnnotation[];
    usage?: AITokenUsage;
    meta?: Record<string, unknown>;
  }

  interface AILanguageModelResponse {
    /** If single candidate, convenience accessors: */
    text?: string;
    data?: unknown;
    /** All candidates when candidateCount > 1, or impl returns n-best. */
    candidates: AICandidate[];
    /** Model-id used, etc. */
    modelId?: string;
    usage?: AITokenUsage;
    safety?: AISafetyAnnotation[];
    vendor?: Record<string, unknown>;
  }

  interface AILanguageModelStreamChunk {
    /** Partial text token(s) when streaming text. */
    deltaText?: string;
    /** Partial JSON as string chunks, or structured deltas if supported. */
    deltaJson?: string | unknown;
    /** Final emitted on completion. */
    done?: boolean;
    /** Optional token usage updates. */
    usage?: AITokenUsage;
    safety?: AISafetyAnnotation[];
    vendor?: Record<string, unknown>;
  }

  interface AILanguageModel {
    /** Single-turn prompt with text or multimodal messages. */
    prompt(
      input: string | AIMessage[] | AIContentPart[] ,
      options?: AILanguageModelRequestOptions
    ): Promise<AILanguageModelResponse>;

    /** Streamed generation; async iterator of chunks. */
    stream?(
      input: string | AIMessage[] | AIContentPart[],
      options?: AILanguageModelRequestOptions
    ): AsyncIterable<AILanguageModelStreamChunk>;

    /** If runtime supports “structured output” helpers. */
    promptStructured?<T = unknown>(
      input: string | AIMessage[] | AIContentPart[],
      options: AILanguageModelRequestOptions & { responseMimeType: "application/json"; responseSchema?: AIJsonSchema }
    ): Promise<{ object: T; raw: string; usage?: AITokenUsage; safety?: AISafetyAnnotation[] }>;

    /** Release resources. */
    destroy?(): void | Promise<void>;
  }

  // ===== Summarizer =========================================================

  type AISummarizerType = "generic" | "key-points" | "tldr" | "bullet" | "headline";
  type AISummarizerFormat = "markdown" | "plain";
  type AISummarizerLength = "short" | "medium" | "long";

  interface AISummarizerCapabilities {
    available: AIAvailability;
    modelId?: string;
    maxInputTokens?: number;
    [k: string]: unknown;
  }

  interface AISummarizerCreateOptions {
    type?: AISummarizerType;
    format?: AISummarizerFormat;
    length?: AISummarizerLength;
    onDownloadProgress?: AIDownloadProgress;
    requireOnDevice?: boolean;
    vendor?: Record<string, unknown>;
  }

  interface AISummarizerRequestOptions {
    type?: AISummarizerType;
    format?: AISummarizerFormat;
    length?: AISummarizerLength;
    signal?: AbortSignal;
    onDownloadProgress?: AIDownloadProgress;
    vendor?: Record<string, unknown>;
  }

  interface AISummarizer {
    summarize(input: string, options?: AISummarizerRequestOptions): Promise<string>;
    /** Optional streaming if provided by runtime. */
    stream?(input: string, options?: AISummarizerRequestOptions): AsyncIterable<{ deltaText?: string; done?: boolean }>;
    destroy?(): void | Promise<void>;
  }

  // ===== Translator =========================================================

  interface AITranslatorCapabilities {
    available: AIAvailability;
    modelId?: string;
    [k: string]: unknown;
  }

  interface AITranslatorCreateOptions {
    /** "auto" to let the runtime detect the source language. */
    source?: string | "auto";
    target: string; // BCP-47 / ISO code (e.g., "en", "de")
    onDownloadProgress?: AIDownloadProgress;
    requireOnDevice?: boolean;
    vendor?: Record<string, unknown>;
  }

  interface AITranslator {
    translate(text: string, options?: { signal?: AbortSignal; vendor?: Record<string, unknown> }): Promise<string>;
    stream?(text: string, options?: { signal?: AbortSignal; vendor?: Record<string, unknown> }): AsyncIterable<{ deltaText?: string; done?: boolean }>;
    destroy?(): void | Promise<void>;
  }

  // ===== Proofreader / Writer / Rewriter (ready when you add features) =====

  interface AIProofreaderCapabilities { available: AIAvailability; modelId?: string; [k: string]: unknown }
  interface AIProofreaderCreateOptions { onDownloadProgress?: AIDownloadProgress; requireOnDevice?: boolean; vendor?: Record<string, unknown> }
  interface AIProofreaderSuggestion { start: number; end: number; replacement: string; explanation?: string }
  interface AIProofreader {
    /** Return corrected text plus suggestions. */
    proofread(text: string, options?: { signal?: AbortSignal; level?: "light" | "standard" | "aggressive"; vendor?: Record<string, unknown> }):
      Promise<{ corrected: string; suggestions: AIProofreaderSuggestion[] }>;
    destroy?(): void | Promise<void>;
  }

  interface AIRewriterCapabilities { available: AIAvailability; modelId?: string; [k: string]: unknown }
  interface AIRewriterCreateOptions { tone?: "neutral" | "friendly" | "formal" | "concise" | "descriptive"; onDownloadProgress?: AIDownloadProgress; requireOnDevice?: boolean; vendor?: Record<string, unknown> }
  interface AIRewriter {
    rewrite(text: string, options?: { tone?: "neutral" | "friendly" | "formal" | "concise" | "descriptive"; signal?: AbortSignal; vendor?: Record<string, unknown> }): Promise<string>;
    alternatives?(text: string, count?: number, options?: { tone?: string; signal?: AbortSignal; vendor?: Record<string, unknown> }): Promise<string[]>;
    destroy?(): void | Promise<void>;
  }

  interface AIWriterCapabilities { available: AIAvailability; modelId?: string; [k: string]: unknown }
  interface AIWriterCreateOptions { onDownloadProgress?: AIDownloadProgress; requireOnDevice?: boolean; vendor?: Record<string, unknown> }
  interface AIWriter {
    expand(seed: string, options?: { maxTokens?: number; signal?: AbortSignal; vendor?: Record<string, unknown> }): Promise<string>;
    outline(topic: string, options?: { depth?: 2 | 3 | 4; signal?: AbortSignal; vendor?: Record<string, unknown> }): Promise<string[]>;
    destroy?(): void | Promise<void>;
  }

  // ===== Root AI namespace ==================================================

  interface AI {
    // Prompt / Language model
    languageModel: {
      canCreate(options?: Partial<AILanguageModelCreateOptions>): Promise<AILanguageModelCapabilities>;
      create(options?: Partial<AILanguageModelCreateOptions>): Promise<AILanguageModel>;
    };

    // Summarizer
    summarizer: {
      canCreate(options?: Partial<AISummarizerCreateOptions>): Promise<AISummarizerCapabilities>;
      create(options?: Partial<AISummarizerCreateOptions>): Promise<AISummarizer>;
    };

    // Translator
    translator: {
      canCreate(options: AITranslatorCreateOptions): Promise<AITranslatorCapabilities>;
      create(options: AITranslatorCreateOptions): Promise<AITranslator>;
    };

    // Optional surfaces (guard with feature detection in your code)
    proofreader?: {
      canCreate(options?: Partial<AIProofreaderCreateOptions>): Promise<AIProofreaderCapabilities>;
      create(options?: Partial<AIProofreaderCreateOptions>): Promise<AIProofreader>;
    };

    rewriter?: {
      canCreate(options?: Partial<AIRewriterCreateOptions>): Promise<AIRewriterCapabilities>;
      create(options?: Partial<AIRewriterCreateOptions>): Promise<AIRewriter>;
    };

    writer?: {
      canCreate(options?: Partial<AIWriterCreateOptions>): Promise<AIWriterCapabilities>;
      create(options?: Partial<AIWriterCreateOptions>): Promise<AIWriter>;
    };
  }

  // ===== Type guards you can import via global (handy in TS) ===============

  function isAIError(e: unknown): e is AIError;
  function isAIAvailable(cap: { available?: unknown } | null | undefined): cap is { available: AIAvailability };
}

/* Lightweight runtime type guards (global). Implementations are dummies for TS; at runtime you provide your own if desired. */
declare global {
  // These decls only give TS types; your code can define real implementations if you want.
  // Example usage:
  //   if (isAIError(err) && err.code === "DownloadRequired") { ... }
  function isAIError(e: unknown): e is AIError;
  function isAIAvailable(cap: { available?: unknown } | null | undefined): cap is { available: AIAvailability };
}
