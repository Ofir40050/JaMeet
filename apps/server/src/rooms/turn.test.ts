import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../core/config.js';
import {
  createIceServers,
  createSelfHostedIceServers,
  generateCloudflareIceServers,
  getIceServers,
  SAFE_DEFAULT_STUN_SERVERS
} from './turn.js';

describe('TURN credentials', () => {
  it('creates expiring HMAC credentials and UDP/TCP routes for self_hosted provider', () => {
    const config = loadConfig({
      TURN_PROVIDER: 'self_hosted',
      TURN_HOST: 'turn.test',
      TURN_SHARED_SECRET: 'a-secure-test-secret',
      TURN_CREDENTIAL_TTL_SECONDS: '600'
    });
    const servers = createSelfHostedIceServers(config, 'participant', 1_000_000);
    const turn = servers[1]!;
    expect(turn.username).toBe('1600:participant');
    expect(turn.credential).toBe(createHmac('sha1', config.TURN_SHARED_SECRET).update('1600:participant').digest('base64'));
    expect(turn.urls).toEqual(['turn:turn.test:3478?transport=udp', 'turn:turn.test:3478?transport=tcp']);
  });

  it('createIceServers maintains backward compatibility', () => {
    const config = loadConfig({
      TURN_PROVIDER: 'self_hosted',
      TURN_HOST: 'turn.test',
      TURN_SHARED_SECRET: 'a-secure-test-secret',
      TURN_CREDENTIAL_TTL_SECONDS: '600'
    });
    const servers = createIceServers(config, 'participant', 1_000_000);
    expect(servers.length).toBeGreaterThanOrEqual(2);
    expect(servers[0]?.urls).toBe('stun:turn.test:3478');
  });

  it('generates Cloudflare ICE servers when provider is cloudflare', async () => {
    const config = loadConfig({
      TURN_PROVIDER: 'cloudflare',
      CLOUDFLARE_TURN_KEY_ID: 'test-key-id-123',
      CLOUDFLARE_TURN_API_TOKEN: 'test-token-xyz',
      TURN_CREDENTIAL_TTL_SECONDS: '7200'
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        iceServers: {
          urls: [
            'stun:stun.cloudflare.com:3478',
            'turn:turn.cloudflare.com:3478?transport=udp',
            'turn:turn.cloudflare.com:3478?transport=tcp',
            'turns:turn.cloudflare.com:5349?transport=tcp'
          ],
          username: 'cf-user-abc',
          credential: 'cf-credential-def'
        }
      })
    });

    const servers = await getIceServers(config, 'p-123', Date.now(), mockFetch as unknown as typeof fetch);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://rtc.live.cloudflare.com/v1/turn/keys/test-key-id-123/credentials/generate-ice-servers',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token-xyz',
          'Content-Type': 'application/json',
          'User-Agent': 'JaMeet-Server'
        },
        body: JSON.stringify({ ttl: 7200 })
      })
    );

    expect(servers).toEqual([
      {
        urls: [
          'stun:stun.cloudflare.com:3478',
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turn:turn.cloudflare.com:3478?transport=tcp',
          'turns:turn.cloudflare.com:5349?transport=tcp'
        ],
        username: 'cf-user-abc',
        credential: 'cf-credential-def'
      }
    ]);
  });

  it('handles array-based iceServers format from Cloudflare API', async () => {
    const config = loadConfig({
      TURN_PROVIDER: 'cloudflare',
      CLOUDFLARE_TURN_KEY_ID: 'test-key-456',
      CLOUDFLARE_TURN_API_TOKEN: 'test-token-789'
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          iceServers: [
            { urls: 'stun:stun.cloudflare.com:3478' },
            {
              urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
              username: 'cf-u',
              credential: 'cf-p'
            }
          ]
        }
      })
    });

    const servers = await generateCloudflareIceServers(config, mockFetch as unknown as typeof fetch);
    expect(servers.length).toBe(2);
    expect(servers[0]?.urls).toBe('stun:stun.cloudflare.com:3478');
    expect(servers[1]?.username).toBe('cf-u');
  });

  it('falls back to safe STUN servers on Cloudflare HTTP failure without returning invalid TURN credentials', async () => {
    const config = loadConfig({
      TURN_PROVIDER: 'cloudflare',
      CLOUDFLARE_TURN_KEY_ID: 'test-key-id',
      CLOUDFLARE_TURN_API_TOKEN: 'test-token'
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid API token'
    });

    const servers = await generateCloudflareIceServers(config, mockFetch as unknown as typeof fetch);
    expect(servers).toEqual(SAFE_DEFAULT_STUN_SERVERS);
    for (const server of servers) {
      expect(server.credential).toBeUndefined();
    }
  });

  it('falls back to safe STUN servers on fetch exception', async () => {
    const config = loadConfig({
      TURN_PROVIDER: 'cloudflare',
      CLOUDFLARE_TURN_KEY_ID: 'test-key-id',
      CLOUDFLARE_TURN_API_TOKEN: 'test-token'
    });

    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error / DNS resolution failed'));
    const servers = await generateCloudflareIceServers(config, mockFetch as unknown as typeof fetch);
    expect(servers).toEqual(SAFE_DEFAULT_STUN_SERVERS);
  });

  it('defaults TURN_CREDENTIAL_TTL_SECONDS to 28800', () => {
    const config = loadConfig();
    expect(config.TURN_CREDENTIAL_TTL_SECONDS).toBe(28800);
  });

  it('rejects TURN_CREDENTIAL_TTL_SECONDS values above Cloudflare maximum of 172800', () => {
    expect(() => {
      loadConfig({
        TURN_CREDENTIAL_TTL_SECONDS: '172801'
      });
    }).toThrow();
  });

  it('enforces Cloudflare credentials in production when TURN_PROVIDER is cloudflare', () => {
    expect(() => {
      loadConfig({
        NODE_ENV: 'production',
        TURN_PROVIDER: 'cloudflare',
        CLOUDFLARE_TURN_KEY_ID: '',
        CLOUDFLARE_TURN_API_TOKEN: ''
      });
    }).toThrow('CLOUDFLARE_TURN_KEY_ID is required');

    expect(() => {
      loadConfig({
        NODE_ENV: 'production',
        TURN_PROVIDER: 'cloudflare',
        CLOUDFLARE_TURN_KEY_ID: 'my-key',
        CLOUDFLARE_TURN_API_TOKEN: ''
      });
    }).toThrow('CLOUDFLARE_TURN_API_TOKEN is required');

    const validProd = loadConfig({
      NODE_ENV: 'production',
      TURN_PROVIDER: 'cloudflare',
      CLOUDFLARE_TURN_KEY_ID: 'my-key',
      CLOUDFLARE_TURN_API_TOKEN: 'my-token',
      CLOUDFLARE_ACCOUNT_ID: 'my-acc',
      CLOUDFLARE_TURN_ANALYTICS_API_TOKEN: 'my-analytics-token'
    });
    expect(validProd.TURN_PROVIDER).toBe('cloudflare');
  });

  it('enforces public TURN_HOST in production when TURN_PROVIDER is self_hosted', () => {
    expect(() => {
      loadConfig({
        NODE_ENV: 'production',
        TURN_PROVIDER: 'self_hosted',
        TURN_SHARED_SECRET: 'production-secret-1234567890',
        TURN_HOST: 'localhost'
      });
    }).toThrow('TURN_HOST must be configured with a valid public hostname or IP');
  });
});
