import { $ } from './dom';

export const views = [
  'home-view',
  'project-view',
  'all-sessions-view',
  'auth-view',
  'setup-view',
  'waiting-view',
  'call-view',
  'settings-view'
] as const;

export type ViewId = (typeof views)[number];

export interface ViewControllerOptions {
  onUpdateLocalPreviews: () => void;
  onUpdateAuthUi: () => void;
  onUpdateParticipantIdentityUi: () => void;
}

let viewOptions: ViewControllerOptions | null = null;

export function initViewController(options: ViewControllerOptions): void {
  viewOptions = options;
}

export function showView(id: string): void {
  for (const view of views) {
    $(view)?.classList.toggle('hidden', view !== id);
  }
  if (viewOptions) {
    viewOptions.onUpdateLocalPreviews();
    if (id === 'call-view') {
      viewOptions.onUpdateAuthUi();
      viewOptions.onUpdateParticipantIdentityUi();
    }
  }
}

export function setBusy(busy: boolean): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    '#create-button, #join-button, #enter-session'
  );
  for (const button of buttons) {
    button.disabled = busy;
  }
}
