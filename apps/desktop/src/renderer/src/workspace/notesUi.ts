/**
 * Notes & Songwriting Ideas UI Engine
 * Handles project/session textarea presentations, BPM & musical key controls,
 * automatic bullet points, cursor preservation, permissions, and status badges.
 */

import { $, setText } from '../core/dom';

export interface NotesValues {
  content: string;
  bpm: string;
  key: string;
}

export interface NotesUiOptions {
  canEdit: () => boolean;
  onNotesChange: (values: NotesValues) => void;
}

let notesOptions: NotesUiOptions | null = null;
let listenersBound = false;
let currentNotesStatus: 'saving' | 'saved' | 'unsaved' = 'saved';

export function getNotesStatus(): 'saving' | 'saved' | 'unsaved' {
  return currentNotesStatus;
}

export function setNotesStatus(status: 'saving' | 'saved' | 'unsaved'): void {
  currentNotesStatus = status;
  const badges = [$('project-notes-status'), $('session-workspace-status'), $('session-workspace-status-badge')];
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed';
  badges.forEach((b) => {
    if (!b) return;
    b.className = `workspace-status-badge ${status}`;
    b.innerHTML = `<span class="status-dot"></span> <span id="session-workspace-status-text">${label}</span>`;
  });
}

/**
 * Applies text update to a textarea (e.g. Notes) while preserving active cursor position
 */
export function applyTextareaUpdatePreservingCursor(
  textarea: HTMLTextAreaElement,
  newText: string
): void {
  if (textarea.value === newText) return;
  const isFocused = document.activeElement === textarea;
  const oldText = textarea.value;
  const oldStart = textarea.selectionStart ?? oldText.length;
  const oldEnd = textarea.selectionEnd ?? oldText.length;

  textarea.value = newText;

  if (isFocused) {
    let newStart = oldStart;
    let newEnd = oldEnd;
    if (newText.length !== oldText.length) {
      let commonPrefix = 0;
      while (commonPrefix < oldText.length && commonPrefix < newText.length && oldText[commonPrefix] === newText[commonPrefix]) {
        commonPrefix++;
      }
      if (oldStart <= commonPrefix) {
        newStart = oldStart;
        newEnd = oldEnd;
      } else {
        const diff = newText.length - oldText.length;
        newStart = Math.max(0, Math.min(newText.length, oldStart + diff));
        newEnd = Math.max(0, Math.min(newText.length, oldEnd + diff));
      }
    }
    try {
      textarea.setSelectionRange(newStart, newEnd);
    } catch {
      // ignore
    }
  }
}

export function parseMusicalKey(keyString: string): { root: string; mode: 'Major' | 'Minor' } {
  if (!keyString || !keyString.trim()) {
    return { root: '', mode: 'Major' };
  }
  const clean = keyString.trim();
  const isMinor = /minor|min|\bm\b/i.test(clean);
  const mode: 'Major' | 'Minor' = isMinor ? 'Minor' : 'Major';

  const rootPart = clean.replace(/\s*(major|minor|maj|min)\s*/gi, '').trim();

  if (/^c[#♯]|^db|^d♭/i.test(rootPart)) return { root: 'C#', mode };
  if (/^d[#♯]|^eb|^e♭/i.test(rootPart)) return { root: 'Eb', mode };
  if (/^f[#♯]|^gb|^g♭/i.test(rootPart)) return { root: 'F#', mode };
  if (/^g[#♯]|^ab|^a♭/i.test(rootPart)) return { root: 'Ab', mode };
  if (/^a[#♯]|^bb|^b♭/i.test(rootPart)) return { root: 'Bb', mode };
  if (/^c/i.test(rootPart)) return { root: 'C', mode };
  if (/^d/i.test(rootPart)) return { root: 'D', mode };
  if (/^e/i.test(rootPart)) return { root: 'E', mode };
  if (/^f/i.test(rootPart)) return { root: 'F', mode };
  if (/^g/i.test(rootPart)) return { root: 'G', mode };
  if (/^a/i.test(rootPart)) return { root: 'A', mode };
  if (/^b/i.test(rootPart)) return { root: 'B', mode };

  return { root: '', mode: 'Major' };
}

export function formatMusicalKey(root: string, mode: 'Major' | 'Minor'): string {
  if (!root) return '';
  const ROOT_DISPLAY: Record<string, string> = {
    'C': 'C',
    'C#': 'C♯',
    'D': 'D',
    'Eb': 'E♭',
    'E': 'E',
    'F': 'F',
    'F#': 'F♯',
    'G': 'G',
    'Ab': 'A♭',
    'A': 'A',
    'Bb': 'B♭',
    'B': 'B'
  };
  const rootName = ROOT_DISPLAY[root] || root;
  return `${rootName} ${mode}`;
}

export function applyKeyToControls(keyString: string, force = false): void {
  const { root, mode } = parseMusicalKey(keyString);
  const pRoot = $<HTMLSelectElement>('project-notes-key-root');
  const pMode = $<HTMLSelectElement>('project-notes-key-mode');
  const sRoot = $<HTMLSelectElement>('session-notes-key-root');
  const sMode = $<HTMLSelectElement>('session-notes-key-mode');

  if (pRoot && (force || document.activeElement !== pRoot)) pRoot.value = root;
  if (pMode && (force || document.activeElement !== pMode)) {
    pMode.value = mode;
    pMode.disabled = !root;
    pMode.style.opacity = root ? '1' : '0.45';
  }

  if (sRoot && (force || document.activeElement !== sRoot)) sRoot.value = root;
  if (sMode && (force || document.activeElement !== sMode)) {
    sMode.value = mode;
    sMode.disabled = !root;
    sMode.style.opacity = root ? '1' : '0.45';
  }
}

export function applyNotesPermissions(canEdit: boolean): void {
  const projectNotes = $<HTMLTextAreaElement>('project-notes-input');
  const sessionNotes = $<HTMLTextAreaElement>('session-notes-input');
  if (projectNotes) {
    projectNotes.readOnly = !canEdit;
    projectNotes.style.cursor = canEdit ? 'text' : 'default';
    projectNotes.placeholder = canEdit ? 'Add production notes, chords, mixing instructions, references…' : 'Notes (View Only)';
  }
  if (sessionNotes) {
    sessionNotes.readOnly = !canEdit;
    sessionNotes.style.cursor = canEdit ? 'text' : 'default';
    sessionNotes.placeholder = canEdit ? 'Session notes…' : 'Notes (View Only)';
  }

  const projectBpm = $<HTMLInputElement>('project-notes-bpm');
  const sessionBpm = $<HTMLInputElement>('session-notes-bpm');
  if (projectBpm) {
    projectBpm.readOnly = !canEdit;
    projectBpm.disabled = !canEdit;
    projectBpm.style.cursor = canEdit ? 'text' : 'default';
  }
  if (sessionBpm) {
    sessionBpm.readOnly = !canEdit;
    sessionBpm.disabled = !canEdit;
    sessionBpm.style.cursor = canEdit ? 'text' : 'default';
  }

  const keyRoot = $<HTMLSelectElement>('project-notes-key-root');
  const keyMode = $<HTMLSelectElement>('project-notes-key-mode');
  if (keyRoot) keyRoot.disabled = !canEdit;
  if (keyMode) keyMode.disabled = !canEdit;
  const sKeyRoot = $<HTMLSelectElement>('session-notes-key-root');
  const sKeyMode = $<HTMLSelectElement>('session-notes-key-mode');
  if (sKeyRoot) sKeyRoot.disabled = !canEdit;
  if (sKeyMode) sKeyMode.disabled = !canEdit;
}

export function syncNotesControls(
  values: { content?: string; bpm?: string; key?: string },
  force = false
): void {
  if (values.content !== undefined) {
    const projectNotesInput = $<HTMLTextAreaElement>('project-notes-input');
    const sessionNotesInput = $<HTMLTextAreaElement>('session-notes-input');
    if (projectNotesInput) applyTextareaUpdatePreservingCursor(projectNotesInput, values.content);
    if (sessionNotesInput) applyTextareaUpdatePreservingCursor(sessionNotesInput, values.content);
  }

  if (values.bpm !== undefined) {
    const projectBpm = $<HTMLInputElement>('project-notes-bpm');
    const sessionBpm = $<HTMLInputElement>('session-notes-bpm');
    if (projectBpm && (force || document.activeElement !== projectBpm)) projectBpm.value = values.bpm;
    if (sessionBpm && (force || document.activeElement !== sessionBpm)) sessionBpm.value = values.bpm;
  }

  if (values.key !== undefined) {
    applyKeyToControls(values.key, force);
  }
}

export function getNotesFieldValues(): NotesValues {
  const projectNotesInput = $<HTMLTextAreaElement>('project-notes-input');
  const sessionNotesInput = $<HTMLTextAreaElement>('session-notes-input');
  const activeNotesEl = document.activeElement === sessionNotesInput ? sessionNotesInput : projectNotesInput;
  const content = activeNotesEl?.value ?? projectNotesInput?.value ?? sessionNotesInput?.value ?? '';

  const projectBpm = $<HTMLInputElement>('project-notes-bpm');
  const sessionBpm = $<HTMLInputElement>('session-notes-bpm');
  const activeBpmEl = document.activeElement === sessionBpm ? sessionBpm : projectBpm;
  const bpm = activeBpmEl?.value ?? projectBpm?.value ?? sessionBpm?.value ?? '';

  const pRoot = $<HTMLSelectElement>('project-notes-key-root');
  const pMode = $<HTMLSelectElement>('project-notes-key-mode');
  const sRoot = $<HTMLSelectElement>('session-notes-key-root');
  const sMode = $<HTMLSelectElement>('session-notes-key-mode');

  let activeRoot = '';
  let activeMode: 'Major' | 'Minor' = 'Major';

  if (document.activeElement === sRoot || document.activeElement === sMode) {
    activeRoot = sRoot?.value ?? '';
    activeMode = (sMode?.value as 'Major' | 'Minor') || 'Major';
  } else if (document.activeElement === pRoot || document.activeElement === pMode) {
    activeRoot = pRoot?.value ?? '';
    activeMode = (pMode?.value as 'Major' | 'Minor') || 'Major';
  } else {
    activeRoot = pRoot?.value ?? sRoot?.value ?? '';
    activeMode = ((pMode?.value ?? sMode?.value) as 'Major' | 'Minor') || 'Major';
  }

  const key = formatMusicalKey(activeRoot, activeMode);
  return { content, bpm, key };
}

// Automatic Bullet Points Management for Project Notes
export function setupBulletPointBehavior(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) return;

  const enforceBulletsOnAllLines = () => {
    const val = textarea.value;
    if (!val || !val.trim()) {
      textarea.value = '• ';
      textarea.selectionStart = textarea.selectionEnd = 2;
      return;
    }
    const lines = val.split('\n');
    let modified = false;
    const fixedLines = lines.map((line) => {
      if (line.startsWith('• ')) return line;
      modified = true;
      if (line.startsWith('•')) return '• ' + line.slice(1).trimStart();
      return '• ' + line;
    });
    if (modified) {
      const pos = textarea.selectionStart;
      textarea.value = fixedLines.join('\n');
      textarea.selectionStart = textarea.selectionEnd = Math.max(2, pos);
    }
  };

  textarea.addEventListener('keydown', (e) => {
    const val = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    // 1. Enter: Always creates a new permanent bullet line
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const insertText = '\n• ';
      const newVal = val.substring(0, start) + insertText + val.substring(end);
      textarea.value = newVal;
      const newPos = start + insertText.length;
      textarea.selectionStart = textarea.selectionEnd = newPos;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    // 2. Backspace: Protect the bullet point from deletion
    if (e.key === 'Backspace') {
      if (start === end) {
        const lastNewline = val.lastIndexOf('\n', start - 1);
        const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;
        const offsetInLine = start - lineStart;

        // If cursor is at or before the bullet prefix (offset <= 2)
        if (offsetInLine <= 2) {
          e.preventDefault();
          if (lineStart === 0) {
            // First line: Cannot delete bullet
            return;
          }
          // Line 2+: Remove current empty line or join with previous line
          const lineEnd = val.indexOf('\n', start);
          const nextStart = lineEnd === -1 ? val.length : lineEnd;
          const currentLineContent = val.substring(lineStart + 2, nextStart);
          const prevLineEnd = lineStart - 1; // position of '\n'

          const newVal = val.substring(0, prevLineEnd) + (currentLineContent ? (' ' + currentLineContent) : '') + val.substring(nextStart);
          textarea.value = newVal;
          textarea.selectionStart = textarea.selectionEnd = prevLineEnd;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }
      }
    }

    // 3. Home key: jump after the bullet glyph
    if (e.key === 'Home') {
      const lastNewline = val.lastIndexOf('\n', start - 1);
      const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;
      e.preventDefault();
      textarea.selectionStart = textarea.selectionEnd = lineStart + 2;
      return;
    }
  });

  textarea.addEventListener('focus', enforceBulletsOnAllLines);
  textarea.addEventListener('click', () => {
    if (!textarea.value.trim()) {
      enforceBulletsOnAllLines();
    } else {
      const start = textarea.selectionStart;
      const lastNewline = textarea.value.lastIndexOf('\n', start - 1);
      const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;
      if (start < lineStart + 2) {
        textarea.selectionStart = textarea.selectionEnd = lineStart + 2;
      }
    }
  });

  textarea.addEventListener('input', enforceBulletsOnAllLines);
}

function handleNotesInput(): void {
  if (notesOptions && !notesOptions.canEdit()) return;

  const projectNotesInput = $<HTMLTextAreaElement>('project-notes-input');
  const sessionNotesInput = $<HTMLTextAreaElement>('session-notes-input');
  const activeNotesEl = document.activeElement === sessionNotesInput ? sessionNotesInput : projectNotesInput;
  const content = activeNotesEl?.value ?? projectNotesInput?.value ?? sessionNotesInput?.value ?? '';

  const projectBpm = $<HTMLInputElement>('project-notes-bpm');
  const sessionBpm = $<HTMLInputElement>('session-notes-bpm');
  const activeBpmEl = document.activeElement === sessionBpm ? sessionBpm : projectBpm;
  const bpm = activeBpmEl?.value ?? projectBpm?.value ?? sessionBpm?.value ?? '';

  const pRoot = $<HTMLSelectElement>('project-notes-key-root');
  const pMode = $<HTMLSelectElement>('project-notes-key-mode');
  const sRoot = $<HTMLSelectElement>('session-notes-key-root');
  const sMode = $<HTMLSelectElement>('session-notes-key-mode');

  let activeRoot = '';
  let activeMode: 'Major' | 'Minor' = 'Major';

  if (document.activeElement === sRoot || document.activeElement === sMode) {
    activeRoot = sRoot?.value ?? '';
    activeMode = (sMode?.value as 'Major' | 'Minor') || 'Major';
  } else if (document.activeElement === pRoot || document.activeElement === pMode) {
    activeRoot = pRoot?.value ?? '';
    activeMode = (pMode?.value as 'Major' | 'Minor') || 'Major';
  } else {
    activeRoot = pRoot?.value ?? sRoot?.value ?? '';
    activeMode = ((pMode?.value ?? sMode?.value) as 'Major' | 'Minor') || 'Major';
  }

  const key = formatMusicalKey(activeRoot, activeMode);

  // Sync to other inputs
  if (projectNotesInput && document.activeElement !== projectNotesInput) {
    applyTextareaUpdatePreservingCursor(projectNotesInput, content);
  }
  if (sessionNotesInput && document.activeElement !== sessionNotesInput) {
    applyTextareaUpdatePreservingCursor(sessionNotesInput, content);
  }
  if (projectBpm && document.activeElement !== projectBpm) projectBpm.value = bpm;
  if (sessionBpm && document.activeElement !== sessionBpm) sessionBpm.value = bpm;
  applyKeyToControls(key, false);

  notesOptions?.onNotesChange({ content, bpm, key });
}

export function initNotesUi(options: NotesUiOptions): void {
  notesOptions = options;
  if (listenersBound) return;
  listenersBound = true;

  const projectNotesArea = $<HTMLTextAreaElement>('project-notes-input');
  const sessionNotesArea = $<HTMLTextAreaElement>('session-notes-input');
  setupBulletPointBehavior(projectNotesArea);
  setupBulletPointBehavior(sessionNotesArea);

  // Attach Input Listeners for Notes
  projectNotesArea?.addEventListener('input', () => handleNotesInput());
  sessionNotesArea?.addEventListener('input', () => handleNotesInput());
  $<HTMLInputElement>('project-notes-bpm')?.addEventListener('input', () => handleNotesInput());
  $<HTMLInputElement>('session-notes-bpm')?.addEventListener('input', () => handleNotesInput());
  $('project-notes-key-root')?.addEventListener('change', () => handleNotesInput());
  $('project-notes-key-mode')?.addEventListener('change', () => handleNotesInput());
  $('session-notes-key-root')?.addEventListener('change', () => handleNotesInput());
  $('session-notes-key-mode')?.addEventListener('change', () => handleNotesInput());
}
