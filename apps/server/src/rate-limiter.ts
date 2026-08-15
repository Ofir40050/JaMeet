export type RateLimitCategory = 'session' | 'workspace' | 'signaling' | 'ice' | 'action' | 'media' | 'chat';

export interface RateLimitConfig {
  capacity: number;
  refillRate: number; // tokens per second
}

export const DEFAULT_SOCKET_RATE_LIMITS: Record<RateLimitCategory, RateLimitConfig> = {
  session: { capacity: 60, refillRate: 10 },
  workspace: { capacity: 120, refillRate: 20 },
  signaling: { capacity: 100, refillRate: 20 },
  ice: { capacity: 500, refillRate: 50 },
  action: { capacity: 60, refillRate: 10 },
  media: { capacity: 60, refillRate: 10 },
  chat: { capacity: 60, refillRate: 10 }
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
