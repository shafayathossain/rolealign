import React from "react";
import { CVSections } from "../utils/helpers";

interface CVInputSectionProps {
  cvSections: CVSections;
  onUpdateSection: (section: keyof CVSections, value: string) => void;
  onProcessCV: () => void;
  hasCv: boolean;
  busy: boolean;
  cvParsed: any;
}

export function CVInputSection({ 
  cvSections, 
  onUpdateSection, 
  onProcessCV, 
  hasCv, 
  busy, 
  cvParsed 
}: CVInputSectionProps) {
  return (
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
            onChange={(e) => onUpdateSection("personalInfo", e.target.value)}
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
            onChange={(e) => onUpdateSection("experience", e.target.value)}
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
            onChange={(e) => onUpdateSection("education", e.target.value)}
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
            onChange={(e) => onUpdateSection("skills", e.target.value)}
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
            onChange={(e) => onUpdateSection("projects", e.target.value)}
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
  );
}