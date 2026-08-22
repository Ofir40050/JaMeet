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

  const scaledStream = canvas.captureStream(fps);
  const scaledTrack = scaledStream.getVideoTracks()[0];
  if (!scaledTrack) return rawTrack;

  let animFrameId: number | undefined;
  let cleanedUp = false;

  const originalStop = scaledTrack.stop.bind(scaledTrack);
  const teardown = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (animFrameId !== undefined) {
      cancelAnimationFrame(animFrameId);
      animFrameId = undefined;
    }
    hiddenVideo.srcObject = null;
    rawTrack.removeEventListener('ended', handleRawTrackEnded);
    try { rawTrack.stop(); } catch {}
    try { originalStop(); } catch {}
  };

  const handleRawTrackEnded = () => {
    teardown();
  };

  scaledTrack.stop = teardown;
  rawTrack.addEventListener('ended', handleRawTrackEnded);

  const render = () => {
    if (cleanedUp || rawTrack.readyState === 'ended') {
      teardown();
      return;
    }
    if (ctx && hiddenVideo.readyState >= 2) {
      ctx.drawImage(hiddenVideo, 0, 0, width, height);
    }
    animFrameId = requestAnimationFrame(render);
  };
  render();

  return scaledTrack;
}
