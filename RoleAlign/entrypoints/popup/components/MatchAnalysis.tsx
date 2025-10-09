import React from "react";

interface MatchAnalysisProps {
  cvParsed: any;
  job: any;
  score: any;
  useAI: boolean;
  onToggleAI: (value: boolean) => void;
  onScoreMatch: () => void;
  busy: boolean;
}

export function MatchAnalysis({ 
  cvParsed, 
  job, 
  score, 
  useAI, 
  onToggleAI, 
  onScoreMatch, 
  busy 
}: MatchAnalysisProps) {
  if (!cvParsed || !job) return null;

  return (
    <section className="match-section">
      <h2>📊 Match Analysis</h2>
      
      <div className="match-controls">
        <label className="ai-toggle">
          <input
            type="checkbox"
            checked={useAI}
            onChange={(e) => onToggleAI(e.target.checked)}
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
  );
}