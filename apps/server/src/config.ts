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
  EMPTY_ROOM_TTL_MS: z.coerce.number().int().min(60000).default(28800000)
});

export type ServerConfig = z.infer<typeof schema>;

const ISO_8601_TIMEZONE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

export function parseBetaEndAt(val?: string | null): number | null {
  if (val === undefined || val === null || val === '') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  if (!ISO_8601_TIMEZONE_REGEX.test(trimmed)) {
    throw new Error(`Invalid BETA_END_AT configuration: "${val}". Must be an absolute ISO 8601 timestamp with an explicit timezone (e.g. 2026-12-31T23:59:59Z or 2026-12-31T23:59:59+00:00).`);
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
