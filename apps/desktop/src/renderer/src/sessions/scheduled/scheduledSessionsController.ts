import type { ScheduledNotificationManager } from './scheduledNotifications';
import { initScheduledSessions } from './scheduledSessions';

export interface ScheduledSessionsControllerOptions {
  getAuthToken: () => string | null;
  notificationManager?: ScheduledNotificationManager;
  onPrepareStudio: (action: { type: 'create' }) => void;
}

export function initScheduledSessionsController(options: ScheduledSessionsControllerOptions): void {
  initScheduledSessions({
    getToken: () => options.getAuthToken(),
    notificationManager: options.notificationManager,
    onStartSession: () => {
      options.onPrepareStudio({ type: 'create' });
    }
  });
}
