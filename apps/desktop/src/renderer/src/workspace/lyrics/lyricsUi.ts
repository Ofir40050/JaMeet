import { $, setText } from '../../core/dom';
import { escapeHtml, sanitizeLyricsHtml } from '../../core/htmlSecurity';

export interface LyricsDoc {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
}

export interface LyricsUiOptions {
  isInCall: () => boolean;
  canEdit: () => boolean;
  getActiveLyricsDoc: () => LyricsDoc;
  onLyricsInput?: (content: string) => void;
  onDocTitleChange?: (docId: string, newTitle: string) => void;
  onSwitchDoc?: (docId: string) => void;
  onDuplicateDoc?: (docId: string) => void;
  onDeleteDoc?: (docId: string) => void;
}

let options: LyricsUiOptions | null = null;
let listenersBound = false;
let currentLyricsStatus: 'saving' | 'saved' | 'unsaved' = 'saved';

export function getLyricsStatus(): 'saving' | 'saved' | 'unsaved' {
  return currentLyricsStatus;
}

export function setLyricsStatus(status: 'saving' | 'saved' | 'unsaved'): void {
  currentLyricsStatus = status;
  const badges = [$('project-lyrics-status'), $('session-workspace-status'), $('session-workspace-status-badge')];
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed';
  badges.forEach((b) => {
    if (!b) return;
    b.className = `workspace-status-badge ${status}`;
    b.innerHTML = `<span class="status-dot"></span> <span id="session-workspace-status-text">${label}</span>`;
  });
  if (status === 'saved') {
    setText('lyrics-footer-last-saved', `Saved to cloud at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
  } else if (status === 'unsaved') {
    setText('lyrics-footer-last-saved', 'Save failed · Unsaved changes');
  }
}

export function applyLyricsPermissions(canEdit: boolean): void {
  const projectLyricsEditor = $('project-lyrics-editor');
  const sessionLyricsEditor = $('session-lyrics-editor');
  if (projectLyricsEditor) {
    projectLyricsEditor.setAttribute('contenteditable', canEdit ? 'true' : 'false');
    projectLyricsEditor.classList.toggle('readonly-viewer', !canEdit);
    projectLyricsEditor.style.cursor = canEdit ? 'text' : 'default';
  }
  if (sessionLyricsEditor) {
    sessionLyricsEditor.setAttribute('contenteditable', canEdit ? 'true' : 'false');
    sessionLyricsEditor.classList.toggle('readonly-viewer', !canEdit);
    sessionLyricsEditor.style.cursor = canEdit ? 'text' : 'default';
  }
  const lyricsToolbar = $('lyrics-formatting-toolbar');
  if (lyricsToolbar) {
    lyricsToolbar.style.display = canEdit ? '' : 'none';
  }
  const btnNewDoc = $('btn-new-lyrics-doc');
  if (btnNewDoc) {
    btnNewDoc.style.display = canEdit ? '' : 'none';
  }
  const sectionHelperBar = document.querySelector<HTMLElement>('.lyrics-section-helpers-bar');
  if (sectionHelperBar) {
    sectionHelperBar.style.display = canEdit ? '' : 'none';
  }
}

export function renderLyricsDocTabs(activeDoc?: LyricsDoc): void {
  const doc = activeDoc || options?.getActiveLyricsDoc();
  if (!doc) return;
  const titleInput = $<HTMLInputElement>('lyrics-current-doc-title');
  if (titleInput && document.activeElement !== titleInput) {
    titleInput.value = doc.title || '';
  }
}

export function updateLyricsDocumentPagination(): void {
  const projectEditor = $('project-lyrics-editor');
  const pagesBg = $('lyrics-pages-background');
  if (!projectEditor || !pagesBg) return;

  const PAGE_HEIGHT = 1056; // 11 inches at 96 DPI
  const PAGE_GAP = 28;      // physical separation gap
  const PAGE_TOP_MARGIN = 52;
  const PAGE_BOTTOM_MARGIN = 56;
  const PAGE_PITCH = PAGE_HEIGHT + PAGE_GAP; // 1084px

  // Reset any previous page-break gap margins to measure natural positioning
  const children = Array.from(projectEditor.children) as HTMLElement[];
  children.forEach((child) => {
    if (child.classList.contains('doc-page-break-gap')) {
      child.style.marginTop = '';
      child.classList.remove('doc-page-break-gap');
    }
  });

  // Calculate page distribution for block elements
  let currentPageIndex = 0; // 0 = Page 1
  let currentSheetPrintableBottom = PAGE_HEIGHT - PAGE_BOTTOM_MARGIN;

  if (children.length > 0) {
    children.forEach((child) => {
      const childTop = child.offsetTop;
      const childHeight = child.offsetHeight || 24;
      const childBottom = childTop + childHeight;

      if (childBottom > currentSheetPrintableBottom) {
        // Child overflows current page printable boundary; push to next page
        currentPageIndex++;
        const targetPrintableTop = (currentPageIndex * PAGE_PITCH) + PAGE_TOP_MARGIN;
        const neededMargin = Math.max(0, targetPrintableTop - child.offsetTop);
        child.style.marginTop = `${neededMargin}px`;
        child.classList.add('doc-page-break-gap');
        currentSheetPrintableBottom = (currentPageIndex * PAGE_PITCH) + PAGE_HEIGHT - PAGE_BOTTOM_MARGIN;
      }
    });
  }

  let totalPages = Math.max(1, currentPageIndex + 1);

  // Secondary height check to ensure pages background always covers entire editor extent
  const editorHeight = projectEditor.scrollHeight || projectEditor.offsetHeight;
  const minPagesByHeight = Math.max(1, Math.ceil((editorHeight + 80) / PAGE_PITCH));
  if (minPagesByHeight > totalPages) {
    totalPages = minPagesByHeight;
  }

  // Render or update background US Letter page sheets
  const existingSheets = pagesBg.querySelectorAll('.lyrics-page-sheet');

  if (existingSheets.length !== totalPages) {
    let sheetsHtml = '';
    for (let i = 1; i <= totalPages; i++) {
      sheetsHtml += `<div class="lyrics-page-sheet" data-page="${i}"></div>`;
    }
    pagesBg.innerHTML = sheetsHtml;
  }

  // Update editor min-height to match total pages
  projectEditor.style.minHeight = `${totalPages * PAGE_PITCH - PAGE_GAP - 120}px`;
}

export function updateLyricsStatsFromHtml(html: string): void {
  const temp = document.createElement('div');
  temp.innerHTML = html || '';
  const text = temp.innerText || temp.textContent || '';

  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  const lines = text ? text.split('\n').filter((l) => l.trim().length > 0).length : 0;
  const chars = text.length;

  // Singing time estimate at 130 words per minute
  const totalSeconds = words > 0 ? Math.max(15, Math.round((words / 130) * 60)) : 0;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const singTimeStr = words > 0 ? `~${mins}:${secs < 10 ? '0' : ''}${secs} singing time` : '~0:00 singing time';

  // Run dynamic US Letter pagination calculation
  updateLyricsDocumentPagination();

  const pagesBg = $('lyrics-pages-background');
  const pageCount = pagesBg?.querySelectorAll('.lyrics-page-sheet').length || 1;
  const pageStr = `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`;

  setText('project-lyrics-stats', `${pageStr} · ${words} ${words === 1 ? 'word' : 'words'} · ${lines} ${lines === 1 ? 'line' : 'lines'}`);
  setText('session-lyrics-stats-text', `${words} ${words === 1 ? 'Word' : 'Words'} · ${lines} ${lines === 1 ? 'Line' : 'Lines'}`);
  setText('lyrics-footer-char-count', `${chars} ${chars === 1 ? 'character' : 'characters'} · US Letter`);
  setText('lyrics-footer-read-time', singTimeStr);
}

export function handleLyricsEditorInput(source: 'project' | 'session'): void {
  if (!options?.canEdit()) return;
  const projectEditor = $('project-lyrics-editor');
  const sessionEditor = $('session-lyrics-editor');
  const sourceEl = source === 'project' ? projectEditor : sessionEditor;
  const targetEl = source === 'project' ? sessionEditor : projectEditor;

  const newHtml = sanitizeLyricsHtml(sourceEl?.innerHTML || '');
  if (targetEl && document.activeElement !== targetEl) {
    targetEl.innerHTML = newHtml;
  }

  updateLyricsStatsFromHtml(newHtml);
  options?.onLyricsInput?.(newHtml);
}

export function execDocFormat(command: string, value: string = ''): void {
  const projectEditor = $('project-lyrics-editor');
  const sessionEditor = $('session-lyrics-editor');
  const inCall = options?.isInCall() ?? false;
  const activeEditor = inCall && document.activeElement === sessionEditor ? sessionEditor : projectEditor || sessionEditor;

  if (activeEditor) {
    activeEditor.focus();
  }
  document.execCommand(command, false, value);
  handleLyricsEditorInput(inCall && document.activeElement === sessionEditor ? 'session' : 'project');
}

export function insertSongSectionTag(sectionName: string): void {
  const projectEditor = $('project-lyrics-editor');
  const sessionEditor = $('session-lyrics-editor');
  const inCall = options?.isInCall() ?? false;
  const activeEditor = inCall && document.activeElement === sessionEditor ? sessionEditor : projectEditor || sessionEditor;
  if (!activeEditor) return;

  activeEditor.focus();
  const selection = window.getSelection();
  const tagHtml = `<div class="song-section-tag">[${escapeHtml(sectionName)}]</div><div><br></div>`;

  if (selection && selection.rangeCount > 0) {
    document.execCommand('insertHTML', false, tagHtml);
  } else {
    activeEditor.innerHTML += tagHtml;
  }
  handleLyricsEditorInput(inCall && document.activeElement === sessionEditor ? 'session' : 'project');
}

export function updateSessionDocFormattingState(): void {
  try {
    $('btn-session-doc-bold')?.classList.toggle('active', document.queryCommandState('bold'));
    $('btn-session-doc-italic')?.classList.toggle('active', document.queryCommandState('italic'));
    $('btn-session-doc-underline')?.classList.toggle('active', document.queryCommandState('underline'));
    $('btn-session-doc-strike')?.classList.toggle('active', document.queryCommandState('strikethrough'));
    $('btn-session-doc-align-left')?.classList.toggle('active', document.queryCommandState('justifyLeft'));
    $('btn-session-doc-align-center')?.classList.toggle('active', document.queryCommandState('justifyCenter'));
    $('btn-session-doc-align-right')?.classList.toggle('active', document.queryCommandState('justifyRight'));
  } catch {
    // ignore
  }
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function initLyricsUi(opts: LyricsUiOptions): void {
  options = opts;

  if (listenersBound) return;
  listenersBound = true;

  // Attach Rich Formatting Toolbar Event Listeners
  $('btn-doc-undo')?.addEventListener('click', () => execDocFormat('undo'));
  $('btn-doc-redo')?.addEventListener('click', () => execDocFormat('redo'));
  $('btn-doc-bold')?.addEventListener('click', () => execDocFormat('bold'));
  $('btn-doc-italic')?.addEventListener('click', () => execDocFormat('italic'));
  $('btn-doc-underline')?.addEventListener('click', () => execDocFormat('underline'));
  $('btn-doc-strike')?.addEventListener('click', () => execDocFormat('strikeThrough'));
  $('btn-doc-align-left')?.addEventListener('click', () => execDocFormat('justifyLeft'));
  $('btn-doc-align-center')?.addEventListener('click', () => execDocFormat('justifyCenter'));
  $('btn-doc-align-right')?.addEventListener('click', () => execDocFormat('justifyRight'));
  $('btn-doc-list-bullet')?.addEventListener('click', () => execDocFormat('insertUnorderedList'));
  $('btn-doc-list-num')?.addEventListener('click', () => execDocFormat('insertOrderedList'));
  $('btn-doc-indent')?.addEventListener('click', () => execDocFormat('indent'));
  $('btn-doc-outdent')?.addEventListener('click', () => execDocFormat('outdent'));
  $('btn-doc-clear')?.addEventListener('click', () => execDocFormat('removeFormat'));

  $('select-doc-zoom')?.addEventListener('change', (e) => {
    const zoomVal = parseInt((e.target as HTMLSelectElement).value, 10) || 100;
    const scale = zoomVal / 100;
    const canvas = $('lyrics-document-canvas');
    const wrapper = $('lyrics-canvas-wrapper');
    if (canvas && wrapper) {
      if (scale === 1) {
        canvas.style.transform = '';
        wrapper.style.width = '';
        wrapper.style.height = '';
        wrapper.style.minWidth = '';
        wrapper.style.minHeight = '';
      } else {
        canvas.style.transform = `scale(${scale})`;
        const baseW = 816;
        const baseH = canvas.offsetHeight || 1056;
        const scaledW = Math.round(baseW * scale);
        const scaledH = Math.round(baseH * scale);
        wrapper.style.width = `${scaledW}px`;
        wrapper.style.height = `${scaledH}px`;
        wrapper.style.minWidth = `${scaledW}px`;
        wrapper.style.minHeight = `${scaledH}px`;
      }
    }
  });

  $('select-session-doc-zoom')?.addEventListener('change', (e) => {
    const zoomVal = parseInt((e.target as HTMLSelectElement).value, 10) || 100;
    const scale = zoomVal / 100;
    const canvas = document.querySelector<HTMLElement>('#session-lyrics-viewport .drawer-lyrics-document-canvas');
    const wrapper = document.querySelector<HTMLElement>('#session-lyrics-viewport .drawer-lyrics-canvas-wrapper');
    if (canvas && wrapper) {
      if (scale === 1) {
        canvas.style.transform = '';
        wrapper.style.width = '';
        wrapper.style.height = '';
        wrapper.style.minWidth = '';
        wrapper.style.minHeight = '';
      } else {
        canvas.style.transform = `scale(${scale})`;
        const baseW = 816;
        const baseH = canvas.offsetHeight || 1056;
        const scaledW = Math.round(baseW * scale);
        const scaledH = Math.round(baseH * scale);
        wrapper.style.width = `${scaledW}px`;
        wrapper.style.height = `${scaledH}px`;
        wrapper.style.minWidth = `${scaledW}px`;
        wrapper.style.minHeight = `${scaledH}px`;
      }
    }
  });

  $('select-doc-heading')?.addEventListener('change', (e) => {
    const val = (e.target as HTMLSelectElement).value;
    execDocFormat('formatBlock', `<${val}>`);
  });

  $('select-doc-font')?.addEventListener('change', (e) => {
    const font = (e.target as HTMLSelectElement).value;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      execDocFormat('fontName', font);
    } else {
      const projectEditor = $('project-lyrics-editor');
      if (projectEditor) projectEditor.style.fontFamily = font;
      const sessionEditor = $('session-lyrics-editor');
      if (sessionEditor) sessionEditor.style.fontFamily = font;
    }
    updateLyricsDocumentPagination();
  });

  $('select-session-doc-font')?.addEventListener('change', (e) => {
    const font = (e.target as HTMLSelectElement).value;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      execDocFormat('fontName', font);
    } else {
      const projectEditor = $('project-lyrics-editor');
      if (projectEditor) projectEditor.style.fontFamily = font;
      const sessionEditor = $('session-lyrics-editor');
      if (sessionEditor) sessionEditor.style.fontFamily = font;
    }
    handleLyricsEditorInput('session');
  });

  $('select-doc-fontsize')?.addEventListener('change', (e) => {
    const size = (e.target as HTMLSelectElement).value;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const span = document.createElement('span');
      span.style.fontSize = size;
      span.appendChild(range.extractContents());
      range.insertNode(span);
      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.selectNodeContents(span);
      sel.addRange(newRange);
    } else {
      const projectEditor = $('project-lyrics-editor');
      if (projectEditor) projectEditor.style.fontSize = size;
      const sessionEditor = $('session-lyrics-editor');
      if (sessionEditor) sessionEditor.style.fontSize = size;
    }
    updateLyricsDocumentPagination();
  });

  $('select-session-doc-fontsize')?.addEventListener('change', (e) => {
    const size = (e.target as HTMLSelectElement).value;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const span = document.createElement('span');
      span.style.fontSize = size;
      span.appendChild(range.extractContents());
      range.insertNode(span);
      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.selectNodeContents(span);
      sel.addRange(newRange);
    } else {
      const projectEditor = $('project-lyrics-editor');
      if (projectEditor) projectEditor.style.fontSize = size;
      const sessionEditor = $('session-lyrics-editor');
      if (sessionEditor) sessionEditor.style.fontSize = size;
    }
    handleLyricsEditorInput('session');
  });

  $('select-doc-spacing')?.addEventListener('change', (e) => {
    const spacing = (e.target as HTMLSelectElement).value;
    const projectEditor = $('project-lyrics-editor');
    if (projectEditor) projectEditor.style.lineHeight = spacing;
    const sessionEditor = $('session-lyrics-editor');
    if (sessionEditor) sessionEditor.style.lineHeight = spacing;
    updateLyricsDocumentPagination();
  });

  window.addEventListener('resize', () => {
    if (!$('project-panel-lyrics')?.classList.contains('hidden')) {
      updateLyricsDocumentPagination();
    }
  });

  // Color Picker Popovers Toggle
  $('btn-doc-color-trigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('doc-color-palette')?.classList.toggle('hidden');
    $('doc-hilite-palette')?.classList.add('hidden');
  });

  $('btn-doc-hilite-trigger')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('doc-hilite-palette')?.classList.toggle('hidden');
    $('doc-color-palette')?.classList.add('hidden');
  });

  document.addEventListener('click', () => {
    $('doc-color-palette')?.classList.add('hidden');
    $('doc-hilite-palette')?.classList.add('hidden');
    $('lyrics-doc-options-popover')?.classList.add('hidden');
  });

  document.querySelectorAll<HTMLButtonElement>('.palette-swatch').forEach((swatch) => {
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      const cmd = swatch.dataset.cmd;
      const color = swatch.dataset.color;
      if (cmd && color) {
        execDocFormat(cmd, color);
        if (cmd === 'foreColor') {
          const bar = $('current-text-color-bar');
          if (bar) bar.style.background = color;
        } else if (cmd === 'hiliteColor') {
          const bar = $('current-hilite-color-bar');
          if (bar) bar.style.background = color === 'transparent' ? 'transparent' : color;
        }
      }
      $('doc-color-palette')?.classList.add('hidden');
      $('doc-hilite-palette')?.classList.add('hidden');
    });
  });

  $('doc-custom-text-color')?.addEventListener('input', (e) => {
    const color = (e.target as HTMLInputElement).value;
    if (color) {
      execDocFormat('foreColor', color);
      const bar = $('current-text-color-bar');
      if (bar) bar.style.background = color;
    }
  });

  $('doc-custom-hilite-color')?.addEventListener('input', (e) => {
    const color = (e.target as HTMLInputElement).value;
    if (color) {
      execDocFormat('hiliteColor', color);
      const bar = $('current-hilite-color-bar');
      if (bar) bar.style.background = color;
    }
  });

  // Section Insert Helpers
  document.querySelectorAll<HTMLButtonElement>('.btn-section-insert, .btn-session-section-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      if (section) insertSongSectionTag(section);
    });
  });

  // In-Session Formatting Toolbar
  $('btn-session-doc-undo')?.addEventListener('click', () => {
    execDocFormat('undo');
    updateSessionDocFormattingState();
  });
  $('btn-session-doc-redo')?.addEventListener('click', () => {
    execDocFormat('redo');
    updateSessionDocFormattingState();
  });
  $('btn-session-doc-bold')?.addEventListener('click', () => {
    execDocFormat('bold');
    updateSessionDocFormattingState();
  });
  $('btn-session-doc-italic')?.addEventListener('click', () => {
    execDocFormat('italic');
    updateSessionDocFormattingState();
  });
  $('btn-session-doc-underline')?.addEventListener('click', () => {
    execDocFormat('underline');
    updateSessionDocFormattingState();
  });
  $('btn-session-doc-strike')?.addEventListener('click', () => {
    execDocFormat('strikethrough');
    updateSessionDocFormattingState();
  });
  $('btn-session-doc-align-left')?.addEventListener('click', () => {
    execDocFormat('justifyLeft');
    updateSessionDocFormattingState();
  });
  $('btn-session-doc-align-center')?.addEventListener('click', () => {
    execDocFormat('justifyCenter');
    updateSessionDocFormattingState();
  });
  $('btn-session-doc-align-right')?.addEventListener('click', () => {
    execDocFormat('justifyRight');
    updateSessionDocFormattingState();
  });
  $('select-session-doc-heading')?.addEventListener('change', (e) => {
    const val = (e.target as HTMLSelectElement).value;
    if (['h1', 'h2', 'h3', 'p'].includes(val)) {
      execDocFormat('formatBlock', `<${val}>`);
    } else if (['verse', 'chorus', 'bridge'].includes(val)) {
      const label = val === 'verse' ? 'Verse' : val === 'chorus' ? 'Chorus' : 'Bridge';
      insertSongSectionTag(label);
    }
    updateSessionDocFormattingState();
  });

  $('session-lyrics-editor')?.addEventListener('keyup', updateSessionDocFormattingState);
  $('session-lyrics-editor')?.addEventListener('mouseup', updateSessionDocFormattingState);
  $('session-lyrics-editor')?.addEventListener('click', updateSessionDocFormattingState);

  // Search & Replace Bar in Document
  $('btn-doc-search-toggle')?.addEventListener('click', () => {
    const bar = $('lyrics-search-bar');
    bar?.classList.toggle('hidden');
    if (!bar?.classList.contains('hidden')) {
      $<HTMLInputElement>('doc-search-input')?.focus();
    }
  });

  $('btn-doc-search-close')?.addEventListener('click', () => {
    $('lyrics-search-bar')?.classList.add('hidden');
  });

  $('btn-doc-find-next')?.addEventListener('click', () => {
    const query = $<HTMLInputElement>('doc-search-input')?.value.trim();
    if (query) (window as any).find?.(query, false, false, true, false, false, false);
  });

  $('btn-doc-find-prev')?.addEventListener('click', () => {
    const query = $<HTMLInputElement>('doc-search-input')?.value.trim();
    if (query) (window as any).find?.(query, false, true, true, false, false, false);
  });

  $('btn-doc-replace-one')?.addEventListener('click', () => {
    const findVal = $<HTMLInputElement>('doc-search-input')?.value;
    const replaceVal = $<HTMLInputElement>('doc-replace-input')?.value ?? '';
    if (!findVal) return;

    const activeDoc = options?.getActiveLyricsDoc();
    if (activeDoc && activeDoc.content.includes(findVal)) {
      activeDoc.content = sanitizeLyricsHtml(activeDoc.content.replace(findVal, replaceVal));
      const editor = $('project-lyrics-editor');
      if (editor) editor.innerHTML = activeDoc.content;
      handleLyricsEditorInput('project');
    }
  });

  $('btn-doc-replace-all')?.addEventListener('click', () => {
    const findVal = $<HTMLInputElement>('doc-search-input')?.value;
    const replaceVal = $<HTMLInputElement>('doc-replace-input')?.value ?? '';
    if (!findVal) return;

    const activeDoc = options?.getActiveLyricsDoc();
    if (activeDoc) {
      const re = new RegExp(escapeRegex(findVal), 'g');
      activeDoc.content = sanitizeLyricsHtml(activeDoc.content.replace(re, replaceVal));
      const editor = $('project-lyrics-editor');
      if (editor) editor.innerHTML = activeDoc.content;
      handleLyricsEditorInput('project');
    }
  });

  // Document Title Rename in Sheet Header
  $('lyrics-doc-filter-input')?.addEventListener('input', () => {
    const activeDoc = options?.getActiveLyricsDoc();
    if (activeDoc) renderLyricsDocTabs(activeDoc);
  });

  $('lyrics-current-doc-title')?.addEventListener('input', (e) => {
    const newTitle = (e.target as HTMLInputElement).value.trim();
    if (!newTitle) return;
    const activeDoc = options?.getActiveLyricsDoc();
    if (activeDoc) {
      options?.onDocTitleChange?.(activeDoc.id, newTitle);
    }
  });

  // Document Options Popover Menu
  $('btn-doc-options-menu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const pop = $('lyrics-doc-options-popover');
    if (!pop) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    pop.style.top = `${rect.bottom + 6}px`;
    pop.style.right = `${window.innerWidth - rect.right}px`;
    pop.style.left = 'auto';
    pop.classList.toggle('hidden');
  });

  $('btn-doc-opt-duplicate')?.addEventListener('click', () => {
    $('lyrics-doc-options-popover')?.classList.add('hidden');
    const activeDoc = options?.getActiveLyricsDoc();
    if (activeDoc) {
      options?.onDuplicateDoc?.(activeDoc.id);
    }
  });

  $('btn-doc-opt-copy-text')?.addEventListener('click', async () => {
    $('lyrics-doc-options-popover')?.classList.add('hidden');
    const activeDoc = options?.getActiveLyricsDoc();
    if (!activeDoc) return;
    const temp = document.createElement('div');
    temp.innerHTML = activeDoc.content;
    const plain = temp.innerText || temp.textContent || '';
    try {
      await navigator.clipboard.writeText(plain);
      alert('✓ Lyrics copied to clipboard!');
    } catch {
      // ignore
    }
  });

  $('btn-doc-opt-delete')?.addEventListener('click', () => {
    $('lyrics-doc-options-popover')?.classList.add('hidden');
    const activeDoc = options?.getActiveLyricsDoc();
    if (activeDoc) {
      options?.onDeleteDoc?.(activeDoc.id);
    }
  });

  // In-Session Document Select Dropdown
  $<HTMLSelectElement>('session-lyrics-doc-select')?.addEventListener('change', (e) => {
    const docId = (e.target as HTMLSelectElement).value;
    if (docId) options?.onSwitchDoc?.(docId);
  });

  // Editor Input Listeners
  $('project-lyrics-editor')?.addEventListener('input', () => handleLyricsEditorInput('project'));
  $('session-lyrics-editor')?.addEventListener('input', () => handleLyricsEditorInput('session'));
}
