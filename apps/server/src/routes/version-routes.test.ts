import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { loadConfig } from '../core/config.js';

describe('Server Version Awareness Endpoint', () => {
  let appInstance: any;
  let testDataDir: string;

  beforeEach(() => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-version-test-'));
  });

  afterEach(async () => {
    if (appInstance?.app) {
      await appInstance.app.close();
    }
    if (testDataDir && fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it('exposes current latest and minimum supported app versions via /api/version', async () => {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      DATA_DIR: testDataDir,
      LATEST_APP_VERSION: '0.2.0',
      MIN_SUPPORTED_APP_VERSION: '0.1.5',
      APP_DOWNLOAD_URL: 'https://github.com/Ofir40050/JaMeet/releases/tag/v0.2.0',
      FEEDBACK_URL: 'https://github.com/Ofir40050/JaMeet/issues/new'
    });

    appInstance = await createApp(config);
    const res = await appInstance.app.inject({
      method: 'GET',
      url: '/api/version'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.latestVersion).toBe('0.2.0');
    expect(body.minSupportedVersion).toBe('0.1.5');
    expect(body.downloadUrl).toBe('https://github.com/Ofir40050/JaMeet/releases/tag/v0.2.0');
    expect(body.feedbackUrl).toBe('https://github.com/Ofir40050/JaMeet/issues/new');
  });

  it('handles GET and HEAD probes on root /, /healthz, and /health successfully for deployment monitors', async () => {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      DATA_DIR: testDataDir
    });

    appInstance = await createApp(config);

    // Root GET probe
    const rootGet = await appInstance.app.inject({ method: 'GET', url: '/' });
    expect(rootGet.statusCode).toBe(200);
    expect(JSON.parse(rootGet.body)).toMatchObject({ ok: true, service: 'jameet-server', status: 'online' });

    // Root HEAD probe (Render default health check)
    const rootHead = await appInstance.app.inject({ method: 'HEAD', url: '/' });
    expect(rootHead.statusCode).toBe(200);

    // Healthz GET & HEAD probe
    const healthzGet = await appInstance.app.inject({ method: 'GET', url: '/healthz' });
    expect(healthzGet.statusCode).toBe(200);
    expect(JSON.parse(healthzGet.body)).toEqual({ ok: true });

    const healthzHead = await appInstance.app.inject({ method: 'HEAD', url: '/healthz' });
    expect(healthzHead.statusCode).toBe(200);

    // Health GET & HEAD probe
    const healthGet = await appInstance.app.inject({ method: 'GET', url: '/health' });
    expect(healthGet.statusCode).toBe(200);
    expect(JSON.parse(healthGet.body)).toEqual({ ok: true });

    const healthHead = await appInstance.app.inject({ method: 'HEAD', url: '/health' });
    expect(healthHead.statusCode).toBe(200);
  });

  it('enforces brute force throttling on /api/auth/login and rate limits /api/auth/guest', async () => {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      DATA_DIR: testDataDir
    });

    appInstance = await createApp(config);

    // Test guest creation throttling
    for (let i = 0; i < 10; i++) {
      const res = await appInstance.app.inject({
        method: 'POST',
        url: '/api/auth/guest',
        payload: { displayName: `Guest ${i}` },
        remoteAddress: '198.51.100.99'
      });
      expect(res.statusCode).toBe(200);
    }

    // 11th guest request from same IP should receive 429
    const blockedGuest = await appInstance.app.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { displayName: 'Spam Guest' },
      remoteAddress: '198.51.100.99'
    });
    expect(blockedGuest.statusCode).toBe(429);
    expect(JSON.parse(blockedGuest.body).message).toContain('Too many guest sessions');

    // Test login brute force throttling for a targeted account
    const targetUser = 'brute_force_target';
    for (let i = 0; i < 5; i++) {
      const failRes = await appInstance.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { usernameOrEmail: targetUser, password: 'WrongPassword123!' },
        remoteAddress: '198.51.100.100'
      });
      expect(failRes.statusCode).toBe(401);
    }

    // 6th attempt should be blocked with 429 Too Many Requests
    const throttledLogin = await appInstance.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { usernameOrEmail: targetUser, password: 'WrongPassword123!' },
      remoteAddress: '198.51.100.100'
    });
    expect(throttledLogin.statusCode).toBe(429);
    expect(JSON.parse(throttledLogin.body).message).toContain('Too many failed login attempts');
  });
});
