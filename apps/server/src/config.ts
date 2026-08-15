import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  ALLOWED_ORIGINS: z.string().default('jameet-app://bundle,musiczoom-app://bundle,http://localhost:5173'),
  TURN_HOST: z.string().default('localhost'),
  TURN_PORT: z.coerce.number().int().positive().default(3478),
  TURN_TLS_PORT: z.coerce.number().int().positive().default(5349),
  TURN_TLS_ENABLED: z.string().default('false').transform((v) => v === 'true'),
  TURN_REALM: z.string().default('musiczoom.local'),
  TURN_SHARED_SECRET: z.string().min(16).default('development-secret-change-me'),
  TURN_CREDENTIAL_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
  DISCONNECT_GRACE_MS: z.coerce.number().int().min(1000).default(30000),
  EMPTY_ROOM_TTL_MS: z.coerce.number().int().min(60000).default(28800000)
});

export type ServerConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const config = schema.parse(env);
  if (config.NODE_ENV === 'production' && config.TURN_SHARED_SECRET === 'development-secret-change-me') {
    throw new Error('TURN_SHARED_SECRET must be changed in production');
  }
  return config;
}
