/**
 * JaMeet Remote Voice Bridge (macOS AudioWorklet Integration)
 * 
 * Captures decoded remote collaborator Voice PCM pre-fader from remoteVoiceSourceNode,
 * batches the 48 kHz stereo Float32 audio into 10 ms (480-sample) quanta, and streams
 * it via IPC into the JaMeet Remote producer bridge.
 */

const WORKLET_PROCESSOR_CODE = `
class JaMeetRemoteVoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batchFrames = 480; // 10 ms at 48 kHz
    this.batchSamples = this.batchFrames * 2; // Stereo interleaved
    this.buffer = new Float32Array(this.batchSamples);
    this.bufferOffset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const left = input[0];
    const right = input.length > 1 ? input[1] : left;
    const quantumFrames = left ? left.length : 0;
    if (quantumFrames === 0) {
      return true;
    }

    for (let i = 0; i < quantumFrames; i++) {
      const l = left[i] || 0;
      const r = right ? (right[i] || 0) : l;

      this.buffer[this.bufferOffset++] = l;
      this.buffer[this.bufferOffset++] = r;

      if (this.bufferOffset >= this.batchSamples) {
        const chunk = new Float32Array(this.buffer);
        this.port.postMessage(chunk, [chunk.buffer]);
        this.bufferOffset = 0;
      }
    }

    return true;
  }
}

registerProcessor('jameet-remote-voice-processor', JaMeetRemoteVoiceProcessor);
`;

declare global {
  interface Window {
    jameet?: {
      platform?: string;
      remoteVoiceBridge?: {
        start: () => Promise<boolean>;
        sendPcm: (data: Float32Array, isRouteActive: boolean) => void;
        stop: () => Promise<boolean>;
      };
    };
  }
}

let activeWorkletNode: AudioWorkletNode | null = null;
let registeredAudioContexts = new WeakSet<AudioContext>();

export async function startRemoteVoiceBridge(
  ctx: AudioContext,
  sourceNode: MediaStreamAudioSourceNode
): Promise<void> {
  if (typeof window === 'undefined' || !window.jameet?.remoteVoiceBridge) {
    return;
  }
  if (window.jameet.platform !== 'darwin') {
    return;
  }

  try {
    const bridgeOk = await window.jameet.remoteVoiceBridge.start();
    if (!bridgeOk) {
      return;
    }

    if (!registeredAudioContexts.has(ctx)) {
      if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
        const blob = new Blob([WORKLET_PROCESSOR_CODE], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        try {
          await ctx.audioWorklet.addModule(blobUrl);
          registeredAudioContexts.add(ctx);
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      }
    }

    if (activeWorkletNode) {
      try { activeWorkletNode.disconnect(); } catch {}
      activeWorkletNode.port.onmessage = null;
      activeWorkletNode = null;
    }

    const workletNode = new AudioWorkletNode(ctx, 'jameet-remote-voice-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 2,
      channelCountMode: 'explicit'
    });

    workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const pcmChunk = event.data;
      if (pcmChunk && pcmChunk.length > 0) {
        window.jameet?.remoteVoiceBridge?.sendPcm(pcmChunk, true);
      }
    };

    sourceNode.connect(workletNode);
    activeWorkletNode = workletNode;
  } catch (err) {
    console.warn('[JaMeetRemote] Could not start remote voice bridge worklet:', err);
  }
}

export function stopRemoteVoiceBridge(): void {
  if (activeWorkletNode) {
    try { activeWorkletNode.disconnect(); } catch {}
    activeWorkletNode.port.onmessage = null;
    activeWorkletNode = null;
  }

  if (typeof window !== 'undefined' && window.jameet?.remoteVoiceBridge) {
    void window.jameet.remoteVoiceBridge.stop();
  }
}
