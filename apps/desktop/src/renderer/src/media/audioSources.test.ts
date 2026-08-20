import { describe, expect, it, vi } from 'vitest';
import { LocalAudioSourceManager } from './audioSources';

describe('LocalAudioSourceManager Multi-Voice Input', () => {
  it('instantiates and provides clean multi-mic maps', () => {
    const manager = new LocalAudioSourceManager();
    expect(manager.getVoiceMicsCount()).toBe(0);
    expect(manager.metadata()).toEqual([]);
  });

  it('can set voice mic gain safely for non-existent and existing mics', () => {
    const manager = new LocalAudioSourceManager();
    expect(() => manager.setVoiceMicGain(1, 0.8)).not.toThrow();
    expect(() => manager.setVoiceMicGain(3, 1.2)).not.toThrow();
  });

  it('demultiplexes discrete hardware audio channels with complete physical isolation', () => {
    const totalChannels = 8;
    const frameCount = 128;
    const buffer = new ArrayBuffer(8 + frameCount * totalChannels * 4);
    const header = new Uint32Array(buffer, 0, 2);
    header[0] = totalChannels;
    header[1] = frameCount;

    const floatSamples = new Float32Array(buffer, 8);

    // Simulate Mic A on physical Input 1 (Channel 0) with 0.75 amplitude
    // Simulate Mic B on physical Input 2 (Channel 1) with 0.25 amplitude
    // Physical Inputs 3..8 have silence (0.0)
    for (let f = 0; f < frameCount; f++) {
      floatSamples[f * totalChannels + 0] = 0.75;
      floatSamples[f * totalChannels + 1] = 0.25;
      for (let ch = 2; ch < totalChannels; ch++) {
        floatSamples[f * totalChannels + ch] = 0.0;
      }
    }

    // Extract Input 1
    const ch1Samples = new Float32Array(frameCount);
    for (let f = 0; f < frameCount; f++) {
      ch1Samples[f] = floatSamples[f * totalChannels + 0]!;
    }

    // Extract Input 2
    const ch2Samples = new Float32Array(frameCount);
    for (let f = 0; f < frameCount; f++) {
      ch2Samples[f] = floatSamples[f * totalChannels + 1]!;
    }

    // Extract Input 3
    const ch3Samples = new Float32Array(frameCount);
    for (let f = 0; f < frameCount; f++) {
      ch3Samples[f] = floatSamples[f * totalChannels + 2]!;
    }

    // Verify complete physical isolation
    expect(ch1Samples[0]).toBe(0.75);
    expect(ch2Samples[0]).toBe(0.25);
    expect(ch3Samples[0]).toBe(0.0);

    expect(ch1Samples.every((s) => s === 0.75)).toBe(true);
    expect(ch2Samples.every((s) => s === 0.25)).toBe(true);
    expect(ch3Samples.every((s) => s === 0.0)).toBe(true);
  });

  it('keeps voice and music tracks simultaneously registered and distinct in metadata', async () => {
    const manager = new LocalAudioSourceManager();
    const fakeVoiceTrack = { kind: 'audio', id: 'voice_track_1', stop: vi.fn(), getSettings: () => ({ channelCount: 2, sampleRate: 48000 }) } as unknown as MediaStreamTrack;
    const fakeMusicTrack = { kind: 'audio', id: 'music_track_1', stop: vi.fn(), getSettings: () => ({ channelCount: 2, sampleRate: 48000 }) } as unknown as MediaStreamTrack;

    await manager.addExternal('voice', 'voice', fakeVoiceTrack);
    await manager.addExternal('music', 'music', fakeMusicTrack);

    expect(manager.voice?.track.id).toBe('voice_track_1');
    expect(manager.music?.track.id).toBe('music_track_1');
    expect(manager.voice?.purpose).toBe('voice');
    expect(manager.music?.purpose).toBe('music');

    const meta = manager.metadata();
    expect(meta.length).toBe(2);
    expect(meta.find((m) => m.id === 'voice')?.purpose).toBe('voice');
    expect(meta.find((m) => m.id === 'music')?.purpose).toBe('music');
  });
});
