import type { VoiceMicChannel } from './types';

export function routeHardwareAudioChunk(
  ctx: AudioContext,
  chunk: Uint8Array,
  voiceMics: Map<number, VoiceMicChannel>
): void {
  if (!ctx || ctx.state === 'closed') return;

  const buffer = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
  if (buffer.byteLength < 8) return;

  const uint32Header = new Uint32Array(buffer, 0, 2);
  const totalChannels = uint32Header[0]!;
  const frameCount = uint32Header[1]!;
  if (totalChannels <= 0 || frameCount <= 0) return;

  const floatSamples = new Float32Array(buffer, 8);
  if (floatSamples.length < frameCount * totalChannels) return;

  const now = ctx.currentTime;

  for (const [, mic] of voiceMics.entries()) {
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
    } else if (route === '1-2' || route === '3-4' || route === '5-6' || route === '7-8') {
      let leftIdx = 0;
      let rightIdx = 1;
      if (route === '3-4') { leftIdx = 2; rightIdx = 3; }
      else if (route === '5-6') { leftIdx = 4; rightIdx = 5; }
      else if (route === '7-8') { leftIdx = 6; rightIdx = 7; }

      leftIdx = Math.min(leftIdx, totalChannels - 1);
      rightIdx = Math.min(rightIdx, totalChannels - 1);

      const monoData = audioBuffer.getChannelData(0);
      for (let f = 0; f < frameCount; f++) {
        monoData[f] = 0.5 * (floatSamples[f * totalChannels + leftIdx]! + floatSamples[f * totalChannels + rightIdx]!);
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

    // Adaptive Phase-Locked Loop (PLL) clock drift tracking:
    // Maintains a stable 20ms-30ms lead window between hardware stream and Web Audio timeline
    const TARGET_LEAD_TIME = 0.025;
    if (mic.nextPlayTime === undefined || mic.nextPlayTime < now) {
      mic.nextPlayTime = now + TARGET_LEAD_TIME;
    } else {
      const currentLead = mic.nextPlayTime - now;
      if (currentLead > 0.045) {
        // Hardware stream slightly faster than Web Audio clock: gently trim 1ms lead to prevent latency buildup
        mic.nextPlayTime -= 0.001;
      } else if (currentLead < 0.012) {
        // Hardware stream slightly slower: gently advance by 1ms to prevent starvation underrun
        mic.nextPlayTime += 0.001;
      }
    }
    sourceNode.start(mic.nextPlayTime);
    mic.nextPlayTime += audioBuffer.duration;
  }
}
