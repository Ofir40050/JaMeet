import type { Project } from '@jameet/shared';
import type { LyricsDocItem } from '../lyrics/lyricsDocumentState';

export interface WorkspaceFlushControllerOptions {
  getProject: () => Project | null | undefined;
  hasLyricsSaveTimeout: () => boolean;
  clearLyricsSaveTimeout: () => void;
  getActiveLyricsDoc: () => LyricsDocItem;
  onSaveLyricsWorkspace: (content: string, id: string, title: string) => Promise<void>;
  hasNotesSaveTimeout: () => boolean;
  clearNotesSaveTimeout: () => void;
  getNotesFieldValues: () => { content?: string; bpm?: string; key?: string };
  onSaveNotesWorkspace: (content?: string, bpm?: string, key?: string) => Promise<boolean | void> | void;
  hasStructureSaveTimeout: () => boolean;
  clearStructureSaveTimeout: () => void;
  getStructureSections: () => any[];
  onSaveStructureWorkspace: (sections?: any[]) => Promise<void>;
  hasTasksSaveTimeout: () => boolean;
  clearTasksSaveTimeout: () => void;
  onSaveTasksWorkspace: () => Promise<void>;
  onSaveSongsWorkspace: () => Promise<boolean | void> | void;
}

let controllerOptions: WorkspaceFlushControllerOptions | null = null;

export function initWorkspaceFlushController(options: WorkspaceFlushControllerOptions): void {
  controllerOptions = options;
}

export async function flushAllWorkspacePendingSaves(): Promise<void> {
  if (!controllerOptions) return;
  const project = controllerOptions.getProject();
  if (!project?.workspace) return;
  const promises: Promise<any>[] = [];

  if (controllerOptions.hasLyricsSaveTimeout()) {
    controllerOptions.clearLyricsSaveTimeout();
    const activeDoc = controllerOptions.getActiveLyricsDoc();
    promises.push(
      controllerOptions.onSaveLyricsWorkspace(activeDoc.content, activeDoc.id, activeDoc.title)
    );
  }
  if (controllerOptions.hasNotesSaveTimeout()) {
    controllerOptions.clearNotesSaveTimeout();
    const vals = controllerOptions.getNotesFieldValues();
    promises.push(
      Promise.resolve(controllerOptions.onSaveNotesWorkspace(vals.content, vals.bpm, vals.key))
    );
  }
  if (controllerOptions.hasStructureSaveTimeout()) {
    controllerOptions.clearStructureSaveTimeout();
    const sections = controllerOptions.getStructureSections();
    promises.push(controllerOptions.onSaveStructureWorkspace(sections));
  }
  if (controllerOptions.hasTasksSaveTimeout()) {
    controllerOptions.clearTasksSaveTimeout();
  }
  promises.push(controllerOptions.onSaveTasksWorkspace());

  if (project.workspace.songs) {
    promises.push(Promise.resolve(controllerOptions.onSaveSongsWorkspace()));
  }

  await Promise.allSettled(promises);
}
