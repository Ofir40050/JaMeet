import type {
  Project,
  ProjectSongItem,
  UpdateProjectWorkspaceRequest,
  UserProfile
} from '@jameet/shared';
import * as projectsApi from '../../projects/core/projects';
import {
  reconcileNotesWorkspace,
  type NotesStateValues
} from './notesReconciliation';
import {
  getLastSyncedNotes,
  getLastSyncedNotesBpm,
  getLastSyncedNotesKey,
  setLastSyncedNotes,
  setLastSyncedNotesBpm,
  setLastSyncedNotesKey
} from '../core/workspaceSyncState';

export interface NotesPersistenceOptions {
  getProject: () => Project | null | undefined;
  getAuthToken: () => string | null;
  getUser: () => UserProfile | null | undefined;
  canEdit: () => boolean;
  getActiveSong: () => ProjectSongItem;
  getWorkspaceContextGen: () => number;
  getNotesEditGen: () => number;
  getNotesSaveGen: () => number;
  incrementNotesSaveGen: () => number;
  setNotesStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  onSyncNotesControls: (
    values: { content?: string; bpm?: string; key?: string },
    force?: boolean
  ) => void;
  onSignalingUpdate: (
    projectId: string,
    payload: any,
    token: string
  ) => Promise<{ ok: boolean; conflict?: boolean; code?: string; workspace?: any; project?: any; currentRevision?: number } | null>;
  onApplyAuthoritativeWorkspace: (area: 'notes', workspace: any) => void;
  onRenderProjectActivities: (project: Project, user?: UserProfile | null) => void;
}

let persistenceOptions: NotesPersistenceOptions | null = null;
let notesSaveTimeout: ReturnType<typeof setTimeout> | null = null;

export function initNotesPersistence(options: NotesPersistenceOptions): void {
  persistenceOptions = options;
}

export function hasNotesSaveTimeout(): boolean {
  return notesSaveTimeout !== null;
}

export function clearNotesSaveTimeout(): void {
  if (notesSaveTimeout) {
    clearTimeout(notesSaveTimeout);
    notesSaveTimeout = null;
  }
}

export function debounceSaveNotesRetry(content?: string, bpm?: string, key?: string): void {
  if (notesSaveTimeout) {
    clearTimeout(notesSaveTimeout);
  }
  if (persistenceOptions) {
    persistenceOptions.setNotesStatus('saving');
  }
  notesSaveTimeout = setTimeout(() => {
    notesSaveTimeout = null;
    void saveNotesWorkspace(content, bpm, key);
  }, 350);
}

export async function saveNotesWorkspace(
  content?: string,
  bpm?: string,
  key?: string
): Promise<void> {
  if (!persistenceOptions || !persistenceOptions.canEdit()) return;
  const activeProject = persistenceOptions.getProject();
  if (!activeProject) return;

  const token = persistenceOptions.getAuthToken();
  if (!token) {
    persistenceOptions.setNotesStatus('unsaved');
    return;
  }

  const activeSong = persistenceOptions.getActiveSong();
  const targetProjectId = activeProject.id;
  const targetContextGen = persistenceOptions.getWorkspaceContextGen();
  const targetEditGen = persistenceOptions.getNotesEditGen();
  const targetSaveGen = persistenceOptions.incrementNotesSaveGen();
  const baseRevision = activeSong.notes?.revision ?? 1;

  if (activeSong.notes) {
    activeSong.notes.content = content || '';
    activeSong.notes.bpm = bpm;
    activeSong.notes.key = key;
    activeSong.updatedAt = Date.now();
  }
  if (activeProject.workspace?.notes) {
    activeProject.workspace.notes.content = content || '';
    activeProject.workspace.notes.bpm = bpm;
    activeProject.workspace.notes.key = key;
  }

  const payload: UpdateProjectWorkspaceRequest = {
    activeSongId: activeSong.id,
    songId: activeSong.id,
    songs: activeProject.workspace?.songs,
    notes: { baseRevision, content, bpm, key }
  };

  try {
    let res = await persistenceOptions.onSignalingUpdate(targetProjectId, payload, token);

    if (!res?.ok && !res?.conflict && res?.code !== 'WORKSPACE_CONFLICT') {
      try {
        const httpRes = await projectsApi.updateProjectWorkspace(token, targetProjectId, payload);
        if (httpRes?.workspace) {
          res = { ok: true, workspace: httpRes.workspace, project: httpRes.project };
        }
      } catch (httpErr: any) {
        console.warn('HTTP workspace update fallback failed for notes:', httpErr);
      }
    }

    const currentProject = persistenceOptions.getProject();
    const isLatest =
      currentProject?.id === targetProjectId &&
      targetContextGen === persistenceOptions.getWorkspaceContextGen() &&
      targetSaveGen === persistenceOptions.getNotesSaveGen() &&
      targetEditGen === persistenceOptions.getNotesEditGen();

    if (!isLatest) return;

    if (res?.ok && res.workspace && currentProject) {
      persistenceOptions.onApplyAuthoritativeWorkspace('notes', res.workspace);
      if (res.project?.activities) {
        currentProject.activities = res.project.activities;
        persistenceOptions.onRenderProjectActivities(currentProject, persistenceOptions.getUser());
      }
      setLastSyncedNotes(res.workspace.notes?.content ?? content);
      setLastSyncedNotesBpm(res.workspace.notes?.bpm ?? bpm);
      setLastSyncedNotesKey(res.workspace.notes?.key ?? key);
      persistenceOptions.setNotesStatus('saved');
    } else if ((res?.conflict || res?.code === 'WORKSPACE_CONFLICT') && res.workspace?.notes && currentProject) {
      // Confirmed WORKSPACE_CONFLICT on Notes: safely reconcile content, BPM, and Key against authoritative server state
      const baseNotes: NotesStateValues = {
        content: getLastSyncedNotes(),
        bpm: getLastSyncedNotesBpm(),
        key: getLastSyncedNotesKey()
      };
      const localNotes: NotesStateValues = {
        content: currentProject.workspace?.notes?.content ?? content,
        bpm: currentProject.workspace?.notes?.bpm ?? bpm,
        key: currentProject.workspace?.notes?.key ?? key
      };
      const remoteNotes: NotesStateValues = {
        content: res.workspace.notes.content ?? '',
        bpm: res.workspace.notes.bpm ?? '',
        key: res.workspace.notes.key ?? ''
      };

      const reconciliation = reconcileNotesWorkspace(baseNotes, localNotes, remoteNotes);

      if (reconciliation.hasUnresolvableConflict) {
        if (currentProject.workspace?.notes) {
          currentProject.workspace.notes.content = reconciliation.content;
        }
        persistenceOptions.onSyncNotesControls({ content: reconciliation.content });
        persistenceOptions.setNotesStatus('unsaved');
        return;
      }

      persistenceOptions.onSyncNotesControls({
        content: reconciliation.content,
        bpm: reconciliation.bpmChangedRemotely ? reconciliation.bpm : undefined,
        key: reconciliation.keyChangedRemotely ? reconciliation.key : undefined
      });

      setLastSyncedNotes(remoteNotes.content || '');
      setLastSyncedNotesBpm(remoteNotes.bpm || '');
      setLastSyncedNotesKey(remoteNotes.key || '');

      const nextRevision =
        res.workspace.notes.revision ??
        (res.currentRevision ?? currentProject.workspace?.notes?.revision ?? 1);

      if (currentProject.workspace?.notes) {
        currentProject.workspace.notes.content = reconciliation.content;
        currentProject.workspace.notes.bpm = reconciliation.bpm;
        currentProject.workspace.notes.key = reconciliation.key;
        currentProject.workspace.notes.revision = nextRevision;
      }

      persistenceOptions.setNotesStatus('saving');
      if (notesSaveTimeout) clearTimeout(notesSaveTimeout);
      notesSaveTimeout = setTimeout(() => {
        notesSaveTimeout = null;
        void saveNotesWorkspace(reconciliation.content, reconciliation.bpm, reconciliation.key);
      }, 350);
    } else {
      persistenceOptions.setNotesStatus('unsaved');
    }
  } catch (err) {
    console.error('Failed to save notes:', err);
    const currentProject = persistenceOptions.getProject();
    const isLatest =
      currentProject?.id === targetProjectId &&
      targetContextGen === persistenceOptions.getWorkspaceContextGen() &&
      targetSaveGen === persistenceOptions.getNotesSaveGen() &&
      targetEditGen === persistenceOptions.getNotesEditGen();

    if (isLatest) {
      persistenceOptions.setNotesStatus('unsaved');
    }
  }
}
