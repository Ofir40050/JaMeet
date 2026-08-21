import type { PerformanceMode, VideoQuality } from '@jameet/shared';

export type VideoQualityProfile = {
  width: number;
  height: number;
  frameRate: number;
  maxBitrate: number;
  scaleResolutionDownBy: number;
};

export const VIDEO_QUALITY: Record<VideoQuality, VideoQualityProfile> = {
  auto: { width: 1920, height: 1080, frameRate: 30, maxBitrate: 3_500_000, scaleResolutionDownBy: 1 },
  uhd: { width: 3840, height: 2160, frameRate: 30, maxBitrate: 10_000_000, scaleResolutionDownBy: 1 },
  qhd: { width: 2560, height: 1440, frameRate: 30, maxBitrate: 6_000_000, scaleResolutionDownBy: 1 },
  fhd: { width: 1920, height: 1080, frameRate: 30, maxBitrate: 3_500_000, scaleResolutionDownBy: 1 },
  high: { width: 1280, height: 720, frameRate: 30, maxBitrate: 1_800_000, scaleResolutionDownBy: 1 },
  standard: { width: 960, height: 540, frameRate: 24, maxBitrate: 900_000, scaleResolutionDownBy: 1.5 },
  low: { width: 640, height: 360, frameRate: 15, maxBitrate: 450_000, scaleResolutionDownBy: 2 }
};

const RANK: Record<VideoQuality, number> = { low: 0, standard: 1, high: 2, fhd: 3, qhd: 4, uhd: 5, auto: 3 };

export function lowerQuality(a: VideoQuality, b: VideoQuality): VideoQuality {
  return (RANK[a] ?? 1) <= (RANK[b] ?? 1) ? a : b;
}

export function performanceVideoQuality(selected: VideoQuality, mode: PerformanceMode): VideoQuality {
  if (selected === 'auto') {
    const autoTarget: Record<PerformanceMode, VideoQuality> = { low: 'low', balanced: 'high', quality: 'fhd' };
    return autoTarget[mode] ?? 'high';
  }
  const maxAllowed: Record<PerformanceMode, VideoQuality> = { low: 'low', balanced: 'standard', quality: 'uhd' };
  return lowerQuality(selected, maxAllowed[mode]);
}

export function effectiveVideoQuality(selected: VideoQuality, mode: PerformanceMode = 'balanced'): VideoQuality {
  return performanceVideoQuality(selected, mode);
}

export function cameraConstraints(quality: VideoQuality, deviceId?: string): MediaTrackConstraints {
  if (quality === 'low') {
    return {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 640, max: 640 },
      height: { ideal: 360, max: 360 },
      frameRate: { ideal: 15, max: 15 }
    };
  }
  if (quality === 'standard') {
    return {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 960, max: 960 },
      height: { ideal: 540, max: 540 },
      frameRate: { ideal: 24, max: 24 }
    };
  }
  if (quality === 'high') {
    return {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 1280, max: 1280 },
      height: { ideal: 720, max: 720 },
      frameRate: { ideal: 30, max: 30 }
    };
  }
  if (quality === 'fhd') {
    return {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 1920, min: 1280 },
      height: { ideal: 1080, min: 720 },
      frameRate: { ideal: 30, max: 30 }
    };
  }
  if (quality === 'qhd') {
    return {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 2560, min: 1920 },
      height: { ideal: 1440, min: 1080 },
      frameRate: { ideal: 30, max: 30 }
    };
  }
  if (quality === 'uhd') {
    return {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 3840, min: 1920 },
      height: { ideal: 2160, min: 1080 },
      frameRate: { ideal: 30, max: 30 }
    };
  }

  // auto / adaptive
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30, max: 30 }
  };
}
