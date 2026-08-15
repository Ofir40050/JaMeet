import { describe, expect, it } from 'vitest';
import { lockMeetingSchema } from '@musiczoom/shared';

describe('lock session schema validation', () => {
  it('validates a valid lock session payload', () => {
    const parsed = lockMeetingSchema.safeParse({
      code: 'ABC23456',
      locked: true
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.locked).toBe(true);
      expect(parsed.data.code).toBe('ABC23456');
    }
  });

  it('validates an unlock session payload', () => {
    const parsed = lockMeetingSchema.safeParse({
      code: 'ABC23456',
      locked: false
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.locked).toBe(false);
    }
  });

  it('rejects an invalid session code format', () => {
    const parsed = lockMeetingSchema.safeParse({
      code: 'short',
      locked: true
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects missing or non-boolean locked property', () => {
    const parsed = lockMeetingSchema.safeParse({
      code: 'ABC23456',
      locked: 'yes'
    });
    expect(parsed.success).toBe(false);
  });
});
