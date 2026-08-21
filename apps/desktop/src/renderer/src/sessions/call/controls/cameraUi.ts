import { icons } from '../../../core/icons';

export function updateCameraButtonUi(cameraEnabled: boolean): void {
  const camBtn = document.getElementById('camera-button');
  if (camBtn) camBtn.textContent = cameraEnabled ? 'Stop Camera' : 'Start Camera';

  const toggleCam = document.getElementById('toggle-camera');
  if (toggleCam) {
    toggleCam.classList.toggle('active', cameraEnabled);
    toggleCam.classList.toggle('muted', !cameraEnabled);
    toggleCam.innerHTML = `<span class="tool-icon">${cameraEnabled ? icons.video({ size: 18 }) : icons.videoOff({ size: 18 })}</span>`;
    toggleCam.title = cameraEnabled ? 'Stop Camera' : 'Start Camera';
  }
}
