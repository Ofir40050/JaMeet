import type { ParticipantIdentity } from '@jameet/shared';
import type { SignalingClient } from '@jameet/signaling-client';
import { $ } from '../../../core/dom';

export interface SessionModerationOptions {
  signaling: SignalingClient;
  getCurrentRole: () => string;
  getCurrentCode: () => string;
  getPeerParticipantId: () => string | undefined;
  getPeerIdentity: () => ParticipantIdentity | undefined;
  onUpdateLockUi: () => void;
  onSetStatusMessage: (id: string, text: string, isError?: boolean) => void;
}

let moderationOptions: SessionModerationOptions | null = null;
let isSessionLocked = false;

export function getIsSessionLocked(): boolean {
  return isSessionLocked;
}

export function setIsSessionLocked(locked: boolean): void {
  isSessionLocked = locked;
}

export function initSessionModeration(options: SessionModerationOptions): void {
  moderationOptions = options;

  options.signaling.on('session:locked', (payload: { code: string; locked: boolean }) => {
    if (payload.code === options.getCurrentCode()) {
      isSessionLocked = payload.locked;
      options.onUpdateLockUi();
    }
  });

  $('btn-lock-session')?.addEventListener('click', async () => {
    if (options.getCurrentRole() !== 'host' || !options.getCurrentCode()) return;
    const targetState = !isSessionLocked;
    const btn = $<HTMLButtonElement>('btn-lock-session');
    if (btn) btn.disabled = true;
    try {
      const res = await options.signaling.setSessionLock(options.getCurrentCode(), targetState);
      if (res.ok) {
        isSessionLocked = Boolean(res.locked);
        options.onUpdateLockUi();
      } else {
        options.onSetStatusMessage('call-status', res.message || 'Failed to update session lock', true);
      }
    } catch {
      // Keep current state on error
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('btn-remove-participant')?.addEventListener('click', async () => {
    const peerParticipantId = options.getPeerParticipantId();
    if (options.getCurrentRole() !== 'host' || !options.getCurrentCode() || !peerParticipantId) return;
    const peerIdentity = options.getPeerIdentity();
    const peerName = peerIdentity?.displayName || 'this participant';
    const confirmed = window.confirm(`Are you sure you want to remove ${peerName} from the session?`);
    if (!confirmed) return;
    const btn = $<HTMLButtonElement>('btn-remove-participant');
    if (btn) btn.disabled = true;
    try {
      const res = await options.signaling.removeParticipant(options.getCurrentCode(), peerParticipantId);
      if (!res.ok) {
        options.onSetStatusMessage('call-status', res.message || 'Failed to remove participant', true);
      }
    } catch {
      // Keep current state on error
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}
