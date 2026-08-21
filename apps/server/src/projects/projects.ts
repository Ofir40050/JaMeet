import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  type Project,
  type ProjectCollaborator,
  type ProjectCollaboratorRole,
  type ProjectRole,
  type ProjectSessionItem,
  type ProjectActivityItem,
  type ProjectActivityType,
  type CreateProjectRequest,
  type UpdateProjectRequest,
  type UpdateProjectWorkspaceRequest,
  type UserProfile,
  type ParticipantIdentity
} from '@jameet/shared';
import type { UserStore } from '../auth/auth.js';

import {
  WorkspaceConflictError,
  ProjectLimitError,
  WorkspaceLimitError
} from './errors.js';
import { PROJECT_LIMITS } from './limits.js';

export {
  WorkspaceConflictError,
  ProjectLimitError,
  WorkspaceLimitError
};
export { PROJECT_LIMITS };
export { type ProjectDatabaseSchema } from './types.js';
import {
  enrichUserAvatars,
  normalizeLoadedProject
} from './normalization.js';
import {
  loadProjectsFromDisk,
  resolveProjectPath,
  persistProjectToDisk,
  deleteProjectFromDisk,
  createProjectSnapshot,
  restoreProjectSnapshot
} from './storage.js';
import { recordProjectActivity } from './activities.js';
import { applyWorkspaceUpdates } from './workspace.js';
import {
  addProjectCollaborator,
  updateProjectCollaboratorRole,
  removeProjectCollaborator
} from './collaborators.js';
import { recordProjectSessionItem } from './sessions.js';

export class ProjectStore {
  private projects = new Map<string, Project>(); // projectId -> Project
  private baseDir: string;
  private projectsDir: string;
  private dataFilePath: string;
  private projectQueues = new Map<string, Promise<void>>();
  private ownerQueues = new Map<string, Promise<void>>();
  private userStore?: UserStore;

  constructor(storageDir?: string, userStore?: UserStore) {
    this.userStore = userStore;
    const baseDir = storageDir ?? path.join(process.cwd(), 'data');
    this.baseDir = baseDir;
    this.projectsDir = path.join(baseDir, 'projects');
    if (!fs.existsSync(baseDir)) {
      try { fs.mkdirSync(baseDir, { recursive: true }); } catch { /* ignore */ }
    }
    const legacyPath = path.join(baseDir, 'musiczoom-projects.json');
    const primaryPath = path.join(baseDir, 'jameet-projects.json');
    this.dataFilePath = !fs.existsSync(primaryPath) && fs.existsSync(legacyPath) ? legacyPath : primaryPath;
    this.loadFromDisk();
  }

  public enrichUserAvatars(project: Project): Project {
    return enrichUserAvatars(project, this.userStore);
  }

  private normalizeLoadedProject(p: Project): void {
    normalizeLoadedProject(p);
  }

  private loadFromDisk(): void {
    loadProjectsFromDisk({
      dataFilePath: this.dataFilePath,
      projectsDir: this.projectsDir,
      projects: this.projects
    });
  }

  private getProjectPath(projectId: string): string {
    return resolveProjectPath(
      { dataFilePath: this.dataFilePath, projectsDir: this.projectsDir },
      projectId
    );
  }

  private async persistProject(project: Project): Promise<void> {
    return persistProjectToDisk(
      { dataFilePath: this.dataFilePath, projectsDir: this.projectsDir },
      project
    );
  }

  private async deleteProjectFromDisk(projectId: string): Promise<void> {
    return deleteProjectFromDisk(
      { dataFilePath: this.dataFilePath, projectsDir: this.projectsDir },
      projectId
    );
  }

  private runProjectTransaction<T>(projectId: string, task: () => Promise<T>): Promise<T> {
    const queue = this.projectQueues.get(projectId) || Promise.resolve();
    const nextTask = queue.catch(() => {}).then(() => task());
    const tailPromise: Promise<void> = nextTask.then(() => {}, () => {});
    this.projectQueues.set(projectId, tailPromise);
    tailPromise.then(() => {
      if (this.projectQueues.get(projectId) === tailPromise) {
        this.projectQueues.delete(projectId);
      }
    });
    return nextTask;
  }

  private runOwnerTransaction<T>(ownerId: string, task: () => Promise<T>): Promise<T> {
    const queue = this.ownerQueues.get(ownerId) || Promise.resolve();
    const nextTask = queue.catch(() => {}).then(() => task());
    const tailPromise: Promise<void> = nextTask.then(() => {}, () => {});
    this.ownerQueues.set(ownerId, tailPromise);
    tailPromise.then(() => {
      if (this.ownerQueues.get(ownerId) === tailPromise) {
        this.ownerQueues.delete(ownerId);
      }
    });
    return nextTask;
  }

  createSnapshot(projectId?: string): string {
    return createProjectSnapshot(this.projects, projectId);
  }

  async restoreSnapshot(snapshotJson: string): Promise<void> {
    return restoreProjectSnapshot(
      {
        projects: this.projects,
        persistProject: (project: Project) => this.persistProject(project),
        deleteProjectFromDisk: (projectId: string) => this.deleteProjectFromDisk(projectId),
        runProjectTransaction: <T>(projectId: string, task: () => Promise<T>) =>
          this.runProjectTransaction(projectId, task)
      },
      snapshotJson
    );
  }

  listProjects(userId: string, includeArchived = false): Project[] {
    const results: Project[] = [];
    for (const project of this.projects.values()) {
      const isOwner = project.ownerId === userId;
      const isCollaborator = project.collaborators.some((c) => c.userId === userId);
      if (isOwner || isCollaborator) {
        if (!includeArchived && project.archived) continue;
        results.push(this.enrichUserAvatars(project));
      }
    }
    // Sort by last activity descending
    return results.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  getProject(projectId: string, userId: string): Project | null {
    const project = this.projects.get(projectId);
    if (!project) return null;
    const isOwner = project.ownerId === userId;
    const isCollaborator = project.collaborators.some((c) => c.userId === userId);
    if (!isOwner && !isCollaborator) return null;
    return this.enrichUserAvatars(project);
  }

  hasAccess(projectId: string, userId: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;
    return project.ownerId === userId || project.collaborators.some((c) => c.userId === userId);
  }

  getUserRole(projectId: string, userId: string): ProjectRole | null {
    const project = this.projects.get(projectId);
    if (!project) return null;
    if (project.ownerId === userId) return 'owner';
    const collab = project.collaborators.find((c) => c.userId === userId);
    if (collab) {
      if ((collab.role as string) === 'owner') return 'collaborator';
      return collab.role || 'collaborator';
    }
    return null;
  }

  isOwner(projectId: string, userId: string, username?: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;
    if (project.ownerId === userId) return true;
    if (username && project.ownerUsername?.toLowerCase() === username.toLowerCase()) return true;
    if (this.userStore) {
      const u = this.userStore.getStoredUser(userId);
      if (u && project.ownerUsername?.toLowerCase() === u.username?.toLowerCase()) return true;
      const ownerU = this.userStore.getStoredUser(project.ownerId);
      if (ownerU && u && ownerU.id === u.id) return true;
    }
    return false;
  }

  canModifyWorkspace(projectId: string, userId: string): boolean {
    const role = this.getUserRole(projectId, userId);
    return role === 'owner' || role === 'editor' || role === 'collaborator';
  }

  canModifyProject(projectId: string, userId: string): boolean {
    const role = this.getUserRole(projectId, userId);
    return role === 'owner' || role === 'editor' || role === 'collaborator';
  }

  async createProject(
    owner: UserProfile,
    data: CreateProjectRequest,
    collaboratorUsers: UserProfile[] = []
  ): Promise<Project> {
    return this.runOwnerTransaction(owner.id, async () => {
      const ownedProjectsCount = Array.from(this.projects.values()).filter(
        (p) => p.ownerId === owner.id
      ).length;
      if (ownedProjectsCount >= PROJECT_LIMITS.MAX_PROJECTS_PER_OWNER) {
        throw new ProjectLimitError(
          `Maximum project limit reached (${PROJECT_LIMITS.MAX_PROJECTS_PER_OWNER} projects per account).`
        );
      }
      if (collaboratorUsers.length > PROJECT_LIMITS.MAX_COLLABORATORS_PER_PROJECT) {
        throw new ProjectLimitError(
          `Cannot add more than ${PROJECT_LIMITS.MAX_COLLABORATORS_PER_PROJECT} initial collaborators.`
        );
      }

      const now = Date.now();
      const id = `proj_${crypto.randomUUID()}`;

      const collaborators: ProjectCollaborator[] = collaboratorUsers
        .filter((c) => c.id !== owner.id)
        .map((c) => ({
          userId: c.id,
          displayName: c.displayName,
          username: c.username,
          avatarColor: c.avatarColor || '#06b6d4',
          role: 'collaborator' as const,
          addedAt: now
        }));

      const project: Project = {
        id,
        name: data.name.trim(),
        description: data.description?.trim(),
        ownerId: owner.id,
        ownerDisplayName: owner.displayName,
        ownerUsername: owner.username,
        ownerAvatarColor: owner.avatarColor || '#06b6d4',
        ownerAvatarUrl: owner.avatarUrl,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
        archived: false,
        collaborators,
        sessions: [],
        sessionCount: 0,
        activities: [],
        workspace: {
          activeSongId: 'song-1',
          songs: [
            {
              id: 'song-1',
              title: data.name.trim(),
              order: 0,
              lyrics: {
                revision: 1,
                activeDocumentId: 'doc-main',
                documents: [
                  {
                    id: 'doc-main',
                    title: 'Main Lyrics',
                    content: '',
                    updatedAt: now,
                    updatedBy: owner.id,
                    updatedByName: owner.displayName
                  }
                ],
                content: '',
                updatedAt: now
              },
              notes: { revision: 1, content: '', updatedAt: now },
              structure: { revision: 1, sections: [], updatedAt: now },
              createdAt: now,
              updatedAt: now
            }
          ],
          lyrics: {
            revision: 1,
            activeDocumentId: 'doc-main',
            documents: [
              {
                id: 'doc-main',
                title: 'Main Lyrics',
                content: '',
                updatedAt: now,
                updatedBy: owner.id,
                updatedByName: owner.displayName
              }
            ],
            content: '',
            updatedAt: now
          },
          notes: { revision: 1, content: '', updatedAt: now },
          structure: { revision: 1, sections: [], updatedAt: now },
          tasks: { revision: 1, tasks: [], updatedAt: now }
        }
      };

      return this.runProjectTransaction(id, async () => {
        this.projects.set(id, project);
        await this.recordActivity(
          id,
          owner,
          'project_created',
          `${owner.displayName} created project "${project.name}"`,
          project.name,
          undefined,
          false
        );
        try {
          await this.persistProject(project);
        } catch (err) {
          this.projects.delete(id);
          throw err;
        }
        return JSON.parse(JSON.stringify(project)) as Project;
      });
    });
  }

  async recordActivity(
    projectId: string,
    user: { id?: string; displayName?: string; username?: string; avatarColor?: string; avatarUrl?: string },
    type: ProjectActivityType,
    summary: string,
    title?: string,
    metadata?: Record<string, unknown>,
    persist = true
  ): Promise<ProjectActivityItem | null> {
    return recordProjectActivity(
      {
        projects: this.projects,
        persistProject: (project: Project) => this.persistProject(project)
      },
      projectId,
      user,
      type,
      summary,
      title,
      metadata,
      persist
    );
  }

  async updateWorkspace(
    projectId: string,
    user: UserProfile,
    updates: UpdateProjectWorkspaceRequest
  ): Promise<Project | null> {
    return this.runProjectTransaction(projectId, async () => {
      const project = this.getProject(projectId, user.id);
      if (!project) return null;

      if (!this.canModifyWorkspace(projectId, user.id)) {
        return null;
      }

      const snapshot = JSON.parse(JSON.stringify(project)) as Project;
      const { changed } = applyWorkspaceUpdates({
        project,
        user,
        updates,
        recordActivity: (pId, u, type, summary, title, metadata, persist) =>
          this.recordActivity(pId, u, type, summary, title, metadata, persist)
      });

      if (changed) {
        const now = Date.now();
        project.updatedAt = now;
        project.lastActivityAt = now;
        try {
          await this.persistProject(project);
        } catch (err) {
          this.projects.set(projectId, snapshot);
          throw err;
        }
      }

      return JSON.parse(JSON.stringify(this.enrichUserAvatars(project))) as Project;
    });
  }

  async updateProject(projectId: string, userId: string, data: UpdateProjectRequest): Promise<Project | null> {
    return this.runProjectTransaction(projectId, async () => {
      const project = this.getProject(projectId, userId);
      if (!project) return null;

      if (!this.canModifyProject(projectId, userId)) {
        return null;
      }

      const snapshot = JSON.parse(JSON.stringify(project)) as Project;
      const now = Date.now();
      if (data.name !== undefined && data.name.trim().length > 0) {
        project.name = data.name.trim();
      }
      if (data.description !== undefined) {
        project.description = data.description.trim() || undefined;
      }
      if (data.archived !== undefined) {
        project.archived = data.archived;
      }
      project.updatedAt = now;

      this.projects.set(projectId, project);
      try {
        await this.persistProject(project);
      } catch (err) {
        this.projects.set(projectId, snapshot);
        throw err;
      }
      return JSON.parse(JSON.stringify(project)) as Project;
    });
  }

  async deleteProject(projectId: string, userId: string, username?: string): Promise<boolean> {
    return this.runProjectTransaction(projectId, async () => {
      const project = this.projects.get(projectId);
      if (!project) return false;
      // Only the project owner can delete
      if (!this.isOwner(projectId, userId, username)) return false;

      const snapshot = JSON.parse(JSON.stringify(project)) as Project;
      this.projects.delete(projectId);
      try {
        await this.deleteProjectFromDisk(projectId);
      } catch (err) {
        this.projects.set(projectId, snapshot);
        throw err;
      }
      return true;
    });
  }

  async addCollaborator(
    projectId: string,
    userId: string,
    collaborator: UserProfile,
    role: ProjectCollaboratorRole = 'collaborator'
  ): Promise<Project | null> {
    return this.runProjectTransaction(projectId, async () => {
      return addProjectCollaborator(
        {
          projects: this.projects,
          persistProject: (project: Project) => this.persistProject(project),
          recordActivity: (pId, u, type, summary, title, metadata, persist) =>
            this.recordActivity(pId, u, type, summary, title, metadata, persist),
          isOwner: (pId, uId) => this.isOwner(pId, uId)
        },
        projectId,
        userId,
        collaborator,
        role
      );
    });
  }

  async updateCollaboratorRole(
    projectId: string,
    userId: string,
    targetUserId: string,
    role: ProjectCollaboratorRole
  ): Promise<Project | null> {
    return this.runProjectTransaction(projectId, async () => {
      return updateProjectCollaboratorRole(
        {
          projects: this.projects,
          persistProject: (project: Project) => this.persistProject(project),
          recordActivity: (pId, u, type, summary, title, metadata, persist) =>
            this.recordActivity(pId, u, type, summary, title, metadata, persist),
          isOwner: (pId, uId) => this.isOwner(pId, uId)
        },
        projectId,
        userId,
        targetUserId,
        role
      );
    });
  }

  async removeCollaborator(projectId: string, userId: string, targetUserId: string): Promise<Project | null> {
    return this.runProjectTransaction(projectId, async () => {
      return removeProjectCollaborator(
        {
          projects: this.projects,
          persistProject: (project: Project) => this.persistProject(project),
          recordActivity: (pId, u, type, summary, title, metadata, persist) =>
            this.recordActivity(pId, u, type, summary, title, metadata, persist),
          isOwner: (pId, uId) => this.isOwner(pId, uId)
        },
        projectId,
        userId,
        targetUserId
      );
    });
  }

  async recordProjectSession(
    projectId: string,
    session: ProjectSessionItem,
    collaboratorIdentity?: ParticipantIdentity | null
  ): Promise<void> {
    return this.runProjectTransaction(projectId, async () => {
      const project = this.projects.get(projectId);
      if (!project) return;

      const snapshot = JSON.parse(JSON.stringify(project)) as Project;
      await recordProjectSessionItem({
        project,
        session,
        collaboratorIdentity,
        recordActivity: (pId, u, type, summary, title, metadata, persist) =>
          this.recordActivity(pId, u, type, summary, title, metadata, persist)
      });

      this.projects.set(projectId, project);
      try {
        await this.persistProject(project);
      } catch (err) {
        this.projects.set(projectId, snapshot);
        throw err;
      }
    });
  }
}
