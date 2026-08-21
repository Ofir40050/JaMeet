import type { VoiceMicChannel } from './types';

export function safeDisconnect(node?: AudioNode): void {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    // Ignore already disconnected or invalid node errors
  }
}

export function cleanupVoiceMicNodes(mic: VoiceMicChannel): void {
  mic.rawTrack?.stop();
  mic.isolatedTrack?.stop();
  safeDisconnect(mic.sourceNode);
  safeDisconnect(mic.gainNode);
  for (const node of mic.fxNodes) {
    safeDisconnect(node);
  }
  mic.fxNodes = [];
  safeDisconnect(mic.pannerNode);
  safeDisconnect(mic.stereoSplitter);
  safeDisconnect(mic.leftGainNode);
  safeDisconnect(mic.rightGainNode);
  safeDisconnect(mic.stereoMerger);
  safeDisconnect(mic.meterSplitter);
  safeDisconnect(mic.meterAnalyserL);
  safeDisconnect(mic.meterAnalyserR);
  safeDisconnect(mic.downmixGainNode);
  safeDisconnect(mic.micDestination);
}

export function cleanupMusicNodes(nodes: {
  musicGain?: GainNode;
  musicFxNodes?: AudioNode[];
  musicSplitter?: ChannelSplitterNode;
  musicLeftGainNode?: GainNode;
  musicRightGainNode?: GainNode;
  musicMerger?: ChannelMergerNode;
  musicMeterAnalyserL?: AnalyserNode;
  musicMeterAnalyserR?: AnalyserNode;
  musicSilentGain?: GainNode;
}): void {
  safeDisconnect(nodes.musicGain);
  if (nodes.musicFxNodes) {
    for (const node of nodes.musicFxNodes) {
      safeDisconnect(node);
    }
  }
  safeDisconnect(nodes.musicSplitter);
  safeDisconnect(nodes.musicLeftGainNode);
  safeDisconnect(nodes.musicRightGainNode);
  safeDisconnect(nodes.musicMerger);
  safeDisconnect(nodes.musicMeterAnalyserL);
  safeDisconnect(nodes.musicMeterAnalyserR);
  safeDisconnect(nodes.musicSilentGain);
}
