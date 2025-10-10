// CV PDF Generator - React PDF integration with fallback
import { Logger } from "../util/logger";
import { TailoredCV } from "./tailoring-engine";

const log = new Logger({ namespace: "pdf-generator", level: "debug", persist: true });

export interface PDFGenerationOptions {
  format?: 'A4' | 'Letter';
  margin?: number;
  fontSize?: number;
  theme?: 'modern' | 'classic' | 'minimal';
}

export class CVPDFGenerator {
  
  // Generate PDF using React PDF (if available)
  static async generateReactPDF(tailoredCV: TailoredCV, options: PDFGenerationOptions = {}): Promise<Blob> {
    try {
      // Check if React PDF is available (would be bundled separately)
      if (typeof window !== 'undefined' && (window as any).ReactPDF) {
        log.info("Using React PDF for generation");
        
        const { pdf } = (window as any).ReactPDF;
        const { CVDocument } = await import('./CVDocument');
        
        // Create React element
        const doc = React.createElement(CVDocument, { cv: tailoredCV });
        
        // Generate PDF blob
        const blob = await pdf(doc).toBlob();
        
        log.info("React PDF generated successfully", {
          size: blob.size,
          type: blob.type
        });
        
        return blob;
      } else {
        log.warn("React PDF not available, falling back to HTML method");
        return await this.generateHTMLPDF(tailoredCV, options);
      }
    } catch (error) {
      log.error("React PDF generation failed, falling back", { error });
      return await this.generateHTMLPDF(tailoredCV, options);
    }
  }

  // Generate HTML-based PDF (fallback method)
  static async generateHTMLPDF(tailoredCV: TailoredCV, options: PDFGenerationOptions = {}): Promise<Blob> {
    try {
      log.info("Generating HTML-based PDF", { 
        name: tailoredCV.personalInfo.name,
        tailoringScore: tailoredCV.tailoringScore 
      });

      const htmlContent = this.generateCVHTML(tailoredCV, options);
      
      // For actual PDF generation, we would need a library like jsPDF or Puppeteer
      // For now, return HTML blob that can be printed to PDF
      const pdfBlob = new Blob([htmlContent], { type: 'text/html' });
      
      log.info("HTML PDF generated successfully", {
        size: pdfBlob.size,
        type: pdfBlob.type
      });

      return pdfBlob;
    } catch (error) {
      log.error("Failed to generate HTML PDF", { error });
      throw error;
    }
  }
  
  // Generate CV HTML content for PDF conversion
  static generateCVHTML(tailoredCV: TailoredCV, options: PDFGenerationOptions = {}): string {
    const { 
      format = 'A4', 
      margin = 40, 
      fontSize = 12, 
      theme = 'modern' 
    } = options;

    const themeStyles = this.getThemeStyles(theme, fontSize);
    
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${tailoredCV.personalInfo.name} - CV</title>
  <style>
    @page {
      size: ${format};
      margin: ${margin}px;
    }
    
    ${themeStyles}
    
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: ${fontSize}px;
      line-height: 1.4;
      color: #333;
      margin: 0;
      padding: 0;
    }
    
    .cv-container {
      max-width: 100%;
      margin: 0 auto;
    }
    
    .header {
      text-align: center;
      border-bottom: 2px solid #2563eb;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    
    .name {
      font-size: ${fontSize + 8}px;
      font-weight: bold;
      color: #1e40af;
      margin-bottom: 8px;
    }
    
    .contact-info {
      font-size: ${fontSize - 1}px;
      color: #6b7280;
      display: flex;
      justify-content: center;
      gap: 20px;
      flex-wrap: wrap;
    }
    
    .section {
      margin-bottom: 25px;
      page-break-inside: avoid;
    }
    
    .section-title {
      font-size: ${fontSize + 2}px;
      font-weight: bold;
      color: #1e40af;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 5px;
      margin-bottom: 15px;
    }
    
    .summary {
      font-style: italic;
      color: #4b5563;
      line-height: 1.6;
    }
    
    .experience-item, .project-item, .education-item {
      margin-bottom: 20px;
      page-break-inside: avoid;
    }
    
    .item-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 8px;
    }
    
    .item-title {
      font-weight: bold;
      color: #1f2937;
    }
    
    .item-company {
      font-weight: 600;
      color: #2563eb;
    }
    
    .item-date {
      font-size: ${fontSize - 1}px;
      color: #6b7280;
      white-space: nowrap;
    }
    
    .item-location {
      font-size: ${fontSize - 1}px;
      color: #6b7280;
      font-style: italic;
    }
    
    .responsibilities, .achievements {
      margin-top: 8px;
    }
    
    .responsibilities ul, .achievements ul {
      margin: 0;
      padding-left: 20px;
    }
    
    .responsibilities li, .achievements li {
      margin-bottom: 5px;
    }
    
    .technologies {
      margin-top: 8px;
      font-size: ${fontSize - 1}px;
    }
    
    .tech-label {
      font-weight: 600;
      color: #4b5563;
    }
    
    .tech-list {
      color: #6b7280;
    }
    
    .skills-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    
    .skill-tag {
      background: #f3f4f6;
      color: #374151;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: ${fontSize - 1}px;
      border: 1px solid #e5e7eb;
    }
    
    .optimization-badge {
      background: #dcfce7;
      color: #16a34a;
      font-size: ${fontSize - 2}px;
      padding: 2px 6px;
      border-radius: 3px;
      margin-left: 8px;
    }
    
    @media print {
      .cv-container {
        width: 100%;
        margin: 0;
      }
      
      .section {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="cv-container">
    ${this.generateHeaderHTML(tailoredCV)}
    ${this.generateSummaryHTML(tailoredCV)}
    ${this.generateExperienceHTML(tailoredCV)}
    ${this.generateProjectsHTML(tailoredCV)}
    ${this.generateSkillsHTML(tailoredCV)}
    ${this.generateEducationHTML(tailoredCV)}
    ${this.generateCertificationsHTML(tailoredCV)}
  </div>
</body>
</html>`;
  }

  private static getThemeStyles(theme: string, fontSize: number): string {
    switch (theme) {
      case 'classic':
        return `
          .header { border-bottom: 3px double #333; }
          .section-title { color: #333; text-transform: uppercase; letter-spacing: 1px; }
          .name { color: #333; }
        `;
      case 'minimal':
        return `
          .header { border-bottom: 1px solid #ccc; }
          .section-title { color: #555; font-weight: 500; }
          .name { color: #555; }
        `;
      default: // modern
        return '';
    }
  }

  private static generateHeaderHTML(cv: TailoredCV): string {
    const { personalInfo } = cv;
    const contactItems = [
      personalInfo.email,
      personalInfo.phone,
      personalInfo.location,
      personalInfo.linkedin,
      personalInfo.github,
      personalInfo.website
    ].filter(Boolean);

    return `
      <div class="header">
        <div class="name">${personalInfo.name}</div>
        <div class="contact-info">
          ${contactItems.map(item => `<span>${item}</span>`).join('')}
        </div>
      </div>
    `;
  }

  private static generateSummaryHTML(cv: TailoredCV): string {
    if (!cv.summary) return '';
    
    return `
      <div class="section">
        <div class="section-title">Professional Summary</div>
        <div class="summary">${cv.summary}</div>
      </div>
    `;
  }

  private static generateExperienceHTML(cv: TailoredCV): string {
    if (!cv.experience.length) return '';

    const experienceItems = cv.experience.map(exp => {
      const isOptimized = cv.optimizations.enhancedExperiences.includes(`${exp.position} at ${exp.company}`);
      
      return `
        <div class="experience-item">
          <div class="item-header">
            <div>
              <div class="item-title">${exp.position}${isOptimized ? '<span class="optimization-badge">Optimized</span>' : ''}</div>
              <div class="item-company">${exp.company}</div>
              ${exp.location ? `<div class="item-location">${exp.location}</div>` : ''}
            </div>
            <div class="item-date">${exp.startDate} - ${exp.endDate}</div>
          </div>
          ${exp.responsibilities.length ? `
            <div class="responsibilities">
              <ul>
                ${exp.responsibilities.map(resp => `<li>${resp}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          ${exp.achievements?.length ? `
            <div class="achievements">
              <strong>Key Achievements:</strong>
              <ul>
                ${exp.achievements.map(ach => `<li>${ach}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          ${exp.technologies?.length ? `
            <div class="technologies">
              <span class="tech-label">Technologies:</span>
              <span class="tech-list">${exp.technologies.join(', ')}</span>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="section">
        <div class="section-title">Professional Experience</div>
        ${experienceItems}
      </div>
    `;
  }

  private static generateProjectsHTML(cv: TailoredCV): string {
    if (!cv.projects.length) return '';

    const projectItems = cv.projects.map(project => {
      const isSelected = cv.optimizations.selectedProjects.includes(project.name);
      
      return `
        <div class="project-item">
          <div class="item-header">
            <div>
              <div class="item-title">${project.name}${isSelected ? '<span class="optimization-badge">Selected</span>' : ''}</div>
              ${project.url ? `<div><a href="${project.url}" style="color: #2563eb; text-decoration: none;">${project.url}</a></div>` : ''}
            </div>
            ${project.startDate && project.endDate ? `
              <div class="item-date">${project.startDate} - ${project.endDate}</div>
            ` : ''}
          </div>
          <div style="margin-top: 8px;">${project.description}</div>
          ${project.technologies.length ? `
            <div class="technologies">
              <span class="tech-label">Technologies:</span>
              <span class="tech-list">${project.technologies.join(', ')}</span>
            </div>
          ` : ''}
          ${project.achievements?.length ? `
            <div class="achievements" style="margin-top: 8px;">
              <strong>Achievements:</strong>
              <ul>
                ${project.achievements.map(ach => `<li>${ach}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="section">
        <div class="section-title">Key Projects</div>
        ${projectItems}
      </div>
    `;
  }

  private static generateSkillsHTML(cv: TailoredCV): string {
    if (!cv.skills.length) return '';

    return `
      <div class="section">
        <div class="section-title">Technical Skills</div>
        <div class="skills-container">
          ${cv.skills.map(skill => `<span class="skill-tag">${skill}</span>`).join('')}
        </div>
      </div>
    `;
  }

  private static generateEducationHTML(cv: TailoredCV): string {
    if (!cv.education.length) return '';

    const educationItems = cv.education.map(edu => `
      <div class="education-item">
        <div class="item-header">
          <div>
            <div class="item-title">${edu.degree}${edu.field ? ` in ${edu.field}` : ''}</div>
            <div class="item-company">${edu.institution}</div>
            ${edu.location ? `<div class="item-location">${edu.location}</div>` : ''}
          </div>
          ${edu.startDate && edu.endDate ? `
            <div class="item-date">${edu.startDate} - ${edu.endDate}</div>
          ` : ''}
        </div>
        ${edu.gpa ? `<div style="margin-top: 5px;">GPA: ${edu.gpa}</div>` : ''}
      </div>
    `).join('');

    return `
      <div class="section">
        <div class="section-title">Education</div>
        ${educationItems}
      </div>
    `;
  }

  private static generateCertificationsHTML(cv: TailoredCV): string {
    if (!cv.certifications?.length) return '';

    const certItems = cv.certifications.map(cert => `
      <div style="margin-bottom: 15px;">
        <div class="item-title">${cert.name}</div>
        <div style="color: #2563eb; font-weight: 600;">${cert.issuer}</div>
        ${cert.date ? `<div style="color: #6b7280; font-size: 11px;">${cert.date}</div>` : ''}
        ${cert.url ? `<div><a href="${cert.url}" style="color: #2563eb; text-decoration: none; font-size: 11px;">${cert.url}</a></div>` : ''}
      </div>
    `).join('');

    return `
      <div class="section">
        <div class="section-title">Certifications</div>
        ${certItems}
      </div>
    `;
  }

  // Main PDF generation method - tries React PDF first, falls back to HTML
  static async generatePDF(tailoredCV: TailoredCV, options: PDFGenerationOptions = {}): Promise<Blob> {
    try {
      // Try React PDF first for better quality
      return await this.generateReactPDF(tailoredCV, options);
    } catch (error) {
      log.warn("React PDF failed, using HTML fallback", { error });
      return await this.generateHTMLPDF(tailoredCV, options);
    }
  }

  // Download the generated CV
  static downloadCV(pdfBlob: Blob, filename: string = 'tailored-cv.html'): void {
    try {
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      log.info("CV downloaded successfully", { filename });
    } catch (error) {
      log.error("Failed to download CV", { error });
      throw error;
    }
  }
}

export default CVPDFGenerator;