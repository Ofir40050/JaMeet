import type { AudioMode, AudioSourceMetadata } from '@jameet/shared';
import { audioConstraints, effectiveSettings, type AudioCapturePreferences, type EffectiveAudioSettings } from './audioProfiles';

export type AudioSourcePurpose = 'voice' | 'music';
export type AudioSourceConfig = {
  id: string;
  purpose: AudioSourcePurpose;
  deviceId?: string;
  mode: AudioMode;
  enabled: boolean;
  track: MediaStreamTrack;
  effective: EffectiveAudioSettings;
};

function getDesktopApi(): any {
  if (typeof window === 'undefined') return undefined;
  return (window as any).jameet || (window as any).musiczoom;
}

function getStereoBalanceGains(pan: number): { left: number; right: number } {
  const clamped = Math.max(-1, Math.min(1, pan));
  const left = clamped <= 0 ? 1.0 : Math.max(0, 1.0 - clamped);
  const right = clamped >= 0 ? 1.0 : Math.max(0, 1.0 + clamped);
  return { left, right };
}

type VoiceMicChannel = {
  rawTrack?: MediaStreamTrack;
  isolatedTrack: MediaStreamTrack;
  sourceNode?: MediaStreamAudioSourceNode;
  gainNode: GainNode;
  isStereo: boolean;
  pannerNode?: StereoPannerNode;
  stereoSplitter?: ChannelSplitterNode;
  leftGainNode?: GainNode;
  rightGainNode?: GainNode;
  stereoMerger?: ChannelMergerNode;
  analyserNode: AnalyserNode;  // Always-connected analyser for VU metering
  micDestination: MediaStreamAudioDestinationNode;
  preferences: AudioCapturePreferences;
  deviceId?: string;
  nextPlayTime?: number;
};

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

  getMusicNode(): AudioNode | undefined {
    return this.gainNodes.get('music');
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
      const ctx = this.audioContext;

      const buffer = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
      if (buffer.byteLength < 8) return;

      const uint32Header = new Uint32Array(buffer, 0, 2);
      const totalChannels = uint32Header[0]!;
      const frameCount = uint32Header[1]!;
      if (totalChannels <= 0 || frameCount <= 0) return;

      const floatSamples = new Float32Array(buffer, 8);
      if (floatSamples.length < frameCount * totalChannels) return;

      const now = ctx.currentTime;

      for (const [, mic] of this.voiceMics.entries()) {
        const route = mic.preferences.channelRoute || '1';
        const isStereo = mic.preferences.stereo !== false && (route === '1-2' || route === '3-4' || route === '5-6' || route === '7-8');
        const outChannels = isStereo ? 2 : 1;

        const audioBuffer = ctx.createBuffer(outChannels, frameCount, 48000);

        if (isStereo) {
          let leftIdx = 0;
          let rightIdx = 1;
          if (route === '3-4') { leftIdx = 2; rightIdx = 3; }
          else if (route === '5-6') { leftIdx = 4; rightIdx = 5; }
          else if (route === '7-8') { leftIdx = 6; rightIdx = 7; }

          leftIdx = Math.min(leftIdx, totalChannels - 1);
          rightIdx = Math.min(rightIdx, totalChannels - 1);

          const leftData = audioBuffer.getChannelData(0);
          const rightData = audioBuffer.getChannelData(1);
          for (let f = 0; f < frameCount; f++) {
            leftData[f] = floatSamples[f * totalChannels + leftIdx]!;
            rightData[f] = floatSamples[f * totalChannels + rightIdx]!;
          }
        } else {
          let chIdx = 0;
          if (route === '1') chIdx = 0;
          else if (route === '2') chIdx = 1;
          else if (route === '3') chIdx = 2;
          else if (route === '4') chIdx = 3;
          else if (route === '5') chIdx = 4;
          else if (route === '6') chIdx = 5;
          else if (route === '7') chIdx = 6;
          else if (route === '8') chIdx = 7;
          else if (route === 'all') chIdx = 0;
          else {
            const parsed = parseInt(route, 10);
            if (!isNaN(parsed) && parsed >= 1) chIdx = parsed - 1;
          }

          chIdx = Math.min(chIdx, totalChannels - 1);
          const monoData = audioBuffer.getChannelData(0);
          for (let f = 0; f < frameCount; f++) {
            monoData[f] = floatSamples[f * totalChannels + chIdx]!;
          }
        }

        const sourceNode = ctx.createBufferSource();
        sourceNode.buffer = audioBuffer;
        sourceNode.connect(mic.gainNode);
        sourceNode.connect(mic.analyserNode); // Also feed analyser for VU metering
        sourceNode.connect(mic.micDestination);

        if (mic.nextPlayTime === undefined || mic.nextPlayTime < now || mic.nextPlayTime > now + 0.05) {
          mic.nextPlayTime = now;
        }
        sourceNode.start(mic.nextPlayTime);
        mic.nextPlayTime += audioBuffer.duration;
      }
    });
  }

  async removeVoiceMic(micIndex: number): Promise<void> {
    const mic = this.voiceMics.get(micIndex);
    if (mic) {
      mic.rawTrack?.stop();
      mic.isolatedTrack?.stop();
      try { mic.sourceNode?.disconnect(); } catch {}
      try { mic.gainNode?.disconnect(); } catch {}
      try { mic.pannerNode?.disconnect(); } catch {}
      try { mic.stereoSplitter?.disconnect(); } catch {}
      try { mic.leftGainNode?.disconnect(); } catch {}
      try { mic.rightGainNode?.disconnect(); } catch {}
      try { mic.stereoMerger?.disconnect(); } catch {}
      try { mic.micDestination?.disconnect(); } catch {}
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
      prevMic.rawTrack?.stop();
      prevMic.isolatedTrack?.stop();
      try { prevMic.sourceNode?.disconnect(); } catch {}
      try { prevMic.gainNode?.disconnect(); } catch {}
      try { prevMic.pannerNode?.disconnect(); } catch {}
      try { prevMic.stereoSplitter?.disconnect(); } catch {}
      try { prevMic.leftGainNode?.disconnect(); } catch {}
      try { prevMic.rightGainNode?.disconnect(); } catch {}
      try { prevMic.stereoMerger?.disconnect(); } catch {}
      try { prevMic.micDestination?.disconnect(); } catch {}
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

    if (route !== 'all') {
      let splitter: ChannelSplitterNode;
      try { splitter = ctx.createChannelSplitter(32); }
      catch { try { splitter = ctx.createChannelSplitter(8); } catch { splitter = ctx.createChannelSplitter(2); } }
      sourceNode.connect(splitter);

      if (route === '1-2') {
        splitter.connect(micMerger, 0, 0);
        if (outChannels > 1) {
          splitter.connect(micMerger, 1, 1);
        } else {
          splitter.connect(micMerger, 1, 0);
        }
      } else if (route === '3-4') {
        splitter.connect(micMerger, 2, 0);
        if (outChannels > 1) {
          splitter.connect(micMerger, 3, 1);
        } else {
          splitter.connect(micMerger, 3, 0);
        }
      } else if (route === '5-6') {
        splitter.connect(micMerger, 4, 0);
        if (outChannels > 1) {
          splitter.connect(micMerger, 5, 1);
        } else {
          splitter.connect(micMerger, 5, 0);
        }
      } else if (route === '7-8') {
        splitter.connect(micMerger, 6, 0);
        if (outChannels > 1) {
          splitter.connect(micMerger, 7, 1);
        } else {
          splitter.connect(micMerger, 7, 0);
        }
      } else {
        let chIdx = 0;
        const parsed = parseInt(route, 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 32) {
          chIdx = parsed - 1;
        }
        splitter.connect(micMerger, chIdx, 0);
      }
    } else {
      sourceNode.connect(micMerger);
    }

    micMerger.connect(gainNode);

    let pannerNode: StereoPannerNode | undefined;
    let stereoSplitter: ChannelSplitterNode | undefined;
    let leftGainNode: GainNode | undefined;
    let rightGainNode: GainNode | undefined;
    let stereoMerger: ChannelMergerNode | undefined;

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
    } else {
      // Mono hardware route: True Constant Power Mono-to-Stereo Panning
      pannerNode = ctx.createStereoPanner();
      pannerNode.pan.setValueAtTime(panVal, ctx.currentTime);

      gainNode.connect(pannerNode);

      if (this.voiceDestination) {
        pannerNode.connect(this.voiceDestination);
      }
      pannerNode.connect(micDestination);
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
    const targetSampleRate = ctx.sampleRate;
    const ringCapacity = Math.round(targetSampleRate * 0.25); // 250ms ring capacity
    const maxBufferedFrames = Math.round(targetSampleRate * 0.08); // 80ms max target latency
    const ringL = new Float32Array(ringCapacity);
    const ringR = new Float32Array(ringCapacity);
    let writePos = 0;
    let readPos = 0;
    let availableSamples = 0;
    let lastPacketTime = performance.now();

    const processor = ctx.createScriptProcessor(1024, 0, 2);
    processor.onaudioprocess = (e) => {
      const now = performance.now();
      const outL = e.outputBuffer.getChannelData(0);
      const outR = e.outputBuffer.getChannelData(1);
      const bufferSize = outL.length;

      // If no new packets arrived for > 150ms, source stopped or paused: flush stale queue
      if (now - lastPacketTime > 150) {
        availableSamples = 0;
        readPos = writePos;
        outL.fill(0);
        outR.fill(0);
        return;
      }

      // If backlog grew beyond maxBufferedFrames, skip old frames to prevent delayed audio
      if (availableSamples > maxBufferedFrames) {
        const excess = availableSamples - maxBufferedFrames;
        readPos = (readPos + excess) % ringCapacity;
        availableSamples = maxBufferedFrames;
      }

      if (availableSamples >= bufferSize) {
        for (let i = 0; i < bufferSize; i++) {
          outL[i] = ringL[readPos]!;
          outR[i] = ringR[readPos]!;
          readPos = (readPos + 1) % ringCapacity;
        }
        availableSamples -= bufferSize;
      } else if (availableSamples > 0) {
        for (let i = 0; i < availableSamples; i++) {
          outL[i] = ringL[readPos]!;
          outR[i] = ringR[readPos]!;
          readPos = (readPos + 1) % ringCapacity;
        }
        for (let i = availableSamples; i < bufferSize; i++) {
          outL[i] = 0;
          outR[i] = 0;
        }
        availableSamples = 0;
      } else {
        outL.fill(0);
        outR.fill(0);
      }
    };

    processor.connect(targetNode);

    const api = getDesktopApi();
    if (api?.startAppAudioCapture) {
      void api.startAppAudioCapture(targetCapture, channelRoute);
    }

    const unsubscribeChunk = api?.onAppAudioChunk?.((chunk: Uint8Array) => {
      if (!ctx || ctx.state === 'closed') return;
      lastPacketTime = performance.now();
      const byteLen = chunk.byteLength;
      if (byteLen < 16) return;

      const buffer = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
      const header = new Uint32Array(buffer, 0, 4);
      let srcSampleRate = header[0]!;
      let srcFrames = header[2]!;
      let floatOffset = 16;

      if (srcSampleRate < 8000 || srcSampleRate > 192000 || srcFrames <= 0) {
        srcSampleRate = 48000;
        floatOffset = 0;
        srcFrames = Math.floor(buffer.byteLength / 8);
      }

      const floatArray = new Float32Array(buffer, floatOffset);
      if (floatArray.length < srcFrames * 2) return;

      if (srcSampleRate === targetSampleRate) {
        for (let f = 0; f < srcFrames; f++) {
          if (availableSamples < ringCapacity) {
            ringL[writePos] = floatArray[f * 2]!;
            ringR[writePos] = floatArray[f * 2 + 1]!;
            writePos = (writePos + 1) % ringCapacity;
            availableSamples++;
          }
        }
      } else {
        const ratio = targetSampleRate / srcSampleRate;
        const targetFrames = Math.round(srcFrames * ratio);
        for (let t = 0; t < targetFrames; t++) {
          if (availableSamples < ringCapacity) {
            const srcIdx = t / ratio;
            const i0 = Math.floor(srcIdx);
            const frac = srcIdx - i0;
            const i1 = Math.min(i0 + 1, srcFrames - 1);

            const l0 = floatArray[i0 * 2]!;
            const r0 = floatArray[i0 * 2 + 1]!;
            const l1 = floatArray[i1 * 2]!;
            const r1 = floatArray[i1 * 2 + 1]!;

            ringL[writePos] = l0 * (1 - frac) + l1 * frac;
            ringR[writePos] = r0 * (1 - frac) + r1 * frac;
            writePos = (writePos + 1) % ringCapacity;
            availableSamples++;
          }
        }
      }
    });

    const unsubscribeStopped = api?.onAppAudioStopped?.(() => {
      availableSamples = 0;
      readPos = writePos;
    });

    return () => {
      availableSamples = 0;
      readPos = writePos;
      ringL.fill(0);
      ringR.fill(0);
      if (unsubscribeChunk) unsubscribeChunk();
      if (unsubscribeStopped) unsubscribeStopped();
      try { processor.disconnect(); } catch {}
      const cleanupApi = getDesktopApi();
      if (cleanupApi?.stopAppAudioCapture) {
        void cleanupApi.stopAppAudioCapture();
      }
    };
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

    this.gainNodes.set('music', musicGain);
    this.musicLeftGainNode = musicLeftGain;
    this.musicRightGainNode = musicRightGain;
    this.musicSplitter = musicSplitter;
    this.musicMerger = musicMerger;

    // Keep graph clock continuously running without local playback echo
    const silentGain = appCtx.createGain();
    silentGain.gain.setValueAtTime(0.0, appCtx.currentTime);
    musicGain.connect(silentGain);
    try { silentGain.connect(appCtx.destination); } catch {}

    const channelRoute = preferences.channelRoute || '1-2';
    const targetCapture = `device:${deviceId}`;
    const cleanupLoopback = this.attachLoopbackToNode(appCtx, musicGain, targetCapture, channelRoute);

    this.appAudioCleanup = () => {
      cleanupLoopback();
      try { musicGain.disconnect(); } catch {}
      try { musicSplitter.disconnect(); } catch {}
      try { musicLeftGain.disconnect(); } catch {}
      try { musicRightGain.disconnect(); } catch {}
      try { musicMerger.disconnect(); } catch {}
      try { silentGain.disconnect(); } catch {}
      this.gainNodes.delete('music');
      this.musicLeftGainNode = undefined;
      this.musicRightGainNode = undefined;
      this.musicSplitter = undefined;
      this.musicMerger = undefined;
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

    this.gainNodes.set('music', musicGain);
    this.musicLeftGainNode = musicLeftGain;
    this.musicRightGainNode = musicRightGain;
    this.musicSplitter = musicSplitter;
    this.musicMerger = musicMerger;

    // Keep graph clock continuously running without local playback echo
    const silentGain = appCtx.createGain();
    silentGain.gain.setValueAtTime(0.0, appCtx.currentTime);
    musicGain.connect(silentGain);
    try { silentGain.connect(appCtx.destination); } catch {}

    const cleanupLoopback = this.attachLoopbackToNode(appCtx, musicGain, pid);

    this.appAudioCleanup = () => {
      cleanupLoopback();
      try { musicGain.disconnect(); } catch {}
      try { musicSplitter.disconnect(); } catch {}
      try { musicLeftGain.disconnect(); } catch {}
      try { musicRightGain.disconnect(); } catch {}
      try { musicMerger.disconnect(); } catch {}
      try { silentGain.disconnect(); } catch {}
      this.gainNodes.delete('music');
      this.musicLeftGainNode = undefined;
      this.musicRightGainNode = undefined;
      this.musicSplitter = undefined;
      this.musicMerger = undefined;
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
      mic.rawTrack?.stop();
      mic.isolatedTrack?.stop();
      try { mic.sourceNode?.disconnect(); } catch {}
      try { mic.gainNode?.disconnect(); } catch {}
      try { mic.pannerNode?.disconnect(); } catch {}
      try { mic.stereoSplitter?.disconnect(); } catch {}
      try { mic.leftGainNode?.disconnect(); } catch {}
      try { mic.rightGainNode?.disconnect(); } catch {}
      try { mic.stereoMerger?.disconnect(); } catch {}
      try { mic.micDestination?.disconnect(); } catch {}
    }
    this.voiceMics.clear();
    for (const track of this.rawTracks.values()) track.stop();
    this.rawTracks.clear();
    for (const source of this.sources.values()) source.track.stop();
    this.sources.clear();
    this.gainNodes.clear();
    try { this.musicSplitter?.disconnect(); } catch {}
    try { this.musicLeftGainNode?.disconnect(); } catch {}
    try { this.musicRightGainNode?.disconnect(); } catch {}
    try { this.musicMerger?.disconnect(); } catch {}
    this.musicSplitter = undefined;
    this.musicLeftGainNode = undefined;
    this.musicRightGainNode = undefined;
    this.musicMerger = undefined;
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
