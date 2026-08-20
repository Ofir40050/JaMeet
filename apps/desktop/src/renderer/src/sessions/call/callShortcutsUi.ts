import { $ } from '../../core/dom';

let isInitialized = false;

export function isShortcutsModalOpen(): boolean {
  const modal = $('call-shortcuts-modal');
  return Boolean(modal && !modal.classList.contains('hidden'));
}

export function toggleShortcutsModal(show?: boolean): void {
  const modal = $('call-shortcuts-modal');
  if (!modal) return;
  const shouldOpen = show !== undefined ? show : modal.classList.contains('hidden');
  modal.classList.toggle('hidden', !shouldOpen);
}

export function closeShortcutsModal(): void {
  toggleShortcutsModal(false);
}

export function initCallShortcutsUi(): void {
  if (isInitialized) return;
  isInitialized = true;

  $('call-shortcuts-btn')?.addEventListener('click', () => {
    toggleShortcutsModal();
  });

  $('btn-close-shortcuts-modal')?.addEventListener('click', () => {
    toggleShortcutsModal(false);
  });

  $('call-shortcuts-modal')?.addEventListener('click', (e) => {
    if (e.target === $('call-shortcuts-modal')) {
      toggleShortcutsModal(false);
    }
  });
}
