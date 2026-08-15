export type RateLimitCategory = 'session' | 'workspace' | 'signaling' | 'ice' | 'action' | 'media' | 'chat';

export interface RateLimitConfig {
  capacity: number;
  refillRate: number; // tokens per second
}

export const DEFAULT_SOCKET_RATE_LIMITS: Record<RateLimitCategory, RateLimitConfig> = {
  // Session lifecycle (create, join, admit, lock, remove participant, join project)
  session: { capacity: 20, refillRate: 2 },
  // Real-time collaborative workspace mutations (lyrics, notes, tasks, sections)
  workspace: { capacity: 60, refillRate: 10 },
  // SDP offer/answer exchanges and renegotiation requests
  signaling: { capacity: 30, refillRate: 3 },
  // WebRTC ICE trickling can generate 20-60+ candidates in initial bursts or renegotiations
  ice: { capacity: 150, refillRate: 30 },
  // Generic session actions / reactions
  action: { capacity: 30, refillRate: 5 },
  // Mute/unmute, camera toggle, screen share, quality changes
  media: { capacity: 30, refillRate: 5 },
  // In-session chat messages
  chat: { capacity: 20, refillRate: 2 }
};

export class SocketRateLimiter {
  private limits: Record<RateLimitCategory, RateLimitConfig>;
  private buckets = new Map<RateLimitCategory, { tokens: number; lastRefill: number }>();

  constructor(customLimits?: Partial<Record<RateLimitCategory, RateLimitConfig>>) {
    this.limits = {
      ...DEFAULT_SOCKET_RATE_LIMITS,
      ...customLimits
    };
  }

  consume(category: RateLimitCategory): boolean {
    const config = this.limits[category] ?? DEFAULT_SOCKET_RATE_LIMITS[category];
    const now = Date.now();

    let bucket = this.buckets.get(category);
    if (!bucket) {
      bucket = { tokens: config.capacity, lastRefill: now };
      this.buckets.set(category, bucket);
    } else {
      const elapsedSeconds = (now - bucket.lastRefill) / 1000;
      if (elapsedSeconds > 0) {
        bucket.tokens = Math.min(config.capacity, bucket.tokens + elapsedSeconds * config.refillRate);
        bucket.lastRefill = now;
      }
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  reset(category?: RateLimitCategory): void {
    if (category) {
      this.buckets.delete(category);
    } else {
      this.buckets.clear();
    }
  }
}
