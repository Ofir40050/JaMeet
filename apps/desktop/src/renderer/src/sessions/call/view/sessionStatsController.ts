import type { Preferences } from '@jameet/shared';
import { initSessionStats } from './sessionStatsUi';

export interface SessionStatsControllerOptions {
  getStatsReport: () => Promise<RTCStatsReport | undefined>;
  isInCall: () => boolean;
  getPreferences: () => Preferences;
  getEffectiveSampleRate: () => number | undefined;
  getVideoState: () => {
    screenTrack: MediaStreamTrack | undefined;
    videoTrack: MediaStreamTrack | undefined;
    cameraEnabled: boolean;
    remoteVideoStream: MediaStream | undefined;
  };
}

export function initSessionStatsController(options: SessionStatsControllerOptions): void {
  initSessionStats({
    getStatsReport: () => options.getStatsReport(),
    isInCall: () => options.isInCall(),
    getPreferences: () => options.getPreferences(),
    getEffectiveSampleRate: () => options.getEffectiveSampleRate(),
    getVideoState: () => options.getVideoState()
  });
}
