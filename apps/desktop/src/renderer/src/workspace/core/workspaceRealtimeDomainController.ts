import type { Project, UserProfile } from '@jameet/shared';
import type { SignalingClient } from '../../media/signaling';
import type { LyricsDocItem } from '../lyrics/lyricsDocumentState';
import { initWorkspaceRealtimeSync } from './workspaceRealtimeSyncController';
import { initProjectActivitySync } from '../../projects/core/projectActivitySyncController';

export interface WorkspaceRealtimeDomainControllerOptions {
  signaling: SignalingClient;
  getActiveProject: () => Project | null | undefined;
  getSessionProjectId: () => string | undefined;
  getUser: () => UserProfile | null;
  onRenderProjectActivities: (project: Project | null, user: UserProfile | null) => void;
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
  onScheduleNotesSaveRetry: (content?: string, bpm?: string, key?: string) => void;
  getStructureStatus: () => 'saved' | 'saving' | 'unsaved';
  setStructureStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  hasStructureSaveTimeout: () => boolean;
  onRenderStructureWorkspace: () => void;
  getTasksStatus: () => 'saved' | 'saving' | 'unsaved';
  setTasksStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  hasTasksSaveTimeout: () => boolean;
  onRenderTasksWorkspace: () => void;
}

export function initWorkspaceRealtimeDomainController(
  options: WorkspaceRealtimeDomainControllerOptions
): void {
  initWorkspaceRealtimeSync({
    signaling: options.signaling,
    getActiveProject: () => options.getActiveProject(),
    getSessionProjectId: () => options.getSessionProjectId(),
    getUser: () => options.getUser(),
    onRenderProjectActivities: (project, user) => {
      options.onRenderProjectActivities(project, user);
    },
    getActiveLyricsDoc: () => options.getActiveLyricsDoc(),
    onRenderLyricsDocTabs: (doc) => {
      options.onRenderLyricsDocTabs(doc);
    },
    onUpdateLyricsStats: (html) => {
      options.onUpdateLyricsStats(html);
    },
    getLyricsStatus: () => options.getLyricsStatus(),
    setLyricsStatus: (status) => {
      options.setLyricsStatus(status);
    },
    hasLyricsSaveTimeout: () => options.hasLyricsSaveTimeout(),
    getNotesStatus: () => options.getNotesStatus(),
    setNotesStatus: (status) => {
      options.setNotesStatus(status);
    },
    hasNotesSaveTimeout: () => options.hasNotesSaveTimeout(),
    onSyncNotesControls: (values) => {
      options.onSyncNotesControls(values);
    },
    onScheduleNotesSaveRetry: (content, bpm, key) => {
      options.onScheduleNotesSaveRetry(content, bpm, key);
    },
    getStructureStatus: () => options.getStructureStatus(),
    setStructureStatus: (status) => {
      options.setStructureStatus(status);
    },
    hasStructureSaveTimeout: () => options.hasStructureSaveTimeout(),
    onRenderStructureWorkspace: () => {
      options.onRenderStructureWorkspace();
    },
    getTasksStatus: () => options.getTasksStatus(),
    setTasksStatus: (status) => {
      options.setTasksStatus(status);
    },
    hasTasksSaveTimeout: () => options.hasTasksSaveTimeout(),
    onRenderTasksWorkspace: () => {
      options.onRenderTasksWorkspace();
    }
  });

  initProjectActivitySync({
    signaling: options.signaling,
    getActiveProject: () => options.getActiveProject(),
    getUser: () => options.getUser(),
    onRenderProjectActivities: (project, user) => {
      options.onRenderProjectActivities(project, user);
    }
  });
}
