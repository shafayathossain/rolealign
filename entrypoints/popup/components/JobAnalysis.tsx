import React from "react";
import { JobSite } from "../utils/helpers";

interface JobAnalysisProps {
  site: JobSite;
  job: any;
  onAnalyzeJob: () => void;
  busy: boolean;
}

export function JobAnalysis({ site, job, onAnalyzeJob, busy }: JobAnalysisProps) {
  return (
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
          <h3>{String((job as any).title || "Job Title")}</h3>
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
  );
}