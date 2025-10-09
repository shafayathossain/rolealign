import { Logger } from "../../../src/util/logger";

const log = new Logger({ namespace: "popup:helpers", level: "debug", persist: true });

export type JobSite = "linkedin" | "indeed" | "unknown";

export interface CVSections {
  personalInfo: string;
  experience: string;
  education: string;
  skills: string;
  projects: string;
}

/**
 * Get the active Chrome tab
 */
export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
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

/**
 * Detect which job site we're on based on URL
 */
export function detectSite(url?: string): JobSite {
  if (!url) return "unknown";
  const u = url.toLowerCase();
  if (u.includes("linkedin.com")) return "linkedin";
  if (u.includes("indeed.com")) return "indeed";
  return "unknown";
}

/**
 * Get display name for job site
 */
export function getJobSiteDisplayName(site: JobSite): string {
  switch (site) {
    case "linkedin": return "LinkedIn";
    case "indeed": return "Indeed";
    default: return "Unknown Site";
  }
}