import type { AudioMode } from '@jameet/shared';
import { $, setMessage } from '../../core/dom';
import { deviceError } from '../../media/devices/deviceError';

export interface CallToolbarControllerOptions {
  onToggleMute: () => void;
  onToggleCamera: () => Promise<void>;
  onShowScreenPicker: () => Promise<void>;
  hasScreenTrack: () => boolean;
  getAudioMode: () => AudioMode;
  onSwitchAudioMode: (mode: AudioMode) => Promise<void> | void;
  isAudioOnly: () => boolean;
  onSetAudioOnly: (audioOnly: boolean) => Promise<void>;
  onSetCallStatus: (status: string) => void;
}

export function initCallToolbarController(options: CallToolbarControllerOptions): void {
  for (const id of ['toggle-mic', 'mute-button']) {
    $(id)?.addEventListener('click', () => options.onToggleMute());
  }

  for (const id of ['toggle-camera', 'camera-button']) {
    $(id)?.addEventListener('click', () => {
      void options.onToggleCamera().catch((error) => options.onSetCallStatus(deviceError(error)));
    });
  }

  for (const id of ['toggle-screen', 'screen-button']) {
    $(id)?.addEventListener('click', () => {
      void options
        .onShowScreenPicker()
        .then(() => {
          $('toggle-screen')?.classList.toggle('active', options.hasScreenTrack());
        })
        .catch((error) => options.onSetCallStatus(deviceError(error)));
    });
  }

  $('mode-music-btn')?.addEventListener('click', () => void options.onSwitchAudioMode('music'));
  $('mode-talk-btn')?.addEventListener('click', () => void options.onSwitchAudioMode('talk'));
  $('mode-button')?.addEventListener('click', () => {
    const next: AudioMode = options.getAudioMode() === 'music' ? 'talk' : 'music';
    void options.onSwitchAudioMode(next);
  });

  $('audio-only-button')?.addEventListener('click', () => {
    void options
      .onSetAudioOnly(!options.isAudioOnly())
      .catch((error) => options.onSetCallStatus(deviceError(error)));
  });

  $<HTMLInputElement>('audio-only-setup')?.addEventListener('change', (event) => {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    void options
      .onSetAudioOnly(checked)
      .catch((error) => setMessage('setup-status', deviceError(error), true));
  });
}
