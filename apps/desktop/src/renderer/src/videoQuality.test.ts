import { describe, expect, it } from 'vitest';
import { cameraConstraints, lowerQuality, performanceVideoQuality, VIDEO_QUALITY } from './videoQuality';

describe('video quality profiles', () => {
  it('provides a low-CPU 360p profile', () => {
    expect(cameraConstraints('low', 'camera-1')).toEqual({
      deviceId: { exact: 'camera-1' }, width: { ideal: 640, max: 640 }, height: { ideal: 360, max: 360 },
      frameRate: { ideal: 15, max: 15 }
    });
    expect(VIDEO_QUALITY.low.maxBitrate).toBe(450_000);
  });

  it('uses the lower sender and receiver preference', () => {
    expect(lowerQuality('high', 'low')).toBe('low');
    expect(lowerQuality('standard', 'high')).toBe('standard');
  });

  it('caps video according to the global performance mode', () => {
    expect(performanceVideoQuality('high', 'low')).toBe('low');
    expect(performanceVideoQuality('high', 'balanced')).toBe('standard');
    expect(performanceVideoQuality('high', 'quality')).toBe('high');
  });
});
