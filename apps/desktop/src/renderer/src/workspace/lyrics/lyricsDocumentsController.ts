import type { Project, ProjectSongItem } from '@jameet/shared';
import { $ } from '../../core/dom';
import { sanitizeLyricsHtml } from '../../core/htmlSecurity';
import {
  getActiveLyricsDocState,
  type LyricsDocItem
} from './lyricsDocumentState';
import { mutateDuplicateLyricsDoc } from './lyricsDocumentDuplication';
import {
  canDeleteLyricsDoc,
  findLyricsDocToDelete,
  mutateDeleteLyricsDoc
} from './lyricsDocumentDeletion';

export interface LyricsDocumentsControllerOptions {
  getProject: () => Project | null | undefined;
  getActiveSong: () => ProjectSongItem;
  onRenderLyricsDocTabs: (doc: LyricsDocItem) => void;
  onUpdateLyricsStats: (html: string) => void;
  onIncrementLyricsEditGen: () => void;
  onSetLyricsStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  onSaveLyricsWorkspace: (content: string, id: string, title: string) => Promise<void> | void;
  onUpdateLastSyncedLyrics: (content: string) => void;
}

let controllerOptions: LyricsDocumentsControllerOptions | null = null;

export function initLyricsDocumentsController(
  options: LyricsDocumentsControllerOptions
): void {
  controllerOptions = options;
}

export function getActiveLyricsDoc(): LyricsDocItem {
  if (!controllerOptions) {
    return { id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: 0 };
  }
  const activeSong = controllerOptions.getActiveSong();
  return getActiveLyricsDocState(activeSong);
}

export function switchActiveLyricsDoc(docId: string): void {
  if (!controllerOptions) return;
  const project = controllerOptions.getProject();
  if (!project?.workspace?.lyrics) return;

  project.workspace.lyrics.activeDocumentId = docId;
  const doc = getActiveLyricsDoc();
  controllerOptions.onRenderLyricsDocTabs(doc);

  const projectEditor = $('project-lyrics-editor');
  const sessionEditor = $('session-lyrics-editor');

  if (projectEditor) projectEditor.innerHTML = sanitizeLyricsHtml(doc.content || '');
  if (sessionEditor) sessionEditor.innerHTML = sanitizeLyricsHtml(doc.content || '');

  controllerOptions.onUpdateLastSyncedLyrics(doc.content || '');
  controllerOptions.onUpdateLyricsStats(doc.content || '');
  controllerOptions.onIncrementLyricsEditGen();
  controllerOptions.onSetLyricsStatus('saving');

  // Debounce save active document switch
  void controllerOptions.onSaveLyricsWorkspace(doc.content || '', doc.id, doc.title);
}

export function duplicateLyricsDoc(docId: string): void {
  if (!controllerOptions) return;
  const project = controllerOptions.getProject();
  if (!project) return;
  const activeSong = controllerOptions.getActiveSong();
  const newId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const result = mutateDuplicateLyricsDoc(project, activeSong, docId, newId);
  if (!result) return;
  switchActiveLyricsDoc(newId);
}

export function deleteLyricsDoc(docId: string): void {
  if (!controllerOptions) return;
  const project = controllerOptions.getProject();
  if (!project) return;
  if (!canDeleteLyricsDoc(project)) {
    alert('A project must have at least one Lyrics document.');
    return;
  }
  const targetDoc = findLyricsDocToDelete(project, docId);
  if (!targetDoc) return;
  if (confirm(`Are you sure you want to delete "${targetDoc.title}"?`)) {
    const result = mutateDeleteLyricsDoc(project, docId);
    if (result) {
      switchActiveLyricsDoc(result.nextDocId);
    }
  }
}
