import type { AudioMode } from '@musiczoom/shared';

export type EffectiveAudioSettings = {
  channelCount?: number;
  sampleRate?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
};

export type AudioCapturePreferences = {
  sampleRate?: number;
  stereo?: boolean;
  inputGain?: number;
  channelRoute?: string;
};

export function audioConstraints(mode: AudioMode, deviceId?: string, preferences: AudioCapturePreferences = {}): MediaTrackConstraints {
  const sampleRate = preferences.sampleRate ?? 44_100;
  const isMultichannelRoute = Boolean(preferences.channelRoute && preferences.channelRoute !== 'all');
  const channelCount = isMultichannelRoute ? 32 : (preferences.stereo === false ? 1 : 2);
  const common = {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    sampleRate: { ideal: sampleRate },
    channelCount: { ideal: channelCount },
    volume: preferences.inputGain === undefined ? undefined : { ideal: preferences.inputGain }
  } as MediaTrackConstraints;

  if (mode === 'music' || isMultichannelRoute) {
    return { ...common, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  }

  return { ...common, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
}

export function effectiveSettings(track: MediaStreamTrack): EffectiveAudioSettings {
  const settings = track.getSettings();
  return {
    channelCount: settings.channelCount,
    sampleRate: settings.sampleRate,
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl
  };
}

export function audioLimitations(mode: AudioMode, settings: EffectiveAudioSettings): string[] {
  if (mode !== 'music') return [];
  const result: string[] = [];
  if ((settings.channelCount ?? 1) < 2) result.push('Hardware input is currently supplying 1 channel (Mono).');
  if (settings.echoCancellation) result.push('Echo cancellation could not be disabled.');
  if (settings.noiseSuppression) result.push('Noise suppression could not be disabled.');
  if (settings.autoGainControl) result.push('Automatic gain control could not be disabled.');
  return result;
}

export function opusBitrate(mode: AudioMode): number {
  return mode === 'music' ? 256_000 : 96_000;
}
