import {
  type LogLevel,
  type StructuredLogEntry,
  type StructuredLogMeta,
  type StructuredError,
  type CrashReport,
  sanitizeLogData,
  sanitizeLogString,
  serializeError
} from '@jameet/shared';

function getDesktopApi(): any {
  if (typeof window === 'undefined') return undefined;
  return (window as any).jameet || (window as any).musiczoom;
}

export class RendererLogger {
  private isInitialized = false;
  private currentSessionCode?: string;
  private currentSessionId?: string;

  setSessionContext(code?: string, sessionId?: string): void {
    this.currentSessionCode = code;
    this.currentSessionId = sessionId;
  }

  log(entry: Partial<StructuredLogEntry> & { event: string; message: string; level?: LogLevel }): StructuredLogEntry {
    const level: LogLevel = entry.level || 'info';
    const timestamp = entry.timestamp || new Date().toISOString();
    const sanitizedMeta = entry.meta ? sanitizeLogData(entry.meta) : undefined;
    const sanitizedError = entry.error ? (sanitizeLogData(entry.error) as StructuredError) : undefined;

    const fullEntry: StructuredLogEntry = {
      timestamp,
      level,
      process: 'renderer',
      event: entry.event,
      message: sanitizeLogString(entry.message || ''),
      sessionId: entry.sessionId || this.currentSessionId,
      sessionCode: entry.sessionCode || this.currentSessionCode,
      attemptId: entry.attemptId,
      meta: sanitizedMeta,
      error: sanitizedError
    };

    const contextParts: string[] = [];
    if (fullEntry.sessionCode) contextParts.push(`code=${fullEntry.sessionCode}`);
    if (fullEntry.attemptId) contextParts.push(`attempt=${fullEntry.attemptId}`);
    const contextStr = contextParts.length ? ` (${contextParts.join(' ')})` : '';

    const consoleMsg = `[${timestamp}] [${level.toUpperCase()}] [renderer] [${fullEntry.event}] ${fullEntry.message}${contextStr}`;
    if (level === 'error') {
      console.error(consoleMsg, fullEntry.error || fullEntry.meta || '');
    } else if (level === 'warn') {
      console.warn(consoleMsg, fullEntry.meta || '');
    } else if (level === 'debug') {
      console.debug(consoleMsg, fullEntry.meta || '');
    } else {
      console.log(consoleMsg, fullEntry.meta || '');
    }

    // Forward to Electron main process for persistent disk logging
    const api = getDesktopApi();
    if (api?.logger?.log) {
      try {
        api.logger.log(fullEntry);
      } catch {
        // Fallback silently if IPC fails
      }
    }

    return fullEntry;
  }

  info(event: string, message: string, meta?: StructuredLogMeta, context?: { sessionId?: string; sessionCode?: string; attemptId?: string }): StructuredLogEntry {
    return this.log({ level: 'info', event, message, meta, ...context });
  }

  warn(event: string, message: string, meta?: StructuredLogMeta, error?: unknown, context?: { sessionId?: string; sessionCode?: string; attemptId?: string }): StructuredLogEntry {
    return this.log({ level: 'warn', event, message, meta, error: serializeError(error), ...context });
  }

  error(event: string, message: string, meta?: StructuredLogMeta, error?: unknown, context?: { sessionId?: string; sessionCode?: string; attemptId?: string }): StructuredLogEntry {
    return this.log({ level: 'error', event, message, meta, error: serializeError(error), ...context });
  }

  debug(event: string, message: string, meta?: StructuredLogMeta, context?: { sessionId?: string; sessionCode?: string; attemptId?: string }): StructuredLogEntry {
    return this.log({ level: 'debug', event, message, meta, ...context });
  }

  recordCrash(crashData: Partial<CrashReport>): void {
    const api = getDesktopApi();
    const sanitizedError = crashData.error ? (sanitizeLogData(crashData.error) as StructuredError) : undefined;
    const sanitizedContext = crashData.context ? sanitizeLogData(crashData.context) : undefined;

    const report: Partial<CrashReport> = {
      process: 'renderer',
      reason: sanitizeLogString(crashData.reason || 'renderer_error'),
      sessionId: crashData.sessionId || this.currentSessionId,
      sessionCode: crashData.sessionCode || this.currentSessionCode,
      error: sanitizedError,
      context: sanitizedContext
    };

    if (api?.logger?.crash) {
      try {
        void api.logger.crash(report);
      } catch {
        // fallback
      }
    }

    this.log({
      level: 'error',
      event: 'renderer_crash',
      message: `Renderer unhandled error: ${report.reason}`,
      error: report.error,
      meta: {
        reason: report.reason,
        ...report.context
      }
    });
  }

  initGlobalErrorHandling(): void {
    if (this.isInitialized || typeof window === 'undefined') return;
    this.isInitialized = true;

    window.addEventListener('error', (event) => {
      const error = event.error ? serializeError(event.error) : { message: event.message };
      this.recordCrash({
        reason: `window.onerror: ${event.message || 'Unknown error'}`,
        error,
        context: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        }
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      const error = serializeError(event.reason);
      this.recordCrash({
        reason: `window.onunhandledrejection: ${error?.message || 'Unhandled promise rejection'}`,
        error
      });
    });
  }
}

export const logger = new RendererLogger();
