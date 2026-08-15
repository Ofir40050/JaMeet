import { describe, expect, it } from 'vitest';
import { removeParticipantSchema } from '@jameet/shared';

describe('remove participant schema validation', () => {
  it('validates a valid remove participant payload with canonical participantId', () => {
    const parsed = removeParticipantSchema.safeParse({
      code: 'ABC23456',
      participantId: '22222222-2222-4222-8222-222222222222'
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.code).toBe('ABC23456');
      expect(parsed.data.participantId).toBe('22222222-2222-4222-8222-222222222222');
    }
  });

  it('rejects an invalid session code format', () => {
    const parsed = removeParticipantSchema.safeParse({
      code: 'short',
      participantId: '22222222-2222-4222-8222-222222222222'
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an invalid participantId format', () => {
    const parsed = removeParticipantSchema.safeParse({
      code: 'ABC23456',
      participantId: 'invalid-id-format'
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects missing fields', () => {
    const parsed = removeParticipantSchema.safeParse({
      code: 'ABC23456'
    });
    expect(parsed.success).toBe(false);
  });
});
