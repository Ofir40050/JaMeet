import type { VoiceMicChannel } from './types';

const RING_CAPACITY = 4096; // ~85ms continuous ring history

interface ClockRecoveryState {
  filteredError: number;
  integralError: number;
  resampleRatio: number;
  ringL: Float32Array;
  ringR: Float32Array;
  ringM: Float32Array;
  writePos: number;
  readPos: number;
  initialized: boolean;
}

const clockRecoveryMap = new WeakMap<VoiceMicChannel, ClockRecoveryState>();

function getClockRecoveryState(mic: VoiceMicChannel): ClockRecoveryState {
  let state = clockRecoveryMap.get(mic);
  if (!state) {
    state = {
      filteredError: 0,
      integralError: 0,
      resampleRatio: 1.0,
      ringL: new Float32Array(RING_CAPACITY),
      ringR: new Float32Array(RING_CAPACITY),
      ringM: new Float32Array(RING_CAPACITY),
      writePos: 0,
      readPos: 0,
      initialized: false
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

    const clockState = getClockRecoveryState(mic);

    // 1. Determine channel routing indices
    let leftIdx = 0;
    let rightIdx = 1;
    let chIdx = 0;

    if (isStereo || route === '1-2' || route === '3-4' || route === '5-6' || route === '7-8') {
      if (route === '3-4') { leftIdx = 2; rightIdx = 3; }
      else if (route === '5-6') { leftIdx = 4; rightIdx = 5; }
      else if (route === '7-8') { leftIdx = 6; rightIdx = 7; }
      leftIdx = Math.min(leftIdx, totalChannels - 1);
      rightIdx = Math.min(rightIdx, totalChannels - 1);
    } else {
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
    }

    // 2. Write incoming samples into continuous elastic history ring
    let wp = clockState.writePos;
    if (isStereo) {
      for (let f = 0; f < frameCount; f++) {
        clockState.ringL[wp] = floatSamples[f * totalChannels + leftIdx]!;
        clockState.ringR[wp] = floatSamples[f * totalChannels + rightIdx]!;
        wp = (wp + 1) % RING_CAPACITY;
      }
    } else if (route === '1-2' || route === '3-4' || route === '5-6' || route === '7-8') {
      for (let f = 0; f < frameCount; f++) {
        clockState.ringM[wp] = 0.5 * (floatSamples[f * totalChannels + leftIdx]! + floatSamples[f * totalChannels + rightIdx]!);
        wp = (wp + 1) % RING_CAPACITY;
      }
    } else {
      for (let f = 0; f < frameCount; f++) {
        clockState.ringM[wp] = floatSamples[f * totalChannels + chIdx]!;
        wp = (wp + 1) % RING_CAPACITY;
      }
    }
    clockState.writePos = wp;

    // 3. Continuous Proportional-Integral (PI) Clock Error Tracking
    if (mic.nextPlayTime === undefined || mic.nextPlayTime < now || !clockState.initialized) {
      mic.nextPlayTime = now + TARGET_LEAD_TIME;
      clockState.filteredError = 0;
      clockState.integralError = 0;
      clockState.resampleRatio = 1.0;
      clockState.readPos = (wp - frameCount + RING_CAPACITY) % RING_CAPACITY;
      clockState.initialized = true;
    } else {
      const currentLead = mic.nextPlayTime - now;
      const timingError = currentLead - TARGET_LEAD_TIME;

      clockState.filteredError = 0.98 * clockState.filteredError + 0.02 * timingError;
      clockState.integralError = Math.max(-0.05, Math.min(0.05, clockState.integralError + clockState.filteredError * 0.0005));

      const correction = (clockState.filteredError * 0.15) + (clockState.integralError * 0.04);
      clockState.resampleRatio = Math.max(0.9985, Math.min(1.0015, 1.0 - correction));
    }

    // 4. Fractional Interpolation Output Generation (Fixed 480 frames, steady 10ms Opus quantum)
    const audioBuffer = ctx.createBuffer(outChannels, frameCount, 48000);
    const step = clockState.resampleRatio;
    let rp = clockState.readPos;

    if (isStereo) {
      const leftData = audioBuffer.getChannelData(0);
      const rightData = audioBuffer.getChannelData(1);

      for (let o = 0; o < frameCount; o++) {
        const i0 = Math.floor(rp) % RING_CAPACITY;
        const frac = rp - Math.floor(rp);
        const i1 = (i0 + 1) % RING_CAPACITY;

        leftData[o] = clockState.ringL[i0]! * (1 - frac) + clockState.ringL[i1]! * frac;
        rightData[o] = clockState.ringR[i0]! * (1 - frac) + clockState.ringR[i1]! * frac;
        rp = (rp + step) % RING_CAPACITY;
      }
    } else {
      const monoData = audioBuffer.getChannelData(0);
      for (let o = 0; o < frameCount; o++) {
        const i0 = Math.floor(rp) % RING_CAPACITY;
        const frac = rp - Math.floor(rp);
        const i1 = (i0 + 1) % RING_CAPACITY;

        monoData[o] = clockState.ringM[i0]! * (1 - frac) + clockState.ringM[i1]! * frac;
        rp = (rp + step) % RING_CAPACITY;
      }
    }
    clockState.readPos = rp;

    const sourceNode = ctx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(mic.gainNode);

    sourceNode.start(mic.nextPlayTime);
    mic.nextPlayTime += audioBuffer.duration;
  }
}
