import { describe, expect, it, beforeEach } from 'vitest';
import {
  checkLoginRateLimit,
  recordFailedLogin,
  recordSuccessfulLogin,
  checkGuestRateLimit,
  recordGuestCreation,
  resetAllAuthRateLimits,
  MAX_FAILED_LOGINS_PER_IDENTIFIER,
  MAX_FAILED_LOGINS_PER_IP,
  MAX_GUEST_CREATIONS_PER_IP
} from './auth-rate-limit.js';

describe('auth-rate-limit', () => {
  beforeEach(() => {
    resetAllAuthRateLimits();
  });

  describe('Login Rate Limiting (Brute Force Protection)', () => {
    it('allows initial login attempts', () => {
      const result = checkLoginRateLimit('192.168.1.1', 'musician_user');
      expect(result.allowed).toBe(true);
    });

    it('blocks identifier after 5 consecutive failed attempts', () => {
      const ip = '192.168.1.1';
      const user = 'targeted_user';

      for (let i = 0; i < MAX_FAILED_LOGINS_PER_IDENTIFIER; i++) {
        expect(checkLoginRateLimit(ip, user).allowed).toBe(true);
        recordFailedLogin(ip, user);
      }

      const blockedResult = checkLoginRateLimit(ip, user);
      expect(blockedResult.allowed).toBe(false);
      expect(blockedResult.reason).toContain('Too many failed login attempts for this account');
      expect(blockedResult.retryAfterSeconds).toBeGreaterThan(0);

      // Other identifiers from same IP are still allowed (until IP limit)
      expect(checkLoginRateLimit(ip, 'other_user').allowed).toBe(true);
    });

    it('blocks IP after 20 failed attempts across different identifiers', () => {
      const ip = '203.0.113.55';

      for (let i = 0; i < MAX_FAILED_LOGINS_PER_IP; i++) {
        recordFailedLogin(ip, `user_${i}`);
      }

      const blockedResult = checkLoginRateLimit(ip, 'any_user');
      expect(blockedResult.allowed).toBe(false);
      expect(blockedResult.reason).toContain('Too many failed login attempts from this IP address');
    });

    it('clears failed count on successful login', () => {
      const ip = '192.168.1.2';
      const user = 'legit_user';

      // 3 failed logins
      recordFailedLogin(ip, user);
      recordFailedLogin(ip, user);
      recordFailedLogin(ip, user);

      // Successful login
      recordSuccessfulLogin(ip, user);

      // Should have clean slate
      expect(checkLoginRateLimit(ip, user).allowed).toBe(true);
    });
  });

  describe('Guest Rate Limiting', () => {
    it('allows guest creations up to limit and blocks subsequent ones', () => {
      const ip = '198.51.100.22';

      for (let i = 0; i < MAX_GUEST_CREATIONS_PER_IP; i++) {
        expect(checkGuestRateLimit(ip).allowed).toBe(true);
        recordGuestCreation(ip);
      }

      const blocked = checkGuestRateLimit(ip);
      expect(blocked.allowed).toBe(false);
      expect(blocked.reason).toContain('Too many guest sessions created from this IP address');
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    });
  });
});
