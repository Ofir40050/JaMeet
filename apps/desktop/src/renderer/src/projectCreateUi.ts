import { $, setText } from './dom';

export interface ProjectCreateUiOptions {
  onCreateProject?: (values: { name: string; description: string }) => Promise<void> | void;
}

let createOptions: ProjectCreateUiOptions = {};
let isInitialized = false;

export function openNewProjectModal(): void {
  const nameInput = $<HTMLInputElement>('new-project-name');
  const descInput = $<HTMLInputElement>('new-project-desc');
  if (nameInput) nameInput.value = '';
  if (descInput) descInput.value = '';
  setNewProjectError('');
  $('new-project-modal')?.classList.remove('hidden');
  setTimeout(() => nameInput?.focus(), 50);
}

export function closeNewProjectModal(): void {
  $('new-project-modal')?.classList.add('hidden');
}

export function setNewProjectError(error: string): void {
  setText('new-project-error', error);
}

export function setNewProjectBusy(isBusy: boolean): void {
  const submitBtn = $<HTMLButtonElement>('btn-create-project');
  if (submitBtn) {
    submitBtn.disabled = isBusy;
    submitBtn.textContent = isBusy ? 'Creating…' : 'Create Project';
  }
}

export function getNewProjectFormValues(): { name: string; description: string } {
  const name = $<HTMLInputElement>('new-project-name')?.value.trim() || '';
  const desc = $<HTMLInputElement>('new-project-desc')?.value.trim() || '';
  return { name, description: desc };
}

export function initProjectCreateUi(options: ProjectCreateUiOptions = {}): void {
  createOptions = options;
  if (isInitialized) return;
  isInitialized = true;

  $('btn-new-project')?.addEventListener('click', () => {
    openNewProjectModal();
  });

  $('btn-create-first-project')?.addEventListener('click', () => {
    openNewProjectModal();
  });

  $('btn-close-new-project')?.addEventListener('click', () => {
    closeNewProjectModal();
  });

  $('btn-cancel-new-project')?.addEventListener('click', () => {
    closeNewProjectModal();
  });

  $<HTMLInputElement>('new-project-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $<HTMLButtonElement>('btn-create-project')?.click();
    }
  });

  $<HTMLInputElement>('new-project-desc')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $<HTMLButtonElement>('btn-create-project')?.click();
    }
  });

  $('btn-create-project')?.addEventListener('click', () => {
    const { name, description } = getNewProjectFormValues();
    if (!name) {
      setNewProjectError('Please enter a song or project name.');
      $<HTMLInputElement>('new-project-name')?.focus();
      return;
    }
    void createOptions.onCreateProject?.({ name, description });
  });
}
