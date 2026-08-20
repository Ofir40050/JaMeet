import type { AudioMode } from '@jameet/shared';
import { $ } from '../../core/dom';

export interface InCallAudioModalControllerOptions {
  getAudioMode: () => AudioMode;
  setModeRadios: (mode: AudioMode) => void;
  onEnumerateAndPopulate: () => Promise<void> | void;
  onUpdateMusicWarning: () => void;
  onOpenSettings: (section: string) => void;
  isInCall: () => boolean;
  isCallViewVisible: () => boolean;
}

export function initInCallAudioModalController(
  options: InCallAudioModalControllerOptions
): {
  openInCallAudioModal: () => void;
  closeInCallAudioModal: () => void;
} {
  function openInCallAudioModal(): void {
    options.setModeRadios(options.getAudioMode());
    void options.onEnumerateAndPopulate();
    options.onUpdateMusicWarning();
    $('in-call-audio-modal')?.classList.remove('hidden');
  }

  function closeInCallAudioModal(): void {
    $('in-call-audio-modal')?.classList.add('hidden');
  }

  $('btn-close-in-call-audio')?.addEventListener('click', closeInCallAudioModal);
  $('btn-done-in-call-audio')?.addEventListener('click', closeInCallAudioModal);
  $('in-call-audio-modal')?.addEventListener('click', (e) => {
    if (e.target === $('in-call-audio-modal')) closeInCallAudioModal();
  });
  $('in-call-advanced-settings-btn')?.addEventListener('click', () => {
    closeInCallAudioModal();
    options.onOpenSettings('audio');
  });

  for (const id of ['open-settings', 'devices-button']) {
    $(id)?.addEventListener('click', () => {
      void options.onEnumerateAndPopulate();
      if (options.isInCall() || options.isCallViewVisible()) {
        openInCallAudioModal();
      } else {
        options.onOpenSettings('audio');
      }
    });
  }

  return { openInCallAudioModal, closeInCallAudioModal };
}
