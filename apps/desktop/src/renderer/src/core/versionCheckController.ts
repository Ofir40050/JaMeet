import {
  type AppVersionInfo,
  type VersionCheckResult,
  checkVersionStatus
} from '@jameet/shared';
import { $, setText } from './dom';

export interface VersionCheckOptions {
  serverUrl: string;
  currentVersion: string;
  onOpenExternal?: (url: string) => void;
}

export async function fetchServerVersionInfo(serverUrl: string): Promise<AppVersionInfo | null> {
  try {
    const cleanUrl = serverUrl.replace(/\/+$/, '');
    const res = await fetch(`${cleanUrl}/api/version`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AppVersionInfo;
    if (data && typeof data === 'object' && typeof data.latestVersion === 'string' && typeof data.minSupportedVersion === 'string') {
      return data;
    }
  } catch {
    // Network offline or endpoint unreachable
  }
  return null;
}

export function handleVersionCheckResult(
  result: VersionCheckResult,
  onOpenExternal?: (url: string) => void
): void {
  const banner = $('update-available-banner');
  const requiredDialog = $<HTMLDialogElement>('update-required-dialog');

  if (result.status === 'unsupported_outdated') {
    // Hide non-blocking banner if showing
    if (banner) banner.classList.add('hidden');

    if (requiredDialog) {
      setText('update-required-current-version', `v${result.currentVersion}`);
      setText('update-required-min-version', `v${result.minSupportedVersion}`);

      const downloadBtn = $('btn-update-required-download');
      if (downloadBtn) {
        downloadBtn.onclick = () => {
          if (onOpenExternal) onOpenExternal(result.downloadUrl);
          else window.open(result.downloadUrl, '_blank');
        };
      }

      // Prevent dialog from being closed by Esc key
      requiredDialog.oncancel = (e) => e.preventDefault();
      try {
        if (!requiredDialog.open) requiredDialog.showModal();
      } catch {}
    }
  } else if (result.status === 'update_available') {
    if (banner) {
      setText('update-banner-latest-version', `v${result.latestVersion}`);
      banner.classList.remove('hidden');

      const downloadBtn = $('btn-update-banner-download');
      if (downloadBtn) {
        downloadBtn.onclick = () => {
          if (onOpenExternal) onOpenExternal(result.downloadUrl);
          else window.open(result.downloadUrl, '_blank');
        };
      }

      const dismissBtn = $('btn-update-banner-dismiss');
      if (dismissBtn) {
        dismissBtn.onclick = () => {
          banner.classList.add('hidden');
        };
      }
    }
  } else {
    // Up to date
    if (banner) banner.classList.add('hidden');
    if (requiredDialog && requiredDialog.open) requiredDialog.close();
  }
}

export async function checkAppVersion(options: VersionCheckOptions): Promise<VersionCheckResult | null> {
  const info = await fetchServerVersionInfo(options.serverUrl);
  if (!info) return null;

  const result = checkVersionStatus({
    currentVersion: options.currentVersion,
    latestVersion: info.latestVersion,
    minSupportedVersion: info.minSupportedVersion,
    downloadUrl: info.downloadUrl
  });

  handleVersionCheckResult(result, options.onOpenExternal);
  return result;
}
