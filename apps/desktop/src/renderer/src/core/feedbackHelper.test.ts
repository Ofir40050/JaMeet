import { describe, expect, it } from 'vitest';
import { buildFeedbackUrl } from './feedbackHelper';

describe('buildFeedbackUrl', () => {
  it('generates GitHub issue URL with diagnostics template by default', () => {
    const url = buildFeedbackUrl({
      appVersion: '0.1.0',
      platform: 'darwin',
      arch: 'arm64'
    });

    expect(url).toContain('https://github.com/Ofir40050/JaMeet/issues/new');
    expect(url).toContain('body=');
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('- **App Version:** `0.1.0`');
    expect(decoded).toContain('- **Platform:** `darwin (arm64)`');
  });

  it('generates mailto link with encoded subject and body when baseUrl is mailto:', () => {
    const url = buildFeedbackUrl({
      baseUrl: 'mailto:support@jameet.com',
      appVersion: '0.2.0',
      platform: 'win32',
      arch: 'x64'
    });

    expect(url.startsWith('mailto:support@jameet.com?')).toBe(true);
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('[JaMeet Beta Feedback] v0.2.0 (win32)');
    expect(decoded).toContain('App Version: 0.2.0');
    expect(decoded).toContain('Platform: win32 (x64)');
  });
});
