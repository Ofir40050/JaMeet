import { $, setText } from '../../../core/dom';

export interface SessionLockUiOptions {
  getRole: () => 'host' | 'guest';
  getIsLocked: () => boolean;
}

export function updateLockUi(options: SessionLockUiOptions): void {
  const btn = $('btn-lock-session');
  if (!btn) return;
  if (options.getRole() !== 'host') {
    btn.classList.add('hidden');
    return;
  }
  const locked = options.getIsLocked();
  btn.classList.remove('hidden');
  btn.classList.toggle('is-locked', locked);
  $('lock-icon-unlocked')?.classList.toggle('hidden', locked);
  $('lock-icon-locked')?.classList.toggle('hidden', !locked);
  setText('btn-lock-session-label', locked ? 'Locked' : 'Lock');
  btn.title = locked
    ? 'Unlock Session (Allow participants to join)'
    : 'Lock Session (Prevent new participants from joining)';
}
