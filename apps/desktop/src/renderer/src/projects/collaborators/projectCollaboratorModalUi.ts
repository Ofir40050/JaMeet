import type { ProjectRole } from '@jameet/shared';
import { $, setText } from '../../core/dom';

export interface ProjectCollaboratorModalUiOptions {
  onAddCollaborator?: (values: { usernameOrEmail: string; role: ProjectRole }) => Promise<void> | void;
}

let modalOptions: ProjectCollaboratorModalUiOptions = {};
let isInitialized = false;

export function openAddCollaboratorModal(): void {
  const input = $<HTMLInputElement>('add-collab-username');
  if (input) input.value = '';
  const roleSelect = $<HTMLSelectElement>('add-collab-role');
  if (roleSelect) roleSelect.value = 'editor';
  setAddCollaboratorError('');
  $('add-collab-modal')?.classList.remove('hidden');
  input?.focus();
}

export function closeAddCollaboratorModal(): void {
  $('add-collab-modal')?.classList.add('hidden');
}

export function setAddCollaboratorError(error: string): void {
  setText('add-collab-error', error);
}

export function getAddCollaboratorFormValues(): { usernameOrEmail: string; role: ProjectRole } {
  const usernameOrEmail = $<HTMLInputElement>('add-collab-username')?.value.trim() || '';
  const role = ($<HTMLSelectElement>('add-collab-role')?.value as ProjectRole) || 'editor';
  return { usernameOrEmail, role };
}

export function initProjectCollaboratorModalUi(options: ProjectCollaboratorModalUiOptions = {}): void {
  modalOptions = options;
  if (isInitialized) return;
  isInitialized = true;

  $('btn-project-add-collab')?.addEventListener('click', () => {
    openAddCollaboratorModal();
  });

  $('btn-project-add-collab-tab')?.addEventListener('click', () => {
    openAddCollaboratorModal();
  });

  $('btn-close-add-collab')?.addEventListener('click', () => {
    closeAddCollaboratorModal();
  });

  $('btn-cancel-add-collab')?.addEventListener('click', () => {
    closeAddCollaboratorModal();
  });

  $('btn-confirm-add-collab')?.addEventListener('click', () => {
    const { usernameOrEmail, role } = getAddCollaboratorFormValues();
    if (!usernameOrEmail) {
      setAddCollaboratorError('Please enter a username or email.');
      return;
    }
    void modalOptions.onAddCollaborator?.({ usernameOrEmail, role });
  });
}
