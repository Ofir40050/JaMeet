import type { SessionHistoryItem, UserProfile } from '@jameet/shared';
import { initRecentSessions } from './recentSessions';

export interface RecentSessionsControllerOptions {
  getUser: () => UserProfile | null;
  getRecentSessions: () => Promise<SessionHistoryItem[]>;
  onPrepareStudio: (action: { type: 'create' }) => void;
  onNavigateToAllSessions: () => void;
  onNavigateToHome: () => void;
}

export function initRecentSessionsController(options: RecentSessionsControllerOptions): void {
  initRecentSessions({
    getUser: () => options.getUser(),
    getRecentSessions: () => options.getRecentSessions(),
    onStartSession: () => {
      options.onPrepareStudio({ type: 'create' });
    },
    onNavigateToAllSessions: () => {
      options.onNavigateToAllSessions();
    },
    onNavigateToHome: () => {
      options.onNavigateToHome();
    }
  });
}
