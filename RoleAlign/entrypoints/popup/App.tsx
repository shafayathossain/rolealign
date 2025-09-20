import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { send } from "../../src/messaging/bus";
import type {
  AnalyzeJobRes,
  GetCvRes,
  ScoreMatchRes,
} from "../../src/messaging/types";
import { Logger } from "../../src/util/logger";

const log = new Logger({ namespace: "popup", level: "info", persist: false });

type JobSite = "linkedin" | "indeed" | "unknown";

function detectSite(url?: string): JobSite {
  if (!url) return "unknown";
  const u = url.toLowerCase();
  if (u.includes("linkedin.com")) return "linkedin";
  if (u.includes("indeed.com")) return "indeed";
  return "unknown";
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs?.[0] ?? null;
  } catch (e) {
    log.error("getActiveTab failed", e);
    return null;
  }
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [cvRaw, setCvRaw] = useState("");
  const [cvParsed, setCvParsed] = useState<any | null>(null);
  const [job, setJob] = useState<AnalyzeJobRes["result"]["job"] | null>(null);
  const [score, setScore] = useState<ScoreMatchRes["result"] | null>(null);
  const [tailored, setTailored] = useState<string>("");

  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<string>("");

  const [useAI, setUseAI] = useState(true);
  const [activeUrl, setActiveUrl] = useState<string>("");

  const mounted = useRef(true);
  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  const site = useMemo(() => detectSite(activeUrl), [activeUrl]);

  // Load any stored CV on open (optional, fast path)
  useEffect(() => {
    (async () => {
      try {
        const res = await send("popup", "GET_CV", {}, { timeoutMs: 4000 });
        const data = (res as GetCvRes).result.cv;
        if (data) {
          setCvParsed(data);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  // Track active tab URL
  useEffect(() => {
    (async () => {
      const tab = await getActiveTab();
      setActiveUrl(tab?.url ?? "");
    })();
  }, []);

  const onExtract = useCallback(async () => {
    setError("");
    setBusy("Extracting CV…");
    setScore(null);
    setTailored("");
    try {
      if (!cvRaw.trim()) {
        throw new Error("Please paste your CV text first.");
      }
      const res = await send("popup", "EXTRACT_CV", { raw: cvRaw }, { timeoutMs: 30_000 });
      setCvParsed(res.cv);
      await send("popup", "SAVE_CV", { cv: res.cv }, { timeoutMs: 5000 });
    } catch (e: any) {
      setError(e?.message ?? "Failed to extract CV.");
    } finally {
      setBusy("");
    }
  }, [cvRaw]);

  const onAnalyze = useCallback(async () => {
    setError("");
    setBusy("Analyzing job page…");
    setJob(null);
    setScore(null);
    setTailored("");
    try {
      const tab = await getActiveTab();
      if (!tab?.id) throw new Error("No active tab found.");
      const url = tab.url ?? "";
      const site = detectSite(url);
      if (site === "unknown") {
        log.warn("Unknown site; proceeding with generic parsing");
      }
      const res = await send(
        "popup",
        "ANALYZE_JOB",
        { url, site },
        { timeoutMs: 20_000, tabId: tab.id }, // tabId lets background capture HTML
      );
      setJob(res.job);
    } catch (e: any) {
      setError(e?.message ?? "Failed to analyze job page.");
    } finally {
      setBusy("");
    }
  }, []);

  const onScore = useCallback(async () => {
    setError("");
    setBusy("Scoring match…");
    setScore(null);
    setTailored("");
    try {
      if (!cvParsed) throw new Error("No parsed CV. Extract your CV first.");
      if (!job) throw new Error("No job data. Analyze a job page first.");

      const tab = await getActiveTab();
      const res = await send(
        "popup",
        "SCORE_MATCH",
        {
          cv: cvParsed,
          job,
          useAI,
        },
        { timeoutMs: useAI ? 18_000 : 8_000, tabId: tab?.id },
      );
      setScore(res);
    } catch (e: any) {
      setError(e?.message ?? "Failed to compute score.");
    } finally {
      setBusy("");
    }
  }, [cvParsed, job, useAI]);

  const onTailor = useCallback(async () => {
    setError("");
    setBusy("Generating tailored CV…");
    setTailored("");
    try {
      if (!cvParsed) throw new Error("No parsed CV. Extract your CV first.");
      if (!job) throw new Error("No job data. Analyze a job page first.");
      const res = await send(
        "popup",
        "GENERATE_TAILORED_CV",
        { cv: cvParsed, job, targetFormat: "markdown" },
        { timeoutMs: 35_000 },
      );
      setTailored(res.text);
    } catch (e: any) {
      setError(e?.message ?? "Failed to generate tailored CV.");
    } finally {
      setBusy("");
    }
  }, [cvParsed, job]);

  const onDownload = useCallback(() => {
    if (!tailored) return;
    downloadText("RoleAlign-CV.md", tailored);
  }, [tailored]);

  const matchedCount = score?.facets
    ? Object.keys(score.facets).filter((k) => k.startsWith("match:")).length
    : 0;
  const missingCount = score?.facets
    ? Object.keys(score.facets).filter((k) => k.startsWith("miss:")).length
    : 0;

  return (
    <div className="popup-root" style={{ width: 360, padding: 12 }}>
      <header style={{ marginBottom: 8 }}>
        <h1 style={{ fontSize: 16, margin: 0 }}>RoleAlign</h1>
        <small style={{ color: "#666" }}>
          {activeUrl ? `Active: ${new URL(activeUrl).hostname}` : "Active tab unknown"}
        </small>
      </header>

      {/* CV Input */}
      <section style={{ marginBottom: 10 }}>
        <label style={{ fontWeight: 600, display: "block", marginBottom: 6 }}>
          Paste your CV (plain text)
        </label>
        <textarea
          value={cvRaw}
          onChange={(e) => setCvRaw(e.target.value)}
          rows={6}
          placeholder="Paste resume/CV text here…"
          style={{ width: "100%", resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button onClick={onExtract} disabled={!cvRaw.trim() || !!busy}>
            Extract & Save
          </button>
          <button
            onClick={async () => {
              setError("");
              setBusy("Loading saved CV…");
              try {
                const res = await send("popup", "GET_CV", {}, { timeoutMs: 4000 });
                setCvParsed(res.cv ?? null);
              } catch (e: any) {
                setError(e?.message ?? "Failed to load saved CV.");
              } finally {
                setBusy("");
              }
            }}
            disabled={!!busy}
          >
            Load Saved
          </button>
        </div>
        {cvParsed ? (
          <div style={{ marginTop: 6, fontSize: 12, color: "#0a0" }}>
            CV parsed ✓ (keys: {Object.keys(cvParsed).length})
          </div>
        ) : null}
      </section>

      {/* Job Analysis */}
      <section style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <label style={{ fontWeight: 600 }}>Job page</label>
          <span style={{ fontSize: 12, color: "#666" }}>
            Detected: {site}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button onClick={onAnalyze} disabled={!!busy}>
            Analyze Current Tab
          </button>
          {!!job && (
            <button
              onClick={() => {
                setJob(null);
                setScore(null);
                setTailored("");
              }}
              disabled={!!busy}
            >
              Reset
            </button>
          )}
        </div>
        {job ? (
          <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.4 }}>
            <div><b>{job.title}</b>{job.company ? ` — ${job.company}` : ""}</div>
            {!!job.location && <div>{job.location}</div>}
            <div style={{ color: "#666" }}>
              {job.skills?.length ? `Skills parsed: ${job.skills.slice(0, 10).join(", ")}${job.skills.length > 10 ? "…" : ""}` : "No skills parsed"}
            </div>
          </div>
        ) : null}
      </section>

      {/* Scoring */}
      <section style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontWeight: 600 }}>Match score</label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={useAI}
              onChange={(e) => setUseAI(e.target.checked)}
              disabled={!!busy}
            />
            Use AI blend
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button onClick={onScore} disabled={!cvParsed || !job || !!busy}>
            Compute Score
          </button>
        </div>
        {score ? (
          <div style={{ marginTop: 8, padding: 8, border: "1px solid #ddd", borderRadius: 6 }}>
            <div style={{ fontSize: 28, fontWeight: 700, textAlign: "center" }}>
              {score.score}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#666" }}>
              <span>Matched: {matchedCount}</span>
              <span>Missing: {missingCount}</span>
            </div>
            {Array.isArray(score.reasons) && score.reasons.length > 0 && (
              <details style={{ marginTop: 6 }}>
                <summary>Details</summary>
                <ul style={{ margin: "6px 0 0 16px" }}>
                  {score.reasons.slice(0, 5).map((r, i) => (
                    <li key={i} style={{ fontSize: 12 }}>{r}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ) : null}
      </section>

      {/* Tailored CV */}
      <section style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onTailor} disabled={!cvParsed || !job || !!busy}>
            Generate Tailored CV
          </button>
          <button onClick={onDownload} disabled={!tailored}>
            Download
          </button>
        </div>
        {!!tailored && (
          <details style={{ marginTop: 8 }}>
            <summary>Preview</summary>
            <pre
              style={{
                marginTop: 6,
                maxHeight: 180,
                overflow: "auto",
                fontSize: 12,
                background: "#f8f8f8",
                padding: 8,
                borderRadius: 6,
              }}
            >
{tailored}
            </pre>
          </details>
        )}
      </section>

      {/* Status / Error */}
      {!!busy && (
        <div style={{ marginTop: 6, fontSize: 12, color: "#0366d6" }}>{busy}</div>
      )}
      {!!error && (
        <div style={{ marginTop: 6, fontSize: 12, color: "#b00020" }}>{error}</div>
      )}

      <footer style={{ marginTop: 10 }}>
        <button
          style={{ fontSize: 12 }}
          onClick={async () => {
            try {
              await send("popup", "LOG_EVENT", { level: "info", msg: "manual ping" }, { timeoutMs: 3000 });
              const res = await send("popup", "PING", { t: Date.now() }, { timeoutMs: 3000 });
              log.info("PING ok", res);
            } catch (e) {
              log.warn("PING failed", e);
            }
          }}
        >
          Ping
        </button>
      </footer>
    </div>
  );
}
