import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DesktopLogger } from './logger';
import { sanitizeLogData, isSensitiveKey } from '@jameet/shared';

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
    expect(logEntry.message).not.toContain('turnPass789');
    expect(logEntry.message).toContain('https://admin_user:[REDACTED]@signaling.jameet.app:3000/ws?authToken=[REDACTED]');
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
});
