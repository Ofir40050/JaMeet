import { $, setText } from '../../core/dom';

export type SettingsSection = 'general' | 'audio' | 'video' | 'screenshare' | 'account';

export interface SettingsUiOptions {
  onSectionChange?: (section: SettingsSection) => void;
  onCloseSettings?: () => void;
}

export function switchSettingsSection(section: SettingsSection): void {
  const sections: readonly SettingsSection[] = ['general', 'audio', 'video', 'screenshare', 'account'];
  for (const s of sections) {
    const isCur = s === section;
    const navItem = document.querySelector(`.settings-nav-item[data-settings-tab="${s}"]`);
    navItem?.classList.toggle('active', isCur);
    document.getElementById(`settings-panel-${s}`)?.classList.toggle('hidden', !isCur);
  }
  const crumbText =
    section === 'account'
      ? 'Account Profile'
      : section === 'audio'
        ? 'Audio & Hardware'
        : section === 'video'
          ? 'Video & Camera'
          : section === 'screenshare'
            ? 'Screen Sharing'
            : 'General Preferences';
  setText('settings-view-crumb', crumbText);
}

let listenersBound = false;
let settingsOptions: SettingsUiOptions = {};

export function initSettingsUi(options: SettingsUiOptions | ((section: SettingsSection) => void) = {}): void {
  if (typeof options === 'function') {
    settingsOptions = { onSectionChange: options };
  } else {
    settingsOptions = options;
  }
  if (listenersBound) return;
  listenersBound = true;

  document.querySelectorAll<HTMLButtonElement>('.settings-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.settingsTab as SettingsSection | undefined;
      if (tab) {
        switchSettingsSection(tab);
        settingsOptions.onSectionChange?.(tab);
      }
    });
  });

  const handleClose = () => {
    settingsOptions.onCloseSettings?.();
  };

  $('btn-settings-back')?.addEventListener('click', handleClose);
  $('btn-settings-done')?.addEventListener('click', handleClose);
}

