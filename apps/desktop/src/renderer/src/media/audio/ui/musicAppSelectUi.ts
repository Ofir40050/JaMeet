import type { Preferences } from '@jameet/shared';
import type { RunningAudioApp } from '../sources/runningApplications';

export function updateMusicAppIcon(app: RunningAudioApp | undefined): void {
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

export function populateMusicAppSelectOptions(
  runningApps: RunningAudioApp[],
  prefs: Preferences
): void {
  for (const id of ['music-app-select', 'call-music-app-select']) {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (!select) continue;
    select.replaceChildren();

    if (!runningApps.length) {
      select.add(new Option('No running audio apps found', ''));
      continue;
    }

    const musicGroup = document.createElement('optgroup');
    musicGroup.label = 'DAWs & Music Apps';
    const mediaGroup = document.createElement('optgroup');
    mediaGroup.label = 'Browsers & Media Players';
    const otherGroup = document.createElement('optgroup');
    otherGroup.label = 'Other Applications';

    for (const app of runningApps) {
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

    if (prefs.musicAppPid && runningApps.some((a) => a.pid === prefs.musicAppPid)) {
      select.value = String(prefs.musicAppPid);
    } else {
      const defaultApp = runningApps.find((a) => a.isDaw || a.category === 'music') ||
                         runningApps.find((a) => a.category === 'media') ||
                         runningApps[0];
      if (defaultApp) {
        select.value = String(defaultApp.pid);
        prefs.musicAppPid = defaultApp.pid;
        prefs.musicAppName = defaultApp.name;
      }
    }
  }

  const selectedApp = runningApps.find((a) => a.pid === prefs.musicAppPid);
  updateMusicAppIcon(selectedApp);
}
