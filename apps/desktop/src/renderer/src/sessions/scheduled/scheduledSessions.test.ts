import { describe, expect, it } from 'vitest';
import { createScheduledSessionSchema, updateScheduledSessionSchema } from '@jameet/shared';

describe('scheduled sessions validation & timezone handling', () => {
  it('validates a valid create scheduled session payload with ISO 8601 UTC string', () => {
    const parsed = createScheduledSessionSchema.safeParse({
      title: 'Studio Vocal Tracking',
      scheduledAt: '2026-08-20T16:30:00.000Z'
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.title).toBe('Studio Vocal Tracking');
      expect(parsed.data.scheduledAt).toBe('2026-08-20T16:30:00.000Z');
    }
  });

  it('rejects empty title or invalid datetime format', () => {
    const emptyTitle = createScheduledSessionSchema.safeParse({
      title: '',
      scheduledAt: '2026-08-20T16:30:00.000Z'
    });
    expect(emptyTitle.success).toBe(false);

    const invalidDate = createScheduledSessionSchema.safeParse({
      title: 'Valid Title',
      scheduledAt: 'not-a-date'
    });
    expect(invalidDate.success).toBe(false);
  });

  it('validates update scheduled session payload', () => {
    const parsed = updateScheduledSessionSchema.safeParse({
      title: 'Updated Mix Review'
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.title).toBe('Updated Mix Review');
    }
  });

  it('safely converts local datetime string to UTC ISO string', () => {
    const localInput = '2026-08-20T15:45';
    const dateObj = new Date(localInput);
    const utcIso = dateObj.toISOString();
    expect(utcIso).toContain('2026-08-20');
    expect(new Date(utcIso).getTime()).toBe(dateObj.getTime());
  });
});
