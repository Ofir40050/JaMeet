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
      expect(resDash.body).toContain('JaMeet Admin');
      expect(resDash.body).toContain('Beta Ops');
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
        // REQUIRED FIELDS ONLY
        expect(u.id).toBeDefined();
        expect(u.displayName).toBeDefined();
        expect(u.username).toBeDefined();
        expect(u.email).toBeDefined();
        expect(u.createdAt).toBeDefined();
        expect(u.sessionsHostedCount).toBeDefined();
        expect(u.sessionAccess).toBe('blocked');
        expect(u.avatarColor).toBeDefined();

        // STRICT REDACTION CHECKS: Exactly only required fields, no extra account fields
        expect(u.avatarUrl).toBeUndefined();
        expect(u.location).toBeUndefined();
        expect(u.role).toBeUndefined();
        expect(u.primaryDaw).toBeUndefined();
        expect(u.genres).toBeUndefined();
        expect(u.bio).toBeUndefined();
        expect(u.website).toBeUndefined();
        expect(u.socialHandle).toBeUndefined();
        expect(u.updatedAt).toBeUndefined();
        expect(u.metadata).toBeUndefined();
        expect(u.passwordHash).toBeUndefined();
        expect(u.passwordChangedAt).toBeUndefined();
        expect(u.tokens).toBeUndefined();
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

  describe('User Details Inspection & Activity History (GET /admin/api/users/:userId)', () => {
    it('returns sanitized user detail with operational activity history and client metadata', async () => {
      const userStore = new UserStore(testDir);
      const reg = await userStore.register({
        username: 'artist_elena',
        email: 'elena@vocalist.com',
        password: 'PasswordElena123!',
        displayName: 'Elena Vocals'
      }, { version: '0.1.0', platform: 'macOS' });

      // Log in
      userStore.recordLogin(reg.user.id, { version: '0.1.0', platform: 'macOS' });
      // Host a session
      userStore.incrementHostedCount(reg.user.id, 'JAM-9988');
      // Change access
      userStore.setSessionAccess(reg.user.id, 'beta');

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
        url: `/admin/api/users/${reg.user.id}`,
        headers: {
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}`
        }
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.ok).toBe(true);
      expect(data.user).toBeDefined();
      expect(data.user.id).toBe(reg.user.id);
      expect(data.user.username).toBe('artist_elena');
      expect(data.user.displayName).toBe('Elena Vocals');
      expect(data.user.email).toBe('elena@vocalist.com');
      expect(data.user.clientPlatform).toBe('macOS');
      expect(data.user.clientVersion).toBe('0.1.0');
      expect(data.user.sessionsHostedCount).toBe(1);
      expect(data.user.sessionAccess).toBe('beta');
      expect(Array.isArray(data.user.activityHistory)).toBe(true);
      expect(data.user.activityHistory.length).toBeGreaterThanOrEqual(4);

      // Verify strict security: sensitive data is never exposed
      expect(data.user.passwordHash).toBeUndefined();
      expect(data.user.passwordChangedAt).toBeUndefined();
      expect(data.user.tokens).toBeUndefined();
      expect(data.user.metadata).toBeUndefined();

      await app.close();
    });

    it('initializes lastLoginAt upon account registration so it does not remain Never', async () => {
      const userStore = new UserStore(testDir);
      const reg = await userStore.register({
        username: 'fresh_musician',
        email: 'fresh@musician.com',
        password: 'PasswordFresh123!',
        displayName: 'Fresh Musician'
      }, { version: '0.1.0', platform: 'macOS' });

      // Verify directly on UserStore
      const stored = userStore.getStoredUser(reg.user.id);
      expect(stored?.lastLoginAt).toBeDefined();
      expect(typeof stored?.lastLoginAt).toBe('number');
      expect(stored?.lastLoginAt).toBeGreaterThan(0);

      // Verify via Admin API
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
        url: `/admin/api/users/${reg.user.id}`,
        headers: {
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}`
        }
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.user.lastLoginAt).toBeDefined();
      expect(data.user.lastLoginAt).toBe(stored?.lastLoginAt);

      await app.close();
    });

    it('returns 404 for non-existent user identifier', async () => {
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
        url: '/admin/api/users/unknown-user-id',
        headers: {
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}`
        }
      });
      expect(res.statusCode).toBe(404);

      await app.close();
    });
  });

  describe('Beta Expiration Configuration & Enforcement', () => {
    it('sets and clears per-user beta expiration date via API', async () => {
      const userStore = new UserStore(testDir);
      const reg = await userStore.register({
        username: 'beta_tester',
        email: 'beta@tester.com',
        password: 'PasswordTester123!',
        displayName: 'Beta Tester'
      });
      userStore.setSessionAccess(reg.user.id, 'beta');

      const config = loadConfig({
        NODE_ENV: 'test',
        DATA_DIR: testDir,
        ALLOWED_ORIGINS: 'http://localhost:3000',
        JAMEET_ADMIN_SECRET: TEST_ADMIN_SECRET
      });
      const { app } = await createApp(config);
      const sessionToken = createAdminSessionToken(TEST_ADMIN_SECRET);

      const futureExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;

      // 1. Set beta expiration
      const resSet = await app.inject({
        method: 'POST',
        url: `/admin/api/users/${reg.user.id}/beta-expiry`,
        headers: {
          host: 'localhost:3000',
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}`,
          'content-type': 'application/json'
        },
        payload: { betaExpiresAt: futureExpiry }
      });
      expect(resSet.statusCode).toBe(200);
      const setData = JSON.parse(resSet.body);
      expect(setData.ok).toBe(true);
      expect(setData.user.betaExpiresAt).toBe(futureExpiry);

      // Verify on disk
      const diskStore1 = new UserStore(testDir);
      expect(diskStore1.getStoredUser(reg.user.id)?.betaExpiresAt).toBe(futureExpiry);

      // 2. Clear beta expiration
      const resClear = await app.inject({
        method: 'POST',
        url: `/admin/api/users/${reg.user.id}/beta-expiry`,
        headers: {
          host: 'localhost:3000',
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}`,
          'content-type': 'application/json'
        },
        payload: { betaExpiresAt: null }
      });
      expect(resClear.statusCode).toBe(200);
      const clearData = JSON.parse(resClear.body);
      expect(clearData.ok).toBe(true);
      expect(clearData.user.betaExpiresAt).toBeNull();

      // Verify on disk
      const diskStore2 = new UserStore(testDir);
      expect(diskStore2.getStoredUser(reg.user.id)?.betaExpiresAt).toBeNull();

      await app.close();
    });

    it('enforces per-user beta expiration in validateStoredUserSessionAccess', async () => {
      const { validateStoredUserSessionAccess } = await import('./auth.js');
      const userStore = new UserStore(testDir);
      const reg = await userStore.register({
        username: 'musician_tim',
        email: 'tim@musician.com',
        password: 'PasswordTim123!',
        displayName: 'Tim Musician'
      });

      const config = loadConfig({
        NODE_ENV: 'test',
        DATA_DIR: testDir,
        ALLOWED_ORIGINS: 'http://localhost:3000'
      });

      const now = Date.now();
      const pastTime = now - 60000;
      const futureTime = now + 60000;

      // 1. Beta with past expiration -> Rejected with BETA_ENDED
      userStore.setSessionAccess(reg.user.id, 'beta', pastTime);
      const checkExpired = validateStoredUserSessionAccess(userStore, reg.user.id, config, false, now);
      expect(checkExpired.ok).toBe(false);
      if (!checkExpired.ok) {
        expect(checkExpired.code).toBe('BETA_ENDED');
      }

      // 2. Beta with future expiration -> Authorized
      userStore.setSessionAccess(reg.user.id, 'beta', futureTime);
      const checkFuture = validateStoredUserSessionAccess(userStore, reg.user.id, config, false, now);
      expect(checkFuture.ok).toBe(true);

      // 3. Beta with no expiration (null/undefined) -> Authorized
      userStore.setSessionAccess(reg.user.id, 'beta', null);
      const checkNoExpiry = validateStoredUserSessionAccess(userStore, reg.user.id, config, false, now);
      expect(checkNoExpiry.ok).toBe(true);

      // 4. Paid account with past beta expiration -> Paid accounts bypass beta expiration!
      userStore.setSessionAccess(reg.user.id, 'paid', pastTime);
      const checkPaid = validateStoredUserSessionAccess(userStore, reg.user.id, config, false, now);
      expect(checkPaid.ok).toBe(true);

      // 5. Blocked account -> Denied
      userStore.setSessionAccess(reg.user.id, 'blocked', futureTime);
      const checkBlocked = validateStoredUserSessionAccess(userStore, reg.user.id, config, false, now);
      expect(checkBlocked.ok).toBe(false);
      if (!checkBlocked.ok) {
        expect(checkBlocked.code).toBe('ACCESS_DENIED');
      }
    });
  });

  describe('Server Telemetry & Operational Stats (GET /admin/api/stats)', () => {
    it('returns accurate summary and health telemetry metrics', async () => {
      const userStore = new UserStore(testDir);
      const u1 = await userStore.register({ username: 'user1', email: 'u1@test.com', password: 'Password1!', displayName: 'U1' });
      const u2 = await userStore.register({ username: 'user2', email: 'u2@test.com', password: 'Password2!', displayName: 'U2' });
      const u3 = await userStore.register({ username: 'user3', email: 'u3@test.com', password: 'Password3!', displayName: 'U3' });

      userStore.setSessionAccess(u1.user.id, 'beta');
      userStore.setSessionAccess(u2.user.id, 'paid');
      userStore.setSessionAccess(u3.user.id, 'blocked');

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
        url: '/admin/api/stats',
        headers: {
          cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}`
        }
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.ok).toBe(true);
      expect(data.stats).toBeDefined();
      expect(data.stats.totalUsers).toBe(3);
      expect(data.stats.betaUsers).toBe(1);
      expect(data.stats.paidUsers).toBe(1);
      expect(data.stats.blockedUsers).toBe(1);
      expect(data.stats.isOperational).toBe(true);
      expect(typeof data.stats.uptimeSeconds).toBe('number');
      expect(data.stats.activeSessions).toBe(0);

      await app.close();
    });

    it('accurately counts Active Sessions representing genuinely active multi-participant calls', async () => {
      const config = loadConfig({
        NODE_ENV: 'test',
        DATA_DIR: testDir,
        ALLOWED_ORIGINS: 'http://localhost:3000',
        JAMEET_ADMIN_SECRET: TEST_ADMIN_SECRET
      });
      const { app, rooms } = await createApp(config);
      const sessionToken = createAdminSessionToken(TEST_ADMIN_SECRET);

      // Case 1: Room created by host alone (waiting for collaborator) -> NOT an active live session
      const hostRoom = rooms.create('host-1', 'socket-host-1', { audio: true, video: false }, { id: 'u1', username: 'host', displayName: 'Host', isGuest: false });
      
      let res = await app.inject({
        method: 'GET',
        url: '/admin/api/stats',
        headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}` }
      });
      expect(JSON.parse(res.body).stats.activeSessions).toBe(0);

      // Case 2: Guest joins directly into participants -> Now 2 connected participants -> Active session!
      rooms.join(hostRoom.code, 'guest-1', 'socket-guest-1', { audio: true, video: false }, { id: 'u2', username: 'guest', displayName: 'Guest', isGuest: false });
      res = await app.inject({
        method: 'GET',
        url: '/admin/api/stats',
        headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}` }
      });
      expect(JSON.parse(res.body).stats.activeSessions).toBe(1);

      // Case 3: Guest disconnects and enters reconnect grace period (socketId becomes null) -> NOT active during grace
      rooms.disconnect(hostRoom.code, 'guest-1', () => {}, 'socket-guest-1');
      expect(hostRoom.participants.size).toBe(2); // Still 2 participant records in room
      expect(hostRoom.participants.get('guest-1')?.socketId).toBeNull(); // but only 1 active connected socket

      res = await app.inject({
        method: 'GET',
        url: '/admin/api/stats',
        headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}` }
      });
      expect(JSON.parse(res.body).stats.activeSessions).toBe(0);

      // Case 4: Guest reconnects -> Both connected -> Active session again!
      rooms.join(hostRoom.code, 'guest-1', 'socket-guest-reconnected', { audio: true, video: false }, { id: 'u2', username: 'guest', displayName: 'Guest', isGuest: false }, hostRoom.participants.get('guest-1')?.reconnectToken);
      res = await app.inject({
        method: 'GET',
        url: '/admin/api/stats',
        headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}` }
      });
      expect(JSON.parse(res.body).stats.activeSessions).toBe(1);

      // Case 5: Guest explicitly leaves -> Back to 1 participant -> Active sessions returns to 0
      rooms.leave(hostRoom.code, 'guest-1', 'socket-guest-reconnected');
      res = await app.inject({
        method: 'GET',
        url: '/admin/api/stats',
        headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}` }
      });
      expect(JSON.parse(res.body).stats.activeSessions).toBe(0);

      await app.close();
    });

    it('reports Unknown for missing or unrecognized client metadata during registration and login', async () => {
      const config = loadConfig({
        NODE_ENV: 'test',
        DATA_DIR: testDir,
        ALLOWED_ORIGINS: 'http://localhost:3000',
        JAMEET_ADMIN_SECRET: TEST_ADMIN_SECRET
      });
      const { app, userStore } = await createApp(config);
      const sessionToken = createAdminSessionToken(TEST_ADMIN_SECRET);

      // Register without client headers or user agent
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { 'content-type': 'application/json' },
        payload: {
          username: 'mystery_user',
          email: 'mystery@test.com',
          password: 'Password123!',
          displayName: 'Mystery User'
        }
      });
      expect(regRes.statusCode).toBe(201);
      const regData = JSON.parse(regRes.body);

      // Inspect admin user details
      const detailRes = await app.inject({
        method: 'GET',
        url: `/admin/api/users/${regData.user.id}`,
        headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}` }
      });
      expect(detailRes.statusCode).toBe(200);
      const detailData = JSON.parse(detailRes.body);
      expect(detailData.user.clientPlatform).toBe('Unknown');
      expect(detailData.user.clientVersion).toBe('Unknown');

      // Login with unrecognized platform
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          'content-type': 'application/json',
          'x-client-platform': 'FreeBSD',
          'x-client-version': ''
        },
        payload: {
          usernameOrEmail: 'mystery_user',
          password: 'Password123!'
        }
      });

      const updatedDetailRes = await app.inject({
        method: 'GET',
        url: `/admin/api/users/${regData.user.id}`,
        headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionToken}` }
      });
      const updatedDetail = JSON.parse(updatedDetailRes.body);
      expect(updatedDetail.user.clientPlatform).toBe('Unknown');
      expect(updatedDetail.user.clientVersion).toBe('Unknown');

      await app.close();
    });
  });
});
