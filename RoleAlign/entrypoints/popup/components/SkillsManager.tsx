import React, { useState } from "react";

interface SkillsManagerProps {
  skills: string[];
  onAdd: (skill: string) => void;
  onRemove: (skill: string) => void;
}

export function SkillsManager({ skills, onAdd, onRemove }: SkillsManagerProps) {
  const [newSkill, setNewSkill] = useState("");

  const handleAdd = () => {
    if (newSkill.trim()) {
      onAdd(newSkill.trim());
      setNewSkill("");
    }
  };

  return (
    <div className="skills-manager">
      <div className="skills-header">
        <h3>🛠️ Skills Management</h3>
        <div className="add-skill">
          <input
            type="text"
            value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Add new skill..."
            className="skill-input"
          />
          <button className="btn" onClick={handleAdd}>
            ➕ Add
          </button>
        </div>
      </div>

      <div className="skills-grid">
        {skills.map((skill, index) => (
          <div key={index} className="skill-item">
            <span className="skill-name">{skill}</span>
            <button 
              className="remove-skill"
              onClick={() => onRemove(skill)}
              title="Remove skill"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {skills.length === 0 && (
        <div className="empty-skills">
          <p>No skills added yet. Add your first skill above!</p>
        </div>
      )}
    </div>
  );
}