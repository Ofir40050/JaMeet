import { describe, expect, it } from 'vitest';
import { sessionChatMessageSchema, sendChatMessageSchema } from '@jameet/shared';
import { formatChatTime, isSessionChatOpen, getUnreadChatCount, resetChatUi } from './chat';

describe('chat schema validation', () => {
  it('validates a valid chat message payload', () => {
    const parsed = sendChatMessageSchema.safeParse({
      code: 'ABC23456',
      text: 'Testing session chat'
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects empty or whitespace-only chat text', () => {
    const parsed = sendChatMessageSchema.safeParse({
      code: 'ABC23456',
      text: '   '
    });
    expect(parsed.success).toBe(false);
  });

  it('validates session chat message schema', () => {
    const msg = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      senderId: '11111111-1111-4111-8111-111111111111',
      senderName: 'Producer Alice',
      text: 'Check the chorus transition',
      timestamp: 1700000000000
    };
    const parsed = sessionChatMessageSchema.safeParse(msg);
    expect(parsed.success).toBe(true);
  });
});

describe('session chat helpers', () => {
  it('formats timestamp to human-readable 12-hour time', () => {
    const date = new Date(2026, 7, 15, 14, 30); // 2:30 PM
    const formatted = formatChatTime(date.getTime());
    expect(formatted).toBe('2:30 PM');

    const morningDate = new Date(2026, 7, 15, 9, 5); // 9:05 AM
    const morningFormatted = formatChatTime(morningDate.getTime());
    expect(morningFormatted).toBe('9:05 AM');
  });

  it('resets chat state properly', () => {
    resetChatUi();
    expect(isSessionChatOpen()).toBe(false);
    expect(getUnreadChatCount()).toBe(0);
  });
});
