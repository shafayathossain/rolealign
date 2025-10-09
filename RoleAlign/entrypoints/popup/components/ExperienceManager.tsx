import React, { useState } from "react";

interface ExperienceManagerProps {
  experience: any[];
  onUpdate: (experience: any[]) => void;
}

export function ExperienceManager({ experience, onUpdate }: ExperienceManagerProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newExperience, setNewExperience] = useState({
    title: "",
    company: "",
    location: "",
    startDate: "",
    endDate: "",
    current: false,
    responsibilities: ""
  });

  const handleAdd = () => {
    if (newExperience.title && newExperience.company) {
      const updatedExperience = [...experience, { ...newExperience, id: Date.now() }];
      onUpdate(updatedExperience);
      setNewExperience({
        title: "",
        company: "",
        location: "",
        startDate: "",
        endDate: "",
        current: false,
        responsibilities: ""
      });
      setShowAddForm(false);
    }
  };

  const handleRemove = (id: number) => {
    const updatedExperience = experience.filter((exp: any) => exp.id !== id);
    onUpdate(updatedExperience);
  };

  const handleEdit = (id: number, field: string, value: any) => {
    const updatedExperience = experience.map((exp: any) => 
      exp.id === id ? { ...exp, [field]: value } : exp
    );
    onUpdate(updatedExperience);
  };

  return (
    <div className="experience-section">
      <div className="section-header">
        <h3>💼 Work Experience</h3>
        <button 
          className="btn" 
          onClick={() => setShowAddForm(!showAddForm)}
        >
          {showAddForm ? "✖️ Cancel" : "➕ Add Experience"}
        </button>
      </div>

      {showAddForm && (
        <div className="add-form">
          <h4>📝 Add New Experience</h4>
          <div className="form-grid">
            <div className="form-group">
              <label>Job Title *</label>
              <input
                type="text"
                value={newExperience.title}
                onChange={(e) => setNewExperience({ ...newExperience, title: e.target.value })}
                placeholder="Senior Software Engineer"
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Company *</label>
              <input
                type="text"
                value={newExperience.company}
                onChange={(e) => setNewExperience({ ...newExperience, company: e.target.value })}
                placeholder="Tech Corp"
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Location</label>
              <input
                type="text"
                value={newExperience.location}
                onChange={(e) => setNewExperience({ ...newExperience, location: e.target.value })}
                placeholder="San Francisco, CA"
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Start Date</label>
              <input
                type="month"
                value={newExperience.startDate}
                onChange={(e) => setNewExperience({ ...newExperience, startDate: e.target.value })}
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>End Date</label>
              <input
                type="month"
                value={newExperience.endDate}
                onChange={(e) => setNewExperience({ ...newExperience, endDate: e.target.value })}
                disabled={newExperience.current}
                className="form-input"
              />
            </div>
            
            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={newExperience.current}
                  onChange={(e) => setNewExperience({ 
                    ...newExperience, 
                    current: e.target.checked,
                    endDate: e.target.checked ? "" : newExperience.endDate
                  })}
                />
                Currently working here
              </label>
            </div>
          </div>
          
          <div className="form-group full-width">
            <label>Responsibilities & Achievements</label>
            <textarea
              value={newExperience.responsibilities}
              onChange={(e) => setNewExperience({ ...newExperience, responsibilities: e.target.value })}
              placeholder="• Led team of 5 developers&#10;• Built scalable microservices architecture&#10;• Increased system performance by 40%"
              rows={4}
              className="form-textarea"
            />
          </div>
          
          <div className="form-actions">
            <button className="btn btn-secondary" onClick={() => setShowAddForm(false)}>
              Cancel
            </button>
            <button className="btn" onClick={handleAdd}>
              💾 Add Experience
            </button>
          </div>
        </div>
      )}

      <div className="experience-list">
        {experience.map((exp: any) => (
          <div key={exp.id} className="experience-item">
            <div className="experience-header">
              <div className="experience-title">
                <h4>{exp.title || "Job Title"}</h4>
                <p>{exp.company || "Company"} {exp.location && `• ${exp.location}`}</p>
                <p className="experience-dates">
                  {exp.startDate} - {exp.current ? "Present" : exp.endDate || "End Date"}
                </p>
              </div>
              <button 
                className="remove-btn"
                onClick={() => handleRemove(exp.id)}
                title="Remove experience"
              >
                🗑️
              </button>
            </div>
            <div className="experience-responsibilities">
              <textarea
                value={exp.responsibilities || ""}
                onChange={(e) => handleEdit(exp.id, 'responsibilities', e.target.value)}
                placeholder="Add responsibilities and achievements..."
                rows={3}
                className="manage-textarea"
              />
            </div>
          </div>
        ))}
      </div>

      {experience.length === 0 && !showAddForm && (
        <div className="empty-state-inline">
          <p>No work experience added yet. Click "Add Experience" to get started!</p>
        </div>
      )}
    </div>
  );
}