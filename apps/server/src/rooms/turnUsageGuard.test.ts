import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig } from '../core/config.js';
import { logger } from '../core/logger.js';
import {
  TurnUsageGuard,
  getUtcMonthKey,
  getUtcMonthStartIso
} from './turnUsageGuard.js';
import { generateCloudflareIceServers, getIceServers, SAFE_DEFAULT_STUN_SERVERS } from './turn.js';

describe('TurnUsageGuard - Monthly Cloudflare TURN Usage Protection', () => {
  let guard: TurnUsageGuard;

  beforeEach(() => {
    guard = new TurnUsageGuard();
    vi.restoreAllMocks();
  });

  const baseConfig = loadConfig({
    TURN_PROVIDER: 'cloudflare',
    CLOUDFLARE_TURN_KEY_ID: 'key-123',
    CLOUDFLARE_TURN_API_TOKEN: 'token-turn-abc',
    CLOUDFLARE_ACCOUNT_ID: 'acc-456',
    CLOUDFLARE_TURN_ANALYTICS_API_TOKEN: 'token-analytics-xyz',
    TURN_MONTHLY_SOFT_LIMIT_GB: '700',
    TURN_USAGE_CHECK_INTERVAL_SECONDS: '300'
  });

  function createMockGraphQLFetch(egressBytes: number, ok = true, errors?: any[]) {
    return vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      statusText: ok ? 'OK' : 'Internal Server Error',
      json: async () => ({
        data: {
          viewer: {
            accounts: [
              {
                turnUsageAdaptiveGroups: [
                  {
                    sum: {
                      egressBytes
                    }
                  }
                ]
              }
            ]
          }
        },
        errors
      })
    });
  }

  it('computes correct UTC month keys and month start ISO timestamps', () => {
    const fixedDate = new Date('2026-08-21T17:00:00Z');
    expect(getUtcMonthKey(fixedDate)).toBe('2026-08');
    expect(getUtcMonthStartIso(fixedDate)).toBe('2026-08-01T00:00:00Z');
  });

  it('allows TURN generation when monthly egress is below 700 GB', async () => {
    const mockFetch = createMockGraphQLFetch(450 * 1_000_000_000); // 450 GB
    const result = await guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch);

    expect(result.allowed).toBe(true);
    expect(result.usageBytes).toBe(450 * 1_000_000_000);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-analytics-xyz',
          'Content-Type': 'application/json'
        })
      })
    );
  });

  it('withholds TURN credentials and returns soft_limit_reached when usage is at or above 700 GB', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const mockFetch = createMockGraphQLFetch(700 * 1_000_000_000); // 700 GB
    const result = await guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('soft_limit_reached');
    expect(warnSpy).toHaveBeenCalledWith(
      'cloudflare_turn_soft_limit_reached',
      expect.stringContaining('soft limit'),
      expect.objectContaining({
        usageGB: 700,
        limitGB: 700
      })
    );
  });

  it('records milestone warnings once at 500 GB and 600 GB', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');

    // First check: 520 GB
    const fetch520 = createMockGraphQLFetch(520 * 1_000_000_000);
    const res1 = await guard.checkTurnAllowed(baseConfig, fetch520 as unknown as typeof fetch);
    expect(res1.allowed).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      'cloudflare_turn_usage_warning_500gb',
      expect.stringContaining('500 GB milestone'),
      expect.objectContaining({ usageGB: 520 })
    );

    warnSpy.mockClear();

    // Reset check timer to force re-fetch after 5 mins
    const futureDate = new Date(Date.now() + 301 * 1000);
    const fetch610 = createMockGraphQLFetch(610 * 1_000_000_000);
    const res2 = await guard.checkTurnAllowed(baseConfig, fetch610 as unknown as typeof fetch, futureDate);
    expect(res2.allowed).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      'cloudflare_turn_usage_warning_600gb',
      expect.stringContaining('600 GB milestone'),
      expect.objectContaining({ usageGB: 610 })
    );
    // Should NOT warn 500 GB again
    expect(warnSpy).not.toHaveBeenCalledWith('cloudflare_turn_usage_warning_500gb', expect.anything(), expect.anything());
  });

  it('resets milestone warnings and usage stats on UTC month rollover', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');

    // August: 550 GB
    const augDate = new Date('2026-08-31T23:50:00Z');
    const augFetch = createMockGraphQLFetch(550 * 1_000_000_000);
    await guard.checkTurnAllowed(baseConfig, augFetch as unknown as typeof fetch, augDate);
    expect(warnSpy).toHaveBeenCalledWith('cloudflare_turn_usage_warning_500gb', expect.anything(), expect.anything());

    warnSpy.mockClear();

    // September: starts fresh with 510 GB
    const septDate = new Date('2026-09-01T00:05:00Z');
    const septFetch = createMockGraphQLFetch(510 * 1_000_000_000);
    await guard.checkTurnAllowed(baseConfig, septFetch as unknown as typeof fetch, septDate);
    expect(warnSpy).toHaveBeenCalledWith('cloudflare_turn_usage_warning_500gb', expect.anything(), expect.anything());
  });

  it('caches the usage result for the configured check interval', async () => {
    const mockFetch = createMockGraphQLFetch(100 * 1_000_000_000);
    const t0 = new Date('2026-08-21T12:00:00Z');

    // First call queries GraphQL
    const res1 = await guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch, t0);
    expect(res1.allowed).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Call 2 minutes later uses cache
    const t1 = new Date('2026-08-21T12:02:00Z');
    const res2 = await guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch, t1);
    expect(res2.allowed).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Call 6 minutes later queries GraphQL again
    const t2 = new Date('2026-08-21T12:06:00Z');
    const res3 = await guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch, t2);
    expect(res3.allowed).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent requests into a single in-flight GraphQL query', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        ok: true,
        json: async () => ({
          data: {
            viewer: {
              accounts: [{ turnUsageAdaptiveGroups: [{ sum: { egressBytes: 200 * 1_000_000_000 } }] }]
            }
          }
        })
      };
    });

    const [r1, r2, r3, r4] = await Promise.all([
      guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch),
      guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch),
      guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch),
      guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch)
    ]);

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
    expect(r4.allowed).toBe(true);
    expect(callCount).toBe(1);
  });

  it('uses cached usage up to 15 minutes old when Cloudflare GraphQL query fails', async () => {
    const t0 = new Date('2026-08-21T12:00:00Z');
    const successFetch = createMockGraphQLFetch(300 * 1_000_000_000);
    await guard.checkTurnAllowed(baseConfig, successFetch as unknown as typeof fetch, t0);

    // 8 minutes later, cache expired, but query throws error
    const t1 = new Date('2026-08-21T12:08:00Z');
    const failFetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const res = await guard.checkTurnAllowed(baseConfig, failFetch as unknown as typeof fetch, t1);
    // Allowed because 8 min <= 15 min grace period and 300GB < 700GB
    expect(res.allowed).toBe(true);
    expect(res.usageBytes).toBe(300 * 1_000_000_000);
  });

  it('fails closed and withholds TURN credentials when analytics fail and no recent trustworthy cache exists', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const failFetch = vi.fn().mockRejectedValue(new Error('GraphQL service unavailable'));

    const res = await guard.checkTurnAllowed(baseConfig, failFetch as unknown as typeof fetch);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('unverified');
    expect(warnSpy).toHaveBeenCalledWith(
      'cloudflare_turn_usage_unverified',
      expect.stringContaining('usage could not be verified')
    );
  });

  it('generateCloudflareIceServers returns safe STUN servers when soft limit is reached', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('graphql')) {
        return {
          ok: true,
          json: async () => ({
            data: {
              viewer: {
                accounts: [{ turnUsageAdaptiveGroups: [{ sum: { egressBytes: 750 * 1_000_000_000 } }] }]
              }
            }
          })
        };
      }
      return {
        ok: true,
        json: async () => ({ iceServers: [{ urls: 'turn:turn.cloudflare.com:3478' }] })
      };
    });

    const servers = await generateCloudflareIceServers(baseConfig, mockFetch as unknown as typeof fetch, Date.now(), guard);
    expect(servers).toEqual(SAFE_DEFAULT_STUN_SERVERS);
  });

  it('getIceServers respects TurnUsageGuard for Cloudflare provider', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('graphql')) {
        return {
          ok: true,
          json: async () => ({
            data: {
              viewer: {
                accounts: [{ turnUsageAdaptiveGroups: [{ sum: { egressBytes: 800 * 1_000_000_000 } }] }]
              }
            }
          })
        };
      }
      return {
        ok: true,
        json: async () => ({ iceServers: [{ urls: 'turn:turn.cloudflare.com:3478' }] })
      };
    });

    const servers = await getIceServers(baseConfig, 'part-123', Date.now(), mockFetch as unknown as typeof fetch, guard);
    expect(servers).toEqual(SAFE_DEFAULT_STUN_SERVERS);
  });

  it('enforces CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_TURN_ANALYTICS_API_TOKEN in production when soft limit is enabled', () => {
    expect(() => {
      loadConfig({
        NODE_ENV: 'production',
        TURN_PROVIDER: 'cloudflare',
        CLOUDFLARE_TURN_KEY_ID: 'k-1',
        CLOUDFLARE_TURN_API_TOKEN: 't-1',
        TURN_MONTHLY_SOFT_LIMIT_GB: '700',
        CLOUDFLARE_ACCOUNT_ID: '',
        CLOUDFLARE_TURN_ANALYTICS_API_TOKEN: 'analytics-tok'
      });
    }).toThrow('CLOUDFLARE_ACCOUNT_ID is required');

    expect(() => {
      loadConfig({
        NODE_ENV: 'production',
        TURN_PROVIDER: 'cloudflare',
        CLOUDFLARE_TURN_KEY_ID: 'k-1',
        CLOUDFLARE_TURN_API_TOKEN: 't-1',
        TURN_MONTHLY_SOFT_LIMIT_GB: '700',
        CLOUDFLARE_ACCOUNT_ID: 'acc-1',
        CLOUDFLARE_TURN_ANALYTICS_API_TOKEN: ''
      });
    }).toThrow('CLOUDFLARE_TURN_ANALYTICS_API_TOKEN is required');

    // Valid production configuration
    const valid = loadConfig({
      NODE_ENV: 'production',
      TURN_PROVIDER: 'cloudflare',
      CLOUDFLARE_TURN_KEY_ID: 'k-1',
      CLOUDFLARE_TURN_API_TOKEN: 't-1',
      TURN_MONTHLY_SOFT_LIMIT_GB: '700',
      CLOUDFLARE_ACCOUNT_ID: 'acc-1',
      CLOUDFLARE_TURN_ANALYTICS_API_TOKEN: 'analytics-tok'
    });
    expect(valid.TURN_MONTHLY_SOFT_LIMIT_GB).toBe(700);
  });

  it('allows development mode without analytics tokens', async () => {
    const devConfig = loadConfig({
      NODE_ENV: 'development',
      TURN_PROVIDER: 'cloudflare',
      CLOUDFLARE_TURN_KEY_ID: 'k-1',
      CLOUDFLARE_TURN_API_TOKEN: 't-1',
      TURN_MONTHLY_SOFT_LIMIT_GB: '700'
    });

    const res = await guard.checkTurnAllowed(devConfig);
    expect(res.allowed).toBe(true);
  });
});
