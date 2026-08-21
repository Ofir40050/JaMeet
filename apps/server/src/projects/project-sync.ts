import type { Server } from 'socket.io';
import type { Room } from '../rooms/rooms.js';
import type { UserStore } from '../auth/auth.js';
import type { ProjectStore } from './projects.js';
import type { SocketData } from '../types/socket.js';

export function pruneStaleProjectSubscribers(
  io: Server,
  userStore: UserStore,
  projectStore: ProjectStore,
  projectId: string
): void {
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

export function ensureRoomProjectAccess(projectStore: ProjectStore, room: Room): boolean {
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

export async function finalizeProjectSessionOnClose(projectStore: ProjectStore, room: Room): Promise<void> {
  if (!room.projectId) return;
  try {
    const now = Date.now();
    const durationSeconds = Math.max(1, Math.round((now - room.startedAt) / 1000));
    const participantsList = Array.from(room.allJoinedParticipants.values());
    const otherParticipant = participantsList.find((p) => p.displayName !== room.hostIdentity.displayName);
    const project = room.hostIdentity.id ? projectStore.getProject(room.projectId, room.hostIdentity.id) : null;
    const sessionSummary = {
      id: `sum_${room.sessionId}`,
      sessionId: room.sessionId,
      code: room.code,
      startedAt: room.startedAt,
      endedAt: now,
      durationSeconds,
      role: 'host' as const,
      participants: participantsList.map((p) => ({
        id: p.id || '',
        displayName: p.displayName,
        username: p.username,
        avatarColor: p.avatarColor,
        isGuest: p.isGuest,
        isHost: p.isHost,
        role: p.isHost ? 'host' as const : 'collaborator' as const
      })),
      projectId: room.projectId,
      projectName: project?.name,
      events: room.events || [],
      chatMessagesCount: room.chatMessagesCount || 0
    };
    await projectStore.recordProjectSession(room.projectId, {
      id: `${room.hostIdentity.id}_${room.code}`,
      code: room.code,
      startedAt: room.startedAt,
      endedAt: now,
      durationSeconds,
      role: 'host',
      collaborator: otherParticipant ? {
        displayName: otherParticipant.displayName,
        username: otherParticipant.username,
        isGuest: otherParticipant.isGuest,
        avatarColor: otherParticipant.avatarColor
      } : null,
      summary: sessionSummary
    }, null);
  } catch (err) {
    console.error('Failed to finalize project session on close:', err);
  }
}
