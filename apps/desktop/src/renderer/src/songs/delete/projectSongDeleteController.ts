import type { Project } from '@jameet/shared';
import {
  initProjectSongDeleteUi,
  closeDeleteSongModal
} from './projectSongDeleteUi';
import {
  getSongPendingDeletion,
  clearSongPendingDeletion
} from './songDeleteController';
import { computeSongDeletion } from './songDeleteLogic';

export interface ProjectSongDeleteControllerOptions {
  getProject: () => Project | null | undefined;
  canUserEditProject: () => boolean;
  onSwitchActiveSong: (songId: string) => void;
  onRenderProjectSongsSelector: () => void;
  onRenderProjectOverviewSongsList: () => void;
  onApplyWorkspacePermissions: () => void;
  onSaveSongsWorkspace: () => Promise<boolean> | void;
}

export function initProjectSongDeleteController(
  options: ProjectSongDeleteControllerOptions
): void {
  initProjectSongDeleteUi({
    getSongTitle: () => getSongPendingDeletion()?.title,
    onCancel: () => {
      clearSongPendingDeletion();
    },
    onConfirmDelete: async () => {
      const pending = getSongPendingDeletion();
      const activeProject = options.getProject();
      if (!activeProject?.workspace || !pending || !options.canUserEditProject()) return;
      const result = computeSongDeletion(
        activeProject.workspace.songs || [],
        activeProject.workspace.activeSongId,
        pending.id,
        'Song 1'
      );

      activeProject.workspace.songs = result.songs;
      if (result.shouldSwitchActiveSong && result.nextActiveSongId) {
        options.onSwitchActiveSong(result.nextActiveSongId);
      }

      closeDeleteSongModal();
      clearSongPendingDeletion();

      options.onRenderProjectSongsSelector();
      options.onRenderProjectOverviewSongsList();
      options.onApplyWorkspacePermissions();
      void options.onSaveSongsWorkspace();
    }
  });
}
