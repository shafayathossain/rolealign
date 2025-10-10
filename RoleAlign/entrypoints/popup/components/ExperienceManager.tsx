import React, { useState } from "react";
import { AI } from "../../../src/ai/chrome-ai";
import { Logger } from "../../../src/util/logger";

const log = new Logger({ namespace: "ExperienceManager", level: "debug", persist: true });

interface ExperienceManagerProps {
  experience: any[];
  onUpdate: (experience: any[]) => void;
  onSave: (cv: any) => void;
  localCV: any;
  onCVUpdate?: (cv: any) => void;
}

export function ExperienceManager({ experience, onUpdate, onSave, localCV, onCVUpdate }: ExperienceManagerProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [experienceText, setExperienceText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);

  const handleAdd = async () => {
    if (!experienceText.trim()) return;
    
    log.info("🚀 Starting experience addition process", {
      inputLength: experienceText.length,
      inputPreview: experienceText.substring(0, 100) + "..."
    });
    
    setIsProcessing(true);
    try {
      // First, use Summarize API to enhance and expand the experience details
      log.debug("📝 Step 1: Calling Summarize API to enhance experience details");
      const enhancedText = await AI.Summarize.text(experienceText, {
        type: "key-points",
        format: "markdown", 
        length: "long",
        context: "Based on the work experience provided, expand and enhance the details by predicting typical responsibilities, achievements, and impact for this role. Generate a minimum of 10-15 comprehensive bullet points covering technical skills, leadership activities, project outcomes, process improvements, team collaboration, mentoring, problem-solving, innovation, measurable achievements, and industry best practices that would be expected for someone in this position. Include specific technologies, methodologies, frameworks, tools, and quantifiable results. Make it detailed and professional for CV purposes with rich technical depth.",
        timeoutMs: 20000
      });
      
      log.info("✅ Summarize API response received", {
        originalLength: experienceText.length,
        enhancedLength: enhancedText.length,
        enhancedText: enhancedText
      });

      const schema = {
        type: "object",
        properties: {
          title: { type: "string", description: "Job title or position (REQUIRED - extract from text)" },
          company: { type: "string", description: "Company name (REQUIRED - extract from text)" },
          location: { type: "string", description: "Work location (city, state, country)" },
          startDate: { type: "string", description: "Start date (e.g., '2020-01', 'January 2020')" },
          endDate: { type: "string", description: "End date or 'Present' for current position" },
          current: { type: "boolean", description: "Whether this is a current position" },
          responsibilities: { type: "string", description: "Job responsibilities and achievements formatted as multiple bullet points with line breaks (\n• point 1\n• point 2\n• point 3...)" },
          skills: { type: "array", items: { type: "string" }, description: "Array of technical skills, technologies, tools, frameworks, and methodologies mentioned or implied in this experience" }
        },
        required: ["title", "company"]
      };

      const prompt = `Extract work experience information from the following enhanced text. The enhanced text contains expanded details based on the original input.

Enhanced Text (AI-generated details):
${enhancedText}

Original Text (user input):
${experienceText}

Extract and structure the information. Use the enhanced text for detailed responsibilities but prioritize the original text for factual information like job title, company, dates, and location.

CRITICAL: 
- Extract job title and company name from original text
- Use enhanced text for comprehensive responsibilities section
- Format responsibilities as multiple bullet points with line breaks
- Each responsibility should start with "• " and be on a new line
- Include all the detailed achievements and responsibilities from the enhanced text
- The responsibilities field should contain MINIMUM 10 bullet points
- Each bullet point should be detailed and specific
- Cover different aspects: technical skills, leadership, collaboration, problem-solving, achievements, tools, methodologies
- EXTRACT ALL SKILLS: Extract all technical skills, programming languages, frameworks, tools, methodologies, databases, cloud platforms, etc. mentioned or implied
- Skills should include both explicit mentions and implied skills based on the role and responsibilities
- The responsibilities field should look like: "• First responsibility\n• Second responsibility\n• Third responsibility\n• Fourth responsibility\n• Fifth responsibility\n• Sixth responsibility\n• Seventh responsibility\n• Eighth responsibility\n• Ninth responsibility\n• Tenth responsibility"

EXAMPLE RESPONSIBILITIES FORMAT (MINIMUM 10 POINTS):
"• Led development team of 5 engineers in designing scalable microservices architecture using Docker and Kubernetes\n• Implemented CI/CD pipelines with Jenkins and GitLab reducing deployment time from 2 hours to 15 minutes\n• Optimized database queries and indexing strategies resulting in 40% performance improvement\n• Mentored 3 junior developers through code reviews, pair programming, and technical guidance\n• Collaborated with product team to define technical requirements and sprint planning\n• Designed and implemented RESTful APIs serving 10,000+ concurrent users\n• Established coding standards and best practices improving code quality by 35%\n• Implemented automated testing frameworks achieving 90% code coverage\n• Led incident response and troubleshooting for production systems with 99.9% uptime\n• Conducted technical interviews and participated in hiring decisions for engineering team\n• Researched and evaluated new technologies leading to adoption of React and Node.js\n• Implemented security measures including OAuth 2.0 and data encryption protocols"

Return a JSON object with the experience details including extracted skills array. For dates, use format like "2020-01" or "January 2020". Set current to true if it's mentioned as current position.

EXAMPLE WITH SKILLS:
{
  "title": "Senior Software Engineer",
  "company": "Tech Corp",
  "location": "San Francisco, CA",
  "startDate": "2020-01",
  "endDate": "Present",
  "current": true,
  "responsibilities": "• Led development team...",
  "skills": ["JavaScript", "React", "Node.js", "Docker", "Kubernetes", "AWS", "PostgreSQL", "CI/CD", "Git", "Agile", "Microservices", "REST APIs", "TypeScript", "Jenkins", "OAuth"]
}`;

      log.debug("🤖 Step 2: Calling Prompt API to extract structured data", {
        promptLength: prompt.length,
        schema: schema
      });

      const parsedExperience = await AI.Prompt.json<any>(prompt, { schema, timeoutMs: 30000 });
      
      log.info("✅ Prompt API response received", {
        parsedExperience: parsedExperience,
        extractedTitle: parsedExperience?.title,
        extractedCompany: parsedExperience?.company,
        extractedLocation: parsedExperience?.location,
        extractedSkills: parsedExperience?.skills
      });
      
      const newExperience = {
        ...parsedExperience,
        id: Date.now(),
        current: parsedExperience?.current || false
      };

      log.info("📦 Step 3: Creating new experience object", {
        newExperience: newExperience,
        experienceId: newExperience.id,
        finalTitle: newExperience.title,
        finalCompany: newExperience.company
      });

      const updatedExperience = [...experience, newExperience];
      onUpdate(updatedExperience);
      
      log.debug("📝 Step 4: Updated local state", {
        previousCount: experience.length,
        newCount: updatedExperience.length
      });
      
      // Extract and merge skills
      const extractedSkills = parsedExperience?.skills || [];
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
        experience: updatedExperience,
        skills: mergedSkills
      };
      
      log.debug("💾 Step 6: Saving to database", {
        cvExperienceCount: updatedCV.experience.length,
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
      
      setExperienceText("");
      setShowAddForm(false);
      setShowSuccessPopup(true);
      
      log.info("🎉 Experience addition completed successfully!", {
        finalTitle: newExperience.title,
        finalCompany: newExperience.company,
        totalExperience: updatedExperience.length,
        skillsExtracted: extractedSkills.length,
        totalSkills: mergedSkills.length
      });
    } catch (error) {
      log.error("❌ Experience addition failed", {
        error: error,
        errorMessage: error instanceof Error ? error.message : String(error),
        inputText: experienceText.substring(0, 200) + "..."
      });
      console.error("Failed to parse experience:", error);
      alert("Failed to parse experience text. Please try again or check your input.");
    } finally {
      setIsProcessing(false);
      log.debug("🏁 Experience addition process ended");
    }
  };

  const handleSuccessConfirm = () => {
    setShowSuccessPopup(false);
    // No page reload needed - skills are already saved to database
    // and will appear in Skills tab when user switches to it
  };

  const handleRemove = async (id: number) => {
    log.info("🗑️ Starting experience deletion", { experienceId: id });
    
    const updatedExperience = experience.filter((exp: any) => exp.id !== id);
    onUpdate(updatedExperience);
    
    log.debug("📝 Updated local state after deletion", {
      previousCount: experience.length,
      newCount: updatedExperience.length,
      deletedExperienceId: id
    });
    
    // Save to database
    const updatedCV = {
      ...localCV,
      experience: updatedExperience
    };
    
    try {
      log.debug("💾 Saving deletion to database");
      await onSave(updatedCV);
      log.info("✅ Experience successfully deleted from database", {
        deletedExperienceId: id,
        remainingExperience: updatedExperience.length
      });
    } catch (error) {
      log.error("❌ Failed to save deletion to database", {
        error: error,
        experienceId: id
      });
      console.error("Failed to delete experience:", error);
      alert("Failed to delete experience. Please try again.");
    }
  };

  const handleEdit = async (id: number, field: string, value: any) => {
    const updatedExperience = experience.map((exp: any) => 
      exp.id === id ? { ...exp, [field]: value } : exp
    );
    onUpdate(updatedExperience);
    
    // Save to database after edit
    const updatedCV = {
      ...localCV,
      experience: updatedExperience
    };
    
    try {
      await onSave(updatedCV);
      log.debug("✅ Experience edit saved to database", {
        experienceId: id,
        field: field,
        newValue: value?.substring?.(0, 50) + "..." || value
      });
    } catch (error) {
      log.error("❌ Failed to save experience edit", {
        error: error,
        experienceId: id,
        field: field
      });
      console.error("Failed to save experience edit:", error);
    }
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
          <p className="form-description">
            Paste your work experience text below. AI will automatically extract the job title, company, dates, and generate enhanced detailed responsibilities and achievements based on your input.
          </p>
          
          <div className="form-group full-width">
            <label>Experience Text *</label>
            <textarea
              value={experienceText}
              onChange={(e) => setExperienceText(e.target.value)}
              placeholder={`Senior Software Engineer at Tech Corp
San Francisco, CA
January 2020 - Present

• Led team of 5 developers on microservices architecture
• Built scalable backend systems serving 1M+ users
• Increased system performance by 40% through optimization
• Implemented CI/CD pipelines reducing deployment time by 60%`}
              rows={8}
              className="form-textarea"
              disabled={isProcessing}
            />
          </div>
          
          <div className="form-actions">
            <button className="btn btn-secondary" onClick={() => {
              setShowAddForm(false);
              setExperienceText("");
            }}>
              Cancel
            </button>
            <button 
              className="btn" 
              onClick={handleAdd}
              disabled={!experienceText.trim() || isProcessing}
            >
              {isProcessing ? "🤖 Processing..." : "🤖 Parse & Add Experience"}
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
                placeholder="Add responsibilities and achievements (minimum 10 points)...\n• First responsibility\n• Second responsibility\n• Third responsibility\n• Fourth responsibility\n• Fifth responsibility\n• Sixth responsibility\n• Seventh responsibility\n• Eighth responsibility\n• Ninth responsibility\n• Tenth responsibility"
                rows={12}
                className="manage-textarea"
                style={{ whiteSpace: 'pre-wrap' }}
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

      {showSuccessPopup && (
        <div className="popup-overlay" onClick={(e) => e.target === e.currentTarget && setShowSuccessPopup(false)}>
          <div className="success-popup">
            <div className="popup-header">
              <h3>✅ Experience Added Successfully!</h3>
            </div>
            <div className="popup-content">
              <p>Your work experience has been processed and saved to your CV.</p>
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