import type { MediaMetadata } from '@jameet/shared';
import { buildSessionMetadata, buildCurrentStream } from './sessionMetadataController';
import { checkActiveSpeaker as checkActiveSpeakerImpl } from './activeSpeakerController';
import type { ParticipantViewMode } from './sessionView';

export interface SessionMetadataWrapperOptions {
  getAudioSources: () => any[];
  isCameraEnabled: () => boolean;
  getCameraQuality: () => any;
  getReceiveQuality: () => any;
  hasScreenTrack: () => boolean;
  isAudioOnly: () => boolean;
  getPerformanceMode: () => any;
}

export function createSessionMetadata(options: SessionMetadataWrapperOptions): MediaMetadata {
  return buildSessionMetadata({
    getAudioSources: options.getAudioSources,
    isCameraEnabled: options.isCameraEnabled,
    getCameraQuality: options.getCameraQuality,
    getReceiveQuality: options.getReceiveQuality,
    hasScreenTrack: options.hasScreenTrack,
    isAudioOnly: options.isAudioOnly,
    getPerformanceMode: options.getPerformanceMode
  });
}

export function createCurrentStream(
  screenTrack: MediaStreamTrack | undefined,
  cameraEnabled: boolean,
  videoTrack: MediaStreamTrack | undefined
): MediaStream {
  return buildCurrentStream(screenTrack, cameraEnabled, videoTrack);
}

export interface CheckActiveSpeakerOptions {
  isLocalMuted: () => boolean;
  isRemoteMuted: () => boolean;
  getLastLocalVoiceDb: () => number;
  getLastRemoteVoiceDb: () => number;
  getActiveSpeaker: () => 'local' | 'remote' | null;
  onSetActiveSpeaker: (speaker: 'local' | 'remote' | null) => void;
  getCameraViewMode: () => ParticipantViewMode;
  onApplyParticipantViewLayout: () => void;
}

export function performCheckActiveSpeaker(options: CheckActiveSpeakerOptions): void {
  checkActiveSpeakerImpl({
    isLocalMuted: options.isLocalMuted,
    isRemoteMuted: options.isRemoteMuted,
    getLastLocalVoiceDb: options.getLastLocalVoiceDb,
    getLastRemoteVoiceDb: options.getLastRemoteVoiceDb,
    getActiveSpeaker: options.getActiveSpeaker,
    onSetActiveSpeaker: options.onSetActiveSpeaker,
    getCameraViewMode: options.getCameraViewMode,
    onApplyParticipantViewLayout: options.onApplyParticipantViewLayout
  });
}
