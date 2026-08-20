import type { Project } from '@jameet/shared';
import { setLyricsStatus, renderLyricsDocTabs } from './lyricsUi';

export interface LyricsControllerOptions {
  getActiveProject: () => Project | null | undefined;
  getActiveLyricsDoc: () => { id: string; title: string; content: string; updatedAt: number };
  onIncrementLyricsEditGen: () => void;
  onSaveLyricsWorkspace: (content: string, docId: string, title: string) => Promise<void>;
}

let controllerOptions: LyricsControllerOptions | null = null;
let lyricsSaveTimeout: ReturnType<typeof setTimeout> | null = null;

export function initLyricsController(options: LyricsControllerOptions): void {
  controllerOptions = options;
}

export function handleLyricsInput(newHtml: string): void {
  if (!controllerOptions) return;
  const project = controllerOptions.getActiveProject();
  if (!project) return;

  const activeDoc = controllerOptions.getActiveLyricsDoc();
  activeDoc.content = newHtml;
  activeDoc.updatedAt = Date.now();
  if (project.workspace?.lyrics) {
    project.workspace.lyrics.content = newHtml;
  }

  controllerOptions.onIncrementLyricsEditGen();
  setLyricsStatus('saving');

  if (lyricsSaveTimeout) clearTimeout(lyricsSaveTimeout);
  lyricsSaveTimeout = setTimeout(() => {
    lyricsSaveTimeout = null;
    void controllerOptions?.onSaveLyricsWorkspace(newHtml, activeDoc.id, activeDoc.title);
  }, 350);
}

export function handleLyricsDocTitleChange(docId: string, newTitle: string): void {
  if (!controllerOptions) return;
  const activeDoc = controllerOptions.getActiveLyricsDoc();
  activeDoc.title = newTitle;
  renderLyricsDocTabs(activeDoc);

  controllerOptions.onIncrementLyricsEditGen();
  setLyricsStatus('saving');

  if (lyricsSaveTimeout) clearTimeout(lyricsSaveTimeout);
  lyricsSaveTimeout = setTimeout(() => {
    lyricsSaveTimeout = null;
    void controllerOptions?.onSaveLyricsWorkspace(activeDoc.content, activeDoc.id, newTitle);
  }, 400);
}
