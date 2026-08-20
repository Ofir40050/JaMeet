import { meetingCodeSchema, normalizeMeetingCode, type UserProfile } from '@jameet/shared';
import { $ } from '../../core/dom';

export interface DeepLinkControllerOptions {
  isInCall: () => boolean;
  getUser: () => UserProfile | null | undefined;
  onSetPendingJoinCode: (code: string) => void;
  onOpenAuthView: (mode: 'login' | 'register') => void;
  onPrepareStudio: (options: { type: 'join'; code: string }) => Promise<void>;
}

let controllerOptions: DeepLinkControllerOptions | null = null;

export function initDeepLinkController(options: DeepLinkControllerOptions): void {
  controllerOptions = options;
}

export async function handleDeepLink(url: string): Promise<void> {
  if (!controllerOptions) return;
  const callView = $('call-view');
  const waitingView = $('waiting-view');
  if (
    controllerOptions.isInCall() ||
    callView?.classList.contains('active') ||
    waitingView?.classList.contains('active')
  ) {
    // If JaMeet is already in an active session or waiting room,
    // do not interrupt, leave, replace, or restart the current session.
    return;
  }
  const code = normalizeMeetingCode(url);
  if (meetingCodeSchema.safeParse(code).success) {
    const joinInput = $<HTMLInputElement>('join-input');
    if (joinInput) {
      joinInput.value = code;
    }
    if (!controllerOptions.getUser()) {
      controllerOptions.onSetPendingJoinCode(code);
      controllerOptions.onOpenAuthView('login');
    } else {
      await controllerOptions.onPrepareStudio({ type: 'join', code });
    }
  }
}
