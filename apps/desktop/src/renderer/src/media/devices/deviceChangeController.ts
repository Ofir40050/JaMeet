import type { Preferences } from '../../core/preferences';
import { deviceError } from './deviceError';

export interface DeviceChangeControllerOptions {
  getPreferences: () => Preferences;
  isInCall: () => boolean;
  onEnumerateAndPopulate: () => Promise<void>;
  onSetMessage: (id: string, text: string, isError?: boolean) => void;
}

export function bindDeviceSelect(
  id: string,
  handler: (value: string) => Promise<void>,
  options: DeviceChangeControllerOptions
): void {
  const selects = Array.from(document.querySelectorAll<HTMLSelectElement>(`#${id}`));
  if (!selects.length) return;

  for (const select of selects) {
    select.addEventListener('change', async (event) => {
      const target = event.currentTarget as HTMLSelectElement;
      const prefs = options.getPreferences();
      const previous = id.includes('camera')
        ? prefs.cameraId
        : id.includes('output')
        ? prefs.audioOutputId
        : prefs.audioInputId;

      const statusId = options.isInCall() ? 'device-dialog-status' : 'setup-status';

      try {
        await handler(target.value);
        await options.onEnumerateAndPopulate();
        options.onSetMessage(statusId, 'Device changed.');
      } catch (error) {
        target.value = previous ?? '';
        options.onSetMessage(statusId, deviceError(error), true);
      }
    });
  }
}
