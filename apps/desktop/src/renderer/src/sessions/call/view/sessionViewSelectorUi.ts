import { $ } from '../../../core/dom';

export interface SessionViewSelectorUiOptions {
  onToggleSessionViewMenu: (e: MouseEvent) => void;
  onCloseSessionViewMenu: () => void;
}

export function initSessionViewSelectorUi(options: SessionViewSelectorUiOptions): void {
  $('session-view-btn')?.addEventListener('click', (e) => {
    options.onToggleSessionViewMenu(e);
  });

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('#session-view-selector')) {
      options.onCloseSessionViewMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      options.onCloseSessionViewMenu();
    }
  });
}
