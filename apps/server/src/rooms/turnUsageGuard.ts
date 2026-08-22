import type { ServerConfig } from '../core/config.js';
import { logger } from '../core/logger.js';

export interface TurnUsageCheckResult {
  allowed: boolean;
  reason?: 'soft_limit_reached' | 'unverified';
  usageBytes?: number;
}

export function getUtcMonthKey(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getUtcMonthStartIso(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01T00:00:00Z`;
}

export class TurnUsageGuard {
  private lastSuccessfulUsageBytes: number | null = null;
  private lastSuccessfulCheckTime = 0;
  private currentMonth = '';
  private warned500GB = false;
  private warned600GB = false;
  private warnedSoftLimit = false;
  private inFlightQuery: Promise<number> | null = null;

  resetState(): void {
    this.lastSuccessfulUsageBytes = null;
    this.lastSuccessfulCheckTime = 0;
    this.currentMonth = '';
    this.warned500GB = false;
    this.warned600GB = false;
    this.warnedSoftLimit = false;
    this.inFlightQuery = null;
  }

  private resetForNewMonth(monthKey: string): void {
    this.lastSuccessfulUsageBytes = null;
    this.lastSuccessfulCheckTime = 0;
    this.currentMonth = monthKey;
    this.warned500GB = false;
    this.warned600GB = false;
    this.warnedSoftLimit = false;
  }

  private evaluateMilestones(usageBytes: number, limitGb: number): void {
    const bytes500GB = 500 * 1_000_000_000;
    const bytes600GB = 600 * 1_000_000_000;
    const usageGB = Math.round((usageBytes / 1_000_000_000) * 100) / 100;

    if (usageBytes >= bytes500GB && !this.warned500GB) {
      this.warned500GB = true;
      logger.warn('cloudflare_turn_usage_warning_500gb', 'Cloudflare TURN monthly usage crossed 500 GB milestone', {
        usageGB,
        limitGB: limitGb
      });
    }

    if (usageBytes >= bytes600GB && !this.warned600GB) {
      this.warned600GB = true;
      logger.warn('cloudflare_turn_usage_warning_600gb', 'Cloudflare TURN monthly usage crossed 600 GB milestone', {
        usageGB,
        limitGB: limitGb
      });
    }

    const softLimitBytes = limitGb * 1_000_000_000;
    if (usageBytes >= softLimitBytes && !this.warnedSoftLimit) {
      this.warnedSoftLimit = true;
      logger.warn('cloudflare_turn_soft_limit_reached', 'Cloudflare TURN monthly egress reached soft limit. New TURN credentials withheld; safe STUN fallback applied.', {
        usageGB,
        limitGB: limitGb
      });
    }
  }

  private async executeGraphQLQuery(
    config: ServerConfig,
    fetchFn: typeof fetch,
    now: Date
  ): Promise<number> {
    const endpoint = 'https://api.cloudflare.com/client/v4/graphql';
    const monthStartIso = getUtcMonthStartIso(now);
    const nowIso = now.toISOString();

    const query = `query GetTurnUsage($accountTag: String!, $datetimeStart: Time!, $datetimeEnd: Time!, $turnKeyId: String!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      turnUsageAdaptiveGroups(
        filter: {
          datetime_geq: $datetimeStart
          datetime_leq: $datetimeEnd
          turnKeyId: $turnKeyId
        }
        limit: 1000
      ) {
        sum {
          egressBytes
        }
      }
    }
  }
}`;

    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.CLOUDFLARE_TURN_ANALYTICS_API_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'JaMeet-Server'
      },
      body: JSON.stringify({
        query,
        variables: {
          accountTag: config.CLOUDFLARE_ACCOUNT_ID,
          datetimeStart: monthStartIso,
          datetimeEnd: nowIso,
          turnKeyId: config.CLOUDFLARE_TURN_KEY_ID
        }
      }),
      signal: AbortSignal.timeout(5000)
    });

    if (!res.ok) {
      throw new Error(`Cloudflare Analytics API returned status ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      throw new Error('Cloudflare GraphQL Analytics query returned errors');
    }

    const accounts = (data?.data as Record<string, unknown>)?.viewer as Record<string, unknown>;
    const accountList = accounts?.accounts as Array<Record<string, unknown>> | undefined;
    const turnGroups = accountList?.[0]?.turnUsageAdaptiveGroups as Array<Record<string, unknown>> | undefined;

    let totalEgressBytes = 0;
    if (Array.isArray(turnGroups)) {
      for (const group of turnGroups) {
        const sum = group?.sum as Record<string, unknown> | undefined;
        if (typeof sum?.egressBytes === 'number') {
          totalEgressBytes += sum.egressBytes;
        }
      }
    }

    return totalEgressBytes;
  }

  async checkTurnAllowed(
    config: ServerConfig,
    fetchFn: typeof fetch = fetch,
    now = new Date()
  ): Promise<TurnUsageCheckResult> {
    if (config.TURN_PROVIDER !== 'cloudflare' || config.TURN_MONTHLY_SOFT_LIMIT_GB <= 0) {
      return { allowed: true };
    }

    if (!config.CLOUDFLARE_ACCOUNT_ID || !config.CLOUDFLARE_TURN_ANALYTICS_API_TOKEN) {
      if (config.NODE_ENV !== 'production') {
        return { allowed: true };
      }
      logger.warn('cloudflare_turn_usage_unverified', 'Cloudflare TURN credentials withheld because analytics configuration is missing');
      return { allowed: false, reason: 'unverified' };
    }

    const monthKey = getUtcMonthKey(now);
    if (this.currentMonth !== monthKey) {
      this.resetForNewMonth(monthKey);
    }

    const checkIntervalMs = config.TURN_USAGE_CHECK_INTERVAL_SECONDS * 1000;
    const nowMs = now.getTime();
    const isCacheValid =
      this.lastSuccessfulUsageBytes !== null &&
      nowMs - this.lastSuccessfulCheckTime < checkIntervalMs;

    if (!isCacheValid) {
      if (!this.inFlightQuery) {
        this.inFlightQuery = this.executeGraphQLQuery(config, fetchFn, now).finally(() => {
          this.inFlightQuery = null;
        });
      }

      try {
        const usageBytes = await this.inFlightQuery;
        this.lastSuccessfulUsageBytes = usageBytes;
        this.lastSuccessfulCheckTime = now.getTime();
        this.evaluateMilestones(usageBytes, config.TURN_MONTHLY_SOFT_LIMIT_GB);
      } catch (err: unknown) {
        const gracePeriodMs = 15 * 60 * 1000; // 15 minutes
        const hasGraceCache =
          this.lastSuccessfulUsageBytes !== null &&
          nowMs - this.lastSuccessfulCheckTime <= gracePeriodMs;

        if (!hasGraceCache) {
          logger.warn('cloudflare_turn_usage_unverified', 'Cloudflare TURN credentials withheld because usage could not be verified');
          return { allowed: false, reason: 'unverified' };
        }
      }
    }

    const softLimitBytes = config.TURN_MONTHLY_SOFT_LIMIT_GB * 1_000_000_000;
    if (this.lastSuccessfulUsageBytes !== null && this.lastSuccessfulUsageBytes >= softLimitBytes) {
      if (!this.warnedSoftLimit) {
        this.warnedSoftLimit = true;
        logger.warn('cloudflare_turn_soft_limit_reached', 'Cloudflare TURN monthly egress reached soft limit. New TURN credentials withheld; safe STUN fallback applied.', {
          usageGB: Math.round((this.lastSuccessfulUsageBytes / 1_000_000_000) * 100) / 100,
          limitGB: config.TURN_MONTHLY_SOFT_LIMIT_GB
        });
      }
      return {
        allowed: false,
        reason: 'soft_limit_reached',
        usageBytes: this.lastSuccessfulUsageBytes
      };
    }

    return {
      allowed: true,
      usageBytes: this.lastSuccessfulUsageBytes ?? 0
    };
  }
}

export const defaultTurnUsageGuard = new TurnUsageGuard();
