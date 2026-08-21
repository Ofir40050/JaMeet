import type { MediaMetadata, MeetingAck, ParticipantIdentity } from '@jameet/shared';
import { $, setText } from '../../core/dom';
import { showSessionErrorModal } from './sessionErrorUi';
import { parseSessionError } from './sessionErrorParser';
import type { PendingAction } from './studioPreparation';

export interface SessionEntryControllerOptions {
  getPendingAction: () => PendingAction | undefined;
  hasPrimaryAudio: () => boolean;
  isAudioOnly: () => boolean;
  hasVideoTrack: () => boolean;
  setBusy: (busy: boolean) => void;
  getAuthToken: () => string | null | undefined;
  getGuestName: () => string | null | undefined;
  getParticipantId: () => string;
  getMetadata: () => MediaMetadata;
  getActiveProjectId: () => string | undefined;
  onSignalingCreate: (
    participantId: string,
    metadata: MediaMetadata,
    token?: string,
    guestName?: string,
    activeProjectId?: string,
    waitingRoomEnabled?: boolean
  ) => Promise<MeetingAck>;
  onSignalingJoin: (
    code: string,
    participantId: string,
    metadata: MediaMetadata,
    token?: string,
    guestName?: string
  ) => Promise<MeetingAck>;
  onSignalingLeave: () => void;
  onOpenAuthView: (tab: 'login' | 'register') => void;
  onSetCurrentCode: (code: string) => void;
  onSetLoggerSessionContext: (code: string) => void;
  onSetHostIdentity: (identity: ParticipantIdentity | null) => void;
  onSetMyIdentity: (identity: ParticipantIdentity | null) => void;
  onShowWaitingView: () => void;
  onInitializeActiveCall: (ack: Extract<MeetingAck, { ok: true }>) => Promise<void>;
}

let isEnteringSession = false;

export async function enterSession(options: SessionEntryControllerOptions): Promise<void> {
  if (isEnteringSession) return;
  isEnteringSession = true;

  const pending = options.getPendingAction();
  if (
    !pending ||
    !options.hasPrimaryAudio() ||
    (!options.isAudioOnly() && !options.hasVideoTrack())
  ) {
    isEnteringSession = false;
    showSessionErrorModal({
      title: 'Studio Setup Required',
      message: 'Your microphone and session audio devices must be ready before entering.',
      detail: 'Please check your microphone connection and system audio permissions.',
      type: 'warning',
      actionLabel: 'OK'
    });
    return;
  }
  options.setBusy(true);
  try {
    const token = options.getAuthToken() || undefined;
    const guestName = options.getGuestName() || undefined;
    const waitingRoomEnabled = $<HTMLInputElement>('setup-waiting-room')?.checked ?? false;
    const participantId = options.getParticipantId();
    const activeProjectId = options.getActiveProjectId();

    let ack: MeetingAck =
      pending.type === 'create'
        ? await options.onSignalingCreate(
            participantId,
            options.getMetadata(),
            token,
            guestName,
            activeProjectId,
            waitingRoomEnabled
          )
        : await options.onSignalingJoin(
            pending.code,
            participantId,
            options.getMetadata(),
            token,
            guestName
          );

    if (!ack.ok && ack.message === 'Already in a session') {
      options.onSignalingLeave();
      ack =
        pending.type === 'create'
          ? await options.onSignalingCreate(
              participantId,
              options.getMetadata(),
              token,
              guestName,
              activeProjectId,
              waitingRoomEnabled
            )
          : await options.onSignalingJoin(
              pending.code,
              participantId,
              options.getMetadata(),
              token,
              guestName
            );
    }

    if (!ack.ok) {
      if (ack.code === 'AUTH_REQUIRED') {
        showSessionErrorModal({
          title: 'Sign In Required',
          message: 'An active JaMeet account is required to create or join studio sessions.',
          detail: 'Please sign in or create an account to start collaborating.',
          type: 'info',
          actionLabel: 'Sign In',
          onAction: () => options.onOpenAuthView('login')
        });
      } else if (ack.code === 'BETA_ENDED') {
        showSessionErrorModal({
          title: 'JaMeet Beta Has Ended',
          message:
            'The JaMeet public beta period has concluded. An active subscription is now required to create or join live studio sessions.',
          detail: 'Please sign in to manage your subscription or contact studio support.',
          type: 'warning',
          actionLabel: 'Sign In / Account',
          onAction: () => options.onOpenAuthView('login')
        });
      } else if (ack.code === 'ACCESS_DENIED') {
        showSessionErrorModal({
          title: 'Access Restricted',
          message:
            'Your account does not currently have permission to access JaMeet live sessions.',
          detail: 'Please check your account plan or contact studio support.',
          type: 'error',
          actionLabel: 'Sign In / Account',
          onAction: () => options.onOpenAuthView('login')
        });
      } else if (ack.code === 'ROOM_FULL') {
        showSessionErrorModal({
          title: 'Session is Full',
          message: 'This session has reached its maximum participant limit.',
          detail: 'Ask the host to start a new session or try again later.',
          type: 'warning',
          actionLabel: 'OK'
        });
      } else if (ack.code === 'ROOM_LOCKED') {
        showSessionErrorModal({
          title: 'Session is Locked',
          message: 'The host has locked this session to prevent new participants from joining.',
          detail: 'Please contact the session host to unlock the room.',
          type: 'warning',
          actionLabel: 'OK'
        });
      } else if (ack.code === 'INVALID_CODE') {
        showSessionErrorModal({
          title: 'Session Not Found',
          message: 'The session code is invalid or has already ended.',
          detail: 'Please verify the session code and try again.',
          type: 'error',
          actionLabel: 'OK'
        });
      } else {
        showSessionErrorModal({
          title: 'Unable to Join Session',
          message:
            ack.message ||
            'An unexpected error occurred while connecting to the studio session.',
          detail: 'Please check your connection and try again.',
          type: 'error',
          actionLabel: 'Retry',
          onAction: () => void enterSession(options)
        });
      }
      return;
    }

    $('session-error-modal')?.classList.add('hidden');

    if (ack.waiting) {
      options.onSetCurrentCode(ack.code);
      options.onSetLoggerSessionContext(ack.code);
      options.onSetHostIdentity(ack.hostIdentity);
      options.onSetMyIdentity(ack.identity);
      setText('waiting-host-name', ack.hostIdentity?.displayName || 'Host Musician');
      setText('waiting-code', ack.code);
      options.onShowWaitingView();
      return;
    }
    options.onSetLoggerSessionContext(ack.code);
    await options.onInitializeActiveCall(ack);
  } catch (error) {
    showSessionErrorModal(
      parseSessionError(error, {
        onOpenSignIn: () => options.onOpenAuthView('login'),
        onEnterSession: () => void enterSession(options)
      })
    );
  } finally {
    isEnteringSession = false;
    options.setBusy(false);
  }
}
