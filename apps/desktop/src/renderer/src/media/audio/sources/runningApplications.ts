import type { Preferences } from '@jameet/shared';
import { populateMusicAppSelectOptions, updateMusicAppIcon } from '../ui/musicAppSelectUi';

export interface RunningAudioApp {
  pid: number;
  name: string;
  bundleId: string;
  isDaw: boolean;
  category?: string;
  iconDataUrl?: string;
}

let cachedRunningApps: RunningAudioApp[] = [];

export function getCachedRunningApps(): RunningAudioApp[] {
  return cachedRunningApps;
}

export function setCachedRunningApps(apps: RunningAudioApp[]): void {
  cachedRunningApps = apps;
}

export { updateMusicAppIcon };

export function updateAppIconBadge(pid: number | undefined): void {
  const app = cachedRunningApps.find((a) => a.pid === pid);
  updateMusicAppIcon(app);
}

export interface RefreshRunningAppsOptions {
  getPreferences: () => Preferences;
}

export async function refreshRunningApps(options: RefreshRunningAppsOptions): Promise<void> {
  const desktopApi = typeof window !== 'undefined' ? (window.jameet || window.musiczoom) : undefined;
  if (desktopApi?.listAudioApplications) {
    cachedRunningApps = await desktopApi.listAudioApplications().catch(() => []);
  }

  const prefs = options.getPreferences();
  populateMusicAppSelectOptions(cachedRunningApps, prefs);
}
