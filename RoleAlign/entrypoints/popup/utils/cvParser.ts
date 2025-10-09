import { Logger } from "../../../src/util/logger";

const log = new Logger({ namespace: "popup:cvParser", level: "debug", persist: true });

/**
 * Parse JSON strings from AI processing (handles markdown code blocks)
 */
export function parseJsonString(value: any): any {
  if (typeof value === 'string') {
    // Remove markdown code blocks and clean the string
    let cleanValue = value.replace(/```json\s*|\s*```/g, '').trim();
    
    // Handle the specific format where the entire value starts with ```json
    if (cleanValue.startsWith('```json')) {
      cleanValue = cleanValue.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    }
    
    try {
      log.info("Attempting to parse JSON", { 
        originalLength: value.length, 
        cleanedLength: cleanValue.length, 
        preview: cleanValue.substring(0, 100) 
      });
      const parsed = JSON.parse(cleanValue);
      log.info("Successfully parsed JSON", { keys: Object.keys(parsed) });
      return parsed;
    } catch (e) {
      log.error("Failed to parse JSON string", { 
        cleanValue: cleanValue.substring(0, 200), 
        error: e,
        originalValue: value.substring(0, 200)
      });
      return null;
    }
  }
  return value;
}

/**
 * Parse experience data from CV
 */
export function parseExperienceData(experience: any): any[] {
  if (!experience) return [];

  const parsedExp = parseJsonString(experience);
  
  if (parsedExp?.positions && Array.isArray(parsedExp.positions)) {
    return parsedExp.positions.map((pos: any, index: number) => {
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
      
      return {
        id: Date.now() + index,
        title: pos.title || "",
        company: pos.company || "",
        location: pos.location || "",
        startDate: startDate,
        endDate: endDate,
        current: current,
        responsibilities: Array.isArray(pos.responsibilities) 
          ? pos.responsibilities.join('\n• ') 
          : (pos.responsibilities || "")
      };
    });
  } else if (Array.isArray(experience)) {
    return experience;
  }
  
  return [];
}

/**
 * Parse projects data from CV
 */
export function parseProjectsData(projects: any): any[] {
  if (!projects) return [];

  const parsedProj = parseJsonString(projects);
  
  if (parsedProj?.projects && Array.isArray(parsedProj.projects)) {
    return parsedProj.projects.map((proj: any, index: number) => ({
      id: Date.now() + index + 1000,
      name: proj.name || "",
      description: Array.isArray(proj.responsibilities) 
        ? proj.responsibilities.join('\n• ') 
        : (proj.description || proj.responsibilities || ""),
      technologies: Array.isArray(proj.technologies) 
        ? proj.technologies.join(', ') 
        : (proj.technologies || ""),
      startDate: proj.startDate || "",
      endDate: proj.endDate || "",
      url: proj.url || "",
      status: proj.status || "completed"
    }));
  } else if (Array.isArray(projects)) {
    return projects;
  }
  
  return [];
}

/**
 * Parse education data from CV
 */
export function parseEducationData(education: any): string {
  if (!education) return "";
  
  if (typeof education === 'string') {
    const parsedEdu = parseJsonString(education);
    
    if (parsedEdu?.education && Array.isArray(parsedEdu.education)) {
      // Convert parsed education array to formatted string
      return parsedEdu.education.map((edu: any) => 
        `${edu.degree || 'Degree'} at ${edu.institution || 'Institution'} ${edu.location ? `(${edu.location})` : ''} — ${edu.period || 'Period'}`
      ).join('\n');
    }
  }
  
  return education || "";
}