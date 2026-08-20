import type { AudioMode, MediaMetadata, MeetingAck, ParticipantIdentity, VideoQuality } from '@jameet/shared';
import { setText } from '../../core/dom';

export interface ActiveCallControllerOptions {
  getVideoTrack: () => MediaStreamTrack | undefined;
  onSetVideoTrackOnRtc: (track: MediaStreamTrack | undefined) => void;
  getAudioMode: () => AudioMode;
  getCameraQuality: () => VideoQuality;
  getEffectiveVideoQuality: (quality: VideoQuality) => VideoQuality;
  getEffectiveMusicBitrate: () => number;
  onConfigureRtc: (
    code: string,
    role: 'host' | 'guest',
    iceServers: RTCIceServer[],
    mode: AudioMode,
    quality: VideoQuality,
    bitrate: number,
    peerMedia?: MediaMetadata
  ) => void;
  onSetCurrentCode: (code: string) => void;
  onSetCurrentRole: (role: 'host' | 'guest') => void;
  onSetCurrentIceServers: (servers: RTCIceServer[]) => void;
  onSetMyIdentity: (identity: ParticipantIdentity | null) => void;
  onSetHostIdentity: (identity: ParticipantIdentity | null) => void;
  onSetPeerIdentity: (identity: ParticipantIdentity | null) => void;
  onSetPeerParticipantId: (id: string | null) => void;
  onSetInCall: (inCall: boolean) => void;
  onUpdateCallMode: () => void;
  onUpdateCameraButtonState: () => void;
  onUpdateLocalPreviews: () => void;
  onUpdateParticipantIdentityUi: () => void;
  onSetRemoteMuted: (muted: boolean) => void;
  onResetStudioMixerChannels: () => void;
  isStudioMixerOpen: () => boolean;
  onRenderStudioMixer: () => void;
  onApplyMixerAudioRouting: () => void;
  onHandleSessionProjectWorkspace: (ack: MeetingAck) => void;
  onTransitionToActiveCallUi: (ack: MeetingAck) => Promise<void>;
}

export async function initializeActiveCall(
  ack: MeetingAck,
  options: ActiveCallControllerOptions
): Promise<void> {
  options.onSetCurrentCode(ack.code);
  options.onSetCurrentRole(ack.role);
  options.onSetCurrentIceServers(ack.iceServers);
  options.onSetMyIdentity(ack.identity);
  options.onSetHostIdentity(ack.hostIdentity);
  options.onSetPeerIdentity(ack.peerIdentity ?? null);
  options.onSetPeerParticipantId(ack.peerParticipantId ?? null);
  options.onSetInCall(true);

  options.onSetVideoTrackOnRtc(options.getVideoTrack());
  options.onConfigureRtc(
    ack.code,
    ack.role,
    ack.iceServers,
    options.getAudioMode(),
    options.getEffectiveVideoQuality(options.getCameraQuality()),
    options.getEffectiveMusicBitrate(),
    ack.peerMedia
  );

  setText('call-code', ack.code);
  options.onUpdateCallMode();
  options.onUpdateCameraButtonState();
  options.onUpdateLocalPreviews();
  options.onUpdateParticipantIdentityUi();

  // Reset Remote Mute state for fresh session
  options.onSetRemoteMuted(false);
  setText('remote-mute-button', 'Mute Remote');

  // Reset Studio Mixer Mute & Solo for fresh session
  options.onResetStudioMixerChannels();
  if (options.isStudioMixerOpen()) {
    options.onRenderStudioMixer();
  }
  options.onApplyMixerAudioRouting();

  // In-Session Workspace Integration
  options.onHandleSessionProjectWorkspace(ack);

  // Transition UI
  await options.onTransitionToActiveCallUi(ack);
}
