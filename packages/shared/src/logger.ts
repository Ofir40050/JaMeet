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
  timestamp: string;
  process: 'main' | 'renderer' | 'child';
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
  /lyrics/i,
  /notes/i,
  /privatedata/i,
  /projectworkspace/i,
  /lyricsworkspace/i,
  /turnsharedsecret/i,
  /turn_shared_secret/i,
  /admintoken/i,
  /admin_token/i
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function sanitizeLogData<T>(data: T, seen = new WeakSet<object>(), depth = 0): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (depth > 6) {
    return '[DEPTH_EXCEEDED]' as unknown as T;
  }

  if (typeof data === 'string') {
    if (data.length > 2000) {
      return `${data.slice(0, 100)}...[TRUNCATED ${data.length} bytes]` as unknown as T;
    }
    if (/bearer\s+[a-z0-9_.~+\/-]+=*/i.test(data)) {
      return data.replace(/bearer\s+[a-z0-9_.~+\/-]+=*/gi, 'Bearer [REDACTED]') as unknown as T;
    }
    return data;
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
      message: sanitizeLogData(data.message, seen, depth + 1),
      stack: data.stack ? sanitizeLogData(data.stack, seen, depth + 1) : undefined,
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
      message: err.message,
      stack: err.stack,
      code: (err as any).code
    };
  }
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;
    return {
      name: typeof obj.name === 'string' ? obj.name : 'Error',
      message: typeof obj.message === 'string' ? obj.message : JSON.stringify(sanitizeLogData(err)),
      stack: typeof obj.stack === 'string' ? obj.stack : undefined,
      code: typeof obj.code === 'string' || typeof obj.code === 'number' ? obj.code : undefined
    };
  }
  return {
    message: String(err)
  };
}
