import type { MediaMetadata, ParticipantIdentity } from '@jameet/shared';
import { setSessionViewStateProvider } from './sessionView';

export interface SessionViewStateControllerOptions {
  getScreenTrack: () => MediaStreamTrack | undefined;
  getRemoteMedia: () => MediaMetadata | undefined;
  getRemoteVideoStream: () => MediaStream | undefined;
  getPeerIdentity: () => ParticipantIdentity | null;
  getMyIdentity: () => ParticipantIdentity | null;
  getSharingSourceTitle: () => string | undefined;
}

export function initSessionViewStateController(options: SessionViewStateControllerOptions): void {
  setSessionViewStateProvider(() => ({
    screenTrack: options.getScreenTrack(),
    remoteMedia: options.getRemoteMedia(),
    remoteVideoStream: options.getRemoteVideoStream(),
    peerIdentity: options.getPeerIdentity(),
    myIdentity: options.getMyIdentity(),
    sharingSourceTitle: options.getSharingSourceTitle()
  }));
}
