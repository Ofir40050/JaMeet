import type { ChannelEqConfig } from '../audio/eq/channelEq';

export interface StudioMixerChannel {
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

export interface PersistentStudioMixerChannel {
  name?: string;
  icon?: string;
  color?: string;
  volume?: number;
  pan?: number;
  fx?: string[];
  eq?: Record<string, ChannelEqConfig>;
}

export type PersistentStudioMixerMap = Record<string, PersistentStudioMixerChannel>;

export interface StudioMixerVoiceInput {
  id: number;
  name?: string;
  enabled: boolean;
  gain?: number;
  channelRoute?: string;
}

export interface LocalMicRoutingResult {
  micId: number;
  channelId: string;
  gainVal: number;
  effectiveVol: number;
  isAudible: boolean;
  pan: number;
  fx: string[];
}

export interface StudioMixerRoutingResult {
  hasLocalSolo: boolean;
  hasRemoteSolo: boolean;
  masterVol: number;
  anyLocalMicActive: boolean;
  voiceSenderEnabled: boolean;
  localMics: Map<number, LocalMicRoutingResult>;
  effectiveLocalMusicVol: number;
  localMusicPan: number;
  localMusicFx: string[];
  effectiveRemoteVoiceVol: number;
  effectiveRemoteMusicVol: number;
}

export function getLocalMicChannelId(micId: number): string {
  return micId === 1 ? 'you-mic' : `you-mic-${micId}`;
}

export function parseLocalMicId(channelId: string): number | undefined {
  if (channelId === 'you-mic') return 1;
  if (channelId.startsWith('you-mic-')) {
    const parsed = parseInt(channelId.replace('you-mic-', ''), 10);
    return isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

export function serializeStudioMixerConfig(
  channels: StudioMixerChannel[],
  getEqConfig?: (channelId: string, slotIndex: number) => ChannelEqConfig | undefined
): PersistentStudioMixerMap {
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
      const eqData: Record<string, ChannelEqConfig> = {};
      if (Array.isArray(ch.fx) && getEqConfig) {
        for (let i = 0; i < ch.fx.length; i++) {
          if (ch.fx[i] === 'Chan EQ') {
            const conf = getEqConfig(ch.id, i);
            if (conf) eqData[i] = conf;
          }
        }
      }
      map[ch.id] = {
        name: ch.name,
        icon: ch.icon,
        color: ch.color,
        volume: isLocalMic ? undefined : typeof ch.volume === 'number' && !isNaN(ch.volume) ? ch.volume : 1.0,
        pan: typeof ch.pan === 'number' && !isNaN(ch.pan) ? ch.pan : 0,
        fx: Array.isArray(ch.fx) ? [...ch.fx] : [],
        eq: Object.keys(eqData).length > 0 ? eqData : undefined
      };
    }
  }
  return map;
}

export function computeMixerRouting(params: {
  channels: StudioMixerChannel[];
  voiceInputs: StudioMixerVoiceInput[];
  outputVolume?: number;
  globalMuted?: boolean;
  remoteMuted?: boolean;
}): StudioMixerRoutingResult {
  const { channels, voiceInputs, outputVolume = 1.0, globalMuted = false, remoteMuted = false } = params;

  const hasLocalSolo = channels.some(
    (c) => !c.isMaster && (c.section === 'local' || c.id === 'music-stream' || c.id.startsWith('you-mic')) && c.soloed
  );
  const hasRemoteSolo = channels.some(
    (c) => !c.isMaster && c.section === 'remote' && c.id !== 'master-out' && c.soloed
  );

  const masterCh = channels.find((c) => c.id === 'master-out') || { volume: 1.0, muted: false, pan: 0, fx: [] };
  const masterVol = remoteMuted || masterCh.muted ? 0 : masterCh.volume * outputVolume;

  let anyLocalMicActive = false;
  const activeMics = voiceInputs && voiceInputs.length > 0
    ? voiceInputs.filter((v) => v.enabled)
    : [{ id: 1, name: 'Microphone 1', enabled: true, gain: 1, channelRoute: '1' }];

  const localMics = new Map<number, LocalMicRoutingResult>();

  activeMics.forEach((mic) => {
    const chId = getLocalMicChannelId(mic.id);
    const micCh = channels.find((c) => c.id === chId || (mic.id === 1 && c.id === 'you-mic'));
    const isAudible = micCh ? !micCh.muted && (!hasLocalSolo || micCh.soloed) : true;
    const gainVal = mic.gain ?? (micCh ? micCh.volume : 1);
    const effectiveVol = isAudible && !globalMuted ? gainVal : 0;
    const pan = micCh ? (typeof micCh.pan === 'number' && !isNaN(micCh.pan) ? micCh.pan : 0) : 0;
    const fx = micCh?.fx || [];

    if (effectiveVol > 0) anyLocalMicActive = true;

    localMics.set(mic.id, {
      micId: mic.id,
      channelId: chId,
      gainVal,
      effectiveVol,
      isAudible,
      pan,
      fx
    });
  });

  const localMusicCh = channels.find((c) => c.id === 'music-stream');
  const remoteVoiceCh = channels.find((c) => c.id === 'remote-voice');
  const remoteMusicCh = channels.find((c) => c.id === 'remote-music');

  const localMusicAudible = localMusicCh ? !localMusicCh.muted && (!hasLocalSolo || localMusicCh.soloed) : true;
  const remoteVoiceAudible = remoteVoiceCh ? !remoteVoiceCh.muted && (!hasRemoteSolo || remoteVoiceCh.soloed) : true;
  const remoteMusicAudible = remoteMusicCh ? !remoteMusicCh.muted && (!hasRemoteSolo || remoteMusicCh.soloed) : true;

  const effectiveLocalMusicVol = localMusicAudible && localMusicCh ? localMusicCh.volume : 0;
  const localMusicPan = localMusicCh ? (typeof localMusicCh.pan === 'number' && !isNaN(localMusicCh.pan) ? localMusicCh.pan : 0) : 0;
  const localMusicFx = localMusicCh?.fx || [];
  const effectiveRemoteVoiceVol = remoteVoiceAudible && remoteVoiceCh ? remoteVoiceCh.volume : 0;
  const effectiveRemoteMusicVol = remoteMusicAudible && remoteMusicCh ? remoteMusicCh.volume : 0;

  return {
    hasLocalSolo,
    hasRemoteSolo,
    masterVol,
    anyLocalMicActive,
    voiceSenderEnabled: !globalMuted && anyLocalMicActive,
    localMics,
    effectiveLocalMusicVol,
    localMusicPan,
    localMusicFx,
    effectiveRemoteVoiceVol,
    effectiveRemoteMusicVol
  };
}
