import type { Project, ProjectSongItem } from '@jameet/shared';
import { initNotesController, handleNotesChange } from './notesController';
import { initNotesUi } from './notesUi';

export interface NotesDomainControllerOptions {
  canUserEditProject: () => boolean;
  getActiveProject: () => Project | null | undefined;
  getActiveSong: () => ProjectSongItem;
  onIncrementNotesEditGen: () => void;
  onSaveNotesWorkspace: (content?: string, bpm?: string, key?: string) => Promise<void>;
}

export function initNotesDomainController(options: NotesDomainControllerOptions): void {
  initNotesController({
    canUserEditProject: () => options.canUserEditProject(),
    getActiveProject: () => options.getActiveProject(),
    getActiveSong: () => options.getActiveSong(),
    onIncrementNotesEditGen: () => {
      options.onIncrementNotesEditGen();
    },
    onSaveNotesWorkspace: async (content, bpm, key) => {
      await options.onSaveNotesWorkspace(content, bpm, key);
    }
  });

  initNotesUi({
    canEdit: () => options.canUserEditProject(),
    onNotesChange: (values) => {
      handleNotesChange(values);
    }
  });
}
