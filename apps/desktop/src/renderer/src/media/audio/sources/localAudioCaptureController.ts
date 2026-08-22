import { $ } from '../../../core/dom';
import { logger } from '../../../core/logger';
import { fetchRunningAudioApps, type RunningAudioApp } from './runningApplications';
import type { AudioMode, MediaMetadata } from '@jameet/shared';
import type { Preferences } from '../../../core/preferences';
import type { LevelMeter, LevelReading } from '../meter/levelMeter';
import type { HardwareAudioDeviceInfo } from '../../devices/hardwareAudioDeviceUtils';
import type { LocalAudioSourceManager } from './audioSources';

export interface LocalAudioCaptureContext {
  getPreferences: () => Preferences;
  onSavePreferences: () => void;
  onSetModeRadios: (mode: AudioMode) => void;
  getVoiceMeters: () => Map<number, LevelMeter>;
  getActiveMicLevels: () => Map<number, number>;
  getActiveMicPeaks: () => Map<number, number>;
  getAudio: () => LocalAudioSourceManager;
  getMusicMeter: () => LevelMeter;
  getMeterInterval: () => number;
  getOrCreateVoiceMeter: (id: number) => LevelMeter;
  onRenderVoiceLevel: (micId: number, reading: LevelReading) => void;
  onRenderMusicLevel: (reading: LevelReading) => void;
  onSetLastLocalMusicDb: (db: number) => void;
  onSetLastLocalMusicPeakDb: (db: number) => void;
  getCachedHardwareDevices: () => HardwareAudioDeviceInfo[];
  onSyncMixerChannelsWithVoiceInputs: () => void;
  onApplyMixerAudioRouting: () => void;
  onRenderAudioLimitations: () => void;
  onUpdateLocalPreviews: () => void;
  onUpdateCallMode: () => void;
  onPopulateMusicAppSelectOptions: (apps: RunningAudioApp[], prefs: Preferences) => void;
  isInCall: () => boolean;
  getCurrentCode: () => string;
  getMetadata: () => MediaMetadata;
  onSignalingUpdateMedia: (code: string, metadata: MediaMetadata) => void;
  onRtcAudioChanged: (mode: AudioMode) => Promise<void>;
  onRtcAudioSourceChanged: (source: 'music' | 'screen-audio') => Promise<void>;
}

export function createLocalAudioCaptureController(ctx: LocalAudioCaptureContext) {
  async function syncAllVoiceMics(mode = ctx.getPreferences().mode): Promise<void> {
    const prefs = ctx.getPreferences();
    prefs.mode = mode;
    ctx.onSavePreferences();
    ctx.onSetModeRadios(mode);
    const activeIds = new Set(prefs.voiceInputs.filter((v) => v.enabled).map((v) => v.id));

    const voiceMeters = ctx.getVoiceMeters();
    const activeMicLevels = ctx.getActiveMicLevels();
    const activeMicPeaks = ctx.getActiveMicPeaks();
    const audio = ctx.getAudio();

    for (const id of Array.from(voiceMeters.keys())) {
      if (!activeIds.has(id)) {
        const m = voiceMeters.get(id);
        if (m) await m.stop();
        voiceMeters.delete(id);
        activeMicLevels.delete(id);
        activeMicPeaks.delete(id);
        await audio.removeVoiceMic(id);
      }
    }

    for (const mic of prefs.voiceInputs) {
      if (!mic.enabled) continue;
      try {
        await audio.acquireVoiceMic(mic.id, mic.deviceId, mode, {
          sampleRate: prefs.sampleRate ?? 44_100,
          inputGain: mic.gain ?? 1,
          stereo: prefs.stereoMusic !== false,
          channelRoute: mic.channelRoute ?? '1'
        });
        const node = audio.getVoiceMicNode(mic.id);
        if (node) {
          const m = ctx.getOrCreateVoiceMeter(mic.id);
          await m.startFromNode(node, ctx.getMeterInterval(), (reading) => ctx.onRenderVoiceLevel(mic.id, reading));
        } else {
          const track = audio.getVoiceRawTrack(mic.id);
          if (track) {
            const m = ctx.getOrCreateVoiceMeter(mic.id);
            await m.start(track, (reading) => ctx.onRenderVoiceLevel(mic.id, reading), ctx.getMeterInterval());
          }
        }
      } catch (error) {
        logger.warn('audio_init_failure', `Failed to acquire microphone ${mic.id}`, { micId: mic.id, deviceId: mic.deviceId, sampleRate: prefs.sampleRate }, error);
        console.warn(`Failed to acquire microphone ${mic.id}:`, error);
        const node = audio.getVoiceMicNode(mic.id);
        const track = audio.getVoiceRawTrack(mic.id);
        if (!node && !track) {
          const m = voiceMeters.get(mic.id);
          if (m) await m.stop();
          activeMicLevels.delete(mic.id);
          activeMicPeaks.delete(mic.id);
        }
        throw error;
      }
    }

    ctx.onSyncMixerChannelsWithVoiceInputs();
    ctx.onApplyMixerAudioRouting();
    ctx.onRenderAudioLimitations();
    ctx.onUpdateLocalPreviews();
    ctx.onUpdateCallMode();
    if (ctx.isInCall()) {
      ctx.onSignalingUpdateMedia(ctx.getCurrentCode(), ctx.getMetadata());
      await ctx.onRtcAudioChanged(mode);
    }
  }

  async function replaceAudioInput(deviceId: string | undefined, mode = ctx.getPreferences().mode): Promise<void> {
    const prefs = ctx.getPreferences();
    const prevDeviceId = prefs.voiceInputs[0]?.deviceId;
    const prevAudioInputId = prefs.audioInputId;
    if (prefs.voiceInputs.length === 0) {
      prefs.voiceInputs.push({ id: 1, name: 'Microphone 1 (Primary · Lead)', deviceId, channelRoute: '1', gain: 1, enabled: true });
    } else {
      prefs.voiceInputs[0]!.deviceId = deviceId;
    }
    prefs.audioInputId = deviceId;
    prefs.mode = mode;
    try {
      await syncAllVoiceMics(mode);
      ctx.onSavePreferences();
    } catch (err) {
      console.warn('Failed to replace audio input:', err);
      if (prefs.voiceInputs[0]) prefs.voiceInputs[0].deviceId = prevDeviceId;
      prefs.audioInputId = prevAudioInputId;
      ctx.onSavePreferences();
      throw err;
    }
  }

  async function updateVoiceInputTransaction(
    micId: number,
    updates: { deviceId?: string; channelRoute?: string; gain?: number },
    mode = ctx.getPreferences().mode
  ): Promise<void> {
    const prefs = ctx.getPreferences();
    const mic = prefs.voiceInputs.find((m) => m.id === micId);
    if (!mic) throw new Error(`Microphone ${micId} not found`);

    const prevMicState = { ...mic };
    const prevAudioInputId = prefs.audioInputId;
    const prevVoiceChannel = prefs.voiceChannel;
    const prevInputGain = prefs.inputGain;

    if (updates.deviceId !== undefined) {
      mic.deviceId = updates.deviceId;
      if (micId === 1) prefs.audioInputId = updates.deviceId;
    }
    if (updates.channelRoute !== undefined) {
      mic.channelRoute = updates.channelRoute;
      if (micId === 1) prefs.voiceChannel = updates.channelRoute;
    }
    if (updates.gain !== undefined) {
      mic.gain = updates.gain;
      if (micId === 1) prefs.inputGain = updates.gain;
    }

    try {
      await syncAllVoiceMics(mode);
      ctx.onSavePreferences();
    } catch (err) {
      console.warn(`Failed to update microphone ${micId} preferences:`, err);
      Object.assign(mic, prevMicState);
      if (micId === 1) {
        prefs.audioInputId = prevAudioInputId;
        prefs.voiceChannel = prevVoiceChannel;
        prefs.inputGain = prevInputGain;
      }
      ctx.onSavePreferences();
      throw err;
    }
  }

  async function refreshRunningApps(): Promise<void> {
    const apps = await fetchRunningAudioApps();
    const prefs = ctx.getPreferences();
    ctx.onPopulateMusicAppSelectOptions(apps, prefs);
  }

  async function replaceMusicInput(): Promise<void> {
    const prefs = ctx.getPreferences();
    const type = prefs.musicSourceType;
    const musicMeter = ctx.getMusicMeter();
    const audio = ctx.getAudio();

    if (type === 'none') {
      await musicMeter.stop();
      ctx.onSetLastLocalMusicDb(-60);
      ctx.onSetLastLocalMusicPeakDb(-60);
      await audio.remove('music');
      $('music-in-indicator')?.classList.remove('active');
    } else if (type === 'app') {
      const pid = prefs.musicAppPid;
      if (pid) {
        try {
          const source = await audio.acquireMusicFromApp(pid, prefs.musicAppName || 'Application');
          const musicNode = audio.getMusicNode();
          if (musicNode) {
            await musicMeter.startFromNode(musicNode, ctx.getMeterInterval(), ctx.onRenderMusicLevel);
          } else {
            await musicMeter.start(source.track, ctx.onRenderMusicLevel, ctx.getMeterInterval());
          }
          for (const statusId of ['music-app-status', 'call-music-app-status']) {
            const el = document.getElementById(statusId);
            if (el) el.textContent = `Capturing ${prefs.musicAppName || 'App'} · Stereo 48 kHz (Native)`;
          }
        } catch (err) {
          logger.warn('audio_init_failure', 'Failed to acquire application audio output', { type: 'app', pid, appName: prefs.musicAppName }, err);
          await musicMeter.stop();
          ctx.onSetLastLocalMusicDb(-60);
          ctx.onSetLastLocalMusicPeakDb(-60);
          await audio.remove('music');
          for (const statusId of ['music-app-status', 'call-music-app-status']) {
            const el = document.getElementById(statusId);
            if (el) {
              const isUnsupported = err instanceof Error && (err.message.includes('not supported') || err.message.includes('not available'));
              el.textContent = isUnsupported
                ? 'DAW App capture unavailable on this platform (Use physical input)'
                : 'Waiting for application audio output';
            }
          }
        }
      } else {
        await musicMeter.stop();
        ctx.onSetLastLocalMusicDb(-60);
        ctx.onSetLastLocalMusicPeakDb(-60);
        await audio.remove('music');
      }
    } else if (type === 'system') {
      try {
        const source = await audio.acquireMusicFromApp('global', 'Computer Audio');
        const musicNode = audio.getMusicNode();
        if (musicNode) {
          await musicMeter.startFromNode(musicNode, ctx.getMeterInterval(), ctx.onRenderMusicLevel);
        } else {
          await musicMeter.start(source.track, ctx.onRenderMusicLevel, ctx.getMeterInterval());
        }
      } catch (err) {
        logger.warn('audio_init_failure', 'Failed to acquire system computer audio', { type: 'system' }, err);
        await musicMeter.stop();
        ctx.onSetLastLocalMusicDb(-60);
        ctx.onSetLastLocalMusicPeakDb(-60);
        await audio.remove('music');
        $('music-in-indicator')?.classList.remove('active');
      }
    } else if (type === 'interface') {
      const selectedDeviceId = prefs.musicInputId || prefs.audioOutputId || 'default';
      const cachedHardwareDevices = ctx.getCachedHardwareDevices();
      const hw = cachedHardwareDevices.find((d) => d.uid === selectedDeviceId) ||
                 cachedHardwareDevices.find((d) => selectedDeviceId && d.uid.includes(selectedDeviceId)) ||
                 cachedHardwareDevices.find((d) => d.defaultOutput) ||
                 cachedHardwareDevices[0];
      const targetUID = hw?.uid || selectedDeviceId;
      try {
        const source = await audio.acquireMusic(targetUID, {
          sampleRate: prefs.sampleRate,
          stereo: prefs.stereoMusic !== false,
          channelRoute: prefs.musicChannel || '1-2'
        });
        const musicNode = audio.getMusicNode();
        if (musicNode) {
          await musicMeter.startFromNode(musicNode, ctx.getMeterInterval(), ctx.onRenderMusicLevel);
        } else {
          await musicMeter.start(source.track, ctx.onRenderMusicLevel, ctx.getMeterInterval());
        }
      } catch (err) {
        logger.warn('audio_init_failure', 'Failed to acquire audio interface for music', { type: 'interface', targetUID }, err);
        await musicMeter.stop();
        ctx.onSetLastLocalMusicDb(-60);
        ctx.onSetLastLocalMusicPeakDb(-60);
        await audio.remove('music');
        $('music-in-indicator')?.classList.remove('active');
      }
    }
    ctx.onApplyMixerAudioRouting();
    ctx.onSavePreferences();
    if (ctx.isInCall()) {
      await ctx.onRtcAudioSourceChanged('music');
      ctx.onSignalingUpdateMedia(ctx.getCurrentCode(), ctx.getMetadata());
    }
  }

  return {
    syncAllVoiceMics,
    replaceAudioInput,
    updateVoiceInputTransaction,
    refreshRunningApps,
    replaceMusicInput
  };
}
