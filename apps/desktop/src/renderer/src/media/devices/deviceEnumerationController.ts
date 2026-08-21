import type { AudioMode, PerformanceMode, VideoQuality } from '@jameet/shared';
import type { Preferences } from '../../core/preferences';
import {
  type HardwareAudioDeviceInfo,
  findHardwareDevice,
  generateOutputChannelOptions
} from './hardwareDeviceUtils';
import { fillSelects, populateChannelDropdowns } from './deviceSelectUi';

export interface DeviceEnumerationOptions {
  getPreferences: () => Preferences;
  onSavePreferences: () => void;
  getCachedHardwareDevices: () => HardwareAudioDeviceInfo[];
  onSetCachedHardwareDevices: (devices: HardwareAudioDeviceInfo[]) => void;
  onRefreshRunningApps: () => Promise<void>;
  onRenderVoiceInputControls: (audioInputs: MediaDeviceInfo[]) => void;
  onSetMessage: (id: string, text: string) => void;
  isInCall: () => boolean;
  isAudioOnly: () => boolean;
  onSetModeRadios: (mode: AudioMode) => void;
}

export async function enumerateAndPopulateDevices(options: DeviceEnumerationOptions): Promise<void> {
  const {
    getPreferences,
    onSavePreferences,
    getCachedHardwareDevices,
    onSetCachedHardwareDevices,
    onRefreshRunningApps,
    onRenderVoiceInputControls,
    onSetMessage,
    isInCall,
    isAudioOnly,
    onSetModeRadios
  } = options;

  const prefs = getPreferences();
  const desktopApi = typeof window !== 'undefined' ? (window.jameet || window.musiczoom) : undefined;
  if (desktopApi?.getHardwareAudioDevices) {
    const hwDevices = await desktopApi.getHardwareAudioDevices().catch(() => []);
    onSetCachedHardwareDevices(hwDevices);
  }
  await onRefreshRunningApps();

  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const groups: Record<MediaDeviceKind, MediaDeviceInfo[]> = { videoinput: [], audioinput: [], audiooutput: [] };
  for (const device of devices) groups[device.kind]?.push(device);

  const fillHelper = (ids: string[], devList: MediaDeviceInfo[], selected: string | undefined, fallback: string) => {
    fillSelects({
      ids,
      devices: devList,
      selected,
      fallback,
      getPreferences,
      onClearPreferenceKey: (key) => {
        prefs[key] = undefined;
      },
      onSavePreferences,
      onSetMessage,
      isInCall
    });
  };

  fillHelper(['camera-select', 'call-camera-select'], groups.videoinput, prefs.cameraId, 'Camera');
  fillHelper(['audio-output-select', 'call-audio-output-select'], groups.audiooutput, prefs.audioOutputId, 'System default');

  const interfaceList = groups.audiooutput.length > 0 ? groups.audiooutput : groups.audioinput;
  fillHelper(['music-input-select', 'call-music-input-select'], interfaceList, prefs.musicInputId || prefs.audioOutputId, 'Default Audio Interface');

  onRenderVoiceInputControls(groups.audioinput);

  const cachedHw = getCachedHardwareDevices();
  const selectedMusicDeviceId = prefs.musicInputId || prefs.audioOutputId;
  const musicHw = findHardwareDevice(selectedMusicDeviceId, groups.audiooutput, cachedHw) || findHardwareDevice(selectedMusicDeviceId, groups.audioinput, cachedHw);
  const musicOutChannels = musicHw?.outputChannels ?? 2;
  const musicOutNames = musicHw?.outputChannelNames;
  populateChannelDropdowns(['music-channel-select', 'call-music-channel-select'], generateOutputChannelOptions(musicOutChannels, musicOutNames), prefs.musicChannel ?? (musicOutChannels >= 2 ? '1-2' : '1'));

  const outputHw = findHardwareDevice(prefs.audioOutputId, groups.audiooutput, cachedHw);
  const outChannels = outputHw?.outputChannels ?? 2;
  const outNames = outputHw?.outputChannelNames;
  populateChannelDropdowns(['output-channel-select', 'call-output-channel-select'], generateOutputChannelOptions(outChannels, outNames), prefs.outputChannel ?? (outChannels >= 2 ? '1-2' : '1'));

  for (const id of ['music-source-type-select', 'call-music-source-type-select']) {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = prefs.musicSourceType || 'app';
  }

  const isApp = (prefs.musicSourceType || 'app') === 'app';
  const isInterface = prefs.musicSourceType === 'interface';
  const isSystem = prefs.musicSourceType === 'system';
  document.getElementById('music-app-group')?.classList.toggle('hidden', !isApp);
  document.getElementById('call-music-app-group')?.classList.toggle('hidden', !isApp);
  document.getElementById('music-interface-group')?.classList.toggle('hidden', !isInterface);
  document.getElementById('call-music-interface-group')?.classList.toggle('hidden', !isInterface);
  document.getElementById('music-system-group')?.classList.toggle('hidden', !isSystem);
  document.getElementById('call-music-system-group')?.classList.toggle('hidden', !isSystem);

  const voiceHw = findHardwareDevice(prefs.audioInputId, groups.audioinput, cachedHw);
  const activeRate = voiceHw?.sampleRate || outputHw?.sampleRate || prefs.sampleRate || 44100;
  for (const rateId of ['active-sample-rate', 'call-active-sample-rate']) {
    const el = document.getElementById(rateId);
    if (el) el.textContent = `${Math.round(activeRate).toLocaleString()} Hz`;
  }

  const outVolEl = document.getElementById('call-output-volume') as HTMLInputElement | null;
  if (outVolEl) outVolEl.value = String(prefs.outputVolume ?? 1);
  const outVolVal = document.getElementById('call-output-volume-val');
  if (outVolVal) outVolVal.textContent = `${Math.round((prefs.outputVolume ?? 1) * 100)}%`;

  for (const id of ['camera-quality-select', 'call-camera-quality-select']) {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = prefs.cameraQuality;
  }
  for (const id of ['receive-quality-select', 'call-receive-quality-select']) {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = prefs.receiveQuality;
  }
  for (const id of ['performance-select', 'call-performance-select']) {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = prefs.performanceMode;
  }
  for (const id of ['channel-mode-select', 'call-channel-mode-select']) {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = prefs.stereoMusic ? 'stereo' : 'mono';
  }
  for (const id of ['sample-rate-select', 'call-sample-rate-select']) {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = String(prefs.sampleRate ?? 44100);
  }
  for (const id of ['music-quality-select', 'call-music-quality-select']) {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = String(prefs.musicBitrate);
  }
  const mirrorEl = document.getElementById('settings-mirror-camera') as HTMLInputElement | null;
  if (mirrorEl) mirrorEl.checked = prefs.mirrorCamera !== false;
  const audioOnlyEl = document.getElementById('audio-only-setup') as HTMLInputElement | null;
  if (audioOnlyEl) audioOnlyEl.checked = isAudioOnly();
  onSetModeRadios(prefs.mode);
}
