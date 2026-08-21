import { $ } from '../../core/dom';
import { presenter } from '../../media/video/presenter';
import { deviceError } from '../../media/devices/deviceError';
import { updateScreenSharingUi } from './screenSharingUi';
import { showScreenPickerUi } from './screenPickerController';
import type { MediaMetadata } from '@jameet/shared';
import type { Preferences } from '../../core/preferences';

export interface ScreenSharingContext {
  isInCall: () => boolean;
  getScreenTrack: () => MediaStreamTrack | undefined;
  setScreenTrack: (track: MediaStreamTrack | undefined) => void;
  getVideoTrack: () => MediaStreamTrack | undefined;
  setVideoTrack: (track: MediaStreamTrack | undefined) => void;
  isCameraEnabled: () => boolean;
  isMuted: () => boolean;
  getPreferences: () => Preferences;
  getCurrentSharingSourceTitle: () => string;
  setCurrentSharingSourceTitle: (title: string) => void;
  getCurrentCode: () => string;
  getMetadata: () => MediaMetadata;
  getLastRemoteVoiceDb: () => number;
  getLastLocalVoiceDb: () => number;
  getUserName: () => string;
  onReplaceRtcVideoTrack: (track: MediaStreamTrack) => Promise<void>;
  onSetRtcVideoTrack: (track: MediaStreamTrack | undefined) => void;
  onRemoveRtcVideoTrack: () => Promise<void>;
  onAddAudioExternal: (id: string, purpose: 'music', track: MediaStreamTrack) => Promise<void>;
  onRemoveAudioExternal: (id: string) => Promise<void>;
  onRtcAudioSourceChanged: (id: string) => Promise<void>;
  onSignalingUpdateMedia: (code: string, meta: MediaMetadata) => void;
  onAcquireVideo: (cameraId?: string) => Promise<MediaStreamTrack>;
  onUpdateLocalPreviews: () => void;
  onSetCallStatus: (status: string) => void;
  onSetMessage: (id: string, text: string, isError?: boolean) => void;
  onSetText: (id: string, text: string) => void;
}

export function createScreenSharingController(ctx: ScreenSharingContext) {
  function setScreenSharingUi(active: boolean): void {
    updateScreenSharingUi(active, {
      getCurrentSharingSourceTitle: () => ctx.getCurrentSharingSourceTitle()
    });
  }

  async function startScreenShare(sourceId: string, optimizeFor: 'detail' | 'motion' = 'detail'): Promise<void> {
    if (!ctx.isInCall() || ctx.getScreenTrack()) return;
    
    const isMotion = optimizeFor === 'motion';
    const fps = isMotion ? 30 : 15;
    const targetRes = isMotion ? { width: 1280, height: 720 } : { width: 1920, height: 1080 };

    let next: MediaStreamTrack | undefined;
    const desktopApi = typeof window !== 'undefined' ? ((window as any).jameet || (window as any).musiczoom) : undefined;

    // 1. For entire display sharing on macOS, use native ScreenCaptureKit capture with SCContentFilter app exclusion
    if (sourceId.startsWith('screen:') && desktopApi?.platform === 'darwin') {
      try {
        const displayIndex = parseInt(sourceId.split(':')[1], 10) || 0;
        next = await presenter.createScreenCaptureTrack(displayIndex, { fps, width: targetRes.width, height: targetRes.height });
      } catch (err) {
        console.warn('Native ScreenCaptureKit failed, falling back to standard getDisplayMedia:', err);
      }
    }

    // 2. Standard getDisplayMedia fallback or window sharing
    if (!next) {
      const selected = desktopApi?.selectDisplaySource ? desktopApi.selectDisplaySource(sourceId) : true;
      if (!selected) throw new Error('The selected screen could not be authorized.');
      
      const fpsConstraint = isMotion ? { ideal: 30, max: 30 } : { ideal: 15, max: 15 };
      const resConstraint = isMotion ? { width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { ...resConstraint, frameRate: fpsConstraint },
          audio: true
        });
      } catch {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { ...resConstraint, frameRate: fpsConstraint },
          audio: false
        });
      }
      next = stream.getVideoTracks()[0];
      if (!next) throw new Error('Screen sharing did not provide a video track.');
      const displayAudio = stream.getAudioTracks()[0];
      if (displayAudio) {
        await ctx.onAddAudioExternal('screen-audio', 'music', displayAudio);
        await ctx.onRtcAudioSourceChanged('screen-audio');
      }
    }

    next.contentHint = isMotion ? 'motion' : 'detail';
    try { await ctx.onReplaceRtcVideoTrack(next); }
    catch (error) {
      next.stop();
      await presenter.stopNativeCapture();
      await presenter.exitPresenterMode();
      throw error;
    }
    ctx.setScreenTrack(next);
    // NOTE: Keep videoTrack running so local camera remains visible in the camera strip!
    ctx.onSetRtcVideoTrack(next);
    next.onended = () => void stopScreenShare();
    setScreenSharingUi(true);
    ctx.onUpdateLocalPreviews();
    ctx.onSetCallStatus(`Sharing: ${ctx.getCurrentSharingSourceTitle() || 'Screen'}`);
    ctx.onSignalingUpdateMedia(ctx.getCurrentCode(), ctx.getMetadata());

    // 3. Automatically transition into Presenter Mode
    presenter.setRemoteVideoElement($<HTMLVideoElement>('remote-video'));
    presenter.setLocalVideoElement($<HTMLVideoElement>('local-video'));
    presenter.setParticipantInfo(
      'Musician',
      ctx.getUserName() || 'You',
      ctx.getLastRemoteVoiceDb(),
      ctx.getLastLocalVoiceDb()
    );
    $('session-presenter-banner')?.classList.add('hidden');
    const prefs = ctx.getPreferences();
    await presenter.enterPresenterMode({
      micMuted: ctx.isMuted(),
      camEnabled: ctx.isCameraEnabled(),
      mode: prefs.mode,
      paused: false,
      pipVisible: true
    });
  }

  async function stopScreenShare(): Promise<void> {
    const previous = ctx.getScreenTrack();
    if (!previous) return;
    previous.onended = null;
    ctx.setCurrentSharingSourceTitle('');
    try {
      if (ctx.isCameraEnabled() && ctx.getVideoTrack()) {
        const videoTrack = ctx.getVideoTrack()!;
        await ctx.onReplaceRtcVideoTrack(videoTrack);
        ctx.onSetRtcVideoTrack(videoTrack);
      } else if (ctx.isCameraEnabled()) {
        const prefs = ctx.getPreferences();
        const camera = await ctx.onAcquireVideo(prefs.cameraId);
        await ctx.onReplaceRtcVideoTrack(camera);
        ctx.setVideoTrack(camera);
        ctx.onSetRtcVideoTrack(camera);
      } else {
        await ctx.onRemoveRtcVideoTrack();
        ctx.onSetRtcVideoTrack(undefined);
      }
    } catch (error) {
      await ctx.onRemoveRtcVideoTrack();
      ctx.onSetCallStatus(`Screen sharing stopped. ${deviceError(error)}`);
    } finally {
      await ctx.onRemoveAudioExternal('screen-audio');
      await ctx.onRtcAudioSourceChanged('screen-audio');
      ctx.setScreenTrack(undefined);
      previous.stop();
      await presenter.stopNativeCapture();
      await presenter.exitPresenterMode();
      $('session-presenter-banner')?.classList.add('hidden');
      setScreenSharingUi(false);
      ctx.onUpdateLocalPreviews();
      ctx.onSignalingUpdateMedia(ctx.getCurrentCode(), ctx.getMetadata());
    }
  }

  async function showScreenPicker(): Promise<void> {
    await showScreenPickerUi({
      hasScreenTrack: () => Boolean(ctx.getScreenTrack()),
      onStopScreenShare: () => stopScreenShare(),
      onStartScreenShare: (sourceId, preset) => startScreenShare(sourceId, preset),
      onSetCurrentSharingSourceTitle: (title) => {
        ctx.setCurrentSharingSourceTitle(title);
      },
      onSetMessage: (id, text, isError) => ctx.onSetMessage(id, text, isError),
      onSetText: (id, text) => ctx.onSetText(id, text),
      onSetCallStatus: (status) => ctx.onSetCallStatus(status)
    });
  }

  return {
    startScreenShare,
    stopScreenShare,
    setScreenSharingUi,
    showScreenPicker
  };
}
