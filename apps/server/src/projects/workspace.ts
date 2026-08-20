import type {
  Project,
  UserProfile,
  UpdateProjectWorkspaceRequest,
  ProjectActivityType,
  ProjectActivityItem
} from '@jameet/shared';
import { WorkspaceConflictError, WorkspaceLimitError } from './errors.js';
import { PROJECT_LIMITS } from './limits.js';

export function applyWorkspaceUpdates(context: {
  project: Project;
  user: UserProfile;
  updates: UpdateProjectWorkspaceRequest;
  recordActivity: (
    projectId: string,
    user: { id?: string; displayName?: string; username?: string; avatarColor?: string; avatarUrl?: string },
    type: ProjectActivityType,
    summary: string,
    title?: string,
    metadata?: Record<string, unknown>,
    persist?: boolean
  ) => Promise<ProjectActivityItem | null>;
}): { changed: boolean } {
  const { project, user, updates, recordActivity } = context;

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
      if (t.songId && t.songId.length > PROJECT_LIMITS.MAX_TASK_SONG_ID_LENGTH) {
        throw new WorkspaceLimitError(
          'tasks',
          `Task song ID exceeds maximum length of ${PROJECT_LIMITS.MAX_TASK_SONG_ID_LENGTH} characters.`
        );
      }
      if (t.stage && t.stage.length > PROJECT_LIMITS.MAX_TASK_STAGE_LENGTH) {
        throw new WorkspaceLimitError(
          'tasks',
          `Task stage exceeds maximum length of ${PROJECT_LIMITS.MAX_TASK_STAGE_LENGTH} characters.`
        );
      }
      if (t.subtasks && Array.isArray(t.subtasks)) {
        if (t.subtasks.length > PROJECT_LIMITS.MAX_TASK_SUBTASKS_COUNT) {
          throw new WorkspaceLimitError(
            'tasks',
            `Task subtasks limit exceeded (max ${PROJECT_LIMITS.MAX_TASK_SUBTASKS_COUNT} subtasks per task).`
          );
        }
        for (const st of t.subtasks) {
          if (st.title && st.title.length > PROJECT_LIMITS.MAX_TASK_SUBTASK_TITLE_LENGTH) {
            throw new WorkspaceLimitError(
              'tasks',
              `Subtask title exceeds maximum length of ${PROJECT_LIMITS.MAX_TASK_SUBTASK_TITLE_LENGTH} characters.`
            );
          }
        }
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
        return { changed: false };
      }
      updates.lyrics.documentId = updates.lyrics.documentId.trim();
    }

    if (updates.lyrics.documents !== undefined) {
      const seenDocIds = new Set<string>();
      for (const d of updates.lyrics.documents) {
        if (!d.id || typeof d.id !== 'string' || d.id.trim().length === 0) {
          return { changed: false };
        }
        if (seenDocIds.has(d.id)) {
          return { changed: false };
        }
        seenDocIds.add(d.id);
      }
    }
  }

  if (updates.structure && updates.structure.sections !== undefined) {
    const seenSectionIds = new Set<string>();
    for (const s of updates.structure.sections) {
      if (!s.id || typeof s.id !== 'string' || s.id.trim().length === 0) {
        return { changed: false };
      }
      if (seenSectionIds.has(s.id)) {
        return { changed: false };
      }
      seenSectionIds.add(s.id);
    }
  }

  if (updates.tasks && updates.tasks.tasks !== undefined) {
    const seenTaskIds = new Set<string>();
    for (const t of updates.tasks.tasks) {
      if (!t.id || typeof t.id !== 'string' || t.id.trim().length === 0) {
        return { changed: false };
      }
      if (seenTaskIds.has(t.id)) {
        return { changed: false };
      }
      seenTaskIds.add(t.id);

      if (t.dueDate !== undefined) {
        if (typeof t.dueDate !== 'string') {
          return { changed: false };
        }
        const trimmedDue = t.dueDate.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDue)) {
          return { changed: false };
        }
        const parts = trimmedDue.split('-');
        if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
          return { changed: false };
        }
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        if (m < 1 || m > 12 || d < 1 || d > 31) {
          return { changed: false };
        }
        const date = new Date(Date.UTC(y, m - 1, d));
        if (
          date.getUTCFullYear() !== y ||
          date.getUTCMonth() !== m - 1 ||
          date.getUTCDate() !== d
        ) {
          return { changed: false };
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
          return { changed: false };
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
      activeSongId: 'song-1',
      songs: [],
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
  if (!project.workspace.songs || !Array.isArray(project.workspace.songs)) {
    project.workspace.songs = [];
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

  let songsChanged = false;
  let lyricsChanged = false;
  let notesChanged = false;
  let structureChanged = false;
  let tasksChanged = false;

  if (updates.activeSongId && updates.activeSongId !== project.workspace.activeSongId) {
    project.workspace.activeSongId = updates.activeSongId;
    songsChanged = true;
  }
  if (updates.songs && Array.isArray(updates.songs)) {
    project.workspace.songs = updates.songs;
    songsChanged = true;
  }

  if (!project.workspace.songs || !Array.isArray(project.workspace.songs) || project.workspace.songs.length === 0) {
    project.workspace.songs = [
      {
        id: 'song-1',
        title: project.name || 'Song 1',
        order: 0,
        lyrics: JSON.parse(JSON.stringify(project.workspace.lyrics || { revision: 1, activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now }], content: '', updatedAt: now })),
        notes: JSON.parse(JSON.stringify(project.workspace.notes || { revision: 1, content: '', updatedAt: now })),
        structure: JSON.parse(JSON.stringify(project.workspace.structure || { revision: 1, sections: [], updatedAt: now })),
        createdAt: now,
        updatedAt: now
      }
    ];
    project.workspace.activeSongId = 'song-1';
    songsChanged = true;
  }

  const targetSongId = updates.songId || updates.activeSongId || project.workspace.activeSongId || project.workspace.songs[0]?.id || 'song-1';
  const foundSong = project.workspace.songs.find((s) => s && s.id === targetSongId) || project.workspace.songs[0];
  if (!foundSong) {
    throw new Error('No song available in workspace.');
  }
  const targetSong = foundSong;

  if (!targetSong.lyrics) {
    targetSong.lyrics = { revision: 1, activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now }], content: '', updatedAt: now };
  }
  if (!targetSong.notes) {
    targetSong.notes = { revision: 1, content: '', updatedAt: now };
  }
  if (!targetSong.structure) {
    targetSong.structure = { revision: 1, sections: [], updatedAt: now };
  }

  // Pre-mutation Optimistic Concurrency Control (OCC) validation against targeted song
  if (updates.lyrics) {
    const currentRev = targetSong.lyrics.revision ?? 1;
    if (typeof updates.lyrics.baseRevision !== 'number' || updates.lyrics.baseRevision !== currentRev) {
      throw new WorkspaceConflictError('lyrics', currentRev, updates.lyrics.baseRevision);
    }
  }
  if (updates.notes) {
    const currentRev = targetSong.notes.revision ?? 1;
    if (typeof updates.notes.baseRevision !== 'number' || updates.notes.baseRevision !== currentRev) {
      throw new WorkspaceConflictError('notes', currentRev, updates.notes.baseRevision);
    }
  }
  if (updates.structure) {
    const currentRev = targetSong.structure.revision ?? 1;
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

  if (updates.lyrics) {
    const incLyrics = updates.lyrics;
    const curLyrics = targetSong.lyrics;
    if (!curLyrics.documents || curLyrics.documents.length === 0) {
      curLyrics.documents = [
        { id: 'doc-main', title: 'Main Lyrics', content: curLyrics.content || '', updatedAt: now }
      ];
      curLyrics.activeDocumentId = 'doc-main';
    }
    const initialDocsList = (curLyrics.documents || []).map((d) => ({ ...d }));

    if (incLyrics.documents) {
      const oldDocs = new Map(initialDocsList.map((d) => [d.id, { ...d }]));
      let docsModified = initialDocsList.length !== incLyrics.documents.length;
      const newDocs = incLyrics.documents.map((incDoc) => {
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
        curLyrics.documents = newDocs;
        lyricsChanged = true;
      }
    }

    if (incLyrics.documentId !== undefined || incLyrics.title !== undefined || incLyrics.content !== undefined) {
      const targetDocId = incLyrics.documentId || curLyrics.activeDocumentId || curLyrics.documents[0]?.id || 'doc-main';
      let doc = curLyrics.documents.find((d) => d.id === targetDocId);
      if (!doc) {
        doc = {
          id: targetDocId,
          title: incLyrics.title || 'Untitled Lyrics',
          content: incLyrics.content || '',
          updatedAt: now,
          updatedBy: user.id,
          updatedByName: user.displayName
        };
        curLyrics.documents.push(doc);
        lyricsChanged = true;
        recordActivity(
          project.id,
          user,
          'lyrics_doc_created',
          `${user.displayName} created lyrics "${doc.title}"`,
          doc.title,
          undefined,
          false
        );
      } else if (incLyrics.title !== undefined || incLyrics.content !== undefined) {
        const oldTitle = doc.title;
        const oldContent = doc.content;
        let changed = false;
        if (incLyrics.title !== undefined && incLyrics.title.trim().length > 0) {
          const nextTitle = incLyrics.title.trim();
          if (nextTitle !== oldTitle) {
            doc.title = nextTitle;
            changed = true;
            recordActivity(
              project.id,
              user,
              'lyrics_doc_renamed',
              `${user.displayName} renamed lyrics to "${doc.title}"`,
              doc.title,
              undefined,
              false
            );
          }
        }
        if (incLyrics.content !== undefined && incLyrics.content !== oldContent) {
          doc.content = incLyrics.content;
          changed = true;
          recordActivity(
            project.id,
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

    if (incLyrics.activeDocumentId && incLyrics.activeDocumentId !== curLyrics.activeDocumentId) {
      if (curLyrics.documents.some((d) => d.id === incLyrics.activeDocumentId)) {
        curLyrics.activeDocumentId = incLyrics.activeDocumentId;
        lyricsChanged = true;
      }
    }

    if (curLyrics.documents.length === 0) {
      curLyrics.documents = [
        { id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now, updatedBy: user.id, updatedByName: user.displayName }
      ];
      curLyrics.activeDocumentId = 'doc-main';
    }

    if (incLyrics.documents) {
      const finalDocIds = new Set(curLyrics.documents.map((d) => d.id));
      for (const initialDoc of initialDocsList) {
        if (!finalDocIds.has(initialDoc.id)) {
          lyricsChanged = true;
          recordActivity(
            project.id,
            user,
            'lyrics_doc_deleted',
            `${user.displayName} deleted lyrics "${initialDoc.title}"`,
            initialDoc.title,
            undefined,
            false
          );
        }
      }
    }

    if (!curLyrics.activeDocumentId || !curLyrics.documents.some((d) => d.id === curLyrics.activeDocumentId)) {
      curLyrics.activeDocumentId = curLyrics.documents[0]?.id || 'doc-main';
    }

    const activeDoc = curLyrics.documents.find((d) => d.id === curLyrics.activeDocumentId) || curLyrics.documents[0];
    const activeDocContent = activeDoc ? activeDoc.content : '';
    if (curLyrics.content !== activeDocContent) {
      curLyrics.content = activeDocContent;
    }

    if (lyricsChanged) {
      curLyrics.revision = (curLyrics.revision || 1) + 1;
      curLyrics.updatedAt = now;
      curLyrics.updatedBy = user.id;
      curLyrics.updatedByName = user.displayName;
      targetSong.updatedAt = now;
    }
  }

  if (updates.notes) {
    const curNotes = targetSong.notes;
    const oldBpm = curNotes.bpm;
    const oldKey = curNotes.key;
    const oldContent = curNotes.content;

    const normalizedOldBpm = oldBpm ? oldBpm.trim() : '';
    const normalizedNewBpm = updates.notes.bpm !== undefined ? (updates.notes.bpm ? updates.notes.bpm.trim() : '') : undefined;

    const normalizedOldKey = oldKey ? oldKey.trim() : '';
    const normalizedNewKey = updates.notes.key !== undefined ? (updates.notes.key ? updates.notes.key.trim() : '') : undefined;

    const bpmDiff = normalizedNewBpm !== undefined && normalizedNewBpm !== normalizedOldBpm;
    const keyDiff = normalizedNewKey !== undefined && normalizedNewKey !== normalizedOldKey;
    const contentDiff = updates.notes.content !== undefined && updates.notes.content !== oldContent;

    if (bpmDiff || keyDiff || contentDiff) {
      notesChanged = true;
      curNotes.content = updates.notes.content !== undefined ? updates.notes.content : curNotes.content;
      curNotes.bpm = updates.notes.bpm !== undefined ? updates.notes.bpm : curNotes.bpm;
      curNotes.key = updates.notes.key !== undefined ? updates.notes.key : curNotes.key;
      curNotes.revision = (curNotes.revision || 1) + 1;
      curNotes.updatedAt = now;
      curNotes.updatedBy = user.id;
      curNotes.updatedByName = user.displayName;
      targetSong.updatedAt = now;

      if (bpmDiff) {
        if (normalizedNewBpm) {
          recordActivity(
            project.id,
            user,
            'notes_bpm_changed',
            `${user.displayName} set tempo to ${updates.notes.bpm} BPM`,
            `${updates.notes.bpm} BPM`,
            undefined,
            false
          );
        } else if (normalizedOldBpm) {
          recordActivity(
            project.id,
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
          recordActivity(
            project.id,
            user,
            'notes_key_changed',
            `${user.displayName} changed key to ${updates.notes.key}`,
            updates.notes.key,
            undefined,
            false
          );
        } else if (normalizedOldKey) {
          recordActivity(
            project.id,
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
          recordActivity(
            project.id,
            user,
            'notes_edited',
            `${user.displayName} cleared Project Notes`,
            'Project Notes',
            undefined,
            false
          );
        } else if (!isNewEmpty && updates.notes.content !== oldContent) {
          recordActivity(
            project.id,
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
      const curStructure = targetSong.structure;
      const oldSections = curStructure.sections || [];
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
        curStructure.sections = newSections;
        curStructure.revision = (curStructure.revision || 1) + 1;
        curStructure.updatedAt = now;
        curStructure.updatedBy = user.id;
        curStructure.updatedByName = user.displayName;
        targetSong.updatedAt = now;
        recordActivity(
          project.id,
          user,
          'structure_changed',
          `${user.displayName} updated arrangement structure for ${targetSong.title}`,
          `Structure (${targetSong.title})`,
          undefined,
          false
        );
      }
    }
  }

  // Mirror active song to top-level for backward compatibility and session listeners
  const finalActiveId = project.workspace.activeSongId || project.workspace.songs[0]?.id || 'song-1';
  const finalActiveSong = project.workspace.songs.find((s) => s && s.id === finalActiveId) || project.workspace.songs[0];
  if (finalActiveSong) {
    project.workspace.activeSongId = finalActiveSong.id;
    project.workspace.lyrics = JSON.parse(JSON.stringify(finalActiveSong.lyrics));
    project.workspace.notes = JSON.parse(JSON.stringify(finalActiveSong.notes));
    project.workspace.structure = JSON.parse(JSON.stringify(finalActiveSong.structure));
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
          (oldT.songId || undefined) !== (newT.songId || undefined) ||
          (oldT.stage || undefined) !== (newT.stage || undefined) ||
          JSON.stringify(oldT.subtasks || []) !== JSON.stringify(newT.subtasks || []) ||
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
          recordActivity(
            project.id,
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
              recordActivity(
                project.id,
                user,
                'task_completed',
                `${user.displayName} completed "${t.title}"`,
                t.title,
                undefined,
                false
              );
            } else if (oldT.status === 'done' && t.status !== 'done') {
              recordActivity(
                project.id,
                user,
                'task_reopened',
                `${user.displayName} reopened "${t.title}"`,
                t.title,
                undefined,
                false
              );
            } else if (oldT.assigneeId !== t.assigneeId && t.assigneeName) {
              recordActivity(
                project.id,
                user,
                'task_assigned',
                `${user.displayName} assigned "${t.title}" to ${t.assigneeName}`,
                t.title,
                undefined,
                false
              );
            } else if (oldT.assigneeId && !t.assigneeId) {
              recordActivity(
                project.id,
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
              recordActivity(
                project.id,
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
              recordActivity(
                project.id,
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
          recordActivity(
            project.id,
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
    }
  }

  const changed = Boolean(lyricsChanged || notesChanged || structureChanged || tasksChanged || songsChanged);
  return { changed };
}
