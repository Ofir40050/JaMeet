import { z } from 'zod';

export interface AppVersionInfo {
  ok: boolean;
  latestVersion: string;
  minSupportedVersion: string;
  downloadUrl: string;
  feedbackUrl?: string;
}

export const appVersionInfoSchema = z.object({
  ok: z.boolean(),
  latestVersion: z.string().min(1).max(64),
  minSupportedVersion: z.string().min(1).max(64),
  downloadUrl: z.string().url().max(2048),
  feedbackUrl: z.string().url().max(2048).optional()
});

export type VersionCheckStatus = 'up_to_date' | 'update_available' | 'unsupported_outdated';

export interface VersionCheckResult {
  status: VersionCheckStatus;
  currentVersion: string;
  latestVersion: string;
  minSupportedVersion: string;
  downloadUrl: string;
  isOutdated: boolean;
  isUnsupported: boolean;
}

/**
 * Compare two semver strings (e.g. "0.1.0", "v0.2.0", "0.2.0-beta.1").
 * Returns:
 *   1 if v1 > v2
 *  -1 if v1 < v2
 *   0 if v1 == v2
 */
export function compareSemver(v1: string, v2: string): number {
  const clean1 = (v1 || '').replace(/^v/i, '').trim();
  const clean2 = (v2 || '').replace(/^v/i, '').trim();

  if (!clean1 && !clean2) return 0;
  if (!clean1) return -1;
  if (!clean2) return 1;

  const [main1 = '', pre1] = clean1.split('-');
  const [main2 = '', pre2] = clean2.split('-');

  const parts1 = main1.split('.').map((p) => parseInt(p, 10) || 0);
  const parts2 = main2.split('.').map((p) => parseInt(p, 10) || 0);

  const len = Math.max(parts1.length, parts2.length, 3);
  for (let i = 0; i < len; i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }

  // Pre-release versions have lower precedence than the associated normal version
  if (pre1 && !pre2) return -1;
  if (!pre1 && pre2) return 1;
  if (pre1 && pre2) {
    return pre1.localeCompare(pre2);
  }

  return 0;
}

export function checkVersionStatus(params: {
  currentVersion: string;
  latestVersion: string;
  minSupportedVersion: string;
  downloadUrl?: string;
}): VersionCheckResult {
  const current = params.currentVersion || '0.1.0';
  const latest = params.latestVersion || current;
  const minSupported = params.minSupportedVersion || current;
  const downloadUrl = params.downloadUrl || 'https://github.com/Ofir40050/JaMeet/releases';

  const isBelowMin = compareSemver(current, minSupported) < 0;
  if (isBelowMin) {
    return {
      status: 'unsupported_outdated',
      currentVersion: current,
      latestVersion: latest,
      minSupportedVersion: minSupported,
      downloadUrl,
      isOutdated: true,
      isUnsupported: true
    };
  }

  const isBelowLatest = compareSemver(current, latest) < 0;
  if (isBelowLatest) {
    return {
      status: 'update_available',
      currentVersion: current,
      latestVersion: latest,
      minSupportedVersion: minSupported,
      downloadUrl,
      isOutdated: true,
      isUnsupported: false
    };
  }

  return {
    status: 'up_to_date',
    currentVersion: current,
    latestVersion: latest,
    minSupportedVersion: minSupported,
    downloadUrl,
    isOutdated: false,
    isUnsupported: false
  };
}
