import { app, ipcMain, WebContents } from 'electron';
import { existsSync, mkdirSync, appendFileSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { release } from 'node:os';
import {
  type LogLevel,
  type StructuredLogEntry,
  type StructuredLogMeta,
  type StructuredError,
  type CrashReport,
  sanitizeLogData,
  serializeError
} from '@jameet/shared';

const MAX_LOG_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_CRASH_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

export class DesktopLogger {
  private logDir: string;
  private logFilePath: string;
  private crashFilePath: string;
  private appVersion: string;
  private instanceId: string;
  private platform: string;
  private arch: string;
  private osRelease: string;
  private isInitialized = false;

  constructor(customLogDir?: string, customInstanceId?: string) {
    this.platform = process.platform;
    this.arch = process.arch;
    this.osRelease = release();
    this.instanceId = customInstanceId || process.env.JAMEET_INSTANCE || process.env.MUSICZOOM_INSTANCE || '';

    try {
      this.appVersion = app?.getVersion ? app.getVersion() : '0.1.0';
    } catch {
      this.appVersion = '0.1.0';
    }

    if (customLogDir) {
      this.logDir = customLogDir;
    } else {
      try {
        const userData = app?.getPath ? app.getPath('userData') : join(process.cwd(), '.jameet-data');
        this.logDir = join(userData, 'logs');
      } catch {
        this.logDir = join(process.cwd(), '.jameet-logs');
      }
    }

    this.logFilePath = join(this.logDir, 'jameet-app.log');
    this.crashFilePath = join(this.logDir, 'crashes.jsonl');
    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    try {
      if (!existsSync(this.logDir)) {
        mkdirSync(this.logDir, { recursive: true });
      }
    } catch (err) {
      console.warn('[DesktopLogger] Could not create log directory:', err);
    }
  }

  private rotateFileIfNeeded(filePath: string, maxBytes: number): void {
    try {
      if (existsSync(filePath)) {
        const stat = statSync(filePath);
        if (stat.size >= maxBytes) {
          const backupPath = `${filePath}.1`;
          if (existsSync(backupPath)) {
            try { unlinkSync(backupPath); } catch {}
          }
          renameSync(filePath, backupPath);
        }
      }
    } catch {
      // Rotation failures shouldn't prevent application execution
    }
  }

  getLogPaths(): { logDir: string; logFilePath: string; crashFilePath: string } {
    return {
      logDir: this.logDir,
      logFilePath: this.logFilePath,
      crashFilePath: this.crashFilePath
    };
  }

  log(entry: Partial<StructuredLogEntry> & { event: string; message: string; level?: LogLevel }): StructuredLogEntry {
    const level: LogLevel = entry.level || 'info';
    const timestamp = entry.timestamp || new Date().toISOString();
    const sanitizedMeta = entry.meta ? sanitizeLogData(entry.meta) : undefined;
    const sanitizedError = entry.error ? (sanitizeLogData(entry.error) as StructuredError) : undefined;

    const fullEntry: StructuredLogEntry = {
      timestamp,
      level,
      process: entry.process || 'main',
      event: entry.event,
      message: entry.message,
      appVersion: this.appVersion,
      platform: this.platform,
      arch: this.arch,
      osRelease: this.osRelease,
      instanceId: this.instanceId || undefined,
      sessionId: entry.sessionId,
      sessionCode: entry.sessionCode,
      attemptId: entry.attemptId,
      meta: sanitizedMeta,
      error: sanitizedError
    };

    // Formatted console output
    const contextParts: string[] = [];
    if (fullEntry.sessionCode) contextParts.push(`code=${fullEntry.sessionCode}`);
    if (fullEntry.instanceId) contextParts.push(`instance=${fullEntry.instanceId}`);
    const contextStr = contextParts.length ? ` (${contextParts.join(' ')})` : '';

    const consoleMsg = `[${timestamp}] [${level.toUpperCase()}] [${fullEntry.process}] [${fullEntry.event}] ${fullEntry.message}${contextStr}`;
    if (level === 'error') {
      console.error(consoleMsg, fullEntry.error || fullEntry.meta || '');
    } else if (level === 'warn') {
      console.warn(consoleMsg, fullEntry.meta || '');
    } else if (level === 'debug') {
      console.debug(consoleMsg, fullEntry.meta || '');
    } else {
      console.log(consoleMsg, fullEntry.meta || '');
    }

    // Persist to disk log file
    try {
      this.ensureLogDir();
      this.rotateFileIfNeeded(this.logFilePath, MAX_LOG_FILE_SIZE_BYTES);
      appendFileSync(this.logFilePath, JSON.stringify(fullEntry) + '\n', 'utf8');
    } catch (err) {
      console.warn('[DesktopLogger] Failed to write log to disk:', err);
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

  recordCrash(crashData: Partial<CrashReport>): CrashReport {
    const timestamp = crashData.timestamp || new Date().toISOString();
    const sanitizedError = crashData.error ? (sanitizeLogData(crashData.error) as StructuredError) : undefined;
    const sanitizedContext = crashData.context ? sanitizeLogData(crashData.context) : undefined;

    let electronVersion: string | undefined;
    let nodeVersion: string | undefined;
    try {
      electronVersion = process.versions.electron;
      nodeVersion = process.versions.node;
    } catch {}

    const report: CrashReport = {
      timestamp,
      process: crashData.process || 'main',
      appVersion: this.appVersion,
      electronVersion,
      nodeVersion,
      platform: this.platform,
      arch: this.arch,
      osRelease: this.osRelease,
      instanceId: this.instanceId || undefined,
      sessionId: crashData.sessionId,
      sessionCode: crashData.sessionCode,
      reason: crashData.reason || 'unexpected_crash',
      exitCode: crashData.exitCode,
      error: sanitizedError,
      context: sanitizedContext
    };

    console.error(`[DesktopLogger] [CRASH] [${report.process}] [${report.reason}]`, report.error?.message || report.reason, report);

    try {
      this.ensureLogDir();
      this.rotateFileIfNeeded(this.crashFilePath, MAX_CRASH_FILE_SIZE_BYTES);
      appendFileSync(this.crashFilePath, JSON.stringify(report) + '\n', 'utf8');
    } catch (err) {
      console.warn('[DesktopLogger] Failed to write crash report to disk:', err);
    }

    // Also log as error in regular log
    this.log({
      level: 'error',
      process: report.process === 'renderer' ? 'renderer' : 'main',
      event: 'application_crash',
      message: `Application crash detected: ${report.reason}`,
      sessionId: report.sessionId,
      sessionCode: report.sessionCode,
      error: report.error,
      meta: {
        reason: report.reason,
        exitCode: report.exitCode,
        ...report.context
      }
    });

    return report;
  }

  trackWebContents(wc: WebContents, windowName = 'window'): void {
    if (!wc || wc.isDestroyed()) return;

    wc.on('render-process-gone', (_event, details) => {
      this.recordCrash({
        process: 'renderer',
        reason: `render-process-gone (${details.reason})`,
        exitCode: details.exitCode,
        context: { window: windowName }
      });
    });

    wc.on('plugin-crashed', (_event, name, version) => {
      this.recordCrash({
        process: 'renderer',
        reason: `plugin-crashed (${name})`,
        context: { window: windowName, pluginName: name, pluginVersion: version }
      });
    });
  }

  setupGlobalHandlers(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    process.on('uncaughtException', (err) => {
      this.recordCrash({
        process: 'main',
        reason: 'uncaughtException',
        error: serializeError(err)
      });
    });

    process.on('unhandledRejection', (reason) => {
      this.recordCrash({
        process: 'main',
        reason: 'unhandledRejection',
        error: serializeError(reason)
      });
    });

    try {
      app.on('child-process-gone', (_event, details) => {
        this.recordCrash({
          process: 'child',
          reason: `child-process-gone (${details.type}: ${details.reason})`,
          exitCode: details.exitCode,
          context: { name: details.name, serviceName: details.serviceName }
        });
      });
    } catch {}

    this.setupIpcHandlers();
  }

  private setupIpcHandlers(): void {
    try {
      ipcMain.on('logger:log', (_event, entry: Partial<StructuredLogEntry>) => {
        if (!entry || typeof entry !== 'object') return;
        this.log({
          process: 'renderer',
          level: entry.level || 'info',
          event: entry.event || 'renderer_event',
          message: entry.message || '',
          sessionId: entry.sessionId,
          sessionCode: entry.sessionCode,
          attemptId: entry.attemptId,
          meta: entry.meta,
          error: entry.error
        });
      });

      ipcMain.handle('logger:crash', async (_event, crashData: Partial<CrashReport>) => {
        return this.recordCrash({
          process: 'renderer',
          ...crashData
        });
      });

      ipcMain.handle('logger:get-log-paths', async () => {
        return this.getLogPaths();
      });
    } catch (err) {
      console.warn('[DesktopLogger] Could not register IPC handlers:', err);
    }
  }
}

export const logger = new DesktopLogger();
