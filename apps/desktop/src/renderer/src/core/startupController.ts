import type { AudioMode } from '@jameet/shared';

export interface StartupControllerOptions {
  onShowHomeView: () => void;
  onInitAuth: () => Promise<void>;
  onEnumerateAndPopulate: () => Promise<void>;
  isAudioOnly: () => boolean;
  getCameraId: () => string | undefined;
  getAudioMode: () => AudioMode;
  onReplaceCamera: (cameraId?: string) => Promise<void>;
  onSyncAllVoiceMics: (mode: AudioMode) => Promise<void>;
}

export function startRendererApp(options: StartupControllerOptions): void {
  options.onShowHomeView();
  void options.onInitAuth().catch(() => {});
  void options.onEnumerateAndPopulate().then(() => {
    if (!options.isAudioOnly()) {
      void options.onReplaceCamera(options.getCameraId()).catch(() => {});
    }
    void options.onSyncAllVoiceMics(options.getAudioMode()).catch(() => {});
  });
}
