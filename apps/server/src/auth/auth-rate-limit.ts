export const MAX_FAILED_LOGINS_PER_IDENTIFIER = 5;
export const MAX_FAILED_LOGINS_PER_IP = 20;
export const LOGIN_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const FAILED_LOGIN_DELAY_MS = 500; // 500ms progressive delay on auth failure

export const MAX_GUEST_CREATIONS_PER_IP = 10;
export const GUEST_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export const MAX_MAP_ENTRIES = 10_000;

interface RateBucket {
  count: number;
  resetAt: number;
}

// In-memory rate limiting state with bounded capacity
const failedLoginsByIdentifier = new Map<string, RateBucket>();
const failedLoginsByIp = new Map<string, RateBucket>();
const guestCreationsByIp = new Map<string, RateBucket>();

function enforceMapCapacity(map: Map<string, RateBucket>): void {
  if (map.size <= MAX_MAP_ENTRIES) return;
  // First clean expired entries
  const now = Date.now();
  for (const [key, bucket] of map.entries()) {
    if (now > bucket.resetAt) {
      map.delete(key);
    }
  }
  // If still above capacity, evict oldest entries (FIFO from insertion order)
  while (map.size > MAX_MAP_ENTRIES) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) {
      map.delete(oldestKey);
    } else {
      break;
    }
  }
}

function cleanExpiredEntries(): void {
  const now = Date.now();
  for (const [key, bucket] of failedLoginsByIdentifier.entries()) {
    if (now > bucket.resetAt) failedLoginsByIdentifier.delete(key);
  }
  for (const [key, bucket] of failedLoginsByIp.entries()) {
    if (now > bucket.resetAt) failedLoginsByIp.delete(key);
  }
  for (const [key, bucket] of guestCreationsByIp.entries()) {
    if (now > bucket.resetAt) guestCreationsByIp.delete(key);
  }
}

export function checkLoginRateLimit(
  ip: string,
  identifier: string
): { allowed: boolean; retryAfterSeconds?: number; reason?: string } {
  cleanExpiredEntries();
  const now = Date.now();
  const lowerId = identifier.trim().toLowerCase();

  // Check identifier limit
  const idBucket = failedLoginsByIdentifier.get(lowerId);
  if (idBucket && now <= idBucket.resetAt && idBucket.count >= MAX_FAILED_LOGINS_PER_IDENTIFIER) {
    const retryAfterSeconds = Math.max(1, Math.ceil((idBucket.resetAt - now) / 1000));
    return {
      allowed: false,
      retryAfterSeconds,
      reason: `Too many failed login attempts for this account. Please try again in ${retryAfterSeconds} seconds.`
    };
  }

  // Check IP limit
  const ipBucket = failedLoginsByIp.get(ip);
  if (ipBucket && now <= ipBucket.resetAt && ipBucket.count >= MAX_FAILED_LOGINS_PER_IP) {
    const retryAfterSeconds = Math.max(1, Math.ceil((ipBucket.resetAt - now) / 1000));
    return {
      allowed: false,
      retryAfterSeconds,
      reason: `Too many failed login attempts from this IP address. Please try again in ${retryAfterSeconds} seconds.`
    };
  }

  return { allowed: true };
}

export function recordFailedLogin(ip: string, identifier: string): void {
  const now = Date.now();
  const lowerId = identifier.trim().toLowerCase();

  // Record for identifier
  const idBucket = failedLoginsByIdentifier.get(lowerId);
  if (!idBucket || now > idBucket.resetAt) {
    failedLoginsByIdentifier.set(lowerId, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    idBucket.count += 1;
  }
  enforceMapCapacity(failedLoginsByIdentifier);

  // Record for IP
  const ipBucket = failedLoginsByIp.get(ip);
  if (!ipBucket || now > ipBucket.resetAt) {
    failedLoginsByIp.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    ipBucket.count += 1;
  }
  enforceMapCapacity(failedLoginsByIp);
}

export function recordSuccessfulLogin(ip: string, identifier: string): void {
  const lowerId = identifier.trim().toLowerCase();
  failedLoginsByIdentifier.delete(lowerId);
  // Do not fully clear IP bucket to prevent slow cycling through different accounts,
  // but decrement to avoid punishing legitimate user logins.
  const ipBucket = failedLoginsByIp.get(ip);
  if (ipBucket && ipBucket.count > 0) {
    ipBucket.count = Math.max(0, ipBucket.count - 1);
  }
}

export function checkGuestRateLimit(ip: string): { allowed: boolean; retryAfterSeconds?: number; reason?: string } {
  cleanExpiredEntries();
  const now = Date.now();
  const ipBucket = guestCreationsByIp.get(ip);

  if (ipBucket && now <= ipBucket.resetAt && ipBucket.count >= MAX_GUEST_CREATIONS_PER_IP) {
    const retryAfterSeconds = Math.max(1, Math.ceil((ipBucket.resetAt - now) / 1000));
    return {
      allowed: false,
      retryAfterSeconds,
      reason: `Too many guest sessions created from this IP address. Please wait ${retryAfterSeconds} seconds before creating another guest.`
    };
  }

  return { allowed: true };
}

export function recordGuestCreation(ip: string): void {
  const now = Date.now();
  const ipBucket = guestCreationsByIp.get(ip);

  if (!ipBucket || now > ipBucket.resetAt) {
    guestCreationsByIp.set(ip, { count: 1, resetAt: now + GUEST_WINDOW_MS });
  } else {
    ipBucket.count += 1;
  }
  enforceMapCapacity(guestCreationsByIp);
}

export function resetAllAuthRateLimits(): void {
  failedLoginsByIdentifier.clear();
  failedLoginsByIp.clear();
  guestCreationsByIp.clear();
}
