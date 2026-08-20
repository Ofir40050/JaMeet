export function createDownscaledVideoTrack(
  rawTrack: MediaStreamTrack,
  width: number,
  height: number,
  fps: number
): MediaStreamTrack {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const hiddenVideo = document.createElement('video');
  hiddenVideo.muted = true;
  hiddenVideo.playsInline = true;
  hiddenVideo.srcObject = new MediaStream([rawTrack]);
  hiddenVideo.play().catch(() => {});

  let animFrameId: number;
  const render = () => {
    if (rawTrack.readyState === 'ended') return;
    if (ctx && hiddenVideo.readyState >= 2) {
      ctx.drawImage(hiddenVideo, 0, 0, width, height);
    }
    animFrameId = requestAnimationFrame(render);
  };
  render();

  const scaledStream = canvas.captureStream(fps);
  const scaledTrack = scaledStream.getVideoTracks()[0];
  if (!scaledTrack) return rawTrack;

  const originalStop = scaledTrack.stop.bind(scaledTrack);
  scaledTrack.stop = () => {
    cancelAnimationFrame(animFrameId);
    hiddenVideo.srcObject = null;
    rawTrack.stop();
    originalStop();
  };
  return scaledTrack;
}
