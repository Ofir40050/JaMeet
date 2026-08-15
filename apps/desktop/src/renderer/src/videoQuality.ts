import type { PerformanceMode, VideoQuality } from '@musiczoom/shared';

export type VideoQualityProfile = {
  width: number;
  height: number;
  frameRate: number;
  maxBitrate: number;
  scaleResolutionDownBy: number;
};

export const VIDEO_QUALITY: Record<VideoQuality, VideoQualityProfile> = {
  low: { width: 640, height: 360, frameRate: 15, maxBitrate: 450_000, scaleResolutionDownBy: 2 },
  standard: { width: 960, height: 540, frameRate: 24, maxBitrate: 900_000, scaleResolutionDownBy: 1.5 },
  high: { width: 1280, height: 720, frameRate: 30, maxBitrate: 1_500_000, scaleResolutionDownBy: 1 }
};

const RANK: Record<VideoQuality, number> = { low: 0, standard: 1, high: 2 };

export function lowerQuality(a: VideoQuality, b: VideoQuality): VideoQuality {
  return RANK[a] <= RANK[b] ? a : b;
}

export function performanceVideoQuality(selected: VideoQuality, mode: PerformanceMode): VideoQuality {
  const cap: Record<PerformanceMode, VideoQuality> = { low: 'low', balanced: 'standard', quality: 'high' };
  return lowerQuality(selected, cap[mode]);
}

export function cameraConstraints(quality: VideoQuality, deviceId?: string): MediaTrackConstraints {
  const profile = VIDEO_QUALITY[quality];
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    width: { ideal: profile.width },
    height: { ideal: profile.height },
    frameRate: { ideal: profile.frameRate, max: profile.frameRate }
  };
}
