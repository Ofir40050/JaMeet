import type {
  AudioSourceMetadata,
  MediaMetadata,
  PerformanceMode,
  VideoQuality
} from '@jameet/shared';
import { performanceVideoQuality, effectiveVideoQuality } from '../../../media/video/videoQuality';

export { effectiveVideoQuality };

export interface SessionMetadataOptions {
  getAudioSources: () => AudioSourceMetadata[];
  isCameraEnabled: () => boolean;
  getCameraQuality: () => VideoQuality;
  getReceiveQuality: () => VideoQuality;
  hasScreenTrack: () => boolean;
  isAudioOnly: () => boolean;
  getPerformanceMode: () => PerformanceMode;
}

export function buildSessionMetadata(options: SessionMetadataOptions): MediaMetadata {
  const performanceMode = options.getPerformanceMode();
  return {
    audioSources: options.getAudioSources(),
    cameraEnabled: options.isCameraEnabled(),
    outgoingVideoQuality: effectiveVideoQuality(options.getCameraQuality(), performanceMode),
    preferredReceiveVideoQuality: effectiveVideoQuality(
      options.getReceiveQuality(),
      performanceMode
    ),
    sharingScreen: options.hasScreenTrack(),
    audioOnly: options.isAudioOnly(),
    performanceMode
  };
}

export function buildCurrentStream(
  screenTrack?: MediaStreamTrack,
  cameraEnabled?: boolean,
  videoTrack?: MediaStreamTrack
): MediaStream {
  const visibleTrack = screenTrack ?? (cameraEnabled ? videoTrack : undefined);
  return new MediaStream(visibleTrack ? [visibleTrack] : []);
}
