import type { MediaMetadata, ParticipantIdentity } from '@jameet/shared';

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

let stateProvider: (() => SessionViewState) | null = null;

export function setSessionViewStateProvider(provider: () => SessionViewState): void {
  stateProvider = provider;
}

export function getViewState(): SessionViewState {
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

export function rotateLayoutMode(isAnySharing: boolean): void {
  if (isAnySharing) {
    if (currentScreenViewMode === 'screen') currentScreenViewMode = 'side-by-side';
    else if (currentScreenViewMode === 'side-by-side') currentScreenViewMode = 'screen-focus';
    else currentScreenViewMode = 'screen';
  } else {
    if (currentCameraViewMode === 'gallery') currentCameraViewMode = 'speaker';
    else if (currentCameraViewMode === 'speaker') currentCameraViewMode = 'focus';
    else currentCameraViewMode = 'gallery';
  }
}
