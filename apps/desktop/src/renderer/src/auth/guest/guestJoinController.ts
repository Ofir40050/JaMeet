import { initGuestJoinUi, closeGuestJoinDialog } from './guestJoinUi';

export interface GuestJoinControllerOptions {
  onOpenSignIn: () => void;
  onSetGuestName: (name: string) => void;
  onPrepareStudio: (action: { type: 'join'; code: string }) => Promise<void> | void;
}

let pendingJoinCode = '';

export function getPendingJoinCode(): string {
  return pendingJoinCode;
}

export function setPendingJoinCode(code: string): void {
  pendingJoinCode = code;
}

export function clearPendingJoinCode(): void {
  pendingJoinCode = '';
}

export function initGuestJoinController(options: GuestJoinControllerOptions): void {
  initGuestJoinUi({
    onOpenSignIn: () => {
      options.onOpenSignIn();
    },
    onConfirmGuest: (rawName) => {
      const name = rawName || 'Guest Musician';
      options.onSetGuestName(name);
      closeGuestJoinDialog();
      if (pendingJoinCode) {
        const code = pendingJoinCode;
        pendingJoinCode = '';
        void options.onPrepareStudio({ type: 'join', code });
      }
    }
  });
}
