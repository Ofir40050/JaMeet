import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig } from '../core/config.js';
import { logger } from '../core/logger.js';
import {
  TurnUsageGuard,
  getUtcMonthKey,
  getUtcMonthStartDateStr,
  getUtcCurrentDateStr
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
    TURN_MONTHLY_SOFT_LIMIT_GB: '600',
    TURN_USAGE_CHECK_INTERVAL_SECONDS: '60'
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
                callsTurnUsageAdaptiveGroups: [
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

  it('computes correct UTC month keys, start dates, and current dates in YYYY-MM-DD format', () => {
    const fixedDate = new Date('2026-08-21T17:00:00Z');
    expect(getUtcMonthKey(fixedDate)).toBe('2026-08');
    expect(getUtcMonthStartDateStr(fixedDate)).toBe('2026-08-01');
    expect(getUtcCurrentDateStr(fixedDate)).toBe('2026-08-21');
  });

  it('queries official Cloudflare GraphQL dataset, filters, and variables', async () => {
    const mockFetch = createMockGraphQLFetch(250 * 1_000_000_000);
    const fixedDate = new Date('2026-08-21T12:00:00Z');
    const result = await guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch, fixedDate);

    expect(result.allowed).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, requestInit] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.cloudflare.com/client/v4/graphql');
    expect(requestInit.method).toBe('POST');
    expect(requestInit.headers['Authorization']).toBe('Bearer token-analytics-xyz');
    expect(requestInit.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(requestInit.body);
    expect(body.query).toContain('callsTurnUsageAdaptiveGroups');
    expect(body.query).toContain('keyId: $keyId');
    expect(body.query).toContain('date_geq: $dateStart');
    expect(body.query).toContain('date_leq: $dateEnd');
    expect(body.query).toContain('egressBytes');
    expect(body.query).not.toContain('turnUsageAdaptiveGroups');
    expect(body.query).not.toContain('turnKeyId');
    expect(body.query).not.toContain('datetime_geq');

    expect(body.variables).toEqual({
      accountTag: 'acc-456',
      dateStart: '2026-08-01',
      dateEnd: '2026-08-21',
      keyId: 'key-123'
    });
  });

  it('allows TURN generation when monthly egress is below 600 GB', async () => {
    const mockFetch = createMockGraphQLFetch(400 * 1_000_000_000); // 400 GB
    const result = await guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch);

    expect(result.allowed).toBe(true);
    expect(result.usageBytes).toBe(400 * 1_000_000_000);
  });

  it('treats valid empty callsTurnUsageAdaptiveGroups array as zero usage', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          viewer: {
            accounts: [
              {
                callsTurnUsageAdaptiveGroups: []
              }
            ]
          }
        }
      })
    });

    const result = await guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch);
    expect(result.allowed).toBe(true);
    expect(result.usageBytes).toBe(0);
  });

  it('withholds TURN credentials and returns soft_limit_reached when usage is at or above 600 GB', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const mockFetch = createMockGraphQLFetch(600 * 1_000_000_000); // 600 GB
    const result = await guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('soft_limit_reached');
    expect(warnSpy).toHaveBeenCalledWith(
      'cloudflare_turn_soft_limit_reached',
      expect.stringContaining('soft limit'),
      expect.objectContaining({
        usageGB: 600,
        limitGB: 600
      })
    );
  });

  it('records milestone warnings at 450 GB, 500 GB, 550 GB, and 600 GB', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');

    // 1. 460 GB
    const fetch460 = createMockGraphQLFetch(460 * 1_000_000_000);
    const res1 = await guard.checkTurnAllowed(baseConfig, fetch460 as unknown as typeof fetch);
    expect(res1.allowed).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      'cloudflare_turn_usage_warning_450gb',
      expect.stringContaining('450 GB milestone'),
      expect.objectContaining({ usageGB: 460 })
    );

    warnSpy.mockClear();

    // 2. 510 GB (after 61s)
    const t510 = new Date(Date.now() + 65 * 1000);
    const fetch510 = createMockGraphQLFetch(510 * 1_000_000_000);
    const res2 = await guard.checkTurnAllowed(baseConfig, fetch510 as unknown as typeof fetch, t510);
    expect(res2.allowed).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      'cloudflare_turn_usage_warning_500gb',
      expect.stringContaining('500 GB milestone'),
      expect.objectContaining({ usageGB: 510 })
    );

    warnSpy.mockClear();

    // 3. 560 GB (always fresh query because >= 500 GB)
    const fetch560 = createMockGraphQLFetch(560 * 1_000_000_000);
    const res3 = await guard.checkTurnAllowed(baseConfig, fetch560 as unknown as typeof fetch, t510);
    expect(res3.allowed).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      'cloudflare_turn_usage_warning_550gb',
      expect.stringContaining('550 GB milestone'),
      expect.objectContaining({ usageGB: 560 })
    );

    warnSpy.mockClear();

    // 4. 605 GB
    const fetch605 = createMockGraphQLFetch(605 * 1_000_000_000);
    const res4 = await guard.checkTurnAllowed(baseConfig, fetch605 as unknown as typeof fetch, t510);
    expect(res4.allowed).toBe(false);
    expect(res4.reason).toBe('soft_limit_reached');
    expect(warnSpy).toHaveBeenCalledWith(
      'cloudflare_turn_usage_warning_600gb',
      expect.stringContaining('600 GB milestone'),
      expect.objectContaining({ usageGB: 605 })
    );
  });

  it('requires a fresh query on every call once usage reaches 500 GB', async () => {
    const mockFetch = createMockGraphQLFetch(510 * 1_000_000_000);
    const t0 = new Date('2026-08-21T12:00:00Z');

    // First call queries GraphQL
    const res1 = await guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch, t0);
    expect(res1.allowed).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call only 2 seconds later still queries GraphQL because usage >= 500 GB
    const t1 = new Date('2026-08-21T12:00:02Z');
    const res2 = await guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch, t1);
    expect(res2.allowed).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent requests when usage is at or above 500 GB', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        ok: true,
        json: async () => ({
          data: {
            viewer: {
              accounts: [{ callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: 520 * 1_000_000_000 } }] }]
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

  it('fails closed when refresh fails and does not authorize TURN with stale data', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const failFetch = vi.fn().mockRejectedValue(new Error('GraphQL timeout'));

    const res = await guard.checkTurnAllowed(baseConfig, failFetch as unknown as typeof fetch);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('unverified');
    expect(warnSpy).toHaveBeenCalledWith(
      'cloudflare_turn_usage_unverified',
      expect.stringContaining('usage could not be verified')
    );
  });

  it('fails closed on missing or empty accounts array', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const mockEmptyAccounts = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          viewer: {
            accounts: []
          }
        }
      })
    });

    const res = await guard.checkTurnAllowed(baseConfig, mockEmptyAccounts as unknown as typeof fetch);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('unverified');
  });

  it('fails closed on GraphQL errors array', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const mockGraphQLErrors = createMockGraphQLFetch(0, true, [{ message: 'Access denied to analytics dataset' }]);

    const res = await guard.checkTurnAllowed(baseConfig, mockGraphQLErrors as unknown as typeof fetch);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('unverified');
  });

  it('fails closed on invalid, negative, NaN, or non-numeric egressBytes', async () => {
    const mockInvalidBytes = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          viewer: {
            accounts: [
              {
                callsTurnUsageAdaptiveGroups: [
                  {
                    sum: {
                      egressBytes: -500
                    }
                  }
                ]
              }
            ]
          }
        }
      })
    });

    const res = await guard.checkTurnAllowed(baseConfig, mockInvalidBytes as unknown as typeof fetch);
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('unverified');
  });

  it('prevents UTC month rollover concurrency race so an old month query does not populate new month cache', async () => {
    let resolveOldMonth: (value: any) => void;
    const oldMonthPromise = new Promise((resolve) => {
      resolveOldMonth = resolve;
    });

    const mockFetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (body.variables.dateStart === '2026-08-01') {
        // Delayed August query (over limit: 650 GB)
        await oldMonthPromise;
        return {
          ok: true,
          json: async () => ({
            data: {
              viewer: {
                accounts: [
                  {
                    callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: 650 * 1_000_000_000 } }]
                  }
                ]
              }
            }
          })
        };
      }
      // Immediate September query (under limit: 50 GB)
      return {
        ok: true,
        json: async () => ({
          data: {
            viewer: {
              accounts: [
                {
                  callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: 50 * 1_000_000_000 } }]
                }
              ]
            }
          }
        })
      };
    });

    // 1. Trigger August check (which stalls)
    const augDate = new Date('2026-08-31T23:59:50Z');
    const augCheckPromise = guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch, augDate);

    // 2. Month rolls over to September
    const septDate = new Date('2026-09-01T00:00:10Z');
    const septCheck = await guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch, septDate);
    expect(septCheck.allowed).toBe(true);
    expect(septCheck.usageBytes).toBe(50 * 1_000_000_000);

    // 3. Complete the stalled August query
    resolveOldMonth!({} as any);
    await augCheckPromise;

    // 4. Subsequent September check must still be clean and not contaminated by August's 650 GB
    const septCheck2 = await guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch, septDate);
    expect(septCheck2.allowed).toBe(true);
    expect(septCheck2.usageBytes).toBe(50 * 1_000_000_000);
  });

  it('caches the usage result for 60 seconds when below 500 GB', async () => {
    const mockFetch = createMockGraphQLFetch(100 * 1_000_000_000);
    const t0 = new Date('2026-08-21T12:00:00Z');

    // First call queries GraphQL
    const res1 = await guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch, t0);
    expect(res1.allowed).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Call 30 seconds later uses cache
    const t1 = new Date('2026-08-21T12:00:30Z');
    const res2 = await guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch, t1);
    expect(res2.allowed).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Call 70 seconds later queries GraphQL again
    const t2 = new Date('2026-08-21T12:01:10Z');
    const res3 = await guard.checkTurnAllowed(baseConfig, mockFetch as unknown as typeof fetch, t2);
    expect(res3.allowed).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('generateCloudflareIceServers returns safe STUN servers when soft limit is reached', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('graphql')) {
        return {
          ok: true,
          json: async () => ({
            data: {
              viewer: {
                accounts: [{ callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: 650 * 1_000_000_000 } }] }]
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
                accounts: [{ callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: 700 * 1_000_000_000 } }] }]
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
});


