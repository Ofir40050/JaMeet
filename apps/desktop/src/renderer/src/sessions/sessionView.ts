import type { MediaMetadata, ParticipantIdentity } from '@jameet/shared';
import { icons } from '../core/icons';
import { escapeHtml } from '../core/htmlSecurity';

export type ParticipantViewMode = 'gallery' | 'speaker' | 'focus';
export type ScreenViewMode = 'screen' | 'side-by-side' | 'screen-focus';
export type ParticipantTarget = 'remote' | 'local';

export interface SessionViewState {
  screenTrack?: MediaStreamTrack;
  remoteMedia?: MediaMetadata;
  remoteVideoStream?: MediaStream;
  peerIdentity?: ParticipantIdentity | null;
  myIdentity?: ParticipantIdentity | null;
  sharingSourceTitle?: string;
}

let currentCameraViewMode: ParticipantViewMode = 'gallery';
let currentScreenViewMode: ScreenViewMode = 'screen';
let currentFocusTarget: ParticipantTarget = 'remote';
let currentActiveSpeaker: ParticipantTarget = 'remote';
let participantTileInteractionsBound = false;

let stateProvider: (() => SessionViewState) | null = null;

export function setSessionViewStateProvider(provider: () => SessionViewState): void {
  stateProvider = provider;
}

function getViewState(): SessionViewState {
  return stateProvider ? stateProvider() : {};
}

export function getCameraViewMode(): ParticipantViewMode {
  return currentCameraViewMode;
}

export function setCameraViewMode(mode: ParticipantViewMode): void {
  currentCameraViewMode = mode;
}

export function getScreenViewMode(): ScreenViewMode {
  return currentScreenViewMode;
}

export function setScreenViewMode(mode: ScreenViewMode): void {
  currentScreenViewMode = mode;
}

export function getFocusTarget(): ParticipantTarget {
  return currentFocusTarget;
}

export function setFocusTarget(target: ParticipantTarget): void {
  currentFocusTarget = target;
}

export function getActiveSpeaker(): ParticipantTarget {
  return currentActiveSpeaker;
}

export function setActiveSpeaker(speaker: ParticipantTarget): void {
  currentActiveSpeaker = speaker;
}

export function toggleSessionLayout(isAnySharing: boolean): void {
  if (isAnySharing) {
    if (currentScreenViewMode === 'screen') currentScreenViewMode = 'side-by-side';
    else if (currentScreenViewMode === 'side-by-side') currentScreenViewMode = 'screen-focus';
    else currentScreenViewMode = 'screen';
  } else {
    if (currentCameraViewMode === 'gallery') currentCameraViewMode = 'speaker';
    else if (currentCameraViewMode === 'speaker') currentCameraViewMode = 'focus';
    else currentCameraViewMode = 'gallery';
  }
  applyParticipantViewLayout();
}

export function applyParticipantViewLayout(): void {
  const workspace = document.getElementById('session-workspace');
  const videoGrid = document.getElementById('video-grid');
  const remoteTile = document.getElementById('remote-tile');
  const localTile = document.getElementById('local-tile');
  if (!workspace || !videoGrid || !remoteTile || !localTile) return;

  const state = getViewState();
  const isLocalSharing = Boolean(state.screenTrack);
  const isRemoteSharing = Boolean(state.remoteMedia?.sharingScreen && state.remoteVideoStream);
  const isAnySharing = isLocalSharing || isRemoteSharing;

  // Clean previous layout classes
  workspace.classList.remove(
    'view-gallery',
    'view-speaker',
    'view-focus',
    'screen-view-standard',
    'screen-view-side-by-side',
    'screen-view-focus'
  );
  videoGrid.classList.remove(
    'layout-gallery',
    'layout-speaker',
    'layout-focus',
    'dominant-remote',
    'dominant-local'
  );
  remoteTile.classList.remove('dominant-tile', 'secondary-tile');
  localTile.classList.remove('dominant-tile', 'secondary-tile');
  remoteTile.removeAttribute('title');
  localTile.removeAttribute('title');

  if (isAnySharing) {
    workspace.classList.add('stage-mode');
    if (currentScreenViewMode === 'side-by-side') {
      workspace.classList.add('screen-view-side-by-side');
    } else if (currentScreenViewMode === 'screen-focus') {
      workspace.classList.add('screen-view-focus');
    } else {
      workspace.classList.add('screen-view-standard');
    }
  } else {
    workspace.classList.remove('stage-mode');
    if (currentCameraViewMode === 'speaker') {
      workspace.classList.add('view-speaker');
      videoGrid.classList.add('layout-speaker');
      const dominant = currentActiveSpeaker;
      videoGrid.classList.add(dominant === 'remote' ? 'dominant-remote' : 'dominant-local');
      if (dominant === 'remote') {
        remoteTile.classList.add('dominant-tile');
        localTile.classList.add('secondary-tile');
        localTile.setAttribute('title', 'Click to switch focus to You');
      } else {
        localTile.classList.add('dominant-tile');
        remoteTile.classList.add('secondary-tile');
        remoteTile.setAttribute('title', `Click to switch focus to ${state.peerIdentity?.displayName || 'Musician'}`);
      }
    } else if (currentCameraViewMode === 'focus') {
      workspace.classList.add('view-focus');
      videoGrid.classList.add('layout-focus');
      const dominant = currentFocusTarget;
      videoGrid.classList.add(dominant === 'remote' ? 'dominant-remote' : 'dominant-local');
      if (dominant === 'remote') {
        remoteTile.classList.add('dominant-tile');
        localTile.classList.add('secondary-tile');
        localTile.setAttribute('title', 'Click to switch focus to You');
      } else {
        localTile.classList.add('dominant-tile');
        remoteTile.classList.add('secondary-tile');
        remoteTile.setAttribute('title', `Click to switch focus to ${state.peerIdentity?.displayName || 'Musician'}`);
      }
    } else {
      workspace.classList.add('view-gallery');
      videoGrid.classList.add('layout-gallery');
    }
  }

  setupParticipantTileInteractions();
  updateSessionViewButton();
  renderSessionViewMenu();
}

export function updateSessionViewButton(): void {
  const state = getViewState();
  const isLocalSharing = Boolean(state.screenTrack);
  const isRemoteSharing = Boolean(state.remoteMedia?.sharingScreen && state.remoteVideoStream);
  const isAnySharing = isLocalSharing || isRemoteSharing;

  const btn = document.getElementById('session-view-btn');
  const iconEl = document.getElementById('session-view-btn-icon');
  const labelEl = document.getElementById('session-view-btn-label');
  if (!btn || !iconEl) return;

  if (isAnySharing) {
    if (currentScreenViewMode === 'side-by-side') {
      iconEl.innerHTML = icons.sideBySide({ size: 18 });
      if (labelEl) labelEl.textContent = 'Side by Side';
      btn.title = 'Stage Layout: Side by Side View';
    } else if (currentScreenViewMode === 'screen-focus') {
      iconEl.innerHTML = icons.maximize({ size: 18 });
      if (labelEl) labelEl.textContent = 'Screen Focus';
      btn.title = 'Stage Layout: Screen Focus View';
    } else {
      iconEl.innerHTML = icons.monitor({ size: 18 });
      if (labelEl) labelEl.textContent = 'Screen View';
      btn.title = 'Stage Layout: Screen View';
    }
  } else {
    if (currentCameraViewMode === 'speaker') {
      iconEl.innerHTML = icons.layoutSpeaker({ size: 18 });
      if (labelEl) labelEl.textContent = 'Speaker';
      btn.title = 'Stage Layout: Speaker View';
    } else if (currentCameraViewMode === 'focus') {
      iconEl.innerHTML = icons.pin({ size: 18 });
      const targetName = currentFocusTarget === 'remote' ? (state.peerIdentity?.displayName || 'Musician') : 'You';
      if (labelEl) labelEl.textContent = `Focus: ${targetName}`;
      btn.title = `Stage Layout: Focus (${targetName})`;
    } else {
      iconEl.innerHTML = icons.layoutGrid({ size: 18 });
      if (labelEl) labelEl.textContent = 'Gallery';
      btn.title = 'Stage Layout: Gallery View';
    }
  }
}

export function renderSessionViewMenu(): void {
  const menu = document.getElementById('session-view-menu');
  if (!menu) return;

  const state = getViewState();
  const isLocalSharing = Boolean(state.screenTrack);
  const isRemoteSharing = Boolean(state.remoteMedia?.sharingScreen && state.remoteVideoStream);
  const isAnySharing = isLocalSharing || isRemoteSharing;

  const remoteName = state.peerIdentity?.displayName || 'Musician';
  const localName = state.myIdentity?.displayName || 'You';

  let html = '';

  if (isAnySharing) {
    html += `
      <div class="view-menu-section-header">SCREEN VIEW</div>
      <button type="button" class="view-menu-item ${currentScreenViewMode === 'screen' ? 'active' : ''}" data-screen-mode="screen">
        <span class="menu-item-icon">${icons.monitor({ size: 14 })}</span>
        <span class="menu-item-text">Screen View</span>
        ${currentScreenViewMode === 'screen' ? `<span class="menu-item-check">${icons.check({ size: 13 })}</span>` : ''}
      </button>
      <button type="button" class="view-menu-item ${currentScreenViewMode === 'side-by-side' ? 'active' : ''}" data-screen-mode="side-by-side">
        <span class="menu-item-icon">${icons.sideBySide({ size: 14 })}</span>
        <span class="menu-item-text">Side by Side View</span>
        ${currentScreenViewMode === 'side-by-side' ? `<span class="menu-item-check">${icons.check({ size: 13 })}</span>` : ''}
      </button>
      <button type="button" class="view-menu-item ${currentScreenViewMode === 'screen-focus' ? 'active' : ''}" data-screen-mode="screen-focus">
        <span class="menu-item-icon">${icons.maximize({ size: 14 })}</span>
        <span class="menu-item-text">Screen Focus View</span>
        ${currentScreenViewMode === 'screen-focus' ? `<span class="menu-item-check">${icons.check({ size: 13 })}</span>` : ''}
      </button>
      <div class="view-menu-divider"></div>
      <div class="view-menu-section-header">PARTICIPANT TILES</div>
    `;
  } else {
    html += `<div class="view-menu-section-header">STAGE VIEW</div>`;
  }

  html += `
    <button type="button" class="view-menu-item ${(!isAnySharing && currentCameraViewMode === 'gallery') ? 'active' : ''}" data-camera-mode="gallery">
      <span class="menu-item-icon">${icons.layoutGrid({ size: 14 })}</span>
      <span class="menu-item-text">Gallery View</span>
      ${(!isAnySharing && currentCameraViewMode === 'gallery') ? `<span class="menu-item-check">${icons.check({ size: 13 })}</span>` : ''}
    </button>
    <button type="button" class="view-menu-item ${(!isAnySharing && currentCameraViewMode === 'speaker') ? 'active' : ''}" data-camera-mode="speaker">
      <span class="menu-item-icon">${icons.layoutSpeaker({ size: 14 })}</span>
      <span class="menu-item-text">Speaker View</span>
      ${(!isAnySharing && currentCameraViewMode === 'speaker') ? `<span class="menu-item-check">${icons.check({ size: 13 })}</span>` : ''}
    </button>
    <div class="view-menu-divider"></div>
    <div class="view-menu-section-header">FOCUS PIN</div>
    <button type="button" class="view-menu-item ${(!isAnySharing && currentCameraViewMode === 'focus' && currentFocusTarget === 'remote') ? 'active' : ''}" data-camera-mode="focus" data-focus-target="remote">
      <span class="menu-item-icon">${icons.pin({ size: 14 })}</span>
      <span class="menu-item-text">Focus: ${escapeHtml(remoteName)}</span>
      ${(!isAnySharing && currentCameraViewMode === 'focus' && currentFocusTarget === 'remote') ? `<span class="menu-item-check">${icons.check({ size: 13 })}</span>` : ''}
    </button>
    <button type="button" class="view-menu-item ${(!isAnySharing && currentCameraViewMode === 'focus' && currentFocusTarget === 'local') ? 'active' : ''}" data-camera-mode="focus" data-focus-target="local">
      <span class="menu-item-icon">${icons.pin({ size: 14 })}</span>
      <span class="menu-item-text">Focus: ${escapeHtml(localName)}</span>
      ${(!isAnySharing && currentCameraViewMode === 'focus' && currentFocusTarget === 'local') ? `<span class="menu-item-check">${icons.check({ size: 13 })}</span>` : ''}
    </button>
  `;

  menu.innerHTML = html;

  menu.querySelectorAll<HTMLButtonElement>('.view-menu-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const screenMode = item.getAttribute('data-screen-mode') as ScreenViewMode | null;
      const cameraMode = item.getAttribute('data-camera-mode') as ParticipantViewMode | null;
      const focusTarget = item.getAttribute('data-focus-target') as ParticipantTarget | null;

      if (screenMode) {
        currentScreenViewMode = screenMode;
      }
      if (cameraMode) {
        currentCameraViewMode = cameraMode;
        if (focusTarget) {
          currentFocusTarget = focusTarget;
        }
      }
      applyParticipantViewLayout();
      closeSessionViewMenu();
    });
  });
}

export function toggleSessionViewMenu(e?: Event): void {
  e?.stopPropagation();
  const menu = document.getElementById('session-view-menu');
  const btn = document.getElementById('session-view-btn');
  if (!menu || !btn) return;

  const isHidden = menu.classList.contains('hidden');
  if (isHidden) {
    renderSessionViewMenu();
    menu.classList.remove('hidden');
    btn.classList.add('active');
    btn.setAttribute('aria-expanded', 'true');
  } else {
    menu.classList.add('hidden');
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
  }
}

export function closeSessionViewMenu(): void {
  const menu = document.getElementById('session-view-menu');
  const btn = document.getElementById('session-view-btn');
  if (menu) menu.classList.add('hidden');
  if (btn) {
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
  }
}

export function setupParticipantTileInteractions(): void {
  if (participantTileInteractionsBound) return;
  participantTileInteractionsBound = true;

  const remoteTile = document.getElementById('remote-tile');
  const localTile = document.getElementById('local-tile');

  remoteTile?.addEventListener('click', () => {
    if (remoteTile.classList.contains('secondary-tile')) {
      if (currentCameraViewMode === 'focus') {
        currentFocusTarget = 'remote';
        applyParticipantViewLayout();
      } else if (currentCameraViewMode === 'speaker') {
        currentCameraViewMode = 'focus';
        currentFocusTarget = 'remote';
        applyParticipantViewLayout();
      }
    }
  });

  localTile?.addEventListener('click', () => {
    if (localTile.classList.contains('secondary-tile')) {
      if (currentCameraViewMode === 'focus') {
        currentFocusTarget = 'local';
        applyParticipantViewLayout();
      } else if (currentCameraViewMode === 'speaker') {
        currentCameraViewMode = 'focus';
        currentFocusTarget = 'local';
        applyParticipantViewLayout();
      }
    }
  });
}

export function updateSessionStage(): void {
  const workspace = document.getElementById('session-workspace');
  const stageTile = document.getElementById('stage-tile');
  const stageVideo = document.getElementById('stage-video') as HTMLVideoElement | null;
  const stageStopBtn = document.getElementById('stage-stop-share-btn');
  const stageTitle = document.getElementById('stage-title-text');
  if (!workspace || !stageTile || !stageVideo) return;

  const state = getViewState();
  const isLocalSharing = Boolean(state.screenTrack);
  const isRemoteSharing = Boolean(state.remoteMedia?.sharingScreen && state.remoteVideoStream);
  const isAnySharing = isLocalSharing || isRemoteSharing;

  stageTile.classList.toggle('hidden', !isAnySharing);

  if (isLocalSharing && state.screenTrack) {
    const screenStream = new MediaStream([state.screenTrack]);
    stageVideo.classList.remove('hidden');
    if (stageVideo.srcObject !== screenStream) stageVideo.srcObject = screenStream;
    if (stageVideo.paused) stageVideo.play().catch(() => {});
    if (stageTitle) stageTitle.textContent = state.sharingSourceTitle ? `Sharing: ${state.sharingSourceTitle}` : 'Sharing Screen';
    if (stageStopBtn) stageStopBtn.classList.remove('hidden');
  } else if (isRemoteSharing && state.remoteVideoStream) {
    stageVideo.classList.remove('hidden');
    if (stageVideo.srcObject !== state.remoteVideoStream) stageVideo.srcObject = state.remoteVideoStream;
    if (stageVideo.paused) stageVideo.play().catch(() => {});
    if (stageTitle) stageTitle.textContent = 'Musician is sharing Screen / DAW';
    if (stageStopBtn) stageStopBtn.classList.add('hidden');
  } else {
    stageVideo.srcObject = null;
    stageVideo.classList.remove('hidden');
  }

  applyParticipantViewLayout();
}
