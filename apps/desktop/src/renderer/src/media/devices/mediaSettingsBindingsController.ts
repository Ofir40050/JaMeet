import type { Preferences, VoiceInputConfig } from '../../core/preferences';
import type { VideoQuality, PerformanceMode } from '@jameet/shared';
import { deviceError } from './deviceError';
import { getCachedRunningApps } from '../audio/sources/runningApplications';

export interface MediaSettingsBindingsOptions {
  getPreferences: () => Preferences;
  isInCall: () => boolean;
  bindSelect: (id: string, handler: (value: string) => Promise<void>) => void;
  onChangeCameraQuality: (quality: VideoQuality) => Promise<void>;
  onChangeReceiveQuality: (quality: VideoQuality) => Promise<void>;
  onChangePerformanceMode: (mode: PerformanceMode) => Promise<void>;
  onReplaceMusicInput: () => Promise<void>;
  onRefreshRunningApps: () => Promise<void>;
  onUpdateAppIconBadge: (pid: number | undefined) => void;
  onTestSpeakers: () => Promise<void>;
  onTestMicrophone: () => Promise<void>;
  onSyncAllVoiceMics: () => Promise<void>;
  onEnumerateAndPopulate: () => Promise<void>;
  onSavePreferences: () => void;
  onUpdateLocalPreviews: () => void;
  onSetMessage: (id: string, text: string, isError?: boolean) => void;
  onShowSessionError: (error: unknown) => void;
}

export function initMediaSettingsBindings(options: MediaSettingsBindingsOptions): void {
  const prefs = options.getPreferences();

  // 1. Speaker & Mic Tests
  for (const id of ['speaker-test', 'in-call-speaker-test']) {
    document.getElementById(id)?.addEventListener('click', () => {
      void options.onTestSpeakers()
        .then(() => options.onSetMessage('setup-status', 'Speaker test complete.'))
        .catch((error) => options.onShowSessionError(error));
    });
  }
  for (const id of ['microphone-test', 'in-call-microphone-test']) {
    document.getElementById(id)?.addEventListener('click', () => {
      void options.onTestMicrophone()
        .catch((error) => options.onShowSessionError(error));
    });
  }

  // 2. Add Voice Mic Buttons
  for (const id of ['add-voice-mic-btn', 'call-add-voice-mic-btn']) {
    document.getElementById(id)?.addEventListener('click', async () => {
      const newId = (prefs.voiceInputs.reduce((max, m) => Math.max(max, m.id), 0) || 0) + 1;
      const channelSuggestion = String(Math.min(32, newId));
      const newMic: VoiceInputConfig = {
        id: newId,
        name: `Microphone ${newId} (Singer / Musician / Room)`,
        deviceId: prefs.voiceInputs[0]?.deviceId,
        channelRoute: channelSuggestion,
        gain: 1.0,
        enabled: true
      };
      prefs.voiceInputs.push(newMic);
      options.onSavePreferences();
      await options.onSyncAllVoiceMics();
      await options.onEnumerateAndPopulate();
      options.onSetMessage(options.isInCall() ? 'device-dialog-status' : 'setup-status', `Microphone ${newId} added.`);
    });
  }

  // 3. Music Source Type Selects
  for (const id of ['music-source-type-select', 'call-music-source-type-select']) {
    (document.getElementById(id) as HTMLSelectElement | null)?.addEventListener('change', async (event) => {
      const val = (event.currentTarget as HTMLSelectElement).value as 'app' | 'interface' | 'system' | 'none';
      prefs.musicSourceType = val;
      options.onSavePreferences();
      for (const other of ['music-source-type-select', 'call-music-source-type-select']) {
        const el = document.getElementById(other) as HTMLSelectElement | null;
        if (el && el !== event.currentTarget) el.value = val;
      }
      const isApp = val === 'app';
      const isInterface = val === 'interface';
      const isSystem = val === 'system';
      document.getElementById('music-app-group')?.classList.toggle('hidden', !isApp);
      document.getElementById('call-music-app-group')?.classList.toggle('hidden', !isApp);
      document.getElementById('music-interface-group')?.classList.toggle('hidden', !isInterface);
      document.getElementById('call-music-interface-group')?.classList.toggle('hidden', !isInterface);
      document.getElementById('music-system-group')?.classList.toggle('hidden', !isSystem);
      document.getElementById('call-music-system-group')?.classList.toggle('hidden', !isSystem);

      try {
        await options.onReplaceMusicInput();
        options.onSetMessage(options.isInCall() ? 'device-dialog-status' : 'setup-status', `Music Source: ${val === 'app' ? 'Application Audio' : val === 'interface' ? 'Audio Interface Output' : val === 'system' ? 'Computer Audio' : 'Disabled'}`);
      } catch (error) {
        options.onSetMessage(options.isInCall() ? 'device-dialog-status' : 'setup-status', deviceError(error), true);
      }
    });
  }

  // 4. Music App Selects
  for (const id of ['music-app-select', 'call-music-app-select']) {
    (document.getElementById(id) as HTMLSelectElement | null)?.addEventListener('change', async (event) => {
      const pid = Number((event.currentTarget as HTMLSelectElement).value);
      prefs.musicAppPid = pid;
      const matched = getCachedRunningApps().find((a) => a.pid === pid);
      if (matched) prefs.musicAppName = matched.name;
      options.onSavePreferences();
      options.onUpdateAppIconBadge(pid);
      for (const other of ['music-app-select', 'call-music-app-select']) {
        const el = document.getElementById(other) as HTMLSelectElement | null;
        if (el && el !== event.currentTarget) el.value = String(pid);
      }
      try {
        await options.onReplaceMusicInput();
        options.onSetMessage(options.isInCall() ? 'device-dialog-status' : 'setup-status', `Capturing ${prefs.musicAppName || 'App'}`);
      } catch (error) {
        options.onSetMessage(options.isInCall() ? 'device-dialog-status' : 'setup-status', deviceError(error), true);
      }
    });
  }

  // 5. Refresh Apps Buttons
  for (const id of ['refresh-apps-button', 'call-refresh-apps-button']) {
    document.getElementById(id)?.addEventListener('click', async () => {
      try {
        await options.onRefreshRunningApps();
        options.onSetMessage(options.isInCall() ? 'device-dialog-status' : 'setup-status', 'Refreshed running audio applications.');
      } catch (error) {
        options.onSetMessage(options.isInCall() ? 'device-dialog-status' : 'setup-status', deviceError(error), true);
      }
    });
  }

  // 6. Quality & Performance select bindings
  options.bindSelect('camera-quality-select', (value) => options.onChangeCameraQuality(value as VideoQuality));
  options.bindSelect('call-camera-quality-select', (value) => options.onChangeCameraQuality(value as VideoQuality));
  options.bindSelect('receive-quality-select', (value) => options.onChangeReceiveQuality(value as VideoQuality));
  options.bindSelect('call-receive-quality-select', (value) => options.onChangeReceiveQuality(value as VideoQuality));
  options.bindSelect('performance-select', (value) => options.onChangePerformanceMode(value as PerformanceMode));
  options.bindSelect('call-performance-select', (value) => options.onChangePerformanceMode(value as PerformanceMode));

  // 7. Mirror Camera Checkbox
  document.getElementById('settings-mirror-camera')?.addEventListener('change', (event) => {
    prefs.mirrorCamera = (event.currentTarget as HTMLInputElement).checked;
    options.onSavePreferences();
    options.onUpdateLocalPreviews();
  });
}
