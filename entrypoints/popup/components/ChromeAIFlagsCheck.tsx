import React, { useEffect, useState } from "react";
import { AI } from "../../../src/ai/chrome-ai";

interface FlagStatus {
  prompt: string;
  summarizer: string;
}

export function ChromeAIFlagsCheck({ onFlagsValid }: { onFlagsValid: (valid: boolean) => void }) {
  const [flagStatus, setFlagStatus] = useState<FlagStatus | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkFlags();
  }, []);

  const checkFlags = async () => {
    setChecking(true);
    try {
      const [prompt, summarizer] = await Promise.all([
        AI.Availability.prompt(),
        AI.Availability.summarizer()
      ]);

      const status = { prompt, summarizer };
      setFlagStatus(status);

      // Only accept fully available APIs for CV generation (more strict)
      const isValid = (prompt === "available" || prompt === "readily") && 
                     (summarizer === "available" || summarizer === "readily");
      
      onFlagsValid(isValid);
    } catch (error) {
      console.error("Failed to check AI flags:", error);
      onFlagsValid(false);
    } finally {
      setChecking(false);
    }
  };

  const openChromeFlags = () => {
    chrome.tabs.create({ url: "chrome://flags" });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "available": return "✅";
      case "downloadable": return "⏬";
      case "downloading": return "🔄";
      case "api-missing": return "❌";
      case "unavailable": return "❌";
      default: return "❓";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "available": return "Available";
      case "downloadable": return "Ready to download";
      case "downloading": return "Downloading...";
      case "api-missing": return "API not found";
      case "unavailable": return "Unavailable";
      default: return "Unknown";
    }
  };

  const isRequired = (api: string) => true; // All APIs are required
  const isApiValid = (status: string) => status === "available" || status === "readily";

  if (checking) {
    return (
      <div className="flags-check-container">
        <div className="flags-check-header">
          <h2>🔍 Checking Chrome AI Availability...</h2>
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  const allRequiredValid = flagStatus && 
    isApiValid(flagStatus.prompt) && 
    isApiValid(flagStatus.summarizer);

  if (allRequiredValid) {
    return null; // Don't show the component if flags are valid
  }

  return (
    <div className="flags-check-container">
      <div className="flags-check-header">
        <h2>⚙️ Chrome AI Setup Required</h2>
        <p>RoleAlign requires Chrome's built-in AI APIs to function. Please enable the required flags:</p>
      </div>

      <div className="flags-status">
        {flagStatus && Object.entries(flagStatus).map(([api, status]) => {
          const required = isRequired(api);
          const valid = isApiValid(status);
          
          return (
            <div key={api} className={`flag-item ${required ? 'required' : 'optional'} ${valid ? 'valid' : 'invalid'}`}>
              <div className="flag-info">
                <span className="flag-icon">{getStatusIcon(status)}</span>
                <div className="flag-details">
                  <strong>
                    {api === "prompt" ? "Prompt API (Gemini Nano)" : 
                     api === "summarizer" ? "Summarizer API (Gemini Nano)" :
                     api === "writer" ? "Writer API (Gemini Nano)" :
                     "Rewriter API (Gemini Nano)"}
                  </strong>
                  <span className="flag-status-text">{getStatusText(status)}</span>
                  <span className="required-badge">Required</span>
                  {api === "prompt" && (
                    <div className="api-usage">Used for: CV extraction, job analysis, match scoring, CV tailoring</div>
                  )}
                  {api === "summarizer" && (
                    <div className="api-usage">Used for: Job requirements summarization</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flags-instructions">
        <h3>📋 Setup Required Chrome AI Flags:</h3>
        <ol>
          <li>Click "Open Chrome Flags" below</li>
          <li>Enable these <strong>2 required flags</strong>:
            <ul>
              <li><code>#prompt-api-for-gemini-nano</code> → <strong>Enabled</strong></li>
              <li><code>#summarization-api-for-gemini-nano</code> → <strong>Enabled</strong></li>
            </ul>
          </li>
          <li>Restart Chrome completely</li>
          <li>Reopen RoleAlign extension</li>
        </ol>
        <div className="setup-note">
          <strong>Note:</strong> Both APIs are required for RoleAlign's functionality including CV extraction, job analysis, match scoring, and CV tailoring.
        </div>
      </div>

      <div className="flags-actions">
        <button 
          className="primary-button"
          onClick={openChromeFlags}
        >
          🔧 Open Chrome Flags
        </button>
        <button 
          className="secondary-button"
          onClick={checkFlags}
        >
          🔄 Recheck Flags
        </button>
      </div>

      <div className="flags-note">
        <p><strong>Note:</strong> With automated setup, flags may show "Default" but still work. 
        Test with: <code>console.log('AI available:', !!globalThis.ai?.languageModel)</code></p>
      </div>
    </div>
  );
}