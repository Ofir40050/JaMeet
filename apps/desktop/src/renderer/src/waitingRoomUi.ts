import type { WaitingParticipantItem } from '@jameet/shared';
import { $, setMessage } from './dom';

export interface WaitingRoomUiOptions {
  onAdmit?: (participantId: string) => Promise<{ ok: boolean; message?: string } | void>;
}

let options: WaitingRoomUiOptions = {};

export function initWaitingRoomUi(opts: WaitingRoomUiOptions): void {
  options = opts;
}

export function hideWaitingBanner(): void {
  const banner = $('waiting-room-banner');
  const bannerList = $('waiting-banner-list');
  if (banner) banner.classList.add('hidden');
  if (bannerList) bannerList.innerHTML = '';
}

export function renderWaitingBanner(waitingList: WaitingParticipantItem[]): void {
  const banner = $('waiting-room-banner');
  const bannerText = $('waiting-banner-text');
  const bannerList = $('waiting-banner-list');
  if (!banner || !bannerText || !bannerList) return;

  if (!waitingList || waitingList.length === 0) {
    banner.classList.add('hidden');
    bannerList.innerHTML = '';
    return;
  }

  banner.classList.remove('hidden');
  const count = waitingList.length;
  bannerText.textContent = `${count} ${count === 1 ? 'participant' : 'participants'} in waiting room`;
  bannerList.innerHTML = '';

  for (const item of waitingList) {
    const chip = document.createElement('div');
    chip.className = 'waiting-participant-chip';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'waiting-participant-name';
    nameSpan.textContent = item.identity.displayName || 'Guest Musician';

    const admitBtn = document.createElement('button');
    admitBtn.type = 'button';
    admitBtn.className = 'btn-admit-chip';
    admitBtn.textContent = 'Admit';
    admitBtn.addEventListener('click', async () => {
      admitBtn.disabled = true;
      admitBtn.textContent = 'Admitting…';
      try {
        const res = await options.onAdmit?.(item.participantId);
        if (res && !res.ok) {
          admitBtn.disabled = false;
          admitBtn.textContent = 'Admit';
          setMessage('call-status', res.message || 'Failed to admit', true);
        }
      } catch {
        admitBtn.disabled = false;
        admitBtn.textContent = 'Admit';
      }
    });

    chip.appendChild(nameSpan);
    chip.appendChild(admitBtn);
    bannerList.appendChild(chip);
  }
}
