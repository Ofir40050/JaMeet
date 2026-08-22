import { describe, expect, it, afterEach } from 'vitest';
import { createApp } from '../app.js';
import { loadConfig } from '../core/config.js';

describe('Server Version Awareness Endpoint', () => {
  let appInstance: any;

  afterEach(async () => {
    if (appInstance?.app) {
      await appInstance.app.close();
    }
  });

  it('exposes current latest and minimum supported app versions via /api/version', async () => {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      LATEST_APP_VERSION: '0.2.0',
      MIN_SUPPORTED_APP_VERSION: '0.1.5',
      APP_DOWNLOAD_URL: 'https://github.com/Ofir40050/JaMeet/releases/tag/v0.2.0',
      FEEDBACK_URL: 'https://github.com/Ofir40050/JaMeet/issues/new'
    });

    appInstance = await createApp(config);
    const res = await appInstance.app.inject({
      method: 'GET',
      url: '/api/version'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.latestVersion).toBe('0.2.0');
    expect(body.minSupportedVersion).toBe('0.1.5');
    expect(body.downloadUrl).toBe('https://github.com/Ofir40050/JaMeet/releases/tag/v0.2.0');
    expect(body.feedbackUrl).toBe('https://github.com/Ofir40050/JaMeet/issues/new');
  });
});
