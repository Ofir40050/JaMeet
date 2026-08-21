import type { Preferences } from '../../core/preferences';
import { $ } from '../../core/dom';

export interface LocalPreviewUiOptions {
  getScreenTrack: () => MediaStreamTrack | undefined;
  getVideoTrack: () => MediaStreamTrack | undefined;
  isCameraEnabled: () => boolean;
  getPreferences: () => Preferences;
  onUpdateSessionStage: () => void;
}

export function updateLocalPreviews(options: LocalPreviewUiOptions): void {
  const prefs = options.getPreferences();
  const screenTrack = options.getScreenTrack();
  const videoTrack = options.getVideoTrack();
  const cameraEnabled = options.isCameraEnabled();

  const setupVisible = !$('setup-view')?.classList.contains('hidden');
  const callVisible = !$('call-view')?.classList.contains('hidden');
  const settingsVisible = !$('settings-view')?.classList.contains('hidden');
  const setupVideo = $<HTMLVideoElement>('setup-video');
  const localVideo = $<HTMLVideoElement>('local-video');
  const settingsVideo = $<HTMLVideoElement>('settings-video');
  const isMirrored = prefs.mirrorCamera !== false;
  const visibleTrack = screenTrack ?? (cameraEnabled ? videoTrack : undefined);
  const isLowRes = prefs.cameraQuality === 'low';

  if (setupVisible && setupVideo) {
    const currentTrack = (setupVideo.srcObject as MediaStream)?.getVideoTracks()[0];
    if (currentTrack !== visibleTrack) {
      setupVideo.srcObject = visibleTrack ? new MediaStream([visibleTrack]) : null;
      if (visibleTrack) setupVideo.play().catch(() => {});
    }
    setupVideo.classList.toggle('mirror', isMirrored);
    setupVideo.classList.toggle('res-low', isLowRes);
  }
  if (callVisible && localVideo) {
    const camTrack = cameraEnabled && videoTrack ? videoTrack : undefined;
    const currentTrack = (localVideo.srcObject as MediaStream)?.getVideoTracks()[0];
    if (currentTrack !== camTrack) {
      localVideo.srcObject = camTrack ? new MediaStream([camTrack]) : null;
      if (camTrack) localVideo.play().catch(() => {});
    }
    localVideo.classList.toggle('mirror', isMirrored);
    localVideo.classList.toggle('res-low', isLowRes);
  }
  if (settingsVisible && settingsVideo) {
    const currentTrack = (settingsVideo.srcObject as MediaStream)?.getVideoTracks()[0];
    if (currentTrack !== visibleTrack) {
      settingsVideo.srcObject = visibleTrack ? new MediaStream([visibleTrack]) : null;
      if (visibleTrack) settingsVideo.play().catch(() => {});
    }
    settingsVideo.classList.toggle('mirror', isMirrored);
    settingsVideo.classList.toggle('res-low', isLowRes);
  }

  const badgeEl = $('settings-video-res-badge');
  if (badgeEl) {
    if (!videoTrack || !cameraEnabled) {
      badgeEl.textContent = 'Camera Off';
    } else {
      const q = prefs.cameraQuality;
      if (q === 'low') badgeEl.textContent = '360p · 15 fps (Low)';
      else if (q === 'standard') badgeEl.textContent = '540p · 24 fps (Standard)';
      else if (q === 'high') badgeEl.textContent = '720p · 30 fps (HD)';
      else if (q === 'fhd') badgeEl.textContent = '1080p · 30 fps (Full HD)';
      else if (q === 'qhd') badgeEl.textContent = '1440p · 30 fps (2K Quad HD)';
      else if (q === 'uhd') badgeEl.textContent = '2160p · 30 fps (4K Ultra HD)';
      else badgeEl.textContent = 'Auto (1080p · 30 fps)';
    }
  }

  const isVideoLive = Boolean(videoTrack && cameraEnabled);
  $('setup-video-placeholder')?.classList.toggle('hidden', isVideoLive);
  $('local-placeholder')?.classList.toggle('hidden', isVideoLive);
  $('settings-video-placeholder')?.classList.toggle('hidden', isVideoLive);
  const modeLabel = $('mode-label');
  if (modeLabel) modeLabel.textContent = prefs.mode === 'music' ? 'Music Mode' : 'Talk Mode';

  options.onUpdateSessionStage();
}
