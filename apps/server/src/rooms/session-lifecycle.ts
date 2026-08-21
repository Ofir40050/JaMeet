import type { Server } from 'socket.io';
import type { ServerConfig } from '../core/config.js';
import type { RoomStore, Room, Participant } from './rooms.js';
import { UserStore, validateStoredUserSessionAccess } from '../auth/auth.js';
import type { ProjectStore } from '../projects/projects.js';
import type { SocketData } from '../types/socket.js';
import { ensureRoomProjectAccess, finalizeProjectSessionOnClose } from '../projects/project-sync.js';

export interface SessionLifecycleContext {
  rooms: RoomStore;
  userStore: UserStore;
  projectStore: ProjectStore;
  config: ServerConfig;
  io: Server;
}

export function endRoomDueToAccessLoss(context: SessionLifecycleContext, room: Room, reason: string): void {
  const { rooms, userStore, projectStore, io } = context;
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
    });
    void finalizeProjectSessionOnClose(projectStore, room);
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

export function removeParticipantDueToAccessLoss(
  context: SessionLifecycleContext,
  room: Room,
  participant: Participant,
  reason: string
): void {
  const { rooms, userStore, projectStore, io } = context;
  if (participant.timer) clearTimeout(participant.timer);
  rooms.removeParticipant(room.code, participant.id);

  if (!participant.identity.isGuest && participant.identity.id) {
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

export function revalidateActiveSessions(context: SessionLifecycleContext, now: number = Date.now()): void {
  const { rooms, userStore, projectStore, config, io } = context;
  for (const room of Array.from(rooms.rooms.values())) {
    if (rooms.isExpired(room, now)) {
      rooms.close(room.code);
      continue;
    }
    ensureRoomProjectAccess(projectStore, room);

    // 1. Validate host access
    if (!room.hostIdentity.isGuest && room.hostIdentity.id) {
      const hostParticipant = Array.from(room.participants.values()).find((p) => p.role === 'host');
      const hostAuth = validateStoredUserSessionAccess(userStore, room.hostIdentity.id, config, true, now, hostParticipant?.authToken);
      if (!hostAuth.ok) {
        endRoomDueToAccessLoss(context, room, hostAuth.message);
        continue;
      }
    }

    // 2. Validate non-host active participants
    for (const participant of Array.from(room.participants.values())) {
      if (participant.role === 'host') continue;
      if (!participant.identity.isGuest && participant.identity.id) {
        const partAuth = validateStoredUserSessionAccess(userStore, participant.identity.id, config, false, now, participant.authToken);
        if (!partAuth.ok) {
          removeParticipantDueToAccessLoss(context, room, participant, partAuth.message);
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
