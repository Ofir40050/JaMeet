import type { Preferences } from '../core/preferences';
import { formatDeviceDisplayName, type ChannelDropdownOption } from './hardwareDeviceUtils';

export interface FillSelectsOptions {
  ids: string[];
  devices: MediaDeviceInfo[];
  selected: string | undefined;
  fallback: string;
  getPreferences: () => Preferences;
  onClearPreferenceKey: (key: 'cameraId' | 'audioOutputId' | 'musicInputId' | 'audioInputId') => void;
  onSavePreferences: () => void;
  onSetMessage: (id: string, text: string) => void;
  isInCall: () => boolean;
}

export function fillSelects(options: FillSelectsOptions): void {
  const { ids, devices, selected, fallback, getPreferences, onClearPreferenceKey, onSavePreferences, onSetMessage, isInCall } = options;
  const prefs = getPreferences();

  for (const id of ids) {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (!select) continue;
    select.replaceChildren();
    if (!devices.length || id.includes('output') || id.includes('music-input')) select.add(new Option(fallback, ''));
    devices.forEach((device, index) => {
      const displayLabel = formatDeviceDisplayName(device.label) || `${fallback} ${index + 1}`;
      select.add(new Option(displayLabel, device.deviceId));
    });
    if (selected && devices.some((device) => device.deviceId === selected)) select.value = selected;
    else if (selected) {
      const key = id.includes('camera') ? 'cameraId' : id.includes('output') ? 'audioOutputId' : id.includes('music-input') ? 'musicInputId' : 'audioInputId';
      prefs[key] = undefined;
      onClearPreferenceKey(key);
      select.value = '';
      onSetMessage(isInCall() ? 'device-dialog-status' : 'setup-status', `A saved ${fallback.toLowerCase()} is unavailable; using the system default.`);
    }
  }
  onSavePreferences();
}

export function populateChannelDropdowns(ids: string[], options: ChannelDropdownOption[], selectedValue?: string): void {
  for (const id of ids) {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (!select) continue;
    select.replaceChildren();

    const groups = new Map<string, HTMLOptGroupElement>();

    for (const opt of options) {
      if (opt.group) {
        if (!groups.has(opt.group)) {
          const grp = document.createElement('optgroup');
          grp.label = opt.group;
          groups.set(opt.group, grp);
          select.appendChild(grp);
        }
        const optEl = new Option(opt.label, opt.value);
        groups.get(opt.group)!.appendChild(optEl);
      } else {
        select.add(new Option(opt.label, opt.value));
      }
    }

    if (selectedValue && options.some((opt) => opt.value === selectedValue)) {
      select.value = selectedValue;
    } else if (options.length > 0) {
      select.value = options[0]!.value;
    }
  }
}
