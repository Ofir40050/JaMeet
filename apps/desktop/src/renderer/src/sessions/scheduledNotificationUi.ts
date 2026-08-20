import { $ } from '../core/dom';

export interface ScheduledNotificationUiOptions {
  onNavigateHome: () => void;
}

export function handleScheduledSessionNotificationClick(
  sessionId: string,
  options: ScheduledNotificationUiOptions
): void {
  const callView = $('call-view');
  if (callView?.classList.contains('active')) return;

  options.onNavigateHome();

  const sessionItem = document.querySelector<HTMLElement>(
    `.scheduled-session-item[data-session-id="${sessionId}"]`
  );
  if (sessionItem) {
    sessionItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    sessionItem.classList.add('is-highlighted');
    setTimeout(() => {
      sessionItem.classList.remove('is-highlighted');
    }, 2500);
  } else {
    const section = $('scheduled-sessions-section');
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
