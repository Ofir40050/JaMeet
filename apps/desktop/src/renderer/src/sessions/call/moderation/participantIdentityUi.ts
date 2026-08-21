import type { ParticipantIdentity, UserProfile } from '@jameet/shared';
import { $, setText } from '../../../core/dom';
import { icons } from '../../../core/icons';
import { safeAvatarColor } from '../../../core/htmlSecurity';
import { applyAvatarToElement } from '../../../auth/profile/profileUi';

export interface ParticipantIdentityUiOptions {
  getUser: () => UserProfile | null | undefined;
  getGuestName: () => string;
  getMyIdentity: () => ParticipantIdentity | undefined;
  getPeerIdentity: () => ParticipantIdentity | undefined;
  getCurrentRole: () => string;
  getPeerParticipantId: () => string | undefined;
  onUpdateSessionViewButton: () => void;
  onRenderSessionViewMenu: () => void;
}

let uiOptions: ParticipantIdentityUiOptions | null = null;

export function initParticipantIdentityUi(options: ParticipantIdentityUiOptions): void {
  uiOptions = options;
}

export function updateParticipantIdentityUi(): void {
  if (!uiOptions) return;
  const user = uiOptions.getUser();
  const guestName = uiOptions.getGuestName();
  const isLogged = Boolean(user);
  const avatarBg = safeAvatarColor(user?.avatarColor, '#38bdf8');
  const avatarUrl = user?.avatarUrl;
  const myIdentity = uiOptions.getMyIdentity();

  const localLabel = myIdentity
    ? `${myIdentity.displayName}${myIdentity.isHost ? ' (Host)' : myIdentity.isGuest ? ' (Guest)' : ''}`
    : user ? user.displayName : guestName ? `${guestName} (Guest)` : 'You';
  setText('local-user-name', localLabel);
  setText('call-user-name', user ? user.displayName : guestName ? `${guestName} (Guest)` : 'Host');

  const localIconEl = $('local-user-icon');
  if (localIconEl) localIconEl.innerHTML = myIdentity?.isHost ? icons.crown({ size: 12 }) : icons.headphones({ size: 12 });

  const callBadge = $('call-avatar-badge');
  if (callBadge) {
    if (isLogged && user) {
      applyAvatarToElement(callBadge, user.displayName || user.username, avatarBg, avatarUrl);
    } else if (guestName) {
      applyAvatarToElement(callBadge, guestName, '#06b6d4');
    } else {
      callBadge.innerHTML = icons.user({ size: 14 });
    }
  }

  const peerIdentity = uiOptions.getPeerIdentity();
  const remoteLabel = peerIdentity
    ? `${peerIdentity.displayName}${peerIdentity.username ? ` (@${peerIdentity.username})` : ''}${peerIdentity.isHost ? ' (Host)' : peerIdentity.isGuest ? ' (Guest)' : ''}`
    : 'Musician';
  setText('remote-user-name', remoteLabel);
  const remoteIconEl = $('remote-user-icon');
  if (remoteIconEl) remoteIconEl.innerHTML = peerIdentity?.isHost ? icons.crown({ size: 12 }) : icons.user({ size: 12 });

  const removeBtn = $('btn-remove-participant');
  if (removeBtn) {
    if (uiOptions.getCurrentRole() === 'host' && Boolean(uiOptions.getPeerParticipantId())) {
      removeBtn.classList.remove('hidden');
    } else {
      removeBtn.classList.add('hidden');
    }
  }

  uiOptions.onUpdateSessionViewButton();
  uiOptions.onRenderSessionViewMenu();
}
