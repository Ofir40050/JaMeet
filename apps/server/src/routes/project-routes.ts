import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Server } from 'socket.io';
import {
  createProjectRequestSchema,
  updateProjectRequestSchema,
  addCollaboratorRequestSchema,
  updateCollaboratorRoleRequestSchema,
  updateProjectWorkspaceRequestSchema,
  type UserProfile
} from '@jameet/shared';
import type { UserStore } from '../auth.js';
import {
  ProjectStore,
  WorkspaceConflictError,
  ProjectLimitError,
  WorkspaceLimitError
} from '../projects.js';
import { pruneStaleProjectSubscribers } from '../project-sync.js';
import type { SocketData } from '../types/socket.js';

export interface ProjectRoutesContext {
  userStore: UserStore;
  projectStore: ProjectStore;
  getIo: () => Server;
}

export function registerProjectRoutes(app: FastifyInstance, context: ProjectRoutesContext): void {
  const { userStore, projectStore, getIo } = context;

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

  const handleProjectUpdate = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
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
    const isOwner = projectStore.isOwner(request.params.id, user.id, user.username);
    if (!project && !isOwner) {
      return reply.code(404).send({ ok: false, message: 'Project not found.' });
    }
    if (!isOwner) {
      return reply.code(403).send({ ok: false, message: 'Only the project owner can delete this project.' });
    }
    try {
      const deleted = await projectStore.deleteProject(request.params.id, user.id, user.username);
      if (!deleted) {
        return reply.code(403).send({ ok: false, message: 'Only the project owner can delete this project.' });
      }
      return reply.send({ ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete project.';
      return reply.code(500).send({ ok: false, message: msg });
    }
  });

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
      const io = getIo();
      pruneStaleProjectSubscribers(io, userStore, projectStore, request.params.id);
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

  app.patch<{ Params: { id: string; userId: string } }>('/api/projects/:id/collaborators/:userId', async (request, reply) => {
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
      return reply.code(403).send({ ok: false, message: 'Only the project owner can change collaborator roles.' });
    }
    const parsed = updateCollaboratorRoleRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, message: 'Invalid role provided.' });
    }
    try {
      const updated = await projectStore.updateCollaboratorRole(request.params.id, user.id, request.params.userId, parsed.data.role);
      if (!updated) {
        return reply.code(403).send({ ok: false, message: 'Unauthorized to change collaborator role.' });
      }
      const io = getIo();
      pruneStaleProjectSubscribers(io, userStore, projectStore, request.params.id);
      io.to(`project:${request.params.id}`).emit('project:workspace:changed', {
        projectId: request.params.id,
        project: updated
      });
      return reply.send({ ok: true, project: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update collaborator role.';
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

      const io = getIo();
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
      pruneStaleProjectSubscribers(io, userStore, projectStore, projectId);

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

  const handleWorkspaceUpdate = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
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
      const io = getIo();
      // Broadcast real-time update to socket room
      pruneStaleProjectSubscribers(io, userStore, projectStore, request.params.id);
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
}
