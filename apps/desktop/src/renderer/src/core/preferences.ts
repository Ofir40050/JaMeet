import type { AudioMode, PerformanceMode, VideoQuality } from '@jameet/shared';

const STORAGE_KEY = 'jameet-preferences';
const LEGACY_STORAGE_KEY = 'musiczoom-preferences';

export type VoiceInputConfig = {
  id: number;
  name?: string;
  deviceId?: string;
  channelRoute: string;
  gain: number;
  enabled: boolean;
};

export type Preferences = {
  cameraId?: string;
  audioInputId?: string;
  voiceChannel?: string;
  voiceInputs: VoiceInputConfig[];
  musicSourceType: 'app' | 'interface' | 'system' | 'none';
  musicAppPid?: number;
  musicAppName?: string;
  musicInputId?: string;
  musicChannel?: string;
  audioOutputId?: string;
  outputChannel?: string;
  outputVolume?: number;
  mode: AudioMode;
  cameraQuality: VideoQuality;
  receiveQuality: VideoQuality;
  mirrorCamera: boolean;
  performanceMode: PerformanceMode;
  stereoMusic: boolean;
  sampleRate?: number;
  inputGain: number;
  musicBitrate: number;
  audioOnly: boolean;
};

function createDefaultPreferences(): Preferences {
  return {
    mode: 'music',
    cameraQuality: 'standard',
    receiveQuality: 'standard',
    mirrorCamera: true,
    performanceMode: 'balanced',
    stereoMusic: true,
    sampleRate: 44_100,
    inputGain: 1,
    musicBitrate: 256_000,
    audioOnly: false,
    voiceInputs: [
      { id: 1, name: 'Microphone 1 (Primary · Lead)', channelRoute: '1', gain: 1, enabled: true }
    ],
    musicSourceType: 'app'
  };
}

export function readPreferences(): Preferences {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY) ?? '{}');
    let voiceInputs: VoiceInputConfig[] = Array.isArray(raw.voiceInputs) && raw.voiceInputs.length > 0
      ? raw.voiceInputs
      : [
          {
            id: 1,
            name: 'Microphone 1 (Primary · Lead)',
            deviceId: raw.audioInputId,
            channelRoute: raw.voiceChannel ?? '1',
            gain: typeof raw.inputGain === 'number' ? raw.inputGain : 1,
            enabled: true
          }
        ];

    if (raw.voice2Enabled && raw.audioInput2Id && !voiceInputs.some((v) => v.id === 2)) {
      voiceInputs.push({
        id: 2,
        name: 'Microphone 2 (Guest / Singer 2)',
        deviceId: raw.audioInput2Id,
        channelRoute: raw.voice2Channel ?? '2',
        gain: typeof raw.inputGain2 === 'number' ? raw.inputGain2 : 1,
        enabled: true
      });
    }

    return {
      mode: raw.mode === 'talk' ? 'talk' : 'music',
      cameraQuality: raw.cameraQuality || 'standard',
      receiveQuality: raw.receiveQuality || 'standard',
      mirrorCamera: raw.mirrorCamera !== undefined ? Boolean(raw.mirrorCamera) : true,
      performanceMode: raw.performanceMode || 'balanced',
      stereoMusic: raw.stereoMusic !== undefined ? Boolean(raw.stereoMusic) : true,
      sampleRate: raw.sampleRate ? Number(raw.sampleRate) : 44_100,
      inputGain: voiceInputs[0]?.gain ?? 1,
      outputVolume: typeof raw.outputVolume === 'number' ? raw.outputVolume : 1,
      musicBitrate: typeof raw.musicBitrate === 'number' ? raw.musicBitrate : 256_000,
      audioOnly: Boolean(raw.audioOnly),
      cameraId: raw.cameraId,
      audioInputId: voiceInputs[0]?.deviceId,
      voiceChannel: voiceInputs[0]?.channelRoute ?? '1',
      voiceInputs,
      musicSourceType: raw.musicSourceType || 'app',
      musicAppPid: typeof raw.musicAppPid === 'number' ? raw.musicAppPid : undefined,
      musicAppName: raw.musicAppName,
      musicInputId: raw.musicInputId,
      musicChannel: raw.musicChannel ?? '1-2',
      audioOutputId: raw.audioOutputId,
      outputChannel: raw.outputChannel ?? '1-2'
    };
  } catch {
    return createDefaultPreferences();
  }
}

export function savePreferences(prefs: Preferences): void {
  const json = JSON.stringify(prefs);
  localStorage.setItem(STORAGE_KEY, json);
}
