import type { AudioMode } from '@jameet/shared';
import { $, setMessage, setText } from '../../core/dom';

export type PendingAction = { type: 'create' } | { type: 'join'; code: string };

export interface StudioPreparationOptions {
  onSetPendingAction: (action: PendingAction) => void;
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
  onShowSessionError: (error: unknown) => void;
}

export async function prepareStudio(
  action: PendingAction,
  options: StudioPreparationOptions
): Promise<void> {
  options.onSetPendingAction(action);
  if (action.type === 'join') {
    const code = action.code;
    options.onSetCurrentCode(code);
    setText('setup-code', code);
  } else {
    options.onSetCurrentCode('');
    setText('setup-code', 'New Studio Session');
  }

  options.onShowSetupView();
  $('setup-waiting-room-group')?.classList.add('hidden');
  setMessage('setup-status', '');
  options.onSetBusy(true);

  // Immediately render default UI state so everything is visible
  options.onSetModeRadios(options.getAudioMode());
  options.onUpdateMusicWarning();
  options.onUpdateCameraButtonState();
  options.onUpdateLocalPreviews();

  try {
    // 1. Quick device enumeration
    await options.onEnumerateAndPopulate().catch((e) => console.warn('enumerateAndPopulate error:', e));

    // 2. Parallel acquisition of microphone, camera, and music inputs for instantaneous loading!
    await Promise.all([
      options.onSyncAllVoiceMics(options.getAudioMode()).catch((e) => console.warn('syncAllVoiceMics error:', e)),
      (!options.isAudioOnly() ? options.onReplaceCamera(options.getCameraId()) : Promise.resolve()).catch((e) => console.warn('replaceCamera error:', e)),
      options.onReplaceMusicInput().catch((e) => console.warn('replaceMusicInput error:', e))
    ]);

    // 3. Re-populate devices now that permissions and streams are live so device labels are complete!
    await options.onEnumerateAndPopulate().catch((e) => console.warn('post-acquisition enumerate error:', e));

    options.onUpdateLocalPreviews();
    setMessage('setup-status', '');
  } catch (error) {
    options.onShowSessionError(error);
  } finally {
    options.onSetBusy(false);
  }
}
