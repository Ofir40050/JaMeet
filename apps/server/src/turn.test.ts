import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { createIceServers } from './turn.js';

describe('TURN credentials', () => {
  it('creates expiring HMAC credentials and UDP/TCP routes', () => {
    const config = loadConfig({ TURN_HOST: 'turn.test', TURN_SHARED_SECRET: 'a-secure-test-secret', TURN_CREDENTIAL_TTL_SECONDS: '600' });
    const servers = createIceServers(config, 'participant', 1_000_000);
    const turn = servers[1]!;
    expect(turn.username).toBe('1600:participant');
    expect(turn.credential).toBe(createHmac('sha1', config.TURN_SHARED_SECRET).update('1600:participant').digest('base64'));
    expect(turn.urls).toEqual(['turn:turn.test:3478?transport=udp', 'turn:turn.test:3478?transport=tcp']);
  });
});
