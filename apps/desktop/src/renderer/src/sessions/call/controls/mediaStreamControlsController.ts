import { $ } from '../../../core/dom';
import { icons } from '../../../core/icons';
import { logger } from '../../../core/logger';
import { updateCameraButtonUi } from './cameraUi';
import { effectiveVideoQuality } from '../../../media/video/videoQuality';
import { getEffectiveMusicBitrate } from '../../../media/devices/mediaPreferenceCalculations';
import type { AudioMode, MediaMetadata, PerformanceMode, Preferences, VideoQuality } from '@jameet/shared';

export interface MediaStreamControlsContext {
  getPreferences: () => Preferences;
  onSavePreferences: () => void;
  isInCall: () => boolean;
  isAudioOnly: () => boolean;
  setAudioOnlyState: (enabled: boolean) => void;
  isCameraEnabled: () => boolean;
  setCameraEnabledState: (enabled: boolean) => void;
  isMuted: () => boolean;
  setMutedState: (muted: boolean) => void;
  getVideoTrack: () => MediaStreamTrack | undefined;
  setVideoTrack: (track: MediaStreamTrack | undefined) => void;
  getScreenTrack: () => MediaStreamTrack | undefined;
  getRemoteMedia: () => MediaMetadata | undefined;
  getCurrentCode: () => string;
  getMetadata: () => MediaMetadata;
  onReplaceCamera: (cameraId?: string) => Promise<void>;
  onAcquireVideo: (cameraId?: string) => Promise<MediaStreamTrack>;
  onSyncAllVoiceMics: (mode?: AudioMode) => Promise<void>;
  onReplaceMusicInput: () => Promise<void>;
  onEnumerateAndPopulate: () => Promise<void>;
  onUpdateLocalPreviews: () => void;
  onApplyMixerAudioRouting: () => void;
  onSyncMediaActiveState: () => void;
  onSetMessage: (id: string, text: string, isError?: boolean) => void;
  onVideoQualityChanged: (quality: VideoQuality) => Promise<void>;
  onMusicQualityChanged: (bitrate: number) => Promise<void>;
  onRemoveRtcVideoTrack: () => Promise<void>;
  onSignalingUpdateMedia: (code: string, metadata: MediaMetadata) => void;
  onSetModeRadios: (mode: AudioMode) => void;
  onUpdateCallMode: () => void;
  onUpdateMusicWarning: () => void;
  onShowSessionError: (error: unknown) => void;
}

export function createMediaStreamControlsController(ctx: MediaStreamControlsContext) {
  async function changeCameraQuality(quality: VideoQuality): Promise<void> {
    const prefs = ctx.getPreferences();
    const previous = prefs.cameraQuality;
    prefs.cameraQuality = quality;
    ctx.onSavePreferences();
    try {
      if (ctx.isInCall()) await ctx.onVideoQualityChanged(effectiveVideoQuality(quality));
      if (!ctx.getScreenTrack()) await ctx.onReplaceCamera(prefs.cameraId);
      await ctx.onEnumerateAndPopulate();
      ctx.onSetMessage(ctx.isInCall() ? 'device-dialog-status' : 'setup-status', `Camera quality set to ${quality}.`);
    } catch (error) {
      prefs.cameraQuality = previous;
      ctx.onSavePreferences();
      if (ctx.isInCall()) await ctx.onVideoQualityChanged(effectiveVideoQuality(previous));
      await ctx.onEnumerateAndPopulate();
      throw error;
    }
  }

  async function changeReceiveQuality(quality: VideoQuality): Promise<void> {
    const prefs = ctx.getPreferences();
    prefs.receiveQuality = quality;
    ctx.onSavePreferences();
    if (ctx.isInCall()) ctx.onSignalingUpdateMedia(ctx.getCurrentCode(), ctx.getMetadata());
    await ctx.onEnumerateAndPopulate();
    ctx.onSetMessage(ctx.isInCall() ? 'device-dialog-status' : 'setup-status', `Received video preference set to ${quality}.`);
  }

  async function changePerformanceMode(mode: PerformanceMode): Promise<void> {
    const prefs = ctx.getPreferences();
    prefs.performanceMode = mode;
    ctx.onSavePreferences();
    if (ctx.isInCall()) await ctx.onVideoQualityChanged(effectiveVideoQuality(prefs.cameraQuality));
    if (ctx.isInCall()) await ctx.onMusicQualityChanged(getEffectiveMusicBitrate(prefs));
    if (!ctx.getScreenTrack() && ctx.getVideoTrack()) await ctx.onReplaceCamera(prefs.cameraId);
    await ctx.onSyncAllVoiceMics(prefs.mode);
    if (ctx.isInCall()) ctx.onSignalingUpdateMedia(ctx.getCurrentCode(), ctx.getMetadata());
    await ctx.onEnumerateAndPopulate();
  }

  async function setAudioOnly(enabled: boolean): Promise<void> {
    const prefs = ctx.getPreferences();
    ctx.setAudioOnlyState(enabled);
    prefs.audioOnly = enabled;
    ctx.onSavePreferences();
    if (enabled) {
      ctx.setCameraEnabledState(false);
      ctx.getVideoTrack()?.stop();
      ctx.setVideoTrack(undefined);
      if (ctx.isInCall() && !ctx.getScreenTrack()) await ctx.onRemoveRtcVideoTrack();
    } else {
      ctx.setCameraEnabledState(true);
      if (!ctx.getScreenTrack()) await ctx.onReplaceCamera(prefs.cameraId);
    }
    const audioBtn = $('audio-only-button');
    if (audioBtn) audioBtn.textContent = enabled ? 'Enable Video' : 'Audio Only';
    $('camera-button')?.classList.toggle('hidden', enabled);
    updateCameraButtonState();
    ctx.onUpdateLocalPreviews();
    if (ctx.isInCall()) ctx.onSignalingUpdateMedia(ctx.getCurrentCode(), ctx.getMetadata());
  }

  function updateCameraButtonState(): void {
    updateCameraButtonUi(ctx.isCameraEnabled());
  }

  async function toggleCamera(): Promise<void> {
    if (ctx.isAudioOnly()) return;
    const prefs = ctx.getPreferences();
    if (ctx.isCameraEnabled()) {
      ctx.setCameraEnabledState(false);
      ctx.getVideoTrack()?.stop();
      ctx.setVideoTrack(undefined);
      if (ctx.isInCall() && !ctx.getScreenTrack()) await ctx.onRemoveRtcVideoTrack();
    } else {
      ctx.setCameraEnabledState(true);
      if (ctx.getScreenTrack()) {
        ctx.setVideoTrack(await ctx.onAcquireVideo(prefs.cameraId));
      } else {
        await ctx.onReplaceCamera(prefs.cameraId);
      }
    }
    updateCameraButtonState();
    ctx.onUpdateLocalPreviews();
    if (ctx.isInCall()) ctx.onSignalingUpdateMedia(ctx.getCurrentCode(), ctx.getMetadata());
  }

  async function applyAdvancedAudioSettings(): Promise<void> {
    const prefs = ctx.getPreferences();
    await ctx.onSyncAllVoiceMics(prefs.mode);
    await ctx.onReplaceMusicInput();
    await ctx.onEnumerateAndPopulate();
  }

  function updateHeadphoneWarning(): void {
    const el1 = document.getElementById('music-warning');
    if (el1) el1.classList.add('hidden');
    const el2 = document.getElementById('call-warning');
    if (el2) el2.classList.add('hidden');
    const el3 = document.getElementById('in-call-music-warning');
    if (el3) el3.classList.add('hidden');
  }

  async function fullscreenRemote(requireShare: boolean): Promise<void> {
    const remoteMedia = ctx.getRemoteMedia();
    if (requireShare && !remoteMedia?.sharingScreen) return;
    const tile = $<HTMLVideoElement>('remote-video').closest<HTMLElement>('.video-tile');
    if (tile && document.fullscreenElement !== tile) await tile.requestFullscreen();
  }

  async function switchAudioMode(mode: AudioMode): Promise<void> {
    const prefs = ctx.getPreferences();
    prefs.mode = mode;
    ctx.onSavePreferences();
    ctx.onSetModeRadios(mode);
    ctx.onUpdateCallMode();
    ctx.onUpdateMusicWarning();
    try {
      await ctx.onSyncAllVoiceMics(mode);
      ctx.onSetMessage(ctx.isInCall() ? 'device-dialog-status' : 'setup-status', `Audio Profile: ${mode === 'music' ? 'Music Mode' : 'Talk Mode'}`);
    } catch (error) {
      logger.warn('mode_change_error', 'Failed to switch audio mode', { mode }, error);
      ctx.onSetModeRadios(prefs.mode);
      ctx.onShowSessionError(error);
    }
  }

  function toggleMute(): void {
    const nextMuted = !ctx.isMuted();
    ctx.setMutedState(nextMuted);
    ctx.onApplyMixerAudioRouting();
    const muteBtn = $('mute-button');
    if (muteBtn) muteBtn.textContent = nextMuted ? 'Unmute' : 'Mute';
    const toggleMic = $('toggle-mic');
    if (toggleMic) {
      toggleMic.classList.toggle('active', !nextMuted);
      toggleMic.classList.toggle('muted', nextMuted);
      toggleMic.innerHTML = `<span class="tool-icon">${nextMuted ? icons.micOff({ size: 18 }) : icons.mic({ size: 18 })}</span>`;
      toggleMic.title = nextMuted ? 'Unmute Microphone' : 'Mute Microphone';
    }
    if (nextMuted) $('voice-in-indicator')?.classList.remove('active');
    if (ctx.isInCall()) ctx.onSignalingUpdateMedia(ctx.getCurrentCode(), ctx.getMetadata());
    ctx.onSyncMediaActiveState();
  }

  return {
    changeCameraQuality,
    changeReceiveQuality,
    changePerformanceMode,
    setAudioOnly,
    updateCameraButtonState,
    toggleCamera,
    applyAdvancedAudioSettings,
    updateHeadphoneWarning,
    fullscreenRemote,
    switchAudioMode,
    toggleMute
  };
}
