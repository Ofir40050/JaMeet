import type { ProjectSongItem } from '@jameet/shared';
import { renderDeleteSongModal } from '../projectSongDeleteUi';

export interface SongDeleteControllerOptions {
  canEdit: () => boolean;
  hasActiveProject: () => boolean;
}

let songPendingDeletion: ProjectSongItem | null = null;
let controllerOptions: SongDeleteControllerOptions | null = null;

export function initSongDeleteController(options: SongDeleteControllerOptions): void {
  controllerOptions = options;
}

export function openDeleteSongModal(song: ProjectSongItem): void {
  if (!controllerOptions?.hasActiveProject() || !controllerOptions.canEdit()) return;
  songPendingDeletion = song;
  renderDeleteSongModal(song.title);
}

export function getSongPendingDeletion(): ProjectSongItem | null {
  return songPendingDeletion;
}

export function clearSongPendingDeletion(): void {
  songPendingDeletion = null;
}
