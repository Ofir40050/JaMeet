import type { Project, ProjectSongItem, UserProfile } from '@jameet/shared';
import type { LyricsDocItem } from '../lyrics/lyricsDocumentState';
import { initSongsPersistence } from '../../songs/state/songsPersistence';
import { initLyricsPersistence } from '../lyrics/lyricsPersistence';
import { initNotesPersistence } from '../notes/notesPersistence';

export interface WorkspacePersistenceControllerOptions {
  getProject: () => Project | null | undefined;
  getAuthToken: () => string | null;
  getUser: () => UserProfile | null;
  canUserEditProject: () => boolean;
  getActiveSong: () => ProjectSongItem;
  getActiveLyricsDoc: () => LyricsDocItem;
  getWorkspaceContextGen: () => number;
  getLyricsEditGen: () => number;
  getLyricsSaveGen: () => number;
  incrementLyricsSaveGen: () => number;
  setLyricsStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  getNotesEditGen: () => number;
  getNotesSaveGen: () => number;
  incrementNotesSaveGen: () => number;
  setNotesStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  onSyncNotesControls: (values: { content?: string; bpm?: string; key?: string }, force?: boolean) => void;
  isSignalingConnected: () => boolean;
  onSignalingUpdateProjectWorkspace: (projectId: string, payload: any, token?: string) => Promise<any>;
  onApplyAuthoritativeWorkspace: (area: string, workspace: any) => void;
  onRenderProjectActivities: (project: Project | null, user: UserProfile | null) => void;
}

export function initWorkspacePersistenceController(
  options: WorkspacePersistenceControllerOptions
): void {
  initSongsPersistence({
    getProject: () => options.getProject(),
    getAuthToken: () => options.getAuthToken(),
    isSignalingConnected: () => options.isSignalingConnected(),
    onSignalingUpdateProjectWorkspace: async (projectId, payload, token) => {
      return options.onSignalingUpdateProjectWorkspace(projectId, payload, token);
    }
  });

  initLyricsPersistence({
    getProject: () => options.getProject(),
    getAuthToken: () => options.getAuthToken(),
    getUser: () => options.getUser(),
    canEdit: () => options.canUserEditProject(),
    getActiveSong: () => options.getActiveSong(),
    getActiveLyricsDoc: () => options.getActiveLyricsDoc(),
    getWorkspaceContextGen: () => options.getWorkspaceContextGen(),
    getLyricsEditGen: () => options.getLyricsEditGen(),
    getLyricsSaveGen: () => options.getLyricsSaveGen(),
    incrementLyricsSaveGen: () => options.incrementLyricsSaveGen(),
    setLyricsStatus: (status) => {
      options.setLyricsStatus(status);
    },
    onSignalingUpdate: async (projectId, payload, token) => {
      return options.onSignalingUpdateProjectWorkspace(projectId, payload, token);
    },
    onApplyAuthoritativeWorkspace: (area, workspace) => {
      options.onApplyAuthoritativeWorkspace(area, workspace);
    },
    onRenderProjectActivities: (project, user) => {
      options.onRenderProjectActivities(project, user);
    }
  });

  initNotesPersistence({
    getProject: () => options.getProject(),
    getAuthToken: () => options.getAuthToken(),
    getUser: () => options.getUser(),
    canEdit: () => options.canUserEditProject(),
    getActiveSong: () => options.getActiveSong(),
    getWorkspaceContextGen: () => options.getWorkspaceContextGen(),
    getNotesEditGen: () => options.getNotesEditGen(),
    getNotesSaveGen: () => options.getNotesSaveGen(),
    incrementNotesSaveGen: () => options.incrementNotesSaveGen(),
    setNotesStatus: (status) => {
      options.setNotesStatus(status);
    },
    onSyncNotesControls: (values, force) => {
      options.onSyncNotesControls(values, force);
    },
    onSignalingUpdate: async (projectId, payload, token) => {
      return options.onSignalingUpdateProjectWorkspace(projectId, payload, token);
    },
    onApplyAuthoritativeWorkspace: (area, workspace) => {
      options.onApplyAuthoritativeWorkspace(area, workspace);
    },
    onRenderProjectActivities: (project, user) => {
      options.onRenderProjectActivities(project, user);
    }
  });
}
