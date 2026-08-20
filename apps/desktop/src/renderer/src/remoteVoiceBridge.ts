/**
 * JaMeet Remote Voice Bridge (macOS AudioWorklet Integration)
 * 
 * Captures decoded remote collaborator Voice PCM pre-fader from remoteVoiceSourceNode,
 * batches the 48 kHz stereo Float32 audio into 10 ms (480-frame) quanta, and streams
 * it via IPC into the JaMeet Remote producer bridge.
 */

let bridgeSessionId = 0;
let activeWorkletNode: AudioWorkletNode | null = null;
let activeSourceNode: MediaStreamAudioSourceNode | null = null;
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

function teardownActiveBridgeNode(): void {
  if (activeSourceNode && activeWorkletNode) {
    try {
      activeSourceNode.disconnect(activeWorkletNode);
    } catch {}
  }
  if (activeWorkletNode) {
    try {
      activeWorkletNode.port.postMessage({ type: 'stop' });
      activeWorkletNode.disconnect();
    } catch {}
    activeWorkletNode.port.onmessage = null;
    activeWorkletNode = null;
  }
  activeSourceNode = null;
}

export async function startRemoteVoiceBridge(
  ctx: AudioContext,
  sourceNode: MediaStreamAudioSourceNode
): Promise<void> {
  const requestId = ++bridgeSessionId;

  if (typeof window === 'undefined' || !window.jameet?.remoteVoiceBridge) {
    return;
  }
  if (window.jameet.platform !== 'darwin' && window.jameet.platform !== 'win32') {
    return;
  }

  try {
    const bridgeOk = await window.jameet.remoteVoiceBridge.start();
    if (requestId !== bridgeSessionId || !bridgeOk) {
      return;
    }

    if (!registeredAudioContexts.has(ctx)) {
      const workletUrl = getWorkletProcessorUrl();
      await ctx.audioWorklet.addModule(workletUrl);
      if (requestId !== bridgeSessionId) {
        return;
      }
      registeredAudioContexts.add(ctx);
    }

    teardownActiveBridgeNode();

    if (requestId !== bridgeSessionId) {
      return;
    }

    const workletNode = new AudioWorkletNode(ctx, 'jameet-remote-voice-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 2,
      channelCountMode: 'explicit'
    });

    if (requestId !== bridgeSessionId) {
      try {
        workletNode.port.postMessage({ type: 'stop' });
        workletNode.disconnect();
      } catch {}
      workletNode.port.onmessage = null;
      return;
    }

    workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (requestId !== bridgeSessionId) return;
      const pcmChunk = event.data;
      if (pcmChunk && pcmChunk.length > 0) {
        window.jameet?.remoteVoiceBridge?.sendPcm(pcmChunk, true);
      }
    };

    sourceNode.connect(workletNode);
    activeWorkletNode = workletNode;
    activeSourceNode = sourceNode;
  } catch (err) {
    if (requestId === bridgeSessionId) {
      console.warn('[JaMeetRemote] Could not start remote voice bridge worklet:', err);
    }
  }
}

export function stopRemoteVoiceBridge(): void {
  // Invalidate all pending start requests immediately
  ++bridgeSessionId;

  teardownActiveBridgeNode();

  if (typeof window !== 'undefined' && window.jameet?.remoteVoiceBridge) {
    void window.jameet.remoteVoiceBridge.stop();
  }
}
