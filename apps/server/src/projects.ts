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

export interface ProjectDatabaseSchema {
  version: number;
  projects: Project[];
}

export class ProjectStore {
  private projects = new Map<string, Project>(); // projectId -> Project
  private dataFilePath: string;

  constructor(storageDir?: string) {
    const baseDir = storageDir ?? path.join(process.cwd(), 'data');
    if (!fs.existsSync(baseDir)) {
      try { fs.mkdirSync(baseDir, { recursive: true }); } catch { /* ignore */ }
    }
    const legacyPath = path.join(baseDir, 'musiczoom-projects.json');
    const primaryPath = path.join(baseDir, 'jameet-projects.json');
    this.dataFilePath = !fs.existsSync(primaryPath) && fs.existsSync(legacyPath) ? legacyPath : primaryPath;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.dataFilePath)) return;
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
            lyrics: { activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: p.updatedAt || p.createdAt || Date.now() }], content: '', updatedAt: p.updatedAt || p.createdAt || Date.now() },
            notes: { content: '', updatedAt: p.updatedAt || p.createdAt || Date.now() },
            structure: { sections: [], updatedAt: p.updatedAt || p.createdAt || Date.now() },
            tasks: { tasks: [], updatedAt: p.updatedAt || p.createdAt || Date.now() }
          };
        } else {
          if (!p.workspace.structure) {
            p.workspace.structure = { sections: [], updatedAt: p.updatedAt || p.createdAt || Date.now() };
          }
          if (!p.workspace.tasks) {
            p.workspace.tasks = { tasks: [], updatedAt: p.updatedAt || p.createdAt || Date.now() };
          }
        }
        this.projects.set(p.id, p);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load project datastore from ${this.dataFilePath}: ${message}`);
    }
  }

  private saveToDisk(): void {
    const schema: ProjectDatabaseSchema = {
      version: 1,
      projects: Array.from(this.projects.values())
    };
    const dir = path.dirname(this.dataFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${this.dataFilePath}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(schema, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.dataFilePath);
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {
        // ignore tmp cleanup error
      }
      console.error('Failed to persist project database:', err);
      throw err;
    }
  }

  createSnapshot(): string {
    return JSON.stringify({
      projects: Array.from(this.projects.values())
    });
  }

  restoreSnapshot(snapshotJson: string): void {
    const data = JSON.parse(snapshotJson) as ProjectDatabaseSchema;
    this.projects.clear();
    if (Array.isArray(data.projects)) {
      for (const p of data.projects) {
        this.projects.set(p.id, p);
      }
    }
    this.saveToDisk();
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

  createProject(
    owner: UserProfile,
    data: CreateProjectRequest,
    collaboratorUsers: UserProfile[] = []
  ): Project {
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
        notes: { content: '', updatedAt: now },
        structure: { sections: [], updatedAt: now },
        tasks: { tasks: [], updatedAt: now }
      },
      metadata: {}
    };

    this.projects.set(id, project);
    this.recordActivity(
      id,
      owner,
      'project_created',
      `${owner.displayName} created project "${project.name}"`,
      project.name,
      undefined,
      false
    );
    try {
      this.saveToDisk();
    } catch (err) {
      this.projects.delete(id);
      throw err;
    }
    return project;
  }

  recordActivity(
    projectId: string,
    user: { id?: string; displayName?: string; username?: string; avatarColor?: string },
    type: ProjectActivityType,
    summary: string,
    title?: string,
    metadata?: Record<string, unknown>,
    persist = true
  ): ProjectActivityItem | null {
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
            this.saveToDisk();
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
        this.saveToDisk();
      } catch (err) {
        if (snapshot) this.projects.set(projectId, snapshot);
        throw err;
      }
    }
    return item;
  }

  updateWorkspace(
    projectId: string,
    user: UserProfile,
    updates: UpdateProjectWorkspaceRequest
  ): Project | null {
    const project = this.getProject(projectId, user.id);
    if (!project) return null;

    if (!this.canModifyWorkspace(projectId, user.id)) {
      return null;
    }

    // Validate lyrics documents and documentId before performing any workspace mutation or activity recording
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

    // Validate song structure sections (identities and uniqueness) before performing any workspace mutation or activity recording
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

    // Validate tasks (identities, dueDates, and assignees) before performing any workspace mutation or activity recording
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

    const snapshot = JSON.parse(JSON.stringify(project)) as Project;
    const now = Date.now();
    if (!project.workspace) {
      project.workspace = {
        lyrics: {
          activeDocumentId: 'doc-main',
          documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now }],
          content: '',
          updatedAt: now
        },
        notes: { content: '', updatedAt: now },
        structure: { sections: [], updatedAt: now },
        tasks: { tasks: [], updatedAt: now }
      };
    }
    if (!project.workspace.structure) {
      project.workspace.structure = { sections: [], updatedAt: now };
    }
    if (!project.workspace.tasks) {
      project.workspace.tasks = { tasks: [], updatedAt: now };
    }

    if (updates.lyrics) {
      const curLyrics = project.workspace.lyrics;
      if (!curLyrics.documents || curLyrics.documents.length === 0) {
        curLyrics.documents = [
          { id: 'doc-main', title: 'Main Lyrics', content: curLyrics.content || '', updatedAt: now }
        ];
        curLyrics.activeDocumentId = 'doc-main';
      }

      if (updates.lyrics.documents) {
        const oldDocs = new Map((curLyrics.documents || []).map((d) => [d.id, { ...d }]));
        curLyrics.documents = updates.lyrics.documents.map((incDoc) => {
          const existing = oldDocs.get(incDoc.id);
          if (existing) {
            const hasTitleUpdate = incDoc.title !== undefined && incDoc.title.trim().length > 0;
            const newTitle = hasTitleUpdate ? incDoc.title.trim() : existing.title;
            const newContent = incDoc.content !== undefined ? incDoc.content : existing.content;
            const titleChanged = newTitle !== existing.title;
            const contentChanged = newContent !== existing.content;

            if (titleChanged || contentChanged) {
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
          return {
            id: incDoc.id,
            title: incDoc.title ? incDoc.title.trim() : 'Untitled Lyrics',
            content: incDoc.content || '',
            updatedAt: now,
            updatedBy: user.id,
            updatedByName: user.displayName
          };
        });
        if (curLyrics.documents.length === 0) {
          curLyrics.documents = [
            { id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now, updatedBy: user.id, updatedByName: user.displayName }
          ];
          curLyrics.activeDocumentId = 'doc-main';
        }
      }

      if (updates.lyrics.activeDocumentId) {
        curLyrics.activeDocumentId = updates.lyrics.activeDocumentId;
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
            doc.title = updates.lyrics.title.trim();
            if (doc.title !== oldTitle) {
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
          if (updates.lyrics.content !== undefined) {
            doc.content = updates.lyrics.content;
            if (doc.content !== oldContent) {
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
          }
          if (changed) {
            doc.updatedAt = now;
            doc.updatedBy = user.id;
            doc.updatedByName = user.displayName;
          }
        }
      }

      // Ensure activeDocumentId is still valid after any document additions
      if (!curLyrics.activeDocumentId || !curLyrics.documents.some((d) => d.id === curLyrics.activeDocumentId)) {
        curLyrics.activeDocumentId = curLyrics.documents[0]?.id || 'doc-main';
      }

      // Sync active document content to top-level content for backwards compatibility
      const activeDoc = curLyrics.documents.find((d) => d.id === curLyrics.activeDocumentId) || curLyrics.documents[0];
      curLyrics.content = activeDoc ? activeDoc.content : '';
      curLyrics.updatedAt = now;
      curLyrics.updatedBy = user.id;
      curLyrics.updatedByName = user.displayName;
    }

    if (updates.notes) {
      const oldBpm = project.workspace.notes.bpm;
      const oldKey = project.workspace.notes.key;
      const oldContent = project.workspace.notes.content;

      const normalizedOldBpm = oldBpm ? oldBpm.trim() : '';
      const normalizedNewBpm = updates.notes.bpm !== undefined ? (updates.notes.bpm ? updates.notes.bpm.trim() : '') : undefined;

      const normalizedOldKey = oldKey ? oldKey.trim() : '';
      const normalizedNewKey = updates.notes.key !== undefined ? (updates.notes.key ? updates.notes.key.trim() : '') : undefined;

      project.workspace.notes = {
        content: updates.notes.content !== undefined ? updates.notes.content : project.workspace.notes.content,
        bpm: updates.notes.bpm !== undefined ? updates.notes.bpm : project.workspace.notes.bpm,
        key: updates.notes.key !== undefined ? updates.notes.key : project.workspace.notes.key,
        updatedAt: now,
        updatedBy: user.id,
        updatedByName: user.displayName
      };

      if (normalizedNewBpm !== undefined && normalizedNewBpm !== normalizedOldBpm) {
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
      if (normalizedNewKey !== undefined && normalizedNewKey !== normalizedOldKey) {
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
      if (updates.notes.content !== undefined && updates.notes.content !== oldContent && updates.notes.content.trim()) {
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

    if (updates.structure) {
      if (updates.structure.sections !== undefined) {
        project.workspace.structure.sections = updates.structure.sections;
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
      project.workspace.structure.updatedAt = now;
      project.workspace.structure.updatedBy = user.id;
      project.workspace.structure.updatedByName = user.displayName;
    }

    if (updates.tasks && updates.tasks.tasks !== undefined) {
      const oldTasks = project.workspace.tasks.tasks || [];
      const newTasks = updates.tasks.tasks;

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
      project.workspace.tasks.updatedAt = now;
      project.workspace.tasks.updatedBy = user.id;
      project.workspace.tasks.updatedByName = user.displayName;
    }

    project.updatedAt = now;
    project.lastActivityAt = now;
    try {
      this.saveToDisk();
    } catch (err) {
      this.projects.set(projectId, snapshot);
      throw err;
    }
    return project;
  }

  updateProject(projectId: string, userId: string, data: UpdateProjectRequest): Project | null {
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
      this.saveToDisk();
    } catch (err) {
      this.projects.set(projectId, snapshot);
      throw err;
    }
    return project;
  }

  deleteProject(projectId: string, userId: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;
    // Only the project owner can delete
    if (!this.isOwner(projectId, userId)) return false;

    const snapshot = JSON.parse(JSON.stringify(project)) as Project;
    this.projects.delete(projectId);
    try {
      this.saveToDisk();
    } catch (err) {
      this.projects.set(projectId, snapshot);
      throw err;
    }
    return true;
  }

  addCollaborator(
    projectId: string,
    userId: string,
    collaborator: UserProfile,
    role: ProjectCollaboratorRole = 'collaborator'
  ): Project | null {
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
      project.collaborators.push({
        userId: collaborator.id,
        displayName: collaborator.displayName,
        username: collaborator.username,
        avatarColor: collaborator.avatarColor || '#06b6d4',
        role,
        addedAt: now
      });
      this.recordActivity(
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
      this.saveToDisk();
    } catch (err) {
      this.projects.set(projectId, snapshot);
      throw err;
    }
    return project;
  }

  removeCollaborator(projectId: string, userId: string, targetUserId: string): Project | null {
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
      this.recordActivity(
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
      this.saveToDisk();
    } catch (err) {
      this.projects.set(projectId, snapshot);
      throw err;
    }
    return project;
  }

  recordProjectSession(
    projectId: string,
    session: ProjectSessionItem,
    collaboratorIdentity?: ParticipantIdentity | null
  ): void {
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
        this.recordActivity(
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
      this.saveToDisk();
    } catch (err) {
      this.projects.set(projectId, snapshot);
      throw err;
    }
  }
}
