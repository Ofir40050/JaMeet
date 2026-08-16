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
    expect(sanitized.lyrics).toBe('[REDACTED]');
    expect(sanitized.notes).toBe('[REDACTED]');
    expect(sanitized.lyricsWorkspace).toBe('[REDACTED]');
    expect(sanitized.projectWorkspace).toBe('[REDACTED]');
    expect(sanitized.adminToken).toBe('[REDACTED]');
    expect(sanitized.safeField).toBe('session_ready');
  });
});
