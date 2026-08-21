import type { AudioMode } from '@jameet/shared';
import {
  prepareStudio as prepareStudioController,
  type PendingAction
} from './studioPreparation';
import { parseSessionError } from './sessionErrorParser';
import { showSessionErrorModal } from './sessionErrorUi';

export interface StudioPreparationDomainControllerOptions {
  onSetPendingAction: (action: PendingAction | undefined) => void;
  getCurrentCode: () => string;
  onSetCurrentCode: (code: string) => void;
  onShowSetupView: () => void;
  onSetBusy: (busy: boolean) => void;
  getAudioMode: () => AudioMode;
  getCameraId: () => string | undefined;
  isAudioOnly: () => boolean;
  onSetModeRadios: (mode: AudioMode) => void;
  onUpdateMusicWarning: () => void;
  onUpdateCameraButtonState: () => void;
  onUpdateLocalPreviews: () => void;
  onEnumerateAndPopulate: () => Promise<void>;
  onSyncAllVoiceMics: (mode: AudioMode) => Promise<void>;
  onReplaceCamera: (cameraId?: string) => Promise<void>;
  onReplaceMusicInput: () => Promise<void>;
}

export async function prepareStudioDomain(
  action: PendingAction,
  options: StudioPreparationDomainControllerOptions
): Promise<void> {
  await prepareStudioController(action, {
    onSetPendingAction: options.onSetPendingAction,
    getCurrentCode: options.getCurrentCode,
    onSetCurrentCode: options.onSetCurrentCode,
    onShowSetupView: options.onShowSetupView,
    onSetBusy: options.onSetBusy,
    getAudioMode: options.getAudioMode,
    getCameraId: options.getCameraId,
    isAudioOnly: options.isAudioOnly,
    onSetModeRadios: options.onSetModeRadios,
    onUpdateMusicWarning: options.onUpdateMusicWarning,
    onUpdateCameraButtonState: options.onUpdateCameraButtonState,
    onUpdateLocalPreviews: options.onUpdateLocalPreviews,
    onEnumerateAndPopulate: options.onEnumerateAndPopulate,
    onSyncAllVoiceMics: options.onSyncAllVoiceMics,
    onReplaceCamera: options.onReplaceCamera,
    onReplaceMusicInput: options.onReplaceMusicInput,
    onShowSessionError: (error) => showSessionErrorModal(parseSessionError(error))
  });
}
