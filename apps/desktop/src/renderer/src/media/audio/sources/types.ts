import type { AudioMode } from '@jameet/shared';
import type { AudioCapturePreferences, EffectiveAudioSettings } from '../profiles/audioProfiles';

export type AudioSourcePurpose = 'voice' | 'music';

export type AudioSourceConfig = {
  id: string;
  purpose: AudioSourcePurpose;
  deviceId?: string;
  mode: AudioMode;
  enabled: boolean;
  track: MediaStreamTrack;
  effective: EffectiveAudioSettings;
};

export type VoiceMicChannel = {
  rawTrack?: MediaStreamTrack;
  isolatedTrack: MediaStreamTrack;
  sourceNode?: MediaStreamAudioSourceNode;
  gainNode: GainNode;
  isStereo: boolean;
  pannerNode?: StereoPannerNode;
  stereoSplitter?: ChannelSplitterNode;
  leftGainNode?: GainNode;
  rightGainNode?: GainNode;
  stereoMerger?: ChannelMergerNode;
  meterSplitter?: ChannelSplitterNode;
  meterAnalyserL?: AnalyserNode;
  meterAnalyserR?: AnalyserNode;
  downmixGainNode?: GainNode;
  fxNodes: AudioNode[];
  lastConnectedFx?: string;
  analyserNode: AnalyserNode; // Always-connected analyser for Sound Check / active speaker
  micDestination: MediaStreamAudioDestinationNode;
  preferences: AudioCapturePreferences;
  deviceId?: string;
  nextPlayTime?: number;
};
