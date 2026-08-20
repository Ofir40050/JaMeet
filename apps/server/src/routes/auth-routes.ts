import type { FastifyInstance } from 'fastify';
import {
  registerRequestSchema,
  loginRequestSchema,
  updateProfileRequestSchema,
  guestAuthRequestSchema
} from '@jameet/shared';
import type { UserStore } from '../auth.js';
import { extractClientInfo } from '../client-info.js';
import { logger } from '../logger.js';

export function registerAuthRoutes(app: FastifyInstance, userStore: UserStore): void {
  // REST Authentication Endpoints
  app.post('/api/auth/register', async (request, reply) => {
    const parsed = registerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      logger.warn('auth_register_failed', 'Registration payload validation failed', { reason: parsed.error.issues[0]?.message });
      return reply.code(400).send({ ok: false, message: parsed.error.issues[0]?.message || 'Invalid registration data.' });
    }
    const clientInfo = extractClientInfo(request);
    try {
      const result = await userStore.register(parsed.data, clientInfo);
      logger.info('auth_register_success', 'User registration successful', { userId: result.user.id, username: result.user.username });
      return reply.code(201).send({ ok: true, token: result.token, user: result.user });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed.';
      const isConflict = msg.includes('already taken') || msg.includes('already exists');
      logger.warn('auth_register_failed', 'User registration failed', { username: parsed.data.username, reason: msg });
      return reply.code(isConflict ? 409 : 500).send({ ok: false, message: msg });
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      logger.warn('auth_login_failed', 'Login payload validation failed');
      return reply.code(400).send({ ok: false, message: 'Please enter your username/email and password.' });
    }
    const identifierType = parsed.data.usernameOrEmail.includes('@') ? 'email' : 'username';
    const clientInfo = extractClientInfo(request);
    try {
      const result = await userStore.login(parsed.data);
      userStore.recordLogin(result.user.id, clientInfo);
      logger.info('auth_login_success', 'User login successful', { userId: result.user.id, username: result.user.username });
      return reply.send({ ok: true, token: result.token, user: result.user });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid credentials.';
      const isAuthFail = msg.includes('Invalid username or password');
      const statusCode = isAuthFail ? 401 : 500;
      logger.warn('auth_login_failed', 'User login failed', { identifierType, statusCode, reason: msg });
      return reply.code(statusCode).send({ ok: false, message: msg });
    }
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (token) {
      try {
        userStore.revokeToken(token);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to revoke session token.';
        return reply.code(500).send({ ok: false, message: msg });
      }
    }
    return reply.send({ ok: true, message: 'Logged out successfully.' });
  });

  app.get('/api/auth/me', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized or session expired.' });
    }
    const clientInfo = extractClientInfo(request);
    const stored = userStore.getStoredUser(user.id);
    if (stored) {
      const versionChanged = Boolean(clientInfo.version && clientInfo.version !== 'Unknown' && clientInfo.version !== stored.clientVersion);
      const platformChanged = Boolean(clientInfo.platform && clientInfo.platform !== 'Unknown' && clientInfo.platform !== stored.clientPlatform);
      if (versionChanged || platformChanged) {
        userStore.recordLogin(user.id, clientInfo);
      }
    }
    return reply.send({ ok: true, user });
  });

  app.put('/api/auth/profile', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized or session expired.' });
    }
    const parsed = updateProfileRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const errMessage = parsed.error.issues[0]?.message || 'Invalid profile data provided.';
      return reply.code(400).send({ ok: false, message: errMessage });
    }
    try {
      const result = await userStore.updateProfile(user.id, parsed.data);
      return reply.send({ ok: true, user: result.user, token: result.token });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update profile.';
      const isClientErr = msg.includes('password') || msg.includes('User not found');
      return reply.code(isClientErr ? 400 : 500).send({ ok: false, message: msg });
    }
  });

  app.post('/api/auth/guest', async (request, reply) => {
    const parsed = guestAuthRequestSchema.safeParse(request.body);
    const displayName = parsed.success ? parsed.data.displayName : 'Guest Musician';
    const guestIdentity = userStore.createGuestIdentity(displayName);
    return reply.send({ ok: true, identity: guestIdentity });
  });
}
