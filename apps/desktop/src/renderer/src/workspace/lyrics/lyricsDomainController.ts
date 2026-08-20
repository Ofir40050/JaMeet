import type { Project } from '@jameet/shared';
import type { LyricsDocItem } from './lyricsDocumentState';
import {
  initLyricsController,
  handleLyricsInput,
  handleLyricsDocTitleChange
} from './lyricsController';
import { initLyricsUi } from './lyricsUi';
import {
  switchActiveLyricsDoc,
  duplicateLyricsDoc,
  deleteLyricsDoc
} from './lyricsDocumentsController';

export interface LyricsDomainControllerOptions {
  getActiveProject: () => Project | null | undefined;
  getActiveLyricsDoc: () => LyricsDocItem;
  onIncrementLyricsEditGen: () => void;
  onSaveLyricsWorkspace: (content: string, docId: string, title: string) => Promise<void>;
  isInCall: () => boolean;
  canEdit: () => boolean;
}

export function initLyricsDomainController(options: LyricsDomainControllerOptions): void {
  initLyricsController({
    getActiveProject: () => options.getActiveProject(),
    getActiveLyricsDoc: () => options.getActiveLyricsDoc(),
    onIncrementLyricsEditGen: () => {
      options.onIncrementLyricsEditGen();
    },
    onSaveLyricsWorkspace: async (content, docId, title) => {
      await options.onSaveLyricsWorkspace(content, docId, title);
    }
  });

  initLyricsUi({
    isInCall: () => options.isInCall(),
    canEdit: () => options.canEdit(),
    getActiveLyricsDoc: () => options.getActiveLyricsDoc(),
    onLyricsInput: (newHtml) => {
      handleLyricsInput(newHtml);
    },
    onDocTitleChange: (docId, newTitle) => {
      handleLyricsDocTitleChange(docId, newTitle);
    },
    onSwitchDoc: (docId) => {
      switchActiveLyricsDoc(docId);
    },
    onDuplicateDoc: (docId) => {
      duplicateLyricsDoc(docId);
    },
    onDeleteDoc: (docId) => {
      deleteLyricsDoc(docId);
    }
  });
}
