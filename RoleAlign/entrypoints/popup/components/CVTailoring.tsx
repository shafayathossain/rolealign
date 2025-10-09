import React from "react";

interface CVTailoringProps {
  cvParsed: any;
  job: any;
  tailored: string;
  onTailorCV: () => void;
  busy: boolean;
}

export function CVTailoring({ 
  cvParsed, 
  job, 
  tailored, 
  onTailorCV, 
  busy 
}: CVTailoringProps) {
  if (!cvParsed || !job) return null;

  return (
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
  );
}