/**
 * JaMeet Remote Voice Bridge (macOS AudioWorklet Integration)
 * 
 * Captures decoded remote collaborator Voice PCM pre-fader from remoteVoiceSourceNode,
 * batches the 48 kHz stereo Float32 audio into 10 ms (480-frame) quanta, and streams
 * it via IPC into the JaMeet Remote producer bridge.
 */

let activeWorkletNode: AudioWorkletNode | null = null;
let registeredAudioContexts = new WeakSet<AudioContext>();

function getWorkletProcessorUrl(): string {
  if (typeof window !== 'undefined' && window.location) {
    try {
      return new URL('remote-voice-processor.js', window.location.href).href;
    } catch {
      return './remote-voice-processor.js';
    }
  }
  return './remote-voice-processor.js';
}

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
      const workletUrl = getWorkletProcessorUrl();
      await ctx.audioWorklet.addModule(workletUrl);
      registeredAudioContexts.add(ctx);
    }

    if (activeWorkletNode) {
      try {
        activeWorkletNode.port.postMessage({ type: 'stop' });
        activeWorkletNode.disconnect();
      } catch {}
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
    try {
      activeWorkletNode.port.postMessage({ type: 'stop' });
      activeWorkletNode.disconnect();
    } catch {}
    activeWorkletNode.port.onmessage = null;
    activeWorkletNode = null;
  }

  if (typeof window !== 'undefined' && window.jameet?.remoteVoiceBridge) {
    void window.jameet.remoteVoiceBridge.stop();
  }
}
