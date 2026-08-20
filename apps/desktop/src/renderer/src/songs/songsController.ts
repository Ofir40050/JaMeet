import type { Project } from '@jameet/shared';
import {
  initSongsUi,
  renderProjectOverviewSongsList,
  renderProjectSongsSelector
} from './songsUi';
import {
  openSongStudio as openSongStudioUiView,
  closeSongStudio,
  getCurrentSongStudioTab,
  type SongStudioTab
} from './studio/songStudioUi';
import { switchActiveSong } from './state/songSwitchController';
import { mutateCreateSong } from './state/songCreation';
import { mutateDuplicateSong } from './state/songDuplication';
import { mutateReorderSongs } from './state/songReorder';
import {
  mutateRenameSong,
  mutateToggleArchiveSong,
  mutateSongCustomization
} from './state/songMetadata';
import { openDeleteSongModal } from './delete/songDeleteController';

export interface SongsControllerOptions {
  getProject: () => Project | null | undefined;
  canEdit: () => boolean;
  onSyncWorkspaceInputs: (forceAll?: boolean) => void;
  onSaveSongsWorkspace: () => Promise<boolean> | void;
  onRenderTasksWorkspace: () => void;
}

let controllerOptions: SongsControllerOptions | null = null;

export function initSongsController(options: SongsControllerOptions): void {
  controllerOptions = options;

  initSongsUi({
    getSongs: () => options.getProject()?.workspace?.songs || [],
    getActiveSongId: () => options.getProject()?.workspace?.activeSongId,
    getProjectNotesFallback: () => {
      const project = options.getProject();
      return project?.workspace?.notes
        ? { bpm: project.workspace.notes.bpm, key: project.workspace.notes.key }
        : null;
    },
    canEdit: () => options.canEdit(),
    onCreateSong: (title) => {
      createNewSong(title);
    },
    onSelectSong: (songId) => {
      switchActiveSong(songId);
    },
    onOpenSongStudio: (songId, targetTab) => {
      openSongStudio(songId, targetTab || 'lyrics');
    },
    onCloseSongStudio: () => {
      closeSongStudio();
    },
    onSwitchSongInStudio: (songId) => {
      switchActiveSong(songId);
      openSongStudio(songId, getCurrentSongStudioTab());
    },
    onRenameSong: (songId, newTitle) => {
      renameSong(songId, newTitle);
    },
    onDuplicateSong: (songId) => {
      duplicateSong(songId);
    },
    onToggleArchiveSong: (songId, isArchived) => {
      toggleArchiveSong(songId, isArchived);
    },
    onDeleteSong: (songId) => {
      const song = options.getProject()?.workspace?.songs?.find((s) => s.id === songId);
      if (song) {
        openDeleteSongModal(song);
      }
    },
    onReorderSongs: (sourceId, targetId) => {
      reorderSongs(sourceId, targetId);
    }
  });
}

export function openSongStudio(songId?: string, targetTab: SongStudioTab = 'lyrics'): void {
  const project = controllerOptions?.getProject();
  if (songId && project?.workspace && project.workspace.activeSongId !== songId) {
    switchActiveSong(songId);
  }
  openSongStudioUiView(targetTab);
}

export function createNewSong(title: string, autoOpenStudio: boolean = false): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const project = controllerOptions.getProject();
  if (!project) return;

  const newId = `song_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  mutateCreateSong(project, title, newId);

  controllerOptions.onSyncWorkspaceInputs(true);
  void controllerOptions.onSaveSongsWorkspace();
  renderProjectSongsSelector();
  renderProjectOverviewSongsList();

  if (autoOpenStudio) {
    openSongStudio(newId, 'lyrics');
  }
}

export function duplicateSong(songId: string): void {
  if (!controllerOptions) return;
  const project = controllerOptions.getProject();
  if (!project?.workspace?.songs) return;

  const newId = `song_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const result = mutateDuplicateSong(project, songId, newId);
  if (!result) return;

  controllerOptions.onSyncWorkspaceInputs(true);
  void controllerOptions.onSaveSongsWorkspace();
}

export function deleteSong(songId: string): void {
  if (!controllerOptions) return;
  const project = controllerOptions.getProject();
  if (!project?.workspace?.songs) return;
  const ws = project.workspace;
  if (ws.songs.length <= 1) return;

  const idx = ws.songs.findIndex((s) => s.id === songId);
  if (idx === -1) return;

  ws.songs.splice(idx, 1);
  if (ws.activeSongId === songId) {
    const nextSong = ws.songs[Math.max(0, idx - 1)] || ws.songs[0];
    ws.activeSongId = nextSong.id;
    ws.lyrics = nextSong.lyrics;
    ws.notes = nextSong.notes;
    ws.structure = nextSong.structure;
  }

  controllerOptions.onSyncWorkspaceInputs(true);
  void controllerOptions.onSaveSongsWorkspace();
}

export function reorderSongs(sourceId: string, targetId: string): void {
  if (!controllerOptions) return;
  const project = controllerOptions.getProject();
  if (!project?.workspace?.songs) return;

  const changed = mutateReorderSongs(project, sourceId, targetId);
  if (!changed) return;

  renderProjectSongsSelector();
  void controllerOptions.onSaveSongsWorkspace();
}

export function renameSong(songId: string, newTitle: string): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const project = controllerOptions.getProject();
  if (!project?.workspace?.songs) return;

  const changed = mutateRenameSong(project, songId, newTitle);
  if (!changed) return;
  void controllerOptions.onSaveSongsWorkspace();
}

export function toggleArchiveSong(songId: string, isArchived: boolean): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const project = controllerOptions.getProject();
  if (!project?.workspace?.songs) return;

  const changed = mutateToggleArchiveSong(project, songId, isArchived);
  if (!changed) return;
  renderProjectSongsSelector();
  renderProjectOverviewSongsList();
  void controllerOptions.onSaveSongsWorkspace();
}

export function updateSongCustomization(
  songId: string,
  changes: { icon?: string; color?: string }
): void {
  if (!controllerOptions) return;
  const project = controllerOptions.getProject();
  if (!project?.workspace?.songs) return;

  const changed = mutateSongCustomization(project, songId, changes);
  if (!changed) return;

  void controllerOptions.onSaveSongsWorkspace();
  controllerOptions.onRenderTasksWorkspace();
  renderProjectSongsSelector();
}
