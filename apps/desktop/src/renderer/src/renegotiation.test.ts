import { describe, expect, it } from 'vitest';
import { signalRenegotiateSchema } from '@jameet/shared';

describe('WebRTC renegotiation schema validation', () => {
  it('validates valid session code for renegotiation request', () => {
    const parsed = signalRenegotiateSchema.safeParse({
      code: 'ABC23456'
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.code).toBe('ABC23456');
    }
  });

  it('rejects invalid meeting code in renegotiation request', () => {
    const invalidCodes = ['', '123', 'invalid-long-code', 'ABC1234!', 'abc'];
    for (const code of invalidCodes) {
      const parsed = signalRenegotiateSchema.safeParse({ code });
      expect(parsed.success).toBe(false);
    }
  });
});
