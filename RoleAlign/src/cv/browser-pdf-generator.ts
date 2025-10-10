// Browser-native PDF generation without external dependencies
import { Logger } from "../util/logger";
import { TailoredCV } from "./tailoring-engine";

const log = new Logger({ namespace: "browser-pdf", level: "debug", persist: true });

export interface PDFGenerationOptions {
  format?: 'A4' | 'Letter';
  margin?: string;
  fontSize?: string;
  theme?: 'modern' | 'classic' | 'minimal';
}

export class BrowserPDFGenerator {
  
  // Generate professional HTML that's optimized for PDF conversion
  static generatePrintableHTML(cv: TailoredCV, options: PDFGenerationOptions = {}): string {
    const { 
      format = 'A4', 
      margin = '0.75in', 
      fontSize = '11pt',
      theme = 'modern' 
    } = options;

    const themeColors = this.getThemeColors(theme);
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${cv.personalInfo.name} - Tailored CV</title>
  <style>
    @page {
      size: ${format};
      margin: ${margin};
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Times New Roman', serif;
      font-size: ${fontSize};
      line-height: 1.4;
      color: #333;
      background: white;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    
    .cv-container {
      max-width: 8.5in;
      margin: 0 auto;
      background: white;
      min-height: 100vh;
    }
    
    .header {
      text-align: center;
      border-bottom: 2pt solid ${themeColors.primary};
      padding-bottom: 12pt;
      margin-bottom: 18pt;
      page-break-inside: avoid;
    }
    
    .name {
      font-size: 18pt;
      font-weight: bold;
      color: ${themeColors.primary};
      margin-bottom: 6pt;
      letter-spacing: 0.5pt;
    }
    
    .contact-info {
      font-size: 10pt;
      color: ${themeColors.secondary};
      line-height: 1.3;
    }
    
    .contact-line {
      margin-bottom: 2pt;
    }
    
    .section {
      margin-bottom: 16pt;
      page-break-inside: avoid;
    }
    
    .section-title {
      font-size: 13pt;
      font-weight: bold;
      color: ${themeColors.primary};
      border-bottom: 1pt solid ${themeColors.border};
      padding-bottom: 2pt;
      margin-bottom: 8pt;
      text-transform: uppercase;
      letter-spacing: 0.5pt;
    }
    
    .summary {
      font-style: italic;
      color: ${themeColors.text};
      line-height: 1.5;
      text-align: justify;
      margin-bottom: 4pt;
    }
    
    .item {
      margin-bottom: 12pt;
      page-break-inside: avoid;
    }
    
    .item-header {
      margin-bottom: 4pt;
    }
    
    .item-title {
      font-weight: bold;
      color: ${themeColors.text};
      font-size: 11pt;
    }
    
    .item-company {
      font-weight: 600;
      color: ${themeColors.primary};
      font-size: 10pt;
    }
    
    .item-date {
      font-size: 9pt;
      color: ${themeColors.secondary};
      float: right;
      font-style: italic;
    }
    
    .item-location {
      font-size: 9pt;
      color: ${themeColors.secondary};
      font-style: italic;
    }
    
    .item-description {
      margin-top: 3pt;
      color: ${themeColors.text};
      text-align: justify;
    }
    
    .responsibilities {
      margin-top: 4pt;
    }
    
    .responsibilities ul {
      margin: 0;
      padding-left: 16pt;
      list-style-type: disc;
    }
    
    .responsibilities li {
      margin-bottom: 2pt;
      text-align: justify;
      color: ${themeColors.text};
    }
    
    .technologies {
      margin-top: 4pt;
      font-size: 9pt;
      color: ${themeColors.secondary};
    }
    
    .tech-label {
      font-weight: 600;
    }
    
    .skills-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120pt, 1fr));
      gap: 3pt;
      margin-top: 4pt;
    }
    
    .skill-item {
      background: ${themeColors.skillBg};
      color: ${themeColors.text};
      padding: 2pt 6pt;
      border-radius: 2pt;
      font-size: 9pt;
      text-align: center;
      border: 0.5pt solid ${themeColors.border};
    }
    
    .optimization-badge {
      background: ${themeColors.success};
      color: white;
      font-size: 7pt;
      padding: 1pt 3pt;
      border-radius: 2pt;
      margin-left: 4pt;
      font-weight: 600;
    }
    
    .two-column {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8pt;
      align-items: start;
    }
    
    .clear-float {
      clear: both;
    }
    
    @media print {
      body {
        font-size: 10pt;
      }
      
      .cv-container {
        width: 100%;
        margin: 0;
      }
      
      .section {
        page-break-inside: avoid;
      }
      
      .item {
        page-break-inside: avoid;
      }
      
      .header {
        page-break-after: avoid;
      }
    }
    
    @media screen {
      .cv-container {
        box-shadow: 0 0 10px rgba(0,0,0,0.1);
        margin: 20px auto;
        padding: 40px;
        background: white;
      }
      
      body {
        background: #f5f5f5;
        padding: 20px;
      }
    }
  </style>
</head>
<body>
  <div class="cv-container">
    ${this.generateHeaderSection(cv)}
    ${this.generateSummarySection(cv)}
    ${this.generateExperienceSection(cv)}
    ${this.generateProjectsSection(cv)}
    ${this.generateSkillsSection(cv)}
    ${this.generateEducationSection(cv)}
    ${this.generateCertificationsSection(cv)}
  </div>
</body>
</html>`;
  }

  private static getThemeColors(theme: string) {
    switch (theme) {
      case 'classic':
        return {
          primary: '#000000',
          secondary: '#444444',
          text: '#333333',
          border: '#cccccc',
          skillBg: '#f9f9f9',
          success: '#228B22'
        };
      case 'minimal':
        return {
          primary: '#555555',
          secondary: '#777777',
          text: '#444444',
          border: '#dddddd',
          skillBg: '#fafafa',
          success: '#888888'
        };
      default: // modern
        return {
          primary: '#1e40af',
          secondary: '#6b7280',
          text: '#374151',
          border: '#e5e7eb',
          skillBg: '#f3f4f6',
          success: '#059669'
        };
    }
  }

  private static generateHeaderSection(cv: TailoredCV): string {
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
          ${contactItems.map(item => `<div class="contact-line">${this.escapeHtml(item)}</div>`).join('')}
        </div>
      </div>
    `;
  }

  private static generateSummarySection(cv: TailoredCV): string {
    if (!cv.summary) return '';
    
    return `
      <div class="section">
        <div class="section-title">Professional Summary</div>
        <div class="summary">${this.escapeHtml(cv.summary)}</div>
      </div>
    `;
  }

  private static generateExperienceSection(cv: TailoredCV): string {
    if (!cv.experience?.length) return '';

    const experienceItems = cv.experience.map(exp => {
      const isOptimized = cv.optimizations.enhancedExperiences.includes(`${exp.position} at ${exp.company}`);
      
      return `
        <div class="item">
          <div class="item-header">
            <div class="two-column">
              <div>
                <div class="item-title">
                  ${this.escapeHtml(exp.position)}
                  ${isOptimized ? '<span class="optimization-badge">Enhanced</span>' : ''}
                </div>
                <div class="item-company">${this.escapeHtml(exp.company)}</div>
                ${exp.location ? `<div class="item-location">${this.escapeHtml(exp.location)}</div>` : ''}
              </div>
              <div class="item-date">${this.escapeHtml(exp.startDate)} - ${this.escapeHtml(exp.endDate)}</div>
            </div>
          </div>
          <div class="clear-float"></div>
          ${exp.responsibilities?.length ? `
            <div class="responsibilities">
              <ul>
                ${exp.responsibilities.map(resp => `<li>${this.escapeHtml(resp)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          ${exp.technologies?.length ? `
            <div class="technologies">
              <span class="tech-label">Technologies:</span> ${exp.technologies.map(tech => this.escapeHtml(tech)).join(', ')}
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

  private static generateProjectsSection(cv: TailoredCV): string {
    if (!cv.projects?.length) return '';

    const projectItems = cv.projects.map(project => {
      const isSelected = cv.optimizations.selectedProjects.includes(project.name);
      
      return `
        <div class="item">
          <div class="item-header">
            <div class="two-column">
              <div>
                <div class="item-title">
                  ${this.escapeHtml(project.name)}
                  ${isSelected ? '<span class="optimization-badge">Selected</span>' : ''}
                </div>
                ${project.url ? `<div class="item-location">${this.escapeHtml(project.url)}</div>` : ''}
              </div>
              ${project.startDate && project.endDate ? `
                <div class="item-date">${this.escapeHtml(project.startDate)} - ${this.escapeHtml(project.endDate)}</div>
              ` : ''}
            </div>
          </div>
          <div class="clear-float"></div>
          <div class="item-description">${this.escapeHtml(project.description)}</div>
          ${project.technologies?.length ? `
            <div class="technologies">
              <span class="tech-label">Technologies:</span> ${project.technologies.map(tech => this.escapeHtml(tech)).join(', ')}
            </div>
          ` : ''}
          ${project.achievements?.length ? `
            <div class="responsibilities">
              <ul>
                ${project.achievements.map(ach => `<li>${this.escapeHtml(ach)}</li>`).join('')}
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

  private static generateSkillsSection(cv: TailoredCV): string {
    if (!cv.skills?.length) return '';

    return `
      <div class="section">
        <div class="section-title">Technical Skills</div>
        <div class="skills-grid">
          ${cv.skills.map(skill => `<div class="skill-item">${this.escapeHtml(skill)}</div>`).join('')}
        </div>
      </div>
    `;
  }

  private static generateEducationSection(cv: TailoredCV): string {
    if (!cv.education?.length) return '';

    const educationItems = cv.education.map(edu => `
      <div class="item">
        <div class="item-header">
          <div class="two-column">
            <div>
              <div class="item-title">${this.escapeHtml(edu.degree)}${edu.field ? ` in ${this.escapeHtml(edu.field)}` : ''}</div>
              <div class="item-company">${this.escapeHtml(edu.institution)}</div>
              ${edu.location ? `<div class="item-location">${this.escapeHtml(edu.location)}</div>` : ''}
              ${edu.gpa ? `<div class="item-location">GPA: ${this.escapeHtml(edu.gpa)}</div>` : ''}
            </div>
            ${edu.startDate && edu.endDate ? `
              <div class="item-date">${this.escapeHtml(edu.startDate)} - ${this.escapeHtml(edu.endDate)}</div>
            ` : ''}
          </div>
        </div>
        <div class="clear-float"></div>
      </div>
    `).join('');

    return `
      <div class="section">
        <div class="section-title">Education</div>
        ${educationItems}
      </div>
    `;
  }

  private static generateCertificationsSection(cv: TailoredCV): string {
    if (!cv.certifications?.length) return '';

    const certItems = cv.certifications.map(cert => `
      <div class="item">
        <div class="item-title">${this.escapeHtml(cert.name)}</div>
        <div class="item-company">${this.escapeHtml(cert.issuer)}</div>
        ${cert.date ? `<div class="item-location">${this.escapeHtml(cert.date)}</div>` : ''}
        ${cert.url ? `<div class="item-location">${this.escapeHtml(cert.url)}</div>` : ''}
      </div>
    `).join('');

    return `
      <div class="section">
        <div class="section-title">Certifications</div>
        ${certItems}
      </div>
    `;
  }

  private static escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Generate PDF using browser's print API
  static async generatePDF(cv: TailoredCV, options: PDFGenerationOptions = {}): Promise<{ html: string; printWindow?: Window }> {
    try {
      log.info("Generating browser-native PDF", { 
        name: cv.personalInfo.name,
        tailoringScore: cv.tailoringScore 
      });

      const htmlContent = this.generatePrintableHTML(cv, options);
      
      // Open print-optimized window
      const printWindow = window.open('', '_blank', 'width=800,height=600');
      if (printWindow) {
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        
        // Wait for content to load
        await new Promise(resolve => {
          printWindow.onload = resolve;
          setTimeout(resolve, 500);
        });
      }
      
      log.info("Browser PDF generated successfully");
      
      return {
        html: htmlContent,
        printWindow: printWindow || undefined
      };
    } catch (error) {
      log.error("Failed to generate browser PDF", { error });
      throw error;
    }
  }

  // Download HTML file optimized for printing to PDF
  static downloadPrintableHTML(cv: TailoredCV, jobInfo?: { title: string; company: string }, options: PDFGenerationOptions = {}): void {
    try {
      const htmlContent = this.generatePrintableHTML(cv, options);
      
      const fileName = jobInfo 
        ? `${jobInfo.company.replace(/\s+/g, '_')}_${jobInfo.title.replace(/\s+/g, '_')}_CV.html`
        : 'Tailored_CV.html';
      
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      log.info("Printable HTML downloaded successfully", { fileName });
    } catch (error) {
      log.error("Failed to download printable HTML", { error });
      throw error;
    }
  }
}

export default BrowserPDFGenerator;