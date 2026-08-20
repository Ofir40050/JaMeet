import type { Project, ProjectSongItem, UserProfile } from '@jameet/shared';
import { $ } from '../../core/dom';
import { sanitizeLyricsHtml } from '../../core/htmlSecurity';
import type { LyricsDocItem } from '../lyrics/lyricsDocumentState';

export interface WorkspaceSyncControllerOptions {
  getProject: () => Project | null | undefined;
  getUser: () => UserProfile | null | undefined;
  getActiveSong: () => ProjectSongItem;
  getActiveLyricsDoc: () => LyricsDocItem;
  onRenderProjectSongsSelector: () => void;
  onRenderLyricsDocTabs: (doc: LyricsDocItem) => void;
  onUpdateLyricsStats: (html: string) => void;
  onSyncNotesControls: (values: { content: string; bpm: string; key: string }, force?: boolean) => void;
  onRenderStructureWorkspace: () => void;
  onRenderTasksWorkspace: () => void;
  onRenderProjectActivities: (project: Project | null, user?: UserProfile | null) => void;
  getLyricsStatus: () => 'saved' | 'saving' | 'unsaved';
  setLyricsStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  hasLyricsSaveTimeout: () => boolean;
  getNotesStatus: () => 'saved' | 'saving' | 'unsaved';
  setNotesStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  hasNotesSaveTimeout: () => boolean;
  getStructureStatus: () => 'saved' | 'saving' | 'unsaved';
  setStructureStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  hasStructureSaveTimeout: () => boolean;
  getTasksStatus: () => 'saved' | 'saving' | 'unsaved';
  setTasksStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  hasTasksSaveTimeout: () => boolean;
  onApplyWorkspacePermissions: () => void;
  onUpdateLastSyncedValues: (values: { lyrics?: string; notes?: string; bpm?: string; key?: string }) => void;
}

let controllerOptions: WorkspaceSyncControllerOptions | null = null;

export function initWorkspaceSyncController(options: WorkspaceSyncControllerOptions): void {
  controllerOptions = options;
}

export function syncWorkspaceInputsFromProject(force = false): void {
  if (!controllerOptions) return;
  const activeProject = controllerOptions.getProject();
  if (!activeProject) return;

  const activeSong = controllerOptions.getActiveSong();
  controllerOptions.onRenderProjectSongsSelector();

  const activeDoc = controllerOptions.getActiveLyricsDoc();
  controllerOptions.onRenderLyricsDocTabs(activeDoc);
  const lyricsHtml = activeDoc.content || '';
  const notesContent = activeSong.notes?.content || '';
  const notesBpm = activeSong.notes?.bpm || '';
  const notesKey = activeSong.notes?.key || '';

  if (force) {
    controllerOptions.onUpdateLastSyncedValues({
      lyrics: lyricsHtml,
      notes: notesContent,
      bpm: notesBpm,
      key: notesKey
    });
  }

  const projectEditor = $('project-lyrics-editor');
  const sessionEditor = $('session-lyrics-editor');
  if (projectEditor && (force || document.activeElement !== projectEditor)) {
    projectEditor.innerHTML = sanitizeLyricsHtml(lyricsHtml);
  }
  if (sessionEditor && (force || document.activeElement !== sessionEditor)) {
    sessionEditor.innerHTML = sanitizeLyricsHtml(lyricsHtml);
  }
  controllerOptions.onUpdateLyricsStats(lyricsHtml);

  controllerOptions.onSyncNotesControls({ content: notesContent, bpm: notesBpm, key: notesKey }, force);

  controllerOptions.onRenderStructureWorkspace();
  controllerOptions.onRenderTasksWorkspace();
  controllerOptions.onRenderProjectActivities(activeProject, controllerOptions.getUser());

  if (
    force ||
    (controllerOptions.getLyricsStatus() !== 'unsaved' &&
      controllerOptions.getLyricsStatus() !== 'saving' &&
      !controllerOptions.hasLyricsSaveTimeout())
  ) {
    controllerOptions.setLyricsStatus('saved');
  }
  if (
    force ||
    (controllerOptions.getNotesStatus() !== 'unsaved' &&
      controllerOptions.getNotesStatus() !== 'saving' &&
      !controllerOptions.hasNotesSaveTimeout())
  ) {
    controllerOptions.setNotesStatus('saved');
  }
  if (
    force ||
    (controllerOptions.getStructureStatus() !== 'unsaved' &&
      controllerOptions.getStructureStatus() !== 'saving' &&
      !controllerOptions.hasStructureSaveTimeout())
  ) {
    controllerOptions.setStructureStatus('saved');
  }
  if (
    force ||
    (controllerOptions.getTasksStatus() !== 'unsaved' &&
      controllerOptions.getTasksStatus() !== 'saving' &&
      !controllerOptions.hasTasksSaveTimeout())
  ) {
    controllerOptions.setTasksStatus('saved');
  }

  // Enforce read-only UI restrictions if user is viewer
  controllerOptions.onApplyWorkspacePermissions();
}
