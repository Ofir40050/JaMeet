import { $, setText } from '../../core/dom';

export interface ProjectRenameUiOptions {
  onTriggerRename?: () => void;
  onSave?: (values: { name: string; description: string }) => Promise<void> | void;
}

let renameOptions: ProjectRenameUiOptions = {};
let isInitialized = false;

export function openRenameProjectModal(name: string, description: string = ''): void {
  const nameInput = $<HTMLInputElement>('rename-project-name');
  const descInput = $<HTMLTextAreaElement>('rename-project-desc');
  if (nameInput) nameInput.value = name;
  if (descInput) descInput.value = description;

  setRenameProjectError('');
  $('rename-project-modal')?.classList.remove('hidden');
  nameInput?.focus();
}

export function closeRenameProjectModal(): void {
  $('rename-project-modal')?.classList.add('hidden');
}

export function setRenameProjectError(error: string): void {
  setText('rename-project-error', error);
}

export function setRenameProjectBusy(isBusy: boolean): void {
  const saveBtn = $<HTMLButtonElement>('btn-save-rename-project');
  if (saveBtn) {
    saveBtn.disabled = isBusy;
    saveBtn.textContent = isBusy ? 'Saving…' : 'Save Changes';
  }
}

export function getRenameProjectFormValues(): { name: string; description: string } {
  const name = $<HTMLInputElement>('rename-project-name')?.value.trim() || '';
  const desc = $<HTMLTextAreaElement>('rename-project-desc')?.value.trim() || '';
  return { name, description: desc };
}

export function initProjectRenameUi(options: ProjectRenameUiOptions = {}): void {
  renameOptions = options;
  if (isInitialized) return;
  isInitialized = true;

  const trigger = () => {
    renameOptions.onTriggerRename?.();
  };

  $('btn-project-rename')?.addEventListener('click', trigger);
  $('project-title')?.addEventListener('dblclick', trigger);
  $('project-view-name-crumb')?.addEventListener('dblclick', trigger);

  $('btn-close-rename-project')?.addEventListener('click', () => {
    closeRenameProjectModal();
  });

  $('btn-cancel-rename-project')?.addEventListener('click', () => {
    closeRenameProjectModal();
  });

  $('btn-save-rename-project')?.addEventListener('click', () => {
    const values = getRenameProjectFormValues();
    void renameOptions.onSave?.(values);
  });
}
