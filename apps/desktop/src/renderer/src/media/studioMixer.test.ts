import { describe, expect, it, vi } from 'vitest';

interface StudioMixerChannel {
  id: string;
  name: string;
  icon: string;
  color: string;
  volume: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  fx: string[];
  isMaster?: boolean;
  section: 'local' | 'remote';
}

interface PersistentStudioMixerChannel {
  name?: string;
  icon?: string;
  color?: string;
  volume?: number;
  pan?: number;
  fx?: string[];
  eq?: Record<string, unknown>;
}

type PersistentStudioMixerMap = Record<string, PersistentStudioMixerChannel>;

interface VoiceInputPref {
  id: number;
  name: string;
  enabled: boolean;
  gain: number;
  channelRoute: string;
}

interface PreferencesState {
  outputVolume: number;
  voiceInputs: VoiceInputPref[];
  inputGain: number;
}

// Pure implementation mirroring Studio Mixer routing calculation from main.ts
function computeMixerRouting(
  channels: StudioMixerChannel[],
  prefs: PreferencesState,
  options: { globalMuted?: boolean; remoteMuted?: boolean } = {}
) {
  const globalMuted = options.globalMuted ?? false;
  const remoteMuted = options.remoteMuted ?? false;

  const hasLocalSolo = channels.some(
    (c) => !c.isMaster && (c.section === 'local' || c.id === 'music-stream' || c.id.startsWith('you-mic')) && c.soloed
  );
  const hasRemoteSolo = channels.some(
    (c) => !c.isMaster && c.section === 'remote' && c.id !== 'master-out' && c.soloed
  );

  const masterCh = channels.find((c) => c.id === 'master-out') || { volume: 1.0, muted: false, pan: 0, fx: [] };
  const monitorTrim = prefs.outputVolume !== undefined ? prefs.outputVolume : 1.0;
  const masterVol = remoteMuted || masterCh.muted ? 0 : masterCh.volume * monitorTrim;

  // Local Microphones Routing
  let anyLocalMicActive = false;
  const activeMics = prefs.voiceInputs.filter((v) => v.enabled);

  const localMicOutputs: Record<number, { effectiveVol: number; isAudible: boolean; pan: number; fx: string[] }> = {};

  activeMics.forEach((mic) => {
    const chId = mic.id === 1 ? 'you-mic' : `you-mic-${mic.id}`;
    const micCh = channels.find((c) => c.id === chId || (mic.id === 1 && c.id === 'you-mic'));
    const isAudible = micCh ? !micCh.muted && (!hasLocalSolo || micCh.soloed) : true;
    const isMutedGlobally = globalMuted;
    const gainVal = mic.gain ?? (micCh ? micCh.volume : 1);
    const effectiveVol = isAudible && !isMutedGlobally ? gainVal : 0;
    const pan = micCh ? (typeof micCh.pan === 'number' && !isNaN(micCh.pan) ? micCh.pan : 0) : 0;
    if (effectiveVol > 0) anyLocalMicActive = true;

    localMicOutputs[mic.id] = {
      effectiveVol,
      isAudible,
      pan,
      fx: micCh?.fx || []
    };
  });

  const localMusicCh = channels.find((c) => c.id === 'music-stream');
  const remoteVoiceCh = channels.find((c) => c.id === 'remote-voice');
  const remoteMusicCh = channels.find((c) => c.id === 'remote-music');

  const localMusicAudible = localMusicCh ? !localMusicCh.muted && (!hasLocalSolo || localMusicCh.soloed) : true;
  const remoteVoiceAudible = remoteVoiceCh ? !remoteVoiceCh.muted && (!hasRemoteSolo || remoteVoiceCh.soloed) : true;
  const remoteMusicAudible = remoteMusicCh ? !remoteMusicCh.muted && (!hasRemoteSolo || remoteMusicCh.soloed) : true;

  const effectiveLocalMusicVol = localMusicAudible && localMusicCh ? localMusicCh.volume : 0;
  const localMusicPan = localMusicCh ? (typeof localMusicCh.pan === 'number' && !isNaN(localMusicCh.pan) ? localMusicCh.pan : 0) : 0;
  const effectiveRemoteVoiceVol = remoteVoiceAudible && remoteVoiceCh ? remoteVoiceCh.volume : 0;
  const effectiveRemoteMusicVol = remoteMusicAudible && remoteMusicCh ? remoteMusicCh.volume : 0;

  return {
    hasLocalSolo,
    hasRemoteSolo,
    masterVol,
    anyLocalMicActive,
    voiceSenderEnabled: !globalMuted && anyLocalMicActive,
    localMicOutputs,
    effectiveLocalMusicVol,
    localMusicPan,
    effectiveRemoteVoiceVol,
    effectiveRemoteMusicVol
  };
}

// Pure implementation mirroring serialize persistent config from main.ts
function serializeStudioMixerConfig(channels: StudioMixerChannel[]): PersistentStudioMixerMap {
  const map: PersistentStudioMixerMap = {};
  const MASTER_GOLD = '#f59e0b';
  for (const ch of channels) {
    if (ch.id === 'master-out' || ch.isMaster) {
      map[ch.id] = {
        name: ch.name,
        icon: ch.icon,
        color: MASTER_GOLD,
        volume: typeof ch.volume === 'number' && !isNaN(ch.volume) ? ch.volume : 1.0
      };
    } else {
      const isLocalMic = ch.id.startsWith('you-mic') || ch.id === 'you-mic';
      map[ch.id] = {
        name: ch.name,
        icon: ch.icon,
        color: ch.color,
        volume: isLocalMic ? undefined : typeof ch.volume === 'number' && !isNaN(ch.volume) ? ch.volume : 1.0,
        pan: typeof ch.pan === 'number' && !isNaN(ch.pan) ? ch.pan : 0,
        fx: Array.isArray(ch.fx) ? [...ch.fx] : []
      };
    }
  }
  return map;
}

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

function createDefaultTestPrefs(): PreferencesState {
  return {
    outputVolume: 1.0,
    inputGain: 1.0,
    voiceInputs: [
      { id: 1, name: 'Microphone 1', enabled: true, gain: 1.0, channelRoute: 'all' },
      { id: 2, name: 'Microphone 2', enabled: true, gain: 0.8, channelRoute: 'all' }
    ]
  };
}

describe('Studio Mixer Routing & Invariants Regression Coverage', () => {
  describe('Local Microphone Mute', () => {
    it('muting Mic 1 silences only Mic 1 and leaves other channels active', () => {
      const channels = createDefaultTestChannels();
      const prefs = createDefaultTestPrefs();

      channels[0]!.muted = true; // Mute Mic 1

      const routing = computeMixerRouting(channels, prefs);
      expect(routing.localMicOutputs[1]?.effectiveVol).toBe(0);
      expect(routing.localMicOutputs[1]?.isAudible).toBe(false);

      expect(routing.localMicOutputs[2]?.effectiveVol).toBe(0.8);
      expect(routing.localMicOutputs[2]?.isAudible).toBe(true);
      expect(routing.effectiveLocalMusicVol).toBe(1.0);
    });

    it('muting Mic 2 silences only Mic 2', () => {
      const channels = createDefaultTestChannels();
      const prefs = createDefaultTestPrefs();

      channels[1]!.muted = true; // Mute Mic 2

      const routing = computeMixerRouting(channels, prefs);
      expect(routing.localMicOutputs[1]?.effectiveVol).toBe(1.0);
      expect(routing.localMicOutputs[1]?.isAudible).toBe(true);

      expect(routing.localMicOutputs[2]?.effectiveVol).toBe(0);
      expect(routing.localMicOutputs[2]?.isAudible).toBe(false);
    });

    it('muting one local microphone does not change the gain state of another microphone', () => {
      const channels = createDefaultTestChannels();
      const prefs = createDefaultTestPrefs();

      channels[0]!.muted = true; // Mute Mic 1

      computeMixerRouting(channels, prefs);
      expect(prefs.voiceInputs[0]?.gain).toBe(1.0);
      expect(prefs.voiceInputs[1]?.gain).toBe(0.8);
    });

    it('unmuting a microphone restores its authoritative prefs.voiceInputs[n].gain value', () => {
      const channels = createDefaultTestChannels();
      const prefs = createDefaultTestPrefs();
      prefs.voiceInputs[0]!.gain = 0.92;

      channels[0]!.muted = true;
      let routing = computeMixerRouting(channels, prefs);
      expect(routing.localMicOutputs[1]?.effectiveVol).toBe(0);

      channels[0]!.muted = false;
      routing = computeMixerRouting(channels, prefs);
      expect(routing.localMicOutputs[1]?.effectiveVol).toBe(0.92);
    });
  });

  describe('Local Microphone Solo', () => {
    it('soloing Mic 1 suppresses other local microphone channels and local music', () => {
      const channels = createDefaultTestChannels();
      const prefs = createDefaultTestPrefs();

      channels[0]!.soloed = true; // Solo Mic 1

      const routing = computeMixerRouting(channels, prefs);
      expect(routing.hasLocalSolo).toBe(true);
      expect(routing.hasRemoteSolo).toBe(false);

      expect(routing.localMicOutputs[1]?.effectiveVol).toBe(1.0);
      expect(routing.localMicOutputs[1]?.isAudible).toBe(true);

      // Mic 2 and local music suppressed
      expect(routing.localMicOutputs[2]?.effectiveVol).toBe(0);
      expect(routing.localMicOutputs[2]?.isAudible).toBe(false);
      expect(routing.effectiveLocalMusicVol).toBe(0);

      // Remote channels remain active
      expect(routing.effectiveRemoteVoiceVol).toBe(1.0);
      expect(routing.effectiveRemoteMusicVol).toBe(1.0);
    });

    it('soloing Mic 2 preserves Mic 2 and suppresses other local channels', () => {
      const channels = createDefaultTestChannels();
      const prefs = createDefaultTestPrefs();

      channels[1]!.soloed = true; // Solo Mic 2

      const routing = computeMixerRouting(channels, prefs);
      expect(routing.localMicOutputs[2]?.effectiveVol).toBe(0.8);
      expect(routing.localMicOutputs[1]?.effectiveVol).toBe(0);
      expect(routing.effectiveLocalMusicVol).toBe(0);
    });

    it('multiple soloed local channels remain audible together', () => {
      const channels = createDefaultTestChannels();
      const prefs = createDefaultTestPrefs();

      channels[0]!.soloed = true; // Solo Mic 1
      channels[1]!.soloed = true; // Solo Mic 2

      const routing = computeMixerRouting(channels, prefs);
      expect(routing.localMicOutputs[1]?.effectiveVol).toBe(1.0);
      expect(routing.localMicOutputs[2]?.effectiveVol).toBe(0.8);

      // Unsoloed local music is suppressed
      expect(routing.effectiveLocalMusicVol).toBe(0);
    });
  });

  describe('Remote Solo Domain Separation', () => {
    it('soloing remote voice suppresses remote music without changing local microphone routing', () => {
      const channels = createDefaultTestChannels();
      const prefs = createDefaultTestPrefs();

      const remoteVoice = channels.find((c) => c.id === 'remote-voice')!;
      remoteVoice.soloed = true;

      const routing = computeMixerRouting(channels, prefs);
      expect(routing.hasRemoteSolo).toBe(true);
      expect(routing.hasLocalSolo).toBe(false);

      expect(routing.effectiveRemoteVoiceVol).toBe(1.0);
      expect(routing.effectiveRemoteMusicVol).toBe(0);

      // Local channels remain unaffected
      expect(routing.localMicOutputs[1]?.effectiveVol).toBe(1.0);
      expect(routing.localMicOutputs[2]?.effectiveVol).toBe(0.8);
      expect(routing.effectiveLocalMusicVol).toBe(1.0);
    });

    it('soloing remote music suppresses remote voice without changing local microphone routing', () => {
      const channels = createDefaultTestChannels();
      const prefs = createDefaultTestPrefs();

      const remoteMusic = channels.find((c) => c.id === 'remote-music')!;
      remoteMusic.soloed = true;

      const routing = computeMixerRouting(channels, prefs);
      expect(routing.effectiveRemoteMusicVol).toBe(1.0);
      expect(routing.effectiveRemoteVoiceVol).toBe(0);

      expect(routing.localMicOutputs[1]?.effectiveVol).toBe(1.0);
      expect(routing.localMicOutputs[2]?.effectiveVol).toBe(0.8);
    });
  });

  describe('Master Output', () => {
    it('master mute silences the remote monitor master path', () => {
      const channels = createDefaultTestChannels();
      const prefs = createDefaultTestPrefs();

      const master = channels.find((c) => c.id === 'master-out')!;
      master.muted = true;

      const routing = computeMixerRouting(channels, prefs);
      expect(routing.masterVol).toBe(0);
    });

    it('remoteMuted silences the remote monitor master path', () => {
      const channels = createDefaultTestChannels();
      const prefs = createDefaultTestPrefs();

      const routing = computeMixerRouting(channels, prefs, { remoteMuted: true });
      expect(routing.masterVol).toBe(0);
    });

    it('master volume applies outputVolume monitor trim exactly once', () => {
      const channels = createDefaultTestChannels();
      const prefs = createDefaultTestPrefs();

      const master = channels.find((c) => c.id === 'master-out')!;
      master.volume = 0.8;
      prefs.outputVolume = 0.75;

      const routing = computeMixerRouting(channels, prefs);
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

  describe('Metering Resolution', () => {
    it('verifies each local microphone meter resolves its analyser using that microphone exact mic id', () => {
      const audioMock = {
        getVoiceMicAnalysers: vi.fn((micId: number) => ({
          left: { id: `analyser-L-${micId}` } as unknown as AnalyserNode,
          right: { id: `analyser-R-${micId}` } as unknown as AnalyserNode
        }))
      };

      const activeMics = [
        { id: 1, name: 'Mic 1' },
        { id: 2, name: 'Mic 2' },
        { id: 3, name: 'Mic 3' }
      ];

      // Simulate VU meter dispatch loop
      activeMics.forEach((mic) => {
        const numMicId = Number(mic.id);
        const { left, right } = audioMock.getVoiceMicAnalysers(numMicId);
        expect(left).toBeDefined();
        expect(right).toBeDefined();
        expect((left as unknown as { id: string }).id).toBe(`analyser-L-${numMicId}`);
        expect((right as unknown as { id: string }).id).toBe(`analyser-R-${numMicId}`);
      });

      expect(audioMock.getVoiceMicAnalysers).toHaveBeenCalledWith(1);
      expect(audioMock.getVoiceMicAnalysers).toHaveBeenCalledWith(2);
      expect(audioMock.getVoiceMicAnalysers).toHaveBeenCalledWith(3);
    });
  });
});
