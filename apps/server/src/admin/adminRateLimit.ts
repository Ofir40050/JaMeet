import { MAX_FAILED_ATTEMPTS, FAILED_ATTEMPTS_WINDOW_MS } from "./adminConstants.js";

// In-memory rate limiting for login attempts
const failedLoginAttempts = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const attempt = failedLoginAttempts.get(ip);
  if (!attempt) return true;
  if (now > attempt.resetAt) {
    failedLoginAttempts.delete(ip);
    return true;
  }
  return attempt.count < MAX_FAILED_ATTEMPTS;
}

export function recordFailedLogin(ip: string): void {
  const now = Date.now();
  const attempt = failedLoginAttempts.get(ip);
  if (!attempt || now > attempt.resetAt) {
    failedLoginAttempts.set(ip, { count: 1, resetAt: now + FAILED_ATTEMPTS_WINDOW_MS });
  } else {
    attempt.count += 1;
  }
}

export function clearFailedLogin(ip: string): void {
  failedLoginAttempts.delete(ip);
}
