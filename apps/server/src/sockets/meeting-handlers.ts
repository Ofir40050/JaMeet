import { randomUUID } from 'node:crypto';
import type { Socket, Server } from 'socket.io';
import {
  createMeetingSchema,
  joinMeetingSchema,
  mediaUpdateSchema,
  meetingActionSchema,
  signalCandidateSchema,
  signalDescriptionSchema,
  signalRenegotiateSchema,
  sendChatMessageSchema,
  admitParticipantSchema,
  lockMeetingSchema,
  removeParticipantSchema,
  type MeetingAck,
  type MeetingErrorCode,
  type SessionChatMessage
} from '@jameet/shared';
import type { ServerConfig } from '../config.js';
import type { RoomStore, Room } from '../rooms.js';
import { UserStore, authorizeSessionAccess, validateStoredUserSessionAccess } from '../auth.js';
import type { ProjectStore } from '../projects.js';
import { createIceServers } from '../turn.js';
import type { SocketRateLimiter } from '../rate-limiter.js';
import type { SocketData } from '../types/socket.js';
import { logger } from '../logger.js';
import { ensureRoomProjectAccess, finalizeProjectSessionOnClose } from '../project-sync.js';
import {
  endRoomDueToAccessLoss,
  removeParticipantDueToAccessLoss,
  type SessionLifecycleContext
} from '../session-lifecycle.js';

export interface MeetingSocketContext {
  io: Server;
  config: ServerConfig;
  rooms: RoomStore;
  userStore: UserStore;
  projectStore: ProjectStore;
  associateUserSocket: (userId: string, socketId: string) => void;
  removeUserSocket: (socketId: string) => void;
  limiter: SocketRateLimiter;
  socketData: SocketData;
  isShuttingDown: () => boolean;
}

function failure(code: MeetingErrorCode, message: string): MeetingAck {
  return { ok: false, code, message };
}

export function registerMeetingSocketHandlers(socket: Socket, context: MeetingSocketContext): void {
  const {
    io,
    config,
    rooms,
    userStore,
    projectStore,
    associateUserSocket,
    removeUserSocket,
    limiter,
    socketData,
    isShuttingDown
  } = context;

  const lifecycleContext: SessionLifecycleContext = {
    rooms,
    userStore,
    projectStore,
    config,
    io
  };

  const enforceSocketSessionAccess = (): boolean => {
    if (socketData.code && socketData.participantId && socketData.identity && !socketData.identity.isGuest && socketData.identity.id) {
      const room = rooms.rooms.get(socketData.code);
      if (room) {
        const isHost = socketData.identity.id === room.hostIdentity.id;
        const participant = room.participants.get(socketData.participantId) || room.waitingParticipants.get(socketData.participantId);
        const authCheck = validateStoredUserSessionAccess(userStore, socketData.identity.id, config, isHost, Date.now(), participant?.authToken);
        if (!authCheck.ok) {
          if (isHost) {
            endRoomDueToAccessLoss(lifecycleContext, room, authCheck.message);
          } else {
            if (participant && room.participants.has(participant.id)) {
              removeParticipantDueToAccessLoss(lifecycleContext, room, participant, authCheck.message);
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

  socket.on('meeting:create', async (raw, ack: (value: MeetingAck) => void) => {
    if (!limiter.consume('session')) return ack(failure('BAD_REQUEST', 'Too many requests. Please slow down.'));
    const parsed = createMeetingSchema.safeParse(raw);
    if (!parsed.success) return ack(failure('BAD_REQUEST', 'Invalid session request'));
    if (socketData.code) {
      try {
        if (socketData.participantId) rooms.leave(socketData.code, socketData.participantId);
        void socket.leave(socketData.code);
      } catch { /* ignore */ }
      delete socketData.code;
      delete socketData.participantId;
      delete socketData.identity;
      delete socketData.isWaiting;
    }
    
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
        associateUserSocket(identity.id, socket.id);
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
        userStore.incrementHostedCount(identity.id, createdRoom.code);
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
    if (socketData.code) {
      try {
        if (socketData.participantId) rooms.leave(socketData.code, socketData.participantId);
        void socket.leave(socketData.code);
      } catch { /* ignore */ }
      delete socketData.code;
      delete socketData.participantId;
      delete socketData.identity;
      delete socketData.isWaiting;
    }
    
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

    if (!identity.isGuest && identity.id) {
      associateUserSocket(identity.id, socket.id);
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
          if (ensureRoomProjectAccess(projectStore, joined.room)) {
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
      if (ensureRoomProjectAccess(projectStore, admitted.room)) {
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
      ensureRoomProjectAccess(projectStore, room);
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
    const { code, participantId, isWaiting: isSocketWaiting } = socketData;
    if (!code || !participantId) return;
    if (isShuttingDown()) {
      delete socketData.code;
      delete socketData.participantId;
      delete socketData.identity;
      delete socketData.isWaiting;
      return;
    }
    if (isSocketWaiting) {
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
        ensureRoomProjectAccess(projectStore, roomBefore);
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
            void finalizeProjectSessionOnClose(projectStore, roomBefore);
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
          ensureRoomProjectAccess(projectStore, currentRoom);
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
              void finalizeProjectSessionOnClose(projectStore, currentRoom);
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

  socket.on('meeting:leave', () => {
    removeUserSocket(socket.id);
    leave(true);
  });

  socket.on('disconnect', () => {
    removeUserSocket(socket.id);
    leave(false);
  });
}
