import { $ } from '../../../core/dom';
import { icons } from '../../../core/icons';

export interface InviteLinkControllerOptions {
  getCurrentCode: () => string;
}

export function initInviteLinkController(options: InviteLinkControllerOptions): void {
  $('copy-invite')?.addEventListener('click', () => {
    const currentCode = options.getCurrentCode();
    if (!currentCode) return;
    const link = `jameet://join/${currentCode}`;
    const api = typeof window !== 'undefined' ? (window.jameet || window.musiczoom) : undefined;
    const setCopiedState = () => {
      const btn = $('copy-invite');
      if (btn) {
        const origHtml = btn.innerHTML;
        const origTitle = btn.title;
        btn.innerHTML = icons.check({ size: 13 });
        btn.title = 'Link copied to clipboard!';
        window.setTimeout(() => {
          btn.innerHTML = origHtml;
          btn.title = origTitle;
        }, 1800);
      }
    };
    void (api?.copyText ? api.copyText(link) : Promise.reject())
      .then(setCopiedState)
      .catch(() => {
        void navigator.clipboard?.writeText(link);
        setCopiedState();
      });
  });
}
