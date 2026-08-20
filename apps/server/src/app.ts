import { randomUUID } from 'node:crypto';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Server } from 'socket.io';
import type { ServerConfig } from './config.js';
import { RoomStore } from './rooms.js';
import { UserStore } from './auth.js';
import { ProjectStore, PROJECT_LIMITS } from './projects.js';
import { CrashReportStore } from './crash-store.js';
import type { RateLimitCategory, RateLimitConfig } from './rate-limiter.js';
import { writeAdminRuntimeFile, cleanupAdminRuntimeFile } from './admin-access.js';
import { registerAdminPanel } from './admin-panel.js';
import { acquireDatastoreLock, type DatastoreLock } from './datastore-lock.js';
import { logger } from './logger.js';
import { getClientIp } from './client-ip.js';
import { createPresenceState, getActiveRoomsCount as getActiveRoomsCountHelper } from './presence.js';
import { ensureRoomProjectAccess } from './project-sync.js';
import { revalidateActiveSessions } from './session-lifecycle.js';
import { registerInternalAdminRoutes } from './routes/internal-admin-routes.js';
import { registerCrashRoutes } from './routes/crash-routes.js';
import { registerAuthRoutes } from './routes/auth-routes.js';
import { registerSessionRoutes } from './routes/session-routes.js';
import { registerProjectRoutes } from './routes/project-routes.js';
import { setupSocketServer } from './sockets/socket-server.js';

export async function createApp(
  config: ServerConfig,
  customSocketLimits?: Partial<Record<RateLimitCategory, RateLimitConfig>>
): Promise<{
  app: FastifyInstance;
  io: Server;
  rooms: RoomStore;
  userStore: UserStore;
  projectStore: ProjectStore;
  crashStore: CrashReportStore;
  runtimeAdminToken: string;
  datastoreLock: DatastoreLock;
}> {
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
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Origin',
      'Accept',
      'X-Requested-With',
      'X-Client-Version',
      'X-Client-Platform'
    ],
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
  const projectStore = new ProjectStore(dataDir, userStore);
  const crashStore = new CrashReportStore(dataDir);
  const rooms = new RoomStore(config.DISCONNECT_GRACE_MS, config.EMPTY_ROOM_TTL_MS);
  const runtimeAdminToken = randomUUID();
  let entitlementInterval: NodeJS.Timeout | undefined;

  // In-Memory Presence Tracking for Authenticated Users
  const { associateUserSocket, removeUserSocket, getOnlineUserIds, isUserOnline } = createPresenceState();
  const getActiveRoomsCount = (): number => getActiveRoomsCountHelper(rooms);

  // Internal Loopback-Only Administration Endpoint
  registerInternalAdminRoutes(app, userStore, runtimeAdminToken);

  registerAdminPanel(app, userStore, config, {
    getOnlineUserIds,
    isUserOnline,
    getActiveRoomsCount,
    getUptimeSeconds: () => Math.floor(process.uptime())
  });

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
  registerCrashRoutes(app, crashStore);

  // REST Authentication Endpoints
  registerAuthRoutes(app, userStore);

  // REST Scheduled Sessions and Session History Endpoints
  registerSessionRoutes(app, userStore);

  // REST Projects Endpoints
  let io: Server;
  registerProjectRoutes(app, {
    userStore,
    projectStore,
    getIo: () => io
  });

  io = new Server(app.server, {
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

  entitlementInterval = setInterval(() => {
    try {
      revalidateActiveSessions({
        rooms,
        userStore,
        projectStore,
        config,
        io
      });
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
          ensureRoomProjectAccess(projectStore, room);
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

  setupSocketServer(io, {
    config,
    customSocketLimits,
    rooms,
    userStore,
    projectStore,
    associateUserSocket,
    removeUserSocket,
    isShuttingDown: () => isShuttingDown
  });

  return { app, io, rooms, userStore, projectStore, crashStore, runtimeAdminToken, datastoreLock };
}
