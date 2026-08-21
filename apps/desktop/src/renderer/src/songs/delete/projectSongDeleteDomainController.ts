import type { Project } from '@jameet/shared';
import { initProjectSongDeleteController } from './projectSongDeleteController';

export interface ProjectSongDeleteDomainControllerOptions {
  getProject: () => Project | null | undefined;
  canUserEditProject: () => boolean;
  onSwitchActiveSong: (songId: string) => void;
  onRenderProjectSongsSelector: () => void;
  onRenderProjectOverviewSongsList: () => void;
  onApplyWorkspacePermissions: () => void;
  onSaveSongsWorkspace: () => Promise<boolean | void> | void;
}

export function initProjectSongDeleteDomainController(
  options: ProjectSongDeleteDomainControllerOptions
): void {
  initProjectSongDeleteController({
    getProject: () => options.getProject(),
    canUserEditProject: () => options.canUserEditProject(),
    onSwitchActiveSong: (songId) => options.onSwitchActiveSong(songId),
    onRenderProjectSongsSelector: () => options.onRenderProjectSongsSelector(),
    onRenderProjectOverviewSongsList: () => options.onRenderProjectOverviewSongsList(),
    onApplyWorkspacePermissions: () => options.onApplyWorkspacePermissions(),
    onSaveSongsWorkspace: () => options.onSaveSongsWorkspace()
  });
}
