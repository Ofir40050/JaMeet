import { $ } from '../../core/dom';
import { deviceError } from '../devices/deviceError';
import { LevelMeter } from '../audio/meter/levelMeter';
import { startRemoteVoiceBridge, stopRemoteVoiceBridge } from './remoteVoiceBridge';
import type { Preferences } from '../../core/preferences';

export interface RemoteAudioGraphContext {
  getRemoteAudioCtx: () => AudioContext | undefined;
  setRemoteAudioCtx: (ctx: AudioContext | undefined) => void;
  getRemoteVoiceGain: () => GainNode | undefined;
  setRemoteVoiceGain: (node: GainNode | undefined) => void;
  getRemoteMusicGain: () => GainNode | undefined;
  setRemoteMusicGain: (node: GainNode | undefined) => void;
  getRemoteMasterGain: () => GainNode | undefined;
  setRemoteMasterGain: (node: GainNode | undefined) => void;
  isRemoteVoiceStereo: () => boolean;
  setRemoteVoiceStereo: (val: boolean) => void;
  getRemoteVoicePanner: () => StereoPannerNode | undefined;
  setRemoteVoicePanner: (node: StereoPannerNode | undefined) => void;
  getRemoteVoiceMeterSplitter: () => ChannelSplitterNode | undefined;
  setRemoteVoiceMeterSplitter: (node: ChannelSplitterNode | undefined) => void;
  getRemoteVoiceSplitter: () => ChannelSplitterNode | undefined;
  setRemoteVoiceSplitter: (node: ChannelSplitterNode | undefined) => void;
  getRemoteVoiceLeftGain: () => GainNode | undefined;
  setRemoteVoiceLeftGain: (node: GainNode | undefined) => void;
  getRemoteVoiceRightGain: () => GainNode | undefined;
  setRemoteVoiceRightGain: (node: GainNode | undefined) => void;
  getRemoteVoiceMerger: () => ChannelMergerNode | undefined;
  setRemoteVoiceMerger: (node: ChannelMergerNode | undefined) => void;
  getRemoteMusicSplitter: () => ChannelSplitterNode | undefined;
  setRemoteMusicSplitter: (node: ChannelSplitterNode | undefined) => void;
  getRemoteMusicLeftGain: () => GainNode | undefined;
  setRemoteMusicLeftGain: (node: GainNode | undefined) => void;
  getRemoteMusicRightGain: () => GainNode | undefined;
  setRemoteMusicRightGain: (node: GainNode | undefined) => void;
  getRemoteMusicMerger: () => ChannelMergerNode | undefined;
  setRemoteMusicMerger: (node: ChannelMergerNode | undefined) => void;
  getRemoteVoiceAnalyserL: () => AnalyserNode | undefined;
  setRemoteVoiceAnalyserL: (node: AnalyserNode | undefined) => void;
  getRemoteVoiceAnalyserR: () => AnalyserNode | undefined;
  setRemoteVoiceAnalyserR: (node: AnalyserNode | undefined) => void;
  getRemoteMusicAnalyserL: () => AnalyserNode | undefined;
  setRemoteMusicAnalyserL: (node: AnalyserNode | undefined) => void;
  getRemoteMusicAnalyserR: () => AnalyserNode | undefined;
  setRemoteMusicAnalyserR: (node: AnalyserNode | undefined) => void;
  getRemoteMasterAnalyserL: () => AnalyserNode | undefined;
  setRemoteMasterAnalyserL: (node: AnalyserNode | undefined) => void;
  getRemoteMasterAnalyserR: () => AnalyserNode | undefined;
  setRemoteMasterAnalyserR: (node: AnalyserNode | undefined) => void;
  getRemoteVoiceFxNodes: () => AudioNode[];
  setRemoteVoiceFxNodes: (nodes: AudioNode[]) => void;
  getRemoteMusicFxNodes: () => AudioNode[];
  setRemoteMusicFxNodes: (nodes: AudioNode[]) => void;
  getRemoteLimiter: () => DynamicsCompressorNode | undefined;
  setRemoteLimiter: (node: DynamicsCompressorNode | undefined) => void;
  getLastConnectedVoiceFx: () => string;
  setLastConnectedVoiceFx: (val: string) => void;
  getLastConnectedMusicFx: () => string;
  setLastConnectedMusicFx: (val: string) => void;
  getRemoteVoiceSourceNode: () => MediaStreamAudioSourceNode | undefined;
  setRemoteVoiceSourceNode: (node: MediaStreamAudioSourceNode | undefined) => void;
  getRemoteMusicSourceNodes: () => Map<string, { track: MediaStreamTrack; sourceNode: MediaStreamAudioSourceNode }>;
  getRemoteAudioTracks: () => Map<string, { purpose: 'voice' | 'music'; track: MediaStreamTrack }>;
  isInCall: () => boolean;
  getPreferences: () => Preferences;
  onApplyMixerAudioRouting: () => void;
  onSetOutputDevice: (deviceId?: string) => Promise<void>;
  onSetCallStatus: (status: string) => void;
  isRtcVoiceStereo: () => boolean;
  getRemoteVoiceMeter: () => LevelMeter | undefined;
  setRemoteVoiceMeter: (meter: LevelMeter | undefined) => void;
  isRemoteMuted: () => boolean;
  onSetLastRemoteVoiceDb: (db: number) => void;
  onCheckActiveSpeaker: () => void;
}

export function createRemoteAudioGraphController(ctx: RemoteAudioGraphContext) {
  let remoteAudioRefreshSeq = 0;

  async function getOrCreateRemoteAudioContext(): Promise<AudioContext> {
    let remoteAudioCtx = ctx.getRemoteAudioCtx();
    if (!remoteAudioCtx || remoteAudioCtx.state === 'closed') {
      ctx.setLastConnectedVoiceFx('__uninitialized__');
      ctx.setLastConnectedMusicFx('__uninitialized__');
      ctx.setRemoteVoiceFxNodes([]);
      ctx.setRemoteMusicFxNodes([]);
      remoteAudioCtx = new AudioContext({ sampleRate: 48000 });
      ctx.setRemoteAudioCtx(remoteAudioCtx);

      const voiceGain = remoteAudioCtx.createGain();
      ctx.setRemoteVoiceGain(voiceGain);
      const musicGain = remoteAudioCtx.createGain();
      ctx.setRemoteMusicGain(musicGain);
      const masterGain = remoteAudioCtx.createGain();
      ctx.setRemoteMasterGain(masterGain);
      const limiter = remoteAudioCtx.createDynamicsCompressor();
      ctx.setRemoteLimiter(limiter);

      // Panning & Balance Stages:
      // Remote Voice:
      // Mono: Constant Power Mono-to-Stereo Panner + Meter Splitter
      const voicePanner = remoteAudioCtx.createStereoPanner();
      ctx.setRemoteVoicePanner(voicePanner);
      const voiceMeterSplitter = remoteAudioCtx.createChannelSplitter(2);
      ctx.setRemoteVoiceMeterSplitter(voiceMeterSplitter);

      // Stereo: True Stereo Balance (discrete L/R attenuation without crossfeed)
      const voiceSplitter = remoteAudioCtx.createChannelSplitter(2);
      ctx.setRemoteVoiceSplitter(voiceSplitter);
      const voiceLeftGain = remoteAudioCtx.createGain();
      ctx.setRemoteVoiceLeftGain(voiceLeftGain);
      const voiceRightGain = remoteAudioCtx.createGain();
      ctx.setRemoteVoiceRightGain(voiceRightGain);
      const voiceMerger = remoteAudioCtx.createChannelMerger(2);
      ctx.setRemoteVoiceMerger(voiceMerger);

      // Remote Music: True Stereo Balance (discrete L/R attenuation without crossfeed)
      const musicSplitter = remoteAudioCtx.createChannelSplitter(2);
      ctx.setRemoteMusicSplitter(musicSplitter);
      const musicLeftGain = remoteAudioCtx.createGain();
      ctx.setRemoteMusicLeftGain(musicLeftGain);
      const musicRightGain = remoteAudioCtx.createGain();
      ctx.setRemoteMusicRightGain(musicRightGain);
      const musicMerger = remoteAudioCtx.createChannelMerger(2);
      ctx.setRemoteMusicMerger(musicMerger);

      musicSplitter.connect(musicLeftGain, 0, 0);
      musicSplitter.connect(musicRightGain, 1, 0);
      musicLeftGain.connect(musicMerger, 0, 0);
      musicRightGain.connect(musicMerger, 0, 1);

      // Live Analysers for Real Level Metering (Stereo Measurement Taps)
      const voiceAnalyserL = remoteAudioCtx.createAnalyser();
      voiceAnalyserL.fftSize = 256;
      ctx.setRemoteVoiceAnalyserL(voiceAnalyserL);
      const voiceAnalyserR = remoteAudioCtx.createAnalyser();
      voiceAnalyserR.fftSize = 256;
      ctx.setRemoteVoiceAnalyserR(voiceAnalyserR);

      const musicAnalyserL = remoteAudioCtx.createAnalyser();
      musicAnalyserL.fftSize = 256;
      ctx.setRemoteMusicAnalyserL(musicAnalyserL);
      const musicAnalyserR = remoteAudioCtx.createAnalyser();
      musicAnalyserR.fftSize = 256;
      ctx.setRemoteMusicAnalyserR(musicAnalyserR);

      const masterMeterSplitter = remoteAudioCtx.createChannelSplitter(2);
      const masterAnalyserL = remoteAudioCtx.createAnalyser();
      masterAnalyserL.fftSize = 256;
      ctx.setRemoteMasterAnalyserL(masterAnalyserL);
      const masterAnalyserR = remoteAudioCtx.createAnalyser();
      masterAnalyserR.fftSize = 256;
      ctx.setRemoteMasterAnalyserR(masterAnalyserR);

      // Protective Monitor Master Peak Limiter (fastest practical attack, hard knee, max ratio, ~ -0.5 dBFS threshold)
      limiter.threshold.setValueAtTime(-0.5, remoteAudioCtx.currentTime);
      limiter.knee.setValueAtTime(0.0, remoteAudioCtx.currentTime); // Hard knee for peak limiting
      limiter.ratio.setValueAtTime(20.0, remoteAudioCtx.currentTime); // High limiting ratio (20:1 max supported)
      limiter.attack.setValueAtTime(0.001, remoteAudioCtx.currentTime); // Minimum practical attack (1ms) supported by Web Audio DynamicsCompressorNode
      limiter.release.setValueAtTime(0.05, remoteAudioCtx.currentTime); // Fast release (50ms) to minimize pumping

      // Audio Graph Static Routing for Music:
      musicGain.connect(musicSplitter);
      musicMerger.connect(masterGain);
      musicLeftGain.connect(musicAnalyserL);
      musicRightGain.connect(musicAnalyserR);

      // Master: MasterGain -> Limiter -> Destination
      masterGain
        .connect(limiter)
        .connect(remoteAudioCtx.destination);

      limiter.connect(masterMeterSplitter);
      masterMeterSplitter.connect(masterAnalyserL, 0);
      masterMeterSplitter.connect(masterAnalyserR, 1);

      const prefs = ctx.getPreferences();
      if (prefs.audioOutputId && typeof (remoteAudioCtx as any).setSinkId === 'function') {
        try {
          await (remoteAudioCtx as any).setSinkId(prefs.audioOutputId);
        } catch (err) {
          console.warn('Failed to setSinkId on remoteAudioCtx:', err);
        }
      }

      ctx.onApplyMixerAudioRouting();
    }
    if (remoteAudioCtx.state === 'suspended') {
      await remoteAudioCtx.resume().catch(() => {});
    }
    return remoteAudioCtx;
  }

  function setRemoteAudio(id: string, purpose: 'voice' | 'music', track: MediaStreamTrack): void {
    const remoteAudioTracks = ctx.getRemoteAudioTracks();
    const remoteMusicSourceNodes = ctx.getRemoteMusicSourceNodes();
    const existing = remoteAudioTracks.get(id);
    if (existing) {
      existing.track.onended = null;
      if (existing.track !== track) {
        try { existing.track.stop(); } catch {}
        const existingSource = remoteMusicSourceNodes.get(id);
        if (existingSource && existingSource.track === existing.track) {
          try { existingSource.sourceNode.disconnect(); } catch {}
          remoteMusicSourceNodes.delete(id);
        }
      }
    }
    remoteAudioTracks.set(id, { purpose, track });
    track.onended = () => {
      const current = remoteAudioTracks.get(id);
      if (current && current.track === track) {
        remoteAudioTracks.delete(id);
        const existingSource = remoteMusicSourceNodes.get(id);
        if (existingSource && existingSource.track === track) {
          try { existingSource.sourceNode.disconnect(); } catch {}
          remoteMusicSourceNodes.delete(id);
        }
        if (!ctx.isInCall()) return;
        void refreshRemoteAudio();
      }
    };
    if (ctx.isInCall()) {
      void refreshRemoteAudio();
    }
  }

  async function refreshRemoteAudio(): Promise<void> {
    const seq = ++remoteAudioRefreshSeq;
    const remoteAudioTracks = ctx.getRemoteAudioTracks();
    const remoteMusicSourceNodes = ctx.getRemoteMusicSourceNodes();

    if (!ctx.isInCall()) {
      stopRemoteVoiceBridge();
      const voiceSourceNode = ctx.getRemoteVoiceSourceNode();
      try { voiceSourceNode?.disconnect(); } catch {}
      ctx.setRemoteVoiceSourceNode(undefined);
      const voiceMeter = ctx.getRemoteVoiceMeter();
      if (voiceMeter) {
        void voiceMeter.stop();
        ctx.setRemoteVoiceMeter(undefined);
      }
      for (const [, entry] of remoteMusicSourceNodes) {
        try { entry.sourceNode.disconnect(); } catch {}
      }
      remoteMusicSourceNodes.clear();
      return;
    }

    const initialHasTracks = [...remoteAudioTracks.values()].some((item) => item.track.readyState !== 'ended');
    if (!initialHasTracks) {
      stopRemoteVoiceBridge();
      const voiceSourceNode = ctx.getRemoteVoiceSourceNode();
      try { voiceSourceNode?.disconnect(); } catch {}
      ctx.setRemoteVoiceSourceNode(undefined);
      const voiceMeter = ctx.getRemoteVoiceMeter();
      if (voiceMeter) {
        void voiceMeter.stop();
        ctx.setRemoteVoiceMeter(undefined);
      }
      ctx.onSetLastRemoteVoiceDb(-60);
      ctx.onCheckActiveSpeaker();

      for (const [, entry] of remoteMusicSourceNodes) {
        try { entry.sourceNode.disconnect(); } catch {}
      }
      remoteMusicSourceNodes.clear();

      const voiceEl = $<HTMLAudioElement>('remote-voice-audio');
      const musicEl = $<HTMLAudioElement>('remote-music-audio');
      if (voiceEl) {
        voiceEl.srcObject = null;
        voiceEl.pause();
      }
      if (musicEl) {
        musicEl.srcObject = null;
        musicEl.pause();
      }

      const remoteAudioCtx = ctx.getRemoteAudioCtx();
      if (remoteAudioCtx && remoteAudioCtx.state !== 'closed') {
        ctx.onApplyMixerAudioRouting();
      }
      return;
    }

    const audioCtx = await getOrCreateRemoteAudioContext();

    // If a newer refresh was triggered while awaiting the AudioContext, yield to the latest call
    if (seq !== remoteAudioRefreshSeq || !ctx.isInCall()) return;

    // Always query latest tracks state AFTER the async AudioContext operation completes
    const latestVoiceTracks = [...remoteAudioTracks.values()]
      .filter((item) => item.purpose === 'voice' && item.track.readyState !== 'ended')
      .map((item) => item.track);
    const latestMusicEntries = [...remoteAudioTracks.entries()]
      .filter(([, item]) => item.purpose === 'music' && item.track.readyState !== 'ended');

    // Reconcile Remote Voice
    if (latestVoiceTracks.length > 0) {
      const voiceTrack = latestVoiceTracks[0];
      ctx.setRemoteVoiceStereo(ctx.isRtcVoiceStereo());

      let remoteVoiceSourceNode = ctx.getRemoteVoiceSourceNode();
      if (voiceTrack && (!remoteVoiceSourceNode || remoteVoiceSourceNode.mediaStream.getAudioTracks()[0] !== voiceTrack)) {
        try { remoteVoiceSourceNode?.disconnect(); } catch {}
        const voiceStream = new MediaStream([voiceTrack]);
        remoteVoiceSourceNode = audioCtx.createMediaStreamSource(voiceStream);
        ctx.setRemoteVoiceSourceNode(remoteVoiceSourceNode);
        const voiceGain = ctx.getRemoteVoiceGain();
        if (voiceGain) remoteVoiceSourceNode.connect(voiceGain);
        void startRemoteVoiceBridge(audioCtx, remoteVoiceSourceNode);

        let remoteVoiceMeter = ctx.getRemoteVoiceMeter();
        if (!remoteVoiceMeter) {
          remoteVoiceMeter = new LevelMeter();
          ctx.setRemoteVoiceMeter(remoteVoiceMeter);
        }
        void remoteVoiceMeter.startFromNode(remoteVoiceSourceNode, 66, (reading) => {
          ctx.onSetLastRemoteVoiceDb((!ctx.isRemoteMuted()) ? reading.rmsDb : -60);
          ctx.onCheckActiveSpeaker();
        });
      }
    } else {
      ctx.setRemoteVoiceStereo(false);
      stopRemoteVoiceBridge();
      const voiceSourceNode = ctx.getRemoteVoiceSourceNode();
      try { voiceSourceNode?.disconnect(); } catch {}
      ctx.setRemoteVoiceSourceNode(undefined);
      const voiceMeter = ctx.getRemoteVoiceMeter();
      if (voiceMeter) {
        void voiceMeter.stop();
        ctx.setRemoteVoiceMeter(undefined);
      }
      ctx.onSetLastRemoteVoiceDb(-60);
      ctx.onCheckActiveSpeaker();
    }

    // Reconcile Remote Music & Screen Audio sources
    if (latestMusicEntries.length > 0) {
      // Clean up any existing sources that are no longer active, ended, or replaced
      for (const [id, entry] of remoteMusicSourceNodes) {
        const stillActive = latestMusicEntries.some(([trackId, item]) => trackId === id && item.track === entry.track && item.track.readyState !== 'ended');
        if (!stillActive) {
          try { entry.sourceNode.disconnect(); } catch {}
          remoteMusicSourceNodes.delete(id);
        }
      }

      // Create or connect source nodes for all active remote music tracks
      for (const [id, item] of latestMusicEntries) {
        if (item.track.readyState === 'ended') continue;
        const existing = remoteMusicSourceNodes.get(id);
        if (!existing || existing.track !== item.track) {
          if (existing) {
            try { existing.sourceNode.disconnect(); } catch {}
            remoteMusicSourceNodes.delete(id);
          }
          const stream = new MediaStream([item.track]);
          const sourceNode = audioCtx.createMediaStreamSource(stream);
          const musicGain = ctx.getRemoteMusicGain();
          if (musicGain) {
            sourceNode.connect(musicGain);
          }
          remoteMusicSourceNodes.set(id, { track: item.track, sourceNode });
        }
      }
    } else {
      for (const [, entry] of remoteMusicSourceNodes) {
        try { entry.sourceNode.disconnect(); } catch {}
      }
      remoteMusicSourceNodes.clear();
    }

    const voiceEl = $<HTMLAudioElement>('remote-voice-audio');
    const musicEl = $<HTMLAudioElement>('remote-music-audio');
    if (voiceEl) {
      voiceEl.srcObject = null;
      voiceEl.pause();
    }
    if (musicEl) {
      musicEl.srcObject = null;
      musicEl.pause();
    }

    ctx.onApplyMixerAudioRouting();
    const prefs = ctx.getPreferences();
    void ctx.onSetOutputDevice(prefs.audioOutputId).catch((error) => ctx.onSetCallStatus(deviceError(error)));
  }

  async function cleanupRemoteAudioGraph(): Promise<void> {
    const remoteAudioTracks = ctx.getRemoteAudioTracks();
    const remoteMusicSourceNodes = ctx.getRemoteMusicSourceNodes();

    // Clear track listeners and stop remote audio tracks
    for (const [, item] of remoteAudioTracks) {
      item.track.onended = null;
      try { item.track.stop(); } catch {}
    }
    remoteAudioTracks.clear();

    // Stop remote voice bridge and disconnect remote source nodes
    stopRemoteVoiceBridge();
    const voiceSourceNode = ctx.getRemoteVoiceSourceNode();
    try { voiceSourceNode?.disconnect(); } catch {}
    ctx.setRemoteVoiceSourceNode(undefined);

    for (const [, entry] of remoteMusicSourceNodes) {
      try { entry.sourceNode.disconnect(); } catch {}
    }
    remoteMusicSourceNodes.clear();

    const voiceMeter = ctx.getRemoteVoiceMeter();
    if (voiceMeter) {
      await voiceMeter.stop();
      ctx.setRemoteVoiceMeter(undefined);
    }

    const voiceEl = $<HTMLAudioElement>('remote-voice-audio');
    const musicEl = $<HTMLAudioElement>('remote-music-audio');
    if (voiceEl) {
      voiceEl.srcObject = null;
      voiceEl.pause();
    }
    if (musicEl) {
      musicEl.srcObject = null;
      musicEl.pause();
    }

    // Close and release remoteAudioCtx cleanly
    const remoteAudioCtx = ctx.getRemoteAudioCtx();
    if (remoteAudioCtx && remoteAudioCtx.state !== 'closed') {
      try {
        await remoteAudioCtx.close();
      } catch {}
    }
    ctx.setRemoteAudioCtx(undefined);
    ctx.setRemoteVoiceGain(undefined);
    ctx.setRemoteMusicGain(undefined);
    ctx.setRemoteMasterGain(undefined);
    ctx.setRemoteVoiceStereo(false);

    const voicePanner = ctx.getRemoteVoicePanner();
    try { voicePanner?.disconnect(); } catch {}
    ctx.setRemoteVoicePanner(undefined);

    const voiceMeterSplitter = ctx.getRemoteVoiceMeterSplitter();
    try { voiceMeterSplitter?.disconnect(); } catch {}
    ctx.setRemoteVoiceMeterSplitter(undefined);

    const voiceSplitter = ctx.getRemoteVoiceSplitter();
    try { voiceSplitter?.disconnect(); } catch {}
    ctx.setRemoteVoiceSplitter(undefined);

    const voiceLeftGain = ctx.getRemoteVoiceLeftGain();
    try { voiceLeftGain?.disconnect(); } catch {}
    ctx.setRemoteVoiceLeftGain(undefined);

    const voiceRightGain = ctx.getRemoteVoiceRightGain();
    try { voiceRightGain?.disconnect(); } catch {}
    ctx.setRemoteVoiceRightGain(undefined);

    const voiceMerger = ctx.getRemoteVoiceMerger();
    try { voiceMerger?.disconnect(); } catch {}
    ctx.setRemoteVoiceMerger(undefined);

    const musicSplitter = ctx.getRemoteMusicSplitter();
    try { musicSplitter?.disconnect(); } catch {}
    ctx.setRemoteMusicSplitter(undefined);

    const musicLeftGain = ctx.getRemoteMusicLeftGain();
    try { musicLeftGain?.disconnect(); } catch {}
    ctx.setRemoteMusicLeftGain(undefined);

    const musicRightGain = ctx.getRemoteMusicRightGain();
    try { musicRightGain?.disconnect(); } catch {}
    ctx.setRemoteMusicRightGain(undefined);

    const musicMerger = ctx.getRemoteMusicMerger();
    try { musicMerger?.disconnect(); } catch {}
    ctx.setRemoteMusicMerger(undefined);

    ctx.setRemoteVoiceAnalyserL(undefined);
    ctx.setRemoteVoiceAnalyserR(undefined);
    ctx.setRemoteMusicAnalyserL(undefined);
    ctx.setRemoteMusicAnalyserR(undefined);
    ctx.setRemoteMasterAnalyserL(undefined);
    ctx.setRemoteMasterAnalyserR(undefined);

    const voiceFxNodes = ctx.getRemoteVoiceFxNodes();
    for (const node of voiceFxNodes) {
      try { node.disconnect(); } catch {}
    }
    ctx.setRemoteVoiceFxNodes([]);

    const musicFxNodes = ctx.getRemoteMusicFxNodes();
    for (const node of musicFxNodes) {
      try { node.disconnect(); } catch {}
    }
    ctx.setRemoteMusicFxNodes([]);

    ctx.setRemoteLimiter(undefined);
    ctx.setLastConnectedVoiceFx('__uninitialized__');
    ctx.setLastConnectedMusicFx('__uninitialized__');
  }

  return {
    getOrCreateRemoteAudioContext,
    setRemoteAudio,
    refreshRemoteAudio,
    cleanupRemoteAudioGraph
  };
}
