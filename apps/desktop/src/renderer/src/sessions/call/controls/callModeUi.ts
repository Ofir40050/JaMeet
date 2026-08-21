import type { AudioMode } from '@jameet/shared';
import { $ } from '../../../core/dom';

export interface CallModeUiControllerOptions {
  onSwitchAudioMode: (mode: AudioMode) => Promise<void> | void;
  onUpdateHeadphoneWarning: () => void;
  onUpdateLocalPreviews: () => void;
}

let modeOptions: CallModeUiControllerOptions | null = null;

export function initCallModeUi(options: CallModeUiControllerOptions): void {
  modeOptions = options;

  for (const card of document.querySelectorAll<HTMLElement>('.mode-card')) {
    card.addEventListener('click', () => {
      const radio = card.querySelector<HTMLInputElement>('input[type="radio"]');
      if (radio && radio.value) {
        void options.onSwitchAudioMode(radio.value as AudioMode);
      }
    });
  }

  for (const radio of document.querySelectorAll<HTMLInputElement>(
    'input[name="setup-mode"], input[name="call-setup-mode"]'
  )) {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        void options.onSwitchAudioMode(radio.value as AudioMode);
      }
    });
  }
}

export function setModeRadios(mode: AudioMode): void {
  for (const radio of document.querySelectorAll<HTMLInputElement>(
    'input[name="setup-mode"], input[name="call-setup-mode"]'
  )) {
    const isCur = radio.value === mode;
    radio.checked = isCur;
    const card = radio.closest<HTMLElement>('.mode-card');
    card?.classList.toggle('active', isCur);
  }
}

export function updateMusicWarning(): void {
  if (modeOptions) {
    modeOptions.onUpdateHeadphoneWarning();
  }
}

export function updateCallMode(mode: AudioMode = 'music'): void {
  const music = mode === 'music';
  const label = $('mode-label');
  if (label) label.textContent = music ? 'Music Mode' : 'Talk Mode';
  const modeBtn = $('mode-button');
  if (modeBtn) modeBtn.textContent = music ? 'Talk Mode' : 'Music Mode';

  $('mode-music-btn')?.classList.toggle('active', music);
  $('mode-talk-btn')?.classList.toggle('active', !music);

  if (modeOptions) {
    modeOptions.onUpdateHeadphoneWarning();
    modeOptions.onUpdateLocalPreviews();
  }
}
