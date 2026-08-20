import type { Server } from 'socket.io';
import type { ServerConfig } from '../config.js';
import type { RoomStore } from '../rooms.js';
import type { UserStore } from '../auth.js';
import type { ProjectStore } from '../projects.js';
import { SocketRateLimiter, type RateLimitCategory, type RateLimitConfig } from '../rate-limiter.js';
import type { SocketData } from '../types/socket.js';
import { registerProjectSocketHandlers } from './project-handlers.js';
import { registerMeetingSocketHandlers } from './meeting-handlers.js';

export interface SocketServerContext {
  config: ServerConfig;
  customSocketLimits?: Partial<Record<RateLimitCategory, RateLimitConfig>>;
  rooms: RoomStore;
  userStore: UserStore;
  projectStore: ProjectStore;
  associateUserSocket: (userId: string, socketId: string) => void;
  removeUserSocket: (socketId: string) => void;
  isShuttingDown: () => boolean;
}

export function setupSocketServer(io: Server, context: SocketServerContext): void {
  const {
    config,
    customSocketLimits,
    rooms,
    userStore,
    projectStore,
    associateUserSocket,
    removeUserSocket,
    isShuttingDown
  } = context;

  io.on('connection', (socket) => {
    const limiter = new SocketRateLimiter(customSocketLimits);
    const socketData = socket.data as SocketData;
    socketData.limiter = limiter;

    registerProjectSocketHandlers(socket, {
      io,
      userStore,
      projectStore,
      rooms,
      associateUserSocket,
      limiter,
      socketData
    });

    registerMeetingSocketHandlers(socket, {
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
    });
  });
}
