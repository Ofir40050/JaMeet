import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Server } from 'socket.io';
import {
  createMeetingSchema, joinMeetingSchema, mediaUpdateSchema, meetingActionSchema,
  signalCandidateSchema, signalDescriptionSchema, registerRequestSchema, loginRequestSchema,
  guestAuthRequestSchema, updateProfileRequestSchema, createProjectRequestSchema, updateProjectRequestSchema,
  updateProjectWorkspaceRequestSchema, addCollaboratorRequestSchema, sendChatMessageSchema,
  admitParticipantSchema, lockMeetingSchema, removeParticipantSchema, createScheduledSessionSchema,
  updateScheduledSessionSchema, type MeetingAck, type MeetingErrorCode,
  type ParticipantIdentity, type MediaMetadata,
  type UserProfile, type UpdateProfileRequest, type ProjectWorkspace, type UpdateProjectWorkspaceRequest,
  type SessionChatMessage, type WaitingParticipantItem, type ScheduledSession,
  type SessionSummaryEvent, type ProjectActivityItem
} from '@musiczoom/shared';
import type { ServerConfig } from './config.js';
import { RoomStore } from './rooms.js';
import { UserStore } from './auth.js';
import { ProjectStore } from './projects.js';
import { createIceServers } from './turn.js';

type SocketData = { code?: string; participantId?: string; identity?: ParticipantIdentity; isWaiting?: boolean };

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
  } else if (act.type === 'task_deleted') {
    category = 'task';
    action = 'deleted';
    description = `Deleted task "${act.title}"`;
  } else if (act.type === 'lyrics_doc_created') {
    category = 'lyrics';
    action = 'created';
    description = `Created lyrics document "${act.title}"`;
  } else if (act.type === 'lyrics_edited') {
    category = 'lyrics';
    action = 'edited';
    description = `Updated Lyrics in "${act.title}"`;
  } else if (act.type === 'notes_edited') {
    category = 'note';
    action = 'edited';
    description = 'Updated Project Notes';
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

export async function createApp(config: ServerConfig) {
  const app = Fastify({ logger: config.NODE_ENV !== 'test', bodyLimit: 2_097_152 });
  const origins = config.ALLOWED_ORIGINS.split(',').map((value) => value.trim());
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const isAllowed =
        origins.includes(origin) ||
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        origin.startsWith('jameet-app://') ||
        origin.startsWith('musiczoom-app://');
      cb(null, isAllowed);
    },
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'X-Requested-With'],
    credentials: true
  });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  
  const userStore = new UserStore();
  const projectStore = new ProjectStore();
  const rooms = new RoomStore(config.DISCONNECT_GRACE_MS, config.EMPTY_ROOM_TTL_MS);

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/health', async () => ({ ok: true }));

  // REST Authentication Endpoints
  app.post('/api/auth/register', async (request, reply) => {
    const parsed = registerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, message: parsed.error.issues[0]?.message || 'Invalid registration data.' });
    }
    try {
      const result = await userStore.register(parsed.data);
      return reply.code(201).send({ ok: true, token: result.token, user: result.user });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed.';
      return reply.code(409).send({ ok: false, message: msg });
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, message: 'Please enter your username/email and password.' });
    }
    try {
      const result = await userStore.login(parsed.data);
      return reply.send({ ok: true, token: result.token, user: result.user });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid credentials.';
      return reply.code(401).send({ ok: false, message: msg });
    }
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
      const updatedUser = await userStore.updateProfile(user.id, parsed.data);
      return reply.send({ ok: true, user: updatedUser });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update profile.';
      return reply.code(400).send({ ok: false, message: msg });
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
    const session = userStore.createScheduledSession(user.id, parsed.data.title, parsed.data.scheduledAt);
    return reply.code(201).send({ ok: true, session });
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
    const session = userStore.updateScheduledSession(user.id, request.params.id, parsed.data);
    if (!session) {
      return reply.code(404).send({ ok: false, message: 'Scheduled session not found.' });
    }
    return reply.send({ ok: true, session });
  });

  app.delete<{ Params: { id: string } }>('/api/sessions/scheduled/:id', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized or session expired.' });
    }
    const deleted = userStore.deleteScheduledSession(user.id, request.params.id);
    if (!deleted) {
      return reply.code(404).send({ ok: false, message: 'Scheduled session not found.' });
    }
    return reply.send({ ok: true });
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

    const project = projectStore.createProject(user, parsed.data, initialCollaborators);
    return reply.code(201).send({ ok: true, project });
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
    const parsed = updateProjectRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, message: 'Invalid update parameters.' });
    }
    const updated = projectStore.updateProject(request.params.id, user.id, parsed.data);
    if (!updated) {
      return reply.code(404).send({ ok: false, message: 'Project not found or unauthorized.' });
    }
    return reply.send({ ok: true, project: updated });
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
    const deleted = projectStore.deleteProject(request.params.id, user.id);
    if (!deleted) {
      return reply.code(403).send({ ok: false, message: 'Only the project owner can delete this project.' });
    }
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/collaborators', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized.' });
    }
    const parsed = addCollaboratorRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, message: 'Please enter a username or email.' });
    }
    const targetUser = userStore.findByUsernameOrEmail(parsed.data.usernameOrEmail);
    if (!targetUser) {
      return reply.code(404).send({ ok: false, message: `No registered JaMeet user found matching "${parsed.data.usernameOrEmail}".` });
    }
    const updated = projectStore.addCollaborator(request.params.id, user.id, targetUser, parsed.data.role);
    if (!updated) {
      return reply.code(404).send({ ok: false, message: 'Project not found or unauthorized.' });
    }
    io.to(`project:${request.params.id}`).emit('project:activity:new', {
      projectId: request.params.id,
      activities: updated.activities
    });
    return reply.send({ ok: true, project: updated });
  });

  app.delete<{ Params: { id: string; userId: string } }>('/api/projects/:id/collaborators/:userId', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized.' });
    }
    const updated = projectStore.removeCollaborator(request.params.id, user.id, request.params.userId);
    if (!updated) {
      return reply.code(403).send({ ok: false, message: 'Unauthorized to remove collaborator.' });
    }
    io.to(`project:${request.params.id}`).emit('project:activity:new', {
      projectId: request.params.id,
      activities: updated.activities
    });
    return reply.send({ ok: true, project: updated });
  });

  const handleWorkspaceUpdate = async (request: Fastify.FastifyRequest<{ Params: { id: string } }>, reply: Fastify.FastifyReply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized.' });
    }
    const parsed = updateProjectWorkspaceRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, message: 'Invalid workspace update payload.' });
    }
    const updated = projectStore.updateWorkspace(request.params.id, user, parsed.data);
    if (!updated) {
      return reply.code(404).send({ ok: false, message: 'Project not found or unauthorized.' });
    }
    // Broadcast real-time update to socket room
    io.to(`project:${request.params.id}`).emit('project:workspace:synced', {
      projectId: request.params.id,
      workspace: updated.workspace,
      activities: updated.activities,
      updatedBy: user.id,
      updatedByName: user.displayName
    });
    return reply.send({ ok: true, project: updated, workspace: updated.workspace });
  };

  app.put<{ Params: { id: string } }>('/api/projects/:id/workspace', handleWorkspaceUpdate);
  app.patch<{ Params: { id: string } }>('/api/projects/:id/workspace', handleWorkspaceUpdate);

  const io = new Server(app.server, {
    cors: { origin: origins }, maxHttpBufferSize: 16_384, transports: ['websocket', 'polling']
  });

  function failure(code: MeetingErrorCode, message: string): MeetingAck {
    return { ok: false, code, message };
  }

  io.on('connection', (socket) => {
    const socketData = socket.data as SocketData;

    // Project Workspace Real-Time Collaborative Sync
    socket.on('project:workspace:join', (raw: { projectId: string; authToken?: string }, ack?: (res: { ok: boolean; workspace?: ProjectWorkspace; message?: string }) => void) => {
      if (!raw?.projectId) { ack?.({ ok: false, message: 'Invalid projectId' }); return; }
      const user = userStore.verifyToken(raw.authToken);
      if (!user || !projectStore.hasAccess(raw.projectId, user.id)) {
        ack?.({ ok: false, message: 'Unauthorized' });
        return;
      }
      void socket.join(`project:${raw.projectId}`);
      const project = projectStore.getProject(raw.projectId, user.id);
      ack?.({ ok: true, workspace: project?.workspace });
    });

    socket.on('project:workspace:leave', (raw: { projectId: string }) => {
      if (raw?.projectId) {
        void socket.leave(`project:${raw.projectId}`);
      }
    });

    socket.on('project:workspace:update', (raw: { projectId: string; authToken?: string; updates: UpdateProjectWorkspaceRequest }, ack?: (res: { ok: boolean; workspace?: ProjectWorkspace; message?: string }) => void) => {
      if (!raw?.projectId || !raw?.updates) { ack?.({ ok: false, message: 'Invalid payload' }); return; }
      const user = userStore.verifyToken(raw.authToken);
      if (!user || !projectStore.hasAccess(raw.projectId, user.id)) {
        ack?.({ ok: false, message: 'Unauthorized' });
        return;
      }
    const updated = projectStore.updateWorkspace(raw.projectId, user, raw.updates);
      if (!updated) {
        ack?.({ ok: false, message: 'Failed to update workspace' });
        return;
      }

      // If this mutation originated during an active session for this project, record the verified events
      if (socketData.code) {
        const room = rooms.rooms.get(socketData.code);
        if (room && room.projectId === raw.projectId) {
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
      socket.to(`project:${raw.projectId}`).emit('project:workspace:synced', {
        projectId: raw.projectId,
        workspace: updated.workspace,
        updatedBy: user.id,
        updatedByName: user.displayName
      });
      ack?.({ ok: true, workspace: updated.workspace });
    });

    socket.on('meeting:create', (raw, ack: (value: MeetingAck) => void) => {
      const parsed = createMeetingSchema.safeParse(raw);
      if (!parsed.success) return ack(failure('BAD_REQUEST', 'Invalid session request'));
      if (socketData.code) return ack(failure('BAD_REQUEST', 'Already in a session'));
      
      const identity = userStore.getTrustedIdentity(parsed.data.authToken, parsed.data.guestDisplayName, true);
      if (!identity.isGuest && identity.id) {
        userStore.incrementHostedCount(identity.id);
      }

      // Verify Project access if projectId provided by Host
      let verifiedProjectId: string | undefined = undefined;
      if (parsed.data.projectId && !identity.isGuest && identity.id) {
        if (projectStore.hasAccess(parsed.data.projectId, identity.id)) {
          verifiedProjectId = parsed.data.projectId;
        }
      }

      const room = rooms.create(parsed.data.participantId, socket.id, parsed.data.media, identity, verifiedProjectId, parsed.data.waitingRoomEnabled);
      if (!identity.isGuest && identity.id) {
        userStore.recordSessionStart(room.sessionId, room.code, identity.id, 'host', null);
      }

      if (room.projectId) {
        projectStore.recordProjectSession(room.projectId, {
          id: `${identity.id}_${room.code}`,
          code: room.code,
          startedAt: Date.now(),
          role: 'host',
          collaborator: null
        }, null);
      }

      Object.assign(socketData, { code: room.code, participantId: parsed.data.participantId, identity, isWaiting: false });
      void socket.join(room.code);

      ack({
        ok: true,
        code: room.code,
        role: 'host',
        locked: false,
        iceServers: createIceServers(config, parsed.data.participantId),
        peerPresent: false,
        identity,
        hostIdentity: identity,
        projectId: room.projectId || undefined
      });
    });

    socket.on('meeting:join', (raw, ack: (value: MeetingAck) => void) => {
      const parsed = joinMeetingSchema.safeParse(raw);
      if (!parsed.success) return ack(failure('BAD_REQUEST', 'Invalid session code or participant'));
      
      const identity = userStore.getTrustedIdentity(parsed.data.authToken, parsed.data.guestDisplayName, false);
      const joined = rooms.join(parsed.data.code, parsed.data.participantId, socket.id, parsed.data.media, identity);
      if (!joined.ok) {
        const message = joined.reason === 'ROOM_LOCKED'
          ? 'This session is currently locked by the host.'
          : joined.reason === 'ROOM_FULL'
            ? 'This session already has two people'
            : 'Session not found';
        return ack(failure(joined.reason, message));
      }

      if (joined.waiting) {
        Object.assign(socketData, { code: parsed.data.code, participantId: parsed.data.participantId, identity, isWaiting: true });
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
          identity,
          hostIdentity: joined.room.hostIdentity
        });
      }

      Object.assign(socketData, { code: parsed.data.code, participantId: parsed.data.participantId, identity, isWaiting: false });
      void socket.join(parsed.data.code);
      
      const peer = rooms.peer(joined.room, parsed.data.participantId);
      if (peer) {
        userStore.recordCollaboratorJoined(joined.room.sessionId, parsed.data.code, joined.room.hostIdentity, identity);
        if (joined.room.projectId) {
          projectStore.recordProjectSession(joined.room.projectId, {
            id: `${joined.room.hostIdentity.id}_${parsed.data.code}`,
            code: parsed.data.code,
            startedAt: Date.now(),
            role: 'host',
            collaborator: {
              id: identity.isGuest ? undefined : identity.id,
              displayName: identity.displayName,
              username: identity.username,
              isGuest: identity.isGuest,
              avatarColor: identity.avatarColor
            }
          }, identity);
        }
      } else if (!identity.isGuest && identity.id) {
        userStore.recordSessionStart(joined.room.sessionId, parsed.data.code, identity.id, 'participant', joined.room.hostIdentity);
      }

      ack({
        ok: true,
        code: parsed.data.code,
        role: joined.participant.role,
        locked: Boolean(joined.room.isLocked),
        iceServers: createIceServers(config, parsed.data.participantId),
        peerPresent: Boolean(peer?.socketId),
        peerMedia: peer?.media,
        peerParticipantId: peer?.id,
        identity,
        hostIdentity: joined.room.hostIdentity,
        peerIdentity: peer?.identity,
        projectId: joined.room.projectId || undefined
      });

      if (peer?.socketId) {
        io.to(peer.socketId).emit('peer:ready', {
          media: joined.participant.media,
          identity: joined.participant.identity,
          participantId: joined.participant.id,
          reconnected: joined.reconnected
        });
        io.to(peer.socketId).emit('peer:joined', {
          peerMedia: joined.participant.media,
          identity
        });
      }
    });

    const handleAdmit = (raw: unknown, ack?: (res: { ok: boolean; message?: string }) => void) => {
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
      if (!hostParticipant || hostParticipant.role !== 'host') {
        ack?.({ ok: false, message: 'Only host can admit participants' });
        return;
      }
      const waiting = room.waitingParticipants.get(parsed.data.participantId);
      if (!waiting) {
        ack?.({ ok: false, message: 'Participant is no longer in waiting room' });
        return;
      }
      const admitted = rooms.admit(parsed.data.code, parsed.data.participantId);
      if (!admitted.ok) {
        ack?.({ ok: false, message: admitted.reason === 'ROOM_FULL' ? 'Session is already full' : 'Failed to admit' });
        return;
      }

      userStore.recordCollaboratorJoined(admitted.room.sessionId, admitted.room.code, admitted.room.hostIdentity, admitted.participant.identity);
      if (admitted.room.projectId) {
        projectStore.recordProjectSession(admitted.room.projectId, {
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
          projectId: admitted.room.projectId || undefined
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
    };

    socket.on('meeting:admit', handleAdmit);
    socket.on('waiting:admit', handleAdmit);

    socket.on('meeting:lock', (raw, ack?: (res: { ok: boolean; locked?: boolean; message?: string }) => void) => {
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
      if (!hostParticipant || hostParticipant.role !== 'host') {
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
      if (!hostParticipant || hostParticipant.role !== 'host') {
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
      const parsed = signalDescriptionSchema.safeParse(raw);
      if (!parsed.success || parsed.data.code !== socketData.code || !socketData.participantId || socketData.isWaiting) return;
      const room = rooms.rooms.get(parsed.data.code);
      const participant = room?.participants.get(socketData.participantId);
      if (!room || !participant) return;
      const peer = rooms.peer(room, participant.id);
      if (peer?.socketId) io.to(peer.socketId).emit('signal:description', parsed.data.description);
    });

    socket.on('signal:candidate', (raw) => {
      const parsed = signalCandidateSchema.safeParse(raw);
      if (!parsed.success || parsed.data.code !== socketData.code || !socketData.participantId || socketData.isWaiting) return;
      const room = rooms.rooms.get(parsed.data.code);
      const participant = room?.participants.get(socketData.participantId);
      if (!room || !participant) return;
      const peer = rooms.peer(room, participant.id);
      if (peer?.socketId) io.to(peer.socketId).emit('signal:candidate', parsed.data.candidate);
    });

    socket.on('meeting:action', (raw) => {
      const parsed = meetingActionSchema.safeParse(raw);
      if (!parsed.success || parsed.data.code !== socketData.code || !socketData.participantId || socketData.isWaiting) return;
      const room = rooms.rooms.get(parsed.data.code);
      const participant = room?.participants.get(socketData.participantId);
      if (!room || !participant) return;
      const peer = rooms.peer(room, participant.id);
      if (peer?.socketId) io.to(peer.socketId).emit('meeting:action', parsed.data.action);
    });

    socket.on('media:update', (raw) => {
      const parsed = mediaUpdateSchema.safeParse(raw);
      if (!parsed.success || parsed.data.code !== socketData.code || !socketData.participantId || socketData.isWaiting) return;
      const room = rooms.rooms.get(parsed.data.code);
      const participant = room?.participants.get(socketData.participantId);
      if (!room || !participant) return;
      participant.media = parsed.data.media;
      const peer = rooms.peer(room, participant.id);
      if (peer?.socketId) io.to(peer.socketId).emit('media:update', parsed.data.media);
    });

    socket.on('chat:send', (raw, ack?: (res: { ok: boolean; message?: SessionChatMessage; error?: string }) => void) => {
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
      rooms.incrementChat(parsed.data.code);
      const participant = room.participants.get(socketData.participantId);
      const senderName = socketData.identity?.displayName || participant?.identity.displayName || 'Musician';
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
      if (isWaiting) {
        rooms.removeWaiting(code, participantId);
        const room = rooms.rooms.get(code);
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
        delete socketData.code;
        delete socketData.participantId;
        delete socketData.identity;
        delete socketData.isWaiting;
        return;
      }
      if (explicit) {
        const roomBefore = rooms.rooms.get(code);
        const result = rooms.leave(code, participantId);
        if (result?.role === 'host' && roomBefore) {
          const project = roomBefore.projectId && roomBefore.hostIdentity.id
            ? projectStore.getProject(roomBefore.projectId, roomBefore.hostIdentity.id)
            : null;
          userStore.recordSessionClose(roomBefore.sessionId, {
            code: roomBefore.code,
            startedAt: roomBefore.startedAt,
            allJoinedParticipants: roomBefore.allJoinedParticipants,
            chatMessagesCount: roomBefore.chatMessagesCount || 0,
            events: roomBefore.events || [],
            projectId: roomBefore.projectId,
            projectName: project?.name
          });
        }
        if (result?.peer?.socketId) io.to(result.peer.socketId).emit(result.role === 'host' ? 'meeting:ended' : 'peer:left');
        delete socketData.code;
        delete socketData.participantId;
        delete socketData.identity;
        void socket.leave(code);
      } else {
        const room = rooms.rooms.get(code);
        const peer = room && rooms.peer(room, participantId);
        if (peer?.socketId) io.to(peer.socketId).emit('peer:disconnected');
        rooms.disconnect(code, participantId, (role, expiredPeer) => {
          if (role === 'host' && room) {
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
          }
          if (expiredPeer?.socketId) io.to(expiredPeer.socketId).emit(role === 'host' ? 'meeting:ended' : 'peer:left');
        });
      }
    };
    socket.on('meeting:leave', () => leave(true));
    socket.on('disconnect', () => leave(false));
  });

  return { app, io, rooms, userStore, projectStore };
}

