// Chrome Writer and Rewriter API wrapper
import { Logger } from "../util/logger";

const log = new Logger({ namespace: "writer-rewriter", level: "debug", persist: true });

export class WriterRewriterAI {
  private static writerInstance: any = null;
  private static rewriterInstance: any = null;

  // Writer API availability check
  static async isWriterAvailable(): Promise<string> {
    try {
      if (!('Writer' in globalThis)) {
        log.warn("Writer API not supported in this browser");
        return 'unsupported';
      }
      
      const availability = await (globalThis as any).Writer.availability();
      log.debug("Writer availability", { availability });
      return availability;
    } catch (error) {
      log.error("Failed to check Writer availability", { error });
      return 'error';
    }
  }

  // Rewriter API availability check
  static async isRewriterAvailable(): Promise<string> {
    try {
      if (!('Rewriter' in globalThis)) {
        log.warn("Rewriter API not supported in this browser");
        return 'unsupported';
      }
      
      const availability = await (globalThis as any).Rewriter.availability();
      log.debug("Rewriter availability", { availability });
      return availability;
    } catch (error) {
      log.error("Failed to check Rewriter availability", { error });
      return 'error';
    }
  }

  // Create Writer instance
  static async createWriter(options: {
    tone?: 'formal' | 'neutral' | 'casual';
    format?: 'markdown' | 'plain-text';
    length?: 'short' | 'medium' | 'long';
    sharedContext?: string;
    onDownloadProgress?: (progress: number) => void;
  } = {}): Promise<any> {
    try {
      const availability = await this.isWriterAvailable();
      
      if (availability === 'unsupported' || availability === 'error') {
        throw new Error(`Writer API not available: ${availability}`);
      }

      const writerOptions: any = {
        tone: options.tone || 'formal',
        format: options.format || 'plain-text',
        length: options.length || 'medium',
        ...(options.sharedContext && { sharedContext: options.sharedContext })
      };

      if (availability === 'available') {
        log.info("Creating Writer instance (model ready)");
        this.writerInstance = await (globalThis as any).Writer.create(writerOptions);
      } else {
        log.info("Creating Writer instance (downloading model)");
        this.writerInstance = await (globalThis as any).Writer.create({
          ...writerOptions,
          monitor(m: any) {
            m.addEventListener("downloadprogress", (e: any) => {
              const progress = Math.round(e.loaded * 100);
              log.debug(`Writer model download progress: ${progress}%`);
              options.onDownloadProgress?.(progress);
            });
          }
        });
      }

      log.info("Writer instance created successfully");
      return this.writerInstance;
    } catch (error) {
      log.error("Failed to create Writer instance", { error });
      throw error;
    }
  }

  // Create Rewriter instance
  static async createRewriter(options: {
    tone?: 'more-formal' | 'as-is' | 'more-casual';
    format?: 'as-is' | 'markdown' | 'plain-text';
    length?: 'shorter' | 'as-is' | 'longer';
    sharedContext?: string;
    onDownloadProgress?: (progress: number) => void;
  } = {}): Promise<any> {
    try {
      const availability = await this.isRewriterAvailable();
      
      if (availability === 'unsupported' || availability === 'error') {
        throw new Error(`Rewriter API not available: ${availability}`);
      }

      const rewriterOptions: any = {
        tone: options.tone || 'as-is',
        format: options.format || 'plain-text',
        length: options.length || 'as-is',
        ...(options.sharedContext && { sharedContext: options.sharedContext })
      };

      if (availability === 'available') {
        log.info("Creating Rewriter instance (model ready)");
        this.rewriterInstance = await (globalThis as any).Rewriter.create(rewriterOptions);
      } else {
        log.info("Creating Rewriter instance (downloading model)");
        this.rewriterInstance = await (globalThis as any).Rewriter.create({
          ...rewriterOptions,
          monitor(m: any) {
            m.addEventListener("downloadprogress", (e: any) => {
              const progress = Math.round(e.loaded * 100);
              log.debug(`Rewriter model download progress: ${progress}%`);
              options.onDownloadProgress?.(progress);
            });
          }
        });
      }

      log.info("Rewriter instance created successfully");
      return this.rewriterInstance;
    } catch (error) {
      log.error("Failed to create Rewriter instance", { error });
      throw error;
    }
  }

  // Write new content
  static async writeContent(
    prompt: string,
    options: {
      context?: string;
      streaming?: boolean;
      writer?: any;
    } = {}
  ): Promise<string | AsyncIterable<string>> {
    try {
      const writer = options.writer || this.writerInstance;
      if (!writer) {
        throw new Error("Writer instance not available. Call createWriter() first.");
      }

      const writeOptions = options.context ? { context: options.context } : {};

      if (options.streaming) {
        log.debug("Starting streaming write", { prompt: prompt.substring(0, 100) });
        return writer.writeStreaming(prompt, writeOptions);
      } else {
        log.debug("Starting non-streaming write", { prompt: prompt.substring(0, 100) });
        const result = await writer.write(prompt, writeOptions);
        log.debug("Write completed", { resultLength: result.length });
        return result;
      }
    } catch (error) {
      log.error("Failed to write content", { error });
      throw error;
    }
  }

  // Rewrite existing content
  static async rewriteContent(
    text: string,
    options: {
      context?: string;
      streaming?: boolean;
      rewriter?: any;
    } = {}
  ): Promise<string | AsyncIterable<string>> {
    try {
      const rewriter = options.rewriter || this.rewriterInstance;
      if (!rewriter) {
        throw new Error("Rewriter instance not available. Call createRewriter() first.");
      }

      const rewriteOptions = options.context ? { context: options.context } : {};

      if (options.streaming) {
        log.debug("Starting streaming rewrite", { textLength: text.length });
        return rewriter.rewriteStreaming(text, rewriteOptions);
      } else {
        log.debug("Starting non-streaming rewrite", { textLength: text.length });
        const result = await rewriter.rewrite(text, rewriteOptions);
        log.debug("Rewrite completed", { resultLength: result.length });
        return result;
      }
    } catch (error) {
      log.error("Failed to rewrite content", { error });
      throw error;
    }
  }

  // Cleanup instances
  static cleanup(): void {
    try {
      if (this.writerInstance) {
        this.writerInstance.destroy();
        this.writerInstance = null;
        log.debug("Writer instance destroyed");
      }
      if (this.rewriterInstance) {
        this.rewriterInstance.destroy();
        this.rewriterInstance = null;
        log.debug("Rewriter instance destroyed");
      }
    } catch (error) {
      log.error("Error during cleanup", { error });
    }
  }
}

export default WriterRewriterAI;