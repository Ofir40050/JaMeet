import type { FastifyRequest } from 'fastify';

export function extractClientInfo(
  req: FastifyRequest | { headers: Record<string, string | string[] | undefined> }
): { version?: string; platform?: string } {
  const h = req.headers;
  let version = typeof h['x-client-version'] === 'string' ? h['x-client-version'].trim() : undefined;
  let platform = typeof h['x-client-platform'] === 'string' ? h['x-client-platform'].trim() : undefined;
  const ua = typeof h['user-agent'] === 'string' ? h['user-agent'] : '';

  if (platform) {
    if (platform !== 'macOS' && platform !== 'Windows') {
      platform = 'Unknown';
    }
  } else if (ua) {
    if (ua.includes('Mac') || ua.includes('Darwin')) platform = 'macOS';
    else if (ua.includes('Win')) platform = 'Windows';
    else platform = 'Unknown';
  } else {
    platform = 'Unknown';
  }

  if (!version || version === '') {
    version = 'Unknown';
  }

  return { version, platform };
}
