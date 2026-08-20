import { $, setText } from '../../core/dom';
import { updateLyricsDocumentPagination } from '../../workspace/lyrics/lyricsUi';

export type SongStudioTab = 'lyrics' | 'structure' | 'notes';

export interface SongStudioUiOptions {
  getProjectName: () => string | undefined;
  onRenderHeader: () => void;
  onApplyPermissions: () => void;
  onSwitchTabToOverview: () => void;
  onRenderOverviewSongsList: () => void;
}

let isSongStudioOpen = false;
let currentSongStudioTab: SongStudioTab = 'lyrics';
let studioOptions: SongStudioUiOptions | null = null;

export function initSongStudioUi(options: SongStudioUiOptions): void {
  studioOptions = options;

  document.querySelectorAll<HTMLButtonElement>('.song-studio-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.songTab as SongStudioTab;
      if (tab) {
        switchSongStudioTab(tab);
      }
    });
  });

  $('btn-song-studio-back')?.addEventListener('click', () => {
    closeSongStudio();
  });
}

export function isSongStudioVisible(): boolean {
  return isSongStudioOpen;
}

export function setIsSongStudioVisible(visible: boolean): void {
  isSongStudioOpen = visible;
}

export function getCurrentSongStudioTab(): SongStudioTab {
  return currentSongStudioTab;
}

export function switchSongStudioTab(targetTab: SongStudioTab): void {
  currentSongStudioTab = targetTab;
  document.querySelectorAll<HTMLButtonElement>('.song-studio-tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.songTab === targetTab);
  });
  $('project-panel-lyrics')?.classList.toggle('hidden', targetTab !== 'lyrics');
  $('project-panel-structure')?.classList.toggle('hidden', targetTab !== 'structure');
  $('project-panel-notes')?.classList.toggle('hidden', targetTab !== 'notes');

  if (targetTab === 'lyrics') {
    setTimeout(() => updateLyricsDocumentPagination(), 20);
  }

  studioOptions?.onApplyPermissions();
}

export function openSongStudio(targetTab: SongStudioTab = 'lyrics'): void {
  isSongStudioOpen = true;
  currentSongStudioTab = targetTab;

  // 1. Hide main project tabs bar and non-song-studio panels
  $('project-main-tabs-bar')?.classList.add('hidden');
  document.querySelectorAll<HTMLElement>('.project-tab-panel').forEach((p) => {
    if (!p.closest('#project-song-studio-view')) {
      p.classList.add('hidden');
    }
  });

  // 2. Show Song Studio View
  const studioView = $('project-song-studio-view');
  studioView?.classList.remove('hidden');

  // 3. Update breadcrumb project name and active song title / quick switch
  setText('song-nav-project-name', studioOptions?.getProjectName() || 'Project Overview');
  studioOptions?.onRenderHeader();

  // 4. Activate tab
  switchSongStudioTab(targetTab);
}

export function closeSongStudio(): void {
  isSongStudioOpen = false;
  $('project-song-studio-view')?.classList.add('hidden');
  $('project-main-tabs-bar')?.classList.remove('hidden');

  // Set project tabs to overview
  studioOptions?.onSwitchTabToOverview();
  studioOptions?.onApplyPermissions();
  studioOptions?.onRenderOverviewSongsList();
}
