import { $, setText } from './dom';

export interface ProjectSongDeleteUiOptions {
  getSongTitle?: () => string | undefined;
  onCancel?: () => void;
  onConfirmDelete?: () => Promise<void> | void;
}

let deleteOptions: ProjectSongDeleteUiOptions = {};
let isInitialized = false;

export function renderDeleteSongModal(songTitle?: string): void {
  const sTitle = songTitle || 'Untitled Song';
  const targetPhrase = `delete ${sTitle}`;
  setText('delete-song-name-confirm', sTitle);
  setText('delete-song-phrase-target', targetPhrase);

  const confirmInput = $<HTMLInputElement>('delete-song-confirm-input');
  if (confirmInput) {
    confirmInput.value = '';
    confirmInput.placeholder = `Type "${targetPhrase}"`;
    confirmInput.classList.remove('is-matched');
  }

  const confirmBtn = $<HTMLButtonElement>('btn-confirm-delete-song');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></svg>
      <span>Delete Track</span>
    `;
  }

  const errEl = $('delete-song-error');
  if (errEl) {
    errEl.textContent = '';
    errEl.style.display = 'none';
  }

  $('delete-song-modal')?.classList.remove('hidden');
  setTimeout(() => confirmInput?.focus(), 50);
}

export function closeDeleteSongModal(): void {
  $('delete-song-modal')?.classList.add('hidden');
}

export function initProjectSongDeleteUi(options: ProjectSongDeleteUiOptions = {}): void {
  deleteOptions = options;
  if (isInitialized) return;
  isInitialized = true;

  $('delete-song-confirm-input')?.addEventListener('input', (e) => {
    const rawTitle = deleteOptions.getSongTitle?.();
    if (rawTitle === undefined) return;
    const inputEl = e.target as HTMLInputElement;
    const val = inputEl.value.trim().toLowerCase();
    const sTitle = (rawTitle || 'Untitled Song').trim().toLowerCase();
    const targetA = `delete ${sTitle}`;
    const targetB = `delete - ${sTitle}`;
    const targetC = `delete "${sTitle}"`;
    const isMatch =
      val === targetA ||
      val === targetB ||
      val === targetC ||
      val === 'delete' ||
      val === sTitle;

    inputEl.classList.toggle('is-matched', isMatch);
    const confirmBtn = $<HTMLButtonElement>('btn-confirm-delete-song');
    if (confirmBtn) {
      confirmBtn.disabled = !isMatch;
    }
  });

  $('delete-song-confirm-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const confirmBtn = $<HTMLButtonElement>('btn-confirm-delete-song');
      if (confirmBtn && !confirmBtn.disabled) {
        confirmBtn.click();
      }
    }
  });

  const cancel = () => {
    closeDeleteSongModal();
    deleteOptions.onCancel?.();
  };

  $('btn-close-delete-song')?.addEventListener('click', cancel);
  $('btn-cancel-delete-song')?.addEventListener('click', cancel);

  $('btn-confirm-delete-song')?.addEventListener('click', () => {
    void deleteOptions.onConfirmDelete?.();
  });
}
