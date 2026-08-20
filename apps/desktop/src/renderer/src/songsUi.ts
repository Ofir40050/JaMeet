import { $, setText } from './dom';
import { escapeHtml } from './htmlSecurity';

// ========================================================
// TYPES & READONLY PRESENTATION INTERFACES
// ========================================================

export type ReadonlySongItem = Readonly<{
  id: string;
  title: string;
  icon?: string;
  color?: string;
  archived?: boolean;
  order?: number;
  notes?: Readonly<{
    bpm?: string;
    key?: string;
  }>;
  createdAt?: number;
  updatedAt?: number;
}>;

export interface SongsUiOptions {
  getSongs: () => readonly ReadonlySongItem[];
  getActiveSongId: () => string | null | undefined;
  getProjectNotesFallback?: () => Readonly<{ bpm?: string; key?: string }> | null;
  canEdit: () => boolean;

  onCreateSong: (title: string) => void;
  onSelectSong: (songId: string) => void;
  onOpenSongStudio: (songId: string, targetTab: 'lyrics' | 'structure' | 'notes') => void;
  onCloseSongStudio?: () => void;
  onSwitchSongInStudio: (songId: string) => void;
  onRenameSong: (songId: string, newTitle: string) => void;
  onDuplicateSong: (songId: string) => void;
  onToggleArchiveSong: (songId: string, isArchived: boolean) => void;
  onDeleteSong: (songId: string) => void;
  onReorderSongs: (sourceId: string, targetId: string) => void;
}

// ========================================================
// UI STATE (OWNED EXCLUSIVELY BY SONGS UI MODULE)
// ========================================================

let currentSongsOverviewPage = 1;
const SONGS_PER_PAGE = 5;

let songsUiOptions: SongsUiOptions | null = null;
let listenersBound = false;

// ========================================================
// CONTEXT MENU
// ========================================================

export function showSongContextMenu(e: MouseEvent, song: ReadonlySongItem): void {
  if (!songsUiOptions) return;
  e.preventDefault();
  e.stopPropagation();

  document.querySelectorAll('.task-context-menu, .song-context-menu').forEach((m) => m.remove());

  const canEdit = songsUiOptions.canEdit();
  const menu = document.createElement('div');
  menu.className = 'task-context-menu song-context-menu';

  const isArchived = Boolean(song.archived);

  menu.innerHTML = `
    <div class="task-context-item" data-action="open-studio">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
        <span>Open in Song Studio</span>
      </div>
    </div>
    ${canEdit ? `
      <div class="task-context-item" data-action="rename">
        <div class="task-context-item-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
          <span>Rename Track</span>
        </div>
      </div>
      <div class="task-context-item" data-action="archive">
        <div class="task-context-item-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
          <span>${isArchived ? 'Unarchive Track' : 'Archive Track'}</span>
        </div>
      </div>
      <div class="task-context-divider"></div>
      <div class="task-context-item danger" data-action="delete">
        <div class="task-context-item-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></svg>
          <span>Delete Track</span>
        </div>
      </div>
    ` : ''}
  `;

  document.body.appendChild(menu);

  const menuWidth = 190;
  const menuHeight = menu.offsetHeight || 140;
  let x = e.clientX;
  let y = e.clientY;

  if (x + menuWidth > window.innerWidth - 10) x = window.innerWidth - menuWidth - 10;
  if (y + menuHeight > window.innerHeight - 10) y = window.innerHeight - menuHeight - 10;

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  menu.querySelectorAll<HTMLElement>('.task-context-item').forEach((item) => {
    item.addEventListener('click', (ev) => {
      if (!songsUiOptions) return;
      ev.stopPropagation();
      menu.remove();
      const action = item.dataset.action;
      if (action === 'open-studio') {
        songsUiOptions.onOpenSongStudio(song.id, 'lyrics');
      } else if (action === 'rename') {
        const songCard = document.querySelector(`.overview-song-card[data-song-id="${song.id}"]`);
        const titleEl = songCard?.querySelector('.overview-song-title') as HTMLElement;
        if (titleEl) {
          titleEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        }
      } else if (action === 'archive') {
        songsUiOptions.onToggleArchiveSong(song.id, !isArchived);
      } else if (action === 'delete') {
        songsUiOptions.onDeleteSong(song.id);
      }
    });
  });

  const closeHandler = () => {
    menu.remove();
    document.removeEventListener('click', closeHandler);
    document.removeEventListener('contextmenu', closeHandler);
  };
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
    document.addEventListener('contextmenu', closeHandler);
  }, 0);
}

// ========================================================
// QUICK CREATION HELPER
// ========================================================

function triggerQuickCreateSong(): void {
  if (!songsUiOptions || !songsUiOptions.canEdit()) return;
  const songs = songsUiOptions.getSongs();
  const nextNum = songs.length + 1;
  currentSongsOverviewPage = Math.ceil(nextNum / SONGS_PER_PAGE);
  $('project-songs-dropdown-menu')?.classList.add('hidden');
  songsUiOptions.onCreateSong(`Song ${nextNum}`);
}

// ========================================================
// RENDERING
// ========================================================

export function renderProjectOverviewSongsList(): void {
  if (!songsUiOptions) return;
  const songs = songsUiOptions.getSongs();
  const activeSongId = songsUiOptions.getActiveSongId();
  const projectNotes = songsUiOptions.getProjectNotesFallback?.();

  setText('project-overview-songs-count', songs.length.toString());

  const listEl = $('project-overview-songs-list');
  const pagEl = $('project-overview-songs-pagination');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (songs.length === 0) {
    if (pagEl) pagEl.classList.add('hidden');
    listEl.innerHTML = `
      <div class="workspace-empty-row" style="padding: 12px 0;">
        <div class="workspace-empty-text">
          <span class="workspace-empty-title" style="font-size: 13px; font-weight: 600;">No tracks in this project yet</span>
          <span class="workspace-empty-desc" style="font-size: 11px;">Click "+" above to create your first track.</span>
        </div>
      </div>
    `;
    return;
  }

  const totalPages = Math.ceil(songs.length / SONGS_PER_PAGE) || 1;
  if (currentSongsOverviewPage > totalPages) {
    currentSongsOverviewPage = totalPages;
  }
  if (currentSongsOverviewPage < 1) {
    currentSongsOverviewPage = 1;
  }

  const startIndex = (currentSongsOverviewPage - 1) * SONGS_PER_PAGE;
  const pageSongs = songs.slice(startIndex, startIndex + SONGS_PER_PAGE);

  pageSongs.forEach((song, pIdx) => {
    if (!song) return;
    const globalIdx = startIndex + pIdx;
    const isCurrent = song.id === activeSongId;
    const card = document.createElement('div');
    card.className = `overview-song-card ${isCurrent ? 'active' : ''}`;
    card.dataset.songId = song.id;

    const bpmRaw = (song.notes?.bpm || projectNotes?.bpm || '').trim();
    const bpmClean = bpmRaw ? (bpmRaw.toLowerCase().includes('bpm') ? bpmRaw : `${bpmRaw} BPM`) : '120 BPM';
    const keyRaw = (song.notes?.key || projectNotes?.key || '').trim();
    const keyClean = keyRaw || 'C Major';

    const isArchived = Boolean(song.archived);
    const archivedBadge = isArchived
      ? `<span class="song-meta-badge badge-archived" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3);">Archived</span>`
      : '';

    card.innerHTML = `
      <div class="overview-song-left">
        <span class="overview-song-num">${String(globalIdx + 1).padStart(2, '0')}</span>
        <div class="overview-song-details">
          <span class="overview-song-title" title="Double click to rename">${escapeHtml(song.title || `Song ${globalIdx + 1}`)}</span>
          <div class="overview-song-meta">
            ${archivedBadge}
            <span class="song-meta-badge">${escapeHtml(bpmClean)}</span>
            <span class="song-meta-badge">${escapeHtml(keyClean)}</span>
          </div>
        </div>
      </div>
      <div class="overview-song-right">
        <button type="button" class="btn-open-song-studio" title="Open Song Studio" aria-label="Open Song Studio">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </button>
      </div>
    `;

    // Double-click inline rename
    const titleEl = card.querySelector('.overview-song-title') as HTMLElement;
    const startRename = () => {
      if (!songsUiOptions || !songsUiOptions.canEdit()) return;
      if (titleEl.querySelector('input')) return;
      const currentTitle = song.title || `Song ${globalIdx + 1}`;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'song-inline-rename-input';
      input.value = currentTitle;
      input.maxLength = 80;

      let committed = false;
      const commit = () => {
        if (committed) return;
        committed = true;
        const newTitle = input.value.trim();
        if (newTitle && newTitle !== currentTitle) {
          songsUiOptions?.onRenameSong(song.id, newTitle);
        }
        renderProjectSongsSelector();
      };

      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') {
          ke.preventDefault();
          commit();
        } else if (ke.key === 'Escape') {
          ke.preventDefault();
          committed = true;
          renderProjectSongsSelector();
        }
      });
      input.addEventListener('click', (ce) => ce.stopPropagation());
      input.addEventListener('dblclick', (de) => de.stopPropagation());
      input.addEventListener('blur', commit);

      titleEl.replaceChildren(input);
      input.focus();
      input.select();
    };

    titleEl?.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    titleEl?.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      e.preventDefault();
      startRename();
    });

    const openBtn = card.querySelector('.btn-open-song-studio') as HTMLElement;
    openBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      songsUiOptions?.onOpenSongStudio(song.id, 'lyrics');
    });

    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      songsUiOptions?.onOpenSongStudio(song.id, 'lyrics');
    });

    card.addEventListener('contextmenu', (e) => {
      showSongContextMenu(e, song);
    });

    listEl.appendChild(card);
  });

  // Render pagination controls
  if (pagEl) {
    if (totalPages > 1) {
      pagEl.classList.remove('hidden');
      const prevBtn = $('btn-songs-prev-page') as HTMLButtonElement;
      const nextBtn = $('btn-songs-next-page') as HTMLButtonElement;
      if (prevBtn) prevBtn.disabled = currentSongsOverviewPage <= 1;
      if (nextBtn) nextBtn.disabled = currentSongsOverviewPage >= totalPages;

      const indicatorsEl = $('songs-page-indicators');
      if (indicatorsEl) {
        indicatorsEl.innerHTML = '';
        for (let i = 1; i <= totalPages; i++) {
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className = `btn-songs-page-pill ${i === currentSongsOverviewPage ? 'active' : ''}`;
          pill.textContent = String(i);
          pill.addEventListener('click', (e) => {
            e.stopPropagation();
            currentSongsOverviewPage = i;
            renderProjectOverviewSongsList();
          });
          indicatorsEl.appendChild(pill);
        }
      }
    } else {
      pagEl.classList.add('hidden');
    }
  }
}

export function renderSongStudioHeader(): void {
  if (!songsUiOptions) return;
  const songs = songsUiOptions.getSongs();
  const activeSongId = songsUiOptions.getActiveSongId();
  const activeSong = songs.find((s) => s.id === activeSongId) || songs[0];
  const activeTitle = activeSong?.title || 'Untitled Song';

  setText('active-song-title-display', activeTitle);
  setText('song-studio-active-title', activeTitle);
  setText('songs-dropdown-count', `${songs.length} Track${songs.length === 1 ? '' : 's'}`);

  const quickSelect = $<HTMLSelectElement>('select-song-studio-quick-switch');
  if (quickSelect) {
    quickSelect.innerHTML = '';
    songs.forEach((s, i) => {
      if (!s) return;
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${i + 1}. ${s.title || `Song ${i + 1}`}`;
      opt.selected = s.id === (activeSong?.id || activeSongId);
      quickSelect.appendChild(opt);
    });
  }
}

export function renderProjectSongsSelector(): void {
  if (!songsUiOptions) return;
  const songs = songsUiOptions.getSongs();
  const activeSongId = songsUiOptions.getActiveSongId();
  const activeSong = songs.find((s) => s.id === activeSongId) || songs[0];
  const activeTitle = activeSong?.title || 'Untitled Song';

  // 1. Update active song trigger title & studio headers
  setText('active-song-title-display', activeTitle);
  setText('song-studio-active-title', activeTitle);
  setText('songs-dropdown-count', `${songs.length} Track${songs.length === 1 ? '' : 's'}`);

  // 2. Render Overview songs list
  renderProjectOverviewSongsList();

  // 3. Update Quick Switch in Song Studio
  const quickSelect = $<HTMLSelectElement>('select-song-studio-quick-switch');
  if (quickSelect) {
    quickSelect.innerHTML = '';
    songs.forEach((s, i) => {
      if (!s) return;
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${i + 1}. ${s.title || `Song ${i + 1}`}`;
      opt.selected = s.id === (activeSong?.id || activeSongId);
      quickSelect.appendChild(opt);
    });
  }

  // 4. Render dropdown songs list
  const listEl = $('project-songs-list');
  if (listEl) {
    listEl.innerHTML = '';
    songs.forEach((song, idx) => {
      if (!song) return;
      const isActive = song.id === (activeSong?.id || activeSongId);
      const item = document.createElement('div');
      item.className = `song-dropdown-item ${isActive ? 'active' : ''}`;
      item.dataset.songId = song.id;
      item.draggable = true;

      item.innerHTML = `
        <div class="song-item-left">
          <span class="song-item-idx">${idx + 1}</span>
          <span class="song-item-name" title="Double click to rename">${escapeHtml(song.title || `Song ${idx + 1}`)}</span>
        </div>
        <div class="song-item-actions">
          <button type="button" class="btn-song-item-action btn-rename" title="Rename"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button>
          <button type="button" class="btn-song-item-action btn-dup" title="Duplicate"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>
          ${songs.length > 1 ? `<button type="button" class="btn-song-item-action delete btn-del" title="Delete Song"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></svg></button>` : ''}
        </div>
      `;

      // Inline rename in dropdown
      const nameEl = item.querySelector('.song-item-name') as HTMLElement;
      const startRename = () => {
        if (!songsUiOptions || !songsUiOptions.canEdit()) return;
        if (nameEl.querySelector('input')) return;
        const currentTitle = song.title || `Song ${idx + 1}`;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'sidebar-item-rename-input';
        input.value = currentTitle;
        input.maxLength = 80;

        const commit = () => {
          const newTitle = input.value.trim();
          if (newTitle && newTitle !== currentTitle) {
            songsUiOptions?.onRenameSong(song.id, newTitle);
          }
          renderProjectSongsSelector();
        };

        input.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter') {
            ke.preventDefault();
            input.blur();
          } else if (ke.key === 'Escape') {
            ke.preventDefault();
            renderProjectSongsSelector();
          }
        });
        input.addEventListener('click', (ce) => ce.stopPropagation());
        input.addEventListener('dblclick', (de) => de.stopPropagation());
        input.addEventListener('blur', commit);

        nameEl.replaceChildren(input);
        input.focus();
        input.select();
      };

      item.addEventListener('dblclick', (e) => {
        if ((e.target as HTMLElement).closest('.btn-song-item-action')) return;
        e.stopPropagation();
        startRename();
      });
      item.querySelector('.btn-rename')?.addEventListener('click', (e) => {
        e.stopPropagation();
        startRename();
      });
      item.querySelector('.btn-dup')?.addEventListener('click', (e) => {
        e.stopPropagation();
        songsUiOptions?.onDuplicateSong(song.id);
      });
      item.querySelector('.btn-del')?.addEventListener('click', (e) => {
        e.stopPropagation();
        songsUiOptions?.onDeleteSong(song.id);
      });
      item.addEventListener('contextmenu', (e) => {
        showSongContextMenu(e, song);
      });
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.btn-song-item-action') || (e.target as HTMLElement).tagName === 'INPUT') return;
        songsUiOptions?.onSelectSong(song.id);
        $('project-songs-dropdown-menu')?.classList.add('hidden');
      });

      // Drag & Drop
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', song.id);
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const sourceId = e.dataTransfer?.getData('text/plain');
        if (sourceId && sourceId !== song.id) {
          songsUiOptions?.onReorderSongs(sourceId, song.id);
        }
      });

      listEl.appendChild(item);
    });
  }

  // 5. Update In-Session Drawer Song Select
  const drawerSongSelect = $<HTMLSelectElement>('session-workspace-song-select');
  if (drawerSongSelect) {
    drawerSongSelect.innerHTML = '';
    songs.forEach((s, idx) => {
      if (!s) return;
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${idx + 1}. ${s.title || `Song ${idx + 1}`}`;
      opt.selected = s.id === (activeSong?.id || activeSongId);
      drawerSongSelect.appendChild(opt);
    });
  }
}

// ========================================================
// INITIALIZATION & EVENT LISTENERS
// ========================================================

export function initSongsUi(options: SongsUiOptions): void {
  songsUiOptions = options;

  if (listenersBound) return;
  listenersBound = true;

  // Song Switcher Trigger & Dropdown
  $('btn-active-song-trigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('project-songs-dropdown-menu')?.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    const menu = $('project-songs-dropdown-menu');
    if (menu && !menu.contains(e.target as Node) && e.target !== $('btn-active-song-trigger')) {
      menu.classList.add('hidden');
    }
  });

  // Overview Pagination
  $('btn-songs-prev-page')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentSongsOverviewPage > 1) {
      currentSongsOverviewPage--;
      renderProjectOverviewSongsList();
    }
  });

  $('btn-songs-next-page')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!songsUiOptions) return;
    const songs = songsUiOptions.getSongs();
    const totalPages = Math.ceil(songs.length / SONGS_PER_PAGE) || 1;
    if (currentSongsOverviewPage < totalPages) {
      currentSongsOverviewPage++;
      renderProjectOverviewSongsList();
    }
  });

  // Quick Create Buttons
  $('btn-quick-new-song')?.addEventListener('click', (e) => {
    e.stopPropagation();
    triggerQuickCreateSong();
  });

  $('btn-open-new-song-modal')?.addEventListener('click', (e) => {
    e.stopPropagation();
    triggerQuickCreateSong();
  });

  $('btn-overview-new-song')?.addEventListener('click', (e) => {
    e.stopPropagation();
    triggerQuickCreateSong();
  });

  $('btn-session-new-song')?.addEventListener('click', (e) => {
    e.stopPropagation();
    triggerQuickCreateSong();
  });

  // Back to Overview from Song Studio
  $('btn-back-to-project-overview')?.addEventListener('click', () => {
    songsUiOptions?.onCloseSongStudio?.();
  });

  // Double-click to rename active song inside Song Studio Header
  $('song-studio-active-title')?.parentElement?.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!songsUiOptions || !songsUiOptions.canEdit()) return;
    const titleEl = $('song-studio-active-title');
    if (!titleEl || titleEl.querySelector('input')) return;

    const songs = songsUiOptions.getSongs();
    const activeSongId = songsUiOptions.getActiveSongId();
    const activeSong = songs.find((s) => s.id === activeSongId) || songs[0];
    if (!activeSong) return;

    const currentTitle = activeSong.title || 'Untitled Song';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'song-inline-rename-input';
    input.value = currentTitle;
    input.maxLength = 80;

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const newTitle = input.value.trim();
      if (newTitle && newTitle !== currentTitle) {
        songsUiOptions?.onRenameSong(activeSong.id, newTitle);
      }
      renderProjectSongsSelector();
    };

    input.addEventListener('keydown', (ke) => {
      if (ke.key === 'Enter') {
        ke.preventDefault();
        commit();
      } else if (ke.key === 'Escape') {
        ke.preventDefault();
        committed = true;
        renderProjectSongsSelector();
      }
    });
    input.addEventListener('click', (ce) => ce.stopPropagation());
    input.addEventListener('dblclick', (de) => de.stopPropagation());
    input.addEventListener('blur', commit);

    titleEl.replaceChildren(input);
    input.focus();
    input.select();
  });

  // Quick Switch Song Dropdown inside Song Studio
  $<HTMLSelectElement>('select-song-studio-quick-switch')?.addEventListener('change', (e) => {
    const targetId = (e.target as HTMLSelectElement).value;
    if (targetId && songsUiOptions) {
      songsUiOptions.onSwitchSongInStudio(targetId);
    }
  });

  // In-Session Drawer Song Select
  $<HTMLSelectElement>('session-workspace-song-select')?.addEventListener('change', (e) => {
    const targetId = (e.target as HTMLSelectElement).value;
    if (targetId && songsUiOptions) {
      songsUiOptions.onSelectSong(targetId);
    }
  });

  // New Song Modal Controls
  const closeNewSongModal = () => {
    $('new-song-modal')?.classList.add('hidden');
    const err = $('new-song-error');
    if (err) err.classList.add('hidden');
  };

  $('btn-close-new-song-modal')?.addEventListener('click', closeNewSongModal);
  $('btn-cancel-new-song')?.addEventListener('click', closeNewSongModal);

  $('btn-confirm-create-song')?.addEventListener('click', () => {
    if (!songsUiOptions || !songsUiOptions.canEdit()) return;
    const input = $<HTMLInputElement>('input-new-song-title');
    const title = input?.value.trim() || '';
    if (!title) {
      const err = $('new-song-error');
      if (err) {
        err.textContent = 'Please enter a song title.';
        err.classList.remove('hidden');
      }
      return;
    }
    songsUiOptions.onCreateSong(title);
    closeNewSongModal();
    if (input) input.value = '';
  });

  $('input-new-song-title')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('btn-confirm-create-song')?.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeNewSongModal();
    }
  });

  // Song Title Preset Chips
  document.querySelectorAll<HTMLButtonElement>('.btn-song-title-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const title = btn.dataset.title;
      const input = $<HTMLInputElement>('input-new-song-title');
      if (input && title) {
        input.value = title;
        input.focus();
      }
    });
  });
}
