import type { MediaMetadata, MeetingAck } from '@jameet/shared';

export interface ActiveCallUiControllerOptions {
  onResetChatUi: () => void;
  onSetIsSessionLocked: (locked: boolean) => void;
  onUpdateLockUi: () => void;
  onShowCallView: () => void;
  onStartSessionTimer: () => void;
  getPendingPeerMedia: () => MediaMetadata | undefined;
  onClearPendingPeerMedia: () => void;
  onPeerReady: (media: MediaMetadata) => Promise<void>;
}

export async function transitionToActiveCallUi(
  ack: Extract<MeetingAck, { ok: true }>,
  options: ActiveCallUiControllerOptions
): Promise<void> {
  options.onResetChatUi();
  options.onSetIsSessionLocked(Boolean(ack.locked));
  options.onUpdateLockUi();
  options.onShowCallView();
  options.onStartSessionTimer();

  const pendingMedia = options.getPendingPeerMedia();
  if (pendingMedia) {
    await options.onPeerReady(pendingMedia);
    options.onClearPendingPeerMedia();
  } else if (ack.peerPresent && ack.peerMedia) {
    await options.onPeerReady(ack.peerMedia);
  }
}
