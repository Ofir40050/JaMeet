import type { Socket, Server } from 'socket.io';
import {
  updateProjectWorkspaceRequestSchema,
  type ProjectWorkspace,
  type UpdateProjectWorkspaceResponse
} from '@jameet/shared';
import type { UserStore } from '../auth/auth.js';
import {
  ProjectStore,
  WorkspaceConflictError,
  WorkspaceLimitError
} from '../projects/projects.js';
import type { RoomStore } from '../rooms/rooms.js';
import type { SocketData, ProjectSubscription } from '../types/socket.js';
import type { SocketRateLimiter } from '../core/rate-limiter.js';
import { mapActivityToSessionSummaryEvent } from '../rooms/session-summary.js';
import { pruneStaleProjectSubscribers, ensureRoomProjectAccess } from '../projects/project-sync.js';

export interface ProjectSocketContext {
  io: Server;
  userStore: UserStore;
  projectStore: ProjectStore;
  rooms: RoomStore;
  associateUserSocket: (userId: string, socketId: string) => void;
  limiter: SocketRateLimiter;
  socketData: SocketData;
}

export function registerProjectSocketHandlers(socket: Socket, context: ProjectSocketContext): void {
  const { io, userStore, projectStore, rooms, associateUserSocket, limiter, socketData } = context;

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
    associateUserSocket(user.id, socket.id);
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
      if (room && ensureRoomProjectAccess(projectStore, room) && room.projectId === raw.projectId) {
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
    pruneStaleProjectSubscribers(io, userStore, projectStore, raw.projectId);
    socket.to(`project:${raw.projectId}`).emit('project:workspace:synced', {
      projectId: raw.projectId,
      workspace: updated.workspace,
      activities: updated.activities,
      project: updated,
      updatedBy: user.id,
      updatedByName: user.displayName
    });
    ack?.({ ok: true, workspace: updated.workspace, project: updated });
  });
}
