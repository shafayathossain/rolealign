// CV Tailoring Engine using Chrome Writer and Rewriter APIs
import { Logger } from "../util/logger";
import { WriterRewriterAI } from "../ai/writer-rewriter";

const log = new Logger({ namespace: "cv-tailoring", level: "debug", persist: true });

export interface CVData {
  personalInfo: {
    name: string;
    email: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    github?: string;
    website?: string;
  };
  summary?: string;
  experience: Array<{
    company: string;
    position: string;
    startDate: string;
    endDate: string;
    location?: string;
    responsibilities: string[];
    achievements?: string[];
    technologies?: string[];
  }>;
  projects: Array<{
    name: string;
    description: string;
    technologies: string[];
    startDate?: string;
    endDate?: string;
    url?: string;
    achievements?: string[];
  }>;
  skills: string[];
  education: Array<{
    institution: string;
    degree: string;
    field?: string;
    startDate?: string;
    endDate?: string;
    gpa?: string;
    location?: string;
  }>;
  certifications?: Array<{
    name: string;
    issuer: string;
    date?: string;
    url?: string;
  }>;
}

export interface JobRequirements {
  title: string;
  company: string;
  description: string;
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  qualifications: string[];
}

export interface TailoredCV extends CVData {
  tailoringScore: number;
  optimizations: {
    selectedProjects: string[];
    enhancedExperiences: string[];
    addedKeywords: string[];
    removedIrrelevant: string[];
  };
}

export class CVTailoringEngine {
  private writer: any = null;
  private rewriter: any = null;
  private jobContext: string = "";

  constructor() {
    log.info("CV Tailoring Engine initialized");
  }

  // Initialize AI models
  async initialize(jobRequirements: JobRequirements, onProgress?: (progress: number) => void): Promise<void> {
    try {
      log.info("Initializing CV Tailoring Engine", { job: jobRequirements.title });

      // Set job context for all AI operations
      this.jobContext = `Job: ${jobRequirements.title} at ${jobRequirements.company}. 
      Focus on: ${jobRequirements.requiredSkills.slice(0, 5).join(', ')}.
      Key responsibilities: ${jobRequirements.responsibilities.slice(0, 3).join('; ')}.`;

      let progressStep = 0;
      const totalSteps = 2;

      // Initialize Writer for creating new content
      onProgress?.((progressStep / totalSteps) * 100);
      this.writer = await WriterRewriterAI.createWriter({
        tone: 'formal',
        format: 'plain-text',
        length: 'medium',
        sharedContext: `Creating tailored CV content for ${this.jobContext}`,
        onDownloadProgress: (modelProgress) => {
          onProgress?.((progressStep / totalSteps) * 100 + (modelProgress / totalSteps * 0.5));
        }
      });

      progressStep++;
      onProgress?.((progressStep / totalSteps) * 100);

      // Initialize Rewriter for optimizing existing content
      this.rewriter = await WriterRewriterAI.createRewriter({
        tone: 'more-formal',
        format: 'plain-text',
        length: 'as-is',
        sharedContext: `Tailoring CV content for ${this.jobContext}`,
        onDownloadProgress: (modelProgress) => {
          onProgress?.((progressStep / totalSteps) * 100 + (modelProgress / totalSteps * 0.5));
        }
      });

      onProgress?.(100);
      log.info("CV Tailoring Engine initialized successfully");
    } catch (error) {
      log.error("Failed to initialize CV Tailoring Engine", { error });
      throw error;
    }
  }

  // Main tailoring function
  async tailorCV(originalCV: CVData, jobRequirements: JobRequirements): Promise<TailoredCV> {
    try {
      log.info("Starting CV tailoring process", { 
        cvProjects: originalCV.projects.length,
        cvExperiences: originalCV.experience.length,
        jobTitle: jobRequirements.title
      });

      const tailoredCV: TailoredCV = {
        ...originalCV,
        tailoringScore: 0,
        optimizations: {
          selectedProjects: [],
          enhancedExperiences: [],
          addedKeywords: [],
          removedIrrelevant: []
        }
      };

      // 1. Create tailored professional summary
      tailoredCV.summary = await this.createTailoredSummary(originalCV, jobRequirements);

      // 2. Select and tailor relevant projects
      const { selectedProjects, projectOptimizations } = await this.selectAndTailorProjects(
        originalCV.projects, 
        jobRequirements
      );
      tailoredCV.projects = selectedProjects;
      tailoredCV.optimizations.selectedProjects = projectOptimizations;

      // 3. Enhance work experience descriptions
      const { enhancedExperiences, experienceOptimizations } = await this.enhanceExperiences(
        originalCV.experience,
        jobRequirements
      );
      tailoredCV.experience = enhancedExperiences;
      tailoredCV.optimizations.enhancedExperiences = experienceOptimizations;

      // 4. Optimize skills section
      tailoredCV.skills = await this.optimizeSkills(originalCV.skills, jobRequirements);

      // 5. Calculate tailoring score
      tailoredCV.tailoringScore = this.calculateTailoringScore(tailoredCV, jobRequirements);

      log.info("CV tailoring completed", { 
        tailoringScore: tailoredCV.tailoringScore,
        projectsSelected: tailoredCV.projects.length,
        optimizations: tailoredCV.optimizations
      });

      return tailoredCV;
    } catch (error) {
      log.error("Failed to tailor CV", { error });
      throw error;
    }
  }

  // Create tailored professional summary
  private async createTailoredSummary(cv: CVData, job: JobRequirements): Promise<string> {
    try {
      const prompt = `Write a professional summary for a ${job.title} position at ${job.company}.
      
      Background: ${cv.experience.length} years of experience in ${cv.experience[0]?.position || 'software development'}.
      Key skills: ${cv.skills.slice(0, 8).join(', ')}.
      Recent role: ${cv.experience[0]?.position} at ${cv.experience[0]?.company}.
      
      Focus on skills relevant to: ${job.requiredSkills.slice(0, 5).join(', ')}.
      Make it compelling for this specific role and company.`;

      const context = `This summary should highlight relevant experience for ${job.title} position.
      Emphasize technical skills that match job requirements.
      Keep it concise (2-3 sentences) and professional.`;

      const summary = await WriterRewriterAI.writeContent(prompt, { 
        context, 
        writer: this.writer 
      }) as string;

      log.debug("Created tailored summary", { summaryLength: summary.length });
      return summary.trim();
    } catch (error) {
      log.error("Failed to create tailored summary", { error });
      return cv.summary || "Experienced professional with strong technical background.";
    }
  }

  // Select and tailor relevant projects
  private async selectAndTailorProjects(
    projects: CVData['projects'], 
    job: JobRequirements
  ): Promise<{ selectedProjects: CVData['projects']; projectOptimizations: string[] }> {
    try {
      // Score projects based on relevance
      const scoredProjects = await Promise.all(
        projects.map(async (project, index) => {
          const relevanceScore = this.calculateProjectRelevance(project, job);
          return { project, relevanceScore, index };
        })
      );

      // Select top 3-4 most relevant projects
      const selectedProjects = scoredProjects
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, 4)
        .map(item => item.project);

      // Tailor selected project descriptions
      const tailoredProjects = await Promise.all(
        selectedProjects.map(async (project) => {
          const tailoredDescription = await this.tailorProjectDescription(project, job);
          return {
            ...project,
            description: tailoredDescription
          };
        })
      );

      const optimizations = selectedProjects.map(p => p.name);

      log.debug("Selected and tailored projects", { 
        totalProjects: projects.length,
        selectedCount: tailoredProjects.length,
        selectedProjects: optimizations
      });

      return { 
        selectedProjects: tailoredProjects, 
        projectOptimizations: optimizations 
      };
    } catch (error) {
      log.error("Failed to select and tailor projects", { error });
      return { selectedProjects: projects.slice(0, 3), projectOptimizations: [] };
    }
  }

  // Calculate project relevance score
  private calculateProjectRelevance(project: CVData['projects'][0], job: JobRequirements): number {
    let score = 0;
    
    // Technology match
    const projectTechs = project.technologies.map(t => t.toLowerCase());
    const jobSkills = [...job.requiredSkills, ...job.preferredSkills].map(s => s.toLowerCase());
    
    const techMatches = projectTechs.filter(tech => 
      jobSkills.some(skill => skill.includes(tech) || tech.includes(skill))
    ).length;
    
    score += techMatches * 10;

    // Description keyword match
    const description = project.description.toLowerCase();
    const jobKeywords = job.description.toLowerCase();
    const commonWords = description.split(' ').filter(word => 
      word.length > 3 && jobKeywords.includes(word)
    ).length;
    
    score += commonWords * 2;

    return Math.min(score, 100);
  }

  // Tailor project description
  private async tailorProjectDescription(
    project: CVData['projects'][0], 
    job: JobRequirements
  ): Promise<string> {
    try {
      const context = `Rewrite this project description to highlight relevance for ${job.title} position.
      Emphasize technologies and achievements that align with: ${job.requiredSkills.slice(0, 5).join(', ')}.
      Keep the same core facts but make it more compelling for this specific role.`;

      const rewrittenDescription = await WriterRewriterAI.rewriteContent(
        project.description, 
        { context, rewriter: this.rewriter }
      ) as string;

      return rewrittenDescription.trim();
    } catch (error) {
      log.error("Failed to tailor project description", { error });
      return project.description;
    }
  }

  // Enhance work experiences
  private async enhanceExperiences(
    experiences: CVData['experience'],
    job: JobRequirements
  ): Promise<{ enhancedExperiences: CVData['experience']; experienceOptimizations: string[] }> {
    try {
      const enhancedExperiences = await Promise.all(
        experiences.map(async (experience) => {
          const enhancedResponsibilities = await Promise.all(
            experience.responsibilities.slice(0, 4).map(async (responsibility) => {
              return await this.enhanceResponsibility(responsibility, job);
            })
          );

          return {
            ...experience,
            responsibilities: enhancedResponsibilities
          };
        })
      );

      const optimizations = experiences.map(exp => `${exp.position} at ${exp.company}`);

      log.debug("Enhanced work experiences", { 
        experienceCount: enhancedExperiences.length,
        optimizations
      });

      return { enhancedExperiences, experienceOptimizations: optimizations };
    } catch (error) {
      log.error("Failed to enhance experiences", { error });
      return { enhancedExperiences: experiences, experienceOptimizations: [] };
    }
  }

  // Enhance individual responsibility
  private async enhanceResponsibility(responsibility: string, job: JobRequirements): Promise<string> {
    try {
      const context = `Rewrite this job responsibility to be more compelling for a ${job.title} position.
      Highlight skills and achievements relevant to: ${job.requiredSkills.slice(0, 3).join(', ')}.
      Use strong action verbs and quantify impact where possible.
      Keep it professional and truthful.`;

      const enhanced = await WriterRewriterAI.rewriteContent(
        responsibility,
        { context, rewriter: this.rewriter }
      ) as string;

      return enhanced.trim();
    } catch (error) {
      log.error("Failed to enhance responsibility", { error });
      return responsibility;
    }
  }

  // Optimize skills section
  private async optimizeSkills(skills: string[], job: JobRequirements): Promise<string[]> {
    try {
      const allJobSkills = [...job.requiredSkills, ...job.preferredSkills];
      const skillsText = skills.join(', ');
      
      const prompt = `Optimize this skills list for a ${job.title} position:
      
      Current skills: ${skillsText}
      Job requirements: ${allJobSkills.join(', ')}
      
      Return a prioritized, comma-separated list that:
      1. Puts most relevant skills first
      2. Groups related technologies
      3. Includes all original skills
      4. Maintains truthfulness`;

      const optimizedSkillsText = await WriterRewriterAI.writeContent(
        prompt,
        { writer: this.writer }
      ) as string;

      const optimizedSkills = optimizedSkillsText
        .split(',')
        .map(skill => skill.trim())
        .filter(skill => skill.length > 0);

      log.debug("Optimized skills", { 
        originalCount: skills.length,
        optimizedCount: optimizedSkills.length
      });

      return optimizedSkills;
    } catch (error) {
      log.error("Failed to optimize skills", { error });
      return skills;
    }
  }

  // Calculate tailoring score
  private calculateTailoringScore(tailoredCV: TailoredCV, job: JobRequirements): number {
    let score = 0;
    const maxScore = 100;

    // Skills alignment (40% of score)
    const skillMatches = tailoredCV.skills.filter(skill =>
      job.requiredSkills.some(reqSkill => 
        skill.toLowerCase().includes(reqSkill.toLowerCase()) ||
        reqSkill.toLowerCase().includes(skill.toLowerCase())
      )
    ).length;
    score += Math.min((skillMatches / job.requiredSkills.length) * 40, 40);

    // Project relevance (30% of score)
    const avgProjectRelevance = tailoredCV.projects.reduce((acc, project) => 
      acc + this.calculateProjectRelevance(project, job), 0
    ) / tailoredCV.projects.length;
    score += (avgProjectRelevance / 100) * 30;

    // Experience enhancement (30% of score)
    score += 30; // Assume enhanced experiences add value

    return Math.round(Math.min(score, maxScore));
  }

  // Cleanup resources
  cleanup(): void {
    try {
      WriterRewriterAI.cleanup();
      this.writer = null;
      this.rewriter = null;
      log.debug("CV Tailoring Engine cleaned up");
    } catch (error) {
      log.error("Error during cleanup", { error });
    }
  }
}

export default CVTailoringEngine;