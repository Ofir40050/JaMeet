import { $, setText } from './dom';

export interface ProjectDeleteUiOptions {
  onTriggerDelete?: () => void;
  getProjectName?: () => string | undefined;
  onConfirmDelete?: () => Promise<void> | void;
}

let deleteOptions: ProjectDeleteUiOptions = {};
let isInitialized = false;

export function openDeleteProjectModal(projectName: string): void {
  const targetPhrase = `delete ${projectName}`;
  setText('delete-project-name-confirm', projectName);
  setText('delete-phrase-target', targetPhrase);

  const confirmInput = $<HTMLInputElement>('delete-project-confirm-input');
  if (confirmInput) {
    confirmInput.value = '';
    confirmInput.placeholder = `Type "${targetPhrase}"`;
    confirmInput.classList.remove('is-matched');
  }

  const confirmBtn = $<HTMLButtonElement>('btn-confirm-delete-project');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Delete Project';
  }

  setDeleteProjectError('');

  $('delete-project-modal')?.classList.remove('hidden');
  setTimeout(() => confirmInput?.focus(), 50);
}

export function closeDeleteProjectModal(): void {
  $('delete-project-modal')?.classList.add('hidden');
}

export function setDeleteProjectError(error: string): void {
  const errEl = $('delete-project-error');
  if (errEl) {
    if (error) {
      errEl.textContent = error;
      errEl.style.display = 'block';
    } else {
      errEl.textContent = '';
      errEl.style.display = 'none';
    }
  }
}

export function setDeleteProjectBusy(isBusy: boolean): void {
  const confirmBtn = $<HTMLButtonElement>('btn-confirm-delete-project');
  if (confirmBtn) {
    confirmBtn.disabled = isBusy;
    confirmBtn.textContent = isBusy ? 'Deleting…' : 'Delete Project';
  }
}

export function initProjectDeleteUi(options: ProjectDeleteUiOptions = {}): void {
  deleteOptions = options;
  if (isInitialized) return;
  isInitialized = true;

  $('btn-project-delete')?.addEventListener('click', () => {
    deleteOptions.onTriggerDelete?.();
  });

  $('delete-project-confirm-input')?.addEventListener('input', (e) => {
    const inputEl = e.target as HTMLInputElement;
    const val = inputEl.value.trim().toLowerCase();
    const projName = (deleteOptions.getProjectName?.() || '').trim().toLowerCase();
    const targetA = `delete ${projName}`;
    const targetB = `delete - ${projName}`;
    const targetC = `delete "${projName}"`;

    const isMatch = Boolean(projName) && (val === targetA || val === targetB || val === targetC);
    inputEl.classList.toggle('is-matched', isMatch);
    const confirmBtn = $<HTMLButtonElement>('btn-confirm-delete-project');
    if (confirmBtn) {
      confirmBtn.disabled = !isMatch;
    }
  });

  $('delete-project-confirm-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const confirmBtn = $<HTMLButtonElement>('btn-confirm-delete-project');
      if (confirmBtn && !confirmBtn.disabled) {
        confirmBtn.click();
      }
    }
  });

  $('btn-close-delete-project')?.addEventListener('click', () => {
    closeDeleteProjectModal();
  });

  $('btn-cancel-delete-project')?.addEventListener('click', () => {
    closeDeleteProjectModal();
  });

  $('btn-confirm-delete-project')?.addEventListener('click', () => {
    void deleteOptions.onConfirmDelete?.();
  });
}
