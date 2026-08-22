import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalAudioCaptureController } from './localAudioCaptureController';
import type { Preferences } from '../../../core/preferences';
import { LevelMeter } from '../meter/levelMeter';
import type { LocalAudioSourceManager } from './audioSources';

describe('LocalAudioCaptureController Voice Input Transaction', () => {
  let prefs: Preferences;
  let savePreferencesMock: ReturnType<typeof vi.fn>;
  let voiceMeters: Map<number, LevelMeter>;
  let activeMicLevels: Map<number, number>;
  let activeMicPeaks: Map<number, number>;
  let mockAudio: Partial<LocalAudioSourceManager>;

  beforeEach(() => {
    savePreferencesMock = vi.fn();
    voiceMeters = new Map();
    activeMicLevels = new Map();
    activeMicPeaks = new Map();

    prefs = {
      audioInputId: 'working-mic-1',
      voiceChannel: '1',
      inputGain: 1.0,
      sampleRate: 48000,
      mode: 'talk',
      voiceInputs: [
        { id: 1, name: 'Microphone 1', deviceId: 'working-mic-1', channelRoute: '1', gain: 1.0, enabled: true }
      ]
    } as unknown as Preferences;

    mockAudio = {
      acquireVoiceMic: vi.fn(async () => ({}) as any),
      getVoiceMicNode: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() } as any)),
      getVoiceRawTrack: vi.fn(() => ({ readyState: 'live', stop: vi.fn() } as any)),
      removeVoiceMic: vi.fn(async () => {}),
      remove: vi.fn(async () => {})
    };
  });

  function createController(audioOverrides: Partial<LocalAudioSourceManager> = {}) {
    const audio = { ...mockAudio, ...audioOverrides } as LocalAudioSourceManager;
    return createLocalAudioCaptureController({
      getPreferences: () => prefs,
      onSavePreferences: savePreferencesMock,
      onSetModeRadios: vi.fn(),
      getVoiceMeters: () => voiceMeters,
      getOrCreateVoiceMeter: (id: number) => {
        let m = voiceMeters.get(id);
        if (!m) {
          m = {
            start: vi.fn().mockResolvedValue(undefined),
            startFromNode: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockResolvedValue(undefined)
          } as unknown as LevelMeter;
          voiceMeters.set(id, m);
        }
        return m;
      },
      getActiveMicLevels: () => activeMicLevels,
      getActiveMicPeaks: () => activeMicPeaks,
      getAudio: () => audio,
      getMusicMeter: () => new LevelMeter(),
      getCachedHardwareDevices: () => [],
      getMeterInterval: () => 50,
      onRenderVoiceLevel: vi.fn(),
      onRenderMusicLevel: vi.fn(),
      onSyncMixerChannelsWithVoiceInputs: vi.fn(),
      onApplyMixerAudioRouting: vi.fn(),
      onRenderAudioLimitations: vi.fn(),
      onUpdateLocalPreviews: vi.fn(),
      onUpdateCallMode: vi.fn(),
      isInCall: () => false,
      onSignalingUpdateMedia: vi.fn(),
      getCurrentCode: () => 'ROOM123',
      getMetadata: () => ({}),
      onRtcAudioChanged: vi.fn(async () => {}),
      onRtcAudioSourceChanged: vi.fn(async () => {}),
      onPopulateMusicAppSelectOptions: vi.fn(),
      onSetLastLocalMusicDb: vi.fn(),
      onSetLastLocalMusicPeakDb: vi.fn()
    });
  }

  it('successfully updates mic deviceId and saves preferences on success', async () => {
    const controller = createController();

    await controller.updateVoiceInputTransaction(1, { deviceId: 'new-valid-mic' });

    expect(prefs.voiceInputs[0]!.deviceId).toBe('new-valid-mic');
    expect(prefs.audioInputId).toBe('new-valid-mic');
    expect(savePreferencesMock).toHaveBeenCalled();
  });

  it('rolls back mic deviceId and preferences when acquisition fails', async () => {
    const controller = createController({
      acquireVoiceMic: vi.fn().mockRejectedValueOnce(new Error('Hardware device busy'))
    });

    await expect(
      controller.updateVoiceInputTransaction(1, { deviceId: 'busy-hardware-mic' })
    ).rejects.toThrow('Hardware device busy');

    // Preferences and mic state must be rolled back to initial working device
    expect(prefs.voiceInputs[0]!.deviceId).toBe('working-mic-1');
    expect(prefs.audioInputId).toBe('working-mic-1');
    expect(savePreferencesMock).toHaveBeenCalled();
  });

  it('rolls back channelRoute and preferences when channel route switch fails', async () => {
    const controller = createController({
      acquireVoiceMic: vi.fn().mockRejectedValueOnce(new Error('Channel unavailable'))
    });

    await expect(
      controller.updateVoiceInputTransaction(1, { channelRoute: '5-6' })
    ).rejects.toThrow('Channel unavailable');

    expect(prefs.voiceInputs[0]!.channelRoute).toBe('1');
    expect(prefs.voiceChannel).toBe('1');
  });
});
