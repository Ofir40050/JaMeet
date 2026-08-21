import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  ALLOWED_ORIGINS: z.string().default('jameet-app://bundle,musiczoom-app://bundle,http://localhost:5173'),
  DATA_DIR: z.string().optional(),
  BETA_END_AT: z.string().optional(),
  TURN_HOST: z.string().default('localhost'),
  TURN_PORT: z.coerce.number().int().positive().default(3478),
  TURN_TLS_PORT: z.coerce.number().int().positive().default(5349),
  TURN_TLS_ENABLED: z.string().default('false').transform((v) => v === 'true'),
  TURN_REALM: z.string().default('jameet.local'),
  TURN_SHARED_SECRET: z.string().min(16).default('development-secret-change-me'),
  TURN_CREDENTIAL_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
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
  if (config.NODE_ENV === 'production' && config.TURN_SHARED_SECRET === 'development-secret-change-me') {
    throw new Error('TURN_SHARED_SECRET must be changed in production');
  }
  if (config.BETA_END_AT !== undefined && config.BETA_END_AT !== '') {
    parseBetaEndAt(config.BETA_END_AT);
  }
  return config;
}
