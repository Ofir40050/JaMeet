import { describe, expect, it } from 'vitest';
import { cleanIp, getClientIp } from './client-ip.js';

describe('Render client IP extraction & anti-spoofing', () => {
  describe('cleanIp', () => {
    it('normalizes standard IPv4 and IPv6 addresses', () => {
      expect(cleanIp('192.0.2.1')).toBe('192.0.2.1');
      expect(cleanIp('2001:db8::1')).toBe('2001:db8::1');
    });

    it('strips IPv6-mapped IPv4 prefixes', () => {
      expect(cleanIp('::ffff:192.0.2.1')).toBe('192.0.2.1');
      expect(cleanIp('::ffff:203.0.113.195')).toBe('203.0.113.195');
    });

    it('strips port from IPv4 formatted with port', () => {
      expect(cleanIp('192.0.2.1:8080')).toBe('192.0.2.1');
      expect(cleanIp('203.0.113.50:443')).toBe('203.0.113.50');
    });

    it('strips brackets and port from bracketed IPv6', () => {
      expect(cleanIp('[2001:db8::1]:8080')).toBe('2001:db8::1');
      expect(cleanIp('[2001:db8::1]')).toBe('2001:db8::1');
    });

    it('returns null for invalid inputs', () => {
      expect(cleanIp('')).toBeNull();
      expect(cleanIp(null)).toBeNull();
      expect(cleanIp(undefined)).toBeNull();
      expect(cleanIp('not-an-ip')).toBeNull();
      expect(cleanIp('999.999.999.999')).toBeNull();
    });
  });

  describe('getClientIp', () => {
    it('extracts real client IP from single-hop X-Forwarded-For on Render', () => {
      const request = {
        headers: {
          'x-forwarded-for': '203.0.113.195'
        },
        socket: { remoteAddress: '10.0.1.5' },
        ip: '10.0.1.5'
      };
      expect(getClientIp(request)).toBe('203.0.113.195');
    });

    it('extracts real client IP as the first address in X-Forwarded-For on Render proxy chain', () => {
      const request = {
        headers: {
          'x-forwarded-for': '203.0.113.195, 10.0.1.5, 10.0.2.8'
        },
        socket: { remoteAddress: '10.0.1.5' },
        ip: '10.0.1.5'
      };
      // Render places the real client IP as the first address
      expect(getClientIp(request)).toBe('203.0.113.195');
    });

    it('handles array header values for X-Forwarded-For', () => {
      const request = {
        headers: {
          'x-forwarded-for': ['198.51.100.42', '10.0.1.5']
        },
        socket: { remoteAddress: '10.0.1.5' }
      };
      expect(getClientIp(request)).toBe('198.51.100.42');
    });

    it('extracts IPv6 addresses as the first address on Render', () => {
      const request = {
        headers: {
          'x-forwarded-for': '2001:db8:85a3::8a2e:370:7334, 10.0.1.5'
        },
        socket: { remoteAddress: '10.0.1.5' }
      };
      expect(getClientIp(request)).toBe('2001:db8:85a3::8a2e:370:7334');
    });

    it('skips invalid first entry if malformed and finds next valid IP', () => {
      const request = {
        headers: {
          'x-forwarded-for': 'invalid-entry, 203.0.113.55, 10.0.1.5'
        },
        socket: { remoteAddress: '10.0.1.5' }
      };
      expect(getClientIp(request)).toBe('203.0.113.55');
    });

    it('falls back to socket remoteAddress when X-Forwarded-For is missing', () => {
      const request = {
        headers: {},
        socket: { remoteAddress: '198.51.100.99' }
      };
      expect(getClientIp(request)).toBe('198.51.100.99');
    });

    it('falls back to socket remoteAddress when X-Forwarded-For contains only invalid IPs', () => {
      const request = {
        headers: {
          'x-forwarded-for': 'malformed-junk, also-bad'
        },
        socket: { remoteAddress: '198.51.100.99' }
      };
      expect(getClientIp(request)).toBe('198.51.100.99');
    });

    it('falls back to 127.0.0.1 when no valid IP can be determined', () => {
      const request = {
        headers: {},
        socket: null
      };
      expect(getClientIp(request)).toBe('127.0.0.1');
    });

    it('does not blindly trust unverified single headers like cf-connecting-ip or x-real-ip without proxy validation', () => {
      const request = {
        headers: {
          'cf-connecting-ip': '8.8.8.8',
          'x-real-ip': '9.9.9.9'
        },
        socket: { remoteAddress: '198.51.100.77' }
      };
      // Direct connection with fake cf-connecting-ip -> socket address is authoritative
      expect(getClientIp(request)).toBe('198.51.100.77');
    });
  });
});
