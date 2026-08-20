import type { Project, UserProfile } from '@jameet/shared';
import type { SignalingClient } from '@jameet/signaling-client';
import { $ } from '../../core/dom';
import { sanitizeLyricsHtml } from '../../core/htmlSecurity';
import type { LyricsDocItem } from '../lyrics/lyricsDocumentState';
import {
  reconcileNotesWorkspace,
  type NotesStateValues
} from '../notes/notesReconciliation';
import {
  getLastSyncedNotes,
  getLastSyncedNotesBpm,
  getLastSyncedNotesKey,
  setLastSyncedLyrics,
  setLastSyncedNotes,
  setLastSyncedNotesBpm,
  setLastSyncedNotesKey
} from './workspaceSyncState';

export interface WorkspaceRealtimeSyncOptions {
  signaling: SignalingClient;
  getActiveProject: () => Project | null | undefined;
  getSessionProjectId: () => string | null | undefined;
  getUser: () => UserProfile | null | undefined;
  onRenderProjectActivities: (project: Project | null, user?: UserProfile | null) => void;
  getActiveLyricsDoc: () => LyricsDocItem;
  onRenderLyricsDocTabs: (doc: LyricsDocItem) => void;
  onUpdateLyricsStats: (html: string) => void;
  getLyricsStatus: () => 'saved' | 'saving' | 'unsaved';
  setLyricsStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  hasLyricsSaveTimeout: () => boolean;
  getNotesStatus: () => 'saved' | 'saving' | 'unsaved';
  setNotesStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  hasNotesSaveTimeout: () => boolean;
  onSyncNotesControls: (values: { content?: string; bpm?: string; key?: string }) => void;
  onScheduleNotesSaveRetry: (content: string, bpm: string, key: string) => void;
  getStructureStatus: () => 'saved' | 'saving' | 'unsaved';
  setStructureStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  hasStructureSaveTimeout: () => boolean;
  onRenderStructureWorkspace: () => void;
  getTasksStatus: () => 'saved' | 'saving' | 'unsaved';
  setTasksStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  hasTasksSaveTimeout: () => boolean;
  onRenderTasksWorkspace: () => void;
}

export function initWorkspaceRealtimeSync(options: WorkspaceRealtimeSyncOptions): void {
  options.signaling.on('project:workspace:synced', (data: {
    projectId: string;
    workspace: any;
    activities?: any[];
    updatedBy?: string;
    updatedByName?: string;
  }) => {
    if (!data?.workspace) return;
    const activeProject = options.getActiveProject();
    const sessionProjectId = options.getSessionProjectId();
    const matchesCurrent = activeProject?.id === data.projectId || sessionProjectId === data.projectId;
    if (!matchesCurrent) return;

    if (data.activities && activeProject) {
      activeProject.activities = data.activities;
      options.onRenderProjectActivities(activeProject, options.getUser());
    }

    if (!activeProject) return;
    if (!activeProject.workspace) {
      activeProject.workspace = {
        lyrics: {
          activeDocumentId: 'doc-main',
          documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: Date.now() }],
          content: '',
          updatedAt: Date.now()
        },
        notes: { content: '', updatedAt: Date.now() },
        structure: { sections: [], updatedAt: Date.now() },
        tasks: { tasks: [], updatedAt: Date.now() }
      };
    }

    // 1. Sync Lyrics Documents & Active Document
    const hasPendingLyrics =
      options.hasLyricsSaveTimeout() ||
      options.getLyricsStatus() === 'saving' ||
      options.getLyricsStatus() === 'unsaved';

    if (!hasPendingLyrics && data.workspace.lyrics) {
      activeProject.workspace.lyrics = data.workspace.lyrics;
      const activeDoc = options.getActiveLyricsDoc();
      options.onRenderLyricsDocTabs(activeDoc);
      const incomingLyrics = activeDoc.content || '';

      const projectEditor = $('project-lyrics-editor');
      const sessionEditor = $('session-lyrics-editor');
      const isEditingProject = document.activeElement === projectEditor;
      const isEditingSession = document.activeElement === sessionEditor;

      if (!isEditingProject && projectEditor) {
        projectEditor.innerHTML = sanitizeLyricsHtml(incomingLyrics);
      }
      if (!isEditingSession && sessionEditor) {
        sessionEditor.innerHTML = sanitizeLyricsHtml(incomingLyrics);
      }
      options.onUpdateLyricsStats(incomingLyrics);
      setLastSyncedLyrics(incomingLyrics);
      options.setLyricsStatus('saved');
    }

    // 2. Converge Notes
    const incomingNotesContent = data.workspace.notes?.content ?? '';
    const incomingNotesBpm = data.workspace.notes?.bpm ?? '';
    const incomingNotesKey = data.workspace.notes?.key ?? '';

    const currentLocalContent = activeProject.workspace?.notes?.content ?? '';
    const currentLocalBpm = activeProject.workspace?.notes?.bpm ?? '';
    const currentLocalKey = activeProject.workspace?.notes?.key ?? '';

    const hasPendingNotes =
      options.hasNotesSaveTimeout() ||
      options.getNotesStatus() === 'saving' ||
      options.getNotesStatus() === 'unsaved' ||
      currentLocalContent !== getLastSyncedNotes() ||
      currentLocalBpm !== getLastSyncedNotesBpm() ||
      currentLocalKey !== getLastSyncedNotesKey();

    if (hasPendingNotes) {
      const baseNotes: NotesStateValues = {
        content: getLastSyncedNotes(),
        bpm: getLastSyncedNotesBpm(),
        key: getLastSyncedNotesKey()
      };
      const localNotes: NotesStateValues = {
        content: currentLocalContent,
        bpm: currentLocalBpm,
        key: currentLocalKey
      };
      const remoteNotes: NotesStateValues = {
        content: incomingNotesContent,
        bpm: incomingNotesBpm,
        key: incomingNotesKey
      };

      const reconciliation = reconcileNotesWorkspace(baseNotes, localNotes, remoteNotes);

      if (reconciliation.hasUnresolvableConflict) {
        if (activeProject.workspace?.notes) {
          activeProject.workspace.notes.content = reconciliation.content;
        }
        options.onSyncNotesControls({ content: reconciliation.content });
        options.setNotesStatus('unsaved');
      } else {
        options.onSyncNotesControls({
          content: reconciliation.content,
          bpm: reconciliation.bpmChangedRemotely ? reconciliation.bpm : undefined,
          key: reconciliation.keyChangedRemotely ? reconciliation.key : undefined
        });

        setLastSyncedNotes(incomingNotesContent);
        setLastSyncedNotesBpm(incomingNotesBpm);
        setLastSyncedNotesKey(incomingNotesKey);

        if (activeProject.workspace?.notes) {
          activeProject.workspace.notes.content = reconciliation.content;
          activeProject.workspace.notes.bpm = reconciliation.bpm;
          activeProject.workspace.notes.key = reconciliation.key;
          if (data.workspace.notes?.revision !== undefined) {
            activeProject.workspace.notes.revision = data.workspace.notes.revision;
          }
        }

        const hasLocalRemainingChanges =
          reconciliation.content !== incomingNotesContent ||
          reconciliation.bpm !== incomingNotesBpm ||
          reconciliation.key !== incomingNotesKey;

        if (hasLocalRemainingChanges) {
          options.onScheduleNotesSaveRetry(
            reconciliation.content,
            reconciliation.bpm,
            reconciliation.key
          );
        } else {
          options.setNotesStatus('saved');
        }
      }
    } else {
      if (data.workspace.notes) {
        if (activeProject.workspace?.notes) {
          activeProject.workspace.notes = data.workspace.notes;
        }
        setLastSyncedNotes(incomingNotesContent);
        setLastSyncedNotesBpm(incomingNotesBpm);
        setLastSyncedNotesKey(incomingNotesKey);

        options.onSyncNotesControls({
          content: incomingNotesContent,
          bpm: incomingNotesBpm,
          key: incomingNotesKey
        });

        options.setNotesStatus('saved');
      }
    }

    // 3. Sync Song Structure
    const hasPendingStructure =
      options.hasStructureSaveTimeout() ||
      options.getStructureStatus() === 'saving' ||
      options.getStructureStatus() === 'unsaved';

    if (!hasPendingStructure && data.workspace.structure) {
      const activeInputInStructure =
        document.activeElement &&
        (document.activeElement.classList.contains('section-name-input') ||
          document.activeElement.classList.contains('section-bars-input') ||
          document.activeElement.classList.contains('section-note-input'));

      if (!activeInputInStructure) {
        activeProject.workspace.structure = data.workspace.structure;
        options.onRenderStructureWorkspace();
        options.setStructureStatus('saved');
      }
    }

    // 4. Sync Project Tasks with non-intrusive convergence
    const hasPendingTasks =
      options.hasTasksSaveTimeout() ||
      options.getTasksStatus() === 'saving' ||
      options.getTasksStatus() === 'unsaved';

    if (!hasPendingTasks && data.workspace?.tasks) {
      const activeTaskEl = document.activeElement;
      const isEditingTask =
        activeTaskEl &&
        (activeTaskEl.classList.contains('task-title-input') ||
          activeTaskEl.classList.contains('task-note-input') ||
          activeTaskEl.classList.contains('drawer-task-title'));

      if (!isEditingTask) {
        activeProject.workspace.tasks = {
          revision: data.workspace.tasks.revision || 1,
          tasks: Array.isArray(data.workspace.tasks.tasks) ? data.workspace.tasks.tasks : [],
          updatedAt: data.workspace.tasks.updatedAt || Date.now()
        };
        options.onRenderTasksWorkspace();
        options.setTasksStatus('saved');
      }
    }

    // 5. Sync Project Activities
    if (data.activities && activeProject) {
      activeProject.activities = data.activities;
      options.onRenderProjectActivities(activeProject, options.getUser());
    }
  });
}
