import type { AudioMode, AudioSourceMetadata } from '@jameet/shared';
import { audioConstraints, effectiveSettings, type AudioCapturePreferences, type EffectiveAudioSettings } from '../profiles/audioProfiles';
import { channelEqDspRegistry, type ChannelEqDspInstance } from '../eq/channelEq';

export {
  type AudioSourcePurpose,
  type AudioSourceConfig
} from './types';

import type {
  AudioSourcePurpose,
  AudioSourceConfig,
  VoiceMicChannel
} from './types';
import { getDesktopApi } from './desktopApi';
import { getStereoBalanceGains } from './stereoBalance';
import {
  safeDisconnect,
  cleanupVoiceMicNodes,
  cleanupMusicNodes
} from './disconnectUtils';
import { routeHardwareAudioChunk } from './hardwareAudio';
import { attachAppAudioLoopback } from './loopback';

export class LocalAudioSourceManager {
  private sources = new Map<string, AudioSourceConfig>();
  private senders = new Map<string, RTCRtpSender>();
  private audioContext: AudioContext | undefined;
  private appAudioContext: AudioContext | undefined;
  private gainNodes = new Map<string, GainNode>();
  private musicLeftGainNode?: GainNode;
  private musicRightGainNode?: GainNode;
  private musicSplitter?: ChannelSplitterNode;
  private musicMerger?: ChannelMergerNode;
  private musicMeterAnalyserL?: AnalyserNode;
  private musicMeterAnalyserR?: AnalyserNode;
  private musicSilentGain?: GainNode;
  private musicFxNodes: AudioNode[] = [];
  private lastConnectedMusicFx?: string;
  private rawTracks = new Map<string, MediaStreamTrack>();
  private voiceMics = new Map<number, VoiceMicChannel>();
  private voiceDestination?: MediaStreamAudioDestinationNode;

  private appAudioCleanup?: () => void;
  private hardwareAudioCleanup?: () => void;

  get primary(): AudioSourceConfig | undefined { return this.sources.get('voice'); }
  get voice(): AudioSourceConfig | undefined { return this.sources.get('voice'); }
  get music(): AudioSourceConfig | undefined { return this.sources.get('music'); }
  get(id: string): AudioSourceConfig | undefined { return this.sources.get(id); }

  hasActiveSources(): boolean {
    for (const src of this.sources.values()) {
      if (src.enabled && src.track && src.track.readyState === 'live') {
        return true;
      }
    }
    return false;
  }

  private async getOrCreateAudioContext(): Promise<AudioContext> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext({ sampleRate: 48000 });
      this.voiceDestination = undefined;

      this.voiceMics.clear();
      this.gainNodes.clear();
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume().catch(() => {});
    }
    return this.audioContext;
  }

  getVoiceRawTrack(micIndex: number): MediaStreamTrack | undefined {
    return this.voiceMics.get(micIndex)?.isolatedTrack ?? this.voiceMics.get(micIndex)?.rawTrack;
  }

  getVoiceMicNode(micIndex: number): GainNode | undefined {
    return this.voiceMics.get(micIndex)?.gainNode;
  }

  getVoiceMicAnalyser(micIndex: number): AnalyserNode | undefined {
    return this.voiceMics.get(micIndex)?.analyserNode;
  }

  getVoiceMicAnalysers(micIndex: number): { left?: AnalyserNode; right?: AnalyserNode } {
    const mic = this.voiceMics.get(micIndex);
    return { left: mic?.meterAnalyserL, right: mic?.meterAnalyserR };
  }

  getMusicNode(): AudioNode | undefined {
    return this.gainNodes.get('music');
  }

  getMusicAnalysers(): { left?: AnalyserNode; right?: AnalyserNode } {
    return { left: this.musicMeterAnalyserL, right: this.musicMeterAnalyserR };
  }

  async acquireVoice(deviceId: string | undefined, mode: AudioMode, preferences: AudioCapturePreferences = {}): Promise<AudioSourceConfig> {
    return this.acquireVoiceMic(1, deviceId, mode, preferences);
  }

  async acquireSecondaryVoice(deviceId: string | undefined, mode: AudioMode, preferences: AudioCapturePreferences = {}): Promise<MediaStreamTrack> {
    const mic = await this.acquireVoiceMic(2, deviceId, mode, preferences);
    return mic.track;
  }

  private setupHardwareAudioCapture(): void {
    if (this.hardwareAudioCleanup) return;
    const api = getDesktopApi();
    if (!api?.onHardwareAudioChunk) return;

    this.hardwareAudioCleanup = api.onHardwareAudioChunk((chunk: Uint8Array) => {
      if (!this.audioContext || this.audioContext.state === 'closed') return;
      routeHardwareAudioChunk(this.audioContext, chunk, this.voiceMics);
    });
  }

  async removeVoiceMic(micIndex: number): Promise<void> {
    const mic = this.voiceMics.get(micIndex);
    if (mic) {
      cleanupVoiceMicNodes(mic);
      this.voiceMics.delete(micIndex);
      this.gainNodes.delete(`voice-${micIndex}`);
    }
    if (this.voiceMics.size === 0 && this.hardwareAudioCleanup) {
      this.hardwareAudioCleanup();
      this.hardwareAudioCleanup = undefined;
      const api = getDesktopApi();
      void api?.stopHardwareAudioCapture?.();
    }
  }

  async removeSecondaryVoice(): Promise<void> {
    return this.removeVoiceMic(2);
  }

  async acquireVoiceMic(micIndex: number, deviceId: string | undefined, mode: AudioMode, preferences: AudioCapturePreferences): Promise<AudioSourceConfig> {
    const ctx = await this.getOrCreateAudioContext();

    if (!this.voiceDestination || this.voiceDestination.context !== ctx) {
      this.voiceDestination = ctx.createMediaStreamDestination();
    }

    // Stop previous mic if existing
    const prevMic = this.voiceMics.get(micIndex);
    if (prevMic) {
      cleanupVoiceMicNodes(prevMic);
    }

    const gainNode = ctx.createGain();
    const gainVal = preferences.inputGain !== undefined ? preferences.inputGain : 1.0;
    gainNode.gain.setValueAtTime(gainVal, ctx.currentTime);

    const micDestination = ctx.createMediaStreamDestination();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(mode, deviceId, preferences), video: false });
    } catch (error) {
      if (preferences.sampleRate) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(mode, deviceId, { ...preferences, sampleRate: undefined }), video: false });
      } else {
        throw error;
      }
    }
    const rawTrack = stream.getAudioTracks()[0];
    if (!rawTrack) throw new Error(`Microphone ${micIndex} did not provide an audio track.`);
    rawTrack.contentHint = mode === 'music' ? 'music' : 'speech';

    const sourceStream = new MediaStream([rawTrack]);
    const sourceNode = ctx.createMediaStreamSource(sourceStream);

    const route = preferences.channelRoute || 'all';
    const isStereoRoute = preferences.stereo !== false && (route === '1-2' || route === '3-4' || route === '5-6' || route === '7-8' || (route === 'all' && (sourceNode.channelCount >= 2)));
    const outChannels = isStereoRoute ? 2 : 1;
    const micMerger = ctx.createChannelMerger(outChannels);

    let downmixGainNode: GainNode | undefined;
    if (!isStereoRoute && (route === '1-2' || route === '3-4' || route === '5-6' || route === '7-8' || (route === 'all' && sourceNode.channelCount >= 2))) {
      downmixGainNode = ctx.createGain();
      downmixGainNode.gain.setValueAtTime(0.5, ctx.currentTime);
    }

    if (route !== 'all') {
      let splitter: ChannelSplitterNode;
      try { splitter = ctx.createChannelSplitter(32); }
      catch { try { splitter = ctx.createChannelSplitter(8); } catch { splitter = ctx.createChannelSplitter(2); } }
      sourceNode.connect(splitter);

      if (route === '1-2') {
        if (outChannels > 1) {
          splitter.connect(micMerger, 0, 0);
          splitter.connect(micMerger, 1, 1);
        } else if (downmixGainNode) {
          splitter.connect(downmixGainNode, 0);
          splitter.connect(downmixGainNode, 1);
          downmixGainNode.connect(micMerger, 0, 0);
        } else {
          splitter.connect(micMerger, 0, 0);
        }
      } else if (route === '3-4') {
        if (outChannels > 1) {
          splitter.connect(micMerger, 2, 0);
          splitter.connect(micMerger, 3, 1);
        } else if (downmixGainNode) {
          splitter.connect(downmixGainNode, 2);
          splitter.connect(downmixGainNode, 3);
          downmixGainNode.connect(micMerger, 0, 0);
        } else {
          splitter.connect(micMerger, 2, 0);
        }
      } else if (route === '5-6') {
        if (outChannels > 1) {
          splitter.connect(micMerger, 4, 0);
          splitter.connect(micMerger, 5, 1);
        } else if (downmixGainNode) {
          splitter.connect(downmixGainNode, 4);
          splitter.connect(downmixGainNode, 5);
          downmixGainNode.connect(micMerger, 0, 0);
        } else {
          splitter.connect(micMerger, 4, 0);
        }
      } else if (route === '7-8') {
        if (outChannels > 1) {
          splitter.connect(micMerger, 6, 0);
          splitter.connect(micMerger, 7, 1);
        } else if (downmixGainNode) {
          splitter.connect(downmixGainNode, 6);
          splitter.connect(downmixGainNode, 7);
          downmixGainNode.connect(micMerger, 0, 0);
        } else {
          splitter.connect(micMerger, 6, 0);
        }
      } else {
        let chIdx = 0;
        const parsed = parseInt(route, 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 32) {
          chIdx = parsed - 1;
        }
        splitter.connect(micMerger, chIdx, 0);
      }
    } else if (downmixGainNode) {
      let allSplitter: ChannelSplitterNode;
      try { allSplitter = ctx.createChannelSplitter(2); } catch { allSplitter = ctx.createChannelSplitter(1); }
      sourceNode.connect(allSplitter);
      allSplitter.connect(downmixGainNode, 0);
      try { allSplitter.connect(downmixGainNode, 1); } catch {}
      downmixGainNode.connect(micMerger, 0, 0);
    } else {
      sourceNode.connect(micMerger);
    }

    micMerger.connect(gainNode);

    let pannerNode: StereoPannerNode | undefined;
    let stereoSplitter: ChannelSplitterNode | undefined;
    let leftGainNode: GainNode | undefined;
    let rightGainNode: GainNode | undefined;
    let stereoMerger: ChannelMergerNode | undefined;
    let meterSplitter: ChannelSplitterNode | undefined;
    let meterAnalyserL: AnalyserNode | undefined;
    let meterAnalyserR: AnalyserNode | undefined;

    const panVal = preferences.pan !== undefined ? preferences.pan : 0.0;

    if (isStereoRoute) {
      // Stereo pair: Stereo Balance behavior (preserves discrete L/R without folding)
      stereoSplitter = ctx.createChannelSplitter(2);
      leftGainNode = ctx.createGain();
      rightGainNode = ctx.createGain();
      stereoMerger = ctx.createChannelMerger(2);

      const { left, right } = getStereoBalanceGains(panVal);
      leftGainNode.gain.setValueAtTime(left, ctx.currentTime);
      rightGainNode.gain.setValueAtTime(right, ctx.currentTime);

      gainNode.connect(stereoSplitter);
      stereoSplitter.connect(leftGainNode, 0, 0);
      stereoSplitter.connect(rightGainNode, 1, 0);
      leftGainNode.connect(stereoMerger, 0, 0);
      rightGainNode.connect(stereoMerger, 0, 1);

      if (this.voiceDestination) {
        stereoMerger.connect(this.voiceDestination);
      }
      stereoMerger.connect(micDestination);

      // Studio Mixer Measurement Taps (post-Gain, post-FX, post-Balance)
      meterAnalyserL = ctx.createAnalyser();
      meterAnalyserL.fftSize = 256;
      meterAnalyserR = ctx.createAnalyser();
      meterAnalyserR.fftSize = 256;
      leftGainNode.connect(meterAnalyserL);
      rightGainNode.connect(meterAnalyserR);
    } else {
      // Mono hardware route: True Constant Power Mono-to-Stereo Panning
      pannerNode = ctx.createStereoPanner();
      pannerNode.pan.setValueAtTime(panVal, ctx.currentTime);

      gainNode.connect(pannerNode);

      if (this.voiceDestination) {
        pannerNode.connect(this.voiceDestination);
      }
      pannerNode.connect(micDestination);

      // Studio Mixer Measurement Taps (post-Gain, post-FX, post-Panner)
      meterSplitter = ctx.createChannelSplitter(2);
      meterAnalyserL = ctx.createAnalyser();
      meterAnalyserL.fftSize = 256;
      meterAnalyserR = ctx.createAnalyser();
      meterAnalyserR.fftSize = 256;
      pannerNode.connect(meterSplitter);
      meterSplitter.connect(meterAnalyserL, 0);
      meterSplitter.connect(meterAnalyserR, 1);
    }

    // Create a persistent AnalyserNode connected to gainNode for VU metering from ANY audio path
    const analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.7;
    gainNode.connect(analyserNode);

    const isolatedTrack = micDestination.stream.getAudioTracks()[0] || rawTrack;
    isolatedTrack.contentHint = mode === 'music' ? 'music' : 'speech';

    this.voiceMics.set(micIndex, {
      rawTrack,
      isolatedTrack,
      sourceNode,
      gainNode,
      isStereo: isStereoRoute,
      pannerNode,
      stereoSplitter,
      leftGainNode,
      rightGainNode,
      stereoMerger,
      meterSplitter,
      meterAnalyserL,
      meterAnalyserR,
      downmixGainNode,
      fxNodes: [],
      lastConnectedFx: '',
      analyserNode,
      micDestination,
      preferences,
      deviceId
    });

    this.gainNodes.set(`voice-${micIndex}`, gainNode);

    const blendedTrack = this.voiceDestination.stream.getAudioTracks()[0] || isolatedTrack;
    blendedTrack.contentHint = mode === 'music' ? 'music' : 'speech';

    const effective: EffectiveAudioSettings = {
      channelCount: preferences.stereo !== false ? 2 : 1,
      sampleRate: preferences.sampleRate || 48000
    };

    const previous = this.sources.get('voice');
    const wasEnabled = previous?.enabled ?? true;
    blendedTrack.enabled = wasEnabled;

    const next: AudioSourceConfig = { id: 'voice', purpose: 'voice', deviceId, mode, enabled: wasEnabled, track: blendedTrack, effective };
    await this.senders.get('voice')?.replaceTrack(blendedTrack);
    this.sources.set('voice', next);
    return next;
  }

  async setVoiceMicGain(micIndex: number, gain: number): Promise<void> {
    const targetGain = Math.max(0, gain);
    const mic = this.voiceMics.get(micIndex);
    if (mic) {
      mic.preferences.inputGain = targetGain;
    }
    const gainNode = mic?.gainNode ?? this.gainNodes.get(`voice-${micIndex}`);
    if (gainNode && this.audioContext && this.audioContext.state !== 'closed') {
      try {
        if (this.audioContext.state === 'suspended') {
          void this.audioContext.resume().catch(() => {});
        }
        gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
        gainNode.gain.setValueAtTime(targetGain, this.audioContext.currentTime);
      } catch {
        gainNode.gain.value = targetGain;
      }
    }
  }

  async setVoiceMicPan(micIndex: number, pan: number): Promise<void> {
    const clampedPan = Math.max(-1, Math.min(1, pan));
    const mic = this.voiceMics.get(micIndex);
    if (mic) {
      mic.preferences.pan = clampedPan;
    }
    const ctx = this.audioContext;
    if (mic && ctx && ctx.state !== 'closed') {
      try {
        if (ctx.state === 'suspended') {
          void ctx.resume().catch(() => {});
        }
        const now = ctx.currentTime;
        if (mic.isStereo && mic.leftGainNode && mic.rightGainNode) {
          const { left, right } = getStereoBalanceGains(clampedPan);
          mic.leftGainNode.gain.cancelScheduledValues(now);
          mic.leftGainNode.gain.setValueAtTime(left, now);
          mic.rightGainNode.gain.cancelScheduledValues(now);
          mic.rightGainNode.gain.setValueAtTime(right, now);
        } else if (mic.pannerNode) {
          mic.pannerNode.pan.cancelScheduledValues(now);
          mic.pannerNode.pan.setValueAtTime(clampedPan, now);
        }
      } catch {
        if (mic.isStereo && mic.leftGainNode && mic.rightGainNode) {
          const { left, right } = getStereoBalanceGains(clampedPan);
          mic.leftGainNode.gain.value = left;
          mic.rightGainNode.gain.value = right;
        } else if (mic.pannerNode) {
          mic.pannerNode.pan.value = clampedPan;
        }
      }
    }
  }

  private attachLoopbackToNode(
    ctx: AudioContext,
    targetNode: AudioNode,
    targetCapture: number | string = 'global',
    channelRoute?: string
  ): () => void {
    return attachAppAudioLoopback(ctx, targetNode, targetCapture, channelRoute);
  }

  async acquireMusic(deviceId: string, preferences: AudioCapturePreferences = {}): Promise<AudioSourceConfig> {
    if (this.appAudioCleanup) {
      this.appAudioCleanup();
      this.appAudioCleanup = undefined;
    }

    if (!this.appAudioContext || this.appAudioContext.state === 'closed') {
      this.appAudioContext = new AudioContext({ sampleRate: 48000 });
    }
    if (this.appAudioContext.state === 'suspended') {
      await this.appAudioContext.resume().catch(() => {});
    }

    const appCtx = this.appAudioContext;
    const targetSampleRate = appCtx.sampleRate;
    const destination = appCtx.createMediaStreamDestination();
    const musicGain = appCtx.createGain();
    musicGain.gain.setValueAtTime(1.0, appCtx.currentTime);

    // Stereo Balance Stage for Local Music
    const musicSplitter = appCtx.createChannelSplitter(2);
    const musicLeftGain = appCtx.createGain();
    const musicRightGain = appCtx.createGain();
    const musicMerger = appCtx.createChannelMerger(2);

    const panVal = preferences.pan !== undefined ? preferences.pan : 0.0;
    const { left: initL, right: initR } = getStereoBalanceGains(panVal);
    musicLeftGain.gain.setValueAtTime(initL, appCtx.currentTime);
    musicRightGain.gain.setValueAtTime(initR, appCtx.currentTime);

    musicGain.connect(musicSplitter);
    musicSplitter.connect(musicLeftGain, 0, 0);
    musicSplitter.connect(musicRightGain, 1, 0);
    musicLeftGain.connect(musicMerger, 0, 0);
    musicRightGain.connect(musicMerger, 0, 1);
    musicMerger.connect(destination);

    // Measurement taps for Studio Mixer (post-gain, post-FX, post-balance)
    const musicMeterAnalyserL = appCtx.createAnalyser();
    musicMeterAnalyserL.fftSize = 256;
    const musicMeterAnalyserR = appCtx.createAnalyser();
    musicMeterAnalyserR.fftSize = 256;
    musicLeftGain.connect(musicMeterAnalyserL);
    musicRightGain.connect(musicMeterAnalyserR);

    this.gainNodes.set('music', musicGain);
    this.musicLeftGainNode = musicLeftGain;
    this.musicRightGainNode = musicRightGain;
    this.musicSplitter = musicSplitter;
    this.musicMerger = musicMerger;
    this.musicMeterAnalyserL = musicMeterAnalyserL;
    this.musicMeterAnalyserR = musicMeterAnalyserR;

    // Keep graph clock continuously running without local playback echo
    const silentGain = appCtx.createGain();
    silentGain.gain.setValueAtTime(0.0, appCtx.currentTime);
    musicGain.connect(silentGain);
    try { silentGain.connect(appCtx.destination); } catch {}
    this.musicSilentGain = silentGain;

    const channelRoute = preferences.channelRoute || '1-2';
    const targetCapture = `device:${deviceId}`;
    const cleanupLoopback = this.attachLoopbackToNode(appCtx, musicGain, targetCapture, channelRoute);

    this.appAudioCleanup = () => {
      cleanupLoopback();
      cleanupMusicNodes({
        musicGain,
        musicFxNodes: this.musicFxNodes,
        musicSplitter,
        musicLeftGainNode: musicLeftGain,
        musicRightGainNode: musicRightGain,
        musicMerger,
        musicMeterAnalyserL,
        musicMeterAnalyserR,
        musicSilentGain: silentGain
      });
      this.musicFxNodes = [];
      this.gainNodes.delete('music');
      this.musicLeftGainNode = undefined;
      this.musicRightGainNode = undefined;
      this.musicSplitter = undefined;
      this.musicMerger = undefined;
      this.musicMeterAnalyserL = undefined;
      this.musicMeterAnalyserR = undefined;
      this.musicSilentGain = undefined;
      this.lastConnectedMusicFx = undefined;
      if (this.appAudioContext && this.appAudioContext.state !== 'closed') {
        void this.appAudioContext.close().catch(() => {});
        this.appAudioContext = undefined;
      }
    };

    const outTrack = destination.stream.getAudioTracks()[0];
    if (!outTrack) throw new Error('Failed to create media track from hardware output audio stream.');
    outTrack.contentHint = 'music';

    const effective: EffectiveAudioSettings = {
      channelCount: 2,
      sampleRate: targetSampleRate,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    };

    const next: AudioSourceConfig = {
      id: 'music',
      purpose: 'music',
      deviceId: `device:${deviceId}:${channelRoute}`,
      mode: 'music',
      enabled: true,
      track: outTrack,
      effective
    };

    const previous = this.sources.get('music');
    await this.senders.get('music')?.replaceTrack(outTrack);
    this.sources.set('music', next);
    previous?.track.stop();
    return next;
  }

  async acquireMusicFromApp(pid: number | string, appName: string): Promise<AudioSourceConfig> {
    if (this.appAudioCleanup) {
      this.appAudioCleanup();
      this.appAudioCleanup = undefined;
    }

    if (!this.appAudioContext || this.appAudioContext.state === 'closed') {
      this.appAudioContext = new AudioContext({ sampleRate: 48000 });
    }
    if (this.appAudioContext.state === 'suspended') {
      await this.appAudioContext.resume().catch(() => {});
    }

    const appCtx = this.appAudioContext;
    const targetSampleRate = appCtx.sampleRate;
    const destination = appCtx.createMediaStreamDestination();
    const musicGain = appCtx.createGain();
    musicGain.gain.setValueAtTime(1.0, appCtx.currentTime);

    // Stereo Balance Stage for Local Music
    const musicSplitter = appCtx.createChannelSplitter(2);
    const musicLeftGain = appCtx.createGain();
    const musicRightGain = appCtx.createGain();
    const musicMerger = appCtx.createChannelMerger(2);

    musicLeftGain.gain.setValueAtTime(1.0, appCtx.currentTime);
    musicRightGain.gain.setValueAtTime(1.0, appCtx.currentTime);

    musicGain.connect(musicSplitter);
    musicSplitter.connect(musicLeftGain, 0, 0);
    musicSplitter.connect(musicRightGain, 1, 0);
    musicLeftGain.connect(musicMerger, 0, 0);
    musicRightGain.connect(musicMerger, 0, 1);
    musicMerger.connect(destination);

    // Measurement taps for Studio Mixer (post-gain, post-FX, post-balance)
    const musicMeterAnalyserL = appCtx.createAnalyser();
    musicMeterAnalyserL.fftSize = 256;
    const musicMeterAnalyserR = appCtx.createAnalyser();
    musicMeterAnalyserR.fftSize = 256;
    musicLeftGain.connect(musicMeterAnalyserL);
    musicRightGain.connect(musicMeterAnalyserR);

    this.gainNodes.set('music', musicGain);
    this.musicLeftGainNode = musicLeftGain;
    this.musicRightGainNode = musicRightGain;
    this.musicSplitter = musicSplitter;
    this.musicMerger = musicMerger;
    this.musicMeterAnalyserL = musicMeterAnalyserL;
    this.musicMeterAnalyserR = musicMeterAnalyserR;

    // Keep graph clock continuously running without local playback echo
    const silentGain = appCtx.createGain();
    silentGain.gain.setValueAtTime(0.0, appCtx.currentTime);
    musicGain.connect(silentGain);
    try { silentGain.connect(appCtx.destination); } catch {}
    this.musicSilentGain = silentGain;

    const cleanupLoopback = this.attachLoopbackToNode(appCtx, musicGain, pid);

    this.appAudioCleanup = () => {
      cleanupLoopback();
      cleanupMusicNodes({
        musicGain,
        musicFxNodes: this.musicFxNodes,
        musicSplitter,
        musicLeftGainNode: musicLeftGain,
        musicRightGainNode: musicRightGain,
        musicMerger,
        musicMeterAnalyserL,
        musicMeterAnalyserR,
        musicSilentGain: silentGain
      });
      this.musicFxNodes = [];
      this.gainNodes.delete('music');
      this.musicLeftGainNode = undefined;
      this.musicRightGainNode = undefined;
      this.musicSplitter = undefined;
      this.musicMerger = undefined;
      this.musicMeterAnalyserL = undefined;
      this.musicMeterAnalyserR = undefined;
      this.musicSilentGain = undefined;
      this.lastConnectedMusicFx = undefined;
      if (this.appAudioContext && this.appAudioContext.state !== 'closed') {
        void this.appAudioContext.close().catch(() => {});
        this.appAudioContext = undefined;
      }
    };

    const outTrack = destination.stream.getAudioTracks()[0];
    if (!outTrack) throw new Error('Failed to create media track from app audio stream.');
    outTrack.contentHint = 'music';

    const effective: EffectiveAudioSettings = {
      channelCount: 2,
      sampleRate: targetSampleRate,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    };

    const next: AudioSourceConfig = {
      id: 'music',
      purpose: 'music',
      deviceId: `app:${pid}`,
      mode: 'music',
      enabled: true,
      track: outTrack,
      effective
    };

    const previous = this.sources.get('music');
    await this.senders.get('music')?.replaceTrack(outTrack);
    this.sources.set('music', next);
    previous?.track.stop();
    return next;
  }

  private async acquire(id: string, purpose: AudioSourcePurpose, deviceId: string | undefined, mode: AudioMode, preferences: AudioCapturePreferences): Promise<AudioSourceConfig> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(mode, deviceId, preferences), video: false });
    } catch (error) {
      if (preferences.sampleRate) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(mode, deviceId, { ...preferences, sampleRate: undefined }), video: false });
      } else {
        throw error;
      }
    }
    const rawTrack = stream.getAudioTracks()[0];
    if (!rawTrack) throw new Error('The selected audio input did not provide a track.');
    if (preferences.sampleRate) {
      try {
        await rawTrack.applyConstraints({ sampleRate: { ideal: preferences.sampleRate } });
      } catch {
        // Track settings dictate active rate
      }
    }
    rawTrack.contentHint = mode === 'music' ? 'music' : 'speech';

    const ctx = await this.getOrCreateAudioContext();
    let processedTrack = rawTrack;
    if (ctx && ctx.state !== 'closed') {
      try {
        const sourceNode = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
        const gainNode = ctx.createGain();
        const initialGain = preferences.inputGain !== undefined ? preferences.inputGain : 1.0;
        gainNode.gain.setValueAtTime(initialGain, ctx.currentTime);
        const destination = ctx.createMediaStreamDestination();

        const isStereo = preferences.stereo !== false;
        const outChannels = isStereo ? 2 : 1;
        const merger = ctx.createChannelMerger(outChannels);

        const route = preferences.channelRoute || 'all';

        if (route !== 'all') {
          let splitter: ChannelSplitterNode;
          try {
            splitter = ctx.createChannelSplitter(32);
          } catch {
            try {
              splitter = ctx.createChannelSplitter(8);
            } catch {
              splitter = ctx.createChannelSplitter(2);
            }
          }
          sourceNode.connect(splitter);

          if (route === '1') {
            splitter.connect(merger, 0, 0);
            if (outChannels > 1) splitter.connect(merger, 0, 1);
          } else if (route === '2') {
            splitter.connect(merger, 1, 0);
            if (outChannels > 1) splitter.connect(merger, 1, 1);
          } else if (route === '3') {
            splitter.connect(merger, 2, 0);
            if (outChannels > 1) splitter.connect(merger, 2, 1);
          } else if (route === '4') {
            splitter.connect(merger, 3, 0);
            if (outChannels > 1) splitter.connect(merger, 3, 1);
          } else if (route === '5') {
            splitter.connect(merger, 4, 0);
            if (outChannels > 1) splitter.connect(merger, 4, 1);
          } else if (route === '6') {
            splitter.connect(merger, 5, 0);
            if (outChannels > 1) splitter.connect(merger, 5, 1);
          } else if (route === '7') {
            splitter.connect(merger, 6, 0);
            if (outChannels > 1) splitter.connect(merger, 6, 1);
          } else if (route === '8') {
            splitter.connect(merger, 7, 0);
            if (outChannels > 1) splitter.connect(merger, 7, 1);
          } else if (route === '1-2') {
            splitter.connect(merger, 0, 0);
            if (outChannels > 1) splitter.connect(merger, 1, 1);
            else splitter.connect(merger, 1, 0);
          } else if (route === '3-4') {
            splitter.connect(merger, 2, 0);
            if (outChannels > 1) splitter.connect(merger, 3, 1);
            else splitter.connect(merger, 3, 0);
          } else if (route === '5-6') {
            splitter.connect(merger, 4, 0);
            if (outChannels > 1) splitter.connect(merger, 5, 1);
            else splitter.connect(merger, 5, 0);
          } else if (route === '7-8') {
            splitter.connect(merger, 6, 0);
            if (outChannels > 1) splitter.connect(merger, 7, 1);
            else splitter.connect(merger, 7, 0);
          } else {
            sourceNode.connect(merger);
          }
        } else {
          sourceNode.connect(merger);
        }

        merger.connect(gainNode);
        gainNode.connect(destination);
        const outTrack = destination.stream.getAudioTracks()[0];
        if (outTrack) {
          processedTrack = outTrack;
          this.gainNodes.set(id, gainNode);
        }
      } catch {
        // Fallback to raw track
      }
    }

    processedTrack.contentHint = mode === 'music' ? 'music' : 'speech';
    const previous = this.sources.get(id);
    this.rawTracks.get(id)?.stop();
    this.rawTracks.set(id, rawTrack);

    const effective = effectiveSettings(rawTrack);
    if (preferences.sampleRate) effective.sampleRate = preferences.sampleRate;
    if (preferences.stereo !== undefined) effective.channelCount = preferences.stereo ? 2 : 1;
    const next: AudioSourceConfig = { id, purpose, deviceId, mode, enabled: previous?.enabled ?? true, track: processedTrack, effective };
    processedTrack.enabled = next.enabled;
    try { await this.senders.get(id)?.replaceTrack(processedTrack); }
    catch (error) { processedTrack.stop(); rawTrack.stop(); throw error; }
    this.sources.set(id, next);
    previous?.track.stop();
    return next;
  }

  async addExternal(id: string, purpose: AudioSourcePurpose, track: MediaStreamTrack): Promise<AudioSourceConfig> {
    track.contentHint = purpose === 'music' ? 'music' : 'speech';
    const next: AudioSourceConfig = { id, purpose, mode: purpose === 'music' ? 'music' : 'talk', enabled: true, track, effective: effectiveSettings(track) };
    await this.senders.get(id)?.replaceTrack(track);
    this.sources.get(id)?.track.stop();
    this.sources.set(id, next);
    return next;
  }

  async remove(id: string): Promise<void> {
    if (id === 'music' && this.appAudioCleanup) {
      this.appAudioCleanup();
      this.appAudioCleanup = undefined;
    }
    await this.senders.get(id)?.replaceTrack(null);
    this.rawTracks.get(id)?.stop();
    this.rawTracks.delete(id);
    this.gainNodes.delete(id);
    this.sources.get(id)?.track.stop();
    this.sources.delete(id);
  }

  attachSender(id: string, sender: RTCRtpSender | undefined): void {
    if (sender) this.senders.set(id, sender);
    else this.senders.delete(id);
  }

  setEnabled(id: string, enabled: boolean): void {
    const source = this.sources.get(id);
    if (!source) return;
    source.enabled = enabled;
    source.track.enabled = enabled;
    const raw = this.rawTracks.get(id);
    if (raw) raw.enabled = enabled;
  }

  async applyVoiceGain(value: number): Promise<boolean> {
    const targetGain = Math.max(0, value);
    for (const [, mic] of this.voiceMics.entries()) {
      mic.preferences.inputGain = targetGain;
      if (mic.gainNode && this.audioContext && this.audioContext.state !== 'closed') {
        try {
          if (this.audioContext.state === 'suspended') {
            void this.audioContext.resume().catch(() => {});
          }
          mic.gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
          mic.gainNode.gain.setValueAtTime(targetGain, this.audioContext.currentTime);
        } catch {
          mic.gainNode.gain.value = targetGain;
        }
      }
    }
    const gainNode = this.gainNodes.get('voice');
    if (gainNode && this.audioContext && this.audioContext.state !== 'closed') {
      try {
        if (this.audioContext.state === 'suspended') {
          void this.audioContext.resume().catch(() => {});
        }
        gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
        gainNode.gain.setValueAtTime(targetGain, this.audioContext.currentTime);
      } catch {
        gainNode.gain.value = targetGain;
      }
      return true;
    }
    const track = this.rawTracks.get('voice') ?? this.voice?.track;
    if (track) {
      const capabilities = track.getCapabilities() as MediaTrackCapabilities & { volume?: { min: number; max: number } };
      if (capabilities.volume) {
        await track.applyConstraints({ advanced: [{ volume: Math.min(capabilities.volume.max, Math.max(capabilities.volume.min, Math.min(1.0, value))) } as MediaTrackConstraintSet] });
        return true;
      }
    }
    return true;
  }

  async applyMusicGain(value: number): Promise<boolean> {
    const targetGain = Math.max(0, value);
    const gainNode = this.gainNodes.get('music');
    const ctx = this.appAudioContext;
    if (gainNode && ctx && ctx.state !== 'closed') {
      try {
        if (ctx.state === 'suspended') {
          void ctx.resume().catch(() => {});
        }
        gainNode.gain.cancelScheduledValues(ctx.currentTime);
        gainNode.gain.setValueAtTime(targetGain, ctx.currentTime);
      } catch {
        gainNode.gain.value = targetGain;
      }
      return true;
    }
    const track = this.rawTracks.get('music') ?? this.music?.track;
    if (track) {
      const capabilities = track.getCapabilities() as MediaTrackCapabilities & { volume?: { min: number; max: number } };
      if (capabilities.volume) {
        await track.applyConstraints({ advanced: [{ volume: Math.min(capabilities.volume.max, Math.max(capabilities.volume.min, Math.min(1.0, value))) } as MediaTrackConstraintSet] });
        return true;
      }
    }
    return true;
  }

  async applyMusicPan(pan: number): Promise<boolean> {
    const clampedPan = Math.max(-1, Math.min(1, pan));
    const leftNode = this.musicLeftGainNode;
    const rightNode = this.musicRightGainNode;
    const ctx = this.appAudioContext;
    if (leftNode && rightNode && ctx && ctx.state !== 'closed') {
      const { left, right } = getStereoBalanceGains(clampedPan);
      try {
        if (ctx.state === 'suspended') {
          void ctx.resume().catch(() => {});
        }
        const now = ctx.currentTime;
        leftNode.gain.cancelScheduledValues(now);
        leftNode.gain.setValueAtTime(left, now);
        rightNode.gain.cancelScheduledValues(now);
        rightNode.gain.setValueAtTime(right, now);
      } catch {
        leftNode.gain.value = left;
        rightNode.gain.value = right;
      }
      return true;
    }
    return false;
  }

  setVoiceMicFx(micIndex: number, fxList: string[]): void {
    const mic = this.voiceMics.get(micIndex);
    const ctx = this.audioContext;
    if (!mic || !ctx || ctx.state === 'closed') return;

    const channelId = micIndex === 1 ? 'you-mic' : `you-mic-${micIndex}`;
    const slots = Array.isArray(fxList) ? fxList.slice(0, 4) : [];
    const fxKey = slots.map((f, i) => `${i}:${f || ''}`).join('|');
    if (mic.lastConnectedFx === fxKey) return;

    const now = ctx.currentTime;

    // Disconnect gainNode and all previous FX nodes for this channel
    safeDisconnect(mic.gainNode);
    for (const node of mic.fxNodes) {
      safeDisconnect(node);
    }
    mic.fxNodes = [];

    // VU Analyser stays connected to gainNode
    try { mic.gainNode.connect(mic.analyserNode); } catch {}

    let currentSource: AudioNode = mic.gainNode;

    for (let i = 0; i < 4; i++) {
      const fxName = slots[i];
      if (fxName === 'Chan EQ') {
        const eqDsp = channelEqDspRegistry.getOrCreate(channelId, i, ctx);
        currentSource.connect(eqDsp.inputNode);
        currentSource = eqDsp.outputNode;
        mic.fxNodes.push(eqDsp.outputNode);
      } else if (fxName === 'Compressor') {
        channelEqDspRegistry.remove(channelId, i);
        const compressorNode = ctx.createDynamicsCompressor();
        compressorNode.threshold.setValueAtTime(-18.0, now);
        compressorNode.knee.setValueAtTime(6.0, now);
        compressorNode.ratio.setValueAtTime(4.0, now);
        compressorNode.attack.setValueAtTime(0.005, now);
        compressorNode.release.setValueAtTime(0.08, now);

        currentSource.connect(compressorNode);
        currentSource = compressorNode;
        mic.fxNodes.push(compressorNode);
      } else {
        channelEqDspRegistry.remove(channelId, i);
      }
    }

    // Connect to Pan / Balance Stage
    if (mic.isStereo && mic.stereoSplitter) {
      currentSource.connect(mic.stereoSplitter);
    } else if (mic.pannerNode) {
      currentSource.connect(mic.pannerNode);
    }

    mic.lastConnectedFx = fxKey;
  }

  setMusicFx(fxList: string[]): void {
    const ctx = this.appAudioContext;
    const musicGain = this.gainNodes.get('music');
    const musicSplitter = this.musicSplitter;
    if (!ctx || ctx.state === 'closed' || !musicGain || !musicSplitter) return;

    const channelId = 'music-stream';
    const slots = Array.isArray(fxList) ? fxList.slice(0, 4) : [];
    const fxKey = slots.map((f, i) => `${i}:${f || ''}`).join('|');
    if (this.lastConnectedMusicFx === fxKey) return;

    const now = ctx.currentTime;

    // Disconnect musicGain and all previous music FX nodes
    safeDisconnect(musicGain);
    for (const node of this.musicFxNodes) {
      safeDisconnect(node);
    }
    this.musicFxNodes = [];

    // Reconnect the single, stable silent clock path to musicGain
    if (this.musicSilentGain) {
      try { musicGain.connect(this.musicSilentGain); } catch {}
    }

    let currentSource: AudioNode = musicGain;

    for (let i = 0; i < 4; i++) {
      const fxName = slots[i];
      if (fxName === 'Chan EQ') {
        const eqDsp = channelEqDspRegistry.getOrCreate(channelId, i, ctx);
        currentSource.connect(eqDsp.inputNode);
        currentSource = eqDsp.outputNode;
        this.musicFxNodes.push(eqDsp.outputNode);
      } else if (fxName === 'Compressor') {
        channelEqDspRegistry.remove(channelId, i);
        const compressorNode = ctx.createDynamicsCompressor();
        compressorNode.threshold.setValueAtTime(-12.0, now);
        compressorNode.knee.setValueAtTime(6.0, now);
        compressorNode.ratio.setValueAtTime(3.0, now);
        compressorNode.attack.setValueAtTime(0.01, now);
        compressorNode.release.setValueAtTime(0.1, now);

        currentSource.connect(compressorNode);
        currentSource = compressorNode;
        this.musicFxNodes.push(compressorNode);
      } else {
        channelEqDspRegistry.remove(channelId, i);
      }
    }

    currentSource.connect(musicSplitter);
    this.lastConnectedMusicFx = fxKey;
  }

  getVoiceMicAudioContext(): AudioContext | undefined {
    return this.audioContext;
  }

  getAppAudioContext(): AudioContext | undefined {
    return this.appAudioContext;
  }

  getVoiceMicEqDsp(micIndex: number, slotIndex: number): ChannelEqDspInstance | undefined {
    const channelId = micIndex === 1 ? 'you-mic' : `you-mic-${micIndex}`;
    return channelEqDspRegistry.get(channelId, slotIndex);
  }

  getMusicEqDsp(slotIndex: number): ChannelEqDspInstance | undefined {
    return channelEqDspRegistry.get('music-stream', slotIndex);
  }

  getVoiceMicsCount(): number {
    return this.voiceMics.size;
  }

  metadata(): AudioSourceMetadata[] {
    return [...this.sources.values()].map((source) => ({
      id: source.id, purpose: source.purpose, mode: source.mode, enabled: source.enabled,
      channels: source.effective.channelCount, sampleRate: source.effective.sampleRate
    }));
  }

  dispose(): void {
    const api = getDesktopApi();
    if (this.hardwareAudioCleanup) {
      this.hardwareAudioCleanup();
      this.hardwareAudioCleanup = undefined;
      void api?.stopHardwareAudioCapture?.();
    }
    if (this.appAudioCleanup) {
      this.appAudioCleanup();
      this.appAudioCleanup = undefined;
      void api?.stopAppAudioCapture?.();
    }
    for (const mic of this.voiceMics.values()) {
      cleanupVoiceMicNodes(mic);
    }
    this.voiceMics.clear();
    for (const track of this.rawTracks.values()) track.stop();
    this.rawTracks.clear();
    for (const source of this.sources.values()) source.track.stop();
    const musicGain = this.gainNodes.get('music');
    this.sources.clear();
    this.gainNodes.clear();
    cleanupMusicNodes({
      musicGain,
      musicFxNodes: this.musicFxNodes,
      musicSplitter: this.musicSplitter,
      musicLeftGainNode: this.musicLeftGainNode,
      musicRightGainNode: this.musicRightGainNode,
      musicMerger: this.musicMerger,
      musicMeterAnalyserL: this.musicMeterAnalyserL,
      musicMeterAnalyserR: this.musicMeterAnalyserR,
      musicSilentGain: this.musicSilentGain
    });
    this.musicFxNodes = [];
    this.musicSilentGain = undefined;
    this.lastConnectedMusicFx = undefined;
    this.musicSplitter = undefined;
    this.musicLeftGainNode = undefined;
    this.musicRightGainNode = undefined;
    this.musicMerger = undefined;
    this.musicMeterAnalyserL = undefined;
    this.musicMeterAnalyserR = undefined;
    this.senders.clear();
    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close().catch(() => {});
      this.audioContext = undefined;
    }
    if (this.appAudioContext && this.appAudioContext.state !== 'closed') {
      void this.appAudioContext.close().catch(() => {});
      this.appAudioContext = undefined;
    }
  }
}
