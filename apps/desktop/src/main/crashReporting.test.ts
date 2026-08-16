import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ipcMain } from 'electron';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DesktopLogger } from './logger';
import { sanitizeLogData, isSensitiveKey } from '@jameet/shared';

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.1.0',
    getPath: (name: string) => `/tmp/jameet-mock-${name}`
  },
  crashReporter: {
    start: vi.fn()
  },
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn()
  }
}));

describe('Desktop Production Crash Reporting & Structured Logging', () => {
  let testLogDir: string;
  let testLogger: DesktopLogger;

  beforeEach(() => {
    testLogDir = join(tmpdir(), `jameet-log-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    mkdirSync(testLogDir, { recursive: true });
    testLogger = new DesktopLogger(testLogDir, 'test-instance-1');
  });

  afterEach(() => {
    try {
      if (existsSync(testLogDir)) {
        rmSync(testLogDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('initializes log paths in the configured directory', () => {
    const paths = testLogger.getLogPaths();
    expect(paths.logDir).toBe(testLogDir);
    expect(paths.logFilePath).toBe(join(testLogDir, 'jameet-app.log'));
    expect(paths.crashFilePath).toBe(join(testLogDir, 'crashes.jsonl'));
  });

  it('writes structured log entries with metadata and platform information', () => {
    const entry = testLogger.info('session_create_success', 'Session ABCDEFGH created', {
      role: 'host',
      participantCount: 1
    }, { sessionCode: 'ABCDEFGH', sessionId: 'sess-123' });

    expect(entry.event).toBe('session_create_success');
    expect(entry.level).toBe('info');
    expect(entry.sessionCode).toBe('ABCDEFGH');
    expect(entry.sessionId).toBe('sess-123');
    expect(entry.instanceId).toBe('test-instance-1');
    expect(entry.platform).toBe(process.platform);
    expect(entry.arch).toBe(process.arch);

    const logContent = readFileSync(testLogger.getLogPaths().logFilePath, 'utf8');
    const parsed = JSON.parse(logContent.trim());
    expect(parsed.event).toBe('session_create_success');
    expect(parsed.meta.role).toBe('host');
    expect(parsed.sessionCode).toBe('ABCDEFGH');
  });

  it('records crash reports with system details, reason, and error stack', () => {
    const testError = new Error('Unexpected native bridge abort');
    const crash = testLogger.recordCrash({
      process: 'main',
      reason: 'uncaughtException',
      error: {
        name: testError.name,
        message: testError.message,
        stack: testError.stack
      },
      sessionCode: 'XYZ98765',
      context: { window: 'mainWindow', nativeModule: 'jameet-app-audio-tap' }
    });

    expect(crash.reason).toBe('uncaughtException');
    expect(crash.error?.message).toBe('Unexpected native bridge abort');
    expect(crash.platform).toBe(process.platform);
    expect(crash.sessionCode).toBe('XYZ98765');
    expect(crash.context?.window).toBe('mainWindow');

    const crashContent = readFileSync(testLogger.getLogPaths().crashFilePath, 'utf8');
    const parsedCrash = JSON.parse(crashContent.trim());
    expect(parsedCrash.reason).toBe('uncaughtException');
    expect(parsedCrash.error?.message).toBe('Unexpected native bridge abort');
    expect(parsedCrash.context?.nativeModule).toBe('jameet-app-audio-tap');
  });

  it('strictly sanitizes and redacts passwords, tokens, secrets, lyrics, and notes', () => {
    const rawData = {
      username: 'guitarist_bob',
      password: 'super-secret-password123',
      currentPassword: 'old-password!',
      newPassword: 'brand-new-password!',
      authToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      token: 'secret-token-xyz',
      reconnectToken: 'reconnect-token-123',
      turnSharedSecret: 'very-secret-turn-key',
      lyrics: 'Line 1 of song\nLine 2 of song',
      notes: 'Private project idea and chords',
      safeInfo: {
        code: 'ABCD1234',
        audioMode: 'music'
      }
    };

    const sanitized = sanitizeLogData(rawData) as any;

    expect(sanitized.username).toBe('guitarist_bob');
    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.currentPassword).toBe('[REDACTED]');
    expect(sanitized.newPassword).toBe('[REDACTED]');
    expect(sanitized.authToken).toBe('[REDACTED]');
    expect(sanitized.token).toBe('[REDACTED]');
    expect(sanitized.reconnectToken).toBe('[REDACTED]');
    expect(sanitized.turnSharedSecret).toBe('[REDACTED]');
    expect(sanitized.lyrics).toBe('[REDACTED]');
    expect(sanitized.notes).toBe('[REDACTED]');
    expect(sanitized.safeInfo.code).toBe('ABCD1234');
    expect(sanitized.safeInfo.audioMode).toBe('music');
  });

  it('redacts sensitive fields in nested arrays and errors', () => {
    const sensitiveErr = new Error('Failed to authenticate token Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    const errSanitized = sanitizeLogData(sensitiveErr);
    expect(errSanitized.message).toContain('Bearer [REDACTED]');

    const arrayData = [
      { token: 'tok-1', safe: 'ok-1' },
      { password: 'pwd-2', safe: 'ok-2' }
    ];
    const arraySanitized = sanitizeLogData(arrayData);
    expect(arraySanitized[0].token).toBe('[REDACTED]');
    expect(arraySanitized[0].safe).toBe('ok-1');
    expect(arraySanitized[1].password).toBe('[REDACTED]');
    expect(arraySanitized[1].safe).toBe('ok-2');
  });

  it('detects sensitive keys correctly', () => {
    expect(isSensitiveKey('password')).toBe(true);
    expect(isSensitiveKey('authToken')).toBe(true);
    expect(isSensitiveKey('reconnect_token')).toBe(true);
    expect(isSensitiveKey('turnSharedSecret')).toBe(true);
    expect(isSensitiveKey('credential')).toBe(true);
    expect(isSensitiveKey('credentials')).toBe(true);
    expect(isSensitiveKey('lyricsDocs')).toBe(true);
    expect(isSensitiveKey('notes')).toBe(true);
    expect(isSensitiveKey('sessionCode')).toBe(false);
    expect(isSensitiveKey('participantId')).toBe(false);
    expect(isSensitiveKey('sampleRate')).toBe(false);
    expect(isSensitiveKey('username')).toBe(false);
    expect(isSensitiveKey('urls')).toBe(false);
  });

  it('observes fatal crashes via uncaughtExceptionMonitor without intercepting fatal exit', () => {
    const originalListeners = process.listeners('uncaughtExceptionMonitor');
    testLogger.setupGlobalHandlers();

    // Verify uncaughtExceptionMonitor was registered
    const currentListeners = process.listeners('uncaughtExceptionMonitor');
    expect(currentListeners.length).toBeGreaterThan(originalListeners.length);

    // Verify triggering the monitor records the crash to disk
    const fatalError = new Error('Fatal native memory corruption');
    const latestListener = currentListeners[currentListeners.length - 1];
    (latestListener as any)(fatalError, 'uncaughtException');

    const crashContent = readFileSync(testLogger.getLogPaths().crashFilePath, 'utf8');
    const parsedCrash = JSON.parse(crashContent.trim());
    expect(parsedCrash.process).toBe('main');
    expect(parsedCrash.reason).toContain('uncaughtException');
    expect(parsedCrash.error?.message).toBe('Fatal native memory corruption');

    // Clean up test listener
    process.removeListener('uncaughtExceptionMonitor', latestListener);
  });

  it('sanitizes sensitive credentials embedded inside top-level log messages and crash reasons', () => {
    const logEntry = testLogger.info(
      'network_error',
      'Failed connecting to https://admin_user:super_secret_pwd@signaling.jameet.app:3000/ws?authToken=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgN&reconnectToken=rec-999-xyz with password: "RawPasswordHere!" and turnSharedSecret=turn-secret-123 and credential=turnPass789'
    );

    expect(logEntry.message).not.toContain('super_secret_pwd');
    expect(logEntry.message).not.toContain('RawPasswordHere!');
    expect(logEntry.message).not.toContain('rec-999-xyz');
    expect(logEntry.message).not.toContain('turn-secret-123');
    expect(logEntry.message).toContain('https://admin_user:[REDACTED]@signaling.jameet.app:3000/ws?authToken=[REDACTED_TOKEN]');
    expect(logEntry.message).toContain('reconnectToken=[REDACTED]');
    expect(logEntry.message).toContain('password:[REDACTED]');
    expect(logEntry.message).toContain('turnSharedSecret=[REDACTED]');
    expect(logEntry.message).toContain('credential=[REDACTED]');

    const crashReport = testLogger.recordCrash({
      process: 'main',
      reason: 'Fatal crash during handshake with token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjEyMyJ9.sig and password=SecretCrashPassword and credential: "turnSecretKey"',
      error: new Error('Uncaught exception in auth: reconnectToken: "reconnect-secret-token"')
    });

    expect(crashReport.reason).not.toContain('SecretCrashPassword');
    expect(crashReport.reason).not.toContain('turnSecretKey');
    expect(crashReport.reason).toContain('[REDACTED_TOKEN]');
    expect(crashReport.reason).toContain('credential:[REDACTED]');
    expect(crashReport.error?.message).not.toContain('reconnect-secret-token');
    expect(crashReport.error?.message).toContain('reconnectToken:[REDACTED]');
  });

  it('redacts TURN credentials in structured IceServerConfig while preserving usernames and server URLs', () => {
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: ['turn:turn.jameet.app:3478?transport=udp', 'turns:turn.jameet.app:5349?transport=tcp'],
        username: '1786914300:participant-123',
        credential: 'superSecretTurnHMACPassword'
      }
    ];

    const sanitized = sanitizeLogData(iceServers) as any;
    expect(sanitized[0].urls).toBe('stun:stun.l.google.com:19302');
    expect(sanitized[1].urls).toEqual(['turn:turn.jameet.app:3478?transport=udp', 'turns:turn.jameet.app:5349?transport=tcp']);
    expect(sanitized[1].username).toBe('1786914300:participant-123');
    expect(sanitized[1].credential).toBe('[REDACTED]');

    const logWithIce = testLogger.info('webrtc_turn_configured', 'Configured TURN ice servers', {
      iceServers
    }, { sessionCode: 'ABC12345' });

    expect(logWithIce.meta?.iceServers).toBeDefined();
    const loggedIce = (logWithIce.meta?.iceServers as any)[1];
    expect(loggedIce.username).toBe('1786914300:participant-123');
    expect(loggedIce.credential).toBe('[REDACTED]');
  });

  it('initializes native crash capture locally without remote upload', () => {
    // Should safely invoke without error
    const initialized = testLogger.initNativeCrashReporter();
    expect(typeof initialized).toBe('boolean');
  });

  it('enforces renderer process attribution when crash reports arrive via logger:crash IPC', async () => {
    let crashHandler: Function | undefined;
    const originalOn = (ipcMain as any)?.on;
    const originalHandle = (ipcMain as any)?.handle;

    (ipcMain as any).on = vi.fn();
    (ipcMain as any).handle = vi.fn((channel: string, handler: Function) => {
      if (channel === 'logger:crash') {
        crashHandler = handler;
      }
    });

    const freshLogger = new DesktopLogger(testLogDir, 'test-instance-2');
    freshLogger.setupGlobalHandlers();

    expect(crashHandler).toBeDefined();
    const result = await crashHandler!({}, {
      process: 'main', // Attempt to spoof or override as main process
      reason: 'renderer_syntax_error',
      sessionCode: 'XYZ12345'
    });

    expect(result.process).toBe('renderer');
    expect(result.sessionCode).toBe('XYZ12345');
    expect(result.reason).toBe('renderer_syntax_error');

    (ipcMain as any).on = originalOn;
    (ipcMain as any).handle = originalHandle;
  });

  it('validates and normalizes malformed renderer logging IPC input without throwing', () => {
    let logHandler: Function | undefined;
    const originalOn = (ipcMain as any)?.on;
    const originalHandle = (ipcMain as any)?.handle;

    (ipcMain as any).on = vi.fn((channel: string, handler: Function) => {
      if (channel === 'logger:log') {
        logHandler = handler;
      }
    });
    (ipcMain as any).handle = vi.fn();

    const freshLogger = new DesktopLogger(testLogDir, 'test-instance-3');
    const logSpy = vi.spyOn(freshLogger, 'log');
    freshLogger.setupGlobalHandlers();

    expect(logHandler).toBeDefined();

    // 1. Malformed level (numeric, invalid string, object) and empty event
    expect(() => {
      logHandler!({}, {
        level: 12345, // Invalid level type
        event: '   ',  // Empty event
        message: 'Normal message',
        sessionId: 'sess-abc'
      });
    }).not.toThrow();

    let lastCall = logSpy.mock.calls[logSpy.mock.calls.length - 1][0];
    expect(lastCall.level).toBe('info');
    expect(lastCall.event).toBe('renderer_event');
    expect(lastCall.message).toBe('Normal message');
    expect(lastCall.process).toBe('renderer');
    expect(lastCall.sessionId).toBe('sess-abc');

    // 2. Completely malformed payload (null, undefined, non-object)
    expect(() => {
      logHandler!({}, null);
      logHandler!({}, undefined);
      logHandler!({}, 'just a string');
    }).not.toThrow();

    // 3. Valid levels (debug, warn, error)
    logHandler!({}, {
      level: 'WARN', // Case-insensitive normalization
      event: 'webrtc_ice_failure',
      message: 'ICE connection disconnected',
      sessionCode: 'ABCDEFGH',
      meta: { candidateCount: 0 }
    });

    lastCall = logSpy.mock.calls[logSpy.mock.calls.length - 1][0];
    expect(lastCall.level).toBe('warn');
    expect(lastCall.event).toBe('webrtc_ice_failure');
    expect(lastCall.message).toBe('ICE connection disconnected');
    expect(lastCall.process).toBe('renderer');
    expect(lastCall.sessionCode).toBe('ABCDEFGH');
    expect(lastCall.meta).toEqual({ candidateCount: 0 });

    (ipcMain as any).on = originalOn;
    (ipcMain as any).handle = originalHandle;
  });

  it('preserves non-sensitive diagnostic messages, technical identifiers, and error details', () => {
    const logEntry = testLogger.info(
      'audio_init_success',
      'Microphone 1 initialized at 48000Hz (sampleRate: 48000, channelRoute: 1-2, device: Built-in Microphone)',
      { sampleRate: 48000 }
    );

    expect(logEntry.message).toBe('Microphone 1 initialized at 48000Hz (sampleRate: 48000, channelRoute: 1-2, device: Built-in Microphone)');
    expect(logEntry.appVersion).toBeDefined();
    expect(logEntry.platform).toBe(process.platform);
  });

  describe('Automatic Remote Crash Reporting & Delivery Queue', () => {
    it('generates unique reportId and enqueues to pending-crashes.json before remote delivery', () => {
      const crash = testLogger.recordCrash({
        process: 'renderer',
        reason: 'WebGL Context Loss'
      });

      expect(crash.reportId).toBeDefined();
      expect(typeof crash.reportId).toBe('string');

      // Verify local file persistence
      const pendingQueue = testLogger.loadPendingQueue();
      expect(pendingQueue).toHaveLength(1);
      expect(pendingQueue[0].reportId).toBe(crash.reportId);
      expect(pendingQueue[0].reason).toBe('WebGL Context Loss');
    });

    it('flushes pending queue and removes acknowledged reports on successful delivery', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
        status: 201,
        ok: true,
        json: async () => ({ ok: true, reportId: 'crash-rem-1', duplicate: false })
      } as any));

      testLogger.recordCrash({
        reportId: 'crash-rem-1',
        process: 'renderer',
        reason: 'Render process crash'
      });

      expect(testLogger.loadPendingQueue()).toHaveLength(1);

      await testLogger.flushPendingCrashes();

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/crashes'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      );

      // Successfully acknowledged crash should be removed from pending queue
      expect(testLogger.loadPendingQueue()).toHaveLength(0);

      fetchSpy.mockRestore();
    });

    it('does not remove pending report if server returns success status but mismatched reportId or ok !== true', async () => {
      // 1. Mismatched reportId
      const fetchSpyMismatch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ ok: true, reportId: 'different-report-id' })
      } as any);

      testLogger.recordCrash({
        reportId: 'crash-validate-1',
        process: 'renderer',
        reason: 'Crash 1'
      });

      await testLogger.flushPendingCrashes();
      expect(testLogger.loadPendingQueue()).toHaveLength(1);
      expect(testLogger.loadPendingQueue()[0].reportId).toBe('crash-validate-1');
      fetchSpyMismatch.mockRestore();

      // 2. ok is false or missing
      const fetchSpyNotOk = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ ok: false, reportId: 'crash-validate-1' })
      } as any);

      await testLogger.flushPendingCrashes();
      expect(testLogger.loadPendingQueue()).toHaveLength(1);
      fetchSpyNotOk.mockRestore();

      // 3. Response body is malformed / non-JSON
      const fetchSpyMalformed = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => { throw new Error('Invalid JSON'); }
      } as any);

      await testLogger.flushPendingCrashes();
      expect(testLogger.loadPendingQueue()).toHaveLength(1);
      fetchSpyMalformed.mockRestore();

      // 4. Proper matching acknowledgement removes the pending report
      const fetchSpyValid = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ ok: true, reportId: 'crash-validate-1', duplicate: true })
      } as any);

      await testLogger.flushPendingCrashes();
      expect(testLogger.loadPendingQueue()).toHaveLength(0);
      fetchSpyValid.mockRestore();
    });

    it('retains report in pending queue if delivery fails or server is unreachable', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED: Server unreachable'));

      testLogger.recordCrash({
        reportId: 'crash-offline-1',
        process: 'main',
        reason: 'Fatal main process crash'
      });

      expect(testLogger.loadPendingQueue()).toHaveLength(1);

      await testLogger.flushPendingCrashes();

      // Pending queue must still retain the crash for next retry
      const remaining = testLogger.loadPendingQueue();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].reportId).toBe('crash-offline-1');

      fetchSpy.mockRestore();
    });

    it('preserves concurrent crash reports added while flusher is processing', async () => {
      let resolveFirstFetch: Function;
      const fetchPromise = new Promise((resolve) => {
        resolveFirstFetch = resolve;
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
        return fetchPromise.then(() => ({
          status: 201,
          ok: true,
          json: async () => ({ ok: true, reportId: 'crash-concurrent-1', duplicate: false })
        } as any));
      });

      // 1. First crash enqueued and background flush initiated
      testLogger.recordCrash({
        reportId: 'crash-concurrent-1',
        process: 'main',
        reason: 'Initial crash'
      });

      // 2. Concurrently record a second crash while flusher is in-flight on the first request
      testLogger.recordCrash({
        reportId: 'crash-concurrent-2',
        process: 'renderer',
        reason: 'Second concurrent crash'
      });

      // 3. Resolve first fetch
      resolveFirstFetch!();
      await new Promise((r) => setTimeout(r, 50));

      // 4. Verify first crash was removed on 201 acknowledgement, but second crash was NOT overwritten or dropped
      const queueAfter = testLogger.loadPendingQueue();
      expect(queueAfter).toHaveLength(1);
      expect(queueAfter[0].reportId).toBe('crash-concurrent-2');

      fetchSpy.mockRestore();
    });

    it('detects native Crashpad minidumps on startup, creates deterministic metadata reports with process native, and tracks processed dumps', () => {
      const mockDumpsDir = join(testLogDir, 'mock-crash-dumps');
      mkdirSync(mockDumpsDir, { recursive: true });

      // Create a dummy .dmp file
      const dmpFile = join(mockDumpsDir, 'crashpad-dump-12345.dmp');
      writeFileSync(dmpFile, 'MOCK_MINIDUMP_BINARY_DATA');

      testLogger.checkNativeCrashDumps(mockDumpsDir);

      // Verify crash report was recorded with process: 'native'
      const crashContent = readFileSync(testLogger.getLogPaths().crashFilePath, 'utf8');
      const lines = crashContent.trim().split('\n');
      const latestCrash = JSON.parse(lines[lines.length - 1]);

      expect(latestCrash.process).toBe('native');
      expect(latestCrash.reason).toBe('native_crashpad_dump');
      expect(latestCrash.reportId).toMatch(/^native-[a-f0-9]{32}$/);
      expect(latestCrash.context?.dumpFilename).toBe('crashpad-dump-12345.dmp');

      // Verify pending queue has this native dump report
      const pending = testLogger.loadPendingQueue();
      expect(pending.some((p) => p.reportId === latestCrash.reportId)).toBe(true);

      // Verify second scan skips already processed dump file
      const initialCrashLinesCount = lines.length;
      testLogger.checkNativeCrashDumps(mockDumpsDir);
      const crashContent2 = readFileSync(testLogger.getLogPaths().crashFilePath, 'utf8');
      expect(crashContent2.trim().split('\n').length).toBe(initialCrashLinesCount);
    });
  });
});
