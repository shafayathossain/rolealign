/**
 * RoleAlign Logger
 *
 * Provides leveled logging with timestamps, namespaces, and pluggable sinks.
 * Works in all extension contexts (background, content scripts, popup).
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
};

export interface LoggerOptions {
  namespace?: string;       // e.g. "popup", "content:linkedin"
  level?: LogLevel;         // min level (default: "info")
  persist?: boolean;        // persist logs to storage.local
  maxPersisted?: number;    // how many persisted entries to keep
}

export interface LogEntry {
  ts: string;               // ISO timestamp
  level: LogLevel;
  ns: string;
  args: any[];
}

export class Logger {
  private ns: string;
  private level: LogLevel;
  private persist: boolean;
  private maxPersisted: number;

  constructor(opts: LoggerOptions = {}) {
    this.ns = opts.namespace ?? "default";
    this.level = opts.level ?? (import.meta.env.DEV ? "debug" : "info");
    this.persist = opts.persist ?? false;
    this.maxPersisted = opts.maxPersisted ?? 200;
  }

  setLevel(l: LogLevel) {
    this.level = l;
  }

  private shouldLog(l: LogLevel) {
    return LEVELS[l] >= LEVELS[this.level];
  }

  private async persistEntry(entry: LogEntry) {
    try {
      const key = `rolealign/logs/${this.ns}`;
      const prev = (await chrome.storage.local.get(key))[key] as LogEntry[] | undefined;
      const arr = prev ?? [];
      arr.push(entry);
      if (arr.length > this.maxPersisted) arr.shift();
      await chrome.storage.local.set({ [key]: arr });
    } catch (err) {
      // Don't crash if storage fails
      console.warn("[RoleAlign:logger] persist failed", err);
    }
  }

  private log(level: LogLevel, ...args: any[]) {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      ns: this.ns,
      args,
    };

    const prefix = `%c[${entry.ts}] [${this.ns}] ${level.toUpperCase()}`;
    const color =
      level === "debug"
        ? "color: gray"
        : level === "info"
        ? "color: dodgerblue"
        : level === "warn"
        ? "color: orange"
        : "color: red";

    // Print to console
    switch (level) {
      case "debug":
      case "info":
        console.log(prefix, color, ...args);
        break;
      case "warn":
        console.warn(prefix, color, ...args);
        break;
      case "error":
        console.error(prefix, color, ...args);
        break;
    }

    // Persist if enabled
    if (this.persist) this.persistEntry(entry);
  }

  debug(...args: any[]) {
    this.log("debug", ...args);
  }
  info(...args: any[]) {
    this.log("info", ...args);
  }
  warn(...args: any[]) {
    this.log("warn", ...args);
  }
  error(...args: any[]) {
    this.log("error", ...args);
  }
}

// Default logger instance (namespace = "app")
export const log = new Logger({ namespace: "app" });

/**
 * Utilities to fetch persisted logs (for debugging UI or support)
 */
export async function getLogs(namespace: string): Promise<LogEntry[]> {
  const key = `rolealign/logs/${namespace}`;
  const res = await chrome.storage.local.get(key);
  return (res[key] as LogEntry[]) ?? [];
}

export async function clearLogs(namespace: string) {
  await chrome.storage.local.remove(`rolealign/logs/${namespace}`);
}
