import { $, setText } from '../../../core/dom';
import type { SignalingClient } from '../../../media/remote/signaling';
import type { MediaMetadata, ParticipantIdentity } from '@jameet/shared';
import type { WebRtcSession } from '../../../media/remote/webrtc';
import type { LocalAudioSourceManager } from '../../../media/audio/audioSources';
import type { LevelMeter } from '../../../media/audio/levelMeter';
import type { AuthManager } from '../../../auth/auth';

export interface CallSignalingListenersContext {
  signaling: SignalingClient;
  rtc: WebRtcSession;
  audio: LocalAudioSourceManager;
  auth: AuthManager;
  isInCall: () => boolean;
  setIsInCall: (inCall: boolean) => void;
  setCurrentCode: (code: string) => void;
  clearPendingAction: () => void;
  getVoiceMeters: () => Map<number, LevelMeter>;
  getActiveMicLevels: () => Map<number, number>;
  getActiveMicPeaks: () => Map<number, number>;
  getVideoTrack: () => MediaStreamTrack | undefined;
  setVideoTrack: (track: MediaStreamTrack | undefined) => void;
  getMusicMeter: () => LevelMeter;
  onResetMusicLevels: () => void;
  getActiveProjectId: () => string | undefined;
  getSessionProjectId: () => string | undefined;
  onOpenProjectView: (projectId: string) => void;
  onShowHomeView: () => void;
  onSetCallStatus: (status: string) => void;
  onSetPeerParticipantId: (id: string | null) => void;
  onSetPeerIdentity: (identity: ParticipantIdentity | null) => void;
  onUpdateParticipantIdentityUi: () => void;
  onSetPendingPeerMedia: (media: MediaMetadata) => void;
  onSetRemoteVoiceIsStereo: (isStereo: boolean) => void;
  getRemoteAudioTracks: () => Map<string, { purpose: 'voice' | 'music'; track: MediaStreamTrack }>;
  getRemoteMusicSourceNodes: () => Map<string, { track: MediaStreamTrack; sourceNode: MediaStreamAudioSourceNode }>;
  onRefreshRemoteAudio: () => Promise<void>;
  onLeaveSession: (message?: string) => Promise<void>;
}

export function initCallSignalingListenersController(ctx: CallSignalingListenersContext): void {
  ctx.signaling.on('peer:ready', (payload: { media: MediaMetadata; identity?: ParticipantIdentity; participantId?: string }) => {
    ctx.onSetCallStatus('Connecting…');
    if (payload.participantId) {
      ctx.onSetPeerParticipantId(payload.participantId);
    }
    if (payload.identity) {
      ctx.onSetPeerIdentity(payload.identity);
    }
    ctx.onUpdateParticipantIdentityUi();
    if (!ctx.isInCall()) ctx.onSetPendingPeerMedia(payload.media);
    else void ctx.rtc.peerReady(payload.media);
  });

  ctx.signaling.on('peer:disconnected', () => ctx.onSetCallStatus('Musician reconnecting…'));

  ctx.signaling.on('peer:left', () => {
    ctx.onSetRemoteVoiceIsStereo(false);
    ctx.rtc.resetPeer();
    const remoteAudioTracks = ctx.getRemoteAudioTracks();
    for (const [, item] of remoteAudioTracks) {
      item.track.onended = null;
      try { item.track.stop(); } catch {}
    }
    remoteAudioTracks.clear();

    const remoteMusicSourceNodes = ctx.getRemoteMusicSourceNodes();
    for (const [, entry] of remoteMusicSourceNodes) {
      try { entry.sourceNode.disconnect(); } catch {}
    }
    remoteMusicSourceNodes.clear();

    void ctx.onRefreshRemoteAudio();
    ctx.onSetPeerIdentity(null);
    ctx.onSetPeerParticipantId(null);
    ctx.onUpdateParticipantIdentityUi();
    ctx.onSetCallStatus('Waiting for Musician…');
    setText('remote-placeholder', 'Waiting for Musician');
  });

  ctx.signaling.on('meeting:ended', () => void ctx.onLeaveSession('The session creator ended the session.'));

  ctx.signaling.on('meeting:removed', (payload: { code: string; message?: string }) => {
    void ctx.onLeaveSession(payload.message || 'You have been removed from the session by the host.');
  });

  $('btn-leave-waiting')?.addEventListener('click', async () => {
    ctx.signaling.leave();
    ctx.setIsInCall(false);
    ctx.setCurrentCode('');
    ctx.clearPendingAction();

    const voiceMeters = ctx.getVoiceMeters();
    for (const m of voiceMeters.values()) await m.stop();
    voiceMeters.clear();
    ctx.getActiveMicLevels().clear();
    ctx.getActiveMicPeaks().clear();
    ctx.audio.dispose();

    const videoTrack = ctx.getVideoTrack();
    videoTrack?.stop();
    ctx.setVideoTrack(undefined);

    await ctx.getMusicMeter().stop();
    ctx.onResetMusicLevels();

    const returnProjectId = ctx.getActiveProjectId() || ctx.getSessionProjectId();
    if (returnProjectId && ctx.auth.getUser() && ctx.auth.getToken()) {
      void ctx.onOpenProjectView(returnProjectId);
    } else {
      ctx.onShowHomeView();
    }
  });
}
