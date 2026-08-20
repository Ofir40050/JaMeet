import { getDesktopApi } from './desktopApi';

export function attachAppAudioLoopback(
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
