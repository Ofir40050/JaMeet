import type { VoiceMicChannel } from './types';

interface ClockRecoveryState {
  filteredError: number;
  integralError: number;
  resampleRatio: number;
  phase: number;
}

const clockRecoveryMap = new WeakMap<VoiceMicChannel, ClockRecoveryState>();

function getClockRecoveryState(mic: VoiceMicChannel): ClockRecoveryState {
  let state = clockRecoveryMap.get(mic);
  if (!state) {
    state = {
      filteredError: 0,
      integralError: 0,
      resampleRatio: 1.0,
      phase: 0
    };
    clockRecoveryMap.set(mic, state);
  }
  return state;
}

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
  const TARGET_LEAD_TIME = 0.025; // 25ms optimal jitter window

  for (const [, mic] of voiceMics.entries()) {
    const route = mic.preferences.channelRoute || '1';
    const isStereo = mic.preferences.stereo !== false && (route === '1-2' || route === '3-4' || route === '5-6' || route === '7-8');
    const outChannels = isStereo ? 2 : 1;

    // 1. Continuous Fractional PLL Clock Recovery
    const clockState = getClockRecoveryState(mic);
    if (mic.nextPlayTime === undefined || mic.nextPlayTime < now) {
      // Re-anchor upon initial startup or hard starvation
      mic.nextPlayTime = now + TARGET_LEAD_TIME;
      clockState.filteredError = 0;
      clockState.integralError = 0;
      clockState.resampleRatio = 1.0;
      clockState.phase = 0;
    } else {
      const currentLead = mic.nextPlayTime - now;
      const timingError = currentLead - TARGET_LEAD_TIME;
      // Proportional-Integral low-pass filtering
      clockState.filteredError = 0.95 * clockState.filteredError + 0.05 * timingError;
      clockState.integralError = Math.max(-0.05, Math.min(0.05, clockState.integralError + clockState.filteredError * 0.001));

      // Calculate micro-resampling ratio (clamped within ±0.15% to guarantee pitch transparency)
      const correction = (clockState.filteredError * 0.15) + (clockState.integralError * 0.05);
      clockState.resampleRatio = Math.max(0.9985, Math.min(1.0015, 1.0 - correction));
    }

    // 2. Fixed-Size Output Buffer (Guarantees steady 10ms Opus chunks without fragmentation)
    const audioBuffer = ctx.createBuffer(outChannels, frameCount, 48000);
    const step = clockState.resampleRatio;
    let currPhase = clockState.phase;

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

      for (let o = 0; o < frameCount; o++) {
        const srcPos = Math.max(0, Math.min(currPhase, frameCount - 1));
        const i0 = Math.floor(srcPos);
        const frac = srcPos - i0;
        const i1 = Math.min(i0 + 1, frameCount - 1);

        const l0 = floatSamples[i0 * totalChannels + leftIdx]!;
        const l1 = floatSamples[i1 * totalChannels + leftIdx]!;
        const r0 = floatSamples[i0 * totalChannels + rightIdx]!;
        const r1 = floatSamples[i1 * totalChannels + rightIdx]!;

        leftData[o] = l0 * (1 - frac) + l1 * frac;
        rightData[o] = r0 * (1 - frac) + r1 * frac;
        currPhase += step;
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
      for (let o = 0; o < frameCount; o++) {
        const srcPos = Math.max(0, Math.min(currPhase, frameCount - 1));
        const i0 = Math.floor(srcPos);
        const frac = srcPos - i0;
        const i1 = Math.min(i0 + 1, frameCount - 1);

        const m0 = 0.5 * (floatSamples[i0 * totalChannels + leftIdx]! + floatSamples[i0 * totalChannels + rightIdx]!);
        const m1 = 0.5 * (floatSamples[i1 * totalChannels + leftIdx]! + floatSamples[i1 * totalChannels + rightIdx]!);

        monoData[o] = m0 * (1 - frac) + m1 * frac;
        currPhase += step;
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
      for (let o = 0; o < frameCount; o++) {
        const srcPos = Math.max(0, Math.min(currPhase, frameCount - 1));
        const i0 = Math.floor(srcPos);
        const frac = srcPos - i0;
        const i1 = Math.min(i0 + 1, frameCount - 1);

        const s0 = floatSamples[i0 * totalChannels + chIdx]!;
        const s1 = floatSamples[i1 * totalChannels + chIdx]!;

        monoData[o] = s0 * (1 - frac) + s1 * frac;
        currPhase += step;
      }
    }

    // Keep fractional phase offset bounded within [-1, 1] frame
    clockState.phase = currPhase - frameCount;
    if (clockState.phase < -1.0) clockState.phase = -1.0;
    if (clockState.phase > 1.0) clockState.phase = 1.0;

    const sourceNode = ctx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(mic.gainNode);

    sourceNode.start(mic.nextPlayTime);
    mic.nextPlayTime += audioBuffer.duration;
  }
}
