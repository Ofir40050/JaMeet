import type { RoomStore } from './rooms.js';

export interface PresenceState {
  authenticatedUserSockets: Map<string, Set<string>>;
  socketToUser: Map<string, string>;
  associateUserSocket: (userId: string, socketId: string) => void;
  removeUserSocket: (socketId: string) => void;
  getOnlineUserIds: () => Set<string>;
  isUserOnline: (userId: string) => boolean;
}

export function createPresenceState(): PresenceState {
  const authenticatedUserSockets = new Map<string, Set<string>>(); // userId -> Set<socketId>
  const socketToUser = new Map<string, string>(); // socketId -> userId

  const associateUserSocket = (userId: string, socketId: string): void => {
    if (!userId || !socketId) return;
    let sockets = authenticatedUserSockets.get(userId);
    if (!sockets) {
      sockets = new Set();
      authenticatedUserSockets.set(userId, sockets);
    }
    sockets.add(socketId);
    socketToUser.set(socketId, userId);
  };

  const removeUserSocket = (socketId: string): void => {
    const userId = socketToUser.get(socketId);
    if (userId) {
      socketToUser.delete(socketId);
      const sockets = authenticatedUserSockets.get(userId);
      if (sockets) {
        sockets.delete(socketId);
        if (sockets.size === 0) {
          authenticatedUserSockets.delete(userId);
        }
      }
    }
  };

  const getOnlineUserIds = (): Set<string> => new Set(authenticatedUserSockets.keys());
  const isUserOnline = (userId: string): boolean => (authenticatedUserSockets.get(userId)?.size ?? 0) > 0;

  return {
    authenticatedUserSockets,
    socketToUser,
    associateUserSocket,
    removeUserSocket,
    getOnlineUserIds,
    isUserOnline
  };
}

export function getActiveRoomsCount(rooms: RoomStore, now: number = Date.now()): number {
  let count = 0;
  for (const r of rooms.rooms.values()) {
    if (rooms.isExpired(r, now)) continue;
    let connectedAdmittedCount = 0;
    for (const p of r.participants.values()) {
      if (p.socketId !== null) {
        connectedAdmittedCount++;
      }
    }
    if (connectedAdmittedCount >= 2) {
      count++;
    }
  }
  return count;
}
