import { $ } from '../../core/dom';

export interface ProjectNavigationUiOptions {
  onRefreshProjects?: () => Promise<void> | void;
  onExitProject?: () => Promise<void> | void;
  onStartSession?: () => Promise<void> | void;
}

let isInitialized = false;

export function initProjectNavigationUi(options: ProjectNavigationUiOptions = {}): void {
  if (isInitialized) return;
  isInitialized = true;

  $('btn-refresh-projects')?.addEventListener('click', () => {
    void options.onRefreshProjects?.();
  });

  const handleExit = () => {
    void options.onExitProject?.();
  };

  $('btn-project-back')?.addEventListener('click', handleExit);
  $('project-view-home-crumb')?.addEventListener('click', handleExit);

  const handleStartSession = () => {
    void options.onStartSession?.();
  };

  $('btn-project-start-session')?.addEventListener('click', handleStartSession);
  $('btn-sessions-tab-start')?.addEventListener('click', handleStartSession);
}
