import type { Project, ProjectSongItem } from '@jameet/shared';
import { setNotesStatus } from './notesUi';

export interface NotesControllerOptions {
  canUserEditProject: () => boolean;
  getActiveProject: () => Project | null | undefined;
  getActiveSong: () => ProjectSongItem;
  onIncrementNotesEditGen: () => void;
  onSaveNotesWorkspace: (content?: string, bpm?: string, key?: string) => Promise<void>;
}

let controllerOptions: NotesControllerOptions | null = null;
let notesSaveTimeout: ReturnType<typeof setTimeout> | null = null;

export function initNotesController(options: NotesControllerOptions): void {
  controllerOptions = options;
}

export function handleNotesChange(values: { content?: string; bpm?: string; key?: string }): void {
  if (!controllerOptions) return;
  const project = controllerOptions.getActiveProject();
  if (!project || !controllerOptions.canUserEditProject()) return;

  if (!project.workspace?.notes) {
    project.workspace = project.workspace || {
      lyrics: {
        activeDocumentId: 'doc-main',
        documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: 0 }],
        content: '',
        updatedAt: 0
      },
      notes: { revision: 1, content: '', updatedAt: 0 }
    };
    if (!project.workspace.notes) {
      project.workspace.notes = { revision: 1, content: '', updatedAt: 0 };
    }
  }
  project.workspace.notes.content = values.content;
  project.workspace.notes.bpm = values.bpm;
  project.workspace.notes.key = values.key;

  const activeSong = controllerOptions.getActiveSong();
  if (activeSong.notes) {
    activeSong.notes.content = values.content;
    activeSong.notes.bpm = values.bpm;
    activeSong.notes.key = values.key;
    activeSong.notes.updatedAt = Date.now();
  }

  controllerOptions.onIncrementNotesEditGen();
  setNotesStatus('saving');

  if (notesSaveTimeout) clearTimeout(notesSaveTimeout);
  notesSaveTimeout = setTimeout(() => {
    notesSaveTimeout = null;
    void controllerOptions?.onSaveNotesWorkspace(values.content, values.bpm, values.key);
  }, 350);
}
