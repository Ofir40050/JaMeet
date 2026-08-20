import { $ } from './dom';

let isProjectMenuOpen = false;
let isInitialized = false;

export function closeProjectMenu(): void {
  if (isProjectMenuOpen) {
    $('project-menu-dropdown')?.classList.add('hidden');
    isProjectMenuOpen = false;
  }
}

export function toggleProjectMenu(e?: Event): void {
  e?.stopPropagation();
  const dropdown = $('project-menu-dropdown');
  if (!dropdown) return;
  isProjectMenuOpen = !isProjectMenuOpen;
  dropdown.classList.toggle('hidden', !isProjectMenuOpen);
  if (isProjectMenuOpen) {
    const btn = $('btn-project-menu');
    if (btn) {
      const rect = btn.getBoundingClientRect();
      dropdown.style.top = `${rect.bottom + 6}px`;
      dropdown.style.right = `${window.innerWidth - rect.right}px`;
      dropdown.style.left = 'auto';
    }
  }
}

export function initProjectMenuUi(): void {
  if (isInitialized) return;
  isInitialized = true;

  $('btn-project-menu')?.addEventListener('click', (e) => {
    toggleProjectMenu(e);
  });

  document.addEventListener('click', () => {
    closeProjectMenu();
  });
}
