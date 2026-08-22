import { describe, expect, it } from 'vitest';
import { compareSemver, checkVersionStatus } from './version.js';

describe('Shared Version Logic & Semver Comparison', () => {
  it('correctly compares standard semver versions', () => {
    expect(compareSemver('0.1.0', '0.1.0')).toBe(0);
    expect(compareSemver('0.1.0', '0.2.0')).toBe(-1);
    expect(compareSemver('0.2.0', '0.1.0')).toBe(1);
    expect(compareSemver('1.0.0', '0.9.9')).toBe(1);
    expect(compareSemver('0.1.1', '0.1.0')).toBe(1);
    expect(compareSemver('v0.1.0', '0.1.0')).toBe(0);
    expect(compareSemver('v1.2.3', 'v1.2.4')).toBe(-1);
  });

  it('correctly compares prerelease versions', () => {
    expect(compareSemver('0.2.0-beta.1', '0.2.0')).toBe(-1);
    expect(compareSemver('0.2.0', '0.2.0-beta.1')).toBe(1);
    expect(compareSemver('0.2.0-beta.1', '0.2.0-beta.2')).toBe(-1);
  });

  it('identifies up_to_date status when current version meets or exceeds latest', () => {
    const res = checkVersionStatus({
      currentVersion: '0.1.0',
      latestVersion: '0.1.0',
      minSupportedVersion: '0.1.0'
    });

    expect(res.status).toBe('up_to_date');
    expect(res.isOutdated).toBe(false);
    expect(res.isUnsupported).toBe(false);
  });

  it('identifies update_available status when current version is below latest but at or above minimum supported', () => {
    const res = checkVersionStatus({
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
      minSupportedVersion: '0.1.0',
      downloadUrl: 'https://github.com/Ofir40050/JaMeet/releases'
    });

    expect(res.status).toBe('update_available');
    expect(res.isOutdated).toBe(true);
    expect(res.isUnsupported).toBe(false);
    expect(res.downloadUrl).toBe('https://github.com/Ofir40050/JaMeet/releases');
  });

  it('identifies unsupported_outdated status when current version is below minimum supported', () => {
    const res = checkVersionStatus({
      currentVersion: '0.1.0',
      latestVersion: '0.3.0',
      minSupportedVersion: '0.2.0',
      downloadUrl: 'https://github.com/Ofir40050/JaMeet/releases/tag/v0.3.0'
    });

    expect(res.status).toBe('unsupported_outdated');
    expect(res.isOutdated).toBe(true);
    expect(res.isUnsupported).toBe(true);
  });
});
