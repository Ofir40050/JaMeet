import { describe, expect, it } from 'vitest';
import { cleanIp, getClientIp } from './client-ip.js';

describe('client IP extraction & reverse proxy spoofing protection', () => {
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
    it('extracts real client IP from single-hop X-Forwarded-For behind proxy', () => {
      const request = {
        headers: {
          'x-forwarded-for': '203.0.113.195'
        },
        socket: { remoteAddress: '10.0.1.5' },
        ip: '10.0.1.5'
      };
      expect(getClientIp(request)).toBe('203.0.113.195');
    });

    it('prevents IP spoofing by taking the rightmost proxy-appended IP when client prepends fake headers', () => {
      const request = {
        headers: {
          'x-forwarded-for': '1.2.3.4, 203.0.113.195'
        },
        socket: { remoteAddress: '10.0.1.5' },
        ip: '10.0.1.5'
      };
      // 1.2.3.4 is the spoofed client header; 203.0.113.195 is the actual connecting IP appended by the proxy
      expect(getClientIp(request)).toBe('203.0.113.195');
    });

    it('handles multi-hop spoofing chains and picks the authoritative proxy-appended IP', () => {
      const request = {
        headers: {
          'x-forwarded-for': '10.0.0.1, 192.168.1.1, 8.8.8.8, 198.51.100.42'
        },
        socket: { remoteAddress: '10.0.1.5' }
      };
      expect(getClientIp(request)).toBe('198.51.100.42');
    });

    it('handles array header values for X-Forwarded-For', () => {
      const request = {
        headers: {
          'x-forwarded-for': ['1.1.1.1', '198.51.100.42']
        },
        socket: { remoteAddress: '10.0.1.5' }
      };
      expect(getClientIp(request)).toBe('198.51.100.42');
    });

    it('extracts IPv6 addresses behind reverse proxy', () => {
      const request = {
        headers: {
          'x-forwarded-for': '1.2.3.4, 2001:db8:85a3::8a2e:370:7334'
        },
        socket: { remoteAddress: '10.0.1.5' }
      };
      expect(getClientIp(request)).toBe('2001:db8:85a3::8a2e:370:7334');
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

    it('does not blindly trust unverified single headers like cf-connecting-ip without proxy validation', () => {
      const request = {
        headers: {
          'cf-connecting-ip': '8.8.8.8'
        },
        socket: { remoteAddress: '198.51.100.77' }
      };
      // Direct connection with fake cf-connecting-ip -> socket address is authoritative
      expect(getClientIp(request)).toBe('198.51.100.77');
    });
  });
});
