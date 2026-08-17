import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { UserStore } from './auth.js';
import {
  verifyAdminSecret,
  createAdminSessionToken,
  verifyAdminSessionToken,
  parseCookies,
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_TTL_MS
} from './admin-panel.js';

describe('JaMeet Secure Admin Panel', () => {
  let testDir: string;
  const TEST_ADMIN_SECRET = 'test-super-secret-admin-pass-2026';

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-admin-panel-test-'));
  });

  afterEach(() => {
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Cryptographic Helpers & Token Security', () => {
    it('verifies admin secret in constant time and rejects non-matching or empty values', () => {
      expect(verifyAdminSecret(TEST_ADMIN_SECRET, TEST_ADMIN_SECRET)).toBe(true);
      expect(verifyAdminSecret('wrong-secret', TEST_ADMIN_SECRET)).toBe(false);
      expect(verifyAdminSecret('', TEST_ADMIN_SECRET)).toBe(false);
      expect(verifyAdminSecret(TEST_ADMIN_SECRET, '')).toBe(false);
      expect(verifyAdminSecret('test-super-secret', TEST_ADMIN_SECRET)).toBe(false);
    });

    it('creates and verifies signed admin session tokens with 12-hour expiration', () => {
      const token = createAdminSessionToken(TEST_ADMIN_SECRET);
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3);

      expect(verifyAdminSessionToken(token, TEST_ADMIN_SECRET)).toBe(true);
      // Fails with wrong secret
      expect(verifyAdminSessionToken(token, 'different-secret')).toBe(false);
      // Fails with tampered token
      expect(verifyAdminSessionToken(token + 'x', TEST_ADMIN_SECRET)).toBe(false);
      expect(verifyAdminSessionToken('invalid.token', TEST_ADMIN_SECRET)).toBe(false);
    });

    it('rejects expired session tokens', () => {
      const pastTime = Date.now() - (ADMIN_SESSION_TTL_MS + 1000);
      const nonce = crypto.randomBytes(16).toString('hex');
      const payload = `${pastTime}.${nonce}`;
      const hmac = crypto.createHmac('sha256', TEST_ADMIN_SECRET).update(payload).digest('hex');
      const expiredToken = `${payload}.${hmac}`;

      expect(verifyAdminSessionToken(expiredToken, TEST_ADMIN_SECRET)).toBe(false);
    });
  });

  describe('Fail-Closed Behavior When JAMEET_ADMIN_SECRET is Missing', () => {
    it('returns 404 for all admin routes when JAMEET_ADMIN_SECRET is unset', async () => {
      const config = loadConfig({
        NODE_ENV: 'test',
        DATA_DIR: testDir,
        ALLOWED_ORIGINS: 'http://localhost:3000'
      });
      expect(config.JAMEET_ADMIN_SECRET).toBeUndefined();

      const { app } = await createApp(config);

      // GET /admin
      const resGet = await app.inject({
        method: 'GET',
        url: '/admin'
      });
      expect(resGet.statusCode).toBe(404);

      // POST /admin/login
      const resLogin = await app.inject({
        method: 'POST',
        url: '/admin/login',
        payload: { secret: 'anything' }
      });
      expect(resLogin.statusCode).toBe(404);

      // POST /admin/logout
      const resLogout = await app.inject({
        method: 'POST',
        url: '/admin/logout'
      });
      expect(resLogout.statusCode).toBe(404);

      // GET /admin/api/users
      const resUsers = await app.inject({
        method: 'GET',
        url: '/admin/api/users'
      });
      expect(resUsers.statusCode).toBe(404);

      // POST /admin/api/users/:id/access
      const resAccess = await app.inject({
        method: 'POST',
        url: '/admin/api/users/user-123/access',
        payload: { access: 'paid' }
      });
      expect(resAccess.statusCode).toBe(404);

      await app.close();
    });
  });

  describe('Authentication & Web Dashboard Access', () => {
    it('serves the admin login page when unauthenticated on GET /admin', async () => {
      const config = loadConfig({
        NODE_ENV: 'test',
        DATA_DIR: testDir,
        ALLOWED_ORIGINS: 'http://localhost:3000',
        JAMEET_ADMIN_SECRET: TEST_ADMIN_SECRET
      });
      const { app } = await createApp(config);

      const res = await app.inject({
        method: 'GET',
        url: '/admin'
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('JaMeet Server Admin');
      expect(res.body).toContain('Authentication Required');
      expect(res.body).toContain('admin-secret-input');
      expect(res.body).toContain('admin-login-submit');

      await app.close();
    });

    it('rejects invalid admin secret on POST /admin/login', async () => {
      const config = loadConfig({
        NODE_ENV: 'test',
        DATA_DIR: testDir,
        ALLOWED_ORIGINS: 'http://localhost:3000',
        JAMEET_ADMIN_SECRET: TEST_ADMIN_SECRET
      });
      const { app } = await createApp(config);

      // Form request returns redirect with error query
      const resForm = await app.inject({
        method: 'POST',
        url: '/admin/login',
        headers: { host: 'localhost:3000' },
        payload: { secret: 'wrong-secret' }
      });
      expect(resForm.statusCode).toBe(303);
      expect(resForm.headers.location).toBe('/admin?error=invalid_secret');

      // JSON request returns 401
      const resJson = await app.inject({
        method: 'POST',
        url: '/admin/login',
        headers: {
          host: 'localhost:3000',
          accept: 'application/json',
          'content-type': 'application/json'
        },
        payload: { secret: 'wrong-secret' }
      });
      expect(resJson.statusCode).toBe(401);
      const data = JSON.parse(resJson.body);
      expect(data.ok).toBe(false);

      await app.close();
    });

    it('authenticates with correct secret, sets secure cookie, and serves dashboard', async () => {
      const config = loadConfig({
        NODE_ENV: 'test',
        DATA_DIR: testDir,
        ALLOWED_ORIGINS: 'http://localhost:3000',
        JAMEET_ADMIN_SECRET: TEST_ADMIN_SECRET
      });
      const { app } = await createApp(config);

      const resLogin = await app.inject({
        method: 'POST',
        url: '/admin/login',
        headers: {
          host: 'localhost:3000',
          accept: 'application/json',
          'content-type': 'application/json'
        },
        payload: { secret: TEST_ADMIN_SECRET }
      });

      expect(resLogin.statusCode).toBe(200);
      const setCookie = resLogin.headers['set-cookie'] as string;
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain(`${ADMIN_SESSION_COOKIE_NAME}=`);
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');

      const cookies = parseCookies(setCookie);
      const sessionToken = cookies[ADMIN_SESSION_COOKIE_NAME];
      expect(sessionToken).toBeDefined();

      // Now GET /admin with the cookie returns the Dashboard
      const resDash = await app.inject({
        method: 'GET',
        url: '/admin',
        headers: {
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}`
        }
      });

      expect(resDash.statusCode).toBe(200);
      expect(resDash.headers['content-type']).toContain('text/html');
      expect(resDash.body).toContain('JaMeet Admin • User & Beta Access');
      expect(resDash.body).toContain('users-table');
      expect(resDash.body).toContain('btn-logout');

      await app.close();
    });

    it('logs out via POST /admin/logout and clears cookie (no GET logout)', async () => {
      const config = loadConfig({
        NODE_ENV: 'test',
        DATA_DIR: testDir,
        ALLOWED_ORIGINS: 'http://localhost:3000',
        JAMEET_ADMIN_SECRET: TEST_ADMIN_SECRET
      });
      const { app } = await createApp(config);

      // GET /admin/logout is NOT supported (must return 404)
      const resGetLogout = await app.inject({
        method: 'GET',
        url: '/admin/logout'
      });
      expect(resGetLogout.statusCode).toBe(404);

      // POST /admin/logout (JSON) clears cookie
      const resPostLogout = await app.inject({
        method: 'POST',
        url: '/admin/logout',
        headers: {
          host: 'localhost:3000',
          accept: 'application/json',
          'content-type': 'application/json'
        },
        payload: {}
      });
      expect(resPostLogout.statusCode).toBe(200);
      const setCookie = resPostLogout.headers['set-cookie'] as string;
      expect(setCookie).toContain(`${ADMIN_SESSION_COOKIE_NAME}=;`);
      expect(setCookie).toContain('Max-Age=0');

      // POST /admin/logout (Form) redirects to /admin
      const resFormLogout = await app.inject({
        method: 'POST',
        url: '/admin/logout',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3000'
        }
      });
      expect(resFormLogout.statusCode).toBe(303);
      expect(resFormLogout.headers.location).toBe('/admin');

      await app.close();
    });
  });

  describe('User Listing & Data Sanitization (GET /admin/api/users)', () => {
    it('requires admin session cookie and rejects unauthenticated requests', async () => {
      const config = loadConfig({
        NODE_ENV: 'test',
        DATA_DIR: testDir,
        ALLOWED_ORIGINS: 'http://localhost:3000',
        JAMEET_ADMIN_SECRET: TEST_ADMIN_SECRET
      });
      const { app } = await createApp(config);

      const res = await app.inject({
        method: 'GET',
        url: '/admin/api/users'
      });
      expect(res.statusCode).toBe(401);

      await app.close();
    });

    it('returns sanitized user list and strictly excludes password hashes and tokens', async () => {
      const userStore = new UserStore(testDir);
      const user1 = await userStore.register({
        username: 'alice_keys',
        email: 'alice@keys.com',
        password: 'Password123!',
        displayName: 'Alice Keys'
      });
      const user2 = await userStore.register({
        username: 'bob_beats',
        email: 'bob@beats.com',
        password: 'Password456!',
        displayName: 'Bob Beats'
      });

      const config = loadConfig({
        NODE_ENV: 'test',
        DATA_DIR: testDir,
        ALLOWED_ORIGINS: 'http://localhost:3000',
        JAMEET_ADMIN_SECRET: TEST_ADMIN_SECRET
      });
      const { app } = await createApp(config);

      const sessionToken = createAdminSessionToken(TEST_ADMIN_SECRET);

      const res = await app.inject({
        method: 'GET',
        url: '/admin/api/users',
        headers: {
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}`
        }
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.users)).toBe(true);
      expect(data.users.length).toBe(2);

      for (const u of data.users) {
        expect(u.id).toBeDefined();
        expect(u.username).toBeDefined();
        expect(u.email).toBeDefined();
        expect(u.displayName).toBeDefined();
        expect(u.sessionAccess).toBe('blocked');
        expect(u.createdAt).toBeDefined();

        // STRICT SECURITY CHECKS: Never leak passwords or sensitive tokens
        expect(u.passwordHash).toBeUndefined();
        expect(u.passwordChangedAt).toBeUndefined();
        expect(u.tokens).toBeUndefined();
        expect(u.metadata).toBeUndefined();
      }

      await app.close();
    });
  });

  describe('Session Access Entitlement Modification (POST /admin/api/users/:userId/access)', () => {
    it('updates user access between blocked, beta, and paid and persists immediately to disk', async () => {
      const userStore = new UserStore(testDir);
      const reg = await userStore.register({
        username: 'producer_dan',
        email: 'dan@producer.com',
        password: 'Password789!',
        displayName: 'Dan Producer'
      });

      const config = loadConfig({
        NODE_ENV: 'test',
        DATA_DIR: testDir,
        ALLOWED_ORIGINS: 'http://localhost:3000',
        JAMEET_ADMIN_SECRET: TEST_ADMIN_SECRET
      });
      const { app } = await createApp(config);
      const sessionToken = createAdminSessionToken(TEST_ADMIN_SECRET);

      // 1. Promote to beta
      const resBeta = await app.inject({
        method: 'POST',
        url: `/admin/api/users/${reg.user.id}/access`,
        headers: {
          host: 'localhost:3000',
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}`,
          'content-type': 'application/json'
        },
        payload: { access: 'beta' }
      });
      expect(resBeta.statusCode).toBe(200);
      const betaData = JSON.parse(resBeta.body);
      expect(betaData.ok).toBe(true);
      expect(betaData.user.newAccess).toBe('beta');

      // Verify on disk immediately
      const diskStore1 = new UserStore(testDir);
      expect(diskStore1.getStoredUser(reg.user.id)?.sessionAccess).toBe('beta');

      // 2. Promote to paid
      const resPaid = await app.inject({
        method: 'POST',
        url: `/admin/api/users/${reg.user.id}/access`,
        headers: {
          host: 'localhost:3000',
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}`,
          'content-type': 'application/json'
        },
        payload: { access: 'paid' }
      });
      expect(resPaid.statusCode).toBe(200);
      const paidData = JSON.parse(resPaid.body);
      expect(paidData.ok).toBe(true);
      expect(paidData.user.newAccess).toBe('paid');

      // Verify on disk immediately
      const diskStore2 = new UserStore(testDir);
      expect(diskStore2.getStoredUser(reg.user.id)?.sessionAccess).toBe('paid');

      // 3. Demote to blocked
      const resBlocked = await app.inject({
        method: 'POST',
        url: `/admin/api/users/${reg.user.id}/access`,
        headers: {
          host: 'localhost:3000',
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}`,
          'content-type': 'application/json'
        },
        payload: { access: 'blocked' }
      });
      expect(resBlocked.statusCode).toBe(200);
      const blockedData = JSON.parse(resBlocked.body);
      expect(blockedData.ok).toBe(true);
      expect(blockedData.user.newAccess).toBe('blocked');

      // Verify on disk immediately
      const diskStore3 = new UserStore(testDir);
      expect(diskStore3.getStoredUser(reg.user.id)?.sessionAccess).toBe('blocked');

      await app.close();
    });

    it('rejects invalid access states and non-existent users', async () => {
      const userStore = new UserStore(testDir);
      const reg = await userStore.register({
        username: 'sam_singer',
        email: 'sam@singer.com',
        password: 'Password999!',
        displayName: 'Sam Singer'
      });

      const config = loadConfig({
        NODE_ENV: 'test',
        DATA_DIR: testDir,
        ALLOWED_ORIGINS: 'http://localhost:3000',
        JAMEET_ADMIN_SECRET: TEST_ADMIN_SECRET
      });
      const { app } = await createApp(config);
      const sessionToken = createAdminSessionToken(TEST_ADMIN_SECRET);

      // Invalid access state
      const resInvalid = await app.inject({
        method: 'POST',
        url: `/admin/api/users/${reg.user.id}/access`,
        headers: {
          host: 'localhost:3000',
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}`,
          'content-type': 'application/json'
        },
        payload: { access: 'unlimited_pro' }
      });
      expect(resInvalid.statusCode).toBe(400);

      // Non-existent user
      const resMissing = await app.inject({
        method: 'POST',
        url: '/admin/api/users/non-existent-user-id/access',
        headers: {
          host: 'localhost:3000',
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}`,
          'content-type': 'application/json'
        },
        payload: { access: 'beta' }
      });
      expect(resMissing.statusCode).toBe(404);

      await app.close();
    });
  });

  describe('CSRF & Cross-Site Request Protection', () => {
    it('rejects cross-site state-changing POST requests', async () => {
      const config = loadConfig({
        NODE_ENV: 'test',
        DATA_DIR: testDir,
        ALLOWED_ORIGINS: 'http://localhost:3000',
        JAMEET_ADMIN_SECRET: TEST_ADMIN_SECRET
      });
      const { app } = await createApp(config);
      const sessionToken = createAdminSessionToken(TEST_ADMIN_SECRET);

      // Cross-site Sec-Fetch-Site
      const resCross = await app.inject({
        method: 'POST',
        url: '/admin/api/users/user-123/access',
        headers: {
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}`,
          'sec-fetch-site': 'cross-site',
          'content-type': 'application/json'
        },
        payload: { access: 'beta' }
      });
      expect(resCross.statusCode).toBe(403);

      // Malicious Origin
      const resMaliciousOrigin = await app.inject({
        method: 'POST',
        url: '/admin/api/users/user-123/access',
        headers: {
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}`,
          origin: 'https://evil-attacker.example.com',
          'content-type': 'application/json'
        },
        payload: { access: 'beta' }
      });
      expect(resMaliciousOrigin.statusCode).toBe(403);

      await app.close();
    });
  });
});
