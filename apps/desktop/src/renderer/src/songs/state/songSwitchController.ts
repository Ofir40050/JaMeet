import type { Project } from '@jameet/shared';

export interface SongSwitchControllerOptions {
  getProject: () => Project | null | undefined;
  hasLyricsSaveTimeout: () => boolean;
  clearLyricsSaveTimeout: () => void;
  getActiveLyricsDoc: () => { id: string; title: string; content: string; updatedAt: number };
  onSaveLyricsWorkspace: (content: string, id: string, title: string) => Promise<void> | void;
  hasNotesSaveTimeout: () => boolean;
  clearNotesSaveTimeout: () => void;
  getNotesFieldValues: () => { content: string; bpm: string; key: string };
  onSaveNotesWorkspace: (content: string, bpm: string, key: string) => Promise<void> | void;
  hasStructureSaveTimeout: () => boolean;
  clearStructureSaveTimeout: () => void;
  onSaveStructureWorkspace: (sections: any[]) => Promise<void> | void;
  onSyncWorkspaceInputs: (forceAll: boolean) => void;
  onSaveSongsWorkspace: () => Promise<boolean> | void;
}

let controllerOptions: SongSwitchControllerOptions | null = null;

export function initSongSwitchController(options: SongSwitchControllerOptions): void {
  controllerOptions = options;
}

export function switchActiveSong(songId: string): void {
  if (!controllerOptions) return;
  const project = controllerOptions.getProject();
  if (!project?.workspace?.songs) return;
  const ws = project.workspace;
  const song = ws.songs.find((s) => s.id === songId);
  if (!song) return;

  // Persist current active song's edits first if pending
  if (controllerOptions.hasLyricsSaveTimeout()) {
    controllerOptions.clearLyricsSaveTimeout();
    const activeDoc = controllerOptions.getActiveLyricsDoc();
    void controllerOptions.onSaveLyricsWorkspace(activeDoc.content, activeDoc.id, activeDoc.title);
  }
  if (controllerOptions.hasNotesSaveTimeout()) {
    controllerOptions.clearNotesSaveTimeout();
    const vals = controllerOptions.getNotesFieldValues();
    void controllerOptions.onSaveNotesWorkspace(vals.content, vals.bpm, vals.key);
  }
  if (controllerOptions.hasStructureSaveTimeout()) {
    controllerOptions.clearStructureSaveTimeout();
    const sections = project.workspace.structure?.sections || [];
    void controllerOptions.onSaveStructureWorkspace(sections);
  }

  ws.activeSongId = songId;
  ws.lyrics = song.lyrics;
  ws.notes = song.notes;
  ws.structure = song.structure;

  controllerOptions.onSyncWorkspaceInputs(true);
  void controllerOptions.onSaveSongsWorkspace();
}
