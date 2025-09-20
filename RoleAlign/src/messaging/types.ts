/* src/messaging/types.ts
   Typed contracts for RoleAlign extension messaging.
   Keep this file dependency-free to avoid circular imports.
*/

export const PROTOCOL_VERSION = 1 as const;

/** All logical endpoints in the extension. */
export type Port =
  | "background"
  | "content"     // content script in a tab
  | "popup";      // action popup

/** Common envelope every message carries. */
export interface Envelope {
  v: typeof PROTOCOL_VERSION;
  /** Unique string so responses can match requests. */
  id: string;
  /** Who is sending the message. */
  from: Port;
  /** Who should receive the message (logical). */
  to?: Port;
  /** Optional tab context (used when talking to a content script). */
  tabId?: number;
  /** For streaming pieces (progress, partials, etc.). */
  stream?: boolean;
  /** Optional correlation subgroup for multi-part streams. */
  streamGroup?: string;
}

/** Request/Response discriminators */
export type Kind =
  | "PING"
  | "GET_VERSION"
  | "EXTRACT_CV"
  | "SAVE_CV"
  | "GET_CV"
  | "ANALYZE_JOB"         // parse job page → normalized job data
  | "SCORE_MATCH"         // CV + job → numeric score/diagnostics
  | "GENERATE_TAILORED_CV"
  | "LOG_EVENT";

/** Base request with discriminated union. */
export interface BaseReq<K extends Kind, P> extends Envelope {
  type: K;
  payload: P;
}

/** Base success response. Errors use ErrorRes. */
export interface BaseRes<K extends Kind, R> extends Envelope {
  type: `${K}:RES`;
  ok: true;
  result: R;
}

/** Standard error shape */
export interface ErrorRes<K extends Kind> extends Envelope {
  type: `${K}:RES`;
  ok: false;
  error: {
    code:
      | "BadRequest"
      | "NotFound"
      | "Timeout"
      | "Internal"
      | "Unavailable"
      | "PermissionDenied";
    message: string;
    details?: unknown;
  };
}

/* ================= Specific payloads ================= */

export type PingReq = BaseReq<"PING", { t: number }>;
export type PingRes = BaseRes<"PING", { pong: number }>;

export type GetVersionReq = BaseReq<"GET_VERSION", {}>;
export type GetVersionRes = BaseRes<"GET_VERSION", { version: string }>;

export type ExtractCvReq = BaseReq<"EXTRACT_CV", { raw: string }>;
export type ExtractCvRes = BaseRes<"EXTRACT_CV", { cv: unknown }>;

export type SaveCvReq = BaseReq<"SAVE_CV", { cv: unknown }>;
export type SaveCvRes = BaseRes<"SAVE_CV", { saved: true }>;

export type GetCvReq = BaseReq<"GET_CV", {}>;
export type GetCvRes = BaseRes<"GET_CV", { cv: unknown | null }>;

export type AnalyzeJobReq = BaseReq<
  "ANALYZE_JOB",
  { url: string; html?: string; site: "linkedin" | "indeed" }
>;
export type AnalyzeJobRes = BaseRes<"ANALYZE_JOB", { job: unknown }>;

export type ScoreMatchReq = BaseReq<
  "SCORE_MATCH",
  { cv: unknown; job: unknown; useAI?: boolean }
>;
export type ScoreMatchRes = BaseRes<
  "SCORE_MATCH",
  { score: number; reasons: string[]; facets?: Record<string, number> }
>;

export type GenerateTailoredCvReq = BaseReq<
  "GENERATE_TAILORED_CV",
  { cv: unknown; job: unknown; targetFormat?: "markdown" | "plain-text" }
>;
export type GenerateTailoredCvRes = BaseRes<
  "GENERATE_TAILORED_CV",
  { text: string; downloadName?: string }
>;

export type LogEventReq = BaseReq<
  "LOG_EVENT",
  { level: "debug" | "info" | "warn" | "error"; msg: string; extra?: unknown }
>;
export type LogEventRes = BaseRes<"LOG_EVENT", { recorded: true }>;

/** Union of all requests the bus can send. */
export type AnyReq =
  | PingReq
  | GetVersionReq
  | ExtractCvReq
  | SaveCvReq
  | GetCvReq
  | AnalyzeJobReq
  | ScoreMatchReq
  | GenerateTailoredCvReq
  | LogEventReq;

/** Union of all responses (success or error). */
export type AnyRes =
  | PingRes
  | GetVersionRes
  | ExtractCvRes
  | SaveCvRes
  | GetCvRes
  | AnalyzeJobRes
  | ScoreMatchRes
  | GenerateTailoredCvRes
  | LogEventRes
  | ErrorRes<Kind>;

/** Helper to map request → response */
export type ResFor<K extends Kind> = Extract<AnyRes, { type: `${K}:RES` }>;
