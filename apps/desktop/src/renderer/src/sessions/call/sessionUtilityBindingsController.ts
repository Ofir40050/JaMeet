import { $, setText, setMessage } from '../../core/dom';
import { deviceError } from '../../media/deviceError';

export interface SessionUtilityBindingsControllerOptions {
  isRemoteMuted: () => boolean;
  onToggleRemoteMuted: () => void;
  onApplyMixerAudioRouting: () => void;
  onFullscreenRemote: (isScreen: boolean) => Promise<void>;
  onStopScreenShare: () => Promise<void>;
  onTestSpeakers: (pan: 'both' | 'left' | 'right') => Promise<void>;
}

export function initSessionUtilityBindingsController(
  options: SessionUtilityBindingsControllerOptions
): void {
  $('remote-mute-button')?.addEventListener('click', () => {
    options.onToggleRemoteMuted();
    const muted = options.isRemoteMuted();
    setText('remote-mute-button', muted ? 'Unmute Remote' : 'Mute Remote');
    options.onApplyMixerAudioRouting();
  });

  $('fullscreen-video-button')?.addEventListener('click', () => {
    void options.onFullscreenRemote(false);
  });

  $('fullscreen-share-button')?.addEventListener('click', () => {
    void options.onFullscreenRemote(true);
  });

  $('tab-btn-apps')?.addEventListener('click', () => {
    $('tab-btn-apps')?.classList.add('active');
    $('tab-btn-screens')?.classList.remove('active');
    $('section-apps')?.classList.remove('hidden');
    $('section-screens')?.classList.add('hidden');
  });

  $('tab-btn-screens')?.addEventListener('click', () => {
    $('tab-btn-screens')?.classList.add('active');
    $('tab-btn-apps')?.classList.remove('active');
    $('section-screens')?.classList.remove('hidden');
    $('section-apps')?.classList.add('hidden');
  });

  $('btn-stop-share-floating')?.addEventListener('click', () => {
    void options.onStopScreenShare();
  });

  $('stage-stop-share-btn')?.addEventListener('click', () => {
    void options.onStopScreenShare();
  });

  for (const id of ['open-system-audio', 'call-open-system-audio']) {
    $(id)?.addEventListener('click', () => {
      const desktopApi = typeof window !== 'undefined' ? (window as any).jameet || (window as any).musiczoom : undefined;
      void desktopApi?.openSystemAudioSettings?.();
    });
  }

  $('test-output-both')?.addEventListener('click', () => {
    void options
      .onTestSpeakers('both')
      .then(() => setMessage('device-dialog-status', 'Stereo test complete.'))
      .catch((e) => setMessage('device-dialog-status', deviceError(e), true));
  });

  $('test-output-left')?.addEventListener('click', () => {
    void options
      .onTestSpeakers('left')
      .then(() => setMessage('device-dialog-status', 'Left channel test complete.'))
      .catch((e) => setMessage('device-dialog-status', deviceError(e), true));
  });

  $('test-output-right')?.addEventListener('click', () => {
    void options
      .onTestSpeakers('right')
      .then(() => setMessage('device-dialog-status', 'Right channel test complete.'))
      .catch((e) => setMessage('device-dialog-status', deviceError(e), true));
  });
}
