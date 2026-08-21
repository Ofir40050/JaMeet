import { $ } from '../../core/dom';
import { channelEqDspRegistry } from '../audio/eq/channelEq';
import {
  type StudioMixerChannel,
  computeMixerRouting
} from './studioMixerLogic';
import {
  loadSavedStudioMixerConfig,
  saveStudioMixerConfig as saveStudioMixerConfigStorage
} from './studioMixerStorage';
import { getStereoBalanceGains } from '../audio/sources/stereoBalance';
import {
  startMixerVuAnimation as startMixerVuAnimationHelper,
  stopMixerVuAnimation as stopMixerVuAnimationHelper
} from './studioMixerVuMeter';
import {
  renderStudioMixer as renderStudioMixerHelper
} from './studioMixerUi';
import type { Preferences } from '../../core/preferences';
import type { LocalAudioSourceManager } from '../audio/sources/audioSources';

export interface StudioMixerControllerContext {
  getChannels: () => StudioMixerChannel[];
  setChannels: (channels: StudioMixerChannel[]) => void;
  isStudioMixerOpen: () => boolean;
  setStudioMixerOpen: (open: boolean) => void;
  getPreferences: () => Preferences;
  isMuted: () => boolean;
  isRemoteMuted: () => boolean;
  isInCall: () => boolean;
  isVoiceStereo: () => boolean;
  getAudio: () => LocalAudioSourceManager;
  getRemoteAudioCtx: () => AudioContext | undefined;
  getRemoteVoiceGain: () => GainNode | undefined;
  getRemoteMusicGain: () => GainNode | undefined;
  getRemoteMasterGain: () => GainNode | undefined;
  isRemoteVoiceStereo: () => boolean;
  setRemoteVoiceStereo: (val: boolean) => void;
  getRemoteVoicePanner: () => StereoPannerNode | undefined;
  getRemoteVoiceMeterSplitter: () => ChannelSplitterNode | undefined;
  getRemoteVoiceSplitter: () => ChannelSplitterNode | undefined;
  getRemoteVoiceLeftGain: () => GainNode | undefined;
  getRemoteVoiceRightGain: () => GainNode | undefined;
  getRemoteVoiceMerger: () => ChannelMergerNode | undefined;
  getRemoteMusicSplitter: () => ChannelSplitterNode | undefined;
  getRemoteMusicLeftGain: () => GainNode | undefined;
  getRemoteMusicRightGain: () => GainNode | undefined;
  getRemoteMusicMerger: () => ChannelMergerNode | undefined;
  getRemoteVoiceAnalyserL: () => AnalyserNode | undefined;
  getRemoteVoiceAnalyserR: () => AnalyserNode | undefined;
  getRemoteMusicAnalyserL: () => AnalyserNode | undefined;
  getRemoteMusicAnalyserR: () => AnalyserNode | undefined;
  getRemoteMasterAnalyserL: () => AnalyserNode | undefined;
  getRemoteMasterAnalyserR: () => AnalyserNode | undefined;
  getRemoteVoiceFxNodes: () => AudioNode[];
  setRemoteVoiceFxNodes: (nodes: AudioNode[]) => void;
  getRemoteMusicFxNodes: () => AudioNode[];
  setRemoteMusicFxNodes: (nodes: AudioNode[]) => void;
  getLastConnectedVoiceFx: () => string;
  setLastConnectedVoiceFx: (val: string) => void;
  getLastConnectedMusicFx: () => string;
  setLastConnectedMusicFx: (val: string) => void;
  onSavePreferences: () => void;
}

export function createStudioMixerController(ctx: StudioMixerControllerContext) {
  function saveStudioMixerConfig(immediate = true): void {
    saveStudioMixerConfigStorage(ctx.getChannels(), immediate);
  }

  function startMixerVuAnimation(): void {
    startMixerVuAnimationHelper({
      isMixerOpen: () => ctx.isStudioMixerOpen(),
      getChannels: () => ctx.getChannels(),
      getVoiceInputs: () => ctx.getPreferences().voiceInputs,
      getVoiceMicAnalysers: (id) => ctx.getAudio().getVoiceMicAnalysers(id),
      getMusicAnalysers: () => ctx.getAudio().getMusicAnalysers(),
      getRemoteVoiceAnalysers: () => ({ left: ctx.getRemoteVoiceAnalyserL(), right: ctx.getRemoteVoiceAnalyserR() }),
      getRemoteMusicAnalysers: () => ({ left: ctx.getRemoteMusicAnalyserL(), right: ctx.getRemoteMusicAnalyserR() }),
      getRemoteMasterAnalysers: () => ({ left: ctx.getRemoteMasterAnalyserL(), right: ctx.getRemoteMasterAnalyserR() }),
      isRemoteMuted: () => ctx.isRemoteMuted()
    });
  }

  function stopMixerVuAnimation(): void {
    stopMixerVuAnimationHelper();
  }

  function renderStudioMixer(): void {
    renderStudioMixerHelper({
      getChannels: () => ctx.getChannels(),
      getVoiceInputs: () => ctx.getPreferences().voiceInputs,
      onApplyMixerAudioRouting: () => applyMixerAudioRouting(),
      onSavePreferences: () => ctx.onSavePreferences(),
      onSetInputGain: (val) => {
        ctx.getPreferences().inputGain = val;
      },
      getVoiceMicEqDsp: (micIdx, slotIdx) => ctx.getAudio().getVoiceMicEqDsp(micIdx, slotIdx),
      getMusicEqDsp: (slotIdx) => ctx.getAudio().getMusicEqDsp(slotIdx),
      onToggleStudioMixer: (forceOpen) => toggleStudioMixer(forceOpen)
    });
  }

  function syncMixerChannelsWithVoiceInputs(): void {
    const prefs = ctx.getPreferences();
    const studioMixerChannels = ctx.getChannels();
    const savedMap = loadSavedStudioMixerConfig();
    const enabledMics = (prefs.voiceInputs && prefs.voiceInputs.length > 0)
      ? prefs.voiceInputs.filter((v) => v.enabled)
      : [{ id: 1, name: 'Microphone 1', enabled: true, gain: 1, channelRoute: '1' }];

    // Preserve existing in-memory channel settings (during active session runtime)
    const existingMap = new Map<string, StudioMixerChannel>();
    studioMixerChannels.forEach((ch) => existingMap.set(ch.id, ch));

    const DEFAULT_APP_BLUE = '#3b82f6';
    const MASTER_GOLD = '#f59e0b';

    const newLocalMicChannels: StudioMixerChannel[] = enabledMics.map((mic) => {
      const chId = mic.id === 1 ? 'you-mic' : `you-mic-${mic.id}`;
      const existing = existingMap.get(chId) || (mic.id === 1 ? existingMap.get('you-mic-1') : undefined);
      const saved = savedMap[chId] || (mic.id === 1 ? savedMap['you-mic-1'] : undefined);

      const defaultName = mic.id === 1 ? 'Mic 1' : `Mic ${mic.id}`;
      const name = existing?.name ?? saved?.name ?? defaultName;
      const icon = existing?.icon ?? saved?.icon ?? 'mic';
      const rawColor = existing?.color ?? saved?.color ?? DEFAULT_APP_BLUE;
      const color = rawColor === MASTER_GOLD ? DEFAULT_APP_BLUE : rawColor;
      const volume = mic.gain ?? 1.0;
      const pan = existing?.pan ?? saved?.pan ?? 0;
      const fx = existing?.fx ?? (saved?.fx ? [...saved.fx] : []);

      return {
        id: chId,
        name,
        icon,
        color,
        volume,
        pan,
        muted: existing?.muted ?? false,
        soloed: existing?.soloed ?? false,
        fx,
        section: 'local'
      };
    });

    // Local music stream
    const existingMusic = existingMap.get('music-stream');
    const savedMusic = savedMap['music-stream'];
    const musicCh: StudioMixerChannel = {
      id: 'music-stream',
      name: existingMusic?.name ?? savedMusic?.name ?? 'Music',
      icon: existingMusic?.icon ?? savedMusic?.icon ?? 'waves',
      color: (existingMusic?.color ?? savedMusic?.color) === '#a855f7' ? DEFAULT_APP_BLUE : (existingMusic?.color ?? savedMusic?.color ?? DEFAULT_APP_BLUE),
      volume: existingMusic?.volume ?? savedMusic?.volume ?? 1.0,
      pan: existingMusic?.pan ?? savedMusic?.pan ?? 0,
      muted: existingMusic?.muted ?? false,
      soloed: existingMusic?.soloed ?? false,
      fx: existingMusic?.fx ?? (savedMusic?.fx ? [...savedMusic.fx] : []),
      section: 'local'
    };

    // Remote Section
    const existingRemoteVoice = existingMap.get('remote-voice');
    const savedRemoteVoice = savedMap['remote-voice'];
    let remoteVoiceName = existingRemoteVoice?.name ?? savedRemoteVoice?.name ?? 'Vocal';
    if (remoteVoiceName === 'Mic 1') remoteVoiceName = 'Vocal';
    const remoteVoiceColor = (existingRemoteVoice?.color ?? savedRemoteVoice?.color) === '#22c55e'
      ? DEFAULT_APP_BLUE
      : (existingRemoteVoice?.color ?? savedRemoteVoice?.color ?? DEFAULT_APP_BLUE);

    const remoteVoiceCh: StudioMixerChannel = {
      id: 'remote-voice',
      name: remoteVoiceName,
      icon: existingRemoteVoice?.icon ?? savedRemoteVoice?.icon ?? 'mic',
      color: remoteVoiceColor,
      volume: existingRemoteVoice?.volume ?? savedRemoteVoice?.volume ?? 1.0,
      pan: existingRemoteVoice?.pan ?? savedRemoteVoice?.pan ?? 0,
      muted: existingRemoteVoice?.muted ?? false,
      soloed: existingRemoteVoice?.soloed ?? false,
      fx: existingRemoteVoice?.fx ?? (savedRemoteVoice?.fx ? [...savedRemoteVoice.fx] : []),
      section: 'remote'
    };

    const existingRemoteMusic = existingMap.get('remote-music');
    const savedRemoteMusic = savedMap['remote-music'];
    const remoteMusicColor = (existingRemoteMusic?.color ?? savedRemoteMusic?.color) === '#06b6d4'
      ? DEFAULT_APP_BLUE
      : (existingRemoteMusic?.color ?? savedRemoteMusic?.color ?? DEFAULT_APP_BLUE);

    const remoteMusicCh: StudioMixerChannel = {
      id: 'remote-music',
      name: existingRemoteMusic?.name ?? savedRemoteMusic?.name ?? 'Music',
      icon: existingRemoteMusic?.icon ?? savedRemoteMusic?.icon ?? 'waves',
      color: remoteMusicColor,
      volume: existingRemoteMusic?.volume ?? savedRemoteMusic?.volume ?? 1.0,
      pan: existingRemoteMusic?.pan ?? savedRemoteMusic?.pan ?? 0,
      muted: existingRemoteMusic?.muted ?? false,
      soloed: existingRemoteMusic?.soloed ?? false,
      fx: existingRemoteMusic?.fx ?? (savedRemoteMusic?.fx ? [...savedRemoteMusic.fx] : []),
      section: 'remote'
    };

    const existingMaster = existingMap.get('master-out');
    const savedMaster = savedMap['master-out'];
    let masterName = existingMaster?.name ?? savedMaster?.name ?? 'Monitor Master';
    if (masterName === 'Master') masterName = 'Monitor Master';

    const masterOutCh: StudioMixerChannel = {
      id: 'master-out',
      name: masterName,
      icon: existingMaster?.icon ?? savedMaster?.icon ?? 'crown',
      color: MASTER_GOLD,
      volume: existingMaster?.volume ?? savedMaster?.volume ?? 1.0,
      pan: 0,
      muted: existingMaster?.muted ?? false,
      soloed: false,
      fx: [],
      isMaster: true,
      section: 'remote'
    };

    const updatedChannels = [
      ...newLocalMicChannels,
      musicCh,
      remoteVoiceCh,
      remoteMusicCh,
      masterOutCh
    ];
    ctx.setChannels(updatedChannels);

    if (ctx.isStudioMixerOpen()) {
      renderStudioMixer();
      applyMixerAudioRouting();
    }
  }

  function toggleStudioMixer(forceOpen?: boolean): void {
    const modal = $('session-studio-mixer-modal');
    if (!modal) return;
    const isCurrentlyOpen = ctx.isStudioMixerOpen();
    const studioMixerOpen = forceOpen !== undefined ? forceOpen : !isCurrentlyOpen;
    ctx.setStudioMixerOpen(studioMixerOpen);
    modal.classList.toggle('hidden', !studioMixerOpen);
    $('toggle-session-mixer')?.classList.toggle('active', studioMixerOpen);

    if (studioMixerOpen) {
      try {
        syncMixerChannelsWithVoiceInputs();
        renderStudioMixer();
        startMixerVuAnimation();
      } catch (err) {
        console.error('Failed to render studio mixer:', err);
      }
    } else {
      stopMixerVuAnimation();
      $('mixer-fx-picker-popover')?.classList.add('hidden');
      $('mixer-icon-picker-popover')?.classList.add('hidden');
    }
  }

  function applyMixerAudioRouting(): void {
    const prefs = ctx.getPreferences();
    const studioMixerChannels = ctx.getChannels();
    const audio = ctx.getAudio();

    const routing = computeMixerRouting({
      channels: studioMixerChannels,
      voiceInputs: prefs.voiceInputs,
      outputVolume: prefs.outputVolume,
      globalMuted: ctx.isMuted(),
      remoteMuted: ctx.isRemoteMuted()
    });
    const masterVol = routing.masterVol;

    routing.localMics.forEach((micResult, micId) => {
      const micCh = studioMixerChannels.find((c) => c.id === micResult.channelId || (micId === 1 && c.id === 'you-mic'));
      if (micCh) {
        micCh.volume = micResult.gainVal;
      }

      for (const prefix of ['', 'call-']) {
        const slider = document.querySelector<HTMLInputElement>(`#${prefix}gain-${micId}`);
        const valLabel = document.querySelector<HTMLElement>(`#${prefix}gain-val-${micId}`);
        if (slider) slider.value = String(micResult.gainVal);
        if (valLabel) valLabel.textContent = `${Math.round(micResult.gainVal * 100)}%`;
      }
      if (micId === 1) {
        for (const otherId of ['input-gain', 'call-input-gain']) {
          const el = document.querySelector<HTMLInputElement>(`#${otherId}`);
          if (el) el.value = String(micResult.gainVal);
        }
        for (const labelId of ['gain-value', 'call-gain-value']) {
          const el = document.getElementById(labelId);
          if (el) el.textContent = `${Math.round(micResult.gainVal * 100)}%`;
        }
      }

      // Apply to audio engine
      audio.setVoiceMicFx(micId, micResult.fx);
      void audio.setVoiceMicGain(micId, micResult.effectiveVol);
      void audio.setVoiceMicPan(micId, micResult.pan);
    });

    audio.setEnabled('voice', routing.voiceSenderEnabled);

    const localMusicCh = studioMixerChannels.find((c) => c.id === 'music-stream');
    const remoteVoiceCh = studioMixerChannels.find((c) => c.id === 'remote-voice');
    const remoteMusicCh = studioMixerChannels.find((c) => c.id === 'remote-music');

    const effectiveLocalMusicVol = routing.effectiveLocalMusicVol;
    const localMusicPan = routing.localMusicPan;
    const effectiveRemoteVoiceVol = routing.effectiveRemoteVoiceVol;
    const effectiveRemoteMusicVol = routing.effectiveRemoteMusicVol;

    audio.setMusicFx(routing.localMusicFx);
    audio.setEnabled('music', effectiveLocalMusicVol > 0);
    void audio.applyMusicGain(effectiveLocalMusicVol);
    void audio.applyMusicPan(localMusicPan);

    // 2. Control Web Audio DSP Engine in real-time
    const remoteAudioCtx = ctx.getRemoteAudioCtx();
    if (remoteAudioCtx && remoteAudioCtx.state !== 'closed') {
      const now = remoteAudioCtx.currentTime;
      if (ctx.isInCall()) {
        ctx.setRemoteVoiceStereo(ctx.isVoiceStereo());
      }

      const remoteVoiceGain = ctx.getRemoteVoiceGain();
      const remoteMusicGain = ctx.getRemoteMusicGain();
      const remoteMasterGain = ctx.getRemoteMasterGain();
      const remoteVoiceIsStereo = ctx.isRemoteVoiceStereo();
      const remoteVoicePanner = ctx.getRemoteVoicePanner();
      const remoteVoiceLeftGain = ctx.getRemoteVoiceLeftGain();
      const remoteVoiceRightGain = ctx.getRemoteVoiceRightGain();
      const remoteMusicLeftGain = ctx.getRemoteMusicLeftGain();
      const remoteMusicRightGain = ctx.getRemoteMusicRightGain();
      const remoteVoiceSplitter = ctx.getRemoteVoiceSplitter();
      const remoteVoiceMerger = ctx.getRemoteVoiceMerger();
      const remoteVoiceMeterSplitter = ctx.getRemoteVoiceMeterSplitter();
      const remoteVoiceAnalyserL = ctx.getRemoteVoiceAnalyserL();
      const remoteVoiceAnalyserR = ctx.getRemoteVoiceAnalyserR();
      const remoteMusicSplitter = ctx.getRemoteMusicSplitter();

      // Real Gain Routing (0 to 1.5x)
      if (remoteVoiceGain) remoteVoiceGain.gain.setValueAtTime(effectiveRemoteVoiceVol, now);
      if (remoteMusicGain) remoteMusicGain.gain.setValueAtTime(effectiveRemoteMusicVol, now);
      if (remoteMasterGain) remoteMasterGain.gain.setValueAtTime(masterVol, now);

      // Real Stereo Panning (Mono Voice) & Stereo Balance (Stereo Voice & Stereo Music)
      const voicePan = typeof remoteVoiceCh?.pan === 'number' && !isNaN(remoteVoiceCh.pan) ? remoteVoiceCh.pan : 0;
      if (remoteVoiceIsStereo) {
        if (remoteVoiceLeftGain && remoteVoiceRightGain) {
          const { left, right } = getStereoBalanceGains(voicePan);
          remoteVoiceLeftGain.gain.setValueAtTime(left, now);
          remoteVoiceRightGain.gain.setValueAtTime(right, now);
        }
      } else {
        if (remoteVoicePanner) {
          remoteVoicePanner.pan.setValueAtTime(voicePan, now);
        }
      }

      if (remoteMusicLeftGain && remoteMusicRightGain && remoteMusicCh) {
        const musicPan = typeof remoteMusicCh.pan === 'number' && !isNaN(remoteMusicCh.pan) ? remoteMusicCh.pan : 0;
        const { left, right } = getStereoBalanceGains(musicPan);
        remoteMusicLeftGain.gain.setValueAtTime(left, now);
        remoteMusicRightGain.gain.setValueAtTime(right, now);
      }

      // Dynamic Channel FX Routing: Remote Voice (rebuild topology when fx array or mono/stereo mode changes)
      if (remoteVoiceGain && (remoteVoicePanner || (remoteVoiceSplitter && remoteVoiceMerger))) {
        const voiceSlots = Array.isArray(remoteVoiceCh?.fx) ? remoteVoiceCh.fx.slice(0, 4) : [];
        const voiceFxKey = `${remoteVoiceIsStereo ? 'stereo' : 'mono'}|${voiceSlots.map((f, i) => `${i}:${f || ''}`).join('|')}`;
        if (voiceFxKey !== ctx.getLastConnectedVoiceFx()) {
          try { remoteVoiceGain.disconnect(); } catch {}
          for (const node of ctx.getRemoteVoiceFxNodes()) {
            try { node.disconnect(); } catch {}
          }
          ctx.setRemoteVoiceFxNodes([]);

          try { remoteVoicePanner?.disconnect(); } catch {}
          try { remoteVoiceMeterSplitter?.disconnect(); } catch {}
          try { remoteVoiceMerger?.disconnect(); } catch {}
          try { remoteVoiceSplitter?.disconnect(); } catch {}
          try { remoteVoiceLeftGain?.disconnect(); } catch {}
          try { remoteVoiceRightGain?.disconnect(); } catch {}

          const newVoiceFxNodes: AudioNode[] = [];
          let currentVoiceSource: AudioNode = remoteVoiceGain;
          for (let i = 0; i < 4; i++) {
            const fxName = voiceSlots[i];
            if (fxName === 'Chan EQ') {
              const eqDsp = channelEqDspRegistry.getOrCreate('remote-voice', i, remoteAudioCtx);
              currentVoiceSource.connect(eqDsp.inputNode);
              currentVoiceSource = eqDsp.outputNode;
              newVoiceFxNodes.push(eqDsp.outputNode);
            } else if (fxName === 'Compressor') {
              channelEqDspRegistry.remove('remote-voice', i);
              const compressorNode = remoteAudioCtx.createDynamicsCompressor();
              compressorNode.threshold.setValueAtTime(-18.0, now);
              compressorNode.knee.setValueAtTime(6.0, now);
              compressorNode.ratio.setValueAtTime(4.0, now);
              compressorNode.attack.setValueAtTime(0.005, now);
              compressorNode.release.setValueAtTime(0.08, now);

              currentVoiceSource.connect(compressorNode);
              currentVoiceSource = compressorNode;
              newVoiceFxNodes.push(compressorNode);
            } else {
              channelEqDspRegistry.remove('remote-voice', i);
            }
          }
          ctx.setRemoteVoiceFxNodes(newVoiceFxNodes);

          if (remoteVoiceIsStereo && remoteVoiceSplitter && remoteVoiceLeftGain && remoteVoiceRightGain && remoteVoiceMerger && remoteVoiceAnalyserL && remoteVoiceAnalyserR && remoteMasterGain) {
            currentVoiceSource.connect(remoteVoiceSplitter);
            remoteVoiceSplitter.connect(remoteVoiceLeftGain, 0, 0);
            remoteVoiceSplitter.connect(remoteVoiceRightGain, 1, 0);
            remoteVoiceLeftGain.connect(remoteVoiceMerger, 0, 0);
            remoteVoiceRightGain.connect(remoteVoiceMerger, 0, 1);
            remoteVoiceMerger.connect(remoteMasterGain);
            remoteVoiceLeftGain.connect(remoteVoiceAnalyserL);
            remoteVoiceRightGain.connect(remoteVoiceAnalyserR);
          } else if (remoteVoicePanner && remoteVoiceMeterSplitter && remoteVoiceAnalyserL && remoteVoiceAnalyserR && remoteMasterGain) {
            currentVoiceSource.connect(remoteVoicePanner);
            remoteVoicePanner.connect(remoteMasterGain);
            remoteVoicePanner.connect(remoteVoiceMeterSplitter);
            remoteVoiceMeterSplitter.connect(remoteVoiceAnalyserL, 0);
            remoteVoiceMeterSplitter.connect(remoteVoiceAnalyserR, 1);
          }

          ctx.setLastConnectedVoiceFx(voiceFxKey);
        }
      }

      // Dynamic Channel FX Routing: Remote Music (rebuild topology only when fx array changes)
      if (remoteMusicGain && remoteMusicSplitter) {
        const musicSlots = Array.isArray(remoteMusicCh?.fx) ? remoteMusicCh.fx.slice(0, 4) : [];
        const musicFxKey = musicSlots.map((f, i) => `${i}:${f || ''}`).join('|');
        if (musicFxKey !== ctx.getLastConnectedMusicFx()) {
          try { remoteMusicGain.disconnect(); } catch {}
          for (const node of ctx.getRemoteMusicFxNodes()) {
            try { node.disconnect(); } catch {}
          }
          ctx.setRemoteMusicFxNodes([]);

          const newMusicFxNodes: AudioNode[] = [];
          let currentMusicSource: AudioNode = remoteMusicGain;
          for (let i = 0; i < 4; i++) {
            const fxName = musicSlots[i];
            if (fxName === 'Chan EQ') {
              const eqDsp = channelEqDspRegistry.getOrCreate('remote-music', i, remoteAudioCtx);
              currentMusicSource.connect(eqDsp.inputNode);
              currentMusicSource = eqDsp.outputNode;
              newMusicFxNodes.push(eqDsp.outputNode);
            } else if (fxName === 'Compressor') {
              channelEqDspRegistry.remove('remote-music', i);
              const compressorNode = remoteAudioCtx.createDynamicsCompressor();
              compressorNode.threshold.setValueAtTime(-12.0, now);
              compressorNode.knee.setValueAtTime(6.0, now);
              compressorNode.ratio.setValueAtTime(3.0, now);
              compressorNode.attack.setValueAtTime(0.01, now);
              compressorNode.release.setValueAtTime(0.1, now);

              currentMusicSource.connect(compressorNode);
              currentMusicSource = compressorNode;
              newMusicFxNodes.push(compressorNode);
            } else {
              channelEqDspRegistry.remove('remote-music', i);
            }
          }
          ctx.setRemoteMusicFxNodes(newMusicFxNodes);

          currentMusicSource.connect(remoteMusicSplitter);
          ctx.setLastConnectedMusicFx(musicFxKey);
        }
      }
    }

    const voiceAudio = document.getElementById('remote-voice-audio') as HTMLAudioElement | null;
    const musicAudio = document.getElementById('remote-music-audio') as HTMLAudioElement | null;
    if (voiceAudio) voiceAudio.volume = Math.min(1.0, masterVol * effectiveRemoteVoiceVol);
    if (musicAudio) musicAudio.volume = Math.min(1.0, masterVol * effectiveRemoteMusicVol);
  }

  return {
    syncMixerChannelsWithVoiceInputs,
    toggleStudioMixer,
    applyMixerAudioRouting,
    saveStudioMixerConfig,
    renderStudioMixer,
    startMixerVuAnimation,
    stopMixerVuAnimation
  };
}
