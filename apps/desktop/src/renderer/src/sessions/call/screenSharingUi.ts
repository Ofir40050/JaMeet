import { icons } from '../../core/icons';

export interface ScreenSharingUiOptions {
  getCurrentSharingSourceTitle: () => string;
}

export function updateScreenSharingUi(active: boolean, options: ScreenSharingUiOptions): void {
  const toggleBtn = document.getElementById('toggle-screen');
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', active);
    toggleBtn.innerHTML = `<span class="tool-icon">${active ? icons.stopSquare({ size: 18 }) : icons.monitor({ size: 18 })}</span>`;
    toggleBtn.title = active ? 'Stop Sharing Screen' : 'Share Screen';
  }
  const shareOverlay = document.getElementById('local-share-overlay');
  if (shareOverlay) {
    shareOverlay.classList.toggle('hidden', !active);
    const titleEl = document.getElementById('local-share-title');
    const sourceTitle = options.getCurrentSharingSourceTitle();
    if (titleEl) titleEl.textContent = sourceTitle ? `Sharing: ${sourceTitle}` : 'Sharing Screen';
  }
  const localTile = document.querySelector('.video-tile.local-tile');
  if (localTile) {
    localTile.classList.toggle('sharing-screen', active);
  }
  const camBtn = document.getElementById('toggle-camera') as HTMLButtonElement | null;
  if (camBtn) camBtn.disabled = active;
  const callCamSel = document.getElementById('call-camera-select') as HTMLSelectElement | null;
  if (callCamSel) callCamSel.disabled = active;
}
