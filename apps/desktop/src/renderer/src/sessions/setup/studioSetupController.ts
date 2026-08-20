import { $ } from '../../core/dom';

export interface StudioSetupControllerOptions {
  onCancelCleanup: () => Promise<void> | void;
  getActiveProjectId: () => string | undefined;
  getSessionProjectId: () => string | undefined;
  isAuthenticated: () => boolean;
  onOpenProjectView: (projectId: string) => Promise<void> | void;
  onShowHomeView: () => void;
  onEnumerateAndPopulate: () => Promise<void>;
  onOpenSettings: (section: 'audio') => void;
  onShowSessionError: (error: unknown) => void;
  onEnterSession: () => Promise<void> | void;
}

export function initStudioSetupController(options: StudioSetupControllerOptions): void {
  $('setup-cancel')?.addEventListener('click', async () => {
    await options.onCancelCleanup();
    const returnProjectId = options.getActiveProjectId() || options.getSessionProjectId();
    if (returnProjectId && options.isAuthenticated()) {
      void options.onOpenProjectView(returnProjectId);
    } else {
      options.onShowHomeView();
    }
  });

  for (const id of ['setup-advanced-button', 'setup-advanced-action-button']) {
    $(id)?.addEventListener('click', async () => {
      try {
        await options.onEnumerateAndPopulate();
        options.onOpenSettings('audio');
      } catch (error) {
        options.onShowSessionError(error);
      }
    });
  }

  $('enter-session')?.addEventListener('click', () => void options.onEnterSession());
}
