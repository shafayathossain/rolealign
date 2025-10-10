import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { send } from "../../src/messaging/bus";
import type { AnalyzeJobRes, ScoreMatchRes } from "../../src/messaging/types";
import { Logger } from "../../src/util/logger";

// Components
import { ErrorBoundary } from "./components/ErrorBoundary";
import { CVManageView } from "./components/CVManageView";
import { CVInputSection } from "./components/CVInputSection";
import { JobAnalysis } from "./components/JobAnalysis";
import { MatchAnalysis } from "./components/MatchAnalysis";
import { CVTailoring } from "./components/CVTailoring";

// Utils
import { 
  CVSections, 
  getActiveTab, 
  detectSite, 
  getJobSiteDisplayName 
} from "./utils/helpers";
import { 
  parseExperienceData, 
  parseProjectsData, 
  parseEducationData 
} from "./utils/cvParser";

const log = new Logger({ namespace: "popup", level: "debug", persist: true });

function AppContent() {
  // State management
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
  const [currentTab, setCurrentTab] = useState<"input" | "manage">("input");
  const [editingCV, setEditingCV] = useState<any>(null);

  const mounted = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  // Computed values
  const site = useMemo(() => detectSite(activeUrl), [activeUrl]);
  const hasCv = useMemo(() => 
    Object.values(cvSections).some(section => section.trim().length > 0), 
    [cvSections]
  );
  const jobSiteDisplayName = useMemo(() => getJobSiteDisplayName(site), [site]);

  // Initialize popup
  useEffect(() => {
    (async () => {
      try {
        log.info("Initializing popup...");
        
        // Get stored CV
        const cvResult = await send("popup", "GET_CV", {}, { timeoutMs: 60000 });
        if (cvResult.cv) {
          setCvParsed(cvResult.cv);
        }

        // Get active tab
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

  // Load CV for editing
  const loadCvForEditing = useCallback(async () => {
    try {
      setBusy("📋 Loading saved CV data...");
      setError("");
      
      const result = await send("popup", "GET_CV", {}, { timeoutMs: 60000 });
      
      if (result?.cv) {
        const cv = result.cv as any;
        
        // Parse the data using our utility functions
        const experienceData = parseExperienceData(cv?.experience);
        const projectsData = parseProjectsData(cv?.projects);
        const educationData = parseEducationData(cv?.education);
        
        const cvData = {
          email: cv?.email || null,
          personalInfo: cv?.personalInfo || "",
          experience: experienceData,
          education: educationData,
          projects: projectsData,
          skills: Array.isArray(cv?.skills) ? cv.skills : [],
        };
        
        setEditingCV(cvData);
        setCurrentTab("manage");
        log.info("CV loaded for editing", { 
          email: cvData.email, 
          hasExperience: cvData.experience.length > 0,
          hasProjects: cvData.projects.length > 0,
          skillsCount: cvData.skills.length
        });
      } else {
        setError("No saved CV data found. Please process your CV first.");
      }
      
    } catch (e: any) {
      log.error("Failed to load CV", e);
      setError(e?.message ?? "Failed to load CV data");
    } finally {
      setBusy("");
    }
  }, []);

  // Save updated CV
  const saveUpdatedCV = useCallback(async (updatedCV: any) => {
    try {
      setBusy("💾 Saving CV changes...");
      setError("");
      
      await send("popup", "SAVE_CV", { cv: updatedCV }, { timeoutMs: 60000 });
      
      setEditingCV(updatedCV);
      setCvParsed(updatedCV);
      log.info("CV updated successfully");
      
    } catch (e: any) {
      log.error("Failed to save CV", e);
      setError(e?.message ?? "Failed to save CV");
    } finally {
      setBusy("");
    }
  }, []);

  // Process CV sections
  const onProcessCV = useCallback(async () => {
    if (!mounted.current) return;
    
    try {
      setBusy("🔍 Checking sections...");
      setError("");

      const filledSections = Object.values(cvSections).filter(section => section.trim().length > 0);
      if (filledSections.length === 0) {
        throw new Error("Please fill in at least one CV section before processing.");
      }

      setBusy("🤖 Processing each section with AI Summarization...");

      const result = await send("popup", "PROCESS_CV_SECTIONS", {
        sections: cvSections
      }, { timeoutMs: 600000 });

      setCvParsed(result.cv);
      log.info("CV sections processed and saved successfully", result);

    } catch (e: any) {
      if (!mounted.current) return;
      log.error("❌ CV processing failed", e);
      setError(e?.message ?? "Failed to process CV sections.");
    } finally {
      if (mounted.current) {
        setBusy("");
      }
    }
  }, [cvSections]);

  // Analyze job page
  const onAnalyzeJob = useCallback(async () => {
    if (!mounted.current || !activeTab?.id) return;

    try {
      setBusy("🔍 Analyzing job page...");
      setError("");

      const result = await send("popup", "ANALYZE_JOB", { 
        tabId: activeTab.id 
      }, { timeoutMs: 120000 });

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
      }, { timeoutMs: 60000 });

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
      }, { timeoutMs: 60000 });

      setTailored(typeof result === 'string' ? result : result.text || JSON.stringify(result));
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

  // Handle initialization state
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

        <div className="tab-navigation">
          <button 
            className={`tab-button ${currentTab === "input" ? "active" : ""}`}
            onClick={() => setCurrentTab("input")}
          >
            📝 Input CV
          </button>
          <button 
            className={`tab-button ${currentTab === "manage" ? "active" : ""}`}
            onClick={() => loadCvForEditing()}
          >
            🔧 Manage CV
          </button>
        </div>

        {currentTab === "input" ? (
          <div className="content-grid">
            <CVInputSection 
              cvSections={cvSections}
              onUpdateSection={updateCvSection}
              onProcessCV={onProcessCV}
              hasCv={hasCv}
              busy={Boolean(busy)}
              cvParsed={cvParsed}
            />

            <JobAnalysis 
              site={site}
              job={job}
              onAnalyzeJob={onAnalyzeJob}
              busy={Boolean(busy)}
            />

            <MatchAnalysis 
              cvParsed={cvParsed}
              job={job}
              score={score}
              useAI={useAI}
              onToggleAI={setUseAI}
              onScoreMatch={onScoreMatch}
              busy={Boolean(busy)}
            />

            <CVTailoring 
              cvParsed={cvParsed}
              job={job}
              tailored={tailored}
              onTailorCV={onTailorCV}
              busy={Boolean(busy)}
            />
          </div>
        ) : (
          <CVManageView 
            editingCV={editingCV}
            onSave={saveUpdatedCV}
            onBack={() => setCurrentTab("input")}
          />
        )}
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