import React, { useState } from "react";
import { AI } from "../../../src/ai/chrome-ai";
import { Logger } from "../../../src/util/logger";

const log = new Logger({ namespace: "ProjectsManager", level: "debug", persist: true });

interface ProjectsManagerProps {
  projects: any[];
  onUpdate: (projects: any[]) => void;
  onSave: (cv: any) => void;
  localCV: any;
  onCVUpdate?: (cv: any) => void;
}

export function ProjectsManager({ projects, onUpdate, onSave, localCV, onCVUpdate }: ProjectsManagerProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [projectText, setProjectText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);

  const handleAdd = async () => {
    if (!projectText.trim()) return;
    
    log.info("🚀 Starting project addition process", {
      inputLength: projectText.length,
      inputPreview: projectText.substring(0, 100) + "..."
    });
    
    setIsProcessing(true);
    try {
      // First, use Summarize API to enhance and expand the project details
      log.debug("📝 Step 1: Calling Summarize API to enhance project details");
      const enhancedText = await AI.Summarize.text(projectText, {
        type: "key-points",
        format: "markdown",
        length: "long",
        context: "Based on the project information provided, expand and enhance the details by predicting typical development activities, technical challenges, solutions implemented, and achievements that would be expected for this type of project. Generate a minimum of 10-15 comprehensive bullet points covering architecture decisions, technical implementations, problem-solving approaches, performance optimizations, user experience improvements, testing strategies, deployment processes, security implementations, scalability solutions, user impact, team collaboration, and measurable outcomes. Include specific technologies, design patterns, frameworks, tools, development methodologies, and quantifiable results. Make it detailed and professional for CV purposes, showing technical depth and project impact.",
        timeoutMs: 20000
      });
      
      log.info("✅ Summarize API response received", {
        originalLength: projectText.length,
        enhancedLength: enhancedText.length,
        enhancedText: enhancedText
      });

      const schema = {
        type: "object",
        properties: {
          name: { type: "string", description: "Project name - MUST use field name 'name' (REQUIRED - extract from text like 'MyBL App', 'RS Sjøliv app')" },
          description: { type: "string", description: "Project description and achievements formatted as multiple bullet points with line breaks (\n• point 1\n• point 2\n• point 3...)" },
          technologies: { type: "string", description: "Technologies used (comma-separated)" },
          skills: { type: "array", items: { type: "string" }, description: "Array of technical skills, technologies, tools, frameworks, languages, and methodologies mentioned or implied in this project" },
          startDate: { type: "string", description: "Start date (e.g., '2023-01', 'January 2023')" },
          endDate: { type: "string", description: "End date or 'Ongoing' for current projects" },
          url: { type: "string", description: "Project URL or repository link" },
          status: { type: "string", description: "Project status: completed, in-progress, or planned" }
        },
        required: ["name", "description"]
      };

      const prompt = `Extract project information from the following enhanced text. The enhanced text contains expanded technical details based on the original input.

Enhanced Text (AI-generated details):
${enhancedText}

Original Text (user input):
${projectText}

Extract and structure the information. Use the enhanced text for detailed project description but prioritize the original text for factual information like project name, technologies, dates, and URLs.

CRITICAL INSTRUCTIONS:
1. The project name MUST be extracted and put in the "name" field (NOT "project_name")
2. Look for explicit project names like "MyBL App", "RS Sjøliv app" in the original text
3. Use enhanced text for comprehensive description with technical details
4. Format description as multiple bullet points with line breaks
5. Each description point should start with "• " and be on a new line
6. Generate MINIMUM 10 detailed bullet points for the description
7. Cover different aspects: architecture, implementation, testing, deployment, performance, security, user experience, collaboration
8. Include all the detailed achievements and technical implementations from enhanced text
9. EXTRACT ALL SKILLS: Extract all technical skills, programming languages, frameworks, tools, libraries, databases, cloud platforms, methodologies, etc. mentioned or implied
10. Skills should include both explicit mentions and implied skills based on the project type and technologies
7. The JSON field MUST be called "name", not "project_name"

Look for project names in original text:
- Explicit project names (e.g., "MyBL App", "RS Sjøliv app")
- App names or product names
- Company/service names if it's a company project
- Descriptive titles if no explicit name exists

EXAMPLE OUTPUT (MINIMUM 10 POINTS):
{
  "name": "MyBL App",
  "description": "• Developed native Android application using Kotlin and MVVM architecture with Clean Architecture principles\n• Implemented real-time data synchronization with RESTful APIs using Retrofit and Room database\n• Designed responsive UI components following Material Design guidelines and accessibility standards\n• Integrated push notifications using Firebase Cloud Messaging for user engagement\n• Implemented offline data caching and synchronization for seamless user experience\n• Achieved 95% crash-free sessions and 4.8 star rating with 50,000+ downloads\n• Optimized app performance reducing load times by 60% through lazy loading and image compression\n• Implemented comprehensive unit and UI testing with JUnit and Espresso achieving 85% code coverage\n• Integrated third-party services including Google Maps, payment gateways, and social media APIs\n• Deployed to Google Play Store using CI/CD pipeline with automated testing and release management\n• Implemented security measures including SSL pinning, data encryption, and secure authentication\n• Collaborated with UX/UI designers using Figma and conducted user testing sessions",
  "technologies": "Kotlin, MVVM, Android Architecture Components, Firebase, Retrofit, Room",
  "status": "completed"
}

Return a JSON object with the project details including extracted skills array. Use field name "name" for the project name. For technologies, provide as comma-separated string. For status, use one of: completed, in-progress, planned.

EXAMPLE WITH SKILLS:
{
  "name": "E-commerce Platform",
  "description": "• Developed full-stack application...",
  "technologies": "React, Node.js, PostgreSQL, AWS",
  "skills": ["React", "Node.js", "PostgreSQL", "AWS", "JavaScript", "TypeScript", "Express.js", "Docker", "CI/CD", "RESTful APIs", "Git", "Stripe API", "Material-UI", "Redux", "JWT"]
}`;

      log.debug("🤖 Step 2: Calling Prompt API to extract structured data", {
        promptLength: prompt.length,
        schema: schema
      });

      const parsedProject = await AI.Prompt.json<any>(prompt, { schema, timeoutMs: 30000 });
      
      log.info("✅ Prompt API response received", {
        parsedProject: parsedProject,
        extractedName: parsedProject?.name || parsedProject?.project_name,
        extractedTechnologies: parsedProject?.technologies,
        extractedDescription: parsedProject?.description?.substring(0, 100) + "...",
        extractedSkills: parsedProject?.skills
      });
      
      // Map field names to handle inconsistencies from AI
      const newProject = {
        name: parsedProject?.name || parsedProject?.project_name || "Unnamed Project",
        description: parsedProject?.description,
        technologies: parsedProject?.technologies,
        startDate: parsedProject?.startDate,
        endDate: parsedProject?.endDate,
        url: parsedProject?.url,
        status: parsedProject?.status || "completed",
        id: Date.now()
      };

      log.info("📦 Step 3: Creating new project object", {
        newProject: newProject,
        projectId: newProject.id,
        finalName: newProject.name,
        finalTechnologies: newProject.technologies
      });

      const updatedProjects = [...projects, newProject];
      onUpdate(updatedProjects);
      
      log.debug("📝 Step 4: Updated local state", {
        previousCount: projects.length,
        newCount: updatedProjects.length
      });
      
      // Extract and merge skills
      const extractedSkills = parsedProject?.skills || [];
      const existingSkills = localCV.skills || [];
      const mergedSkills = [...new Set([...existingSkills, ...extractedSkills])];
      
      log.debug("🔧 Step 5: Merging skills", {
        extractedSkills: extractedSkills,
        existingSkillsCount: existingSkills.length,
        newSkillsCount: extractedSkills.length,
        mergedSkillsCount: mergedSkills.length
      });
      
      // Save to database
      const updatedCV = {
        ...localCV,
        projects: updatedProjects,
        skills: mergedSkills
      };
      
      log.debug("💾 Step 6: Saving to database", {
        cvProjectsCount: updatedCV.projects.length,
        cvSkillsCount: updatedCV.skills.length,
        cvId: localCV.id || "new"
      });
      
      await onSave(updatedCV);
      
      log.info("✅ Step 7: Successfully saved to database");
      
      // Update parent component's local state to reflect the new skills
      if (onCVUpdate) {
        onCVUpdate(updatedCV);
        log.debug("🔄 Triggered parent component update for skills");
      }
      
      setProjectText("");
      setShowAddForm(false);
      setShowSuccessPopup(true);
      
      log.info("🎉 Project addition completed successfully!", {
        finalProjectName: newProject.name,
        totalProjects: updatedProjects.length,
        skillsExtracted: extractedSkills.length,
        totalSkills: mergedSkills.length
      });
    } catch (error) {
      log.error("❌ Project addition failed", {
        error: error,
        errorMessage: error instanceof Error ? error.message : String(error),
        inputText: projectText.substring(0, 200) + "..."
      });
      console.error("Failed to parse project:", error);
      alert("Failed to parse project text. Please try again or check your input.");
    } finally {
      setIsProcessing(false);
      log.debug("🏁 Project addition process ended");
    }
  };

  const handleSuccessConfirm = () => {
    setShowSuccessPopup(false);
    // No page reload needed - skills are already saved to database
    // and will appear in Skills tab when user switches to it
  };

  const handleRemove = async (id: number) => {
    log.info("🗑️ Starting project deletion", { projectId: id });
    
    const updatedProjects = projects.filter((proj: any) => proj.id !== id);
    onUpdate(updatedProjects);
    
    log.debug("📝 Updated local state after deletion", {
      previousCount: projects.length,
      newCount: updatedProjects.length,
      deletedProjectId: id
    });
    
    // Save to database
    const updatedCV = {
      ...localCV,
      projects: updatedProjects
    };
    
    try {
      log.debug("💾 Saving deletion to database");
      await onSave(updatedCV);
      log.info("✅ Project successfully deleted from database", {
        deletedProjectId: id,
        remainingProjects: updatedProjects.length
      });
    } catch (error) {
      log.error("❌ Failed to save deletion to database", {
        error: error,
        projectId: id
      });
      console.error("Failed to delete project:", error);
      alert("Failed to delete project. Please try again.");
    }
  };

  const handleEdit = async (id: number, field: string, value: any) => {
    const updatedProjects = projects.map((proj: any) => 
      proj.id === id ? { ...proj, [field]: value } : proj
    );
    onUpdate(updatedProjects);
    
    // Save to database after edit
    const updatedCV = {
      ...localCV,
      projects: updatedProjects
    };
    
    try {
      await onSave(updatedCV);
      log.debug("✅ Project edit saved to database", {
        projectId: id,
        field: field,
        newValue: value?.substring?.(0, 50) + "..." || value
      });
    } catch (error) {
      log.error("❌ Failed to save project edit", {
        error: error,
        projectId: id,
        field: field
      });
      console.error("Failed to save project edit:", error);
    }
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
          <p className="form-description">
            Paste your project text below. AI will automatically extract the project name, technologies, dates, and generate enhanced detailed description with technical implementations and achievements based on your input.
          </p>
          
          <div className="form-group full-width">
            <label>Project Text *</label>
            <textarea
              value={projectText}
              onChange={(e) => setProjectText(e.target.value)}
              placeholder={`E-commerce Platform (2023)
Technologies: React, Node.js, PostgreSQL, AWS
GitHub: https://github.com/username/ecommerce

Built a full-stack e-commerce platform with user authentication, product catalog, shopping cart, and payment processing. Implemented microservices architecture and deployed on AWS with 99.9% uptime. Served 10,000+ users with real-time inventory management.

Technical Responsibilities:
• Designed and implemented RESTful APIs using Node.js and Express
• Built responsive frontend with React and TypeScript
• Integrated Stripe payment processing and order management
• Optimized database queries achieving 40% performance improvement`}
              rows={10}
              className="form-textarea"
              disabled={isProcessing}
            />
          </div>
          
          <div className="form-actions">
            <button className="btn btn-secondary" onClick={() => {
              setShowAddForm(false);
              setProjectText("");
            }}>
              Cancel
            </button>
            <button 
              className="btn" 
              onClick={handleAdd}
              disabled={!projectText.trim() || isProcessing}
            >
              {isProcessing ? "🤖 Processing..." : "🤖 Parse & Add Project"}
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
                placeholder="Add project description (minimum 10 points)...\n• First achievement\n• Second achievement\n• Third achievement\n• Fourth achievement\n• Fifth achievement\n• Sixth achievement\n• Seventh achievement\n• Eighth achievement\n• Ninth achievement\n• Tenth achievement"
                rows={12}
                className="manage-textarea"
                style={{ whiteSpace: 'pre-wrap' }}
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

      {showSuccessPopup && (
        <div className="popup-overlay" onClick={(e) => e.target === e.currentTarget && setShowSuccessPopup(false)}>
          <div className="success-popup">
            <div className="popup-header">
              <h3>✅ Project Added Successfully!</h3>
            </div>
            <div className="popup-content">
              <p>Your project has been processed and saved to your CV.</p>
            </div>
            <div className="popup-actions">
              <button className="btn" onClick={handleSuccessConfirm}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}