import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  Project,
  ProjectCollaborator,
  ProjectCollaboratorRole,
  ProjectSessionItem,
  ProjectActivityItem,
  ProjectActivityType,
  CreateProjectRequest,
  UpdateProjectRequest,
  UpdateProjectWorkspaceRequest,
  ProjectWorkspace,
  UserProfile,
  ParticipantIdentity
} from '@musiczoom/shared';

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
    this.dataFilePath = path.join(baseDir, 'musiczoom-projects.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.dataFilePath)) return;
    try {
      const raw = fs.readFileSync(this.dataFilePath, 'utf-8');
      const data = JSON.parse(raw) as ProjectDatabaseSchema;
      if (Array.isArray(data.projects)) {
        for (const p of data.projects) {
          if (!Array.isArray(p.activities)) {
            p.activities = [];
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
      }
    } catch (err) {
      console.warn('Could not read project database, starting fresh:', err);
    }
  }

  private saveToDisk(): void {
    try {
      const schema: ProjectDatabaseSchema = {
        version: 1,
        projects: Array.from(this.projects.values())
      };
      const tmpPath = `${this.dataFilePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(schema, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.dataFilePath);
    } catch (err) {
      console.error('Failed to persist project database:', err);
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
      project.name
    );
    this.saveToDisk();
    return project;
  }

  recordActivity(
    projectId: string,
    user: { id?: string; displayName?: string; username?: string; avatarColor?: string },
    type: ProjectActivityType,
    summary: string,
    title?: string,
    metadata?: Record<string, unknown>
  ): ProjectActivityItem | null {
    const project = this.projects.get(projectId);
    if (!project) return null;
    if (!Array.isArray(project.activities)) {
      project.activities = [];
    }

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
        this.saveToDisk();
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
    this.saveToDisk();
    return item;
  }

  updateWorkspace(
    projectId: string,
    user: UserProfile,
    updates: UpdateProjectWorkspaceRequest
  ): Project | null {
    const project = this.getProject(projectId, user.id);
    if (!project) return null;

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
        curLyrics.documents = updates.lyrics.documents;
      }

      if (updates.lyrics.activeDocumentId) {
        curLyrics.activeDocumentId = updates.lyrics.activeDocumentId;
      }

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
          doc.title
        );
      } else {
        const oldTitle = doc.title;
        const oldContent = doc.content;
        if (updates.lyrics.title !== undefined && updates.lyrics.title.trim().length > 0) {
          doc.title = updates.lyrics.title.trim();
          if (doc.title !== oldTitle) {
            this.recordActivity(
              projectId,
              user,
              'lyrics_doc_renamed',
              `${user.displayName} renamed lyrics draft to "${doc.title}"`,
              doc.title
            );
          }
        }
        if (updates.lyrics.content !== undefined) {
          doc.content = updates.lyrics.content;
          if (doc.content !== oldContent) {
            this.recordActivity(
              projectId,
              user,
              'lyrics_edited',
              `${user.displayName} edited ${doc.title}`,
              doc.title
            );
          }
        }
        doc.updatedAt = now;
        doc.updatedBy = user.id;
        doc.updatedByName = user.displayName;
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

      project.workspace.notes = {
        content: updates.notes.content !== undefined ? updates.notes.content : project.workspace.notes.content,
        bpm: updates.notes.bpm !== undefined ? updates.notes.bpm : project.workspace.notes.bpm,
        key: updates.notes.key !== undefined ? updates.notes.key : project.workspace.notes.key,
        updatedAt: now,
        updatedBy: user.id,
        updatedByName: user.displayName
      };

      if (updates.notes.bpm !== undefined && updates.notes.bpm !== oldBpm && updates.notes.bpm.trim()) {
        this.recordActivity(
          projectId,
          user,
          'notes_bpm_changed',
          `${user.displayName} set tempo to ${updates.notes.bpm} BPM`,
          `${updates.notes.bpm} BPM`
        );
      }
      if (updates.notes.key !== undefined && updates.notes.key !== oldKey && updates.notes.key.trim()) {
        this.recordActivity(
          projectId,
          user,
          'notes_key_changed',
          `${user.displayName} changed key to ${updates.notes.key}`,
          updates.notes.key
        );
      }
      if (updates.notes.content !== undefined && updates.notes.content !== oldContent && updates.notes.content.trim()) {
        this.recordActivity(
          projectId,
          user,
          'notes_edited',
          `${user.displayName} updated Project Notes`,
          'Project Notes'
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
          'Song Structure'
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
            t.title
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
                t.title
              );
            } else if (oldT.status === 'done' && t.status !== 'done') {
              this.recordActivity(
                projectId,
                user,
                'task_reopened',
                `${user.displayName} reopened "${t.title}"`,
                t.title
              );
            } else if (oldT.assigneeId !== t.assigneeId && t.assigneeName) {
              this.recordActivity(
                projectId,
                user,
                'task_assigned',
                `${user.displayName} assigned "${t.title}" to ${t.assigneeName}`,
                t.title
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
            ot.title
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
    this.saveToDisk();
    return project;
  }

  updateProject(projectId: string, userId: string, data: UpdateProjectRequest): Project | null {
    const project = this.getProject(projectId, userId);
    if (!project) return null;

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
    this.saveToDisk();
    return project;
  }

  deleteProject(projectId: string, userId: string): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;
    // Only the project owner can delete
    if (project.ownerId !== userId) return false;

    this.projects.delete(projectId);
    this.saveToDisk();
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

    if (collaborator.id === project.ownerId) {
      return project;
    }

    const existingIdx = project.collaborators.findIndex((c) => c.userId === collaborator.id);
    const now = Date.now();

    if (existingIdx >= 0) {
      project.collaborators[existingIdx]!.role = role;
    } else {
      project.collaborators.push({
        userId: collaborator.id,
        displayName: collaborator.displayName,
        username: collaborator.username,
        email: collaborator.email,
        avatarColor: collaborator.avatarColor || '#06b6d4',
        role,
        addedAt: now
      });
      this.recordActivity(
        projectId,
        { id: userId, displayName: project.ownerDisplayName },
        'collaborator_added',
        `${project.ownerDisplayName} added ${collaborator.displayName} to the project`,
        collaborator.displayName
      );
    }

    project.updatedAt = now;
    this.projects.set(projectId, project);
    this.saveToDisk();
    return project;
  }

  removeCollaborator(projectId: string, userId: string, targetUserId: string): Project | null {
    const project = this.getProject(projectId, userId);
    if (!project) return null;

    // Only owner or the collaborator themselves can remove
    if (project.ownerId !== userId && userId !== targetUserId) {
      return null;
    }

    const target = project.collaborators.find((c) => c.userId === targetUserId);
    project.collaborators = project.collaborators.filter((c) => c.userId !== targetUserId);
    project.updatedAt = Date.now();
    if (target) {
      this.recordActivity(
        projectId,
        { id: userId, displayName: project.ownerDisplayName },
        'collaborator_removed',
        `${project.ownerDisplayName} removed ${target.displayName} from the project`,
        target.displayName
      );
    }
    this.projects.set(projectId, project);
    this.saveToDisk();
    return project;
  }

  recordProjectSession(
    projectId: string,
    session: ProjectSessionItem,
    collaboratorIdentity?: ParticipantIdentity | null
  ): void {
    const project = this.projects.get(projectId);
    if (!project) return;

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
          session.code
        );
      }
    }

    this.projects.set(projectId, project);
    this.saveToDisk();
  }
}
