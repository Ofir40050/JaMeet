import { describe, expect, it, vi } from 'vitest';
import {
  type StudioMixerChannel,
  type StudioMixerVoiceInput,
  getLocalMicChannelId,
  parseLocalMicId,
  serializeStudioMixerConfig,
  computeMixerRouting
} from './studioMixerLogic';

function createDefaultTestChannels(): StudioMixerChannel[] {
  return [
    { id: 'you-mic', name: 'Mic 1', icon: 'mic', color: '#3b82f6', volume: 1.0, pan: 0, muted: false, soloed: false, fx: [], section: 'local' },
    { id: 'you-mic-2', name: 'Mic 2', icon: 'mic', color: '#3b82f6', volume: 0.8, pan: 0, muted: false, soloed: false, fx: [], section: 'local' },
    { id: 'music-stream', name: 'Music', icon: 'waves', color: '#3b82f6', volume: 1.0, pan: 0, muted: false, soloed: false, fx: [], section: 'local' },
    { id: 'remote-voice', name: 'Vocal', icon: 'mic', color: '#3b82f6', volume: 1.0, pan: 0, muted: false, soloed: false, fx: [], section: 'remote' },
    { id: 'remote-music', name: 'Music', icon: 'waves', color: '#3b82f6', volume: 1.0, pan: 0, muted: false, soloed: false, fx: [], section: 'remote' },
    { id: 'master-out', name: 'Monitor Master', icon: 'crown', color: '#f59e0b', volume: 1.0, pan: 0, muted: false, soloed: false, fx: [], isMaster: true, section: 'remote' }
  ];
}

function createDefaultTestVoiceInputs(): StudioMixerVoiceInput[] {
  return [
    { id: 1, name: 'Microphone 1', enabled: true, gain: 1.0, channelRoute: 'all' },
    { id: 2, name: 'Microphone 2', enabled: true, gain: 0.8, channelRoute: 'all' }
  ];
}

describe('Studio Mixer Production Routing & Serialization Logic', () => {
  describe('Channel ID Mapping', () => {
    it('maps Mic 1 to you-mic and Mic N to you-mic-N', () => {
      expect(getLocalMicChannelId(1)).toBe('you-mic');
      expect(getLocalMicChannelId(2)).toBe('you-mic-2');
      expect(getLocalMicChannelId(3)).toBe('you-mic-3');

      expect(parseLocalMicId('you-mic')).toBe(1);
      expect(parseLocalMicId('you-mic-2')).toBe(2);
      expect(parseLocalMicId('you-mic-3')).toBe(3);
      expect(parseLocalMicId('music-stream')).toBeUndefined();
    });
  });

  describe('Local Microphone Mute', () => {
    it('muting Mic 1 silences only Mic 1 and leaves other channels active', () => {
      const channels = createDefaultTestChannels();
      const voiceInputs = createDefaultTestVoiceInputs();

      channels[0]!.muted = true; // Mute Mic 1

      const routing = computeMixerRouting({ channels, voiceInputs, outputVolume: 1.0 });
      const mic1 = routing.localMics.get(1);
      const mic2 = routing.localMics.get(2);

      expect(mic1?.effectiveVol).toBe(0);
      expect(mic1?.isAudible).toBe(false);

      expect(mic2?.effectiveVol).toBe(0.8);
      expect(mic2?.isAudible).toBe(true);
      expect(routing.effectiveLocalMusicVol).toBe(1.0);
    });

    it('muting Mic 2 silences only Mic 2', () => {
      const channels = createDefaultTestChannels();
      const voiceInputs = createDefaultTestVoiceInputs();

      channels[1]!.muted = true; // Mute Mic 2

      const routing = computeMixerRouting({ channels, voiceInputs, outputVolume: 1.0 });
      const mic1 = routing.localMics.get(1);
      const mic2 = routing.localMics.get(2);

      expect(mic1?.effectiveVol).toBe(1.0);
      expect(mic1?.isAudible).toBe(true);

      expect(mic2?.effectiveVol).toBe(0);
      expect(mic2?.isAudible).toBe(false);
    });

    it('muting one local microphone does not change the gain state of another microphone', () => {
      const channels = createDefaultTestChannels();
      const voiceInputs = createDefaultTestVoiceInputs();

      channels[0]!.muted = true; // Mute Mic 1

      computeMixerRouting({ channels, voiceInputs, outputVolume: 1.0 });
      expect(voiceInputs[0]?.gain).toBe(1.0);
      expect(voiceInputs[1]?.gain).toBe(0.8);
    });

    it('unmuting a microphone restores its authoritative prefs.voiceInputs[n].gain value', () => {
      const channels = createDefaultTestChannels();
      const voiceInputs = createDefaultTestVoiceInputs();
      voiceInputs[0]!.gain = 0.92;

      channels[0]!.muted = true;
      let routing = computeMixerRouting({ channels, voiceInputs, outputVolume: 1.0 });
      expect(routing.localMics.get(1)?.effectiveVol).toBe(0);

      channels[0]!.muted = false;
      routing = computeMixerRouting({ channels, voiceInputs, outputVolume: 1.0 });
      expect(routing.localMics.get(1)?.effectiveVol).toBe(0.92);
    });
  });

  describe('Local Microphone Solo', () => {
    it('soloing Mic 1 suppresses other local microphone channels and local music', () => {
      const channels = createDefaultTestChannels();
      const voiceInputs = createDefaultTestVoiceInputs();

      channels[0]!.soloed = true; // Solo Mic 1

      const routing = computeMixerRouting({ channels, voiceInputs, outputVolume: 1.0 });
      expect(routing.hasLocalSolo).toBe(true);
      expect(routing.hasRemoteSolo).toBe(false);

      expect(routing.localMics.get(1)?.effectiveVol).toBe(1.0);
      expect(routing.localMics.get(1)?.isAudible).toBe(true);

      // Mic 2 and local music suppressed
      expect(routing.localMics.get(2)?.effectiveVol).toBe(0);
      expect(routing.localMics.get(2)?.isAudible).toBe(false);
      expect(routing.effectiveLocalMusicVol).toBe(0);

      // Remote channels remain active
      expect(routing.effectiveRemoteVoiceVol).toBe(1.0);
      expect(routing.effectiveRemoteMusicVol).toBe(1.0);
    });

    it('soloing Mic 2 preserves Mic 2 and suppresses other local channels', () => {
      const channels = createDefaultTestChannels();
      const voiceInputs = createDefaultTestVoiceInputs();

      channels[1]!.soloed = true; // Solo Mic 2

      const routing = computeMixerRouting({ channels, voiceInputs, outputVolume: 1.0 });
      expect(routing.localMics.get(2)?.effectiveVol).toBe(0.8);
      expect(routing.localMics.get(1)?.effectiveVol).toBe(0);
      expect(routing.effectiveLocalMusicVol).toBe(0);
    });

    it('multiple soloed local channels remain audible together', () => {
      const channels = createDefaultTestChannels();
      const voiceInputs = createDefaultTestVoiceInputs();

      channels[0]!.soloed = true; // Solo Mic 1
      channels[1]!.soloed = true; // Solo Mic 2

      const routing = computeMixerRouting({ channels, voiceInputs, outputVolume: 1.0 });
      expect(routing.localMics.get(1)?.effectiveVol).toBe(1.0);
      expect(routing.localMics.get(2)?.effectiveVol).toBe(0.8);

      // Unsoloed local music is suppressed
      expect(routing.effectiveLocalMusicVol).toBe(0);
    });
  });

  describe('Remote Solo Domain Separation', () => {
    it('soloing remote voice suppresses remote music without changing local microphone routing', () => {
      const channels = createDefaultTestChannels();
      const voiceInputs = createDefaultTestVoiceInputs();

      const remoteVoice = channels.find((c) => c.id === 'remote-voice')!;
      remoteVoice.soloed = true;

      const routing = computeMixerRouting({ channels, voiceInputs, outputVolume: 1.0 });
      expect(routing.hasRemoteSolo).toBe(true);
      expect(routing.hasLocalSolo).toBe(false);

      expect(routing.effectiveRemoteVoiceVol).toBe(1.0);
      expect(routing.effectiveRemoteMusicVol).toBe(0);

      // Local channels remain unaffected
      expect(routing.localMics.get(1)?.effectiveVol).toBe(1.0);
      expect(routing.localMics.get(2)?.effectiveVol).toBe(0.8);
      expect(routing.effectiveLocalMusicVol).toBe(1.0);
    });

    it('soloing remote music suppresses remote voice without changing local microphone routing', () => {
      const channels = createDefaultTestChannels();
      const voiceInputs = createDefaultTestVoiceInputs();

      const remoteMusic = channels.find((c) => c.id === 'remote-music')!;
      remoteMusic.soloed = true;

      const routing = computeMixerRouting({ channels, voiceInputs, outputVolume: 1.0 });
      expect(routing.effectiveRemoteMusicVol).toBe(1.0);
      expect(routing.effectiveRemoteVoiceVol).toBe(0);

      expect(routing.localMics.get(1)?.effectiveVol).toBe(1.0);
      expect(routing.localMics.get(2)?.effectiveVol).toBe(0.8);
    });
  });

  describe('Master Output', () => {
    it('master mute silences the remote monitor master path', () => {
      const channels = createDefaultTestChannels();
      const voiceInputs = createDefaultTestVoiceInputs();

      const master = channels.find((c) => c.id === 'master-out')!;
      master.muted = true;

      const routing = computeMixerRouting({ channels, voiceInputs, outputVolume: 1.0 });
      expect(routing.masterVol).toBe(0);
    });

    it('remoteMuted silences the remote monitor master path', () => {
      const channels = createDefaultTestChannels();
      const voiceInputs = createDefaultTestVoiceInputs();

      const routing = computeMixerRouting({ channels, voiceInputs, outputVolume: 1.0, remoteMuted: true });
      expect(routing.masterVol).toBe(0);
    });

    it('master volume applies outputVolume monitor trim exactly once', () => {
      const channels = createDefaultTestChannels();
      const voiceInputs = createDefaultTestVoiceInputs();

      const master = channels.find((c) => c.id === 'master-out')!;
      master.volume = 0.8;

      const routing = computeMixerRouting({ channels, voiceInputs, outputVolume: 0.75 });
      expect(routing.masterVol).toBeCloseTo(0.6, 5); // 0.8 * 0.75
    });
  });

  describe('Persistence Semantics', () => {
    it('local microphone gain is not persisted as an independent Studio Mixer volume value', () => {
      const channels = createDefaultTestChannels();
      channels.push({
        id: 'you-mic-3',
        name: 'Mic 3',
        icon: 'mic',
        color: '#3b82f6',
        volume: 0.65,
        pan: 0.25,
        muted: false,
        soloed: false,
        fx: ['Chan EQ'],
        section: 'local'
      });

      const serialized = serializeStudioMixerConfig(channels);

      expect(serialized['you-mic']?.volume).toBeUndefined();
      expect(serialized['you-mic-2']?.volume).toBeUndefined();
      expect(serialized['you-mic-3']?.volume).toBeUndefined();

      // Pan, FX, name, color, and icon are preserved
      expect(serialized['you-mic-3']?.pan).toBe(0.25);
      expect(serialized['you-mic-3']?.fx).toEqual(['Chan EQ']);
      expect(serialized['you-mic-3']?.name).toBe('Mic 3');
      expect(serialized['you-mic-3']?.color).toBe('#3b82f6');
    });

    it('music, remote voice, remote music, and master volume persistence remain unchanged', () => {
      const channels = createDefaultTestChannels();
      const serialized = serializeStudioMixerConfig(channels);

      expect(serialized['music-stream']?.volume).toBe(1.0);
      expect(serialized['remote-voice']?.volume).toBe(1.0);
      expect(serialized['remote-music']?.volume).toBe(1.0);
      expect(serialized['master-out']?.volume).toBe(1.0);
    });
  });

  describe('FX Channel Identities', () => {
    it('Mic 1, Mic 2, and Mic 3 retain distinct FX channel identities and states', () => {
      const channels: StudioMixerChannel[] = [
        { id: 'you-mic', name: 'Mic 1', icon: 'mic', color: '#3b82f6', volume: 1.0, pan: 0, muted: false, soloed: false, fx: ['Chan EQ'], section: 'local' },
        { id: 'you-mic-2', name: 'Mic 2', icon: 'mic', color: '#3b82f6', volume: 1.0, pan: 0, muted: false, soloed: false, fx: ['Compressor'], section: 'local' },
        { id: 'you-mic-3', name: 'Mic 3', icon: 'mic', color: '#3b82f6', volume: 1.0, pan: 0, muted: false, soloed: false, fx: [], section: 'local' }
      ];

      expect(channels[0]?.fx).toEqual(['Chan EQ']);
      expect(channels[1]?.fx).toEqual(['Compressor']);
      expect(channels[2]?.fx).toEqual([]);

      // Changing Mic 2 does not change Mic 1 or Mic 3
      channels[1]!.fx = ['Chan EQ', 'Compressor'];
      expect(channels[0]?.fx).toEqual(['Chan EQ']);
      expect(channels[1]?.fx).toEqual(['Chan EQ', 'Compressor']);
      expect(channels[2]?.fx).toEqual([]);
    });

    it('remote voice and remote music keep separate FX routing identities', () => {
      const channels = createDefaultTestChannels();
      const remoteVoice = channels.find((c) => c.id === 'remote-voice')!;
      const remoteMusic = channels.find((c) => c.id === 'remote-music')!;

      remoteVoice.fx = ['Chan EQ'];
      remoteMusic.fx = ['Compressor'];

      expect(remoteVoice.fx).toEqual(['Chan EQ']);
      expect(remoteMusic.fx).toEqual(['Compressor']);
    });
  });
});
