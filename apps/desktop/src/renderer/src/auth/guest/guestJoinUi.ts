import { $ } from '../../core/dom';
import { icons } from '../../core/icons';

export interface GuestJoinUiOptions {
  onConfirmGuest?: (name: string) => Promise<void> | void;
  onOpenSignIn?: () => void;
}

let guestOptions: GuestJoinUiOptions = {};
let isInitialized = false;

export function getGuestNameInput(): string {
  return $<HTMLInputElement>('guest-name-input')?.value.trim() || '';
}

export function closeGuestJoinDialog(): void {
  $<HTMLDialogElement>('guest-join-dialog')?.close();
}

export function openGuestJoinDialog(): void {
  $<HTMLDialogElement>('guest-join-dialog')?.showModal();
}

export function initGuestJoinUi(options: GuestJoinUiOptions = {}): void {
  guestOptions = options;
  if (isInitialized) return;
  isInitialized = true;

  $<HTMLInputElement>('guest-name-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      $('btn-confirm-guest-join')?.click();
    }
  });

  $<HTMLInputElement>('guest-name-input')?.addEventListener('input', (e) => {
    const val = (e.currentTarget as HTMLInputElement).value.trim();
    const avatar = $('guest-avatar-preview');
    if (avatar) {
      if (val) {
        avatar.textContent = val[0]?.toUpperCase() ?? '';
      } else {
        avatar.innerHTML = icons.user({ size: 22 });
      }
    }
  });

  // Guest modal sign in redirect
  $('link-guest-to-login')?.addEventListener('click', (e) => {
    e.preventDefault();
    closeGuestJoinDialog();
    guestOptions.onOpenSignIn?.();
  });

  $('btn-guest-modal-signin')?.addEventListener('click', () => {
    closeGuestJoinDialog();
    guestOptions.onOpenSignIn?.();
  });

  $('btn-confirm-guest-join')?.addEventListener('click', () => {
    const rawName = getGuestNameInput();
    void guestOptions.onConfirmGuest?.(rawName);
  });
}
