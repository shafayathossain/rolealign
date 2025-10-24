/**
 * RoleAlign — Scoring utilities
 *
 * Supports:
 * - Deterministic F1-style score based on skill/term overlap.
 * - AI-assisted score (Prompt API) with strict JSON schema + timeouts.
 * - Blended final score with robust fallbacks.
 */

import { AI } from "../ai/chrome-ai";

// ----------------------------- Types --------------------------------

export type ScoreMethod = "deterministic" | "ai" | "blend";

export interface DeterministicOptions {
  /**
   * Keywords that indicate "must-have" requirements.
   * Terms from lines containing these tokens are weighted higher.
   */
  mustHaveHints?: string[];
  /**
   * Terms to ignore (common words, stopwords, etc.).
   */
  stopwords?: string[];
  /**
   * Extra weight applied to terms detected in "must-have" lines.
   * 1.0 = normal; 2.0 doubles their weight.
   */
  mustHaveWeight?: number;
  /**
   * If true, require exact term equality; if false, allow case-insensitive and
   * basic punctuation-insensitive matching.
   */
  strictTerms?: boolean;
}

export interface AIScoreOptions {
  /**
   * If provided, blend = alpha * AI + (1-alpha) * deterministic.
   * Otherwise returns AI only for method "ai".
   */
  blendAlpha?: number; // 0..1
  /**
   * Timeout for AI call in ms (default 15s)
   */
  timeoutMs?: number;
  /**
   * Download progress callback for on-device model
   */
  onDownloadProgress?: (pct: number) => void;
}

export interface ScoreInput {
  cvSkills: string[];      // normalized list of skills from parsed CV
  jobMarkdown: string;     // requirements summary (markdown) from Summarizer
  /**
   * Optional “evidence” strings from CV (e.g., role titles, bullet points)
   * to help AI judge relevance beyond simple skill name overlap.
   */
  cvEvidence?: string[];
}

export interface ScoreBreakdown {
  method: ScoreMethod;
  score: number;                   // 0..100
  matchedTerms: string[];          // deduplicated, normalized
  missingTerms: string[];          // deduplicated, normalized
  rationale?: string;              // AI explanation if available
  deterministicScore?: number;     // raw deterministic score used/available
  aiScore?: number;                // raw AI score used/available
}

// -------------------------- Deterministic ----------------------------

const DEFAULT_STOPWORDS = new Set<string>([
  "and","or","the","a","an","with","to","in","of","for","on","at","by","as",
  "is","are","be","have","has","will","must","should","preferred","plus","including",
  "experience","experiences","skill","skills","requirement","requirements","responsibility","responsibilities",
  "years","year","+","•","-"
]);

const DEFAULT_MUST_HAVE_HINTS = ["must", "required", "need to", "mandatory"];

function normalizeToken(t: string) {
  return t.toLowerCase().replace(/[^a-z0-9+#.]/g, "").trim();
}

function tokenize(text: string, stopwords = DEFAULT_STOPWORDS, strict = false) {
  if (strict) {
    const raw = text.split(/\s+/g).map((x) => x.trim()).filter(Boolean);
    return raw;
  }
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/g)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !stopwords.has(t));
  return tokens;
}

/**
 * Deterministic F1-style scoring with optional "must-have" weighting.
 */
export function scoreDeterministic(
  { cvSkills, jobMarkdown }: ScoreInput,
  opts: DeterministicOptions = {}
): ScoreBreakdown {
  const stop = new Set([...(opts.stopwords ?? []), ...DEFAULT_STOPWORDS]);
  const strict = !!opts.strictTerms;
  const mustHints = (opts.mustHaveHints ?? DEFAULT_MUST_HAVE_HINTS).map((h) => h.toLowerCase());
  const mustW = Math.max(1, opts.mustHaveWeight ?? 2);

  const cv = new Set(
    (strict ? cvSkills : cvSkills.map(normalizeToken))
      .filter(Boolean)
  );

  // Extract terms from job markdown; apply extra weight to lines with must-have hints.
  const lineWeights: number[] = [];
  const lines = jobMarkdown.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const lineTerms: string[][] = lines.map((l, i) => {
    const isMust = mustHints.some((h) => l.toLowerCase().includes(h));
    lineWeights[i] = isMust ? mustW : 1;
    return strict ? tokenize(l, new Set(), true) : tokenize(l, stop, false).map(normalizeToken);
  });

  // Weighted unique term universe
  const termWeight = new Map<string, number>();
  lineTerms.forEach((terms, i) => {
    const w = lineWeights[i];
    for (const t of new Set(terms)) {
      if (!t) continue;
      termWeight.set(t, (termWeight.get(t) ?? 0) + w);
    }
  });

  // Compute weighted hits
  let hitWeight = 0;
  let totalWeight = 0;
  const matched: string[] = [];
  const missing: string[] = [];

  for (const [t, w] of termWeight.entries()) {
    totalWeight += w;
    if (cv.has(t)) {
      hitWeight += w;
      matched.push(t);
    } else {
      missing.push(t);
    }
  }

  // Precision = matched / cv.size (approximate by unique CV tokens)
  const precision = matched.length / Math.max(1, cv.size);
  // Recall = hitWeight / totalWeight (weighted recall to reward must-haves)
  const recall = hitWeight / Math.max(1, totalWeight);
  const f1 = (2 * precision * recall) / Math.max(precision + recall, 1e-9);
  const score = Math.round(f1 * 100);

  return {
    method: "deterministic",
    score,
    matchedTerms: matched.sort(),
    missingTerms: missing.sort(),
    deterministicScore: score,
  };
}

// ---------------------------- AI-assisted ----------------------------

const AI_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number", minimum: 0, maximum: 100 },
    matched_terms: { type: "array", items: { type: "string" } },
    missing_terms: { type: "array", items: { type: "string" } },
    rationale: { type: "string" },
  },
  required: ["score", "matched_terms", "missing_terms"],
} as const;

export async function scoreAI(
  { cvSkills, jobMarkdown, cvEvidence }: ScoreInput,
  opts: AIScoreOptions = {}
): Promise<ScoreBreakdown> {
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const prompt =
    `You are evaluating how well a candidate's CV matches a job description.\n` +
    `Return STRICT JSON matching this schema: {score: 0..100, matched_terms: string[], missing_terms: string[], rationale: string}.\n\n` +
    `CRITICAL RULES:\n` +
    `- ONLY include skills/technologies explicitly mentioned in the job description\n` +
    `- DO NOT add skills that are not directly stated in the job requirements\n` +
    `- DO NOT infer or assume additional technologies based on company type or industry\n` +
    `- Match skills semantically (e.g., "Git" matches "GitHub", "React Native" matches "React Native")\n` +
    `- Be precise with skill names (e.g., "Java" ≠ "JavaScript", "scalable" ≠ "Scala")\n\n` +
    `Scoring guidance:\n` +
    `- Consider exact and synonymous skill matches from job description only\n` +
    `- Heavily weight MUST-HAVE requirements from the job posting\n` +
    `- Penalize missing critical skills explicitly listed in job requirements\n` +
    `- 100 means perfect fit; 0 means irrelevant\n\n` +
    `Job requirements (markdown):\n${jobMarkdown}\n\n` +
    `CV skills (list):\n${cvSkills.join(", ")}\n\n` +
    (cvEvidence?.length
      ? `CV evidence (bullets/roles):\n${cvEvidence.slice(0, 50).join("\n")}\n\n`
      : ``) +
    `Return ONLY JSON with skills mentioned in the job description.`;

  const out = await AI.Prompt.json<{
    score: number;
    matched_terms: string[];
    missing_terms: string[];
    rationale?: string;
  }>(prompt, {
    schema: AI_SCHEMA,
    onDownloadProgress: opts.onDownloadProgress,
    timeoutMs,
  });

  // Clamp & sanitize
  const score = Math.max(0, Math.min(100, Math.round(out.score)));
  const matchedTerms = Array.from(new Set((out.matched_terms ?? []).map((s) => s.toLowerCase().trim()))).filter(Boolean);
  const missingTerms = Array.from(new Set((out.missing_terms ?? []).map((s) => s.toLowerCase().trim()))).filter(Boolean);

  return {
    method: "ai",
    score,
    matchedTerms,
    missingTerms,
    rationale: out.rationale,
    aiScore: score,
  };
}

// ----------------------------- Blended ------------------------------

export interface ScoreOptions extends DeterministicOptions, AIScoreOptions {
  method?: ScoreMethod;
}

/**
 * Compute score via:
 * - "deterministic": F1-style only
 * - "ai": Prompt API only (falls back to deterministic if AI unavailable)
 * - "blend": weighted average of AI and deterministic (alpha = AI weight)
 */
export async function computeScore(
  input: ScoreInput,
  options: ScoreOptions = {}
): Promise<ScoreBreakdown> {
  const method = options.method ?? "blend";

  // Always compute deterministic (cheap & transparent)
  const det = scoreDeterministic(input, options);

  if (method === "deterministic") {
    return det;
  }

  try {
    const ai = await scoreAI(input, options);
    if (method === "ai") {
      return { ...ai, deterministicScore: det.score };
    }
    // blend
    const alpha = Math.max(0, Math.min(1, options.blendAlpha ?? 0.6));
    const blended = Math.round(alpha * ai.score + (1 - alpha) * det.score);
    return {
      method: "blend",
      score: blended,
      matchedTerms: Array.from(new Set([...det.matchedTerms, ...ai.matchedTerms])).sort(),
      missingTerms: Array.from(new Set([...det.missingTerms, ...ai.missingTerms])).sort(),
      rationale: ai.rationale,
      deterministicScore: det.score,
      aiScore: ai.score,
    };
  } catch (e) {
    // If AI is unavailable or times out, fall back gracefully.
    return { ...det, method: method === "ai" ? "deterministic" : "blend" };
  }
}
