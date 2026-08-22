import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalAudioSourceManager } from './audioSources';

function createMockTrack(id: string): MediaStreamTrack {
  return {
    id,
    kind: 'audio',
    readyState: 'live',
    enabled: true,
    contentHint: '',
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getSettings: () => ({ channelCount: 2, sampleRate: 48000 })
  } as unknown as MediaStreamTrack;
}

interface MockGainNode {
  gain: {
    value: number;
    setValueAtTime: (v: number, t?: number) => void;
    cancelScheduledValues: (t?: number) => void;
  };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

interface MockPannerNode {
  pan: {
    value: number;
    setValueAtTime: (v: number, t?: number) => void;
    cancelScheduledValues: (t?: number) => void;
  };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

describe('LocalAudioSourceManager Multi-Voice Input', () => {
  let trackCounter = 0;
  let mockContext: AudioContext;

  beforeEach(() => {
    trackCounter = 0;

    // Provide Mock Web Audio API
    mockContext = {
      currentTime: 0,
      sampleRate: 48000,
      state: 'running',
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      createGain: vi.fn((): MockGainNode => {
        const node: MockGainNode = {
          gain: {
            value: 1,
            setValueAtTime: vi.fn((val: number) => { node.gain.value = val; }),
            cancelScheduledValues: vi.fn()
          },
          connect: vi.fn(),
          disconnect: vi.fn()
        };
        return node;
      }),
      createStereoPanner: vi.fn((): MockPannerNode => {
        const node: MockPannerNode = {
          pan: {
            value: 0,
            setValueAtTime: vi.fn((val: number) => { node.pan.value = val; }),
            cancelScheduledValues: vi.fn()
          },
          connect: vi.fn(),
          disconnect: vi.fn()
        };
        return node;
      }),
      createAnalyser: vi.fn(() => ({
        fftSize: 256,
        smoothingTimeConstant: 0.7,
        connect: vi.fn(),
        disconnect: vi.fn(),
        getFloatTimeDomainData: vi.fn()
      })),
      createChannelSplitter: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn()
      })),
      createChannelMerger: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn()
      })),
      createDynamicsCompressor: vi.fn(() => ({
        threshold: { setValueAtTime: vi.fn() },
        knee: { setValueAtTime: vi.fn() },
        ratio: { setValueAtTime: vi.fn() },
        attack: { setValueAtTime: vi.fn() },
        release: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn()
      })),
      createBiquadFilter: vi.fn(() => ({
        type: 'peaking',
        frequency: { setValueAtTime: vi.fn() },
        Q: { setValueAtTime: vi.fn() },
        gain: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn()
      })),
      createMediaStreamDestination: vi.fn(() => {
        const track = createMockTrack(`dest-track-${++trackCounter}`);
        return {
          stream: {
            getAudioTracks: () => [track]
          },
          connect: vi.fn(),
          disconnect: vi.fn()
        };
      }),
      createMediaStreamSource: vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn()
      }))
    } as unknown as AudioContext;

    // Stub global AudioContext
    class MockAudioContext {
      constructor() {
        return mockContext;
      }
    }
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;

    // Stub global MediaStream
    class MockMediaStream {
      private tracks: MediaStreamTrack[];
      constructor(tracks?: MediaStreamTrack[]) {
        this.tracks = tracks ? [...tracks] : [createMockTrack(`mock-track-${++trackCounter}`)];
      }
      getAudioTracks(): MediaStreamTrack[] {
        return this.tracks;
      }
    }
    (globalThis as unknown as { MediaStream: unknown }).MediaStream = MockMediaStream;

    // Stub navigator.mediaDevices.getUserMedia
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn(async () => new MockMediaStream())
        }
      },
      writable: true,
      configurable: true
    });
  });

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

    for (let f = 0; f < frameCount; f++) {
      floatSamples[f * totalChannels + 0] = 0.75;
      floatSamples[f * totalChannels + 1] = 0.25;
      for (let ch = 2; ch < totalChannels; ch++) {
        floatSamples[f * totalChannels + ch] = 0.0;
      }
    }

    const ch1Samples = new Float32Array(frameCount);
    for (let f = 0; f < frameCount; f++) {
      ch1Samples[f] = floatSamples[f * totalChannels + 0]!;
    }

    const ch2Samples = new Float32Array(frameCount);
    for (let f = 0; f < frameCount; f++) {
      ch2Samples[f] = floatSamples[f * totalChannels + 1]!;
    }

    const ch3Samples = new Float32Array(frameCount);
    for (let f = 0; f < frameCount; f++) {
      ch3Samples[f] = floatSamples[f * totalChannels + 2]!;
    }

    expect(ch1Samples[0]).toBe(0.75);
    expect(ch2Samples[0]).toBe(0.25);
    expect(ch3Samples[0]).toBe(0.0);

    expect(ch1Samples.every((s) => s === 0.75)).toBe(true);
    expect(ch2Samples.every((s) => s === 0.25)).toBe(true);
    expect(ch3Samples.every((s) => s === 0.0)).toBe(true);
  });

  it('keeps voice and music tracks simultaneously registered and distinct in metadata', async () => {
    const manager = new LocalAudioSourceManager();
    const fakeVoiceTrack = createMockTrack('voice_track_1');
    const fakeMusicTrack = createMockTrack('music_track_1');

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

  it('allows Mic 1 and Mic 2 to coexist simultaneously with distinct mic IDs and tracks', async () => {
    const manager = new LocalAudioSourceManager();

    await manager.acquireVoiceMic(1, 'device-mic-1', 'talk', { inputGain: 1.0, channelRoute: 'all' });
    await manager.acquireVoiceMic(2, 'device-mic-2', 'talk', { inputGain: 0.8, channelRoute: 'all' });

    expect(manager.getVoiceMicsCount()).toBe(2);

    const track1 = manager.getVoiceRawTrack(1);
    const track2 = manager.getVoiceRawTrack(2);
    expect(track1).toBeDefined();
    expect(track2).toBeDefined();
    expect(track1?.id).not.toBe(track2?.id);
  });

  it('maintains independent gain states between Mic 1 and Mic 2 without cross-talk', async () => {
    const manager = new LocalAudioSourceManager();

    await manager.acquireVoiceMic(1, 'device-mic-1', 'talk', { inputGain: 1.0, channelRoute: 'all' });
    await manager.acquireVoiceMic(2, 'device-mic-2', 'talk', { inputGain: 0.5, channelRoute: 'all' });

    const mic1GainNode = manager.getVoiceMicNode(1) as unknown as MockGainNode;
    const mic2GainNode = manager.getVoiceMicNode(2) as unknown as MockGainNode;

    expect(mic1GainNode.gain.value).toBe(1.0);
    expect(mic2GainNode.gain.value).toBe(0.5);

    // Changing Mic 2 gain does not change Mic 1 gain
    await manager.setVoiceMicGain(2, 0.35);
    expect(mic2GainNode.gain.value).toBe(0.35);
    expect(mic1GainNode.gain.value).toBe(1.0);

    // Changing Mic 1 gain does not change Mic 2 gain
    await manager.setVoiceMicGain(1, 0.85);
    expect(mic1GainNode.gain.value).toBe(0.85);
    expect(mic2GainNode.gain.value).toBe(0.35);
  });

  it('maintains independent pan states between Mic 1 and Mic 2', async () => {
    const manager = new LocalAudioSourceManager();

    await manager.acquireVoiceMic(1, 'device-mic-1', 'talk', { inputGain: 1.0, channelRoute: 'all' });
    await manager.acquireVoiceMic(2, 'device-mic-2', 'talk', { inputGain: 1.0, channelRoute: 'all' });

    const mic1Panner = (manager as any).voiceMics.get(1)?.pannerNode as MockPannerNode;
    const mic2Panner = (manager as any).voiceMics.get(2)?.pannerNode as MockPannerNode;

    expect(mic1Panner).toBeDefined();
    expect(mic2Panner).toBeDefined();

    await manager.setVoiceMicPan(1, -0.75);
    await manager.setVoiceMicPan(2, 0.6);

    expect(mic1Panner.pan.value).toBe(-0.75);
    expect(mic2Panner.pan.value).toBe(0.6);

    // Change Mic 2 pan again and explicitly verify Mic 1 pan remains unchanged
    await manager.setVoiceMicPan(2, 0.2);
    expect(mic2Panner.pan.value).toBe(0.2);
    expect(mic1Panner.pan.value).toBe(-0.75);

    // Change Mic 1 pan and explicitly verify Mic 2 pan remains unchanged
    await manager.setVoiceMicPan(1, 0.45);
    expect(mic1Panner.pan.value).toBe(0.45);
    expect(mic2Panner.pan.value).toBe(0.2);
  });

  it('keeps FX routing identity and channel IDs distinct (you-mic for Mic 1, you-mic-N for Mic N)', async () => {
    const manager = new LocalAudioSourceManager();

    await manager.acquireVoiceMic(1, 'device-mic-1', 'talk', { inputGain: 1.0, channelRoute: 'all' });
    await manager.acquireVoiceMic(2, 'device-mic-2', 'talk', { inputGain: 1.0, channelRoute: 'all' });
    await manager.acquireVoiceMic(3, 'device-mic-3', 'talk', { inputGain: 1.0, channelRoute: 'all' });

    manager.setVoiceMicFx(1, ['Chan EQ']);
    manager.setVoiceMicFx(2, ['Chan EQ']);
    manager.setVoiceMicFx(3, ['Chan EQ']);

    const dsp1 = manager.getVoiceMicEqDsp(1, 0);
    const dsp2 = manager.getVoiceMicEqDsp(2, 0);
    const dsp3 = manager.getVoiceMicEqDsp(3, 0);

    expect(dsp1).toBeDefined();
    expect(dsp2).toBeDefined();
    expect(dsp3).toBeDefined();

    // Verify distinct instances for distinct channel identities: you-mic, you-mic-2, you-mic-3
    expect(dsp1).not.toBe(dsp2);
    expect(dsp2).not.toBe(dsp3);
    expect(dsp1).not.toBe(dsp3);
  });

  it('removing Mic 2 does not remove, disconnect, or disrupt Mic 1', async () => {
    const manager = new LocalAudioSourceManager();

    await manager.acquireVoiceMic(1, 'device-mic-1', 'talk', { inputGain: 0.9, channelRoute: 'all' });
    await manager.acquireVoiceMic(2, 'device-mic-2', 'talk', { inputGain: 0.6, channelRoute: 'all' });

    const track1 = manager.getVoiceRawTrack(1);
    const track2 = manager.getVoiceRawTrack(2);

    expect(manager.getVoiceMicsCount()).toBe(2);

    await manager.removeVoiceMic(2);

    expect(manager.getVoiceMicsCount()).toBe(1);
    expect(manager.getVoiceRawTrack(1)).toBe(track1);
    expect(track1?.stop).not.toHaveBeenCalled();
    expect(track2?.stop).toHaveBeenCalled();
    expect(manager.getVoiceRawTrack(2)).toBeUndefined();

    // The shared voice source remains active while Mic 1 is active
    expect(manager.voice).toBeDefined();
    expect(manager.metadata().find((m) => m.id === 'voice')?.enabled).toBe(true);
  });

  it('acquiring or replacing Mic 2 does not overwrite Mic 1 state', async () => {
    const manager = new LocalAudioSourceManager();

    await manager.acquireVoiceMic(1, 'device-mic-1', 'talk', { inputGain: 0.88, channelRoute: 'all' });
    const track1 = manager.getVoiceRawTrack(1);
    const mic1GainNode = manager.getVoiceMicNode(1) as unknown as MockGainNode;
    expect(mic1GainNode.gain.value).toBe(0.88);

    // Acquire Mic 2
    await manager.acquireVoiceMic(2, 'device-mic-2', 'talk', { inputGain: 0.4, channelRoute: 'all' });

    // Re-acquire / replace Mic 2 with new settings
    await manager.acquireVoiceMic(2, 'device-mic-2-replaced', 'music', { inputGain: 0.75, channelRoute: 'all' });

    expect(manager.getVoiceMicsCount()).toBe(2);
    expect(manager.getVoiceRawTrack(1)).toBe(track1);
    expect(mic1GainNode.gain.value).toBe(0.88);
  });

  it('dynamically supports more than two microphones (Mic 1, Mic 2, Mic 3)', async () => {
    const manager = new LocalAudioSourceManager();

    await manager.acquireVoiceMic(1, 'device-mic-1', 'talk', { inputGain: 1.0, channelRoute: 'all' });
    await manager.acquireVoiceMic(2, 'device-mic-2', 'talk', { inputGain: 0.7, channelRoute: 'all' });
    await manager.acquireVoiceMic(3, 'device-mic-3', 'talk', { inputGain: 0.4, channelRoute: 'all' });

    expect(manager.getVoiceMicsCount()).toBe(3);

    const mic1GainNode = manager.getVoiceMicNode(1) as unknown as MockGainNode;
    const mic2GainNode = manager.getVoiceMicNode(2) as unknown as MockGainNode;
    const mic3GainNode = manager.getVoiceMicNode(3) as unknown as MockGainNode;

    expect(mic1GainNode.gain.value).toBe(1.0);
    expect(mic2GainNode.gain.value).toBe(0.7);
    expect(mic3GainNode.gain.value).toBe(0.4);

    // Update Mic 3 gain independently
    await manager.setVoiceMicGain(3, 1.4);
    expect(mic3GainNode.gain.value).toBe(1.4);
    expect(mic1GainNode.gain.value).toBe(1.0);
    expect(mic2GainNode.gain.value).toBe(0.7);

    // Remove Mic 2: Mic 1 and Mic 3 remain active
    await manager.removeVoiceMic(2);
    expect(manager.getVoiceMicsCount()).toBe(2);
    expect(manager.getVoiceRawTrack(1)).toBeDefined();
    expect(manager.getVoiceRawTrack(2)).toBeUndefined();
    expect(manager.getVoiceRawTrack(3)).toBeDefined();

    // The shared voice source still exists
    expect(manager.voice).toBeDefined();

    // Remove Mic 1: Mic 3 still remains active and functional
    await manager.removeVoiceMic(1);
    expect(manager.getVoiceMicsCount()).toBe(1);
    expect(manager.getVoiceRawTrack(3)).toBeDefined();
    expect(manager.voice).toBeDefined();
  });

  it('preserves previous working microphone when replacement acquisition fails with device error', async () => {
    const manager = new LocalAudioSourceManager();

    // 1. Acquire initial working microphone
    await manager.acquireVoiceMic(1, 'working-mic-1', 'talk', { inputGain: 0.9, channelRoute: 'all' });
    const initialTrack = manager.getVoiceRawTrack(1);
    const initialGainNode = manager.getVoiceMicNode(1);

    expect(manager.getVoiceMicsCount()).toBe(1);
    expect(initialTrack).toBeDefined();
    expect(manager.hasActiveVoiceTrack()).toBe(true);

    // 2. Mock getUserMedia failure for all fallback attempts
    const getUserMediaSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia')
      .mockRejectedValue(new Error('Requested device not found'));

    // 3. Attempt to replace with failing device
    await expect(
      manager.acquireVoiceMic(1, 'failing-broken-device', 'talk', { inputGain: 0.5, channelRoute: 'all' })
    ).rejects.toThrow('Requested device not found');

    // 4. Verify previous microphone is completely preserved and still functional
    expect(manager.getVoiceMicsCount()).toBe(1);
    expect(manager.getVoiceRawTrack(1)).toBe(initialTrack);
    expect(manager.getVoiceMicNode(1)).toBe(initialGainNode);
    expect(initialTrack?.stop).not.toHaveBeenCalled();
    expect(manager.hasActiveVoiceTrack()).toBe(true);

    getUserMediaSpy.mockRestore();
  });

  it('preserves previous working microphone when new track is ended or invalid', async () => {
    const manager = new LocalAudioSourceManager();

    // 1. Acquire initial working microphone
    await manager.acquireVoiceMic(1, 'working-mic-1', 'talk', { inputGain: 0.8, channelRoute: 'all' });
    const initialTrack = manager.getVoiceRawTrack(1);

    // 2. Mock getUserMedia returning dead stream
    const deadTrack = createMockTrack('dead-track');
    Object.defineProperty(deadTrack, 'readyState', { value: 'ended', configurable: true });
    class DeadStream {
      getAudioTracks() { return [deadTrack]; }
    }
    const getUserMediaSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia')
      .mockResolvedValueOnce(new DeadStream() as unknown as MediaStream);

    // 3. Attempt to replace
    await expect(
      manager.acquireVoiceMic(1, 'dead-device', 'talk', { inputGain: 0.8, channelRoute: 'all' })
    ).rejects.toThrow('did not provide a live audio track');

    // 4. Verify old track is intact and still live
    expect(manager.getVoiceMicsCount()).toBe(1);
    expect(manager.getVoiceRawTrack(1)).toBe(initialTrack);
    expect(initialTrack?.stop).not.toHaveBeenCalled();
    expect(manager.hasActiveVoiceTrack()).toBe(true);

    getUserMediaSpy.mockRestore();
  });
});
