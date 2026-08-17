import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  Project,
  ProjectCollaborator,
  ProjectCollaboratorRole,
  ProjectRole,
  ProjectSessionItem,
  ProjectActivityItem,
  ProjectActivityType,
  CreateProjectRequest,
  UpdateProjectRequest,
  UpdateProjectWorkspaceRequest,
  ProjectWorkspace,
  UserProfile,
  ParticipantIdentity
} from '@jameet/shared';

export class WorkspaceConflictError extends Error {
  readonly code = 'WORKSPACE_CONFLICT';
  readonly area: 'lyrics' | 'notes' | 'structure' | 'tasks';
  readonly currentRevision: number;
  readonly baseRevision?: number;

  constructor(
    area: 'lyrics' | 'notes' | 'structure' | 'tasks',
    currentRevision: number,
    baseRevision?: number
  ) {
    super(
      `Workspace conflict in ${area}: server revision is ${currentRevision}, but client provided base revision ${baseRevision}.`
    );
    this.name = 'WorkspaceConflictError';
    this.area = area;
    this.currentRevision = currentRevision;
    this.baseRevision = baseRevision;
  }
}

export class ProjectLimitError extends Error {
  readonly code: string;
  constructor(message: string, code = 'PROJECT_LIMIT_EXCEEDED') {
    super(message);
    this.name = 'ProjectLimitError';
    this.code = code;
  }
}

export class WorkspaceLimitError extends Error {
  readonly code: string;
  readonly area: 'lyrics' | 'notes' | 'structure' | 'tasks';
  constructor(area: 'lyrics' | 'notes' | 'structure' | 'tasks', message: string, code = 'WORKSPACE_LIMIT_EXCEEDED') {
    super(message);
    this.name = 'WorkspaceLimitError';
    this.area = area;
    this.code = code;
  }
}

export const PROJECT_LIMITS = {
  MAX_PROJECTS_PER_OWNER: 100,
  MAX_COLLABORATORS_PER_PROJECT: 50,
  MAX_LYRICS_DOCUMENTS: 50,
  MAX_LYRICS_DOCUMENT_CONTENT_LENGTH: 100_000,
  MAX_LYRICS_DOCUMENT_TITLE_LENGTH: 150,
  MAX_LYRICS_DOCUMENT_ID_LENGTH: 100,
  MAX_LYRICS_ACTIVE_DOCUMENT_ID_LENGTH: 100,
  MAX_LYRICS_UPDATED_BY_LENGTH: 100,
  MAX_LYRICS_UPDATED_BY_NAME_LENGTH: 150,
  MAX_LYRICS_TOTAL_CONTENT_LENGTH: 500_000,
  MAX_NOTES_CONTENT_LENGTH: 100_000,
  MAX_NOTES_BPM_LENGTH: 20,
  MAX_NOTES_KEY_LENGTH: 30,
  MAX_STRUCTURE_SECTIONS: 150,
  MAX_STRUCTURE_SECTION_ID_LENGTH: 100,
  MAX_STRUCTURE_SECTION_NAME_LENGTH: 100,
  MAX_STRUCTURE_SECTION_NOTE_LENGTH: 500,
  MAX_STRUCTURE_SECTION_COLOR_LENGTH: 50,
  MAX_TASKS: 300,
  MAX_TASK_ID_LENGTH: 100,
  MAX_TASK_TITLE_LENGTH: 200,
  MAX_TASK_NOTE_LENGTH: 2_000,
  MAX_TASK_ASSIGNEE_ID_LENGTH: 100,
  MAX_TASK_ASSIGNEE_NAME_LENGTH: 150,
  MAX_TASK_DUE_DATE_LENGTH: 50,
  MAX_WORKSPACE_PAYLOAD_BYTES: 16_777_216
};

export interface ProjectDatabaseSchema {
  version: number;
  projects: Project[];
}

export class ProjectStore {
  private projects = new Map<string, Project>(); // projectId -> Project
  private baseDir: string;
  private projectsDir: string;
  private dataFilePath: string;
  private projectQueues = new Map<string, Promise<void>>();
  private ownerQueues = new Map<string, Promise<void>>();

  constructor(storageDir?: string) {
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

  private normalizeLoadedProject(p: Project): void {
    if (!Array.isArray(p.activities)) {
      p.activities = [];
    }
    if (Array.isArray(p.collaborators)) {
      for (const c of p.collaborators) {
        delete (c as any).email;
        if (!c.role || (c.role as string) === 'owner') {
          c.role = 'collaborator';
        }
      }
    }
    if (!p.workspace) {
      p.workspace = {
        lyrics: { revision: 1, activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: p.updatedAt || p.createdAt || Date.now() }], content: '', updatedAt: p.updatedAt || p.createdAt || Date.now() },
        notes: { revision: 1, content: '', updatedAt: p.updatedAt || p.createdAt || Date.now() },
        structure: { revision: 1, sections: [], updatedAt: p.updatedAt || p.createdAt || Date.now() },
        tasks: { revision: 1, tasks: [], updatedAt: p.updatedAt || p.createdAt || Date.now() }
      };
    } else {
      if (!p.workspace.lyrics) {
        p.workspace.lyrics = { revision: 1, activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: p.updatedAt || p.createdAt || Date.now() }], content: '', updatedAt: p.updatedAt || p.createdAt || Date.now() };
      } else if (p.workspace.lyrics.revision === undefined) {
        p.workspace.lyrics.revision = 1;
      }
      if (!p.workspace.notes) {
        p.workspace.notes = { revision: 1, content: '', updatedAt: p.updatedAt || p.createdAt || Date.now() };
      } else if (p.workspace.notes.revision === undefined) {
        p.workspace.notes.revision = 1;
      }
      if (!p.workspace.structure) {
        p.workspace.structure = { revision: 1, sections: [], updatedAt: p.updatedAt || p.createdAt || Date.now() };
      } else if (p.workspace.structure.revision === undefined) {
        p.workspace.structure.revision = 1;
      }
      if (!p.workspace.tasks) {
        p.workspace.tasks = { revision: 1, tasks: [], updatedAt: p.updatedAt || p.createdAt || Date.now() };
      } else if (p.workspace.tasks.revision === undefined) {
        p.workspace.tasks.revision = 1;
      }
    }
  }

  private loadFromDisk(): void {
    const legacyFileExists = fs.existsSync(this.dataFilePath);
    const loadedLegacyProjects: Project[] = [];

    // 1. If consolidated datastore file exists, load and validate
    if (legacyFileExists) {
      try {
        const raw = fs.readFileSync(this.dataFilePath, 'utf-8');
        const data = JSON.parse(raw) as ProjectDatabaseSchema;
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error(`Invalid project database structure in ${this.dataFilePath}: root must be an object`);
        }
        if (!Array.isArray(data.projects)) {
          throw new Error(`Invalid project database structure in ${this.dataFilePath}: 'projects' field must be an array`);
        }
        for (const p of data.projects) {
          this.normalizeLoadedProject(p);
          loadedLegacyProjects.push(p);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to load project datastore from ${this.dataFilePath}: ${message}`);
      }
    }

    // 2. Ensure per-project directory exists
    if (!fs.existsSync(this.projectsDir)) {
      try {
        fs.mkdirSync(this.projectsDir, { recursive: true });
      } catch {
        // ignore on initial store construction; write operations will fail durably
      }
    }

    // 3. Load standalone authoritative per-project files from projectsDir if present
    const existingPerProjectIds = new Set<string>();
    if (fs.existsSync(this.projectsDir)) {
      let files: string[] = [];
      try {
        files = fs.readdirSync(this.projectsDir);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to read projects directory ${this.projectsDir}: ${message}`);
      }

      for (const file of files) {
        if (!file.endsWith('.json') || file.includes('.tmp')) continue;
        const filePath = path.join(this.projectsDir, file);
        let raw: string;
        try {
          raw = fs.readFileSync(filePath, 'utf-8');
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to read project file ${filePath}: ${message}`);
        }

        let p: Project;
        try {
          p = JSON.parse(raw) as Project;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to parse project file ${filePath}: ${message}`);
        }

        if (!p || typeof p !== 'object' || Array.isArray(p) || typeof p.id !== 'string' || !p.id.trim()) {
          throw new Error(`Invalid project structure in ${filePath}: missing or invalid 'id' field`);
        }

        this.normalizeLoadedProject(p);
        this.projects.set(p.id, p);
        existingPerProjectIds.add(p.id);
      }
    }

    // 4. Safe fail-closed migration: migrate legacy projects that do NOT already have a valid per-project file
    if (legacyFileExists) {
      try {
        if (!fs.existsSync(this.projectsDir)) {
          fs.mkdirSync(this.projectsDir, { recursive: true });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to create projects directory during migration ${this.projectsDir}: ${message}`);
      }

      for (const p of loadedLegacyProjects) {
        // NEVER overwrite a valid existing per-project file with an older consolidated copy
        if (existingPerProjectIds.has(p.id)) {
          continue;
        }

        const projPath = path.join(this.projectsDir, `${p.id}.json`);
        const tmpPath = `${projPath}.${crypto.randomUUID()}.tmp`;
        try {
          fs.writeFileSync(tmpPath, JSON.stringify(p, null, 2), 'utf-8');
          fs.renameSync(tmpPath, projPath);
          this.projects.set(p.id, p);
          existingPerProjectIds.add(p.id);
        } catch (err: unknown) {
          try {
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
          } catch {}
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to migrate project ${p.id} to per-project file: ${message}`);
        }
      }

      // Only archive the consolidated file after EVERY project has been successfully migrated or preserved
      try {
        fs.renameSync(this.dataFilePath, `${this.dataFilePath}.migrated.bak`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to archive migrated consolidated datastore ${this.dataFilePath}: ${message}`);
      }
    }
  }

  private getProjectPath(projectId: string): string {
    if (
      this.dataFilePath &&
      path.basename(this.dataFilePath).endsWith('.json') &&
      path.basename(this.dataFilePath) !== 'jameet-projects.json' &&
      path.basename(this.dataFilePath) !== 'musiczoom-projects.json'
    ) {
      return this.dataFilePath;
    }
    const dir = this.dataFilePath ? path.join(path.dirname(this.dataFilePath), 'projects') : this.projectsDir;
    return path.join(dir, `${projectId}.json`);
  }

  private async persistProject(project: Project): Promise<void> {
    const projectPath = this.getProjectPath(project.id);
    const targetDir = path.dirname(projectPath);
    await fs.promises.mkdir(targetDir, { recursive: true });
    const tmpPath = `${projectPath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(tmpPath, JSON.stringify(project, null, 2), 'utf-8');
      await fs.promises.rename(tmpPath, projectPath);
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) {
          await fs.promises.unlink(tmpPath);
        }
      } catch {
        // ignore tmp cleanup error
      }
      throw err;
    }
  }

  private async deleteProjectFromDisk(projectId: string): Promise<void> {
    const projectPath = this.getProjectPath(projectId);
    const targetDir = path.dirname(projectPath);
    await fs.promises.stat(targetDir).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
    try {
      await fs.promises.unlink(projectPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
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
    if (projectId) {
      const project = this.projects.get(projectId);
      return JSON.stringify({
        version: 1,
        type: 'single',
        projectId,
        project: project ? JSON.parse(JSON.stringify(project)) : null
      });
    }
    return JSON.stringify({
      version: 1,
      type: 'global',
      projects: Array.from(this.projects.values()).map((p) => JSON.parse(JSON.stringify(p)))
    });
  }

  async restoreSnapshot(snapshotJson: string): Promise<void> {
    const data = JSON.parse(snapshotJson);
    if (data && data.type === 'single' && typeof data.projectId === 'string') {
      return this.runProjectTransaction(data.projectId, async () => {
        if (data.project) {
          this.projects.set(data.projectId, data.project);
          await this.persistProject(data.project);
        } else {
          this.projects.delete(data.projectId);
          await this.deleteProjectFromDisk(data.projectId);
        }
      });
    }

    // Global snapshot restoration: restore scoped snapshot projects without clobbering unrelated projects
    if (Array.isArray(data?.projects)) {
      for (const p of data.projects) {
        await this.runProjectTransaction(p.id, async () => {
          this.projects.set(p.id, p);
          await this.persistProject(p);
        });
      }
    }
  }

  listProjects(userId: string, includeArchived = false): Project[] {
    const results: Project[] = [];
    for (const project of this.projects.values()) {
      const isOwner = project.ownerId === userId;
      const isCollaborator = project.collaborators.some((c) => c.userId === userId);
      if (isOwner || isCollaborator) {
        if (!includeArchived && project.archived) continue;
        results.push(project);
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
    return project;
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

  isOwner(projectId: string, userId: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;
    return project.ownerId === userId;
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
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
        archived: false,
        collaborators,
        sessions: [],
        sessionCount: 0,
        activities: [],
        workspace: {
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
    user: { id?: string; displayName?: string; username?: string; avatarColor?: string },
    type: ProjectActivityType,
    summary: string,
    title?: string,
    metadata?: Record<string, unknown>,
    persist = true
  ): Promise<ProjectActivityItem | null> {
    const project = this.projects.get(projectId);
    if (!project) return null;
    if (!Array.isArray(project.activities)) {
      project.activities = [];
    }

    const snapshot = persist ? (JSON.parse(JSON.stringify(project)) as Project) : null;
    const now = Date.now();
    const userId = user.id || 'usr_unknown';
    const userDisplayName = user.displayName || user.username || 'Collaborator';
    const userUsername = user.username || 'collaborator';
    const userAvatarColor = user.avatarColor;

    // Intelligent consolidation for continuous edits (e.g. typing lyrics, typing notes)
    if (type === 'lyrics_edited' || type === 'notes_edited') {
      const top = project.activities[0];
      if (top && top.type === type && top.userId === userId && (now - top.createdAt < 10 * 60 * 1000)) {
        top.createdAt = now;
        top.summary = summary;
        if (title) top.title = title;
        if (metadata) top.metadata = { ...(top.metadata || {}), ...metadata };
        project.updatedAt = now;
        project.lastActivityAt = now;
        if (persist) {
          try {
            await this.persistProject(project);
          } catch (err) {
            if (snapshot) this.projects.set(projectId, snapshot);
            throw err;
          }
        }
        return top;
      }
    }

    const item: ProjectActivityItem = {
      id: `act_${now}_${Math.random().toString(36).substring(2, 7)}`,
      projectId,
      type,
      userId,
      userDisplayName,
      userUsername,
      userAvatarColor,
      title: title || '',
      summary,
      metadata,
      createdAt: now
    };

    project.activities.unshift(item);
    if (project.activities.length > 300) {
      project.activities = project.activities.slice(0, 300);
    }
    project.updatedAt = now;
    project.lastActivityAt = now;
    if (persist) {
      try {
        await this.persistProject(project);
      } catch (err) {
        if (snapshot) this.projects.set(projectId, snapshot);
        throw err;
      }
    }
    return item;
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

      // 1. Enforce workspace storage and field limits on raw client inputs before any normalization, mutation, or persistence
      if (updates.lyrics) {
        if (updates.lyrics.activeDocumentId && updates.lyrics.activeDocumentId.length > PROJECT_LIMITS.MAX_LYRICS_ACTIVE_DOCUMENT_ID_LENGTH) {
          throw new WorkspaceLimitError(
            'lyrics',
            `Active document ID exceeds maximum length of ${PROJECT_LIMITS.MAX_LYRICS_ACTIVE_DOCUMENT_ID_LENGTH} characters.`
          );
        }

        if (updates.lyrics.documents) {
          for (const doc of updates.lyrics.documents) {
            if (doc.id && doc.id.length > PROJECT_LIMITS.MAX_LYRICS_DOCUMENT_ID_LENGTH) {
              throw new WorkspaceLimitError(
                'lyrics',
                `Lyrics document ID exceeds maximum length of ${PROJECT_LIMITS.MAX_LYRICS_DOCUMENT_ID_LENGTH} characters.`
              );
            }
            if (doc.title && doc.title.length > PROJECT_LIMITS.MAX_LYRICS_DOCUMENT_TITLE_LENGTH) {
              throw new WorkspaceLimitError(
                'lyrics',
                `Lyrics document title exceeds maximum length of ${PROJECT_LIMITS.MAX_LYRICS_DOCUMENT_TITLE_LENGTH} characters.`
              );
            }
            if (doc.content && doc.content.length > PROJECT_LIMITS.MAX_LYRICS_DOCUMENT_CONTENT_LENGTH) {
              throw new WorkspaceLimitError(
                'lyrics',
                `Lyrics document content exceeds maximum length of ${PROJECT_LIMITS.MAX_LYRICS_DOCUMENT_CONTENT_LENGTH} characters.`
              );
            }
            if (doc.updatedBy && doc.updatedBy.length > PROJECT_LIMITS.MAX_LYRICS_UPDATED_BY_LENGTH) {
              throw new WorkspaceLimitError(
                'lyrics',
                `Lyrics document updatedBy exceeds maximum length of ${PROJECT_LIMITS.MAX_LYRICS_UPDATED_BY_LENGTH} characters.`
              );
            }
            if (doc.updatedByName && doc.updatedByName.length > PROJECT_LIMITS.MAX_LYRICS_UPDATED_BY_NAME_LENGTH) {
              throw new WorkspaceLimitError(
                'lyrics',
                `Lyrics document updatedByName exceeds maximum length of ${PROJECT_LIMITS.MAX_LYRICS_UPDATED_BY_NAME_LENGTH} characters.`
              );
            }
          }
        }

        if (updates.lyrics.title && updates.lyrics.title.length > PROJECT_LIMITS.MAX_LYRICS_DOCUMENT_TITLE_LENGTH) {
          throw new WorkspaceLimitError(
            'lyrics',
            `Lyrics document title exceeds maximum length of ${PROJECT_LIMITS.MAX_LYRICS_DOCUMENT_TITLE_LENGTH} characters.`
          );
        }

        if (updates.lyrics.content && updates.lyrics.content.length > PROJECT_LIMITS.MAX_LYRICS_DOCUMENT_CONTENT_LENGTH) {
          throw new WorkspaceLimitError(
            'lyrics',
            `Lyrics document content exceeds maximum length of ${PROJECT_LIMITS.MAX_LYRICS_DOCUMENT_CONTENT_LENGTH} characters.`
          );
        }

        // Project the final lyrics document state to validate against total/per-doc limits
        const existingDocs = project.workspace?.lyrics?.documents || [];
        let projectedDocs: Array<{ id: string; title: string; content: string }> = [];

        if (updates.lyrics.documents) {
          // Client provided explicit full array of documents
          projectedDocs = updates.lyrics.documents.map((d) => ({
            id: d.id,
            title: d.title,
            content: d.content
          }));
        } else {
          // Client provided legacy documentId/title/content update, or targeted document update
          projectedDocs = existingDocs.map((d) => ({ ...d }));
        }

        if (updates.lyrics.content !== undefined || updates.lyrics.title !== undefined || updates.lyrics.documentId !== undefined) {
          const targetDocId = updates.lyrics.documentId || updates.lyrics.activeDocumentId || project.workspace?.lyrics?.activeDocumentId || (projectedDocs[0]?.id ?? 'doc-main');
          const targetDocIndex = projectedDocs.findIndex((d) => d.id === targetDocId);

          if (targetDocIndex >= 0) {
            projectedDocs[targetDocIndex] = {
              ...projectedDocs[targetDocIndex]!,
              title: updates.lyrics.title !== undefined ? updates.lyrics.title : projectedDocs[targetDocIndex]!.title,
              content: updates.lyrics.content !== undefined ? updates.lyrics.content : projectedDocs[targetDocIndex]!.content
            };
          } else if (updates.lyrics.content !== undefined || updates.lyrics.title !== undefined) {
            projectedDocs.push({
              id: targetDocId,
              title: updates.lyrics.title || 'Untitled Lyrics',
              content: updates.lyrics.content || ''
            });
          }
        }

        // Validate projected document count
        if (projectedDocs.length > PROJECT_LIMITS.MAX_LYRICS_DOCUMENTS) {
          throw new WorkspaceLimitError(
            'lyrics',
            `Maximum lyrics documents limit reached (${PROJECT_LIMITS.MAX_LYRICS_DOCUMENTS} documents per project).`
          );
        }

        // Validate each document id, title, individual content size, and total cumulative content length
        let totalLyricsLength = 0;
        for (const d of projectedDocs) {
          if (d.id && d.id.length > PROJECT_LIMITS.MAX_LYRICS_DOCUMENT_ID_LENGTH) {
            throw new WorkspaceLimitError(
              'lyrics',
              `Lyrics document ID exceeds maximum length of ${PROJECT_LIMITS.MAX_LYRICS_DOCUMENT_ID_LENGTH} characters.`
            );
          }
          if (d.title && d.title.length > PROJECT_LIMITS.MAX_LYRICS_DOCUMENT_TITLE_LENGTH) {
            throw new WorkspaceLimitError(
              'lyrics',
              `Lyrics document title exceeds maximum length of ${PROJECT_LIMITS.MAX_LYRICS_DOCUMENT_TITLE_LENGTH} characters.`
            );
          }
          if (d.content && d.content.length > PROJECT_LIMITS.MAX_LYRICS_DOCUMENT_CONTENT_LENGTH) {
            throw new WorkspaceLimitError(
              'lyrics',
              `Single lyrics document exceeds maximum content length of ${PROJECT_LIMITS.MAX_LYRICS_DOCUMENT_CONTENT_LENGTH} characters.`
            );
          }
          totalLyricsLength += (d.content || '').length;
        }

        // Validate total cumulative lyrics content limit
        if (totalLyricsLength > PROJECT_LIMITS.MAX_LYRICS_TOTAL_CONTENT_LENGTH) {
          throw new WorkspaceLimitError(
            'lyrics',
            `Total lyrics content exceeds maximum limit of ${PROJECT_LIMITS.MAX_LYRICS_TOTAL_CONTENT_LENGTH} characters across all documents.`
          );
        }
      }

      if (updates.notes) {
        if (updates.notes.content && updates.notes.content.length > PROJECT_LIMITS.MAX_NOTES_CONTENT_LENGTH) {
          throw new WorkspaceLimitError(
            'notes',
            `Notes content exceeds maximum limit of ${PROJECT_LIMITS.MAX_NOTES_CONTENT_LENGTH} characters.`
          );
        }
        if (updates.notes.bpm && updates.notes.bpm.length > PROJECT_LIMITS.MAX_NOTES_BPM_LENGTH) {
          throw new WorkspaceLimitError(
            'notes',
            `Notes BPM exceeds maximum length of ${PROJECT_LIMITS.MAX_NOTES_BPM_LENGTH} characters.`
          );
        }
        if (updates.notes.key && updates.notes.key.length > PROJECT_LIMITS.MAX_NOTES_KEY_LENGTH) {
          throw new WorkspaceLimitError(
            'notes',
            `Notes Key exceeds maximum length of ${PROJECT_LIMITS.MAX_NOTES_KEY_LENGTH} characters.`
          );
        }
      }

      if (updates.structure && updates.structure.sections) {
        if (updates.structure.sections.length > PROJECT_LIMITS.MAX_STRUCTURE_SECTIONS) {
          throw new WorkspaceLimitError(
            'structure',
            `Maximum song sections limit reached (${PROJECT_LIMITS.MAX_STRUCTURE_SECTIONS} sections per project).`
          );
        }
        for (const s of updates.structure.sections) {
          if (s.id && s.id.length > PROJECT_LIMITS.MAX_STRUCTURE_SECTION_ID_LENGTH) {
            throw new WorkspaceLimitError(
              'structure',
              `Structure section ID exceeds maximum length of ${PROJECT_LIMITS.MAX_STRUCTURE_SECTION_ID_LENGTH} characters.`
            );
          }
          if (s.name && s.name.length > PROJECT_LIMITS.MAX_STRUCTURE_SECTION_NAME_LENGTH) {
            throw new WorkspaceLimitError(
              'structure',
              `Structure section name exceeds maximum length of ${PROJECT_LIMITS.MAX_STRUCTURE_SECTION_NAME_LENGTH} characters.`
            );
          }
          if (s.note && s.note.length > PROJECT_LIMITS.MAX_STRUCTURE_SECTION_NOTE_LENGTH) {
            throw new WorkspaceLimitError(
              'structure',
              `Structure section note exceeds maximum length of ${PROJECT_LIMITS.MAX_STRUCTURE_SECTION_NOTE_LENGTH} characters.`
            );
          }
          if (s.color && s.color.length > PROJECT_LIMITS.MAX_STRUCTURE_SECTION_COLOR_LENGTH) {
            throw new WorkspaceLimitError(
              'structure',
              `Structure section color exceeds maximum length of ${PROJECT_LIMITS.MAX_STRUCTURE_SECTION_COLOR_LENGTH} characters.`
            );
          }
        }
      }

      if (updates.tasks && updates.tasks.tasks) {
        if (updates.tasks.tasks.length > PROJECT_LIMITS.MAX_TASKS) {
          throw new WorkspaceLimitError(
            'tasks',
            `Maximum tasks limit reached (${PROJECT_LIMITS.MAX_TASKS} tasks per project).`
          );
        }
        for (const t of updates.tasks.tasks) {
          if (t.id && t.id.length > PROJECT_LIMITS.MAX_TASK_ID_LENGTH) {
            throw new WorkspaceLimitError(
              'tasks',
              `Task ID exceeds maximum length of ${PROJECT_LIMITS.MAX_TASK_ID_LENGTH} characters.`
            );
          }
          if (t.title && t.title.length > PROJECT_LIMITS.MAX_TASK_TITLE_LENGTH) {
            throw new WorkspaceLimitError(
              'tasks',
              `Task title exceeds maximum length of ${PROJECT_LIMITS.MAX_TASK_TITLE_LENGTH} characters.`
            );
          }
          if (t.note && t.note.length > PROJECT_LIMITS.MAX_TASK_NOTE_LENGTH) {
            throw new WorkspaceLimitError(
              'tasks',
              `Task note exceeds maximum length of ${PROJECT_LIMITS.MAX_TASK_NOTE_LENGTH} characters.`
            );
          }
          if (t.assigneeId && t.assigneeId.length > PROJECT_LIMITS.MAX_TASK_ASSIGNEE_ID_LENGTH) {
            throw new WorkspaceLimitError(
              'tasks',
              `Task assignee ID exceeds maximum length of ${PROJECT_LIMITS.MAX_TASK_ASSIGNEE_ID_LENGTH} characters.`
            );
          }
          if (t.assigneeName && t.assigneeName.length > PROJECT_LIMITS.MAX_TASK_ASSIGNEE_NAME_LENGTH) {
            throw new WorkspaceLimitError(
              'tasks',
              `Task assignee name exceeds maximum length of ${PROJECT_LIMITS.MAX_TASK_ASSIGNEE_NAME_LENGTH} characters.`
            );
          }
          if (t.dueDate && t.dueDate.length > PROJECT_LIMITS.MAX_TASK_DUE_DATE_LENGTH) {
            throw new WorkspaceLimitError(
              'tasks',
              `Task due date exceeds maximum length of ${PROJECT_LIMITS.MAX_TASK_DUE_DATE_LENGTH} characters.`
            );
          }
        }
      }

      // 2. Validate IDs, dates, and member assignees
      if (updates.lyrics) {
        if (updates.lyrics.documentId !== undefined) {
          if (
            !updates.lyrics.documentId ||
            typeof updates.lyrics.documentId !== 'string' ||
            updates.lyrics.documentId.trim().length === 0
          ) {
            return null;
          }
          updates.lyrics.documentId = updates.lyrics.documentId.trim();
        }

        if (updates.lyrics.documents !== undefined) {
          const seenDocIds = new Set<string>();
          for (const d of updates.lyrics.documents) {
            if (!d.id || typeof d.id !== 'string' || d.id.trim().length === 0) {
              return null;
            }
            if (seenDocIds.has(d.id)) {
              return null;
            }
            seenDocIds.add(d.id);
          }
        }
      }

      if (updates.structure && updates.structure.sections !== undefined) {
        const seenSectionIds = new Set<string>();
        for (const s of updates.structure.sections) {
          if (!s.id || typeof s.id !== 'string' || s.id.trim().length === 0) {
            return null;
          }
          if (seenSectionIds.has(s.id)) {
            return null;
          }
          seenSectionIds.add(s.id);
        }
      }

      if (updates.tasks && updates.tasks.tasks !== undefined) {
        const seenTaskIds = new Set<string>();
        for (const t of updates.tasks.tasks) {
          if (!t.id || typeof t.id !== 'string' || t.id.trim().length === 0) {
            return null;
          }
          if (seenTaskIds.has(t.id)) {
            return null;
          }
          seenTaskIds.add(t.id);

          if (t.dueDate !== undefined) {
            if (typeof t.dueDate !== 'string') {
              return null;
            }
            const trimmedDue = t.dueDate.trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDue)) {
              return null;
            }
            const parts = trimmedDue.split('-');
            if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
              return null;
            }
            const y = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            const d = parseInt(parts[2], 10);
            if (m < 1 || m > 12 || d < 1 || d > 31) {
              return null;
            }
            const date = new Date(Date.UTC(y, m - 1, d));
            if (
              date.getUTCFullYear() !== y ||
              date.getUTCMonth() !== m - 1 ||
              date.getUTCDate() !== d
            ) {
              return null;
            }
            t.dueDate = trimmedDue;
          }

          if (t.assigneeId) {
            let memberName: string | null = null;
            if (project.ownerId === t.assigneeId) {
              memberName = project.ownerDisplayName;
            } else {
              const collab = project.collaborators.find((c) => c.userId === t.assigneeId);
              if (collab) {
                memberName = collab.displayName;
              }
            }

            if (!memberName) {
              return null;
            }
            t.assigneeName = memberName;
          } else {
            t.assigneeId = undefined;
            t.assigneeName = undefined;
          }
        }
      }

      // Ensure workspace containers exist and have revisions initialized
      const now = Date.now();
      if (!project.workspace) {
        project.workspace = {
          lyrics: {
            revision: 1,
            activeDocumentId: 'doc-main',
            documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now }],
            content: '',
            updatedAt: now
          },
          notes: { revision: 1, content: '', updatedAt: now },
          structure: { revision: 1, sections: [], updatedAt: now },
          tasks: { revision: 1, tasks: [], updatedAt: now }
        };
      }
      if (!project.workspace.lyrics) {
        project.workspace.lyrics = { revision: 1, activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now }], content: '', updatedAt: now };
      } else if (project.workspace.lyrics.revision === undefined) {
        project.workspace.lyrics.revision = 1;
      }
      if (!project.workspace.notes) {
        project.workspace.notes = { revision: 1, content: '', updatedAt: now };
      } else if (project.workspace.notes.revision === undefined) {
        project.workspace.notes.revision = 1;
      }
      if (!project.workspace.structure) {
        project.workspace.structure = { revision: 1, sections: [], updatedAt: now };
      } else if (project.workspace.structure.revision === undefined) {
        project.workspace.structure.revision = 1;
      }
      if (!project.workspace.tasks) {
        project.workspace.tasks = { revision: 1, tasks: [], updatedAt: now };
      } else if (project.workspace.tasks.revision === undefined) {
        project.workspace.tasks.revision = 1;
      }

      // Pre-mutation Optimistic Concurrency Control (OCC) validation - Fail Closed
      if (updates.lyrics) {
        const currentRev = project.workspace.lyrics.revision ?? 1;
        if (typeof updates.lyrics.baseRevision !== 'number' || updates.lyrics.baseRevision !== currentRev) {
          throw new WorkspaceConflictError('lyrics', currentRev, updates.lyrics.baseRevision);
        }
      }
      if (updates.notes) {
        const currentRev = project.workspace.notes.revision ?? 1;
        if (typeof updates.notes.baseRevision !== 'number' || updates.notes.baseRevision !== currentRev) {
          throw new WorkspaceConflictError('notes', currentRev, updates.notes.baseRevision);
        }
      }
      if (updates.structure) {
        const currentRev = project.workspace.structure.revision ?? 1;
        if (typeof updates.structure.baseRevision !== 'number' || updates.structure.baseRevision !== currentRev) {
          throw new WorkspaceConflictError('structure', currentRev, updates.structure.baseRevision);
        }
      }
      if (updates.tasks) {
        const currentRev = project.workspace.tasks.revision ?? 1;
        if (typeof updates.tasks.baseRevision !== 'number' || updates.tasks.baseRevision !== currentRev) {
          throw new WorkspaceConflictError('tasks', currentRev, updates.tasks.baseRevision);
        }
      }

      const snapshot = JSON.parse(JSON.stringify(project)) as Project;
      let lyricsChanged = false;
      let notesChanged = false;
      let structureChanged = false;
      let tasksChanged = false;

    if (updates.lyrics) {
      const curLyrics = project.workspace.lyrics;
      if (!curLyrics.documents || curLyrics.documents.length === 0) {
        curLyrics.documents = [
          { id: 'doc-main', title: 'Main Lyrics', content: curLyrics.content || '', updatedAt: now }
        ];
        curLyrics.activeDocumentId = 'doc-main';
      }
      const initialDocsList = (curLyrics.documents || []).map((d) => ({ ...d }));

      if (updates.lyrics.documents) {
        const oldDocs = new Map(initialDocsList.map((d) => [d.id, { ...d }]));
        let docsModified = initialDocsList.length !== updates.lyrics.documents.length;
        const newDocs = updates.lyrics.documents.map((incDoc) => {
          const existing = oldDocs.get(incDoc.id);
          if (existing) {
            const hasTitleUpdate = incDoc.title !== undefined && incDoc.title.trim().length > 0;
            const newTitle = hasTitleUpdate ? incDoc.title.trim() : existing.title;
            const newContent = incDoc.content !== undefined ? incDoc.content : existing.content;
            const titleChanged = newTitle !== existing.title;
            const contentChanged = newContent !== existing.content;

            if (titleChanged || contentChanged) {
              docsModified = true;
              return {
                id: incDoc.id,
                title: newTitle,
                content: newContent,
                updatedAt: now,
                updatedBy: user.id,
                updatedByName: user.displayName
              };
            }
            return {
              id: incDoc.id,
              title: existing.title,
              content: existing.content,
              updatedAt: existing.updatedAt,
              updatedBy: existing.updatedBy,
              updatedByName: existing.updatedByName
            };
          }
          docsModified = true;
          return {
            id: incDoc.id,
            title: incDoc.title ? incDoc.title.trim() : 'Untitled Lyrics',
            content: incDoc.content || '',
            updatedAt: now,
            updatedBy: user.id,
            updatedByName: user.displayName
          };
        });

        if (docsModified) {
          lyricsChanged = true;
          curLyrics.documents = newDocs;
        }

        if (curLyrics.documents.length === 0) {
          curLyrics.documents = [
            { id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now, updatedBy: user.id, updatedByName: user.displayName }
          ];
          curLyrics.activeDocumentId = 'doc-main';
          lyricsChanged = true;
        }
      }

      if (updates.lyrics.activeDocumentId && updates.lyrics.activeDocumentId !== curLyrics.activeDocumentId) {
        curLyrics.activeDocumentId = updates.lyrics.activeDocumentId;
        lyricsChanged = true;
      }

      if (updates.lyrics.documentId !== undefined || updates.lyrics.title !== undefined || updates.lyrics.content !== undefined) {
        // Target document ID
        const targetDocId = updates.lyrics.documentId || curLyrics.activeDocumentId || curLyrics.documents[0]?.id || 'doc-main';
        let doc = curLyrics.documents.find((d) => d.id === targetDocId);

        if (!doc) {
          doc = {
            id: targetDocId,
            title: updates.lyrics.title || 'Untitled Lyrics',
            content: updates.lyrics.content || '',
            updatedAt: now,
            updatedBy: user.id,
            updatedByName: user.displayName
          };
          curLyrics.documents.push(doc);
          lyricsChanged = true;
          this.recordActivity(
            projectId,
            user,
            'lyrics_doc_created',
            `${user.displayName} created lyrics draft "${doc.title}"`,
            doc.title,
            undefined,
            false
          );
        } else if (updates.lyrics.title !== undefined || updates.lyrics.content !== undefined) {
          const oldTitle = doc.title;
          const oldContent = doc.content;
          let changed = false;
          if (updates.lyrics.title !== undefined && updates.lyrics.title.trim().length > 0) {
            const nextTitle = updates.lyrics.title.trim();
            if (nextTitle !== oldTitle) {
              doc.title = nextTitle;
              changed = true;
              this.recordActivity(
                projectId,
                user,
                'lyrics_doc_renamed',
                `${user.displayName} renamed lyrics draft to "${doc.title}"`,
                doc.title,
                undefined,
                false
              );
            }
          }
          if (updates.lyrics.content !== undefined && updates.lyrics.content !== oldContent) {
            doc.content = updates.lyrics.content;
            changed = true;
            this.recordActivity(
              projectId,
              user,
              'lyrics_edited',
              `${user.displayName} edited ${doc.title}`,
              doc.title,
              undefined,
              false
            );
          }
          if (changed) {
            doc.updatedAt = now;
            doc.updatedBy = user.id;
            doc.updatedByName = user.displayName;
            lyricsChanged = true;
          }
        }
      }

      // Ensure activeDocumentId is still valid after any document additions
      if (!curLyrics.activeDocumentId || !curLyrics.documents.some((d) => d.id === curLyrics.activeDocumentId)) {
        curLyrics.activeDocumentId = curLyrics.documents[0]?.id || 'doc-main';
      }

      // Sync active document content to top-level content for backwards compatibility
      const activeDoc = curLyrics.documents.find((d) => d.id === curLyrics.activeDocumentId) || curLyrics.documents[0];
      const activeDocContent = activeDoc ? activeDoc.content : '';
      if (curLyrics.content !== activeDocContent) {
        curLyrics.content = activeDocContent;
      }

      if (updates.lyrics.documents) {
        const finalDocIds = new Set(curLyrics.documents.map((d) => d.id));
        for (const initialDoc of initialDocsList) {
          if (!finalDocIds.has(initialDoc.id)) {
            lyricsChanged = true;
            this.recordActivity(
              projectId,
              user,
              'lyrics_doc_deleted',
              `${user.displayName} deleted lyrics draft "${initialDoc.title}"`,
              initialDoc.title,
              undefined,
              false
            );
          }
        }
      }

      if (lyricsChanged) {
        curLyrics.revision = (curLyrics.revision || 1) + 1;
        curLyrics.updatedAt = now;
        curLyrics.updatedBy = user.id;
        curLyrics.updatedByName = user.displayName;
      }
    }

    if (updates.notes) {
      const oldBpm = project.workspace.notes.bpm;
      const oldKey = project.workspace.notes.key;
      const oldContent = project.workspace.notes.content;

      const normalizedOldBpm = oldBpm ? oldBpm.trim() : '';
      const normalizedNewBpm = updates.notes.bpm !== undefined ? (updates.notes.bpm ? updates.notes.bpm.trim() : '') : undefined;

      const normalizedOldKey = oldKey ? oldKey.trim() : '';
      const normalizedNewKey = updates.notes.key !== undefined ? (updates.notes.key ? updates.notes.key.trim() : '') : undefined;

      const bpmDiff = normalizedNewBpm !== undefined && normalizedNewBpm !== normalizedOldBpm;
      const keyDiff = normalizedNewKey !== undefined && normalizedNewKey !== normalizedOldKey;
      const contentDiff = updates.notes.content !== undefined && updates.notes.content !== oldContent;

      if (bpmDiff || keyDiff || contentDiff) {
        notesChanged = true;
        project.workspace.notes.content = updates.notes.content !== undefined ? updates.notes.content : project.workspace.notes.content;
        project.workspace.notes.bpm = updates.notes.bpm !== undefined ? updates.notes.bpm : project.workspace.notes.bpm;
        project.workspace.notes.key = updates.notes.key !== undefined ? updates.notes.key : project.workspace.notes.key;
        project.workspace.notes.revision = (project.workspace.notes.revision || 1) + 1;
        project.workspace.notes.updatedAt = now;
        project.workspace.notes.updatedBy = user.id;
        project.workspace.notes.updatedByName = user.displayName;

        if (bpmDiff) {
          if (normalizedNewBpm) {
            this.recordActivity(
              projectId,
              user,
              'notes_bpm_changed',
              `${user.displayName} set tempo to ${updates.notes.bpm} BPM`,
              `${updates.notes.bpm} BPM`,
              undefined,
              false
            );
          } else if (normalizedOldBpm) {
            this.recordActivity(
              projectId,
              user,
              'notes_bpm_changed',
              `${user.displayName} cleared Project tempo`,
              undefined,
              undefined,
              false
            );
          }
        }
        if (keyDiff) {
          if (normalizedNewKey) {
            this.recordActivity(
              projectId,
              user,
              'notes_key_changed',
              `${user.displayName} changed key to ${updates.notes.key}`,
              updates.notes.key,
              undefined,
              false
            );
          } else if (normalizedOldKey) {
            this.recordActivity(
              projectId,
              user,
              'notes_key_changed',
              `${user.displayName} cleared Project key`,
              undefined,
              undefined,
              false
            );
          }
        }
        if (contentDiff) {
          const isOldEmpty = (oldContent ?? '').trim().length === 0;
          const isNewEmpty = (updates.notes.content ?? '').trim().length === 0;

          if (!isOldEmpty && isNewEmpty) {
            this.recordActivity(
              projectId,
              user,
              'notes_edited',
              `${user.displayName} cleared Project Notes`,
              'Project Notes',
              undefined,
              false
            );
          } else if (!isNewEmpty && updates.notes.content !== oldContent) {
            this.recordActivity(
              projectId,
              user,
              'notes_edited',
              `${user.displayName} updated Project Notes`,
              'Project Notes',
              undefined,
              false
            );
          }
        }
      }
    }

    if (updates.structure) {
      if (updates.structure.sections !== undefined) {
        const oldSections = project.workspace.structure.sections || [];
        const newSections = updates.structure.sections;
        structureChanged =
          oldSections.length !== newSections.length ||
          oldSections.some((oldS, i) => {
            const newS = newSections[i];
            if (!newS) return true;
            return (
              oldS.id !== newS.id ||
              oldS.type !== newS.type ||
              oldS.name !== newS.name ||
              (oldS.bars ?? undefined) !== (newS.bars ?? undefined) ||
              (oldS.note || undefined) !== (newS.note || undefined) ||
              (oldS.color || undefined) !== (newS.color || undefined)
            );
          });

        if (structureChanged) {
          project.workspace.structure.sections = newSections;
          project.workspace.structure.revision = (project.workspace.structure.revision || 1) + 1;
          project.workspace.structure.updatedAt = now;
          project.workspace.structure.updatedBy = user.id;
          project.workspace.structure.updatedByName = user.displayName;

          this.recordActivity(
            projectId,
            user,
            'structure_changed',
            `${user.displayName} updated Song Structure arrangement`,
            'Song Structure',
            undefined,
            false
          );
        }
      }
    }

    if (updates.tasks && updates.tasks.tasks !== undefined) {
      const oldTasks = project.workspace.tasks.tasks || [];
      const newTasks = updates.tasks.tasks;

      tasksChanged =
        oldTasks.length !== newTasks.length ||
        oldTasks.some((oldT, i) => {
          const newT = newTasks[i];
          if (!newT) return true;
          return (
            oldT.id !== newT.id ||
            oldT.title !== newT.title ||
            oldT.status !== newT.status ||
            (oldT.assigneeId || undefined) !== (newT.assigneeId || undefined) ||
            (oldT.assigneeName || undefined) !== (newT.assigneeName || undefined) ||
            (oldT.note || undefined) !== (newT.note || undefined) ||
            (oldT.dueDate || undefined) !== (newT.dueDate || undefined) ||
            (oldT.completedAt || undefined) !== (newT.completedAt || undefined)
          );
        });

      if (tasksChanged) {
        // Detect new task
        const oldIds = new Set(oldTasks.map((t) => t.id));
        for (const t of newTasks) {
          if (!oldIds.has(t.id)) {
            this.recordActivity(
              projectId,
              user,
              'task_created',
              `${user.displayName} created task "${t.title}"`,
              t.title,
              undefined,
              false
            );
          } else {
            const oldT = oldTasks.find((ot) => ot.id === t.id);
            if (oldT) {
              if (oldT.status !== 'done' && t.status === 'done') {
                this.recordActivity(
                  projectId,
                  user,
                  'task_completed',
                  `${user.displayName} completed "${t.title}"`,
                  t.title,
                  undefined,
                  false
                );
              } else if (oldT.status === 'done' && t.status !== 'done') {
                this.recordActivity(
                  projectId,
                  user,
                  'task_reopened',
                  `${user.displayName} reopened "${t.title}"`,
                  t.title,
                  undefined,
                  false
                );
              } else if (oldT.assigneeId !== t.assigneeId && t.assigneeName) {
                this.recordActivity(
                  projectId,
                  user,
                  'task_assigned',
                  `${user.displayName} assigned "${t.title}" to ${t.assigneeName}`,
                  t.title,
                  undefined,
                  false
                );
              } else if (oldT.assigneeId && !t.assigneeId) {
                this.recordActivity(
                  projectId,
                  user,
                  'task_unassigned',
                  `${user.displayName} unassigned "${t.title}"`,
                  t.title,
                  undefined,
                  false
                );
              } else if (
                (oldT.status === 'todo' && t.status === 'in_progress') ||
                (oldT.status === 'in_progress' && t.status === 'todo')
              ) {
                const statusText = t.status === 'in_progress' ? 'in progress' : 'to-do';
                this.recordActivity(
                  projectId,
                  user,
                  'task_status_changed',
                  `${user.displayName} marked "${t.title}" as ${statusText}`,
                  t.title,
                  undefined,
                  false
                );
              } else if (
                oldT.title !== t.title ||
                (oldT.note || undefined) !== (t.note || undefined) ||
                (oldT.dueDate || undefined) !== (t.dueDate || undefined)
              ) {
                this.recordActivity(
                  projectId,
                  user,
                  'task_updated',
                  `${user.displayName} updated task "${t.title}"`,
                  t.title,
                  undefined,
                  false
                );
              }
            }
          }
        }

        // Detect deleted tasks
        const newIds = new Set(newTasks.map((t) => t.id));
        for (const ot of oldTasks) {
          if (!newIds.has(ot.id)) {
            this.recordActivity(
              projectId,
              user,
              'task_deleted',
              `${user.displayName} deleted task "${ot.title}"`,
              ot.title,
              undefined,
              false
            );
          }
        }

        project.workspace.tasks.tasks = newTasks;
        project.workspace.tasks.revision = (project.workspace.tasks.revision || 1) + 1;
        project.workspace.tasks.updatedAt = now;
        project.workspace.tasks.updatedBy = user.id;
        project.workspace.tasks.updatedByName = user.displayName;
      }
    }

      if (lyricsChanged || notesChanged || structureChanged || tasksChanged) {
        project.updatedAt = now;
        project.lastActivityAt = now;
        try {
          await this.persistProject(project);
        } catch (err) {
          this.projects.set(projectId, snapshot);
          throw err;
        }
      }

      return JSON.parse(JSON.stringify(project)) as Project;
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

  async deleteProject(projectId: string, userId: string): Promise<boolean> {
    return this.runProjectTransaction(projectId, async () => {
      const project = this.projects.get(projectId);
      if (!project) return false;
      // Only the project owner can delete
      if (!this.isOwner(projectId, userId)) return false;

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
      const project = this.getProject(projectId, userId);
      if (!project) return null;

      // Only the project owner can add collaborators, assign roles, or grant owner authority
      if (!this.isOwner(projectId, userId)) {
        return null;
      }

      // Do not allow assigning the owner role to collaborators
      if ((role as string) === 'owner') {
        return null;
      }

      if (collaborator.id === project.ownerId) {
        return project;
      }

      const snapshot = JSON.parse(JSON.stringify(project)) as Project;
      const existingIdx = project.collaborators.findIndex((c) => c.userId === collaborator.id);
      const now = Date.now();

      if (existingIdx >= 0) {
        project.collaborators[existingIdx]!.role = role;
      } else {
        if (project.collaborators.length >= PROJECT_LIMITS.MAX_COLLABORATORS_PER_PROJECT) {
          throw new ProjectLimitError(
            `Maximum collaborator limit reached (${PROJECT_LIMITS.MAX_COLLABORATORS_PER_PROJECT} collaborators per project).`
          );
        }
        project.collaborators.push({
          userId: collaborator.id,
          displayName: collaborator.displayName,
          username: collaborator.username,
          avatarColor: collaborator.avatarColor || '#06b6d4',
          role,
          addedAt: now
        });
        await this.recordActivity(
          projectId,
          { id: userId, displayName: project.ownerDisplayName },
          'collaborator_added',
          `${project.ownerDisplayName} added ${collaborator.displayName} to the project`,
          collaborator.displayName,
          undefined,
          false
        );
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

  async removeCollaborator(projectId: string, userId: string, targetUserId: string): Promise<Project | null> {
    return this.runProjectTransaction(projectId, async () => {
      const project = this.getProject(projectId, userId);
      if (!project) return null;

      // Only owner or the collaborator themselves can remove
      const isOwner = this.isOwner(projectId, userId);
      if (!isOwner && userId !== targetUserId) {
        return null;
      }

      const snapshot = JSON.parse(JSON.stringify(project)) as Project;
      const target = project.collaborators.find((c) => c.userId === targetUserId);
      project.collaborators = project.collaborators.filter((c) => c.userId !== targetUserId);
      project.updatedAt = Date.now();
      if (target) {
        await this.recordActivity(
          projectId,
          { id: userId, displayName: isOwner ? project.ownerDisplayName : target.displayName },
          'collaborator_removed',
          isOwner
            ? `${project.ownerDisplayName} removed ${target.displayName} from the project`
            : `${target.displayName} left the project`,
          target.displayName,
          undefined,
          false
        );
      }
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

  async recordProjectSession(
    projectId: string,
    session: ProjectSessionItem,
    collaboratorIdentity?: ParticipantIdentity | null
  ): Promise<void> {
    return this.runProjectTransaction(projectId, async () => {
      const project = this.projects.get(projectId);
      if (!project) return;

      const snapshot = JSON.parse(JSON.stringify(project)) as Project;
      const now = Date.now();
      project.lastActivityAt = now;
      project.updatedAt = now;

      // Check if session already exists
      const existingIndex = project.sessions.findIndex((s) => s.code === session.code || s.id === session.id);
      if (existingIndex >= 0) {
        project.sessions[existingIndex] = {
          ...project.sessions[existingIndex],
          ...session,
          endedAt: session.endedAt ?? project.sessions[existingIndex]!.endedAt,
          durationSeconds: session.durationSeconds ?? project.sessions[existingIndex]!.durationSeconds,
          collaborator: session.collaborator || project.sessions[existingIndex]!.collaborator
        };
      } else {
        project.sessions.unshift(session);
        project.sessionCount = project.sessions.length;
        if (session.collaborator?.displayName) {
          await this.recordActivity(
            projectId,
            collaboratorIdentity || { id: session.collaborator.id, displayName: session.collaborator.displayName },
            'session_completed',
            `Session completed with ${session.collaborator.displayName}`,
            session.code,
            undefined,
            false
          );
        }
      }

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
