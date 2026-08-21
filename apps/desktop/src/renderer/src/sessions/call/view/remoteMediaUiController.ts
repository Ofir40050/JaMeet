import type { MediaMetadata } from '@jameet/shared';

export interface RemoteMediaUiControllerOptions {
  onSetRemoteMedia: (media: MediaMetadata) => void;
  getRemoteVideoStream: () => MediaStream | undefined;
  onUpdateSessionStage: () => void;
  isInCall: () => boolean;
  onApplyMixerAudioRouting: () => void;
  onSetText: (id: string, text: string) => void;
}

export function handleRemoteMediaUi(media: MediaMetadata, options: RemoteMediaUiControllerOptions): void {
  options.onSetRemoteMedia(media);
  const remoteVideoStream = options.getRemoteVideoStream();
  const shouldRender = Boolean(remoteVideoStream && (!media.audioOnly || media.sharingScreen));
  const video = document.getElementById('remote-video') as HTMLVideoElement | null;
  if (video) video.srcObject = shouldRender ? remoteVideoStream! : null;
  document.getElementById('remote-placeholder')?.classList.toggle('hidden', shouldRender);
  const fullShareBtn = document.getElementById('fullscreen-share-button') as HTMLButtonElement | null;
  if (fullShareBtn) fullShareBtn.disabled = !media.sharingScreen;
  options.onSetText('remote-placeholder', media.sharingScreen ? 'Loading shared screen…' : media.audioOnly || !media.cameraEnabled ? 'Musician is in Audio Only' : 'Waiting for Musician');
  options.onUpdateSessionStage();
  if (options.isInCall()) {
    options.onApplyMixerAudioRouting();
  }
}
