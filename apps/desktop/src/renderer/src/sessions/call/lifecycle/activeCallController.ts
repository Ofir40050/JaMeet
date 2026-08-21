import { $, setText } from '../../../core/dom';
import { logger } from '../../../core/logger';
import { deviceError } from '../../../media/devices/deviceError';
import { handleRemoteMediaUi } from '../view/remoteMediaUi';
import { effectiveVideoQuality } from '../../../media/video/videoQuality';
import { updateLockUi as updateLockUiHelper } from '../moderation/sessionLockUi';
import { handleSessionProjectWorkspace } from '../workspace/sessionProjectWorkspaceController';
import * as projectsApi from '../../../projects/core/projects';
import { transitionToActiveCallUi } from './activeCallTransitions';
import { enterSession as enterSessionDomain } from '../../setup/sessionEntryController';
import type { AudioMode, MediaMetadata, MeetingAck, ParticipantIdentity, Project, VideoQuality } from '@jameet/shared';
import type { Preferences } from '../../../core/preferences';
import type { PendingAction } from '../../setup/studioPreparation';

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
  onHandleSessionProjectWorkspace: (ack: Extract<MeetingAck, { ok: true }>) => void;
  onTransitionToActiveCallUi: (ack: Extract<MeetingAck, { ok: true }>) => Promise<void>;
}

export async function initializeActiveCallDomain(
  ack: Extract<MeetingAck, { ok: true }>,
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

export interface ActiveCallContext {
  getPreferences: () => Preferences;
  getVideoTrack: () => MediaStreamTrack | undefined;
  onSetVideoTrackOnRtc: (track?: MediaStreamTrack) => void;
  getEffectiveMusicBitrate: () => number;
  onConfigureRtc: (code: string, role: 'host' | 'guest', iceServers: RTCIceServer[], mode: AudioMode, quality: VideoQuality, bitrate: number, peerMedia?: MediaMetadata) => void;
  getCurrentCode: () => string;
  setCurrentCode: (code: string) => void;
  getCurrentRole: () => 'host' | 'guest';
  setCurrentRole: (role: 'host' | 'guest') => void;
  setCurrentIceServers: (servers: RTCIceServer[]) => void;
  setMyIdentity: (identity: ParticipantIdentity | null) => void;
  setHostIdentity: (identity: ParticipantIdentity | null) => void;
  setPeerIdentity: (identity: ParticipantIdentity | null) => void;
  setPeerParticipantId: (id: string | null) => void;
  isInCall: () => boolean;
  setInCall: (inCall: boolean) => void;
  onUpdateCallMode: () => void;
  onUpdateCameraButtonState: () => void;
  onUpdateLocalPreviews: () => void;
  onUpdateParticipantIdentityUi: () => void;
  setRemoteMuted: (muted: boolean) => void;
  onResetStudioMixerChannels: () => void;
  isStudioMixerOpen: () => boolean;
  onRenderStudioMixer: () => void;
  onApplyMixerAudioRouting: () => void;
  getAuthToken: () => string | null;
  getGuestName: () => string | null;
  getParticipantId: () => string;
  getMetadata: () => MediaMetadata;
  getActiveProjectId: () => string | undefined;
  setSessionProjectId: (id?: string) => void;
  onResetWorkspaceGenerations: () => void | number;
  getWorkspaceContextGen: () => number;
  getActiveProject: () => Project | undefined;
  setActiveProject: (p?: Project) => void;
  setActiveProjectId: (id?: string) => void;
  onSyncWorkspaceInputsFromProject: (force?: boolean) => void;
  onJoinProjectWorkspace: (projectId: string, token: string) => Promise<any>;
  onResetChatUi: () => void;
  getIsSessionLocked: () => boolean;
  onSetIsSessionLocked: (locked: boolean) => void;
  onShowView: (view: 'home-view' | 'waiting-view' | 'call-view' | 'project-view') => void;
  onStartSessionTimer: () => void;
  getPendingPeerMedia: () => MediaMetadata | undefined;
  clearPendingPeerMedia: () => void;
  onPeerReady: (media: MediaMetadata) => Promise<void> | void;
  getPendingAction: () => PendingAction | null;
  hasPrimaryAudio: () => boolean;
  isAudioOnly: () => boolean;
  setBusy: (busy: boolean) => void;
  onSignalingCreate: (pId: string, meta: MediaMetadata, token: string | null | undefined, guestName: string | null | undefined, projId?: string, waitingRoom?: boolean) => Promise<MeetingAck>;
  onSignalingJoin: (code: string, pId: string, meta: MediaMetadata, token: string | null | undefined, guestName: string | null | undefined) => Promise<MeetingAck>;
  onSignalingLeave: () => void;
  onOpenAuthView: (tab: 'login' | 'register' | 'signup') => void;
  getRemoteMedia: () => MediaMetadata | undefined;
  setRemoteMedia: (media?: MediaMetadata) => void;
  getRemoteVideoStream: () => MediaStream | undefined;
  setRemoteVideoStream: (stream?: MediaStream) => void;
  onSetOutputDevice: (deviceId?: string) => Promise<void>;
  onSetCallStatus: (status: string) => void;
  onUpdateSessionStage: () => void;
  onSetText: (id: string, text: string) => void;
}

export function createActiveCallController(ctx: ActiveCallContext) {
  function setRemoteStream(stream?: MediaStream): void {
    ctx.setRemoteVideoStream(stream);
    const video = $<HTMLVideoElement>('remote-video');
    const remoteMedia = ctx.getRemoteMedia();
    const shouldRender = Boolean(stream && (!remoteMedia?.audioOnly || remoteMedia.sharingScreen));
    if (video) video.srcObject = shouldRender ? stream! : null;
    $('remote-placeholder')?.classList.toggle('hidden', shouldRender && Boolean(stream?.getVideoTracks().length));
    if (stream) void ctx.onSetOutputDevice(ctx.getPreferences().audioOutputId).catch((error) => ctx.onSetCallStatus(deviceError(error)));
    ctx.onUpdateSessionStage();
  }

  function handleRemoteMedia(media: MediaMetadata): void {
    handleRemoteMediaUi(media, {
      onSetRemoteMedia: (m) => {
        ctx.setRemoteMedia(m);
      },
      getRemoteVideoStream: () => ctx.getRemoteVideoStream(),
      onUpdateSessionStage: () => ctx.onUpdateSessionStage(),
      isInCall: () => ctx.isInCall(),
      onApplyMixerAudioRouting: () => ctx.onApplyMixerAudioRouting(),
      onSetText: (id, text) => ctx.onSetText(id, text)
    });
  }

  function updateLockUi(): void {
    updateLockUiHelper({
      getRole: () => ctx.getCurrentRole(),
      getIsLocked: () => ctx.getIsSessionLocked()
    });
  }

  async function initializeActiveCall(ack: Extract<MeetingAck, { ok: true }>): Promise<void> {
    const prefs = ctx.getPreferences();
    await initializeActiveCallDomain(ack, {
      getVideoTrack: () => ctx.getVideoTrack(),
      onSetVideoTrackOnRtc: (track) => ctx.onSetVideoTrackOnRtc(track),
      getAudioMode: () => prefs.mode,
      getCameraQuality: () => prefs.cameraQuality,
      getEffectiveVideoQuality: (q) => effectiveVideoQuality(q),
      getEffectiveMusicBitrate: () => ctx.getEffectiveMusicBitrate(),
      onConfigureRtc: (code, role, iceServers, mode, quality, bitrate, peerMedia) => {
        ctx.onConfigureRtc(code, role, iceServers, mode, quality, bitrate, peerMedia);
      },
      onSetCurrentCode: (code) => {
        ctx.setCurrentCode(code);
      },
      onSetCurrentRole: (role) => {
        ctx.setCurrentRole(role);
      },
      onSetCurrentIceServers: (servers) => {
        ctx.setCurrentIceServers(servers);
      },
      onSetMyIdentity: (identity) => {
        ctx.setMyIdentity(identity);
      },
      onSetHostIdentity: (identity) => {
        ctx.setHostIdentity(identity);
      },
      onSetPeerIdentity: (identity) => {
        ctx.setPeerIdentity(identity);
      },
      onSetPeerParticipantId: (id) => {
        ctx.setPeerParticipantId(id);
      },
      onSetInCall: (inCallState) => {
        ctx.setInCall(inCallState);
      },
      onUpdateCallMode: () => ctx.onUpdateCallMode(),
      onUpdateCameraButtonState: () => ctx.onUpdateCameraButtonState(),
      onUpdateLocalPreviews: () => ctx.onUpdateLocalPreviews(),
      onUpdateParticipantIdentityUi: () => ctx.onUpdateParticipantIdentityUi(),
      onSetRemoteMuted: (muted) => {
        ctx.setRemoteMuted(muted);
      },
      onResetStudioMixerChannels: () => {
        ctx.onResetStudioMixerChannels();
      },
      isStudioMixerOpen: () => ctx.isStudioMixerOpen(),
      onRenderStudioMixer: () => ctx.onRenderStudioMixer(),
      onApplyMixerAudioRouting: () => ctx.onApplyMixerAudioRouting(),
      onHandleSessionProjectWorkspace: (meetingAck) => {
        handleSessionProjectWorkspace(meetingAck, {
          getAuthToken: () => ctx.getAuthToken(),
          onSetSessionProjectId: (id) => {
            ctx.setSessionProjectId(id);
          },
          onResetWorkspaceGenerations: () => ctx.onResetWorkspaceGenerations(),
          getWorkspaceContextGen: () => ctx.getWorkspaceContextGen(),
          onFetchProject: (token, projectId) => projectsApi.fetchProject(token, projectId),
          getActiveProject: () => ctx.getActiveProject(),
          onSetActiveProject: (p) => {
            ctx.setActiveProject(p);
          },
          onSetActiveProjectId: (id) => {
            ctx.setActiveProjectId(id);
          },
          onSyncWorkspaceInputsFromProject: (force) => ctx.onSyncWorkspaceInputsFromProject(force),
          onJoinProjectWorkspace: (projectId, token) => ctx.onJoinProjectWorkspace(projectId, token)
        });
      },
      onTransitionToActiveCallUi: async (meetingAck) => {
        await transitionToActiveCallUi(meetingAck, {
          onResetChatUi: () => ctx.onResetChatUi(),
          onSetIsSessionLocked: (locked) => ctx.onSetIsSessionLocked(locked),
          onUpdateLockUi: () => updateLockUi(),
          onShowCallView: () => ctx.onShowView('call-view'),
          onStartSessionTimer: () => ctx.onStartSessionTimer(),
          getPendingPeerMedia: () => ctx.getPendingPeerMedia(),
          onClearPendingPeerMedia: () => {
            ctx.clearPendingPeerMedia();
          },
          onPeerReady: async (media) => {
            await ctx.onPeerReady(media);
          }
        });
      }
    });
  }

  async function enterSession(): Promise<void> {
    await enterSessionDomain({
      getPendingAction: () => ctx.getPendingAction() ?? undefined,
      hasPrimaryAudio: () => ctx.hasPrimaryAudio(),
      isAudioOnly: () => ctx.isAudioOnly(),
      hasVideoTrack: () => Boolean(ctx.getVideoTrack()),
      setBusy: (busy) => ctx.setBusy(busy),
      getAuthToken: () => ctx.getAuthToken(),
      getGuestName: () => ctx.getGuestName(),
      getParticipantId: () => ctx.getParticipantId(),
      getMetadata: () => ctx.getMetadata(),
      getActiveProjectId: () => ctx.getActiveProjectId(),
      onSignalingCreate: (pId, meta, token, guestName, projId, waitingRoom) =>
        ctx.onSignalingCreate(pId, meta, token, guestName, projId, waitingRoom),
      onSignalingJoin: (code, pId, meta, token, guestName) =>
        ctx.onSignalingJoin(code, pId, meta, token, guestName),
      onSignalingLeave: () => ctx.onSignalingLeave(),
      onOpenAuthView: (tab) => ctx.onOpenAuthView(tab),
      onSetCurrentCode: (code) => {
        ctx.setCurrentCode(code);
      },
      onSetLoggerSessionContext: (code) => logger.setSessionContext(code),
      onSetHostIdentity: (identity) => {
        ctx.setHostIdentity(identity);
      },
      onSetMyIdentity: (identity) => {
        ctx.setMyIdentity(identity);
      },
      onShowWaitingView: () => ctx.onShowView('waiting-view'),
      onInitializeActiveCall: (ack) => initializeActiveCall(ack)
    });
  }

  return {
    setRemoteStream,
    handleRemoteMedia,
    updateLockUi,
    initializeActiveCall,
    enterSession
  };
}
