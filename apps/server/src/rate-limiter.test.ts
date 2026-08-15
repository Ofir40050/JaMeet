import { describe, expect, it } from 'vitest';
import { SocketRateLimiter } from './rate-limiter.js';

describe('SocketRateLimiter', () => {
  it('allows consumption within category capacity and blocks when depleted', () => {
    const limiter = new SocketRateLimiter({
      chat: { capacity: 5, refillRate: 1 }
    });

    for (let i = 0; i < 5; i++) {
      expect(limiter.consume('chat')).toBe(true);
    }
    expect(limiter.consume('chat')).toBe(false);
  });

  it('maintains isolation across different categories', () => {
    const limiter = new SocketRateLimiter({
      chat: { capacity: 2, refillRate: 1 },
      ice: { capacity: 10, refillRate: 5 }
    });

    expect(limiter.consume('chat')).toBe(true);
    expect(limiter.consume('chat')).toBe(true);
    expect(limiter.consume('chat')).toBe(false);

    // ICE category remains fully available
    for (let i = 0; i < 10; i++) {
      expect(limiter.consume('ice')).toBe(true);
    }
    expect(limiter.consume('ice')).toBe(false);
  });

  it('refills tokens over time', async () => {
    const limiter = new SocketRateLimiter({
      chat: { capacity: 2, refillRate: 10 } // 10 tokens/sec = 1 token per 100ms
    });

    expect(limiter.consume('chat')).toBe(true);
    expect(limiter.consume('chat')).toBe(true);
    expect(limiter.consume('chat')).toBe(false);

    // Wait 120ms for at least 1 token to refill
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(limiter.consume('chat')).toBe(true);
    expect(limiter.consume('chat')).toBe(false);
  });

  it('caps token accumulation at capacity', async () => {
    const limiter = new SocketRateLimiter({
      action: { capacity: 3, refillRate: 50 }
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(limiter.consume('action')).toBe(true);
    expect(limiter.consume('action')).toBe(true);
    expect(limiter.consume('action')).toBe(true);
    expect(limiter.consume('action')).toBe(false);
  });

  it('supports resetting bucket state', () => {
    const limiter = new SocketRateLimiter({
      media: { capacity: 2, refillRate: 1 }
    });

    expect(limiter.consume('media')).toBe(true);
    expect(limiter.consume('media')).toBe(true);
    expect(limiter.consume('media')).toBe(false);

    limiter.reset('media');
    expect(limiter.consume('media')).toBe(true);
  });
});
