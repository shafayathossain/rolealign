import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { send } from "../../src/messaging/bus";
import type {
  AnalyzeJobRes,
  ScoreMatchRes,
} from "../../src/messaging/types";
import { Logger } from "../../src/util/logger";

const log = new Logger({ namespace: "popup", level: "debug", persist: true });

type JobSite = "linkedin" | "indeed" | "unknown";

interface CVSections {
  personalInfo: string;
  summary: string;
  experience: string;
  education: string;
  skills: string;
  projects: string;
}

function detectSite(url?: string): JobSite {
  if (!url) return "unknown";
  const u = url.toLowerCase();
  if (u.includes("linkedin.com")) return "linkedin";
  if (u.includes("indeed.com")) return "indeed";
  return "unknown";
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  try {
    if (typeof chrome === "undefined" || !chrome.tabs) {
      throw new Error("Chrome APIs not available");
    }
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

// Error Boundary Component
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    log.error("Popup Error Boundary caught error:", error, errorInfo);
    // Log additional context for debugging
    console.error("🚨 [RoleAlign] Error Boundary - Error details:", {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      chromeAvailable: typeof chrome !== 'undefined',
      extensionId: chrome?.runtime?.id,
      location: window.location.href,
    });
  }

  render() {
    if (this.state.hasError) {
      const isDev = process.env.NODE_ENV === "development";
      return (
        <div style={{ padding: 20, textAlign: "center", width: 360 }}>
          <h3>⚠️ Something went wrong</h3>
          <p>The popup encountered an error. Please reload the extension.</p>
          {isDev && this.state.error && (
            <details style={{ marginTop: 10, textAlign: "left", fontSize: 12 }}>
              <summary>Error Details (Dev Mode)</summary>
              <pre style={{ background: "#f5f5f5", padding: 8, borderRadius: 4, overflow: "auto" }}>
                {this.state.error.message}
                {"\n\n"}
                {this.state.error.stack}
              </pre>
            </details>
          )}
          <button 
            onClick={() => window.location.reload()}
            style={{
              marginTop: 10,
              padding: "8px 16px",
              backgroundColor: "#1976d2",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

function AppContent() {
  const [cvRaw, setCvRaw] = useState("");
  const [cvParsed, setCvParsed] = useState<any>(null);
  const [job, setJob] = useState<AnalyzeJobRes["result"]["job"] | null>(null);
  const [score, setScore] = useState<ScoreMatchRes["result"] | null>(null);
  const [tailored, setTailored] = useState<string>("");

  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState<string>("");

  const [useAI, setUseAI] = useState(true);
  const [activeUrl, setActiveUrl] = useState<string>("");

  const mounted = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortController = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      mounted.current = false;
      abortController.current?.abort();
    };
  }, []);

  const site = useMemo(() => detectSite(activeUrl), [activeUrl]);

  const onExtract = useCallback(async () => {
    if (!mounted.current) return;

    setError("");
    setBusy("Extracting CV… (this may take up to 2 minutes)");
    setScore(null);
    setTailored("");

    try {
      if (!cvRaw.trim()) {
        throw new Error("Please paste your CV text first.");
      }

      log.info("Starting CV extraction", { textLength: cvRaw.length });

      const res = await send(
        "popup",
        "EXTRACT_CV",
        { raw: cvRaw },
        {
          timeoutMs: 150_000,
          signal: abortController.current?.signal,
        }
      );

      if (!mounted.current) return;

      log.info("CV extraction completed", {
        extractedFields: Object.keys(res.cv || {}),
        skillsCount: (res.cv as any)?.skills?.length || 0,
        experienceCount: (res.cv as any)?.experience?.length || 0,
        name: (res.cv as any)?.name || "not provided",
        email: (res.cv as any)?.email || "not provided",
      });

      setCvParsed(res.cv);

      // Save CV in background (non-blocking)
      try {
        await send("popup", "SAVE_CV", { cv: res.cv }, { timeoutMs: 5000 });
        log.info("CV saved successfully");
      } catch (saveError) {
        log.warn("Failed to save CV (non-fatal)", saveError);
      }
    } catch (e: any) {
      if (!mounted.current) return;
      log.error("CV extraction failed", e);
      setError(e?.message ?? "Failed to extract CV.");
    } finally {
      if (mounted.current) {
        setBusy("");
      }
    }
  }, [cvRaw]);

  /**
   * PDF text extraction with graceful fallback:
   * - Attempts to use FileReader API to detect text-based PDFs
   * - Provides clear guidance for copy-paste fallback
   * - Chrome extension compatible approach
   */
  const extractTextFromPDF = useCallback(async (file: File): Promise<string> => {
    try {
      log.info("🔄 Starting PDF analysis", {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      });

      setBusy("📚 Analyzing PDF structure...");

      // Read the PDF file as binary data
      const arrayBuffer = await file.arrayBuffer();
      
      // Convert to text to look for readable content
      const uint8Array = new Uint8Array(arrayBuffer);
      const textDecoder = new TextDecoder('utf-8', { fatal: false });
      const rawText = textDecoder.decode(uint8Array);
      
      // Extract readable text from PDF raw content using multiple patterns
      
      // Pattern 1: Text in parentheses (most common in PDFs)
      const parenthesesMatches = rawText.match(/\((.*?)\)/g) || [];
      const parenthesesText = parenthesesMatches
        .map(match => match.slice(1, -1))
        .filter(str => str.length > 2 && /[a-zA-Z]/.test(str))
        .join(' ');
      
      // Pattern 2: Text between Tj and TJ operators
      const tjMatches = rawText.match(/\[(.*?)\]\s*T[jJ]/g) || [];
      const tjText = tjMatches
        .map(match => match.replace(/\[(.*?)\]\s*T[jJ]/, '$1'))
        .filter(str => str.length > 2 && /[a-zA-Z]/.test(str))
        .join(' ');
      
      // Pattern 3: Direct text strings in streams
      const streamMatches = rawText.match(/stream[\s\S]*?endstream/g) || [];
      const streamText = streamMatches
        .join(' ')
        .replace(/[^\x20-\x7E]/g, ' ') // Keep only printable ASCII
        .split(/\s+/)
        .filter(word => word.length > 2 && /[a-zA-Z]/.test(word))
        .join(' ');
      
      // Combine all extracted text
      const extractedStrings = [parenthesesText, tjText, streamText]
        .filter(text => text.length > 0)
        .join(' ')
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();

      log.info("📄 PDF raw content analyzed", { 
        totalBytes: arrayBuffer.byteLength,
        textPreview: rawText.substring(0, 400),
        parenthesesMatches: parenthesesMatches.length,
        tjMatches: tjMatches.length,
        streamMatches: streamMatches.length,
        totalExtractedLength: extractedStrings.length,
        extractedTextPreview: extractedStrings.substring(0, 500)
      });

      // Look for text indicators in the PDF structure
      const hasTextContent = rawText.includes('/Type /Page') || 
                           rawText.includes('BT ') || // Begin Text
                           rawText.includes('Tj ') || // Show Text
                           rawText.includes('TJ ') || // Show Text with positioning
                           rawText.includes('stream');

      // Try to extract actual text content if available
      if (extractedStrings.length > 100) {
        log.info("✅ PDF text extracted successfully", { 
          extractedLength: extractedStrings.length,
          preview: extractedStrings.substring(0, 200) + "..."
        });
        return extractedStrings;
      }

      // Fallback: provide guidance message if extraction failed
      if (!hasTextContent) {
        throw new Error(
          "This PDF appears to be image-based or encrypted. Text extraction is not possible. " +
          "Please copy the text content from your PDF and paste it in the text area below."
        );
      }

      const guidanceMessage = `
PDF detected: ${file.name} (${Math.round(file.size / 1024)} KB, appears to contain text)

Extracted ${parenthesesMatches.length + tjMatches.length + streamMatches.length} text patterns, but automatic extraction is limited. 
For the best experience, please:

1. Open your PDF in a PDF viewer
2. Select all text (Ctrl+A / Cmd+A)
3. Copy the text (Ctrl+C / Cmd+C)  
4. Paste it in the text area below

Extracted sample: ${extractedStrings.substring(0, 200)}${extractedStrings.length > 200 ? '...' : ''}
      `.trim();

      log.info("✅ PDF analysis completed - guidance provided with sample text");
      return guidanceMessage;

    } catch (error: any) {
      log.error("❌ PDF analysis failed", error);
      throw new Error(
        `PDF processing error: ${error?.message || error}. Please copy the text content from your PDF manually.`
      );
    }
  }, []);

  const onFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!mounted.current) return;

      const file = event.target.files?.[0];
      if (!file) {
        log.warn("No file selected");
        return;
      }

      setError("");
      setScore(null);
      setTailored("");
      setBusy("🚀 Starting file processing...");

      try {
        log.info("🚀 File upload initiated", {
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
        });

        let text = "";

        if (file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")) {
          setBusy("📄 Reading text file...");
          text = await file.text();
        } else if (
          file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf")
        ) {
          setBusy("🔄 Processing PDF file...");
          text = await extractTextFromPDF(file);
        } else {
          setError(
            "Only .txt and .pdf files are supported. For other formats, please copy the text and paste it in the text area below."
          );
          return;
        }

        if (!text.trim()) {
          throw new Error("File appears to be empty or unreadable.");
        }

        setCvRaw(text);

        // Auto-extract after file upload
        setBusy("🧠 Analyzing CV with AI... (this may take up to 2 minutes)");
        const res = await send(
          "popup",
          "EXTRACT_CV",
          { raw: text },
          { timeoutMs: 150_000 }
        );
        const cv = res.cv as any;

        setCvParsed(cv);

        setBusy("💾 Saving CV to local storage...");
        await send("popup", "SAVE_CV", { cv }, { timeoutMs: 5000 });
      } catch (e: any) {
        log.error("❌ File upload failed", e);
        setError(e?.message ?? "Failed to process file.");
      } finally {
        setBusy("");
        // Clear the file input
        event.target.value = "";
      }
    },
    [extractTextFromPDF]
  );

  const onAnalyze = useCallback(async () => {
    if (!mounted.current) return;

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

      const res = await send(
        "popup",
        "ANALYZE_JOB",
        { url, site },
        {
          timeoutMs: 20_000,
          tabId: tab.id,
          signal: abortController.current?.signal,
        }
      );

      if (mounted.current) {
        setJob(res.job);
      }
    } catch (e: any) {
      if (mounted.current) {
        setError(e?.message ?? "Failed to analyze job page.");
      }
    } finally {
      if (mounted.current) {
        setBusy("");
      }
    }
  }, []);

  const onScore = useCallback(async () => {
    if (!mounted.current) return;

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
        {
          timeoutMs: useAI ? 18_000 : 8_000,
          tabId: tab?.id,
          signal: abortController.current?.signal,
        }
      );

      if (mounted.current) {
        setScore(res);
      }
    } catch (e: any) {
      if (mounted.current) {
        setError(e?.message ?? "Failed to compute score.");
      }
    } finally {
      if (mounted.current) {
        setBusy("");
      }
    }
  }, [cvParsed, job, useAI]);

  const onTailor = useCallback(async () => {
    if (!mounted.current) return;

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
        {
          timeoutMs: 35_000,
          signal: abortController.current?.signal,
        }
      );

      if (mounted.current) {
        setTailored(res.text);
      }
    } catch (e: any) {
      if (mounted.current) {
        setError(e?.message ?? "Failed to generate tailored CV.");
      }
    } finally {
      if (mounted.current) {
        setBusy("");
      }
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

  // Safe hostname display (new URL can throw on invalid/empty)
  const hostnameSafe = useMemo(() => {
    try {
      return activeUrl ? new URL(activeUrl).hostname : "";
    } catch {
      return "";
    }
  }, [activeUrl]);

  // Initialize popup with proper error handling
  useEffect(() => {
    let isMounted = true;
    abortController.current = new AbortController();

    const initializePopup = async () => {
      try {
        log.info("Initializing popup...");

        // Check Chrome APIs availability
        if (
          typeof chrome === "undefined" ||
          !chrome.runtime ||
          !chrome.runtime.sendMessage
        ) {
          throw new Error("Chrome extension APIs not available");
        }

        // Load saved CV (non-fatal if it fails)
        try {
          const res = await send(
            "popup",
            "GET_CV",
            {},
            {
              timeoutMs: 4000,
              signal: abortController.current?.signal,
            }
          );
          if (isMounted && res.cv) {
            setCvParsed(res.cv);
            log.info("Loaded saved CV", { hasCV: !!res.cv });
          }
        } catch (cvError) {
          log.warn("Failed to load saved CV (non-fatal)", cvError);
        }

        // Get active tab (non-fatal if it fails)
        try {
          const tab = await getActiveTab();
          if (isMounted && tab?.url) {
            setActiveUrl(tab.url);
            log.info("Got active tab", { url: tab.url });
          }
        } catch (tabError) {
          log.warn("Failed to get active tab (non-fatal)", tabError);
        }

        if (isMounted) {
          setIsInitializing(false);
          log.info("Popup initialized successfully");
        }
      } catch (error: any) {
        log.error("Popup initialization failed", error);
        if (isMounted) {
          setInitError(error?.message || "Failed to initialize popup");
          setIsInitializing(false);
        }
      }
    };

    initializePopup();

    return () => {
      isMounted = false;
    };
  }, []);

  // Show loading state during initialization
  if (isInitializing) {
    return (
      <div style={{ width: 360, padding: 20, textAlign: "center" }}>
        <div style={{ marginBottom: 16, fontSize: 24 }}>⚡</div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          Loading RoleAlign...
        </div>
        <div style={{ fontSize: 12, color: "#666" }}>Initializing popup...</div>
      </div>
    );
  }

  // Show initialization error
  if (initError) {
    return (
      <div style={{ width: 360, padding: 20, textAlign: "center" }}>
        <div style={{ marginBottom: 16, fontSize: 24 }}>⚠️</div>
        <div
          style={{
            fontWeight: 600,
            marginBottom: 8,
            color: "#d32f2f",
          }}
        >
          Initialization Failed
        </div>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>
          {initError}
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: "8px 16px",
            backgroundColor: "#1976d2",
            color: "white",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.7; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      <div
        className="popup-root"
        style={{ width: 360, padding: 12, position: "relative" }}
      >
        {/* Full-screen loader overlay */}
        {!!busy && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0, 0, 0, 0.8)",
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: 14,
              textAlign: "center",
              padding: 20,
            }}
          >
            <div
              style={{
                backgroundColor: "white",
                color: "#333",
                padding: 20,
                borderRadius: 12,
                boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                maxWidth: 300,
                width: "90%",
              }}
            >
              <div
                style={{
                  fontSize: 24,
                  marginBottom: 16,
                  animation: "pulse 2s infinite",
                }}
              >
                ⚡
              </div>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 16 }}>
                Processing...
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.4, color: "#666" }}>
                {busy}
              </div>
              <div style={{ marginTop: 16, fontSize: 12, color: "#999" }}>
                Please wait, this may take a moment
              </div>
            </div>
          </div>
        )}

        <header style={{ marginBottom: 8 }}>
          <h1 style={{ fontSize: 16, margin: 0 }}>RoleAlign</h1>
          <small style={{ color: "#666" }}>
            {hostnameSafe ? `Active: ${hostnameSafe}` : "Active tab unknown"}
          </small>
        </header>

        {/* CV Upload Section */}
        <section
          style={{
            marginBottom: 15,
            padding: 10,
            border: "2px solid #e0e0e0",
            borderRadius: 8,
            backgroundColor: "#f9f9f9",
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 700,
              margin: "0 0 10px 0",
              color: "#333",
            }}
          >
            📄 Upload Your CV/Resume
          </h2>

          {/* File Upload */}
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 6 }}>
              Option 1: Upload File
            </label>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.pdf"
              onChange={onFileUpload}
              style={{ display: "none" }}
            />

            {/* Button to trigger file selection */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!!busy}
              style={{
                width: "100%",
                padding: 10,
                backgroundColor: "#4CAF50",
                color: "white",
                border: "none",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                marginBottom: 8,
              }}
            >
              📁 Choose File to Upload
            </button>
            <small style={{ color: "#666", fontSize: 11 }}>
              Supports: .txt and .pdf files. PDF text extraction has limitations.
            </small>
          </div>

          {/* Text Paste */}
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontWeight: 600, display: "block", marginBottom: 6 }}>
              Option 2: Paste Text
            </label>
            <textarea
              value={cvRaw}
              onChange={(e) => setCvRaw(e.target.value)}
              rows={5}
              placeholder="Copy and paste your CV/resume text here…"
              style={{
                width: "100%",
                resize: "vertical",
                padding: 8,
                border: "1px solid #ccc",
                borderRadius: 4,
              }}
            />
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <button
              onClick={onExtract}
              disabled={!cvRaw.trim() || !!busy}
              style={{
                backgroundColor: cvRaw.trim() ? "#0366d6" : "#ccc",
                color: "white",
                border: "none",
                padding: "8px 12px",
                borderRadius: 4,
                fontWeight: 600,
              }}
            >
              🔍 Extract & Analyze CV
            </button>
            <button
              onClick={async () => {
                if (!mounted.current) return;

                setError("");
                setBusy("Loading saved CV…");

                try {
                  const res = await send(
                    "popup",
                    "GET_CV",
                    {},
                    {
                      timeoutMs: 4000,
                      signal: abortController.current?.signal,
                    }
                  );

                  if (mounted.current) {
                    setCvParsed(res.cv ?? null);

                    log.info("Loaded saved CV", {
                      hasCV: !!res.cv,
                      source: res.source,
                      fields: res.cv ? Object.keys(res.cv) : [],
                    });
                  }
                } catch (e: any) {
                  if (mounted.current) {
                    log.error("Failed to load saved CV", e);
                    setError(e?.message ?? "Failed to load saved CV.");
                  }
                } finally {
                  if (mounted.current) {
                    setBusy("");
                  }
                }
              }}
              disabled={!!busy}
              style={{
                backgroundColor: "#f8f8f8",
                border: "1px solid #ccc",
                padding: "8px 12px",
                borderRadius: 4,
              }}
            >
              📂 Load Saved CV
            </button>
          </div>

          {/* CV Status */}
          {cvParsed ? (
            <div
              style={{
                marginTop: 8,
                padding: 8,
                backgroundColor: "#d4edda",
                border: "1px solid #c3e6cb",
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 600, color: "#155724", marginBottom: 4 }}>
                ✅ CV Successfully Analyzed
              </div>
              <div style={{ color: "#155724" }}>
                <strong>Name:</strong> {cvParsed.name || "Not provided"}
                <br />
                <strong>Email:</strong> {cvParsed.email || "Not provided"}
                <br />
                <strong>Skills:</strong> {cvParsed.skills?.length || 0} detected
                <br />
                <strong>Experience:</strong> {cvParsed.experience?.length || 0} positions
                <br />
                <strong>Fields extracted:</strong>{" "}
                {Object.keys(cvParsed).join(", ")}
              </div>
            </div>
          ) : (
            <div
              style={{
                marginTop: 8,
                padding: 8,
                backgroundColor: "#fff3cd",
                border: "1px solid #ffeaa7",
                borderRadius: 4,
                fontSize: 12,
                color: "#856404",
              }}
            >
              ⏳ No CV analyzed yet. Upload or paste your CV above to get started.
            </div>
          )}
        </section>

        {/* Job Analysis */}
        <section style={{ marginBottom: 10 }}>
          <div
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
          >
            <label style={{ fontWeight: 600 }}>Job page</label>
            <span style={{ fontSize: 12, color: "#666" }}>Detected: {site}</span>
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
              <div>
                <b>{(job as any).title}</b>
                {(job as any).company ? ` — ${(job as any).company}` : ""}
              </div>
              {!!(job as any).location && <div>{(job as any).location}</div>}
              <div style={{ color: "#666" }}>
                {(job as any).skills?.length
                  ? `Skills parsed: ${(job as any).skills
                      .slice(0, 10)
                      .join(", ")}${(job as any).skills.length > 10 ? "…" : ""}`
                  : "No skills parsed"}
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
              <div
                style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#666" }}
              >
                <span>Matched: {matchedCount}</span>
                <span>Missing: {missingCount}</span>
              </div>
              {Array.isArray(score.reasons) && score.reasons.length > 0 && (
                <details style={{ marginTop: 6 }}>
                  <summary>Details</summary>
                  <ul style={{ margin: "6px 0 0 16px" }}>
                    {score.reasons.slice(0, 5).map((r, i) => (
                      <li key={i} style={{ fontSize: 12 }}>
                        {r}
                      </li>
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
        {!!error && (
          <div style={{ marginTop: 6, fontSize: 12, color: "#b00020" }}>{error}</div>
        )}

        <footer style={{ marginTop: 10 }}>
          <button
            style={{ fontSize: 12 }}
            onClick={async () => {
              if (!mounted.current) return;

              try {
                await send(
                  "popup",
                  "LOG_EVENT",
                  { level: "info", msg: "manual ping" },
                  {
                    timeoutMs: 3000,
                    signal: abortController.current?.signal,
                  }
                );
                const res = await send(
                  "popup",
                  "PING",
                  { t: Date.now() },
                  {
                    timeoutMs: 3000,
                    signal: abortController.current?.signal,
                  }
                );
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
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
