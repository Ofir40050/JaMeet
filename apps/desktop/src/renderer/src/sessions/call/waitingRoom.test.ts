import { describe, expect, it } from 'vitest';
import { createMeetingSchema, admitParticipantSchema, waitingParticipantItemSchema } from '@jameet/shared';

describe('waiting room schema validation', () => {
  it('validates create meeting with waitingRoomEnabled flag', () => {
    const parsed = createMeetingSchema.safeParse({
      participantId: '11111111-1111-4111-8111-111111111111',
      media: {
        audioSources: [{ id: 'primary', purpose: 'primary', mode: 'music', enabled: true, channels: 2 }],
        cameraEnabled: true
      },
      waitingRoomEnabled: true
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.waitingRoomEnabled).toBe(true);
    }
  });

  it('validates host admit participant payload', () => {
    const parsed = admitParticipantSchema.safeParse({
      code: 'ABC23456',
      participantId: '22222222-2222-4222-8222-222222222222'
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects invalid participantId in admit payload', () => {
    const parsed = admitParticipantSchema.safeParse({
      code: 'ABC23456',
      participantId: 'invalid-id'
    });
    expect(parsed.success).toBe(false);
  });

  it('validates waiting participant item schema', () => {
    const item = {
      participantId: '22222222-2222-4222-8222-222222222222',
      identity: {
        id: '22222222-2222-4222-8222-222222222222',
        displayName: 'Guest Vocalist',
        isGuest: true,
        isHost: false,
        avatarColor: '#06b6d4'
      },
      joinedAt: 1700000000000
    };
    const parsed = waitingParticipantItemSchema.safeParse(item);
    expect(parsed.success).toBe(true);
  });
});
