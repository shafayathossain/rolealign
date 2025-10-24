import React, { useState, useEffect } from "react";
import { SkillsManager } from "./SkillsManager";
import { ExperienceManager } from "./ExperienceManager";
import { ProjectsManager } from "./ProjectsManager";

interface CVManageViewProps {
  editingCV: any;
  onSave: (cv: any) => void;
  onBack: () => void;
}

export function CVManageView({ editingCV, onSave, onBack }: CVManageViewProps) {
  const [localCV, setLocalCV] = useState(editingCV);
  const [activeSection, setActiveSection] = useState<string>("overview");

  useEffect(() => {
    setLocalCV(editingCV);
  }, [editingCV]);

  if (!editingCV) {
    return (
      <div className="cv-manage-empty">
        <div className="empty-state">
          <h3>📋 No CV Data Found</h3>
          <p>Process your CV first to view and edit structured data.</p>
          <button className="btn" onClick={onBack}>
            ← Back to Input
          </button>
        </div>
      </div>
    );
  }

  const handleSave = () => {
    onSave(localCV);
  };
  
  const handleCVUpdate = (updatedCV: any) => {
    setLocalCV(updatedCV);
    console.log('✅ CV updated with new skills', { 
      skillsCount: updatedCV.skills?.length || 0,
      skills: updatedCV.skills 
    });
  };

  const updateSection = (section: string, value: any) => {
    setLocalCV((prev: any) => ({
      ...prev,
      [section]: value
    }));
  };

  const addSkill = async (newSkill: string) => {
    if (newSkill.trim() && !localCV.skills?.includes(newSkill.trim())) {
      const updatedSkills = [...(localCV.skills || []), newSkill.trim()];
      const updatedCV = { ...localCV, skills: updatedSkills };
      setLocalCV(updatedCV);
      
      // Save to database immediately
      try {
        await onSave(updatedCV);
        console.log('✅ Skill added and saved to database');
      } catch (error) {
        console.error('❌ Failed to save skill addition:', error);
      }
    }
  };

  const removeSkill = async (skillToRemove: string) => {
    const updatedSkills = localCV.skills?.filter((skill: string) => skill !== skillToRemove) || [];
    const updatedCV = { ...localCV, skills: updatedSkills };
    setLocalCV(updatedCV);
    
    // Save to database immediately
    try {
      await onSave(updatedCV);
      console.log('✅ Skill removed and saved to database');
    } catch (error) {
      console.error('❌ Failed to save skill removal:', error);
    }
  };

  return (
    <div className="cv-manage-container">
      <div className="manage-header">
        <button className="btn btn-secondary" onClick={onBack}>
          ← Back to Input
        </button>
        <h2>🔧 Manage Your CV</h2>
        <button className="btn" onClick={handleSave}>
          💾 Save Changes
        </button>
      </div>

      <div className="manage-tabs">
        <button 
          className={`manage-tab ${activeSection === "overview" ? "active" : ""}`}
          onClick={() => setActiveSection("overview")}
        >
          📊 Overview
        </button>
        <button 
          className={`manage-tab ${activeSection === "skills" ? "active" : ""}`}
          onClick={() => setActiveSection("skills")}
        >
          🛠️ Skills
        </button>
        <button 
          className={`manage-tab ${activeSection === "experience" ? "active" : ""}`}
          onClick={() => setActiveSection("experience")}
        >
          💼 Experience
        </button>
        <button 
          className={`manage-tab ${activeSection === "projects" ? "active" : ""}`}
          onClick={() => setActiveSection("projects")}
        >
          📂 Projects
        </button>
      </div>

      <div className="manage-content">
        {activeSection === "overview" && (
          <div className="overview-section">
            <div className="cv-overview-card">
              <h3>📋 CV Summary</h3>
              <div className="overview-stats">
                <div className="stat">
                  <span className="stat-number">{localCV.skills?.length || 0}</span>
                  <span className="stat-label">Skills</span>
                </div>
                <div className="stat">
                  <span className="stat-number">
                    {Array.isArray(localCV.experience) ? localCV.experience.length : 0}
                  </span>
                  <span className="stat-label">Experiences</span>
                </div>
                <div className="stat">
                  <span className="stat-number">
                    {Array.isArray(localCV.projects) ? localCV.projects.length : 0}
                  </span>
                  <span className="stat-label">Projects</span>
                </div>
              </div>
              
              <div className="overview-data">
                <div className="data-section">
                  <h4>👤 Personal Info</h4>
                  <textarea
                    value={localCV.personalInfo || ""}
                    onChange={(e) => updateSection('personalInfo', e.target.value)}
                    rows={3}
                    className="manage-textarea"
                  />
                </div>
                
                <div className="data-section">
                  <h4>🎓 Education</h4>
                  <textarea
                    value={typeof localCV.education === 'string' ? localCV.education : 
                      Array.isArray(localCV.education) ? 
                        localCV.education.map((edu: any) => 
                          `${edu.degree || 'Degree'} at ${edu.institution || 'Institution'} ${edu.location ? `(${edu.location})` : ''} — ${edu.period || 'Period'}`
                        ).join('\n') : 
                      localCV.education || ""}
                    onChange={(e) => updateSection('education', e.target.value)}
                    rows={3}
                    className="manage-textarea"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === "skills" && (
          <SkillsManager 
            skills={localCV.skills || []}
            onAdd={addSkill}
            onRemove={removeSkill}
          />
        )}

        {activeSection === "experience" && (
          <ExperienceManager 
            experience={Array.isArray(localCV.experience) ? localCV.experience : []}
            onUpdate={(experience) => updateSection('experience', experience)}
            onSave={onSave}
            localCV={localCV}
            onCVUpdate={handleCVUpdate}
          />
        )}

        {activeSection === "projects" && (
          <ProjectsManager 
            projects={Array.isArray(localCV.projects) ? localCV.projects : []}
            onUpdate={(projects) => updateSection('projects', projects)}
            onSave={onSave}
            localCV={localCV}
            onCVUpdate={handleCVUpdate}
          />
        )}
      </div>
    </div>
  );
}