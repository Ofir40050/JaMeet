import {
  type LogLevel,
  type StructuredLogEntry,
  type StructuredLogMeta,
  type StructuredError,
  sanitizeLogData,
  sanitizeLogString,
  serializeError
} from '@jameet/shared';

export class ServerLogger {
  private isTesting: boolean;
  private isInitialized = false;

  constructor(isTesting = process.env.NODE_ENV === 'test') {
    this.isTesting = isTesting;
  }

  setupGlobalHandlers(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Use uncaughtExceptionMonitor to observe and persist fatal server crashes
    // without altering Node's normal fatal error behavior or swallowing fatal exceptions.
    process.on('uncaughtExceptionMonitor', (err, origin) => {
      this.error('fatal_server_crash', `Fatal server crash detected: ${origin || 'uncaughtException'}`, {
        origin: origin || 'uncaughtException',
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid
      }, err);
    });
  }

  log(entry: Partial<StructuredLogEntry> & { event: string; message: string; level?: LogLevel }): StructuredLogEntry {
    const level: LogLevel = entry.level || 'info';
    const timestamp = entry.timestamp || new Date().toISOString();
    const sanitizedMeta = entry.meta ? sanitizeLogData(entry.meta) : undefined;
    const sanitizedError = entry.error ? (sanitizeLogData(entry.error) as StructuredError) : undefined;

    const fullEntry: StructuredLogEntry = {
      timestamp,
      level,
      process: 'server',
      event: entry.event,
      message: sanitizeLogString(entry.message || ''),
      sessionId: entry.sessionId,
      sessionCode: entry.sessionCode,
      attemptId: entry.attemptId,
      meta: sanitizedMeta,
      error: sanitizedError
    };

    // Output formatted line or structured output
    const contextParts: string[] = [];
    if (fullEntry.sessionCode) contextParts.push(`code=${fullEntry.sessionCode}`);
    if (fullEntry.sessionId) contextParts.push(`session=${fullEntry.sessionId}`);
    const contextStr = contextParts.length ? ` (${contextParts.join(' ')})` : '';

    const consoleMsg = `[${timestamp}] [${level.toUpperCase()}] [server] [${fullEntry.event}] ${fullEntry.message}${contextStr}`;

    if (!this.isTesting || level === 'error') {
      if (level === 'error') {
        console.error(consoleMsg, fullEntry.error || fullEntry.meta || '');
      } else if (level === 'warn') {
        console.warn(consoleMsg, fullEntry.meta || '');
      } else if (level === 'debug') {
        console.debug(consoleMsg, fullEntry.meta || '');
      } else {
        console.log(consoleMsg, fullEntry.meta || '');
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
}

export const logger = new ServerLogger();
