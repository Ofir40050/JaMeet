import { $ } from '../../core/dom';

export interface ActiveSpeakerOptions {
  isLocalMuted: () => boolean;
  isRemoteMuted: () => boolean;
  getLastLocalVoiceDb: () => number;
  getLastRemoteVoiceDb: () => number;
  getActiveSpeaker: () => 'local' | 'remote' | null;
  onSetActiveSpeaker: (speaker: 'local' | 'remote') => void;
  getCameraViewMode: () => string;
  onApplyParticipantViewLayout: () => void;
}

const VOICE_THRESHOLD_DB = -46;
const SPEAKER_SWITCH_HOLD_MS = 1200;
let lastSpeakerSwitchTime = 0;

export function checkActiveSpeaker(options: ActiveSpeakerOptions): void {
  const now = performance.now();
  const lastLocalVoiceDb = options.getLastLocalVoiceDb();
  const lastRemoteVoiceDb = options.getLastRemoteVoiceDb();

  const isLocalSpeaking = !options.isLocalMuted() && lastLocalVoiceDb > VOICE_THRESHOLD_DB;
  const isRemoteSpeaking = !options.isRemoteMuted() && lastRemoteVoiceDb > VOICE_THRESHOLD_DB;

  $('remote-tile')?.classList.toggle('is-speaking', isRemoteSpeaking);
  $('local-tile')?.classList.toggle('is-speaking', isLocalSpeaking);

  let newSpeaker: 'local' | 'remote' | null = null;
  if (isRemoteSpeaking && (!isLocalSpeaking || lastRemoteVoiceDb > lastLocalVoiceDb + 2)) {
    newSpeaker = 'remote';
  } else if (isLocalSpeaking && (!isRemoteSpeaking || lastLocalVoiceDb > lastRemoteVoiceDb + 2)) {
    newSpeaker = 'local';
  }

  if (newSpeaker && newSpeaker !== options.getActiveSpeaker()) {
    if (now - lastSpeakerSwitchTime > SPEAKER_SWITCH_HOLD_MS) {
      options.onSetActiveSpeaker(newSpeaker);
      lastSpeakerSwitchTime = now;
      if (options.getCameraViewMode() === 'speaker') {
        options.onApplyParticipantViewLayout();
      }
    }
  }
}
