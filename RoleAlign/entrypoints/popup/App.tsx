import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { send } from "../../src/messaging/bus";
import type {
  AnalyzeJobRes,
  ScoreMatchRes,
} from "../../src/messaging/types";
import { Logger } from "../../src/util/logger";

const log = new Logger({ namespace: "popup", level: "debug", persist: true });

type JobSite = "linkedin" | "indeed" | "unknown";

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

interface CVSections {
  personalInfo: string;
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

function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const handleError = (error: any) => {
      console.error("🚨 [RoleAlign] React Error Boundary caught:", error);
      setHasError(true);
    };

    window.addEventListener("error", handleError);
    return () => window.removeEventListener("error", handleError);
  }, []);

  if (hasError) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        <h3>Something went wrong</h3>
        <button onClick={() => setHasError(false)}>Try again</button>
      </div>
    );
  }

  return <>{children}</>;
}

function AppContent() {
  const [cvSections, setCvSections] = useState<CVSections>({
    personalInfo: "",
    experience: "",
    education: "",
    skills: "",
    projects: ""
  });
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
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null);

  const mounted = useRef(true);
  const abortController = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      mounted.current = false;
      abortController.current?.abort();
    };
  }, []);

  const site = useMemo(() => detectSite(activeUrl), [activeUrl]);
  
  const hasCv = useMemo(() => 
    Object.values(cvSections).some(section => section.trim().length > 0), 
    [cvSections]
  );

  const jobSiteDisplayName = useMemo(() => {
    switch (site) {
      case "linkedin": return "LinkedIn";
      case "indeed": return "Indeed";
      default: return "Unknown Site";
    }
  }, [site]);

  // Initialize popup
  useEffect(() => {
    (async () => {
      try {
        log.info("Initializing popup...");
        
        // Get stored CV
        const cvResult = await send("popup", "GET_CV", {}, { timeoutMs: 4000 });
        if (cvResult.cv) {
          setCvParsed(cvResult.cv);
        }

        // Get active tab (non-fatal if it fails)
        try {
          const tab = await getActiveTab();
          if (tab?.url) {
            setActiveTab(tab);
            setActiveUrl(tab.url);
            log.info("Got active tab", { url: tab.url });
          }
        } catch (tabError) {
          log.warn("Failed to get active tab (non-fatal)", tabError);
        }

        log.info("Popup initialized successfully");
      } catch (e: any) {
        log.error("Popup initialization failed", e);
        setInitError(e?.message ?? "Failed to initialize popup");
      } finally {
        setIsInitializing(false);
      }
    })();
  }, []);

  // Update CV section
  const updateCvSection = useCallback((section: keyof CVSections, value: string) => {
    setCvSections(prev => ({
      ...prev,
      [section]: value
    }));
  }, []);

  // Process CV sections with summarization
  const onProcessCV = useCallback(async () => {
    if (!mounted.current) return;
    
    try {
      setBusy("🔍 Checking sections...");
      setError("");

      // Check if at least some sections are filled
      const filledSections = Object.values(cvSections).filter(section => section.trim().length > 0);
      if (filledSections.length === 0) {
        throw new Error("Please fill in at least one CV section before processing.");
      }

      setBusy("🤖 Processing each section with AI Summarization...");

      const result = await send("popup", "PROCESS_CV_SECTIONS", {
        sections: cvSections
      }, { timeoutMs: 120000 });

      setCvParsed(result);
      log.info("CV sections processed successfully", result);

    } catch (e: any) {
      if (!mounted.current) return;
      log.error("❌ CV processing failed", e);
      setError(e?.message ?? "Failed to process CV sections.");
    } finally {
      if (mounted.current) {
        setBusy("");
      }
    }
  }, [cvSections, activeTab]);

  // Analyze job page
  const onAnalyzeJob = useCallback(async () => {
    if (!mounted.current || !activeTab?.id) return;

    try {
      setBusy("🔍 Analyzing job page...");
      setError("");

      const result = await send("popup", "ANALYZE_JOB", { tabId: activeTab.id }, { timeoutMs: 15000 });

      setJob(result.job);
      log.info("Job analyzed successfully", result);

    } catch (e: any) {
      if (!mounted.current) return;
      log.error("❌ Job analysis failed", e);
      setError(e?.message ?? "Failed to analyze job page.");
    } finally {
      if (mounted.current) {
        setBusy("");
      }
    }
  }, [activeTab]);

  // Score match
  const onScoreMatch = useCallback(async () => {
    if (!mounted.current || !cvParsed || !job) return;

    try {
      setBusy("🎯 Calculating match score...");
      setError("");

      const result = await send("popup", "SCORE_MATCH", {
        cv: cvParsed,
        job: job,
        method: useAI ? "blend" : "deterministic"
      }, { timeoutMs: 15000 });

      setScore(result);
      log.info("Match scored successfully", result);

    } catch (e: any) {
      if (!mounted.current) return;
      log.error("❌ Match scoring failed", e);
      setError(e?.message ?? "Failed to calculate match score.");
    } finally {
      if (mounted.current) {
        setBusy("");
      }
    }
  }, [cvParsed, job, useAI]);

  // Generate tailored CV
  const onTailorCV = useCallback(async () => {
    if (!mounted.current || !cvParsed || !job) return;

    try {
      setBusy("✨ Generating tailored CV...");
      setError("");

      const result = await send("popup", "GENERATE_TAILORED_CV", {
        cv: cvParsed,
        job: job
      }, { timeoutMs: 12000 });

      setTailored(result.text || result);
      log.info("CV tailored successfully");

    } catch (e: any) {
      if (!mounted.current) return;
      log.error("❌ CV tailoring failed", e);
      setError(e?.message ?? "Failed to generate tailored CV.");
    } finally {
      if (mounted.current) {
        setBusy("");
      }
    }
  }, [cvParsed, job]);

  if (isInitializing) {
    return (
      <div className="popup-container">
        <div className="loading">
          <div className="spinner"></div>
          <p>Initializing RoleAlign...</p>
        </div>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="popup-container">
        <div className="error">
          <h3>❌ Initialization Error</h3>
          <p>{initError}</p>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }

  return (
    <div className="popup-container">
      <header className="popup-header">
        <div className="header-content">
          <h1>🎯 RoleAlign</h1>
          <div className="site-indicator">
            <span className={`site-badge ${site}`}>{jobSiteDisplayName}</span>
          </div>
        </div>
      </header>

      <main className="popup-main">
        {error && (
          <div className="error-banner">
            <span>❌ {error}</span>
            <button onClick={() => setError("")}>×</button>
          </div>
        )}

        {busy && (
          <div className="busy-banner">
            <div className="spinner"></div>
            <span>{busy}</span>
          </div>
        )}

        <div className="content-grid">
          {/* CV Input Section - Full width */}
          <section className="cv-section" style={{ gridColumn: "1 / -1" }}>
            <h2>📋 Your CV Information</h2>
            <p className="section-description">
              Paste your CV content into the relevant sections below for accurate analysis.
            </p>

            <div className="cv-fields">
              <div className="field-group">
                <label htmlFor="personal-info">
                  👤 Personal Information
                  <span className="field-hint">Name, contact details, location</span>
                </label>
                <textarea
                  id="personal-info"
                  value={cvSections.personalInfo}
                  onChange={(e) => updateCvSection("personalInfo", e.target.value)}
                  placeholder="John Doe&#10;john.doe@email.com&#10;+1 (555) 123-4567&#10;New York, NY"
                  rows={4}
                />
              </div>

              <div className="field-group">
                <label htmlFor="experience">
                  💼 Work Experience
                  <span className="field-hint">Job titles, companies, responsibilities, achievements</span>
                </label>
                <textarea
                  id="experience"
                  value={cvSections.experience}
                  onChange={(e) => updateCvSection("experience", e.target.value)}
                  placeholder="Senior Software Engineer @ Tech Corp (2020-Present)&#10;- Led team of 5 developers&#10;- Built scalable microservices..."
                  rows={8}
                />
              </div>

              <div className="field-group">
                <label htmlFor="education">
                  🎓 Education
                  <span className="field-hint">Degrees, certifications, courses</span>
                </label>
                <textarea
                  id="education"
                  value={cvSections.education}
                  onChange={(e) => updateCvSection("education", e.target.value)}
                  placeholder="Bachelor of Science in Computer Science&#10;University of Technology (2016-2020)&#10;GPA: 3.8/4.0"
                  rows={4}
                />
              </div>

              <div className="field-group">
                <label htmlFor="skills">
                  🛠️ Skills & Technologies
                  <span className="field-hint">Programming languages, frameworks, tools</span>
                </label>
                <textarea
                  id="skills"
                  value={cvSections.skills}
                  onChange={(e) => updateCvSection("skills", e.target.value)}
                  placeholder="JavaScript, TypeScript, React, Node.js, Python, AWS, Docker, Kubernetes..."
                  rows={4}
                />
              </div>

              <div className="field-group">
                <label htmlFor="projects">
                  🚀 Projects & Achievements
                  <span className="field-hint">Notable projects, accomplishments, publications</span>
                </label>
                <textarea
                  id="projects"
                  value={cvSections.projects}
                  onChange={(e) => updateCvSection("projects", e.target.value)}
                  placeholder="E-commerce Platform (2023)&#10;- Built full-stack application serving 10k+ users&#10;- Technologies: React, Node.js, PostgreSQL"
                  rows={6}
                />
              </div>
            </div>

            <div className="cv-actions">
              <button 
                className="btn btn-primary" 
                onClick={onProcessCV}
                disabled={!hasCv || Boolean(busy)}
              >
                {cvParsed ? "🔄 Update CV Analysis" : "🤖 Process CV with AI"}
              </button>
              
              {cvParsed && (
                <div className="cv-status">
                  ✅ CV processed successfully
                </div>
              )}
            </div>
          </section>

          {/* Job Analysis Section */}
          <section className="job-section">
            <h2>🎯 Job Analysis</h2>
            
            <div className="job-actions">
              <button 
                className="btn btn-secondary" 
                onClick={onAnalyzeJob}
                disabled={site === "unknown" || Boolean(busy)}
              >
                🔍 Analyze Job Page
              </button>
              
              {site === "unknown" && (
                <p className="site-warning">
                  ⚠️ Navigate to a LinkedIn or Indeed job page to analyze
                </p>
              )}
            </div>

            {job && (
              <div className="job-summary">
                <h3>{(job as any).title || "Job Title"}</h3>
                <p><strong>Company:</strong> {(job as any).company || "Company Name"}</p>
                <p><strong>Location:</strong> {(job as any).location || "Location"}</p>
                {(job as any).requirements && (
                  <div className="requirements">
                    <strong>Key Requirements:</strong>
                    <ul>
                      {(job as any).requirements.slice(0, 5).map((req: string, i: number) => (
                        <li key={i}>{req}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Matching Section */}
          {cvParsed && job && (
            <section className="match-section">
              <h2>📊 Match Analysis</h2>
              
              <div className="match-controls">
                <label className="ai-toggle">
                  <input
                    type="checkbox"
                    checked={useAI}
                    onChange={(e) => setUseAI(e.target.checked)}
                  />
                  Use AI-powered matching
                </label>
                
                <button 
                  className="btn btn-primary" 
                  onClick={onScoreMatch}
                  disabled={Boolean(busy)}
                >
                  🎯 Calculate Match Score
                </button>
              </div>

              {score && (
                <div className="score-results">
                  <div className="score-display">
                    <div className="score-value">{Math.round(score.score * 100)}%</div>
                    <div className="score-label">Match Score</div>
                  </div>
                  
                  <div className="score-details">
                    <div className="matched-skills">
                      <h4>✅ Matched Skills ({(score as any).matched?.length || 0})</h4>
                      <div className="skill-tags">
                        {((score as any).matched || []).slice(0, 10).map((skill: string, i: number) => (
                          <span key={i} className="skill-tag matched">{skill}</span>
                        ))}
                      </div>
                    </div>
                    
                    <div className="missing-skills">
                      <h4>❌ Missing Skills ({(score as any).missing?.length || 0})</h4>
                      <div className="skill-tags">
                        {((score as any).missing || []).slice(0, 10).map((skill: string, i: number) => (
                          <span key={i} className="skill-tag missing">{skill}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* CV Tailoring Section */}
          {cvParsed && job && (
            <section className="tailor-section">
              <h2>✨ CV Tailoring</h2>
              
              <div className="tailor-actions">
                <button 
                  className="btn btn-primary" 
                  onClick={onTailorCV}
                  disabled={Boolean(busy)}
                >
                  ✨ Generate Tailored CV
                </button>
              </div>

              {tailored && (
                <div className="tailored-cv">
                  <h3>📄 Tailored CV</h3>
                  <div className="cv-content">
                    <pre>{tailored}</pre>
                  </div>
                  <button 
                    className="btn btn-secondary"
                    onClick={() => navigator.clipboard.writeText(tailored)}
                  >
                    📋 Copy to Clipboard
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}