import type { Preferences } from '../../core/preferences';

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

export function updateAppIconBadge(pid: number | undefined): void {
  const app = cachedRunningApps.find((a) => a.pid === pid);
  for (const prefix of ['', 'call-']) {
    const wrap = document.getElementById(`${prefix}music-app-icon-wrap`);
    const img = document.getElementById(`${prefix}music-app-icon`) as HTMLImageElement | null;
    if (wrap && img) {
      if (app?.iconDataUrl) {
        img.src = app.iconDataUrl;
        wrap.classList.remove('hidden');
      } else {
        img.removeAttribute('src');
        wrap.classList.add('hidden');
      }
    }
  }
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

  for (const id of ['music-app-select', 'call-music-app-select']) {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (!select) continue;
    select.replaceChildren();

    if (!cachedRunningApps.length) {
      select.add(new Option('No running audio apps found', ''));
      continue;
    }

    const musicGroup = document.createElement('optgroup');
    musicGroup.label = 'DAWs & Music Apps';
    const mediaGroup = document.createElement('optgroup');
    mediaGroup.label = 'Browsers & Media Players';
    const otherGroup = document.createElement('optgroup');
    otherGroup.label = 'Other Applications';

    for (const app of cachedRunningApps) {
      // Clean application name only: NO PID! NO internal process identifiers!
      const opt = new Option(app.name, String(app.pid));

      if (app.category === 'music' || app.isDaw) {
        musicGroup.appendChild(opt);
      } else if (app.category === 'media') {
        mediaGroup.appendChild(opt);
      } else {
        otherGroup.appendChild(opt);
      }
    }

    if (musicGroup.childElementCount > 0) select.appendChild(musicGroup);
    if (mediaGroup.childElementCount > 0) select.appendChild(mediaGroup);
    if (otherGroup.childElementCount > 0) select.appendChild(otherGroup);

    if (prefs.musicAppPid && cachedRunningApps.some((a) => a.pid === prefs.musicAppPid)) {
      select.value = String(prefs.musicAppPid);
    } else {
      const defaultApp = cachedRunningApps.find((a) => a.isDaw || a.category === 'music') ||
                         cachedRunningApps.find((a) => a.category === 'media') ||
                         cachedRunningApps[0];
      if (defaultApp) {
        select.value = String(defaultApp.pid);
        prefs.musicAppPid = defaultApp.pid;
        prefs.musicAppName = defaultApp.name;
      }
    }
  }

  updateAppIconBadge(prefs.musicAppPid);
}
