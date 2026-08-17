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
    it('uses authoritative CF-Connecting-IP for public Render traffic', () => {
      const request = {
        headers: {
          'cf-connecting-ip': '203.0.113.195',
          'x-forwarded-for': '10.0.1.5'
        },
        socket: { remoteAddress: '10.0.1.5' },
        ip: '10.0.1.5'
      };
      expect(getClientIp(request)).toBe('203.0.113.195');
    });

    it('prioritizes CF-Connecting-IP over spoofable client-supplied X-Forwarded-For', () => {
      const request = {
        headers: {
          'cf-connecting-ip': '203.0.113.195',
          'x-forwarded-for': '1.2.3.4, 5.6.7.8'
        },
        socket: { remoteAddress: '10.0.1.5' },
        ip: '10.0.1.5'
      };
      // CF-Connecting-IP is the authoritative edge header
      expect(getClientIp(request)).toBe('203.0.113.195');
    });

    it('handles IPv6 in CF-Connecting-IP', () => {
      const request = {
        headers: {
          'cf-connecting-ip': '2001:db8:85a3::8a2e:370:7334'
        },
        socket: { remoteAddress: '10.0.1.5' }
      };
      expect(getClientIp(request)).toBe('2001:db8:85a3::8a2e:370:7334');
    });

    it('handles array header value for CF-Connecting-IP', () => {
      const request = {
        headers: {
          'cf-connecting-ip': ['198.51.100.42']
        },
        socket: { remoteAddress: '10.0.1.5' }
      };
      expect(getClientIp(request)).toBe('198.51.100.42');
    });

    it('falls back to X-Forwarded-For when CF-Connecting-IP is missing', () => {
      const request = {
        headers: {
          'x-forwarded-for': '203.0.113.55, 10.0.1.5'
        },
        socket: { remoteAddress: '10.0.1.5' }
      };
      expect(getClientIp(request)).toBe('203.0.113.55');
    });

    it('falls back to socket remoteAddress when both CF-Connecting-IP and X-Forwarded-For are missing', () => {
      const request = {
        headers: {},
        socket: { remoteAddress: '198.51.100.99' }
      };
      expect(getClientIp(request)).toBe('198.51.100.99');
    });

    it('falls back to socket remoteAddress when proxy headers contain only invalid values', () => {
      const request = {
        headers: {
          'cf-connecting-ip': 'invalid-ip',
          'x-forwarded-for': 'also-bad'
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
  });
});
