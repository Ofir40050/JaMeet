import { isIP } from 'node:net';

export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string } | null;
  ip?: string;
}

/**
 * Normalizes an IP string by stripping IPv6-mapped IPv4 prefixes,
 * bracket notation, and port numbers.
 */
export function cleanIp(ipStr: string | undefined | null): string | null {
  if (!ipStr || typeof ipStr !== 'string') return null;
  let ip = ipStr.trim();
  if (!ip) return null;

  // Strip IPv6-mapped IPv4 prefix (e.g. ::ffff:192.168.1.1 -> 192.168.1.1)
  if (ip.startsWith('::ffff:')) {
    const sub = ip.slice(7);
    if (isIP(sub) === 4) {
      return sub;
    }
  }

  // Strip port from IPv4 if formatted as IP:port (e.g. 192.0.2.1:12345)
  if (/^(\d{1,3}\.){3}\d{1,3}:\d+$/.test(ip)) {
    const withoutPort = ip.split(':')[0];
    if (withoutPort && isIP(withoutPort) === 4) {
      return withoutPort;
    }
  }

  // Strip brackets and optional port from IPv6 (e.g. [2001:db8::1]:8080 -> 2001:db8::1)
  if (ip.startsWith('[') && ip.includes(']')) {
    const match = ip.match(/^\[([a-fA-F0-9:]+)\](?::\d+)?$/);
    if (match && match[1] && isIP(match[1]) === 6) {
      return match[1];
    }
  }

  if (isIP(ip)) {
    return ip;
  }

  return null;
}

/**
 * Extracts the authoritative client IP address for requests behind the Render reverse proxy.
 *
 * Render's reverse proxy places the real client IP as the first (leftmost) address
 * in the `X-Forwarded-For` header chain.
 *
 * - We extract the first valid IP from `X-Forwarded-For`.
 * - Other unverified headers (e.g., `CF-Connecting-IP`, `X-Real-IP`) are not trusted blindly.
 * - If `X-Forwarded-For` is missing or contains no valid IP, falls back to direct
 *   TCP connection remote address (`request.socket.remoteAddress` or `request.ip`).
 */
export function getClientIp(request: RequestLike): string {
  const xff = request.headers['x-forwarded-for'];
  if (xff) {
    const rawHeader = Array.isArray(xff) ? xff.join(',') : xff;
    if (typeof rawHeader === 'string') {
      const parts = rawHeader.split(',').map((p) => p.trim()).filter(Boolean);
      // On Render, the real client IP is the first (leftmost) address in X-Forwarded-For
      for (const part of parts) {
        const cleaned = cleanIp(part);
        if (cleaned) {
          return cleaned;
        }
      }
    }
  }

  // Fallback to direct TCP connection remote address or request.ip
  const rawRemote = request.socket?.remoteAddress || request.ip;
  if (rawRemote) {
    const cleaned = cleanIp(rawRemote);
    if (cleaned) {
      return cleaned;
    }
  }

  return '127.0.0.1';
}
