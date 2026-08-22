import { createHmac } from 'node:crypto';
import type { IceServerConfig } from '@jameet/shared';
import type { ServerConfig } from '../core/config.js';
import { logger } from '../core/logger.js';

export const SAFE_DEFAULT_STUN_SERVERS: IceServerConfig[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' }
];

export function createSelfHostedIceServers(
  config: ServerConfig,
  participantId: string,
  now = Date.now()
): IceServerConfig[] {
  const expires = Math.floor(now / 1000) + config.TURN_CREDENTIAL_TTL_SECONDS;
  const username = `${expires}:${participantId}`;
  const credential = createHmac('sha1', config.TURN_SHARED_SECRET).update(username).digest('base64');
  const servers: IceServerConfig[] = [
    { urls: `stun:${config.TURN_HOST}:${config.TURN_PORT}` },
    {
      urls: [
        `turn:${config.TURN_HOST}:${config.TURN_PORT}?transport=udp`,
        `turn:${config.TURN_HOST}:${config.TURN_PORT}?transport=tcp`
      ],
      username,
      credential
    }
  ];
  if (config.TURN_TLS_ENABLED) {
    servers.push({ urls: `turns:${config.TURN_HOST}:${config.TURN_TLS_PORT}?transport=tcp`, username, credential });
  }
  return servers;
}

export function createIceServers(config: ServerConfig, participantId: string, now = Date.now()): IceServerConfig[] {
  return createSelfHostedIceServers(config, participantId, now);
}

export function parseCloudflareIceServers(raw: unknown): IceServerConfig[] {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    const results: IceServerConfig[] = [];
    for (const item of raw) {
      if (item && typeof item === 'object') {
        const itemObj = item as Record<string, unknown>;
        const urls = itemObj.urls || itemObj.url;
        if (urls) {
          results.push({
            urls: Array.isArray(urls) ? (urls as unknown[]).map(String) : String(urls),
            username: itemObj.username ? String(itemObj.username) : undefined,
            credential: itemObj.credential ? String(itemObj.credential) : undefined
          });
        }
      }
    }
    return results;
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const urls = obj.urls || obj.url;
    if (urls) {
      return [{
        urls: Array.isArray(urls) ? (urls as unknown[]).map(String) : String(urls),
        username: obj.username ? String(obj.username) : undefined,
        credential: obj.credential ? String(obj.credential) : undefined
      }];
    }
  }

  return [];
}

export async function generateCloudflareIceServers(
  config: ServerConfig,
  fetchFn: typeof fetch = fetch
): Promise<IceServerConfig[]> {
  if (!config.CLOUDFLARE_TURN_KEY_ID || !config.CLOUDFLARE_TURN_API_TOKEN) {
    logger.error('cloudflare_turn_missing_config', 'Cloudflare TURN credentials missing in server configuration');
    return SAFE_DEFAULT_STUN_SERVERS;
  }

  const endpoint = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(config.CLOUDFLARE_TURN_KEY_ID)}/credentials/generate-ice-servers`;
  const ttl = Math.min(Math.max(config.TURN_CREDENTIAL_TTL_SECONDS, 60), 172800);

  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.CLOUDFLARE_TURN_API_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'JaMeet-Server'
      },
      body: JSON.stringify({ ttl }),
      signal: AbortSignal.timeout(5000)
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      logger.error('cloudflare_turn_request_failed', 'Cloudflare TURN API returned non-OK status', {
        status: res.status,
        statusText: res.statusText,
        errorSnippet: errorText ? errorText.slice(0, 200) : undefined
      });
      return SAFE_DEFAULT_STUN_SERVERS;
    }

    const data = await res.json() as Record<string, unknown>;
    const resultObj = (data?.result && typeof data.result === 'object') ? data.result as Record<string, unknown> : undefined;
    const rawServers = data?.iceServers ?? resultObj?.iceServers ?? data?.result ?? data;

    const parsedServers = parseCloudflareIceServers(rawServers);
    if (parsedServers.length > 0) {
      return parsedServers;
    }

    logger.error('cloudflare_turn_invalid_response', 'Cloudflare TURN API returned no recognizable iceServers structure');
    return SAFE_DEFAULT_STUN_SERVERS;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('cloudflare_turn_fetch_error', 'Failed to generate Cloudflare ICE credentials', {
      error: errorMsg
    });
    return SAFE_DEFAULT_STUN_SERVERS;
  }
}

export async function getIceServers(
  config: ServerConfig,
  participantId: string,
  now = Date.now(),
  fetchFn: typeof fetch = fetch
): Promise<IceServerConfig[]> {
  if (config.TURN_PROVIDER === 'cloudflare') {
    return generateCloudflareIceServers(config, fetchFn);
  }
  return createSelfHostedIceServers(config, participantId, now);
}
