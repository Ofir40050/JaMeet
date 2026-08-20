import { $ } from '../../core/dom';

export interface CallNavigationOptions {
  onLeaveSession: (message: string) => Promise<void> | void;
  onShowHomeView: () => void;
}

export function initCallNavigation(options: CallNavigationOptions): void {
  for (const id of ['leave-call', 'leave-button']) {
    $(id)?.addEventListener('click', () => void options.onLeaveSession('You left the session.'));
  }
  $('home-button')?.addEventListener('click', () => options.onShowHomeView());
}
