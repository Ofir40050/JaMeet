import { describe, expect, it } from 'vitest';
import { computeDueReminders } from './scheduledNotifications';
import type { ScheduledSession } from '@jameet/shared';

describe('Scheduled Session Notifications', () => {
  const baseSession: ScheduledSession = {
    id: 'session-123',
    userId: 'user-1',
    title: 'Guitar Tracking Live',
    scheduledAt: new Date(Date.now() + 4 * 60 * 1000).toISOString(), // 4 mins from now
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  it('computes "Starts in 5 minutes" reminder when session is within 5 minutes', () => {
    const now = Date.now();
    const session: ScheduledSession = {
      ...baseSession,
      scheduledAt: new Date(now + 4 * 60 * 1000).toISOString()
    };

    const notifiedKeys = new Set<string>();
    const reminders = computeDueReminders([session], notifiedKeys, now);

    expect(reminders.length).toBe(1);
    expect(reminders[0]?.type).toBe('5_min');
    expect(reminders[0]?.body).toContain('starts in 5 minutes');
    expect(reminders[0]?.key).toBe(`${session.id}:${session.scheduledAt}:5_min`);
  });

  it('computes "Starting now" reminder when session reaches start time', () => {
    const now = Date.now();
    const session: ScheduledSession = {
      ...baseSession,
      scheduledAt: new Date(now + 30 * 1000).toISOString() // 30s from now
    };

    const notifiedKeys = new Set<string>();
    const reminders = computeDueReminders([session], notifiedKeys, now);

    expect(reminders.length).toBe(1);
    expect(reminders[0]?.type).toBe('start_now');
    expect(reminders[0]?.body).toContain('is starting now');
    expect(reminders[0]?.key).toBe(`${session.id}:${session.scheduledAt}:start_now`);
  });

  it('avoids duplicate reminders for already notified keys', () => {
    const now = Date.now();
    const session: ScheduledSession = {
      ...baseSession,
      scheduledAt: new Date(now + 4 * 60 * 1000).toISOString()
    };

    const notifiedKeys = new Set<string>([`${session.id}:${session.scheduledAt}:5_min`]);
    const reminders = computeDueReminders([session], notifiedKeys, now);

    expect(reminders.length).toBe(0);
  });

  it('does not compute reminders for sessions far in the future or distant past', () => {
    const now = Date.now();
    const futureSession: ScheduledSession = {
      ...baseSession,
      id: 'session-future',
      scheduledAt: new Date(now + 60 * 60 * 1000).toISOString() // 1 hour in future
    };
    const pastSession: ScheduledSession = {
      ...baseSession,
      id: 'session-past',
      scheduledAt: new Date(now - 60 * 60 * 1000).toISOString() // 1 hour in past
    };

    const notifiedKeys = new Set<string>();
    const reminders = computeDueReminders([futureSession, pastSession], notifiedKeys, now);

    expect(reminders.length).toBe(0);
  });
});
