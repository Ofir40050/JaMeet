import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerLogger } from './logger.js';
import { sanitizeLogData, isSensitiveKey } from '@jameet/shared';

describe('Server Production Structured Logging & Error Handling', () => {
  let serverLogger: ServerLogger;

  beforeEach(() => {
    serverLogger = new ServerLogger(false);
  });

  it('formats structured log entries with event, level, and timestamp', () => {
    const entry = serverLogger.info('session_created', 'Session ABC12345 created', {
      role: 'host',
      isGuest: false
    }, { sessionCode: 'ABC12345', sessionId: 'sess-abc' });

    expect(entry.event).toBe('session_created');
    expect(entry.level).toBe('info');
    expect(entry.process).toBe('server');
    expect(entry.sessionCode).toBe('ABC12345');
    expect(entry.sessionId).toBe('sess-abc');
    expect(entry.meta?.role).toBe('host');
    expect(entry.timestamp).toBeDefined();
  });

  it('records error level logs with serialized error stacks', () => {
    const err = new Error('Database connection timed out');
    const entry = serverLogger.error('server_datastore_error', 'Datastore read failure', {
      attempt: 3
    }, err, { sessionId: 'sess-999' });

    expect(entry.event).toBe('server_datastore_error');
    expect(entry.level).toBe('error');
    expect(entry.error?.message).toBe('Database connection timed out');
    expect(entry.error?.stack).toBeDefined();
  });

  it('strictly sanitizes credentials, tokens, and private lyrics/notes on server logs', () => {
    const sensitivePayload = {
      username: 'lead_producer',
      password: 'MyPlainTextPassword!',
      authToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjEyMyJ9.sig',
      reconnectToken: 'reconnect-uuid-999',
      turnSharedSecret: 'turn-secret-12345678',
      credential: 'turn-hmac-credential-987',
      email: 'secret_artist@example.com',
      usernameOrEmail: 'secret_artist@example.com',
      lyrics: 'Confidential verse 1 lyrics',
      notes: 'Private chord progression: Am - F - C - G',
      lyricsWorkspace: { title: 'Secret Song' },
      projectWorkspace: { tracks: [] },
      adminToken: 'admin-super-token',
      safeField: 'session_ready'
    };

    const sanitized = sanitizeLogData(sensitivePayload) as any;

    expect(sanitized.username).toBe('lead_producer');
    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.authToken).toBe('[REDACTED]');
    expect(sanitized.reconnectToken).toBe('[REDACTED]');
    expect(sanitized.turnSharedSecret).toBe('[REDACTED]');
    expect(sanitized.credential).toBe('[REDACTED]');
    expect(sanitized.email).toBe('[REDACTED]');
    expect(sanitized.usernameOrEmail).toBe('[REDACTED]');
    expect(sanitized.lyrics).toBe('[REDACTED]');
    expect(sanitized.notes).toBe('[REDACTED]');
    expect(sanitized.lyricsWorkspace).toBe('[REDACTED]');
    expect(sanitized.projectWorkspace).toBe('[REDACTED]');
    expect(sanitized.adminToken).toBe('[REDACTED]');
    expect(sanitized.safeField).toBe('session_ready');
  });

  it('sanitizes credentials and tokens embedded in arbitrary server log messages', () => {
    const entry = serverLogger.info(
      'auth_failure',
      'Signaling client failed auth with authToken=rec-123 and standalone token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c3JfMSJ9.sig and password="mySecretPassword123" at url https://admin:superSecretPass@turn.jameet.app:3478 with credential=turnPass456'
    );

    expect(entry.message).not.toContain('superSecretPass');
    expect(entry.message).not.toContain('mySecretPassword123');
    expect(entry.message).not.toContain('rec-123');
    expect(entry.message).not.toContain('turnPass456');
    expect(entry.message).toContain('https://admin:[REDACTED]@turn.jameet.app:3478');
    expect(entry.message).toContain('authToken=[REDACTED]');
    expect(entry.message).toContain('[REDACTED_TOKEN]');
    expect(entry.message).toContain('password=[REDACTED]');
    expect(entry.message).toContain('credential=[REDACTED]');
  });

  it('redacts TURN credential in iceServers while preserving username and urls', () => {
    const entry = serverLogger.info('session_ice_created', 'Ice servers created for participant', {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:turn.jameet.app:3478', username: '1786914300:part-99', credential: 'turnSecretPass' }
      ]
    }, { sessionCode: 'ABC12345' });

    const ice = (entry.meta?.iceServers as any)[1];
    expect(ice.urls).toBe('turn:turn.jameet.app:3478');
    expect(ice.username).toBe('1786914300:part-99');
    expect(ice.credential).toBe('[REDACTED]');
  });

  it('observes fatal server errors via uncaughtExceptionMonitor without intercepting process termination', () => {
    const errorSpy = vi.spyOn(serverLogger, 'error');
    const originalListeners = process.listeners('uncaughtExceptionMonitor');

    serverLogger.setupGlobalHandlers();

    const currentListeners = process.listeners('uncaughtExceptionMonitor');
    expect(currentListeners.length).toBeGreaterThan(originalListeners.length);

    const latestListener = currentListeners[currentListeners.length - 1];
    const fatalError = new Error('Fatal database memory exhaustion in signaling loop with token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sig');

    // Simulate Node emitting uncaughtExceptionMonitor
    (latestListener as any)(fatalError, 'uncaughtException');

    expect(errorSpy).toHaveBeenCalled();
    const [event, msg, meta] = errorSpy.mock.calls[errorSpy.mock.calls.length - 1];
    expect(event).toBe('fatal_server_crash');
    expect(msg).toContain('Fatal server crash detected: uncaughtException');
    expect(meta?.nodeVersion).toBe(process.version);
    expect(meta?.platform).toBe(process.platform);
    expect(meta?.pid).toBe(process.pid);

    const returnedEntry = errorSpy.mock.results[errorSpy.mock.results.length - 1].value;
    expect(returnedEntry.error?.message).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sig');
    expect(returnedEntry.error?.message).toContain('token=[REDACTED]');

    // Cleanup
    process.removeListener('uncaughtExceptionMonitor', latestListener);
  });
});
