import { randomUUID } from 'node:crypto';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Server } from 'socket.io';
import {
  createMeetingSchema, joinMeetingSchema, mediaUpdateSchema, meetingActionSchema,
  signalCandidateSchema, signalDescriptionSchema, signalRenegotiateSchema, registerRequestSchema, loginRequestSchema,
  guestAuthRequestSchema, updateProfileRequestSchema, createProjectRequestSchema, updateProjectRequestSchema,
  updateProjectWorkspaceRequestSchema, addCollaboratorRequestSchema, sendChatMessageSchema,
  admitParticipantSchema, lockMeetingSchema, removeParticipantSchema, createScheduledSessionSchema,
  updateScheduledSessionSchema, type MeetingAck, type MeetingErrorCode,
  type ParticipantIdentity, type MediaMetadata,
  type UserProfile, type UpdateProfileRequest, type ProjectWorkspace, type UpdateProjectWorkspaceRequest,
  type UpdateProjectWorkspaceResponse,
  type SessionChatMessage, type WaitingParticipantItem, type ScheduledSession,
  type SessionSummaryEvent, type ProjectActivityItem,
  crashReportSchema, type CrashReport, sanitizeLogData
} from '@jameet/shared';
import type { ServerConfig } from './config.js';
import { RoomStore, type Room, type Participant } from './rooms.js';
import { UserStore, authorizeSessionAccess, validateStoredUserSessionAccess } from './auth.js';
import { ProjectStore, WorkspaceConflictError, ProjectLimitError, WorkspaceLimitError, PROJECT_LIMITS } from './projects.js';
import { CrashReportStore } from './crash-store.js';
import { createIceServers } from './turn.js';
import { SocketRateLimiter, type RateLimitCategory, type RateLimitConfig } from './rate-limiter.js';
import { updateAccountSessionAccess, writeAdminRuntimeFile, cleanupAdminRuntimeFile } from './admin-access.js';
import { registerAdminPanel } from './admin-panel.js';
import { acquireDatastoreLock, type DatastoreLock } from './datastore-lock.js';
import { logger } from './logger.js';
import { getClientIp } from './client-ip.js';

type ProjectSubscription = { userId: string; authToken: string };
type SocketData = { code?: string; participantId?: string; identity?: ParticipantIdentity; isWaiting?: boolean; limiter?: SocketRateLimiter; projectSubscriptions?: Map<string, ProjectSubscription> };

function mapActivityToSessionSummaryEvent(act: ProjectActivityItem): SessionSummaryEvent | null {
  let category: 'task' | 'note' | 'lyrics' | 'structure' | null = null;
  let action = '';
  let description = '';

  if (act.type === 'task_created') {
    category = 'task';
    action = 'created';
    description = `Created task "${act.title}"`;
  } else if (act.type === 'task_completed') {
    category = 'task';
    action = 'completed';
    description = `Completed task "${act.title}"`;
  } else if (act.type === 'task_reopened') {
    category = 'task';
    action = 'reopened';
    description = `Reopened task "${act.title}"`;
  } else if (act.type === 'task_status_changed') {
    category = 'task';
    action = 'updated';
    description = `Updated status for task "${act.title}"`;
  } else if (act.type === 'task_assigned') {
    category = 'task';
    action = 'assigned';
    description = act.summary || `Assigned task "${act.title}"`;
  } else if (act.type === 'task_unassigned') {
    category = 'task';
    action = 'unassigned';
    description = act.summary || `Unassigned task "${act.title}"`;
  } else if (act.type === 'task_updated') {
    category = 'task';
    action = 'updated';
    description = act.summary || `Updated task "${act.title}"`;
  } else if (act.type === 'task_deleted') {
    category = 'task';
    action = 'deleted';
    description = `Deleted task "${act.title}"`;
  } else if (act.type === 'lyrics_doc_created') {
    category = 'lyrics';
    action = 'created';
    description = `Created lyrics document "${act.title}"`;
  } else if (act.type === 'lyrics_doc_renamed') {
    category = 'lyrics';
    action = 'renamed';
    description = `Renamed lyrics document to "${act.title}"`;
  } else if (act.type === 'lyrics_doc_deleted') {
    category = 'lyrics';
    action = 'deleted';
    description = `Deleted lyrics document "${act.title}"`;
  } else if (act.type === 'lyrics_edited') {
    category = 'lyrics';
    action = 'edited';
    description = `Updated Lyrics in "${act.title}"`;
  } else if (act.type === 'notes_edited') {
    category = 'note';
    action = 'edited';
    description = 'Updated Project Notes';
  } else if (act.type === 'notes_bpm_changed') {
    category = 'note';
    action = 'updated';
    description = act.title ? `Set tempo to ${act.title}` : (act.summary || 'Updated Project tempo');
  } else if (act.type === 'notes_key_changed') {
    category = 'note';
    action = 'updated';
    description = act.title ? `Changed key to ${act.title}` : (act.summary || 'Updated Project key');
  } else if (act.type === 'structure_changed') {
    category = 'structure';
    action = 'updated';
    description = 'Updated Song Structure arrangement';
  }

  if (!category) return null;
  return {
    id: act.id,
    timestamp: act.createdAt,
    category,
    action,
    description
  };
}

export async function createApp(config: ServerConfig, customSocketLimits?: Partial<Record<RateLimitCategory, RateLimitConfig>>) {
  logger.setupGlobalHandlers();
  const app = Fastify({
    logger: config.NODE_ENV !== 'test',
    bodyLimit: PROJECT_LIMITS.MAX_WORKSPACE_PAYLOAD_BYTES,
    trustProxy: 1
  });
  const origins = config.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
  const isOriginAllowed = (origin?: string): boolean => {
    if (!origin) return true;
    if (config.NODE_ENV === 'production') {
      return origins.includes(origin);
    }
    return (
      origins.includes(origin) ||
      origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:') ||
      origin.startsWith('jameet-app://') ||
      origin.startsWith('musiczoom-app://')
    );
  };

  await app.register(cors, {
    origin: (origin, cb) => {
      cb(null, isOriginAllowed(origin));
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'X-Requested-With'],
    credentials: true
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (request) => getClientIp(request)
  });

  app.setErrorHandler((error: any, request, reply) => {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      logger.error('server_request_error', `HTTP ${statusCode} internal error on ${request.method} ${request.url}`, {
        method: request.method,
        url: request.url,
        statusCode
      }, error);
    } else {
      logger.warn('server_client_error', `HTTP ${statusCode} on ${request.method} ${request.url}`, {
        method: request.method,
        url: request.url,
        statusCode,
        message: error.message
      });
    }
    return reply.code(statusCode).send({
      ok: false,
      message: statusCode >= 500 ? 'Internal server error.' : error.message
    });
  });
  
  const dataDir = config.DATA_DIR ?? path.join(process.cwd(), 'data');
  const datastoreLock = acquireDatastoreLock(dataDir, 'server');
  const userStore = new UserStore(dataDir);
  const projectStore = new ProjectStore(dataDir);
  const crashStore = new CrashReportStore(dataDir);
  const rooms = new RoomStore(config.DISCONNECT_GRACE_MS, config.EMPTY_ROOM_TTL_MS);
  const runtimeAdminToken = randomUUID();
  let entitlementInterval: NodeJS.Timeout | undefined;

  // Internal Loopback-Only Administration Endpoint
  app.post('/api/internal/admin/session-access', async (request, reply) => {
    const remoteIp = request.socket.remoteAddress || request.ip;
    const isLoopback = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
    if (!isLoopback) {
      return reply.code(403).send({ ok: false, message: 'Forbidden: administration is only available via local loopback.' });
    }

    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token || token !== runtimeAdminToken) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized: invalid or missing administration token.' });
    }

    const body = request.body as any;
    if (!body || typeof body !== 'object' || !body.identifier || !body.access) {
      return reply.code(400).send({ ok: false, message: 'Missing required identifier or access state.' });
    }

    try {
      const result = updateAccountSessionAccess(userStore, body.identifier, body.access);
      return reply.send({ ok: true, ...result });
    } catch (err: any) {
      const isNotFound = err.message?.includes('Account not found');
      const isInvalid = err.message?.includes('Invalid sessionAccess') || err.message?.includes('identifier is required');
      return reply.code(isNotFound ? 404 : (isInvalid ? 400 : 500)).send({ ok: false, message: err.message || 'Failed to update session access.' });
    }
  });

  registerAdminPanel(app, userStore, config);

  const syncRuntimeInfo = () => {
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : config.PORT;
    writeAdminRuntimeFile(dataDir, {
      pid: process.pid,
      port,
      adminToken: runtimeAdminToken,
      dataDir
    });
  };

  if (app.server.listening) {
    syncRuntimeInfo();
  } else {
    app.server.once('listening', syncRuntimeInfo);
  }

  let isResourcesCleanedUp = false;
  const cleanupServerResources = () => {
    if (isResourcesCleanedUp) return;
    isResourcesCleanedUp = true;
    cleanupAdminRuntimeFile(dataDir);
    datastoreLock.release();
  };

  let isShuttingDown = false;
  const handleSignal = () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    app.close().catch((err) => {
      app.log.error(err, 'Error during graceful server shutdown on signal');
    });
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
  process.once('exit', cleanupServerResources);

  app.addHook('onClose', async () => {
    clearInterval(entitlementInterval);
    process.off('SIGINT', handleSignal);
    process.off('SIGTERM', handleSignal);
    process.off('exit', cleanupServerResources);
    cleanupServerResources();
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/health', async () => ({ ok: true }));

  // REST Canonical Crash Report Ingestion Endpoint
  app.post('/api/crashes', {
    bodyLimit: 64 * 1024,
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const parsed = crashReportSchema.safeParse(request.body);
    if (!parsed.success) {
      logger.warn('crash_report_invalid', 'Crash report payload validation failed', {
        reason: parsed.error.issues[0]?.message
      });
      return reply.code(400).send({
        ok: false,
        message: parsed.error.issues[0]?.message || 'Invalid crash report payload.'
      });
    }

    try {
      // Re-sanitize entire crash report payload on the server before storage
      const sanitizedReport = sanitizeLogData(parsed.data) as CrashReport;

      const result = crashStore.recordReport(sanitizedReport);
      if (result.isDuplicate) {
        logger.info('crash_report_duplicate', `Duplicate crash report acknowledged: ${result.report.reportId}`, {
          reportId: result.report.reportId,
          process: result.report.process
        });
        return reply.code(200).send({
          ok: true,
          reportId: result.report.reportId,
          duplicate: true
        });
      }

      logger.info('crash_report_stored', `Crash report durably stored: ${result.report.reportId}`, {
        reportId: result.report.reportId,
        process: result.report.process,
        appVersion: result.report.appVersion,
        platform: result.report.platform,
        reason: result.report.reason
      });

      return reply.code(201).send({
        ok: true,
        reportId: result.report.reportId,
        duplicate: false
      });
    } catch (err) {
      logger.error('crash_report_store_failed', 'Failed to durably store crash report', {}, err);
      return reply.code(500).send({
        ok: false,
        message: 'Failed to persist crash report.'
      });
    }
  });

  // REST Authentication Endpoints
  app.post('/api/auth/register', async (request, reply) => {
    const parsed = registerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      logger.warn('auth_register_failed', 'Registration payload validation failed', { reason: parsed.error.issues[0]?.message });
      return reply.code(400).send({ ok: false, message: parsed.error.issues[0]?.message || 'Invalid registration data.' });
    }
    try {
      const result = await userStore.register(parsed.data);
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
    try {
      const result = await userStore.login(parsed.data);
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

  app.get('/api/sessions/history', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized or session expired.' });
    }
    const sessions = userStore.getSessionHistory(user.id);
    return reply.send({ ok: true, sessions });
  });

  app.get<{ Params: { id: string } }>('/api/sessions/history/:id/summary', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized or session expired.' });
    }
    const history = userStore.getSessionHistory(user.id);
    const item = history.find((s) => s.id === request.params.id || s.sessionId === request.params.id || s.code === request.params.id);
    if (!item || !item.summary) {
      return reply.code(404).send({ ok: false, message: 'Session summary not found.' });
    }
    return reply.send({ ok: true, summary: item.summary });
  });

  // REST Scheduled Sessions Endpoints
  app.get('/api/sessions/scheduled', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized or session expired.' });
    }
    const sessions = userStore.listScheduledSessions(user.id);
    return reply.send({ ok: true, sessions });
  });

  app.post('/api/sessions/scheduled', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized or session expired.' });
    }
    const parsed = createScheduledSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, message: 'Invalid scheduled session data.' });
    }
    try {
      const session = userStore.createScheduledSession(user.id, parsed.data.title, parsed.data.scheduledAt);
      return reply.code(201).send({ ok: true, session });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create scheduled session.';
      return reply.code(500).send({ ok: false, message: msg });
    }
  });

  app.patch<{ Params: { id: string } }>('/api/sessions/scheduled/:id', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized or session expired.' });
    }
    const parsed = updateScheduledSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, message: 'Invalid update data.' });
    }
    try {
      const session = userStore.updateScheduledSession(user.id, request.params.id, parsed.data);
      if (!session) {
        return reply.code(404).send({ ok: false, message: 'Scheduled session not found.' });
      }
      return reply.send({ ok: true, session });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update scheduled session.';
      return reply.code(500).send({ ok: false, message: msg });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/sessions/scheduled/:id', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized or session expired.' });
    }
    try {
      const deleted = userStore.deleteScheduledSession(user.id, request.params.id);
      if (!deleted) {
        return reply.code(404).send({ ok: false, message: 'Scheduled session not found.' });
      }
      return reply.send({ ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete scheduled session.';
      return reply.code(500).send({ ok: false, message: msg });
    }
  });

  app.post('/api/auth/guest', async (request, reply) => {
    const parsed = guestAuthRequestSchema.safeParse(request.body);
    const displayName = parsed.success ? parsed.data.displayName : 'Guest Musician';
    const guestIdentity = userStore.createGuestIdentity(displayName);
    return reply.send({ ok: true, identity: guestIdentity });
  });

  // REST Projects Endpoints
  app.get('/api/projects', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized.' });
    }
    const query = request.query as { archived?: string } | undefined;
    const includeArchived = query?.archived === 'true';
    const projects = projectStore.listProjects(user.id, includeArchived);
    return reply.send({ ok: true, projects });
  });

  app.post('/api/projects', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized.' });
    }
    const parsed = createProjectRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, message: parsed.error.issues[0]?.message || 'Invalid project data.' });
    }

    const initialCollaborators: UserProfile[] = [];
    if (parsed.data.collaboratorUsernames?.length) {
      for (const identifier of parsed.data.collaboratorUsernames) {
        const found = userStore.findByUsernameOrEmail(identifier);
        if (found && found.id !== user.id) {
          initialCollaborators.push(found);
        }
      }
    }

    try {
      const project = await projectStore.createProject(user, parsed.data, initialCollaborators);
      return reply.code(201).send({ ok: true, project });
    } catch (err: unknown) {
      if (err instanceof ProjectLimitError) {
        return reply.code(400).send({ ok: false, code: err.code, message: err.message });
      }
      const msg = err instanceof Error ? err.message : 'Failed to create project.';
      return reply.code(500).send({ ok: false, message: msg });
    }
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized.' });
    }
    const project = projectStore.getProject(request.params.id, user.id);
    if (!project) {
      return reply.code(404).send({ ok: false, message: 'Project not found.' });
    }
    return reply.send({ ok: true, project });
  });

  const handleProjectUpdate = async (request: Fastify.FastifyRequest<{ Params: { id: string } }>, reply: Fastify.FastifyReply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized.' });
    }
    const project = projectStore.getProject(request.params.id, user.id);
    if (!project) {
      return reply.code(404).send({ ok: false, message: 'Project not found.' });
    }
    if (!projectStore.canModifyProject(request.params.id, user.id)) {
      return reply.code(403).send({ ok: false, message: 'Viewers are not permitted to modify project settings.' });
    }
    const parsed = updateProjectRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, message: 'Invalid update parameters.' });
    }
    try {
      const updated = await projectStore.updateProject(request.params.id, user.id, parsed.data);
      if (!updated) {
        return reply.code(403).send({ ok: false, message: 'Project not found or unauthorized.' });
      }
      return reply.send({ ok: true, project: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update project.';
      return reply.code(500).send({ ok: false, message: msg });
    }
  };

  app.patch<{ Params: { id: string } }>('/api/projects/:id', handleProjectUpdate);
  app.put<{ Params: { id: string } }>('/api/projects/:id', handleProjectUpdate);

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized.' });
    }
    const project = projectStore.getProject(request.params.id, user.id);
    if (!project) {
      return reply.code(404).send({ ok: false, message: 'Project not found.' });
    }
    if (!projectStore.isOwner(request.params.id, user.id)) {
      return reply.code(403).send({ ok: false, message: 'Only the project owner can delete this project.' });
    }
    try {
      const deleted = await projectStore.deleteProject(request.params.id, user.id);
      if (!deleted) {
        return reply.code(403).send({ ok: false, message: 'Only the project owner can delete this project.' });
      }
      return reply.send({ ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete project.';
      return reply.code(500).send({ ok: false, message: msg });
    }
  });

  function pruneStaleProjectSubscribers(projectId: string) {
    const roomName = `project:${projectId}`;
    for (const s of io.sockets.sockets.values()) {
      const sData = s.data as SocketData;
      const sub = sData?.projectSubscriptions?.get(projectId);
      if (!sub) {
        if (s.rooms.has(roomName)) {
          void s.leave(roomName);
        }
        continue;
      }
      const verifiedUser = userStore.verifyToken(sub.authToken);
      const isSessionValid = Boolean(verifiedUser && verifiedUser.id === sub.userId);
      const hasAccess = isSessionValid && projectStore.hasAccess(projectId, sub.userId);

      if (!isSessionValid || !hasAccess) {
        sData.projectSubscriptions?.delete(projectId);
        void s.leave(roomName);
      }
    }
  }

  function ensureRoomProjectAccess(room: Room): boolean {
    if (!room.projectId) return false;
    if (room.hostIdentity.isGuest || !room.hostIdentity.id) {
      delete room.projectId;
      return false;
    }
    const canModify = projectStore.canModifyProject(room.projectId, room.hostIdentity.id);
    if (!canModify) {
      delete room.projectId;
      return false;
    }
    return true;
  }

  app.post<{ Params: { id: string } }>('/api/projects/:id/collaborators', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized.' });
    }
    const project = projectStore.getProject(request.params.id, user.id);
    if (!project) {
      return reply.code(404).send({ ok: false, message: 'Project not found.' });
    }
    if (!projectStore.isOwner(request.params.id, user.id)) {
      return reply.code(403).send({ ok: false, message: 'Only the project owner can add collaborators or assign roles.' });
    }
    const parsed = addCollaboratorRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, message: 'Please enter a username or email.' });
    }
    const targetUser = userStore.findByUsernameOrEmail(parsed.data.usernameOrEmail);
    if (!targetUser) {
      return reply.code(404).send({ ok: false, message: `No registered JaMeet user found matching "${parsed.data.usernameOrEmail}".` });
    }
    try {
      const updated = await projectStore.addCollaborator(request.params.id, user.id, targetUser, parsed.data.role);
      if (!updated) {
        return reply.code(403).send({ ok: false, message: 'Unauthorized to add collaborator or assign role.' });
      }
      pruneStaleProjectSubscribers(request.params.id);
      io.to(`project:${request.params.id}`).emit('project:activity:new', {
        projectId: request.params.id,
        activities: updated.activities
      });
      return reply.send({ ok: true, project: updated });
    } catch (err: unknown) {
      if (err instanceof ProjectLimitError) {
        return reply.code(400).send({ ok: false, code: err.code, message: err.message });
      }
      const msg = err instanceof Error ? err.message : 'Failed to add collaborator.';
      return reply.code(500).send({ ok: false, message: msg });
    }
  });

  app.delete<{ Params: { id: string; userId: string } }>('/api/projects/:id/collaborators/:userId', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized.' });
    }
    const project = projectStore.getProject(request.params.id, user.id);
    if (!project) {
      return reply.code(404).send({ ok: false, message: 'Project not found.' });
    }
    if (!projectStore.isOwner(request.params.id, user.id) && user.id !== request.params.userId) {
      return reply.code(403).send({ ok: false, message: 'Only the project owner can remove other collaborators.' });
    }
    try {
      const updated = await projectStore.removeCollaborator(request.params.id, user.id, request.params.userId);
      if (!updated) {
        return reply.code(403).send({ ok: false, message: 'Unauthorized to remove collaborator.' });
      }

      // Remove all active Socket.IO subscriptions for that user from this project room before broadcasting
      const projectId = request.params.id;
      const targetUserId = request.params.userId;
      const roomName = `project:${projectId}`;
      for (const s of io.sockets.sockets.values()) {
        const sData = s.data as SocketData;
        const projectSubscriptions = sData?.projectSubscriptions;
        if (projectSubscriptions) {
          const sub = projectSubscriptions.get(projectId);
          if (sub && sub.userId === targetUserId) {
            projectSubscriptions.delete(projectId);
            void s.leave(roomName);
          }
        }
      }
      pruneStaleProjectSubscribers(projectId);

      io.to(roomName).emit('project:activity:new', {
        projectId: request.params.id,
        activities: updated.activities
      });
      return reply.send({ ok: true, project: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove collaborator.';
      return reply.code(500).send({ ok: false, message: msg });
    }
  });

  const handleWorkspaceUpdate = async (request: Fastify.FastifyRequest<{ Params: { id: string } }>, reply: Fastify.FastifyReply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized.' });
    }
    const project = projectStore.getProject(request.params.id, user.id);
    if (!project) {
      return reply.code(404).send({ ok: false, message: 'Project not found.' });
    }
    if (!projectStore.canModifyWorkspace(request.params.id, user.id)) {
      return reply.code(403).send({ ok: false, message: 'Viewers are not permitted to modify workspace content.' });
    }
    const parsed = updateProjectWorkspaceRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, message: 'Invalid workspace update payload.' });
    }
    try {
      const updated = await projectStore.updateWorkspace(request.params.id, user, parsed.data);
      if (!updated) {
        return reply.code(403).send({ ok: false, message: 'Unauthorized to modify workspace.' });
      }
      // Broadcast real-time update to socket room
      pruneStaleProjectSubscribers(request.params.id);
      io.to(`project:${request.params.id}`).emit('project:workspace:synced', {
        projectId: request.params.id,
        workspace: updated.workspace,
        activities: updated.activities,
        updatedBy: user.id,
        updatedByName: user.displayName
      });
      return reply.send({ ok: true, project: updated, workspace: updated.workspace });
    } catch (err: unknown) {
      if (err instanceof WorkspaceConflictError) {
        const currentProject = projectStore.getProject(request.params.id, user.id);
        return reply.code(409).send({
          ok: false,
          conflict: true,
          code: 'WORKSPACE_CONFLICT',
          area: err.area,
          currentRevision: err.currentRevision,
          baseRevision: err.baseRevision,
          message: err.message,
          workspace: currentProject?.workspace,
          project: currentProject
        });
      }
      if (err instanceof WorkspaceLimitError) {
        return reply.code(400).send({
          ok: false,
          code: err.code,
          area: err.area,
          message: err.message
        });
      }
      const msg = err instanceof Error ? err.message : 'Failed to update workspace.';
      return reply.code(500).send({ ok: false, message: msg });
    }
  };

  app.put<{ Params: { id: string } }>('/api/projects/:id/workspace', handleWorkspaceUpdate);
  app.patch<{ Params: { id: string } }>('/api/projects/:id/workspace', handleWorkspaceUpdate);

  const io = new Server(app.server, {
    cors: {
      origin: (origin, cb) => {
        cb(null, isOriginAllowed(origin));
      },
      methods: ['GET', 'POST'],
      credentials: true
    },
    maxHttpBufferSize: PROJECT_LIMITS.MAX_WORKSPACE_PAYLOAD_BYTES,
    transports: ['websocket', 'polling']
  });

  function endRoomDueToAccessLoss(room: Room, reason: string) {
    ensureRoomProjectAccess(room);
    const project = room.projectId && room.hostIdentity.id
      ? projectStore.getProject(room.projectId, room.hostIdentity.id)
      : null;

    try {
      userStore.recordSessionClose(room.sessionId, {
        code: room.code,
        startedAt: room.startedAt,
        allJoinedParticipants: room.allJoinedParticipants,
        chatMessagesCount: room.chatMessagesCount || 0,
        events: room.events || [],
        projectId: room.projectId,
        projectName: project?.name
      });
    } catch (err) {
      console.error('Failed to record session close when host lost access:', err);
    }

    for (const p of Array.from(room.participants.values())) {
      if (p.timer) clearTimeout(p.timer);
      if (p.role !== 'host' && !p.identity.isGuest && p.identity.id) {
        try {
          userStore.recordSessionClose(room.sessionId, {
            code: room.code,
            startedAt: room.startedAt,
            allJoinedParticipants: room.allJoinedParticipants,
            chatMessagesCount: room.chatMessagesCount || 0,
            events: room.events || [],
            projectId: room.projectId,
            projectName: project?.name
          }, p.identity.id);
        } catch (err) {
          console.error('Failed to record participant session close when host lost access:', err);
        }
      }

      if (p.socketId) {
        const pSocket = io.sockets.sockets.get(p.socketId) || io.of('/').sockets.get(p.socketId);
        if (pSocket) {
          delete (pSocket.data as SocketData).code;
          delete (pSocket.data as SocketData).participantId;
          delete (pSocket.data as SocketData).identity;
          void pSocket.leave(room.code);
        }
        io.to(p.socketId).emit('meeting:ended', {
          code: room.code,
          message: reason,
          reason
        });
      }
    }

    for (const wp of Array.from(room.waitingParticipants.values())) {
      if (wp.socketId) {
        const wpSocket = io.sockets.sockets.get(wp.socketId) || io.of('/').sockets.get(wp.socketId);
        if (wpSocket) {
          delete (wpSocket.data as SocketData).code;
          delete (wpSocket.data as SocketData).participantId;
          delete (wpSocket.data as SocketData).identity;
          void wpSocket.leave(room.code);
        }
        io.to(wp.socketId).emit('meeting:ended', {
          code: room.code,
          message: reason,
          reason
        });
      }
    }

    rooms.close(room.code);
  }

  function removeParticipantDueToAccessLoss(room: Room, participant: Participant, reason: string) {
    if (participant.timer) clearTimeout(participant.timer);
    rooms.removeParticipant(room.code, participant.id);

    if (!participant.identity.isGuest && participant.identity.id) {
      ensureRoomProjectAccess(room);
      const project = room.projectId && room.hostIdentity.id
        ? projectStore.getProject(room.projectId, room.hostIdentity.id)
        : null;
      try {
        userStore.recordSessionClose(room.sessionId, {
          code: room.code,
          startedAt: room.startedAt,
          allJoinedParticipants: room.allJoinedParticipants,
          chatMessagesCount: room.chatMessagesCount || 0,
          events: room.events || [],
          projectId: room.projectId,
          projectName: project?.name
        }, participant.identity.id);
      } catch (err) {
        console.error('Failed to record session close on participant access loss:', err);
      }
    }

    if (participant.socketId) {
      const pSocket = io.sockets.sockets.get(participant.socketId) || io.of('/').sockets.get(participant.socketId);
      if (pSocket) {
        delete (pSocket.data as SocketData).code;
        delete (pSocket.data as SocketData).participantId;
        delete (pSocket.data as SocketData).identity;
        void pSocket.leave(room.code);
      }
      io.to(participant.socketId).emit('meeting:ended', {
        code: room.code,
        message: reason,
        reason
      });
    }

    io.to(room.code).emit('peer:left', {
      participantId: participant.id
    });
  }

  function revalidateActiveSessions(now: number = Date.now()) {
    for (const room of Array.from(rooms.rooms.values())) {
      if (rooms.isExpired(room, now)) {
        rooms.close(room.code);
        continue;
      }
      ensureRoomProjectAccess(room);

      // 1. Validate host access
      if (!room.hostIdentity.isGuest && room.hostIdentity.id) {
        const hostParticipant = Array.from(room.participants.values()).find((p) => p.role === 'host');
        const hostAuth = validateStoredUserSessionAccess(userStore, room.hostIdentity.id, config, true, now, hostParticipant?.authToken);
        if (!hostAuth.ok) {
          endRoomDueToAccessLoss(room, hostAuth.message);
          continue;
        }
      }

      // 2. Validate non-host active participants
      for (const participant of Array.from(room.participants.values())) {
        if (participant.role === 'host') continue;
        if (!participant.identity.isGuest && participant.identity.id) {
          const partAuth = validateStoredUserSessionAccess(userStore, participant.identity.id, config, false, now, participant.authToken);
          if (!partAuth.ok) {
            removeParticipantDueToAccessLoss(room, participant, partAuth.message);
          }
        }
      }

      // 3. Validate waiting participants
      for (const waiting of Array.from(room.waitingParticipants.values())) {
        if (!waiting.identity.isGuest && waiting.identity.id) {
          const waitAuth = validateStoredUserSessionAccess(userStore, waiting.identity.id, config, false, now, waiting.authToken);
          if (!waitAuth.ok) {
            if (waiting.timer) clearTimeout(waiting.timer);
            room.waitingParticipants.delete(waiting.id);
            if (waiting.socketId) {
              const wpSocket = io.sockets.sockets.get(waiting.socketId) || io.of('/').sockets.get(waiting.socketId);
              if (wpSocket) {
                delete (wpSocket.data as SocketData).code;
                delete (wpSocket.data as SocketData).participantId;
                delete (wpSocket.data as SocketData).identity;
                delete (wpSocket.data as SocketData).isWaiting;
                void wpSocket.leave(room.code);
              }
              io.to(waiting.socketId).emit('meeting:ended', {
                code: room.code,
                message: waitAuth.message,
                reason: waitAuth.message
              });
            }
            const hostParticipant = Array.from(room.participants.values()).find((p) => p.role === 'host');
            if (hostParticipant?.socketId) {
              const waitingList = Array.from(room.waitingParticipants.values()).map((p) => ({
                participantId: p.id,
                identity: p.identity,
                joinedAt: Date.now()
              }));
              io.to(hostParticipant.socketId).emit('waiting:update', waitingList);
            }
          }
        }
      }
    }
  }

  entitlementInterval = setInterval(() => {
    try {
      revalidateActiveSessions();
    } catch (err) {
      console.error('Error during active session entitlement check:', err);
    }
  }, 1000);
  entitlementInterval.unref();

  app.addHook('preClose', async () => {
    isShuttingDown = true;
    try {
      if (entitlementInterval) clearInterval(entitlementInterval);

      // 1. Finalize all active session histories in UserStore before room state is discarded
      const activeRooms = Array.from(rooms.rooms.values());
      for (const room of activeRooms) {
        try {
          ensureRoomProjectAccess(room);
          const project = room.projectId && room.hostIdentity.id
            ? projectStore.getProject(room.projectId, room.hostIdentity.id)
            : null;

          userStore.recordSessionClose(room.sessionId, {
            code: room.code,
            startedAt: room.startedAt,
            allJoinedParticipants: room.allJoinedParticipants,
            chatMessagesCount: room.chatMessagesCount || 0,
            events: room.events || [],
            projectId: room.projectId,
            projectName: project?.name
          });
        } catch (err: unknown) {
          logger.error('shutdown_session_close_failed', `Failed to record session close for room ${room.code} during graceful shutdown`, {
            code: room.code,
            sessionId: room.sessionId,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }

      // 2. Close all RoomStore state and clear reconnect/waiting timers
      rooms.closeAll();

      // 3. Explicitly disconnect active Socket.IO client connections
      try {
        io.disconnectSockets(true);
      } catch (err: unknown) {
        logger.warn('shutdown_socket_disconnect_error', 'Error disconnecting Socket.IO clients during shutdown', {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    } catch (err: unknown) {
      logger.error('shutdown_preclose_error', 'Error during server preClose lifecycle', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });

  function failure(code: MeetingErrorCode, message: string): MeetingAck {
    return { ok: false, code, message };
  }

  io.on('connection', (socket) => {
    const limiter = new SocketRateLimiter(customSocketLimits);
    const socketData = socket.data as SocketData;
    socketData.limiter = limiter;

    const enforceSocketSessionAccess = (): boolean => {
      if (socketData.code && socketData.participantId && socketData.identity && !socketData.identity.isGuest && socketData.identity.id) {
        const room = rooms.rooms.get(socketData.code);
        if (room) {
          const isHost = socketData.identity.id === room.hostIdentity.id;
          const participant = room.participants.get(socketData.participantId) || room.waitingParticipants.get(socketData.participantId);
          const authCheck = validateStoredUserSessionAccess(userStore, socketData.identity.id, config, isHost, Date.now(), participant?.authToken);
          if (!authCheck.ok) {
            if (isHost) {
              endRoomDueToAccessLoss(room, authCheck.message);
            } else {
              if (participant && room.participants.has(participant.id)) {
                removeParticipantDueToAccessLoss(room, participant, authCheck.message);
              } else if (participant && room.waitingParticipants.has(participant.id)) {
                if (participant.timer) clearTimeout(participant.timer);
                room.waitingParticipants.delete(participant.id);
                if (participant.socketId) {
                  delete socketData.code;
                  delete socketData.participantId;
                  delete socketData.identity;
                  delete socketData.isWaiting;
                  void socket.leave(room.code);
                  io.to(participant.socketId).emit('meeting:ended', {
                    code: room.code,
                    message: authCheck.message,
                    reason: authCheck.message
                  });
                }
                const hostParticipant = Array.from(room.participants.values()).find((p) => p.role === 'host');
                if (hostParticipant?.socketId) {
                  const waitingList = Array.from(room.waitingParticipants.values()).map((p) => ({
                    participantId: p.id,
                    identity: p.identity,
                    joinedAt: Date.now()
                  }));
                  io.to(hostParticipant.socketId).emit('waiting:update', waitingList);
                }
              }
            }
            return false;
          }
        }
      }
      return true;
    };

    // Project Workspace Real-Time Collaborative Sync
    socket.on('project:workspace:join', (raw: { projectId: string; authToken?: string }, ack?: (res: { ok: boolean; workspace?: ProjectWorkspace; message?: string }) => void) => {
      if (!limiter.consume('session')) { ack?.({ ok: false, message: 'Too many requests. Please slow down.' }); return; }
      if (!raw?.projectId) { ack?.({ ok: false, message: 'Invalid projectId' }); return; }
      const user = userStore.verifyToken(raw.authToken);
      if (!user || !raw.authToken || !projectStore.hasAccess(raw.projectId, user.id)) {
        ack?.({ ok: false, message: 'Unauthorized' });
        return;
      }
      if (!socketData.projectSubscriptions) {
        socketData.projectSubscriptions = new Map<string, ProjectSubscription>();
      }
      socketData.projectSubscriptions.set(raw.projectId, { userId: user.id, authToken: raw.authToken });
      void socket.join(`project:${raw.projectId}`);
      const project = projectStore.getProject(raw.projectId, user.id);
      ack?.({ ok: true, workspace: project?.workspace });
    });

    socket.on('project:workspace:leave', (raw: { projectId: string }) => {
      if (!limiter.consume('session')) return;
      if (raw?.projectId) {
        socketData.projectSubscriptions?.delete(raw.projectId);
        void socket.leave(`project:${raw.projectId}`);
      }
    });

    socket.on('project:workspace:update', async (raw: { projectId: string; authToken?: string; updates: unknown }, ack?: (res: UpdateProjectWorkspaceResponse) => void) => {
      if (!limiter.consume('workspace')) { ack?.({ ok: false, message: 'Too many requests. Please slow down.' }); return; }
      if (!raw?.projectId || !raw?.updates) { ack?.({ ok: false, message: 'Invalid payload' }); return; }
      const user = userStore.verifyToken(raw.authToken);
      if (!user || !projectStore.hasAccess(raw.projectId, user.id)) {
        ack?.({ ok: false, message: 'Unauthorized' });
        return;
      }
      if (!projectStore.canModifyWorkspace(raw.projectId, user.id)) {
        ack?.({ ok: false, message: 'Viewers are not permitted to modify workspace content' });
        return;
      }
      const parsed = updateProjectWorkspaceRequestSchema.safeParse(raw.updates);
      if (!parsed.success) {
        ack?.({ ok: false, message: 'Invalid workspace update payload.' });
        return;
      }
      let updated;
      try {
        updated = await projectStore.updateWorkspace(raw.projectId, user, parsed.data);
      } catch (err: unknown) {
        if (err instanceof WorkspaceConflictError) {
          const currentProject = projectStore.getProject(raw.projectId, user.id);
          ack?.({
            ok: false,
            conflict: true,
            code: 'WORKSPACE_CONFLICT',
            area: err.area,
            currentRevision: err.currentRevision,
            baseRevision: err.baseRevision,
            message: err.message,
            workspace: currentProject?.workspace
          });
          return;
        }
        if (err instanceof WorkspaceLimitError) {
          ack?.({
            ok: false,
            code: err.code,
            area: err.area,
            message: err.message
          });
          return;
        }
        ack?.({ ok: false, message: 'Failed to persist workspace update' });
        return;
      }
      if (!updated) {
        ack?.({ ok: false, message: 'Failed to update workspace' });
        return;
      }

      // If this mutation originated during an active session for this project, record the verified events
      if (socketData.code) {
        const room = rooms.rooms.get(socketData.code);
        if (room && ensureRoomProjectAccess(room) && room.projectId === raw.projectId) {
          const project = projectStore.getProject(raw.projectId, user.id);
          if (project?.activities) {
            const recent = project.activities.filter((a) => a.createdAt >= room.startedAt);
            for (const act of recent) {
              const summaryEvent = mapActivityToSessionSummaryEvent(act);
              if (summaryEvent && !room.events.some((e) => e.id === summaryEvent.id)) {
                room.events.push(summaryEvent);
              }
            }
          }
        }
      }

      // Broadcast real-time update to other collaborators in this project
      pruneStaleProjectSubscribers(raw.projectId);
      socket.to(`project:${raw.projectId}`).emit('project:workspace:synced', {
        projectId: raw.projectId,
        workspace: updated.workspace,
        updatedBy: user.id,
        updatedByName: user.displayName
      });
      ack?.({ ok: true, workspace: updated.workspace });
    });

    socket.on('meeting:create', async (raw, ack: (value: MeetingAck) => void) => {
      if (!limiter.consume('session')) return ack(failure('BAD_REQUEST', 'Too many requests. Please slow down.'));
      const parsed = createMeetingSchema.safeParse(raw);
      if (!parsed.success) return ack(failure('BAD_REQUEST', 'Invalid session request'));
      if (socketData.code) return ack(failure('BAD_REQUEST', 'Already in a session'));
      
      const authResult = authorizeSessionAccess(userStore, parsed.data.authToken, config, true);
      if (!authResult.ok) {
        logger.warn('session_create_failed', 'Session creation unauthorized', { reason: authResult.message, errorCode: authResult.code });
        return ack(failure(authResult.code, authResult.message));
      }

      const identity = authResult.identity;
      const userSnapshot = userStore.createSnapshot();
      let projectSnapshot: string | null = null;
      let projectMutationAttempted = false;
      let createdRoom: Room | undefined;

      try {
        if (!identity.isGuest && identity.id) {
          userStore.incrementHostedCount(identity.id);
        }

        // Verify Project modification permission if projectId provided by Host
        let verifiedProjectId: string | undefined = undefined;
        if (parsed.data.projectId && !identity.isGuest && identity.id) {
          if (projectStore.canModifyProject(parsed.data.projectId, identity.id)) {
            verifiedProjectId = parsed.data.projectId;
          }
        }

        const reconnectToken = randomUUID();
        createdRoom = rooms.create(parsed.data.participantId, socket.id, parsed.data.media, identity, verifiedProjectId, parsed.data.waitingRoomEnabled, reconnectToken, parsed.data.authToken);
        if (!identity.isGuest && identity.id) {
          userStore.recordSessionStart(createdRoom.sessionId, createdRoom.code, identity.id, 'host', null);
        }

        if (createdRoom.projectId) {
          projectSnapshot = projectStore.createSnapshot(createdRoom.projectId);
          projectMutationAttempted = true;
          await projectStore.recordProjectSession(createdRoom.projectId, {
            id: `${identity.id}_${createdRoom.code}`,
            code: createdRoom.code,
            startedAt: Date.now(),
            role: 'host',
            collaborator: null
          }, null);
        }

        Object.assign(socketData, { code: createdRoom.code, participantId: parsed.data.participantId, identity, isWaiting: false });
        void socket.join(createdRoom.code);

        logger.info('session_created', 'Session created successfully', {
          code: createdRoom.code,
          hostId: identity.id,
          isGuest: identity.isGuest
        }, { sessionCode: createdRoom.code });

        ack({
          ok: true,
          code: createdRoom.code,
          role: 'host',
          waiting: false,
          locked: false,
          iceServers: createIceServers(config, parsed.data.participantId),
          peerPresent: false,
          identity,
          hostIdentity: identity,
          projectId: createdRoom.projectId || undefined,
          reconnectToken
        });
      } catch (err: unknown) {
        let rollbackError: unknown;
        try {
          userStore.restoreSnapshot(userSnapshot);
          if (projectMutationAttempted && projectSnapshot) {
            await projectStore.restoreSnapshot(projectSnapshot);
          }
        } catch (rErr: unknown) {
          rollbackError = rErr;
          console.error('Critical: Failed to persist compensating rollback for session creation:', { originalError: err, rollbackError: rErr });
        }

        if (!rollbackError) {
          console.error('Failed to initialize session persistence:', err);
        }

        if (createdRoom) {
          rooms.close(createdRoom.code);
        }
        delete socketData.code;
        delete socketData.participantId;
        delete socketData.identity;
        delete socketData.isWaiting;

        return ack(failure('SERVER_ERROR', 'Failed to initialize session'));
      }
    });

    socket.on('meeting:join', async (raw, ack: (value: MeetingAck) => void) => {
      if (!limiter.consume('session')) return ack(failure('BAD_REQUEST', 'Too many requests. Please slow down.'));
      const parsed = joinMeetingSchema.safeParse(raw);
      if (!parsed.success) return ack(failure('BAD_REQUEST', 'Invalid session code or participant'));
      if (socketData.code) return ack(failure('BAD_REQUEST', 'Already in a session'));
      
      const authResult = authorizeSessionAccess(userStore, parsed.data.authToken, config, false);
      if (!authResult.ok) {
        logger.warn('session_join_failed', 'Session join unauthorized', { code: parsed.data.code, reason: authResult.message, errorCode: authResult.code }, { sessionCode: parsed.data.code });
        return ack(failure(authResult.code, authResult.message));
      }

      const identity = authResult.identity;
      const joined = rooms.join(parsed.data.code, parsed.data.participantId, socket.id, parsed.data.media, identity, parsed.data.reconnectToken, parsed.data.authToken);
      if (!joined.ok) {
        const message = joined.reason === 'UNAUTHORIZED'
          ? 'Unauthorized reconnect attempt'
          : joined.reason === 'ROOM_LOCKED'
            ? 'This session is currently locked by the host.'
            : joined.reason === 'ROOM_FULL'
              ? 'This session already has two people'
              : 'Session not found';
        logger.warn('session_join_failed', `Session join rejected (${joined.reason})`, { code: parsed.data.code, reason: joined.reason }, { sessionCode: parsed.data.code });
        return ack(failure(joined.reason, message));
      }

      if (joined.waiting) {
        Object.assign(socketData, { code: parsed.data.code, participantId: joined.participant.id, identity: joined.participant.identity, isWaiting: true });
        // Isolated from active room until host admits

        const hostParticipant = Array.from(joined.room.participants.values()).find((p) => p.role === 'host');
        if (hostParticipant?.socketId) {
          const waitingList = Array.from(joined.room.waitingParticipants.values()).map((p) => ({
            participantId: p.id,
            identity: p.identity,
            joinedAt: Date.now()
          }));
          io.to(hostParticipant.socketId).emit('waiting:update', waitingList);
        }

        return ack({
          ok: true,
          code: parsed.data.code,
          role: 'guest',
          waiting: true,
          locked: Boolean(joined.room.isLocked),
          iceServers: [],
          peerPresent: false,
          identity: joined.participant.identity,
          hostIdentity: joined.room.hostIdentity,
          reconnectToken: joined.participant.reconnectToken
        });
      }

      const userSnapshot = userStore.createSnapshot();
      let projectSnapshot: string | null = null;
      let projectMutationAttempted = false;

      try {
        const peer = rooms.peer(joined.room, parsed.data.participantId);
        if (peer) {
          if (!joined.reconnected) {
            userStore.recordCollaboratorJoined(joined.room.sessionId, parsed.data.code, joined.room.hostIdentity, joined.participant.identity);
            if (ensureRoomProjectAccess(joined.room)) {
              projectSnapshot = projectStore.createSnapshot(joined.room.projectId!);
              projectMutationAttempted = true;
              await projectStore.recordProjectSession(joined.room.projectId!, {
                id: `${joined.room.hostIdentity.id}_${parsed.data.code}`,
                code: parsed.data.code,
                startedAt: Date.now(),
                role: 'host',
                collaborator: {
                  id: joined.participant.identity.isGuest ? undefined : joined.participant.identity.id,
                  displayName: joined.participant.identity.displayName,
                  username: joined.participant.identity.username,
                  isGuest: joined.participant.identity.isGuest,
                  avatarColor: joined.participant.identity.avatarColor
                }
              }, joined.participant.identity);
            }
          }
        } else if (!joined.participant.identity.isGuest && joined.participant.identity.id && !joined.reconnected) {
          userStore.recordSessionStart(joined.room.sessionId, parsed.data.code, joined.participant.identity.id, 'participant', joined.room.hostIdentity);
        }

        Object.assign(socketData, { code: parsed.data.code, participantId: joined.participant.id, identity: joined.participant.identity, isWaiting: false });
        void socket.join(joined.room.code);

        logger.info('session_joined', 'Session joined successfully', {
          code: joined.room.code,
          participantId: joined.participant.id,
          isGuest: joined.participant.identity.isGuest,
          reconnected: joined.reconnected
        }, { sessionCode: joined.room.code });

        const hostParticipant = Array.from(joined.room.participants.values()).find((p) => p.role === 'host');
        ack({
          ok: true,
          code: joined.room.code,
          role: joined.participant.role,
          waiting: false,
          locked: Boolean(joined.room.isLocked),
          iceServers: createIceServers(config, parsed.data.participantId),
          peerPresent: Boolean(peer),
          peerMedia: peer?.media,
          peerParticipantId: peer?.id,
          identity: joined.participant.identity,
          hostIdentity: joined.room.hostIdentity,
          peerIdentity: peer ? peer.identity : (joined.participant.role === 'guest' ? hostParticipant?.identity : undefined),
          projectId: joined.room.projectId || undefined,
          reconnectToken: joined.participant.reconnectToken
        });

        if (peer && peer.socketId) {
          io.to(peer.socketId).emit('peer:ready', {
            media: joined.participant.media,
            identity: joined.participant.identity,
            participantId: joined.participant.id,
            reconnected: joined.reconnected
          });
          io.to(peer.socketId).emit('peer:joined', {
            peerMedia: joined.participant.media,
            identity: joined.participant.identity
          });
        }
      } catch (err: unknown) {
        let rollbackError: unknown;
        try {
          userStore.restoreSnapshot(userSnapshot);
          if (projectMutationAttempted && projectSnapshot) {
            await projectStore.restoreSnapshot(projectSnapshot);
          }
        } catch (rErr: unknown) {
          rollbackError = rErr;
          console.error('Critical: Failed to persist compensating rollback for session join:', { originalError: err, rollbackError: rErr });
        }

        if (!rollbackError) {
          console.error('Failed to record session join persistence:', err);
        }

        if (!joined.reconnected) {
          joined.room.participants.delete(parsed.data.participantId);
          joined.room.allJoinedParticipants.delete(parsed.data.participantId);
        }
        delete socketData.code;
        delete socketData.participantId;
        delete socketData.identity;
        delete socketData.isWaiting;
        void socket.leave(parsed.data.code);

        return ack(failure('SERVER_ERROR', 'Failed to join session'));
      }
    });

    const handleAdmit = async (raw: unknown, ack?: (res: { ok: boolean; message?: string }) => void) => {
      if (!limiter.consume('session')) {
        ack?.({ ok: false, message: 'Too many requests. Please slow down.' });
        return;
      }
      const parsed = admitParticipantSchema.safeParse(raw);
      if (!parsed.success || parsed.data.code !== socketData.code || !socketData.participantId) {
        ack?.({ ok: false, message: 'Invalid admit request' });
        return;
      }
      const room = rooms.rooms.get(parsed.data.code);
      if (!room) {
        ack?.({ ok: false, message: 'Session not found' });
        return;
      }
      const hostParticipant = room.participants.get(socketData.participantId);
      if (!hostParticipant || hostParticipant.role !== 'host' || hostParticipant.socketId !== socket.id) {
        ack?.({ ok: false, message: 'Only host can admit participants' });
        return;
      }
      const waiting = room.waitingParticipants.get(parsed.data.participantId);
      if (!waiting) {
        ack?.({ ok: false, message: 'Participant is no longer in waiting room' });
        return;
      }

      const accessAuth = validateStoredUserSessionAccess(userStore, waiting.identity.id, config, false, Date.now(), waiting.authToken);
      if (!accessAuth.ok) {
        ack?.({ ok: false, message: accessAuth.message || 'Participant session access is no longer valid' });
        return;
      }
      waiting.identity = accessAuth.identity;

      const admitted = rooms.admit(parsed.data.code, parsed.data.participantId);
      if (!admitted.ok) {
        ack?.({ ok: false, message: admitted.reason === 'ROOM_FULL' ? 'Session is already full' : 'Failed to admit' });
        return;
      }

      const userSnapshot = userStore.createSnapshot();
      let projectSnapshot: string | null = null;
      let projectMutationAttempted = false;

      try {
        userStore.recordCollaboratorJoined(admitted.room.sessionId, admitted.room.code, admitted.room.hostIdentity, admitted.participant.identity);
        if (ensureRoomProjectAccess(admitted.room)) {
          projectSnapshot = projectStore.createSnapshot(admitted.room.projectId!);
          projectMutationAttempted = true;
          await projectStore.recordProjectSession(admitted.room.projectId!, {
            id: `${admitted.room.hostIdentity.id}_${admitted.room.code}`,
            code: admitted.room.code,
            startedAt: Date.now(),
            role: 'host',
            collaborator: {
              id: admitted.participant.identity.isGuest ? undefined : admitted.participant.identity.id,
              displayName: admitted.participant.identity.displayName,
              username: admitted.participant.identity.username,
              isGuest: admitted.participant.identity.isGuest,
              avatarColor: admitted.participant.identity.avatarColor
            }
          }, admitted.participant.identity);
        }

        if (admitted.participant.socketId) {
          const admittedSocket = io.sockets.sockets.get(admitted.participant.socketId) || io.of('/').sockets.get(admitted.participant.socketId);
          if (admittedSocket) {
            (admittedSocket.data as SocketData).isWaiting = false;
            void admittedSocket.join(admitted.room.code);
          }

          io.to(admitted.participant.socketId).emit('waiting:admitted', {
            ok: true,
            code: admitted.room.code,
            role: 'guest',
            waiting: false,
            locked: Boolean(admitted.room.isLocked),
            iceServers: createIceServers(config, admitted.participant.id),
            peerPresent: true,
            peerMedia: hostParticipant.media,
            peerParticipantId: hostParticipant.id,
            identity: admitted.participant.identity,
            hostIdentity: admitted.room.hostIdentity,
            peerIdentity: hostParticipant.identity,
            projectId: admitted.room.projectId || undefined,
            reconnectToken: admitted.participant.reconnectToken
          });
        }

        if (hostParticipant.socketId) {
          io.to(hostParticipant.socketId).emit('peer:ready', {
            media: admitted.participant.media,
            identity: admitted.participant.identity,
            participantId: admitted.participant.id,
            reconnected: false
          });
          io.to(hostParticipant.socketId).emit('peer:joined', {
            peerMedia: admitted.participant.media,
            identity: admitted.participant.identity
          });
          const updatedWaitingList = Array.from(admitted.room.waitingParticipants.values()).map((p) => ({
            participantId: p.id,
            identity: p.identity,
            joinedAt: Date.now()
          }));
          io.to(hostParticipant.socketId).emit('waiting:update', updatedWaitingList);
        }

        ack?.({ ok: true });
      } catch (err: unknown) {
        let rollbackError: unknown;
        try {
          userStore.restoreSnapshot(userSnapshot);
          if (projectMutationAttempted && projectSnapshot) {
            await projectStore.restoreSnapshot(projectSnapshot);
          }
        } catch (rErr: unknown) {
          rollbackError = rErr;
          console.error('Critical: Failed to persist compensating rollback for session admission:', { originalError: err, rollbackError: rErr });
        }

        if (!rollbackError) {
          console.error('Failed to persist session admission:', err);
        }

        admitted.room.participants.delete(parsed.data.participantId);
        admitted.room.allJoinedParticipants.delete(parsed.data.participantId);
        admitted.room.waitingParticipants.set(parsed.data.participantId, waiting);

        ack?.({ ok: false, message: 'Failed to admit participant' });
      }
    };

    socket.on('meeting:admit', handleAdmit);
    socket.on('waiting:admit', handleAdmit);

    socket.on('meeting:lock', (raw, ack?: (res: { ok: boolean; locked?: boolean; message?: string }) => void) => {
      if (!limiter.consume('session')) {
        ack?.({ ok: false, message: 'Too many requests. Please slow down.' });
        return;
      }
      const parsed = lockMeetingSchema.safeParse(raw);
      if (!parsed.success || parsed.data.code !== socketData.code || !socketData.participantId) {
        ack?.({ ok: false, message: 'Invalid lock request' });
        return;
      }
      const room = rooms.rooms.get(parsed.data.code);
      if (!room) {
        ack?.({ ok: false, message: 'Session not found' });
        return;
      }
      const hostParticipant = room.participants.get(socketData.participantId);
      if (!hostParticipant || hostParticipant.role !== 'host' || hostParticipant.socketId !== socket.id) {
        ack?.({ ok: false, message: 'Only the host can lock or unlock the session' });
        return;
      }

      const updated = rooms.setLocked(parsed.data.code, parsed.data.locked);
      if (!updated.ok) {
        ack?.({ ok: false, message: 'Failed to update session lock state' });
        return;
      }

      io.to(parsed.data.code).emit('meeting:locked', { locked: updated.room.isLocked });
      io.to(parsed.data.code).emit('session:locked', { code: parsed.data.code, locked: updated.room.isLocked });
      ack?.({ ok: true, locked: updated.room.isLocked });
    });

    socket.on('meeting:removeParticipant', (raw, ack?: (res: { ok: boolean; message?: string }) => void) => {
      if (!limiter.consume('session')) {
        ack?.({ ok: false, message: 'Too many requests. Please slow down.' });
        return;
      }
      const parsed = removeParticipantSchema.safeParse(raw);
      if (!parsed.success || parsed.data.code !== socketData.code || !socketData.participantId) {
        ack?.({ ok: false, message: 'Invalid remove participant request' });
        return;
      }
      const room = rooms.rooms.get(parsed.data.code);
      if (!room) {
        ack?.({ ok: false, message: 'Session not found' });
        return;
      }
      const hostParticipant = room.participants.get(socketData.participantId);
      if (!hostParticipant || hostParticipant.role !== 'host' || hostParticipant.socketId !== socket.id) {
        ack?.({ ok: false, message: 'Only the host can remove participants' });
        return;
      }

      const targetId = parsed.data.participantId;
      const targetParticipant = room.participants.get(targetId);
      if (!targetParticipant) {
        ack?.({ ok: false, message: 'Participant not found in active session' });
        return;
      }
      if (targetParticipant.role === 'host') {
        ack?.({ ok: false, message: 'Host cannot be removed' });
        return;
      }

      const removed = rooms.removeParticipant(parsed.data.code, targetId);
      if (!removed.ok) {
        ack?.({ ok: false, message: 'Failed to remove participant' });
        return;
      }

      if (!removed.removed.identity.isGuest && removed.removed.identity.id) {
        ensureRoomProjectAccess(room);
        const project = room.projectId && room.hostIdentity.id
          ? projectStore.getProject(room.projectId, room.hostIdentity.id)
          : null;
        try {
          userStore.recordSessionClose(room.sessionId, {
            code: room.code,
            startedAt: room.startedAt,
            allJoinedParticipants: room.allJoinedParticipants,
            chatMessagesCount: room.chatMessagesCount || 0,
            events: room.events || [],
            projectId: room.projectId,
            projectName: project?.name
          }, removed.removed.identity.id);
        } catch (err: unknown) {
          console.error('Failed to record session close on participant removal:', err);
        }
      }

      if (removed.removed.socketId) {
        const removedSocket = io.sockets.sockets.get(removed.removed.socketId) || io.of('/').sockets.get(removed.removed.socketId);
        if (removedSocket) {
          delete (removedSocket.data as SocketData).code;
          delete (removedSocket.data as SocketData).participantId;
          delete (removedSocket.data as SocketData).identity;
          void removedSocket.leave(parsed.data.code);
        }
        io.to(removed.removed.socketId).emit('meeting:removed', {
          code: parsed.data.code,
          message: 'You have been removed from the session by the host.',
          reason: 'The host has removed you from this session.'
        });
      }

      io.to(parsed.data.code).emit('peer:left', {
        participantId: targetId
      });

      ack?.({ ok: true });
    });

    socket.on('signal:description', (raw) => {
      if (!limiter.consume('signaling')) return;
      if (!enforceSocketSessionAccess()) return;
      const parsed = signalDescriptionSchema.safeParse(raw);
      if (!parsed.success || parsed.data.code !== socketData.code || !socketData.participantId || socketData.isWaiting) return;
      const room = rooms.rooms.get(parsed.data.code);
      const participant = room?.participants.get(socketData.participantId);
      if (!room || !participant || participant.socketId !== socket.id) return;
      const peer = rooms.peer(room, participant.id);
      if (peer?.socketId) io.to(peer.socketId).emit('signal:description', parsed.data.description);
    });

    socket.on('signal:candidate', (raw) => {
      if (!limiter.consume('ice')) return;
      if (!enforceSocketSessionAccess()) return;
      const parsed = signalCandidateSchema.safeParse(raw);
      if (!parsed.success || parsed.data.code !== socketData.code || !socketData.participantId || socketData.isWaiting) return;
      const room = rooms.rooms.get(parsed.data.code);
      const participant = room?.participants.get(socketData.participantId);
      if (!room || !participant || participant.socketId !== socket.id) return;
      const peer = rooms.peer(room, participant.id);
      if (peer?.socketId) io.to(peer.socketId).emit('signal:candidate', parsed.data.candidate);
    });

    socket.on('signal:renegotiate', (raw) => {
      if (!limiter.consume('signaling')) return;
      if (!enforceSocketSessionAccess()) return;
      const parsed = signalRenegotiateSchema.safeParse(raw);
      if (!parsed.success || parsed.data.code !== socketData.code || !socketData.participantId || socketData.isWaiting) return;
      const room = rooms.rooms.get(parsed.data.code);
      const participant = room?.participants.get(socketData.participantId);
      if (!room || !participant || participant.socketId !== socket.id) return;
      const peer = rooms.peer(room, participant.id);
      if (peer?.socketId) io.to(peer.socketId).emit('signal:renegotiate');
    });

    socket.on('meeting:action', (raw) => {
      if (!limiter.consume('action')) return;
      if (!enforceSocketSessionAccess()) return;
      const parsed = meetingActionSchema.safeParse(raw);
      if (!parsed.success || parsed.data.code !== socketData.code || !socketData.participantId || socketData.isWaiting) return;
      const room = rooms.rooms.get(parsed.data.code);
      const participant = room?.participants.get(socketData.participantId);
      if (!room || !participant || participant.socketId !== socket.id) return;
      const peer = rooms.peer(room, participant.id);
      if (peer?.socketId) io.to(peer.socketId).emit('meeting:action', parsed.data.action);
    });

    socket.on('media:update', (raw) => {
      if (!limiter.consume('media')) return;
      if (!enforceSocketSessionAccess()) return;
      const parsed = mediaUpdateSchema.safeParse(raw);
      if (!parsed.success || parsed.data.code !== socketData.code || !socketData.participantId || socketData.isWaiting) return;
      const room = rooms.rooms.get(parsed.data.code);
      const participant = room?.participants.get(socketData.participantId);
      if (!room || !participant || participant.socketId !== socket.id) return;
      participant.media = parsed.data.media;
      const peer = rooms.peer(room, participant.id);
      if (peer?.socketId) io.to(peer.socketId).emit('media:update', parsed.data.media);
    });

    socket.on('chat:send', (raw, ack?: (res: { ok: boolean; message?: SessionChatMessage; error?: string }) => void) => {
      if (!limiter.consume('chat')) {
        ack?.({ ok: false, error: 'Too many messages. Please slow down.' });
        return;
      }
      if (!enforceSocketSessionAccess()) {
        ack?.({ ok: false, error: 'Session access is no longer valid' });
        return;
      }
      const parsed = sendChatMessageSchema.safeParse(raw);
      if (!parsed.success || parsed.data.code !== socketData.code || !socketData.participantId || socketData.isWaiting) {
        ack?.({ ok: false, error: 'Invalid chat message payload or session state' });
        return;
      }
      const room = rooms.rooms.get(parsed.data.code);
      if (!room) {
        ack?.({ ok: false, error: 'Session not found' });
        return;
      }
      const participant = room.participants.get(socketData.participantId);
      if (!participant || participant.socketId !== socket.id) {
        ack?.({ ok: false, error: 'Unauthorized participant socket' });
        return;
      }
      rooms.incrementChat(parsed.data.code);
      const senderName = socketData.identity?.displayName || participant.identity.displayName || 'Musician';
      const message: SessionChatMessage = {
        id: randomUUID(),
        senderId: socketData.participantId,
        senderName,
        text: parsed.data.text,
        timestamp: Date.now()
      };
      socket.to(parsed.data.code).emit('chat:message', message);
      ack?.({ ok: true, message });
    });

    const leave = (explicit: boolean) => {
      const { code, participantId, isWaiting } = socketData;
      if (!code || !participantId) return;
      if (isShuttingDown) {
        delete socketData.code;
        delete socketData.participantId;
        delete socketData.identity;
        delete socketData.isWaiting;
        return;
      }
      if (isWaiting) {
        const room = rooms.rooms.get(code);
        const waiting = room?.waitingParticipants.get(participantId);
        if (waiting && waiting.socketId && waiting.socketId !== socket.id) {
          delete socketData.code;
          delete socketData.participantId;
          delete socketData.identity;
          delete socketData.isWaiting;
          return;
        }
        if (explicit) {
          rooms.removeWaiting(code, participantId, socket.id);
          if (room) {
            const hostParticipant = Array.from(room.participants.values()).find((p) => p.role === 'host');
            if (hostParticipant?.socketId) {
              const updatedWaitingList = Array.from(room.waitingParticipants.values()).map((p) => ({
                participantId: p.id,
                identity: p.identity,
                joinedAt: Date.now()
              }));
              io.to(hostParticipant.socketId).emit('waiting:update', updatedWaitingList);
            }
          }
        } else {
          rooms.disconnectWaiting(code, participantId, () => {
            const currentRoom = rooms.rooms.get(code);
            if (currentRoom) {
              const hostParticipant = Array.from(currentRoom.participants.values()).find((p) => p.role === 'host');
              if (hostParticipant?.socketId) {
                const updatedWaitingList = Array.from(currentRoom.waitingParticipants.values()).map((p) => ({
                  participantId: p.id,
                  identity: p.identity,
                  joinedAt: Date.now()
                }));
                io.to(hostParticipant.socketId).emit('waiting:update', updatedWaitingList);
              }
            }
          }, socket.id);
        }
        delete socketData.code;
        delete socketData.participantId;
        delete socketData.identity;
        delete socketData.isWaiting;
        return;
      }

      const room = rooms.rooms.get(code);
      const participant = room?.participants.get(participantId);
      if (participant && participant.socketId && participant.socketId !== socket.id) {
        delete socketData.code;
        delete socketData.participantId;
        delete socketData.identity;
        return;
      }

      if (explicit) {
        const roomBefore = rooms.rooms.get(code);
        const result = rooms.leave(code, participantId, socket.id);
        if (roomBefore) {
          ensureRoomProjectAccess(roomBefore);
          const project = roomBefore.projectId && roomBefore.hostIdentity.id
            ? projectStore.getProject(roomBefore.projectId, roomBefore.hostIdentity.id)
            : null;
          if (result?.role === 'host') {
            try {
              userStore.recordSessionClose(roomBefore.sessionId, {
                code: roomBefore.code,
                startedAt: roomBefore.startedAt,
                allJoinedParticipants: roomBefore.allJoinedParticipants,
                chatMessagesCount: roomBefore.chatMessagesCount || 0,
                events: roomBefore.events || [],
                projectId: roomBefore.projectId,
                projectName: project?.name
              });
            } catch (err: unknown) {
              console.error('Failed to record session close on explicit leave:', err);
            }
          } else if (result?.participant && !result.participant.identity.isGuest && result.participant.identity.id) {
            try {
              userStore.recordSessionClose(roomBefore.sessionId, {
                code: roomBefore.code,
                startedAt: roomBefore.startedAt,
                allJoinedParticipants: roomBefore.allJoinedParticipants,
                chatMessagesCount: roomBefore.chatMessagesCount || 0,
                events: roomBefore.events || [],
                projectId: roomBefore.projectId,
                projectName: project?.name
              }, result.participant.identity.id);
            } catch (err: unknown) {
              console.error('Failed to record participant session close on explicit leave:', err);
            }
          }
        }
        if (result?.peer?.socketId) io.to(result.peer.socketId).emit(result.role === 'host' ? 'meeting:ended' : 'peer:left');
        delete socketData.code;
        delete socketData.participantId;
        delete socketData.identity;
        void socket.leave(code);
      } else {
        const peer = room && rooms.peer(room, participantId);
        if (peer?.socketId) io.to(peer.socketId).emit('peer:disconnected');
        rooms.disconnect(code, participantId, (role, expiredPeer, expiredParticipant) => {
          const currentRoom = rooms.rooms.get(code) || room;
          if (currentRoom) {
            ensureRoomProjectAccess(currentRoom);
            const project = currentRoom.projectId && currentRoom.hostIdentity.id
              ? projectStore.getProject(currentRoom.projectId, currentRoom.hostIdentity.id)
              : null;
            if (role === 'host') {
              try {
                userStore.recordSessionClose(currentRoom.sessionId, {
                  code: currentRoom.code,
                  startedAt: currentRoom.startedAt,
                  allJoinedParticipants: currentRoom.allJoinedParticipants,
                  chatMessagesCount: currentRoom.chatMessagesCount || 0,
                  events: currentRoom.events || [],
                  projectId: currentRoom.projectId,
                  projectName: project?.name
                });
              } catch (err: unknown) {
                console.error('Failed to record session close on disconnect expiry:', err);
              }
            } else if (expiredParticipant && !expiredParticipant.identity.isGuest && expiredParticipant.identity.id) {
              try {
                userStore.recordSessionClose(currentRoom.sessionId, {
                  code: currentRoom.code,
                  startedAt: currentRoom.startedAt,
                  allJoinedParticipants: currentRoom.allJoinedParticipants,
                  chatMessagesCount: currentRoom.chatMessagesCount || 0,
                  events: currentRoom.events || [],
                  projectId: currentRoom.projectId,
                  projectName: project?.name
                }, expiredParticipant.identity.id);
              } catch (err: unknown) {
                console.error('Failed to record participant session close on disconnect expiry:', err);
              }
            }
          }
          if (expiredPeer?.socketId) io.to(expiredPeer.socketId).emit(role === 'host' ? 'meeting:ended' : 'peer:left');
        }, socket.id);
        delete socketData.code;
        delete socketData.participantId;
        delete socketData.identity;
      }
    };
    socket.on('meeting:leave', () => leave(true));
    socket.on('disconnect', () => leave(false));
  });

  return { app, io, rooms, userStore, projectStore, crashStore, runtimeAdminToken, datastoreLock };
}

