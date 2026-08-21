import { cameraConstraints } from './videoQuality';
import { createDownscaledVideoTrack } from '../sessions/call/videoTrackScaling';
import { effectiveVideoQuality } from '../sessions/call/sessionMetadataController';
import type { Preferences } from '@jameet/shared';

export interface LocalVideoContext {
  getPreferences: () => Preferences;
  onSavePreferences: () => void;
  isCameraEnabled: () => boolean;
  getScreenTrack: () => MediaStreamTrack | undefined;
  getVideoTrack: () => MediaStreamTrack | undefined;
  setVideoTrack: (track?: MediaStreamTrack) => void;
  isInCall: () => boolean;
  onReplaceRtcVideoTrack: (track: MediaStreamTrack) => Promise<void>;
  onSetRtcVideoTrack: (track: MediaStreamTrack) => void;
  onUpdateCameraButtonState: () => void;
  onUpdateLocalPreviews: () => void;
}

export function createLocalVideoController(ctx: LocalVideoContext) {
  async function acquireVideo(deviceId?: string): Promise<MediaStreamTrack> {
    let stream: MediaStream | undefined;
    const prefs = ctx.getPreferences();
    const quality = effectiveVideoQuality(prefs.cameraQuality);

    if (deviceId) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: cameraConstraints(quality, deviceId),
          audio: false
        });
      } catch {
        // Fall through to generic camera constraints
      }
    }
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: cameraConstraints(quality, undefined),
          audio: false
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
    }
    const rawTrack = stream.getVideoTracks()[0];
    if (!rawTrack) throw new Error('The selected camera did not provide video.');

    let finalTrack = rawTrack;
    if (quality === 'low') {
      finalTrack = createDownscaledVideoTrack(rawTrack, 640, 360, 15);
    } else if (quality === 'standard') {
      finalTrack = createDownscaledVideoTrack(rawTrack, 960, 540, 24);
    }

    finalTrack.enabled = ctx.isCameraEnabled();
    return finalTrack;
  }

  async function replaceCamera(deviceId?: string): Promise<void> {
    if (ctx.getScreenTrack()) throw new Error('Stop screen sharing before changing the camera.');
    const next = await acquireVideo(deviceId);
    try {
      if (ctx.isInCall()) await ctx.onReplaceRtcVideoTrack(next);
    } catch (error) {
      next.stop();
      throw error;
    }
    const currentTrack = ctx.getVideoTrack();
    currentTrack?.stop();
    ctx.setVideoTrack(next);
    ctx.onSetRtcVideoTrack(next);

    const prefs = ctx.getPreferences();
    prefs.cameraId = deviceId;
    ctx.onSavePreferences();
    ctx.onUpdateCameraButtonState();
    ctx.onUpdateLocalPreviews();
  }

  return {
    acquireVideo,
    replaceCamera
  };
}
