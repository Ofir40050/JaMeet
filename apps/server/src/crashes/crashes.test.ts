import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CrashReportStore, MAX_CRASH_REPORTS } from './crash-store.js';
import { createApp } from '../app.js';
import type { CrashReport } from '@jameet/shared';
import type { ServerConfig } from '../core/config.js';

describe('Server Crash Report Ingestion & CrashReportStore', () => {
  let testDataDir: string;
  let testStore: CrashReportStore;

  beforeEach(() => {
    testDataDir = path.join(os.tmpdir(), `jameet-crash-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    fs.mkdirSync(testDataDir, { recursive: true });
    testStore = new CrashReportStore(testDataDir);
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testDataDir)) {
        fs.rmSync(testDataDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('records a new crash report durably to disk and returns duplicate: false', () => {
    const report: CrashReport = {
      reportId: 'crash-001',
      timestamp: new Date().toISOString(),
      process: 'renderer',
      appVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      reason: 'Renderer WebGL context loss',
      error: { message: 'Out of memory' }
    };

    const res = testStore.recordReport(report);
    expect(res.isDuplicate).toBe(false);
    expect(res.report.reportId).toBe('crash-001');

    const filePath = path.join(testDataDir, 'crash-reports.json');
    expect(fs.existsSync(filePath)).toBe(true);

    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(onDisk.reports).toHaveLength(1);
    expect(onDisk.reports[0].reportId).toBe('crash-001');
  });

  it('acknowledges duplicate reports without creating duplicate records', () => {
    const report: CrashReport = {
      reportId: 'crash-dup-1',
      timestamp: new Date().toISOString(),
      process: 'main',
      appVersion: '0.1.0',
      platform: 'linux',
      arch: 'x64',
      reason: 'Process SIGSEGV'
    };

    const first = testStore.recordReport(report);
    expect(first.isDuplicate).toBe(false);

    const second = testStore.recordReport(report);
    expect(second.isDuplicate).toBe(true);
    expect(second.report.reportId).toBe('crash-dup-1');

    expect(testStore.getReportCount()).toBe(1);
  });

  it('does not leave in-memory store mutated when disk persistence fails', () => {
    const report: CrashReport = {
      reportId: 'crash-fail-persist',
      timestamp: new Date().toISOString(),
      process: 'native',
      appVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      reason: 'Fatal mach exception'
    };

    // Simulate write failure
    const writeFileSyncSpy = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied, write');
    });

    expect(() => testStore.recordReport(report)).toThrow('EACCES');
    expect(testStore.getReportById('crash-fail-persist')).toBeUndefined();
    expect(testStore.getReportCount()).toBe(0);

    writeFileSyncSpy.mockRestore();

    // Subsequent retry must succeed and be treated as new, not duplicate
    const retry = testStore.recordReport(report);
    expect(retry.isDuplicate).toBe(false);
    expect(testStore.getReportById('crash-fail-persist')).toBeDefined();
  });

  it('quarantines corrupted crash-reports.json on startup without crashing the server', () => {
    const filePath = path.join(testDataDir, 'crash-reports.json');
    fs.writeFileSync(filePath, '{"corrupted": true, broken json', 'utf-8');

    const freshStore = new CrashReportStore(testDataDir);
    expect(freshStore.getReportCount()).toBe(0);

    // Corrupted file must have been renamed to .corrupted.<ts>.json
    const files = fs.readdirSync(testDataDir);
    const corruptedFile = files.find((f) => f.includes('crash-reports.json.corrupted.'));
    expect(corruptedFile).toBeDefined();
  });

  it('enforces bounded retention pruning oldest reports beyond MAX_CRASH_REPORTS', () => {
    for (let i = 1; i <= MAX_CRASH_REPORTS + 10; i++) {
      testStore.recordReport({
        reportId: `report-${i}`,
        timestamp: new Date().toISOString(),
        process: 'renderer',
        appVersion: '0.1.0',
        platform: 'win32',
        arch: 'x64',
        reason: `Crash ${i}`
      });
    }

    expect(testStore.getReportCount()).toBe(MAX_CRASH_REPORTS);
    expect(testStore.getReportById('report-1')).toBeUndefined();
    expect(testStore.getReportById(`report-${MAX_CRASH_REPORTS + 10}`)).toBeDefined();
  });

  describe('HTTP Ingestion Endpoint POST /api/crashes', () => {
    const getTestConfig = (): ServerConfig => ({
      PORT: 3000,
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      ALLOWED_ORIGINS: 'http://localhost:5173,jameet-app://bundle',
      ENABLE_DEBUG_LOGS: false,
      DISCONNECT_GRACE_MS: 5000,
      EMPTY_ROOM_TTL_MS: 5000,
      DATA_DIR: testDataDir,
      JWT_SECRET: 'test-secret-at-least-32-characters-long!!',
      JWT_EXPIRES_IN: '1h',
      SALT_ROUNDS: 10,
      SESSION_TIMEOUT_MS: 3600000,
      RATE_LIMIT_LOGIN_MAX: 5,
      RATE_LIMIT_LOGIN_WINDOW_MS: 60000,
      RATE_LIMIT_REGISTER_MAX: 3,
      RATE_LIMIT_REGISTER_WINDOW_MS: 60000,
      ADMIN_KEY: 'test-admin-key',
      TURN_SECRET: 'test-turn-secret',
      TURN_URLS: 'stun:stun.l.google.com:19302',
      TURN_TTL_SECONDS: 86400
    });

    it('accepts valid crash report payload and sanitizes sensitive credentials before storing', async () => {
      const server = await createApp(getTestConfig());

      const response = await server.app.inject({
        method: 'POST',
        url: '/api/crashes',
        payload: {
          reportId: 'http-crash-1',
          timestamp: new Date().toISOString(),
          process: 'renderer',
          appVersion: '0.1.0',
          platform: 'darwin',
          arch: 'arm64',
          reason: 'Renderer exception with password=SuperSecretPassword123 and credential=turnSecret',
          error: {
            message: 'Auth failure with authToken=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjEyMyJ9.sig'
          }
        }
      });

      expect(response.statusCode).toBe(201);
      const json = JSON.parse(response.payload);
      expect(json.ok).toBe(true);
      expect(json.reportId).toBe('http-crash-1');
      expect(json.duplicate).toBe(false);

      // Verify on disk sanitization
      const onDisk = JSON.parse(fs.readFileSync(path.join(testDataDir, 'crash-reports.json'), 'utf-8'));
      const stored = onDisk.reports[0];
      expect(stored.reason).not.toContain('SuperSecretPassword123');
      expect(stored.reason).toContain('password=[REDACTED]');
      expect(stored.error.message).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');

      await server.app.close();
    });

    it('returns duplicate: true when same reportId is posted again', async () => {
      const server = await createApp(getTestConfig());

      const payload = {
        reportId: 'http-crash-dup',
        timestamp: new Date().toISOString(),
        process: 'main',
        appVersion: '0.1.0',
        platform: 'darwin',
        arch: 'arm64',
        reason: 'Main process crash'
      };

      const res1 = await server.app.inject({ method: 'POST', url: '/api/crashes', payload });
      expect(res1.statusCode).toBe(201);
      expect(JSON.parse(res1.payload).duplicate).toBe(false);

      const res2 = await server.app.inject({ method: 'POST', url: '/api/crashes', payload });
      expect(res2.statusCode).toBe(200);
      expect(JSON.parse(res2.payload).duplicate).toBe(true);

      await server.app.close();
    });

    it('rejects malformed payload with HTTP 400', async () => {
      const server = await createApp(getTestConfig());

      const res = await server.app.inject({
        method: 'POST',
        url: '/api/crashes',
        payload: {
          // Missing required fields like timestamp, process, appVersion, platform, arch
          reason: 'Only reason provided'
        }
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).ok).toBe(false);

      await server.app.close();
    });

    it('rejects oversized crash report payload exceeding 64 KB with HTTP 413', async () => {
      const server = await createApp(getTestConfig());

      // Create a payload larger than 64 KB (e.g. 70 KB of extra data in a string)
      const hugeString = 'X'.repeat(70 * 1024);
      const res = await server.app.inject({
        method: 'POST',
        url: '/api/crashes',
        payload: {
          reportId: 'oversized-crash',
          timestamp: new Date().toISOString(),
          process: 'renderer',
          appVersion: '0.1.0',
          platform: 'darwin',
          arch: 'arm64',
          reason: hugeString
        }
      });

      expect(res.statusCode).toBe(413);
      expect(JSON.parse(res.payload).ok).toBe(false);

      // Verify no report was written to store
      const onDisk = fs.existsSync(path.join(testDataDir, 'crash-reports.json'));
      expect(onDisk).toBe(false);

      await server.app.close();
    });
  });
});
