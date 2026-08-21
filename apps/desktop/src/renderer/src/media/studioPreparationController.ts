import { enumerateAndPopulateDevices } from './deviceEnumerationController';
import { prepareStudioDomain } from '../sessions/setup/studioPreparationDomainController';
import { renderAudioLimitations as renderAudioLimitationsUi } from './audioLimitationsUi';
import type { AudioMode, Preferences } from '@jameet/shared';
import type { HardwareAudioDeviceInfo } from './hardwareDeviceUtils';
import type { PendingAction } from '../sessions/setup/studioPreparationController';

export interface StudioPreparationContext {
  getPreferences: () => Preferences;
  onSavePreferences: () => void;
  getCachedHardwareDevices: () => HardwareAudioDeviceInfo[];
  setCachedHardwareDevices: (devices: HardwareAudioDeviceInfo[]) => void;
  onRefreshRunningApps: () => Promise<void>;
  onRenderVoiceInputControls: (audioInputs: MediaDeviceInfo[]) => void;
  onSetMessage: (id: string, text: string, isError?: boolean) => void;
  isInCall: () => boolean;
  isAudioOnly: () => boolean;
  onSetModeRadios: (mode: AudioMode) => void;
  setPendingAction: (act?: PendingAction) => void;
  getCurrentCode: () => string;
  setCurrentCode: (code: string) => void;
  onShowView: (view: 'home-view' | 'setup-view' | 'waiting-view' | 'call-view' | 'project-view') => void;
  setBusy: (busy: boolean) => void;
  onUpdateMusicWarning: () => void;
  onUpdateCameraButtonState: () => void;
  onUpdateLocalPreviews: () => void;
  onSyncAllVoiceMics: (mode?: AudioMode) => Promise<void>;
  onReplaceCamera: (camId?: string) => Promise<void>;
  onReplaceMusicInput: () => Promise<void>;
  getPrimaryAudioSource: () => any;
}

export function createStudioPreparationController(ctx: StudioPreparationContext) {
  async function enumerateAndPopulate(): Promise<void> {
    await enumerateAndPopulateDevices({
      getPreferences: () => ctx.getPreferences(),
      onSavePreferences: () => ctx.onSavePreferences(),
      getCachedHardwareDevices: () => ctx.getCachedHardwareDevices(),
      onSetCachedHardwareDevices: (devices) => {
        ctx.setCachedHardwareDevices(devices);
      },
      onRefreshRunningApps: () => ctx.onRefreshRunningApps(),
      onRenderVoiceInputControls: (audioInputs) => ctx.onRenderVoiceInputControls(audioInputs),
      onSetMessage: (id, text) => ctx.onSetMessage(id, text),
      isInCall: () => ctx.isInCall(),
      isAudioOnly: () => ctx.isAudioOnly(),
      onSetModeRadios: (mode) => ctx.onSetModeRadios(mode)
    });
  }

  async function prepareStudio(action: PendingAction): Promise<void> {
    const prefs = ctx.getPreferences();
    await prepareStudioDomain(action, {
      onSetPendingAction: (act) => {
        ctx.setPendingAction(act);
      },
      getCurrentCode: () => ctx.getCurrentCode(),
      onSetCurrentCode: (code) => {
        ctx.setCurrentCode(code);
      },
      onShowSetupView: () => ctx.onShowView('setup-view'),
      onSetBusy: (busy) => ctx.setBusy(busy),
      getAudioMode: () => prefs.mode,
      getCameraId: () => prefs.cameraId,
      isAudioOnly: () => ctx.isAudioOnly(),
      onSetModeRadios: (mode) => ctx.onSetModeRadios(mode),
      onUpdateMusicWarning: () => ctx.onUpdateMusicWarning(),
      onUpdateCameraButtonState: () => ctx.onUpdateCameraButtonState(),
      onUpdateLocalPreviews: () => ctx.onUpdateLocalPreviews(),
      onEnumerateAndPopulate: () => enumerateAndPopulate(),
      onSyncAllVoiceMics: (mode) => ctx.onSyncAllVoiceMics(mode),
      onReplaceCamera: (camId) => ctx.onReplaceCamera(camId),
      onReplaceMusicInput: () => ctx.onReplaceMusicInput()
    });
  }

  function renderAudioLimitations(): void {
    renderAudioLimitationsUi({
      getPrimaryAudioSource: () => ctx.getPrimaryAudioSource(),
      getPreferences: () => ctx.getPreferences(),
      onSetMessage: (id, text, isError) => ctx.onSetMessage(id, text, isError)
    });
  }

  return {
    enumerateAndPopulate,
    prepareStudio,
    renderAudioLimitations
  };
}
