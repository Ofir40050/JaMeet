import { $, setText, setMessage } from '../../../core/dom';
import { logger } from '../../../core/logger';
import { presenter } from '../../../media/video/presenter';
import { closeSessionViewMenu } from '../view/sessionView';
import { hideWaitingBanner } from '../waiting/waitingRoomUi';
import { setSessionWorkspaceOpen } from '../workspace/workspaceDrawerUi';
import { resetChatUi } from '../chat/chat';
import type { LevelMeter } from '../../../media/audio/meter/levelMeter';
import type { LocalAudioSourceManager } from '../../../media/audio/sources/audioSources';
import type { StudioMixerChannel } from '../../../media/mixer/studioMixerLogic';
import type { MediaMetadata, ParticipantIdentity, Project, UserProfile } from '@jameet/shared';

export interface CallTerminationContext {
  onStopSessionTimer: () => void;
  getCurrentCode: () => string;
  setCurrentCode: (code: string) => void;
  isInCall: () => boolean;
  setInCall: (inCall: boolean) => void;
  onSignalingLeave: () => void;
  onRtcDispose: () => void;
  getVoiceMeters: () => Map<number, LevelMeter>;
  getActiveMicLevels: () => Map<number, number>;
  getActiveMicPeaks: () => Map<number, number>;
  getAudio: () => LocalAudioSourceManager;
  getScreenTrack: () => MediaStreamTrack | undefined;
  setScreenTrack: (track?: MediaStreamTrack) => void;
  getVideoTrack: () => MediaStreamTrack | undefined;
  setVideoTrack: (track?: MediaStreamTrack) => void;
  getMusicMeter: () => LevelMeter;
  onCleanupRemoteAudioGraph: () => Promise<void>;
  onSetLastLocalVoiceDb: (db: number) => void;
  onSetLastRemoteVoiceDb: (db: number) => void;
  onSetLastLocalMusicDb: (db: number) => void;
  onSetLastLocalMusicPeakDb: (db: number) => void;
  onCheckActiveSpeaker: () => void;
  setRemoteMedia: (media?: MediaMetadata) => void;
  setRemoteMuted: (muted: boolean) => void;
  getStudioMixerChannels: () => StudioMixerChannel[];
  isStudioMixerOpen: () => boolean;
  onRenderStudioMixer: () => void;
  getSessionProjectId: () => string | undefined;
  setSessionProjectId: (id?: string) => void;
  getActiveProjectId: () => string | undefined;
  setActiveProjectId: (id?: string) => void;
  setActiveProject: (p?: Project) => void;
  setPeerIdentity: (identity: ParticipantIdentity | null) => void;
  setPeerParticipantId: (id: string | null) => void;
  onSetIsSessionLocked: (locked: boolean) => void;
  onUpdateLockUi: () => void;
  getAuthUser: () => UserProfile | null;
  getAuthToken: () => string | null;
  onOpenProjectView: (projectId: string) => Promise<void> | void;
  onShowView: (view: 'home-view' | 'waiting-view' | 'call-view' | 'project-view') => void;
  onLoadProjects: () => Promise<void> | void;
  isAudioOnly: () => boolean;
  getCameraId: () => string | undefined;
  onReplaceCamera: (cameraId?: string) => Promise<void>;
  onSyncAllVoiceMics: () => Promise<void>;
}

export function createCallTerminationController(ctx: CallTerminationContext) {
  async function leaveSession(endedMessage?: string): Promise<void> {
    ctx.onStopSessionTimer();
    const currentCode = ctx.getCurrentCode();
    logger.info('session_leave', 'Left session', { code: currentCode }, { sessionCode: currentCode });
    logger.setSessionContext(undefined);
    if (ctx.isInCall()) ctx.onSignalingLeave();
    ctx.setInCall(false);
    ctx.onRtcDispose();

    const voiceMeters = ctx.getVoiceMeters();
    for (const m of voiceMeters.values()) await m.stop();
    voiceMeters.clear();
    ctx.getActiveMicLevels().clear();
    ctx.getActiveMicPeaks().clear();
    ctx.getAudio().dispose();

    const sharing = ctx.getScreenTrack();
    ctx.setScreenTrack(undefined);
    if (sharing) {
      sharing.onended = null;
      sharing.stop();
    }
    await presenter.stopNativeCapture();
    await presenter.exitPresenterMode();
    const videoTrack = ctx.getVideoTrack();
    videoTrack?.stop();
    ctx.setVideoTrack(undefined);
    await ctx.getMusicMeter().stop();

    await ctx.onCleanupRemoteAudioGraph();

    ctx.onSetLastLocalVoiceDb(-60);
    ctx.onSetLastRemoteVoiceDb(-60);
    ctx.onSetLastLocalMusicDb(-60);
    ctx.onSetLastLocalMusicPeakDb(-60);
    ctx.onCheckActiveSpeaker();

    $('remote-tile')?.classList.remove('is-speaking');
    $('local-tile')?.classList.remove('is-speaking');
    closeSessionViewMenu();
    $('voice-in-indicator')?.classList.remove('active');
    $('music-in-indicator')?.classList.remove('active');
    ctx.setRemoteMedia(undefined);
    ctx.setCurrentCode('');

    // Reset Remote Mute state
    ctx.setRemoteMuted(false);
    setText('remote-mute-button', 'Mute Remote');

    // Reset Studio Mixer Mute & Solo
    ctx.getStudioMixerChannels().forEach((ch) => {
      ch.muted = false;
      ch.soloed = false;
    });
    if (ctx.isStudioMixerOpen()) {
      ctx.onRenderStudioMixer();
    }
    const returnProjectId = ctx.getSessionProjectId() || ctx.getActiveProjectId();
    ctx.setPeerIdentity(null);
    ctx.setPeerParticipantId(null);
    ctx.setSessionProjectId(undefined);
    $('session-workspace-drawer')?.classList.add('hidden');
    $('in-call-audio-modal')?.classList.add('hidden');
    $('toggle-session-workspace')?.classList.remove('active');
    $('toggle-session-workspace')?.classList.add('hidden');
    hideWaitingBanner();
    setSessionWorkspaceOpen(false);
    resetChatUi();
    ctx.onSetIsSessionLocked(false);
    ctx.onUpdateLockUi();
    if (endedMessage) {
      setMessage('home-error', endedMessage, endedMessage.toLowerCase().includes('ended') || endedMessage.toLowerCase().includes('left'));
    }
    if (returnProjectId && ctx.getAuthUser() && ctx.getAuthToken()) {
      void ctx.onOpenProjectView(returnProjectId);
    } else {
      ctx.setActiveProjectId(undefined);
      ctx.setActiveProject(undefined);
      ctx.onShowView('home-view');
      void ctx.onLoadProjects();
    }
    if (!ctx.isAudioOnly()) void ctx.onReplaceCamera(ctx.getCameraId()).catch(() => {});
    void ctx.onSyncAllVoiceMics().catch(() => {});
  }

  return {
    leaveSession
  };
}
