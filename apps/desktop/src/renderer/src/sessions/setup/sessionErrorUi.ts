import { $, setText } from '../../core/dom';
import { icons } from '../../core/icons';
import type { SessionErrorModalOptions } from './sessionErrorParser';

export function showSessionErrorModal(options: SessionErrorModalOptions): void {
  const modal = $('session-error-modal');
  if (!modal) return;

  setText('session-error-title', options.title);
  setText('session-error-message', options.message);

  const detailBox = $('session-error-detail-box');
  if (detailBox) {
    if (options.detail) {
      setText('session-error-detail-text', options.detail);
      detailBox.classList.remove('hidden');
    } else {
      detailBox.classList.add('hidden');
    }
  }

  const iconBadge = $('session-error-icon');
  if (iconBadge) {
    iconBadge.className = `modal-icon-badge ${
      options.type === 'warning'
        ? 'warning-icon-badge'
        : options.type === 'info'
          ? 'info-icon-badge'
          : 'error-icon-badge'
    }`;
    if (options.type === 'warning') {
      iconBadge.innerHTML = icons.alertTriangle({ size: 20 });
    } else if (options.type === 'info') {
      iconBadge.innerHTML = icons.info({ size: 20 });
    } else {
      iconBadge.innerHTML = icons.alertCircle({ size: 20 });
    }
  }

  const actionBtn = $('btn-session-error-action');
  const dismissBtn = $('btn-session-error-dismiss');
  const closeBtn = $('btn-close-session-error');

  if (dismissBtn) {
    dismissBtn.textContent = options.dismissLabel || 'Close';
    dismissBtn.onclick = () => modal.classList.add('hidden');
  }

  if (closeBtn) {
    closeBtn.onclick = () => modal.classList.add('hidden');
  }

  if (actionBtn) {
    if (options.actionLabel) {
      actionBtn.textContent = options.actionLabel;
      actionBtn.classList.remove('hidden');
      actionBtn.onclick = () => {
        modal.classList.add('hidden');
        options.onAction?.();
      };
    } else {
      actionBtn.classList.add('hidden');
    }
  }

  modal.classList.remove('hidden');
}
