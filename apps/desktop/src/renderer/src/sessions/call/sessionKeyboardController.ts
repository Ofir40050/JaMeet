import { $ } from '../../core/dom';

export interface SessionKeyboardControllerOptions {
  isInCall: () => boolean;
  isShortcutsModalOpen: () => boolean;
  closeShortcutsModal: () => void;
  toggleShortcutsModal: () => void;
  isMuted: () => boolean;
  toggleMute: () => void;
  toggleCamera: () => Promise<void> | void;
  getAudioMode: () => 'talk' | 'music';
  switchAudioMode: (mode: 'talk' | 'music') => Promise<void> | void;
  hasActiveProject: () => boolean;
  isSessionWorkspaceOpen: () => boolean;
  setSessionWorkspaceOpen: (open: boolean) => void;
  toggleStudioMixer: () => void;
}

export function isTypingContext(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') return true;
  if (target.closest('.ql-editor') || target.closest('[contenteditable="true"]')) return true;
  return false;
}

let pttActive = false;
let pttPreviousMutedState = false;

export function getPttActive(): boolean {
  return pttActive;
}

export function initSessionKeyboard(options: SessionKeyboardControllerOptions): void {
  window.addEventListener('keydown', (e) => {
    // Always handle Escape
    if (e.key === 'Escape') {
      if (options.isShortcutsModalOpen()) {
        options.closeShortcutsModal();
        return;
      }
      document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close());
      document.querySelectorAll<HTMLElement>('.modal-overlay:not(.hidden)').forEach((m) => m.classList.add('hidden'));
      return;
    }

    // If user is actively typing in a text field, do not trigger single-letter shortcuts
    if (isTypingContext(e.target)) return;

    // Shortcuts Cheatsheet: '?' or '/'
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      options.toggleShortcutsModal();
      return;
    }

    // In-Call Shortcuts
    if (options.isInCall()) {
      // Push-to-Talk (Space bar)
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        if (!pttActive) {
          pttActive = true;
          pttPreviousMutedState = options.isMuted();
          if (options.isMuted()) {
            options.toggleMute();
          }
          $('push-to-talk-hud')?.classList.remove('hidden');
        }
        return;
      }

      // Mute / Unmute Microphone: M or Cmd+D
      if (e.key === 'm' || e.key === 'M' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd')) {
        e.preventDefault();
        options.toggleMute();
        return;
      }

      // Toggle Camera: V or Cmd+E
      if (e.key === 'v' || e.key === 'V' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e')) {
        e.preventDefault();
        void Promise.resolve(options.toggleCamera()).catch(() => {});
        return;
      }

      // Toggle Screen Share: S
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        $('toggle-screen')?.click();
        return;
      }

      // Toggle Talk / Music Mode: T
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        const nextMode = options.getAudioMode() === 'talk' ? 'music' : 'talk';
        void options.switchAudioMode(nextMode);
        return;
      }

      // Toggle Workspace Drawer: W
      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        if (options.hasActiveProject()) {
          options.setSessionWorkspaceOpen(!options.isSessionWorkspaceOpen());
        }
        return;
      }

      // Toggle Session Chat: C
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        $('toggle-session-chat')?.click();
        return;
      }

      // Toggle Studio Mixer: X
      if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        options.toggleStudioMixer();
        return;
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && pttActive) {
      pttActive = false;
      $('push-to-talk-hud')?.classList.add('hidden');
      // If it was muted before holding space, return to muted
      if (pttPreviousMutedState && !options.isMuted()) {
        options.toggleMute();
      }
    }
  });
}
