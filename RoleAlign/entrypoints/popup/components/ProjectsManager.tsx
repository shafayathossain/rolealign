import React, { useState } from "react";

interface ProjectsManagerProps {
  projects: any[];
  onUpdate: (projects: any[]) => void;
}

export function ProjectsManager({ projects, onUpdate }: ProjectsManagerProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProject, setNewProject] = useState({
    name: "",
    description: "",
    technologies: "",
    startDate: "",
    endDate: "",
    url: "",
    status: "completed"
  });

  const handleAdd = () => {
    if (newProject.name && newProject.description) {
      const updatedProjects = [...projects, { ...newProject, id: Date.now() }];
      onUpdate(updatedProjects);
      setNewProject({
        name: "",
        description: "",
        technologies: "",
        startDate: "",
        endDate: "",
        url: "",
        status: "completed"
      });
      setShowAddForm(false);
    }
  };

  const handleRemove = (id: number) => {
    const updatedProjects = projects.filter((proj: any) => proj.id !== id);
    onUpdate(updatedProjects);
  };

  const handleEdit = (id: number, field: string, value: any) => {
    const updatedProjects = projects.map((proj: any) => 
      proj.id === id ? { ...proj, [field]: value } : proj
    );
    onUpdate(updatedProjects);
  };

  return (
    <div className="projects-section">
      <div className="section-header">
        <h3>📂 Projects</h3>
        <button 
          className="btn" 
          onClick={() => setShowAddForm(!showAddForm)}
        >
          {showAddForm ? "✖️ Cancel" : "➕ Add Project"}
        </button>
      </div>

      {showAddForm && (
        <div className="add-form">
          <h4>📝 Add New Project</h4>
          <div className="form-grid">
            <div className="form-group">
              <label>Project Name *</label>
              <input
                type="text"
                value={newProject.name}
                onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                placeholder="E-commerce Platform"
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Technologies</label>
              <input
                type="text"
                value={newProject.technologies}
                onChange={(e) => setNewProject({ ...newProject, technologies: e.target.value })}
                placeholder="React, Node.js, PostgreSQL"
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Start Date</label>
              <input
                type="month"
                value={newProject.startDate}
                onChange={(e) => setNewProject({ ...newProject, startDate: e.target.value })}
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>End Date</label>
              <input
                type="month"
                value={newProject.endDate}
                onChange={(e) => setNewProject({ ...newProject, endDate: e.target.value })}
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Project URL</label>
              <input
                type="url"
                value={newProject.url}
                onChange={(e) => setNewProject({ ...newProject, url: e.target.value })}
                placeholder="https://github.com/username/project"
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Status</label>
              <select
                value={newProject.status}
                onChange={(e) => setNewProject({ ...newProject, status: e.target.value })}
                className="form-select"
              >
                <option value="completed">Completed</option>
                <option value="in-progress">In Progress</option>
                <option value="planned">Planned</option>
              </select>
            </div>
          </div>
          
          <div className="form-group full-width">
            <label>Project Description *</label>
            <textarea
              value={newProject.description}
              onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
              placeholder="Built a full-stack e-commerce platform with user authentication, product catalog, shopping cart, and payment processing..."
              rows={4}
              className="form-textarea"
            />
          </div>
          
          <div className="form-actions">
            <button className="btn btn-secondary" onClick={() => setShowAddForm(false)}>
              Cancel
            </button>
            <button className="btn" onClick={handleAdd}>
              💾 Add Project
            </button>
          </div>
        </div>
      )}

      <div className="projects-list">
        {projects.map((proj: any) => (
          <div key={proj.id} className="project-item">
            <div className="project-header">
              <div className="project-title">
                <h4>{proj.name || "Project Name"}</h4>
                <p className="project-meta">
                  {proj.technologies && <span className="tech-tag">{proj.technologies}</span>}
                  {proj.status && <span className={`status-tag ${proj.status}`}>{proj.status}</span>}
                </p>
                <p className="project-dates">
                  {proj.startDate} - {proj.endDate || "Ongoing"}
                  {proj.url && (
                    <a href={proj.url} target="_blank" rel="noopener noreferrer" className="project-link">
                      🔗 View Project
                    </a>
                  )}
                </p>
              </div>
              <button 
                className="remove-btn"
                onClick={() => handleRemove(proj.id)}
                title="Remove project"
              >
                🗑️
              </button>
            </div>
            <div className="project-description">
              <textarea
                value={proj.description || ""}
                onChange={(e) => handleEdit(proj.id, 'description', e.target.value)}
                placeholder="Add project description..."
                rows={3}
                className="manage-textarea"
              />
            </div>
          </div>
        ))}
      </div>

      {projects.length === 0 && !showAddForm && (
        <div className="empty-state-inline">
          <p>No projects added yet. Click "Add Project" to get started!</p>
        </div>
      )}
    </div>
  );
}