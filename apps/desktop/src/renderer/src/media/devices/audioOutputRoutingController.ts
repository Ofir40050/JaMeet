import { $ } from '../../core/dom';
import { testSpeakers as testSpeakersHelper, testMicrophone as testMicrophoneHelper, getMicrophonePlayback } from './audioDeviceTesting';
import type { Preferences } from '../../core/preferences';

export interface AudioOutputRoutingContext {
  getPreferences: () => Preferences;
  onSavePreferences: () => void;
  getRemoteAudioCtx: () => AudioContext | undefined;
  getPrimaryTrack: () => MediaStreamTrack | undefined;
  onUpdateHeadphoneWarning: () => void;
  onSetMessage: (id: string, text: string, isError?: boolean) => void;
}

export function createAudioOutputRoutingController(ctx: AudioOutputRoutingContext) {
  async function setOutputDevice(deviceId?: string): Promise<void> {
    const remoteAudioCtx = ctx.getRemoteAudioCtx();
    if (remoteAudioCtx && remoteAudioCtx.state !== 'closed') {
      if (typeof (remoteAudioCtx as any).setSinkId === 'function') {
        await (remoteAudioCtx as any).setSinkId(deviceId ?? '');
      } else if (deviceId) {
        throw new Error('Audio output selection is not supported on this system.');
      }
    }

    const media = [$<HTMLAudioElement>('remote-voice-audio'), $<HTMLAudioElement>('remote-music-audio'), getMicrophonePlayback()].filter(Boolean) as HTMLMediaElement[];
    for (const element of media) {
      if (!element.setSinkId) {
        if (deviceId && !remoteAudioCtx) throw new Error('Audio output selection is not supported on this system.');
        continue;
      }
      await element.setSinkId(deviceId ?? '').catch(() => {});
    }

    const prefs = ctx.getPreferences();
    prefs.audioOutputId = deviceId;
    ctx.onSavePreferences();
    ctx.onUpdateHeadphoneWarning();
  }

  async function testSpeakers(pan: 'both' | 'left' | 'right' = 'both'): Promise<void> {
    const prefs = ctx.getPreferences();
    await testSpeakersHelper(pan, {
      getAudioOutputId: () => prefs.audioOutputId,
      getOutputVolume: () => prefs.outputVolume
    });
  }

  async function testMicrophone(): Promise<void> {
    const prefs = ctx.getPreferences();
    await testMicrophoneHelper({
      getPrimaryTrack: () => ctx.getPrimaryTrack(),
      getAudioOutputId: () => prefs.audioOutputId,
      getOutputVolume: () => prefs.outputVolume,
      onSetMessage: (id, text, isError) => ctx.onSetMessage(id, text, isError)
    });
  }

  return {
    setOutputDevice,
    testSpeakers,
    testMicrophone,
    getMicrophonePlayback
  };
}
