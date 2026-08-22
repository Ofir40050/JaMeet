import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '../core/config.js';
import type { AppVersionInfo } from '@jameet/shared';

export function registerVersionRoutes(app: FastifyInstance, config: ServerConfig): void {
  app.get<{ Reply: AppVersionInfo }>('/api/version', async () => {
    return {
      ok: true,
      latestVersion: config.LATEST_APP_VERSION,
      minSupportedVersion: config.MIN_SUPPORTED_APP_VERSION,
      downloadUrl: config.APP_DOWNLOAD_URL,
      feedbackUrl: config.FEEDBACK_URL
    };
  });
}
