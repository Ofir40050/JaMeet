import { icons } from '../../core/icons';
import { escapeHtml } from '../../core/htmlSecurity';
import { deviceError } from '../../media/devices/deviceError';

export interface ScreenPickerControllerOptions {
  hasScreenTrack: () => boolean;
  onStopScreenShare: () => Promise<void>;
  onStartScreenShare: (sourceId: string, optimizeFor: 'detail' | 'motion') => Promise<void>;
  onSetCurrentSharingSourceTitle: (title: string) => void;
  onSetMessage: (id: string, text: string, isError?: boolean) => void;
  onSetText: (id: string, text: string) => void;
  onSetCallStatus: (status: string) => void;
}

export async function showScreenPickerUi(options: ScreenPickerControllerOptions): Promise<void> {
  if (options.hasScreenTrack()) {
    await options.onStopScreenShare();
    return;
  }
  const dialog = document.getElementById('screen-dialog') as HTMLDialogElement | null;
  if (!dialog) return;

  const dawGrid = document.getElementById('screen-daw-grid');
  const appsGrid = document.getElementById('screen-apps-grid');
  const screensGrid = document.getElementById('screen-displays-grid');
  if (dawGrid) dawGrid.replaceChildren();
  if (appsGrid) appsGrid.replaceChildren();
  if (screensGrid) screensGrid.replaceChildren();

  options.onSetMessage('screen-status', 'Loading available screens and DAW windows…');
  dialog.showModal();

  const dawPattern = /logic|ableton|cubase|pro tools|studio one|reaper|fl studio|reason|bitwig|garageband/i;

  try {
    const desktopApi = typeof window !== 'undefined' ? (window.jameet || window.musiczoom) : undefined;
    const sources = desktopApi?.listDisplaySources ? await desktopApi.listDisplaySources() : [];
    if (!sources.length) {
      options.onSetMessage('screen-status', 'No screens or windows found. On macOS, make sure Screen Recording permission is allowed in System Settings > Privacy & Security.', true);
      return;
    }
    options.onSetMessage('screen-status', '');

    const screens = sources.filter((s) => s.id.startsWith('screen:'));
    const windows = sources.filter((s) => !s.id.startsWith('screen:'));
    const daws = windows.filter((w) => dawPattern.test(w.name));
    const otherApps = windows.filter((w) => !dawPattern.test(w.name));

    options.onSetText('apps-count-badge', String(windows.length));
    options.onSetText('screens-count-badge', String(screens.length));

    const getOptimizationPreset = (): 'detail' | 'motion' => {
      const checked = document.querySelector<HTMLInputElement>('input[name="share-preset"]:checked');
      return (checked?.value as 'detail' | 'motion') || 'detail';
    };

    const createCard = (source: { id: string; name: string; thumbnail: string }, isDaw = false) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'screen-source-card';
      card.innerHTML = `
        <div class="source-thumbnail-wrap">
          <img src="${source.thumbnail}" alt="" />
          ${isDaw ? `<span class="daw-badge">${icons.music({ size: 12 })} DAW</span>` : ''}
        </div>
        <div class="source-card-info">
          <span class="source-card-icon">${isDaw ? icons.piano({ size: 16 }) : source.id.startsWith('screen:') ? icons.monitor({ size: 16 }) : icons.appWindow({ size: 16 })}</span>
          <span class="source-card-name" title="${escapeHtml(source.name)}">${escapeHtml(source.name)}</span>
        </div>
      `;
      card.addEventListener('click', () => {
        dialog.close();
        options.onSetCurrentSharingSourceTitle(source.name);
        const preset = getOptimizationPreset();
        void options.onStartScreenShare(source.id, preset).catch((error) => options.onSetCallStatus(deviceError(error)));
      });
      return card;
    };

    // Populate DAWs
    if (dawGrid) {
      if (daws.length === 0) {
        dawGrid.innerHTML = '<div class="no-daws-hint"><span>No running DAWs detected. Open Logic Pro, Ableton, FL Studio, or Pro Tools to share directly.</span></div>';
      } else {
        daws.forEach((daw) => dawGrid.appendChild(createCard(daw, true)));
      }
    }

    // Populate Other Windows
    if (appsGrid) {
      otherApps.forEach((app) => appsGrid.appendChild(createCard(app, false)));
    }

    // Populate Displays
    if (screensGrid) {
      screens.forEach((scr) => screensGrid.appendChild(createCard(scr, false)));
    }
  } catch (error) {
    options.onSetMessage('screen-status', deviceError(error), true);
  }
}
