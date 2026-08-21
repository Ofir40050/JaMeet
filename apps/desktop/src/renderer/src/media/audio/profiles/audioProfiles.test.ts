import { describe, expect, it } from 'vitest';
import { audioConstraints, audioLimitations, opusBitrate } from './audioProfiles';

describe('audio profiles', () => {
  it('enables speech processing for Talk Mode with stereo default', () => {
    expect(audioConstraints('talk', 'mic-1')).toMatchObject({
      deviceId: { exact: 'mic-1' }, channelCount: { ideal: 2 }, sampleRate: { ideal: 44_100 },
      echoCancellation: true, noiseSuppression: true, autoGainControl: true
    });
    expect(opusBitrate('talk')).toBe(96_000);
  });

  it('requests unprocessed stereo for Music Mode at 44.1 kHz default', () => {
    expect(audioConstraints('music')).toMatchObject({
      channelCount: { ideal: 2 }, sampleRate: { ideal: 44_100 },
      echoCancellation: false, noiseSuppression: false, autoGainControl: false
    });
    expect(opusBitrate('music')).toBe(256_000);
  });

  it('reports effective Music Mode limitations', () => {
    expect(audioLimitations('music', {
      channelCount: 1, sampleRate: 44_100, echoCancellation: true,
      noiseSuppression: false, autoGainControl: true
    })).toEqual([
      'Hardware input is currently supplying 1 channel (Mono).',
      'Echo cancellation could not be disabled.',
      'Automatic gain control could not be disabled.'
    ]);
  });
});
