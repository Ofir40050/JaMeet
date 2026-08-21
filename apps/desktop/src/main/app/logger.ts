import { app, crashReporter, ipcMain, WebContents } from 'electron';
import { existsSync, mkdirSync, appendFileSync, statSync, renameSync, unlinkSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { release } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
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
import { isTrustedSender } from '../security/trustBoundary';

const MAX_LOG_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_CRASH_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_PENDING_CRASHES = 50;

export class DesktopLogger {
  private logDir: string;
  private logFilePath: string;
  private crashFilePath: string;
  private pendingQueuePath: string;
  private processedDumpsPath: string;
  private customLogDir?: string;
  private appVersion: string;
  private instanceId: string;
  private platform: string;
  private arch: string;
  private osRelease: string;
  private isInitialized = false;
  private activeFlushPromise: Promise<void> | null = null;

  constructor(customLogDir?: string, customInstanceId?: string) {
    this.platform = process.platform;
    this.arch = process.arch;
    this.osRelease = release();
    this.customLogDir = customLogDir;
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
    this.pendingQueuePath = join(this.logDir, 'pending-crashes.json');
    this.processedDumpsPath = join(this.logDir, 'processed-dumps.json');
    this.ensureLogDir();
  }

  public syncUserDataPath(): void {
    if (this.customLogDir) return;
    try {
      if (app?.getPath) {
        const userData = app.getPath('userData');
        this.logDir = join(userData, 'logs');
        this.logFilePath = join(this.logDir, 'jameet-app.log');
        this.crashFilePath = join(this.logDir, 'crashes.jsonl');
        this.pendingQueuePath = join(this.logDir, 'pending-crashes.json');
        this.processedDumpsPath = join(this.logDir, 'processed-dumps.json');
        this.ensureLogDir();
      }
    } catch {}
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

  getTrustedServerUrl(): string {
    const raw = process.env.JAMEET_SERVER_URL ||
      process.env.SIGNALING_URL ||
      (app && app.isPackaged ? 'https://jameet-jwi8.onrender.com' : 'http://localhost:3000');
    return raw.replace(/\/+$/, '');
  }

  getLogPaths(): {
    logDir: string;
    logFilePath: string;
    crashFilePath: string;
    pendingQueuePath: string;
    processedDumpsPath: string;
    crashDumpsDir?: string;
  } {
    let crashDumpsDir: string | undefined = undefined;
    try {
      if (app?.getPath) {
        crashDumpsDir = app.getPath('crashDumps');
      }
    } catch {}
    return {
      logDir: this.logDir,
      logFilePath: this.logFilePath,
      crashFilePath: this.crashFilePath,
      pendingQueuePath: this.pendingQueuePath,
      processedDumpsPath: this.processedDumpsPath,
      crashDumpsDir
    };
  }

  public loadPendingQueue(): CrashReport[] {
    try {
      if (existsSync(this.pendingQueuePath)) {
        const raw = readFileSync(this.pendingQueuePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (err) {
      console.warn('[DesktopLogger] Could not read pending crashes queue:', err);
    }
    return [];
  }

  private savePendingQueue(items: CrashReport[]): void {
    try {
      this.ensureLogDir();
      const tmpPath = `${this.pendingQueuePath}.${randomUUID()}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(items, null, 2), 'utf8');
      renameSync(tmpPath, this.pendingQueuePath);
    } catch (err) {
      console.warn('[DesktopLogger] Failed to save pending crashes queue:', err);
    }
  }

  public enqueuePendingCrashSync(report: CrashReport): void {
    try {
      const current = this.loadPendingQueue();
      if (report.reportId && current.some((r) => r.reportId === report.reportId)) {
        return;
      }
      const updated = [...current, report];
      const bounded = updated.length > MAX_PENDING_CRASHES
        ? updated.slice(updated.length - MAX_PENDING_CRASHES)
        : updated;
      this.savePendingQueue(bounded);
    } catch (err) {
      console.warn('[DesktopLogger] Failed to enqueue pending crash:', err);
    }
  }

  public dequeuePendingCrash(reportId: string): void {
    try {
      const current = this.loadPendingQueue();
      const filtered = current.filter((r) => r.reportId !== reportId);
      if (filtered.length !== current.length) {
        this.savePendingQueue(filtered);
      }
    } catch (err) {
      console.warn('[DesktopLogger] Failed to dequeue pending crash:', err);
    }
  }

  public async flushPendingCrashes(): Promise<void> {
    if (this.activeFlushPromise) {
      return this.activeFlushPromise;
    }
    try {
      if (app?.isReady && !app.isReady()) {
        return;
      }
    } catch {}

    const flushTask = (async () => {
      const pending = this.loadPendingQueue();
      if (!pending.length) return;

      const serverUrl = this.getTrustedServerUrl();
      const endpoint = `${serverUrl}/api/crashes`;

      for (const report of pending) {
        if (!report.reportId) {
          continue;
        }

        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(report),
            signal: AbortSignal.timeout(5000)
          });

          if (res.status === 200 || res.status === 201) {
            let isValidAck = false;
            try {
              const data = (await res.json()) as any;
              if (data && typeof data === 'object' && data.ok === true && data.reportId === report.reportId) {
                isValidAck = true;
              }
            } catch {}

            if (isValidAck) {
              this.dequeuePendingCrash(report.reportId);
            } else {
              // Unconfirmed or malformed acknowledgement, retain in queue for future retry
              break;
            }
          } else if (res.status === 400) {
            // Malformed/unacceptable report, remove from queue so it does not loop forever
            this.dequeuePendingCrash(report.reportId);
          } else {
            // Server error (e.g. 500) or temporary issue, retain and retry on next startup/flusher run
            break;
          }
        } catch {
          // Network failure, offline, or timeout - keep pending and retry later
          break;
        }
      }
    })();

    this.activeFlushPromise = flushTask.finally(() => {
      this.activeFlushPromise = null;
    });

    return this.activeFlushPromise;
  }

  public checkNativeCrashDumps(customCrashDumpsDir?: string): void {
    let crashDumpsDir: string | undefined = customCrashDumpsDir;
    if (!crashDumpsDir) {
      try {
        if (app?.getPath) {
          crashDumpsDir = app.getPath('crashDumps');
        }
      } catch {}
    }

    if (!crashDumpsDir || !existsSync(crashDumpsDir)) {
      return;
    }

    const processedKeys = new Set<string>();
    try {
      if (existsSync(this.processedDumpsPath)) {
        const raw = readFileSync(this.processedDumpsPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const k of parsed) {
            if (typeof k === 'string') processedKeys.add(k);
          }
        }
      }
    } catch {}

    const dmpFiles: string[] = [];
    const scanDir = (dir: string, depth = 0) => {
      if (depth > 3 || !existsSync(dir)) return;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath, depth + 1);
          } else if (entry.isFile() && entry.name.endsWith('.dmp')) {
            dmpFiles.push(fullPath);
          }
        }
      } catch {}
    };

    scanDir(crashDumpsDir);

    let hasNewDumps = false;
    for (const dmpPath of dmpFiles) {
      try {
        const stat = statSync(dmpPath);
        const dumpName = basename(dmpPath);
        const metaKey = `${dumpName}:${stat.size}:${stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs}`;
        const hash = createHash('sha256').update(metaKey).digest('hex').slice(0, 32);
        const reportId = `native-${hash}`;

        if (processedKeys.has(metaKey) || processedKeys.has(reportId) || processedKeys.has(dumpName)) {
          continue;
        }

        const dumpReport: CrashReport = {
          reportId,
          timestamp: new Date(stat.mtimeMs || Date.now()).toISOString(),
          process: 'native',
          reason: 'native_crashpad_dump',
          appVersion: this.appVersion,
          platform: this.platform,
          arch: this.arch,
          osRelease: this.osRelease,
          instanceId: this.instanceId || undefined,
          context: {
            dumpFilename: dumpName,
            dumpSizeBytes: stat.size,
            dumpCreatedAt: new Date(stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs).toISOString()
          }
        };

        this.recordCrash(dumpReport);
        processedKeys.add(metaKey);
        hasNewDumps = true;
      } catch {}
    }

    if (hasNewDumps) {
      try {
        this.ensureLogDir();
        const tmpPath = `${this.processedDumpsPath}.${randomUUID()}.tmp`;
        writeFileSync(tmpPath, JSON.stringify(Array.from(processedKeys), null, 2), 'utf8');
        renameSync(tmpPath, this.processedDumpsPath);
      } catch {}
    }
  }

  log(entry: Partial<StructuredLogEntry> & { event: string; message: string; level?: LogLevel }): StructuredLogEntry {
    const rawLevel = typeof entry.level === 'string' ? entry.level.toLowerCase() : '';
    const level: LogLevel = (rawLevel === 'debug' || rawLevel === 'info' || rawLevel === 'warn' || rawLevel === 'error')
      ? (rawLevel as LogLevel)
      : 'info';
    const timestamp = entry.timestamp || new Date().toISOString();
    const event = typeof entry.event === 'string' && entry.event.trim().length > 0 ? entry.event.trim() : 'log_event';
    const rawMessage = typeof entry.message === 'string' ? entry.message : (entry.message !== null && entry.message !== undefined ? String(entry.message) : '');
    const message = sanitizeLogString(rawMessage);
    const sanitizedMeta = entry.meta ? sanitizeLogData(entry.meta) : undefined;
    const sanitizedError = entry.error ? (sanitizeLogData(entry.error) as StructuredError) : undefined;

    const fullEntry: StructuredLogEntry = {
      timestamp,
      level,
      process: entry.process || 'main',
      event,
      message,
      appVersion: this.appVersion,
      platform: this.platform,
      arch: this.arch,
      osRelease: this.osRelease,
      instanceId: this.instanceId || undefined,
      sessionId: typeof entry.sessionId === 'string' ? entry.sessionId : undefined,
      sessionCode: typeof entry.sessionCode === 'string' ? entry.sessionCode : undefined,
      attemptId: typeof entry.attemptId === 'string' ? entry.attemptId : undefined,
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
    const reportId = crashData.reportId || randomUUID();
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
      reportId,
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
      reason: sanitizeLogString(crashData.reason || 'unexpected_crash'),
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

    // Persist to pending delivery queue before attempting network delivery
    this.enqueuePendingCrashSync(report);

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
        reportId: report.reportId,
        reason: report.reason,
        exitCode: report.exitCode,
        ...report.context
      }
    });

    // Asynchronously flush pending crashes without blocking if app is ready
    let canFlush = true;
    try {
      if (app?.isReady && !app.isReady()) {
        canFlush = false;
      }
    } catch {}
    if (canFlush) {
      this.flushPendingCrashes().catch(() => {});
    }

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

  initNativeCrashReporter(): boolean {
    try {
      if (!crashReporter?.start) return false;
      crashReporter.start({
        submitURL: '',
        uploadToServer: false,
        compress: true,
        globalExtra: {
          appVersion: this.appVersion,
          platform: this.platform,
          arch: this.arch,
          instanceId: this.instanceId || ''
        }
      });
      return true;
    } catch (err) {
      console.warn('[DesktopLogger] Could not initialize native crash reporter:', err);
      return false;
    }
  }

  setupGlobalHandlers(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Synchronize to the final userData path after any profile/instance configuration
    this.syncUserDataPath();

    // Initialize native Electron/Chromium local crash dump capture early
    this.initNativeCrashReporter();

    // Use uncaughtExceptionMonitor to observe and persist fatal crashes
    // without altering Node's normal fatal error behavior or swallowing fatal exceptions.
    process.on('uncaughtExceptionMonitor', (err, origin) => {
      this.recordCrash({
        process: 'main',
        reason: origin ? `uncaughtException (${origin})` : 'uncaughtException',
        error: serializeError(err)
      });
    });

    try {
      app?.on?.('child-process-gone', (_event, details) => {
        this.recordCrash({
          process: 'child',
          reason: `child-process-gone (${details.type}: ${details.reason})`,
          exitCode: details.exitCode,
          context: { name: details.name, serviceName: details.serviceName }
        });
      });
    } catch {}

    this.setupIpcHandlers();

    // Schedule native dump check and pending crashes flush safely after app is ready
    try {
      if (app?.whenReady) {
        app.whenReady().then(() => {
          this.checkNativeCrashDumps();
          this.flushPendingCrashes().catch(() => {});
        }).catch(() => {});
      } else {
        this.checkNativeCrashDumps();
        this.flushPendingCrashes().catch(() => {});
      }
    } catch {
      this.checkNativeCrashDumps();
      this.flushPendingCrashes().catch(() => {});
    }
  }

  private setupIpcHandlers(): void {
    try {
      if (!ipcMain?.on) return;

      ipcMain.on('logger:log', (event, entry: unknown) => {
        if (!isTrustedSender(event)) return;
        if (!entry || typeof entry !== 'object') return;
        const raw = entry as Record<string, unknown>;

        // Validate and normalize log level (accept only debug, info, warn, error)
        let level: LogLevel = 'info';
        if (typeof raw.level === 'string') {
          const lower = raw.level.toLowerCase();
          if (lower === 'debug' || lower === 'info' || lower === 'warn' || lower === 'error') {
            level = lower;
          }
        }

        // Validate and normalize event name
        const eventName = typeof raw.event === 'string' && raw.event.trim().length > 0
          ? raw.event.trim()
          : 'renderer_event';

        // Validate and normalize message
        const message = typeof raw.message === 'string'
          ? raw.message
          : (raw.message !== null && raw.message !== undefined ? String(raw.message) : '');

        const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : undefined;
        const sessionCode = typeof raw.sessionCode === 'string' ? raw.sessionCode : undefined;
        const attemptId = typeof raw.attemptId === 'string' ? raw.attemptId : undefined;
        const meta = raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)
          ? (raw.meta as StructuredLogMeta)
          : undefined;
        const error = raw.error && typeof raw.error === 'object' && !Array.isArray(raw.error)
          ? (raw.error as StructuredError)
          : undefined;

        this.log({
          level,
          event: eventName,
          message,
          sessionId,
          sessionCode,
          attemptId,
          meta,
          error,
          process: 'renderer'
        });
      });

      ipcMain.handle('logger:crash', async (event, crashData: unknown) => {
        if (!isTrustedSender(event)) return null;
        if (!crashData || typeof crashData !== 'object') {
          return this.recordCrash({
            process: 'renderer',
            reason: 'unknown_renderer_crash'
          });
        }
        const raw = crashData as Partial<CrashReport>;
        return this.recordCrash({
          ...raw,
          process: 'renderer'
        });
      });

      ipcMain.handle('logger:get-log-paths', async (event) => {
        if (!isTrustedSender(event)) return null;
        return this.getLogPaths();
      });
    } catch (err) {
      console.warn('[DesktopLogger] Could not register IPC handlers:', err);
    }
  }
}

export const logger = new DesktopLogger();
