import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  ALLOWED_ORIGINS: z.string().default('jameet-app://bundle,musiczoom-app://bundle,http://localhost:5173'),
  DATA_DIR: z.string().optional(),
  BETA_END_AT: z.string().optional(),
  TURN_PROVIDER: z.enum(['self_hosted', 'cloudflare']).default('self_hosted'),
  CLOUDFLARE_TURN_KEY_ID: z.string().optional(),
  CLOUDFLARE_TURN_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_TURN_ANALYTICS_API_TOKEN: z.string().optional(),
  TURN_MONTHLY_SOFT_LIMIT_GB: z.coerce.number().min(0).default(600),
  TURN_USAGE_CHECK_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(60),
  TURN_HOST: z.string().default('localhost'),
  TURN_PORT: z.coerce.number().int().positive().default(3478),
  TURN_TLS_PORT: z.coerce.number().int().positive().default(5349),
  TURN_TLS_ENABLED: z.string().default('false').transform((v) => v === 'true'),
  TURN_REALM: z.string().default('jameet.local'),
  TURN_SHARED_SECRET: z.string().min(16).default('development-secret-change-me'),
  TURN_CREDENTIAL_TTL_SECONDS: z.coerce.number().int().min(60).max(172800).default(28800),
  DISCONNECT_GRACE_MS: z.coerce.number().int().min(0).default(30000),
  EMPTY_ROOM_TTL_MS: z.coerce.number().int().min(60000).default(28800000),
  JAMEET_ADMIN_SECRET: z.string().optional()
});

export type ServerConfig = z.infer<typeof schema>;

const ISO_8601_TIMEZONE_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|([+-]\d{2})(?::?(\d{2}))?)$/i;

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDays = daysInMonth[month - 1];
  if (maxDays === undefined) return false;
  return day <= maxDays;
}

export function parseBetaEndAt(val?: string | null): number | null {
  if (val === undefined || val === null || val === '') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  const match = trimmed.match(ISO_8601_TIMEZONE_REGEX);
  if (!match) {
    throw new Error(`Invalid BETA_END_AT configuration: "${val}". Must be an absolute ISO 8601 timestamp with an explicit timezone (e.g. 2026-12-31T23:59:59Z or 2026-12-31T23:59:59+00:00).`);
  }
  const yearStr = match[1];
  const monthStr = match[2];
  const dayStr = match[3];
  const hourStr = match[4];
  const minStr = match[5];
  if (!yearStr || !monthStr || !dayStr || !hourStr || !minStr) {
    throw new Error(`Invalid BETA_END_AT configuration: "${val}".`);
  }
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minStr, 10);
  const second = match[6] ? parseInt(match[6], 10) : 0;

  if (!isValidCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 60) {
    throw new Error(`Invalid BETA_END_AT date value: "${val}".`);
  }
  const tzHourStr = match[7];
  if (tzHourStr) {
    const tzHour = Math.abs(parseInt(tzHourStr, 10));
    const tzMin = match[8] ? parseInt(match[8], 10) : 0;
    if (tzHour > 23 || tzMin > 59) {
      throw new Error(`Invalid BETA_END_AT timezone offset: "${val}".`);
    }
  }
  const parsed = Date.parse(trimmed);
  if (isNaN(parsed)) {
    throw new Error(`Invalid BETA_END_AT date value: "${val}".`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const config = schema.parse(env);
  if (config.NODE_ENV === 'production') {
    if (config.TURN_PROVIDER === 'self_hosted') {
      if (config.TURN_SHARED_SECRET === 'development-secret-change-me') {
        throw new Error('TURN_SHARED_SECRET must be changed in production when using self_hosted TURN provider');
      }
      if (config.TURN_HOST === 'localhost' || config.TURN_HOST === '127.0.0.1') {
        throw new Error('TURN_HOST must be configured with a valid public hostname or IP in production when using self_hosted TURN provider');
      }
    } else if (config.TURN_PROVIDER === 'cloudflare') {
      if (!config.CLOUDFLARE_TURN_KEY_ID || config.CLOUDFLARE_TURN_KEY_ID.trim() === '') {
        throw new Error('CLOUDFLARE_TURN_KEY_ID is required when TURN_PROVIDER is cloudflare');
      }
      if (!config.CLOUDFLARE_TURN_API_TOKEN || config.CLOUDFLARE_TURN_API_TOKEN.trim() === '') {
        throw new Error('CLOUDFLARE_TURN_API_TOKEN is required when TURN_PROVIDER is cloudflare');
      }
      if (config.TURN_MONTHLY_SOFT_LIMIT_GB > 0) {
        if (!config.CLOUDFLARE_ACCOUNT_ID || config.CLOUDFLARE_ACCOUNT_ID.trim() === '') {
          throw new Error('CLOUDFLARE_ACCOUNT_ID is required in production when Cloudflare TURN is enabled with a monthly soft limit');
        }
        if (!config.CLOUDFLARE_TURN_ANALYTICS_API_TOKEN || config.CLOUDFLARE_TURN_ANALYTICS_API_TOKEN.trim() === '') {
          throw new Error('CLOUDFLARE_TURN_ANALYTICS_API_TOKEN is required in production when Cloudflare TURN is enabled with a monthly soft limit');
        }
      }
    }
  }
  if (config.BETA_END_AT !== undefined && config.BETA_END_AT !== '') {
    parseBetaEndAt(config.BETA_END_AT);
  }
  return config;
}
