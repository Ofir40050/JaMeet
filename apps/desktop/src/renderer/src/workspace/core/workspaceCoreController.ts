import type { Project, ProjectSongItem, UserProfile } from '@jameet/shared';
import type { LyricsDocItem } from '../lyrics/lyricsDocumentState';
import type { StructureSection } from '../structure/structureUi';
import { initWorkspacePermissionsController } from './workspacePermissionsController';
import { initAuthoritativeWorkspaceController } from './authoritativeWorkspaceController';
import { initWorkspaceSyncController } from './workspaceSyncController';
import { initWorkspaceFlushController } from './workspaceFlushController';

export interface WorkspaceCoreControllerOptions {
  getProject: () => Project | null | undefined;
  getUser: () => UserProfile | null;
  getActiveSong: () => ProjectSongItem;
  getActiveLyricsDoc: () => LyricsDocItem;
  onRenderProjectSongsSelector: () => void;
  onRenderLyricsDocTabs: (doc: LyricsDocItem) => void;
  onUpdateLyricsStats: (html: string) => void;
  onSyncNotesControls: (values: { content?: string; bpm?: string; key?: string }, force?: boolean) => void;
  onRenderStructureWorkspace: () => void;
  onRenderTasksWorkspace: () => void;
  onRenderProjectActivities: (project: Project | null, user?: UserProfile | null) => void;
  getLyricsStatus: () => 'saved' | 'saving' | 'unsaved';
  setLyricsStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  hasLyricsSaveTimeout: () => boolean;
  clearLyricsSaveTimeout: () => void;
  onSaveLyricsWorkspace: (content: string, id: string, title: string) => Promise<void>;
  getNotesStatus: () => 'saved' | 'saving' | 'unsaved';
  setNotesStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  hasNotesSaveTimeout: () => boolean;
  clearNotesSaveTimeout: () => void;
  getNotesFieldValues: () => { content?: string; bpm?: string; key?: string };
  onSaveNotesWorkspace: (content?: string, bpm?: string, key?: string) => Promise<void>;
  getStructureStatus: () => 'saved' | 'saving' | 'unsaved';
  setStructureStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  hasStructureSaveTimeout: () => boolean;
  clearStructureSaveTimeout: () => void;
  getStructureSections: () => StructureSection[];
  onSaveStructureWorkspace: () => Promise<void>;
  getTasksStatus: () => 'saved' | 'saving' | 'unsaved';
  setTasksStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  hasTasksSaveTimeout: () => boolean;
  clearTasksSaveTimeout: () => void;
  onSaveTasksWorkspace: () => Promise<void>;
  onSaveSongsWorkspace: () => Promise<void>;
  onApplyWorkspacePermissions: () => void;
}

export function initWorkspaceCoreController(options: WorkspaceCoreControllerOptions): void {
  initWorkspacePermissionsController({
    getProject: () => options.getProject(),
    getUser: () => options.getUser()
  });

  initAuthoritativeWorkspaceController({
    getProject: () => options.getProject(),
    getActiveSong: () => options.getActiveSong(),
    onRenderProjectSongsSelector: () => {
      options.onRenderProjectSongsSelector();
    }
  });

  initWorkspaceSyncController({
    getProject: () => options.getProject(),
    getUser: () => options.getUser(),
    getActiveSong: () => options.getActiveSong(),
    getActiveLyricsDoc: () => options.getActiveLyricsDoc(),
    onRenderProjectSongsSelector: () => {
      options.onRenderProjectSongsSelector();
    },
    onRenderLyricsDocTabs: (doc) => {
      options.onRenderLyricsDocTabs(doc);
    },
    onUpdateLyricsStats: (html) => {
      options.onUpdateLyricsStats(html);
    },
    onSyncNotesControls: (values, force) => {
      options.onSyncNotesControls(values, force);
    },
    onRenderStructureWorkspace: () => {
      options.onRenderStructureWorkspace();
    },
    onRenderTasksWorkspace: () => {
      options.onRenderTasksWorkspace();
    },
    onRenderProjectActivities: (project, user) => {
      options.onRenderProjectActivities(project, user);
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
    getStructureStatus: () => options.getStructureStatus(),
    setStructureStatus: (status) => {
      options.setStructureStatus(status);
    },
    hasStructureSaveTimeout: () => options.hasStructureSaveTimeout(),
    getTasksStatus: () => options.getTasksStatus(),
    setTasksStatus: (status) => {
      options.setTasksStatus(status);
    },
    hasTasksSaveTimeout: () => options.hasTasksSaveTimeout(),
    onApplyWorkspacePermissions: () => {
      options.onApplyWorkspacePermissions();
    }
  });

  initWorkspaceFlushController({
    getProject: () => options.getProject(),
    hasLyricsSaveTimeout: () => options.hasLyricsSaveTimeout(),
    clearLyricsSaveTimeout: () => {
      options.clearLyricsSaveTimeout();
    },
    getActiveLyricsDoc: () => options.getActiveLyricsDoc(),
    onSaveLyricsWorkspace: (content, id, title) => {
      return options.onSaveLyricsWorkspace(content, id, title);
    },
    hasNotesSaveTimeout: () => options.hasNotesSaveTimeout(),
    clearNotesSaveTimeout: () => {
      options.clearNotesSaveTimeout();
    },
    getNotesFieldValues: () => options.getNotesFieldValues(),
    onSaveNotesWorkspace: (content, bpm, key) => {
      return options.onSaveNotesWorkspace(content, bpm, key);
    },
    hasStructureSaveTimeout: () => options.hasStructureSaveTimeout(),
    clearStructureSaveTimeout: () => {
      options.clearStructureSaveTimeout();
    },
    getStructureSections: () => options.getStructureSections(),
    onSaveStructureWorkspace: () => {
      return options.onSaveStructureWorkspace();
    },
    hasTasksSaveTimeout: () => options.hasTasksSaveTimeout(),
    clearTasksSaveTimeout: () => {
      options.clearTasksSaveTimeout();
    },
    onSaveTasksWorkspace: () => {
      return options.onSaveTasksWorkspace();
    },
    onSaveSongsWorkspace: () => {
      return options.onSaveSongsWorkspace();
    }
  });
}
