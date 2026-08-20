export interface ProjectTabsUiOptions {
  onTabChange?: (tab: string) => void;
  onSelectOverview?: () => void;
}

let tabOptions: ProjectTabsUiOptions = {};
let isInitialized = false;

export function switchProjectTab(targetTab: string = 'overview'): void {
  const tabBtns = document.querySelectorAll<HTMLButtonElement>('.project-tab-btn');
  tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === targetTab));

  const panels = document.querySelectorAll<HTMLElement>('.project-tab-panel');
  panels.forEach((panel) => {
    if (!panel.closest('#project-song-studio-view')) {
      panel.classList.toggle('hidden', panel.id !== `project-panel-${targetTab}`);
    }
  });
}

export function initProjectTabsUi(options: ProjectTabsUiOptions = {}): void {
  tabOptions = options;
  if (isInitialized) return;
  isInitialized = true;

  document.querySelectorAll<HTMLButtonElement>('.project-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      if (!targetTab) return;
      switchProjectTab(targetTab);
      tabOptions.onTabChange?.(targetTab);
      if (targetTab === 'overview') {
        tabOptions.onSelectOverview?.();
      }
    });
  });
}
