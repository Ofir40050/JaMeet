import { $ } from './dom';

let isInitialized = false;

export function initDialogUi(): void {
  if (isInitialized) return;
  isInitialized = true;

  // Dialog close button and backdrop click listeners for native <dialog> elements
  document.querySelectorAll<HTMLDialogElement>('dialog').forEach((dialog) => {
    dialog.querySelectorAll('.dialog-close, [value="cancel"], [value="done"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        dialog.close();
      });
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  // Close project and song modals on backdrop/overlay click
  for (const modalId of ['new-project-modal', 'rename-project-modal', 'add-collab-modal', 'delete-project-modal', 'delete-song-modal']) {
    const modal = $(modalId);
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  }
}
