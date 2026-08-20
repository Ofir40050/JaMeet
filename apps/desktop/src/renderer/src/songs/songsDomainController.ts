import type { Project } from '@jameet/shared';
import type { LyricsDocItem } from '../workspace/lyrics/lyricsDocumentState';
import { initSongDeleteController } from './delete/songDeleteController';
import { initSongStudioUi } from './studio/songStudioUi';
import { initSongSwitchController } from './state/songSwitchController';
import { initSongsController } from './songsController';

export interface SongsDomainControllerOptions {
  getProject: () => Project | null | undefined;
  canUserEditProject: () => boolean;
  onRenderSongStudioHeader: () => void;
  onApplyWorkspacePermissions: () => void;
  onSwitchProjectTab: (tab: 'overview' | 'songs' | 'collaborators' | 'sessions') => void;
  onRenderProjectOverviewSongsList: () => void;
  hasLyricsSaveTimeout: () => boolean;
  clearLyricsSaveTimeout: () => void;
  getActiveLyricsDoc: () => LyricsDocItem;
  onSaveLyricsWorkspace: (content: string, docId: string, title: string) => Promise<void> | void;
  hasNotesSaveTimeout: () => boolean;
  clearNotesSaveTimeout: () => void;
  getNotesFieldValues: () => { content?: string; bpm?: string; key?: string };
  onSaveNotesWorkspace: (content?: string, bpm?: string, key?: string) => Promise<void> | void;
  hasStructureSaveTimeout: () => boolean;
  clearStructureSaveTimeout: () => void;
  onSaveStructureWorkspace: () => Promise<void> | void;
  onSyncWorkspaceInputs: (forceAll: boolean) => void;
  onSaveSongsWorkspace: () => Promise<void>;
  onRenderTasksWorkspace: () => void;
}

export function initSongsDomainController(options: SongsDomainControllerOptions): void {
  initSongDeleteController({
    canEdit: () => options.canUserEditProject(),
    hasActiveProject: () => Boolean(options.getProject())
  });

  initSongStudioUi({
    getProjectName: () => options.getProject()?.name,
    onRenderHeader: () => {
      options.onRenderSongStudioHeader();
    },
    onApplyPermissions: () => {
      options.onApplyWorkspacePermissions();
    },
    onSwitchTabToOverview: () => {
      options.onSwitchProjectTab('overview');
    },
    onRenderOverviewSongsList: () => {
      options.onRenderProjectOverviewSongsList();
    }
  });

  initSongSwitchController({
    getProject: () => options.getProject(),
    hasLyricsSaveTimeout: () => options.hasLyricsSaveTimeout(),
    clearLyricsSaveTimeout: () => {
      options.clearLyricsSaveTimeout();
    },
    getActiveLyricsDoc: () => options.getActiveLyricsDoc(),
    onSaveLyricsWorkspace: (content, id, title) => {
      void options.onSaveLyricsWorkspace(content, id, title);
    },
    hasNotesSaveTimeout: () => options.hasNotesSaveTimeout(),
    clearNotesSaveTimeout: () => {
      options.clearNotesSaveTimeout();
    },
    getNotesFieldValues: () => options.getNotesFieldValues(),
    onSaveNotesWorkspace: (content, bpm, key) => {
      void options.onSaveNotesWorkspace(content, bpm, key);
    },
    hasStructureSaveTimeout: () => options.hasStructureSaveTimeout(),
    clearStructureSaveTimeout: () => {
      options.clearStructureSaveTimeout();
    },
    onSaveStructureWorkspace: () => {
      void options.onSaveStructureWorkspace();
    },
    onSyncWorkspaceInputs: (forceAll) => {
      options.onSyncWorkspaceInputs(forceAll);
    },
    onSaveSongsWorkspace: () => {
      return options.onSaveSongsWorkspace();
    }
  });

  initSongsController({
    getProject: () => options.getProject(),
    canEdit: () => options.canUserEditProject(),
    onSyncWorkspaceInputs: (forceAll) => {
      options.onSyncWorkspaceInputs(forceAll);
    },
    onSaveSongsWorkspace: () => {
      return options.onSaveSongsWorkspace();
    },
    onRenderTasksWorkspace: () => {
      options.onRenderTasksWorkspace();
    }
  });
}
