import { z } from 'zod';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLogMeta {
  [key: string]: unknown;
}

export interface StructuredError {
  name?: string;
  message: string;
  stack?: string;
  code?: string | number;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  process: 'main' | 'renderer' | 'server';
  event: string;
  message: string;
  appVersion?: string;
  platform?: string;
  arch?: string;
  osRelease?: string;
  instanceId?: string;
  sessionId?: string;
  sessionCode?: string;
  attemptId?: string;
  meta?: StructuredLogMeta;
  error?: StructuredError;
}

export interface CrashReport {
  reportId?: string;
  timestamp: string;
  process: 'main' | 'renderer' | 'child' | 'native' | 'unknown';
  appVersion: string;
  electronVersion?: string;
  nodeVersion?: string;
  platform: string;
  arch: string;
  osRelease?: string;
  instanceId?: string;
  sessionId?: string;
  sessionCode?: string;
  reason?: string;
  exitCode?: number;
  error?: StructuredError;
  context?: StructuredLogMeta;
}

export const crashReportSchema = z.object({
  reportId: z.string().min(1).max(128).optional(),
  timestamp: z.string().min(1).max(64),
  process: z.enum(['main', 'renderer', 'child', 'native', 'unknown']),
  appVersion: z.string().min(1).max(64),
  electronVersion: z.string().max(64).optional(),
  nodeVersion: z.string().max(64).optional(),
  platform: z.string().min(1).max(64),
  arch: z.string().min(1).max(64),
  osRelease: z.string().max(128).optional(),
  instanceId: z.string().max(128).optional(),
  sessionId: z.string().max(128).optional(),
  sessionCode: z.string().max(64).optional(),
  reason: z.string().max(2000).optional(),
  exitCode: z.number().int().optional(),
  error: z.object({
    name: z.string().max(256).optional(),
    message: z.string().max(4000),
    stack: z.string().max(8000).optional(),
    code: z.union([z.string().max(128), z.number()]).optional()
  }).optional(),
  context: z.record(z.string(), z.unknown()).optional()
});

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /passphrase/i,
  /secret/i,
  /token/i,
  /auth_token/i,
  /authtoken/i,
  /reconnect_token/i,
  /reconnecttoken/i,
  /jwt/i,
  /authorization/i,
  /cookie/i,
  /credential/i,
  /email/i,
  /usernameoremail/i,
  /username_or_email/i,
  /lyrics/i,
  /notes/i,
  /privatedata/i,
  /projectworkspace/i,
  /lyricsworkspace/i,
  /turnsharedsecret/i,
  /turn_shared_secret/i,
  /cloudflare_turn_api_token/i,
  /cloudflare_turn_key_id/i,
  /cloudflare_turn_analytics_api_token/i,
  /cloudflare_account_id/i,
  /turn_analytics_api_token/i,
  /analytics_token/i,
  /turn_api_token/i,
  /turn_key/i,
  /admintoken/i,
  /admin_token/i
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function sanitizeLogString(input: string): string {
  if (!input || typeof input !== 'string') return input;

  let str = input;

  if (str.length > 4000) {
    str = `${str.slice(0, 500)}...[TRUNCATED ${str.length} bytes]`;
  }

  // 1. Redact basic authentication in URLs (e.g. https://user:pass@domain.com)
  str = str.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:\s\/@]+):([^@\s\/]+)@/g, '$1$2:[REDACTED]@');

  // 2. Redact Authorization Bearer tokens
  str = str.replace(/bearer\s+[a-z0-9_.~+\/-]+=*/gi, 'Bearer [REDACTED]');

  // 3. Redact JSON Web Tokens (3 base64url segments starting with eyJ)
  str = str.replace(/\beyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_.-]*/g, '[REDACTED_TOKEN]');

  // 4. Redact JSON-style key-values: "password": "...", "token": "...", etc.
  str = str.replace(
    /"((?:password|passphrase|currentPassword|newPassword|secret|token|sessionToken|session_token|turnSharedSecret|turn_shared_secret|authToken|auth_token|reconnectToken|reconnect_token|adminToken|admin_token|credential|credentials|email|usernameOrEmail|username_or_email|CLOUDFLARE_TURN_API_TOKEN|CLOUDFLARE_TURN_KEY_ID|CLOUDFLARE_TURN_ANALYTICS_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|cloudflare_turn_api_token|cloudflare_turn_key_id|cloudflare_turn_analytics_api_token|cloudflare_account_id|cloudflareTurnApiToken|cloudflareTurnKeyId|cloudflareTurnAnalyticsApiToken|cloudflareAccountId|turn_analytics_api_token|analytics_token|turn_api_token|turn_key_id|turnApiKey|turnKeyId))"\s*:\s*("(?:[^"\\]|\\.)*"|(?!\[REDACTED)[^\s,}\]]+)/gi,
    '"$1":"[REDACTED]"'
  );

  // 5. Redact Key-Value patterns in text, query strings, headers, error messages:
  str = str.replace(
    /((?:password|passphrase|currentPassword|newPassword|secret|token|sessionToken|session_token|turnSharedSecret|turn_shared_secret|authToken|auth_token|reconnectToken|reconnect_token|adminToken|admin_token|credential|credentials|email|usernameOrEmail|username_or_email|CLOUDFLARE_TURN_API_TOKEN|CLOUDFLARE_TURN_KEY_ID|CLOUDFLARE_TURN_ANALYTICS_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|cloudflare_turn_api_token|cloudflare_turn_key_id|cloudflare_turn_analytics_api_token|cloudflare_account_id|cloudflareTurnApiToken|cloudflareTurnKeyId|cloudflareTurnAnalyticsApiToken|cloudflareAccountId|turn_analytics_api_token|analytics_token|turn_api_token|turn_key_id|turnApiKey|turnKeyId))\s*([:=])\s*("(?:[^"\\]|\\.)*"|'[^']*'|(?!\[REDACTED)[^\s,;&'"}]+)/gi,
    '$1$2[REDACTED]'
  );

  // 6. Redact local filesystem usernames from file paths (macOS, Windows, Linux)
  // macOS: /Users/<username>/ -> /Users/[USER]/
  str = str.replace(/(\/Users\/)[^\/\s"':\\]+(\/)/gi, '$1[USER]$2');
  // Linux: /home/<username>/ -> /home/[USER]/
  str = str.replace(/(\/home\/)[^\/\s"':\\]+(\/)/gi, '$1[USER]$2');
  // Windows: C:\Users\<username>\ -> C:\Users\[USER]\
  str = str.replace(/([a-zA-Z]:\\Users\\)[^\\/\s"':]+(\\)/gi, '$1[USER]$2');
  // Windows forward-slash variant: C:/Users/<username>/ -> C:/Users/[USER]/
  str = str.replace(/([a-zA-Z]:\/Users\/)[^\\/\s"':]+(\/)/gi, '$1[USER]$2');

  return str;
}

export function sanitizeLogData<T>(data: T, seen = new WeakSet<object>(), depth = 0): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (depth > 6) {
    return '[DEPTH_EXCEEDED]' as unknown as T;
  }

  if (typeof data === 'string') {
    return sanitizeLogString(data) as unknown as T;
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (seen.has(data as object)) {
    return '[CIRCULAR]' as unknown as T;
  }
  seen.add(data as object);

  if (data instanceof Error) {
    const serializedError: StructuredError = {
      name: data.name,
      message: sanitizeLogString(data.message),
      stack: data.stack ? sanitizeLogString(data.stack) : undefined,
      code: (data as any).code
    };
    return serializedError as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item, seen, depth + 1)) as unknown as T;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = sanitizeLogData(value, seen, depth + 1);
    }
  }

  return sanitized as T;
}

export function serializeError(err: unknown): StructuredError | undefined {
  if (!err) return undefined;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: sanitizeLogString(err.message),
      stack: err.stack ? sanitizeLogString(err.stack) : undefined,
      code: (err as any).code
    };
  }
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;
    return {
      name: typeof obj.name === 'string' ? obj.name : 'Error',
      message: typeof obj.message === 'string' ? sanitizeLogString(obj.message) : JSON.stringify(sanitizeLogData(err)),
      stack: typeof obj.stack === 'string' ? sanitizeLogString(obj.stack) : undefined,
      code: typeof obj.code === 'string' || typeof obj.code === 'number' ? obj.code : undefined
    };
  }
  return {
    message: sanitizeLogString(String(err))
  };
}
