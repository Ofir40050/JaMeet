import type { ScheduledSession } from '@jameet/shared';

const PRIMARY_STORAGE_KEY = 'jameet:notified-scheduled-reminders';
const LEGACY_STORAGE_KEY = 'musiczoom:notified-scheduled-reminders';
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

export type ReminderType = '5_min' | 'start_now';

export interface ReminderDecision {
  session: ScheduledSession;
  type: ReminderType;
  key: string;
  title: string;
  body: string;
}

export function computeDueReminders(
  sessions: ScheduledSession[],
  notifiedKeys: Set<string>,
  nowMs: number = Date.now()
): ReminderDecision[] {
  const decisions: ReminderDecision[] = [];

  for (const session of sessions) {
    const scheduledMs = new Date(session.scheduledAt).getTime();
    if (isNaN(scheduledMs)) continue;

    const timeUntilStart = scheduledMs - nowMs;

    // 1. "Starts in 5 minutes" reminder
    // Due when start time is within 5 minutes (and more than 1 minute away)
    if (timeUntilStart <= FIVE_MINUTES_MS && timeUntilStart > ONE_MINUTE_MS) {
      const key = `${session.id}:${session.scheduledAt}:5_min`;
      if (!notifiedKeys.has(key)) {
        decisions.push({
          session,
          type: '5_min',
          key,
          title: 'JaMeet Scheduled Session',
          body: `"${session.title}" starts in 5 minutes.`
        });
      }
    }

    // 2. "Starting now" reminder
    // Due when start time is reached (within 1 minute before to 5 minutes after start)
    if (timeUntilStart <= ONE_MINUTE_MS && timeUntilStart >= -FIVE_MINUTES_MS) {
      const key = `${session.id}:${session.scheduledAt}:start_now`;
      if (!notifiedKeys.has(key)) {
        decisions.push({
          session,
          type: 'start_now',
          key,
          title: 'JaMeet Scheduled Session',
          body: `"${session.title}" is starting now.`
        });
      }
    }
  }

  return decisions;
}

export class ScheduledNotificationManager {
  private sessions: ScheduledSession[] = [];
  private notifiedKeys = new Set<string>();
  private checkIntervalTimer: ReturnType<typeof setInterval> | null = null;
  private clickCallbacks: Array<(sessionId: string) => void> = [];
  private cleanupClickListener: (() => void) | null = null;

  constructor() {
    this.loadNotifiedKeys();
    this.setupIpcClickListener();
  }

  private loadNotifiedKeys(): void {
    if (typeof localStorage === 'undefined') {
      this.notifiedKeys = new Set();
      return;
    }
    try {
      const stored = localStorage.getItem(PRIMARY_STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.notifiedKeys = new Set(parsed);
        }
      }
    } catch {
      this.notifiedKeys = new Set();
    }
  }

  private saveNotifiedKeys(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      // Keep most recent 500 keys to avoid unlimited growth
      const keysArray = Array.from(this.notifiedKeys).slice(-500);
      const json = JSON.stringify(keysArray);
      localStorage.setItem(PRIMARY_STORAGE_KEY, json);
    } catch {
      // Ignore storage write errors
    }
  }

  private setupIpcClickListener(): void {
    if (typeof window === 'undefined') return;
    const bridge = window.jameet || window.musiczoom;
    if (bridge?.onScheduledNotificationClicked) {
      this.cleanupClickListener = bridge.onScheduledNotificationClicked((sessionId: string) => {
        this.emitClick(sessionId);
      });
    }
  }

  onSessionClick(callback: (sessionId: string) => void): void {
    this.clickCallbacks.push(callback);
  }

  private emitClick(sessionId: string): void {
    for (const cb of this.clickCallbacks) {
      try {
        cb(sessionId);
      } catch (err) {
        console.error('Error in scheduled notification click handler:', err);
      }
    }
  }

  syncSessions(sessions: ScheduledSession[]): void {
    this.sessions = sessions;
    this.checkReminders();
  }

  start(): void {
    if (this.checkIntervalTimer) return;
    this.checkIntervalTimer = setInterval(() => {
      this.checkReminders();
    }, 15000);
  }

  stop(): void {
    if (this.checkIntervalTimer) {
      clearInterval(this.checkIntervalTimer);
      this.checkIntervalTimer = null;
    }
  }

  dispose(): void {
    this.stop();
    if (this.cleanupClickListener) {
      this.cleanupClickListener();
      this.cleanupClickListener = null;
    }
    this.clickCallbacks = [];
  }

  checkReminders(): void {
    if (!this.sessions.length) return;

    const due = computeDueReminders(this.sessions, this.notifiedKeys);
    for (const item of due) {
      this.notifiedKeys.add(item.key);
      this.dispatchNativeNotification(item);
    }

    if (due.length > 0) {
      this.saveNotifiedKeys();
    }
  }

  private dispatchNativeNotification(item: ReminderDecision): void {
    const bridge = typeof window !== 'undefined' ? (window.jameet || window.musiczoom) : undefined;
    if (bridge?.showScheduledNotification) {
      void bridge.showScheduledNotification({
        title: item.title,
        body: item.body,
        sessionId: item.session.id
      });
    } else if (typeof Notification !== 'undefined') {
      // Fallback for HTML5 Notification if bridge not available
      if (Notification.permission === 'granted') {
        const notif = new Notification(item.title, { body: item.body });
        notif.onclick = () => {
          window.focus();
          this.emitClick(item.session.id);
        };
      } else if (Notification.permission !== 'denied') {
        void Notification.requestPermission().then((perm) => {
          if (perm === 'granted') {
            const notif = new Notification(item.title, { body: item.body });
            notif.onclick = () => {
              window.focus();
              this.emitClick(item.session.id);
            };
          }
        });
      }
    }
  }
}
