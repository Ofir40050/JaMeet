import { createHmac } from 'node:crypto';
import type { IceServerConfig } from '@jameet/shared';
import type { ServerConfig } from '../core/config.js';

export function createIceServers(config: ServerConfig, participantId: string, now = Date.now()): IceServerConfig[] {
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
