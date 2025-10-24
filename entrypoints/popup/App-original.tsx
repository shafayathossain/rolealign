import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { send } from "../../src/messaging/bus";
import type {
  AnalyzeJobRes,
  ScoreMatchRes,
} from "../../src/messaging/types";
import { Logger } from "../../src/util/logger";

const log = new Logger({ namespace: "popup", level: "debug", persist: true });

type JobSite = "linkedin" | "indeed" | "unknown";

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  try {
    if (typeof chrome === "undefined" || !chrome.tabs) {
      throw new Error("Chrome APIs not available");
    }
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs?.[0] ?? null;
  } catch (e) {
    log.error("getActiveTab failed", e);
    return null;
  }
}

interface CVSections {
  personalInfo: string;
  experience: string;
  education: string;
  skills: string;
  projects: string;
}

function detectSite(url?: string): JobSite {
  if (!url) return "unknown";
  const u = url.toLowerCase();
  if (u.includes("linkedin.com")) return "linkedin";
  if (u.includes("indeed.com")) return "indeed";
  return "unknown";
}

function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const handleError = (error: any) => {
      console.error("🚨 [RoleAlign] React Error Boundary caught:", error);
      setHasError(true);
    };

    window.addEventListener("error", handleError);
    return () => window.removeEventListener("error", handleError);
  }, []);

  if (hasError) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        <h3>Something went wrong</h3>
        <button onClick={() => setHasError(false)}>Try again</button>
      </div>
    );
  }

  return <>{children}</>;
}

// CV Management Component
interface CVManageViewProps {
  editingCV: any;
  onSave: (cv: any) => void;
  onBack: () => void;
}

function CVManageView({ editingCV, onSave, onBack }: CVManageViewProps) {
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

  const updateSection = (section: string, value: any) => {
    setLocalCV((prev: any) => ({
      ...prev,
      [section]: value
    }));
  };

  const addSkill = (newSkill: string) => {
    if (newSkill.trim() && !localCV.skills?.includes(newSkill.trim())) {
      const updatedSkills = [...(localCV.skills || []), newSkill.trim()];
      updateSection('skills', updatedSkills);
    }
  };

  const removeSkill = (skillToRemove: string) => {
    const updatedSkills = localCV.skills?.filter((skill: string) => skill !== skillToRemove) || [];
    updateSection('skills', updatedSkills);
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
          />
        )}

        {activeSection === "projects" && (
          <ProjectsManager 
            projects={Array.isArray(localCV.projects) ? localCV.projects : []}
            onUpdate={(projects) => updateSection('projects', projects)}
          />
        )}
      </div>
    </div>
  );
}

// Experience Management Component
interface ExperienceManagerProps {
  experience: any[];
  onUpdate: (experience: any[]) => void;
}

function ExperienceManager({ experience, onUpdate }: ExperienceManagerProps) {
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

// Projects Management Component
interface ProjectsManagerProps {
  projects: any[];
  onUpdate: (projects: any[]) => void;
}

function ProjectsManager({ projects, onUpdate }: ProjectsManagerProps) {
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

// Skills Management Component
interface SkillsManagerProps {
  skills: string[];
  onAdd: (skill: string) => void;
  onRemove: (skill: string) => void;
}

function SkillsManager({ skills, onAdd, onRemove }: SkillsManagerProps) {
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

function AppContent() {
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
  const abortController = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      mounted.current = false;
      abortController.current?.abort();
    };
  }, []);

  const site = useMemo(() => detectSite(activeUrl), [activeUrl]);
  
  const hasCv = useMemo(() => 
    Object.values(cvSections).some(section => section.trim().length > 0), 
    [cvSections]
  );

  const jobSiteDisplayName = useMemo(() => {
    switch (site) {
      case "linkedin": return "LinkedIn";
      case "indeed": return "Indeed";
      default: return "Unknown Site";
    }
  }, [site]);

  // Initialize popup
  useEffect(() => {
    (async () => {
      try {
        log.info("Initializing popup...");
        
        // Get stored CV
        const cvResult = await send("popup", "GET_CV", {}, { timeoutMs: 4000 });
        if (cvResult.cv) {
          setCvParsed(cvResult.cv);
        }

        // Get active tab (non-fatal if it fails)
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
      
      const result = await send("popup", "GET_CV", {}, { timeoutMs: 5000 });
      
      if (result?.cv) {
        // Parse and structure the CV data properly
        const cv = result.cv as any;
        
        // Helper function to parse JSON strings from AI processing
        const parseJsonString = (value: any): any => {
          if (typeof value === 'string') {
            // Remove markdown code blocks and clean the string
            let cleanValue = value.replace(/```json\s*|\s*```/g, '').trim();
            
            // Handle the specific format where the entire value starts with ```json
            if (cleanValue.startsWith('```json')) {
              cleanValue = cleanValue.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
            }
            
            try {
              log.info("Attempting to parse JSON", { originalLength: value.length, cleanedLength: cleanValue.length, preview: cleanValue.substring(0, 100) });
              const parsed = JSON.parse(cleanValue);
              log.info("Successfully parsed JSON", { keys: Object.keys(parsed) });
              return parsed;
            } catch (e) {
              log.error("Failed to parse JSON string", { 
                cleanValue: cleanValue.substring(0, 200), 
                error: e,
                originalValue: value.substring(0, 200)
              });
              return null; // Return null instead of original to indicate parsing failure
            }
          }
          return value;
        };
        
        // Parse experience data
        let experienceData = [];
        if (cv?.experience) {
          log.info("Processing experience data", { type: typeof cv.experience, isString: typeof cv.experience === 'string', preview: typeof cv.experience === 'string' ? cv.experience.substring(0, 100) : cv.experience });
          
          const parsedExp = parseJsonString(cv.experience);
          log.info("Parsed experience result", { parsedExp, hasParsedExp: !!parsedExp, hasPositions: !!parsedExp?.positions });
          
          if (parsedExp?.positions && Array.isArray(parsedExp.positions)) {
            log.info("Found positions array", { count: parsedExp.positions.length });
            experienceData = parsedExp.positions.map((pos: any, index: number) => {
              // Parse the period string to extract dates
              let startDate = "";
              let endDate = "";
              let current = false;
              
              if (pos.period) {
                // Handle different date separators: " - ", " — ", " – "
                const periodParts = pos.period.split(/\s*[-—–]\s*/);
                startDate = periodParts[0] || "";
                if (periodParts[1]) {
                  if (periodParts[1].toLowerCase().includes('present') || periodParts[1].includes('2025')) {
                    current = true;
                    endDate = "";
                  } else {
                    endDate = periodParts[1];
                  }
                }
              }
              
              const mappedPosition = {
                id: Date.now() + index,
                title: pos.title || "",
                company: pos.company || "",
                location: pos.location || "",
                startDate: startDate,
                endDate: endDate,
                current: current,
                responsibilities: Array.isArray(pos.responsibilities) ? pos.responsibilities.join('\n• ') : (pos.responsibilities || "")
              };
              
              log.info("Mapped position", { original: pos.title, mapped: mappedPosition });
              return mappedPosition;
            });
            log.info("Final experience data", { count: experienceData.length });
          } else if (Array.isArray(cv.experience)) {
            experienceData = cv.experience;
            log.info("Using existing array experience data", { count: experienceData.length });
          } else {
            log.warn("Could not parse experience data", { parsedExp, originalType: typeof cv.experience });
          }
        }
        
        // Parse projects data
        let projectsData = [];
        if (cv?.projects) {
          const parsedProj = parseJsonString(cv.projects);
          if (parsedProj?.projects && Array.isArray(parsedProj.projects)) {
            projectsData = parsedProj.projects.map((proj: any, index: number) => ({
              id: Date.now() + index + 1000,
              name: proj.name || "",
              description: Array.isArray(proj.responsibilities) ? proj.responsibilities.join('\n• ') : (proj.description || proj.responsibilities || ""),
              technologies: Array.isArray(proj.technologies) ? proj.technologies.join(', ') : (proj.technologies || ""),
              startDate: proj.startDate || "",
              endDate: proj.endDate || "",
              url: proj.url || "",
              status: proj.status || "completed"
            }));
          } else if (Array.isArray(cv.projects)) {
            projectsData = cv.projects;
          }
        }
        
        // Parse education data
        let educationData = cv?.education || "";
        if (cv?.education && typeof cv.education === 'string') {
          const parsedEdu = parseJsonString(cv.education);
          if (parsedEdu?.education && Array.isArray(parsedEdu.education)) {
            // Convert parsed education array to formatted string
            educationData = parsedEdu.education.map((edu: any) => 
              `${edu.degree || 'Degree'} at ${edu.institution || 'Institution'} ${edu.location ? `(${edu.location})` : ''} — ${edu.period || 'Period'}`
            ).join('\n');
            log.info("Parsed education data", { count: parsedEdu.education.length, formatted: educationData });
          } else {
            log.warn("Could not parse education JSON, keeping original", { type: typeof cv.education, preview: cv.education.substring(0, 100) });
          }
        }
        
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
      
      await send("popup", "SAVE_CV", { cv: updatedCV }, { timeoutMs: 5000 });
      
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

  // Process CV sections with summarization
  const onProcessCV = useCallback(async () => {
    if (!mounted.current) return;
    
    try {
      setBusy("🔍 Checking sections...");
      setError("");

      // Check if at least some sections are filled
      const filledSections = Object.values(cvSections).filter(section => section.trim().length > 0);
      if (filledSections.length === 0) {
        throw new Error("Please fill in at least one CV section before processing.");
      }

      setBusy("🤖 Processing each section with AI Summarization...");

      const result = await send("popup", "PROCESS_CV_SECTIONS", {
        sections: cvSections
      }, { timeoutMs: 120000 });

      // CV is now automatically saved in the background with email association
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
  }, [cvSections, activeTab]);

  // Analyze job page
  const onAnalyzeJob = useCallback(async () => {
    if (!mounted.current || !activeTab?.id) return;

    try {
      setBusy("🔍 Analyzing job page...");
      setError("");

      const result = await send("popup", "ANALYZE_JOB", { tabId: activeTab.id }, { timeoutMs: 120000 });

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

        {/* Tab Navigation */}
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
            {/* CV Input Section - Full width */}
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
                  onChange={(e) => updateCvSection("personalInfo", e.target.value)}
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
                  onChange={(e) => updateCvSection("experience", e.target.value)}
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
                  onChange={(e) => updateCvSection("education", e.target.value)}
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
                  onChange={(e) => updateCvSection("skills", e.target.value)}
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
                  onChange={(e) => updateCvSection("projects", e.target.value)}
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

          {/* Job Analysis Section */}
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

          {/* Matching Section */}
          {cvParsed && job && (
            <section className="match-section">
              <h2>📊 Match Analysis</h2>
              
              <div className="match-controls">
                <label className="ai-toggle">
                  <input
                    type="checkbox"
                    checked={useAI}
                    onChange={(e) => setUseAI(e.target.checked)}
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
          )}

          {/* CV Tailoring Section */}
          {cvParsed && job && (
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
          )}
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