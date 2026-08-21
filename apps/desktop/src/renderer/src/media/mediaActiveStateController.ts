export interface MediaActiveStateContext {
  isMuted: () => boolean;
  hasActiveAudioSources: () => boolean;
  isCameraEnabled: () => boolean;
  getVideoTrack: () => MediaStreamTrack | undefined;
  getScreenTrack: () => MediaStreamTrack | undefined;
}

export function createMediaActiveStateController(ctx: MediaActiveStateContext, intervalMs = 500) {
  function syncMediaActiveState(): void {
    const isMicLive = !ctx.isMuted() && ctx.hasActiveAudioSources();
    const videoTrack = ctx.getVideoTrack();
    const isCamLive = Boolean(ctx.isCameraEnabled() && videoTrack && videoTrack.readyState === 'live');
    const screenTrack = ctx.getScreenTrack();
    const isScreenLive = Boolean(screenTrack && screenTrack.readyState === 'live');
    const isAnyLive = Boolean(isCamLive || isScreenLive || isMicLive);
    const desktopApi = (window as any).jameet || (window as any).musiczoom;
    if (desktopApi?.setMediaActive) {
      desktopApi.setMediaActive(isAnyLive);
    }
  }

  const intervalId = window.setInterval(syncMediaActiveState, intervalMs);

  function stopPolling(): void {
    window.clearInterval(intervalId);
  }

  return {
    syncMediaActiveState,
    stopPolling
  };
}
