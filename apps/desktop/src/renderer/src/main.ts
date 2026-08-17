import type { AudioMode, MediaMetadata, MeetingAck, PerformanceMode, VideoQuality, ParticipantIdentity, UserProfile, UpdateProfileRequest, Project, ProjectSessionItem, SessionHistoryItem, ProjectTaskItem, ProjectTaskStatus, ProjectActivityItem, ProjectActivityType, SessionChatMessage, WaitingParticipantItem, ScheduledSession } from '@jameet/shared';
import * as projectsApi from './projects';
import {
  setScheduledApiBase,
  fetchScheduledSessions,
  createScheduledSession,
  updateScheduledSession,
  deleteScheduledSession
} from './scheduledApi';
import { ScheduledNotificationManager } from './scheduledNotifications';
import { meetingCodeSchema, normalizeMeetingCode } from '@jameet/shared';
import { audioLimitations } from './audioProfiles';
import { LocalAudioSourceManager } from './audioSources';
import { LevelMeter, type LevelReading } from './levelMeter';
import { SignalingClient } from './signaling';
import { AuthManager } from './auth';
import { WebRtcSession } from './webrtc';
import { cameraConstraints, performanceVideoQuality } from './videoQuality';
import { icons } from './icons';
import { presenter } from './presenter';
import { escapeHtml, sanitizeLyricsHtml, safeAvatarColor, findSectionCard, findTimelineBlocks, findTimelineBlock } from './htmlSecurity';
import { initActivityHistory, renderProjectActivities } from './activity';
import { initSessionChat, resetChatUi } from './chat';
import { startRemoteVoiceBridge, stopRemoteVoiceBridge } from './remoteVoiceBridge';
import { logger } from './logger';
import './style.css';

export { escapeHtml, sanitizeLyricsHtml, safeAvatarColor };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const views = ['home-view', 'project-view', 'all-sessions-view', 'auth-view', 'setup-view', 'waiting-view', 'call-view'] as const;
const DEFAULT_PROD_SIGNALING_URL = 'https://jameet-jwi8.onrender.com';
const DEFAULT_DEV_SIGNALING_URL = 'http://localhost:3000';
const signalingUrl = (
  import.meta.env.VITE_SIGNALING_URL ||
  (import.meta.env.PROD ? DEFAULT_PROD_SIGNALING_URL : DEFAULT_DEV_SIGNALING_URL)
).replace(/\/+$/, '');
projectsApi.setApiBase(signalingUrl);
setScheduledApiBase(signalingUrl);
const scheduledNotifications = new ScheduledNotificationManager();
scheduledNotifications.onSessionClick((sessionId) => {
  const callView = $('call-view');
  if (callView?.classList.contains('active')) return;
  showView('home-view');
  const sessionItem = document.querySelector<HTMLElement>(`.scheduled-session-item[data-session-id="${sessionId}"]`);
  if (sessionItem) {
    sessionItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    sessionItem.classList.add('is-highlighted');
    setTimeout(() => {
      sessionItem.classList.remove('is-highlighted');
    }, 2500);
  } else {
    const section = $('scheduled-sessions-section');
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});
const participantId = sessionStorage.getItem('jameet-participant') ?? sessionStorage.getItem('musiczoom-participant') ?? crypto.randomUUID();
sessionStorage.setItem('jameet-participant', participantId);

logger.initGlobalErrorHandling();
logger.info('renderer_startup', 'JaMeet renderer application initialized', { participantId });

const auth = new AuthManager(signalingUrl);
let myIdentity: ParticipantIdentity | null = null;
let peerIdentity: ParticipantIdentity | null = null;
let hostIdentity: ParticipantIdentity | null = null;
let peerParticipantId: string | null = null;
let isSessionLocked = false;

export type VoiceInputConfig = {
  id: number;
  name?: string;
  deviceId?: string;
  channelRoute: string;
  gain: number;
  enabled: boolean;
};

type Preferences = {
  cameraId?: string;
  audioInputId?: string;
  voiceChannel?: string;
  voiceInputs: VoiceInputConfig[];
  musicSourceType: 'app' | 'interface' | 'system' | 'none';
  musicAppPid?: number;
  musicAppName?: string;
  musicInputId?: string;
  musicChannel?: string;
  audioOutputId?: string;
  outputChannel?: string;
  outputVolume?: number;
  mode: AudioMode;
  cameraQuality: VideoQuality;
  receiveQuality: VideoQuality;
  performanceMode: PerformanceMode;
  stereoMusic: boolean;
  sampleRate?: number;
  inputGain: number;
  musicBitrate: number;
  audioOnly: boolean;
};
type PendingAction = { type: 'create' } | { type: 'join'; code: string };

let prefs: Preferences = readPreferences();
let pending: PendingAction | undefined;
let currentCode = '';
let currentRole: 'host' | 'guest' = 'guest';
let currentIceServers: RTCIceServer[] = [];
let videoTrack: MediaStreamTrack | undefined;
let screenTrack: MediaStreamTrack | undefined;
let muted = false;
let cameraEnabled = !prefs.audioOnly;
let audioOnly = prefs.audioOnly;
let inCall = false;
let pendingPeerMedia: MediaMetadata | undefined;
let activeProjectId: string | undefined;
let sessionProjectId: string | undefined;
let activeProject: Project | undefined;
let projectsList: Project[] = [];
let remoteMedia: MediaMetadata | undefined;
let remoteVideoStream: MediaStream | undefined;
let remoteMuted = false;
const remoteAudioTracks = new Map<string, { purpose: 'voice' | 'music'; track: MediaStreamTrack }>();

const audio = new LocalAudioSourceManager();
const voiceMeters = new Map<number, LevelMeter>();
const activeMicLevels = new Map<number, number>();
const musicMeter = new LevelMeter();
const signaling = new SignalingClient(signalingUrl);
const rtc = new WebRtcSession(signaling, audio, setRemoteStream, setRemoteAudio, handleRemoteMedia, (status) => setCallStatus(status));

type ParticipantViewMode = 'gallery' | 'speaker' | 'focus';
type ScreenViewMode = 'screen' | 'side-by-side' | 'screen-focus';
type ParticipantTarget = 'remote' | 'local';

let currentCameraViewMode: ParticipantViewMode = 'gallery';
let currentScreenViewMode: ScreenViewMode = 'screen';
let currentFocusTarget: ParticipantTarget = 'remote';
let currentActiveSpeaker: ParticipantTarget = 'remote';
let remoteVoiceMeter: LevelMeter | undefined = undefined;
let lastLocalVoiceDb = -60;
let lastRemoteVoiceDb = -60;
let lastSpeakerSwitchTime = 0;
const SPEAKER_SWITCH_HOLD_MS = 1200;

function readPreferences(): Preferences {
  try {
    const raw = JSON.parse(localStorage.getItem('jameet-preferences') ?? localStorage.getItem('musiczoom-preferences') ?? '{}');
    let voiceInputs: VoiceInputConfig[] = Array.isArray(raw.voiceInputs) && raw.voiceInputs.length > 0
      ? raw.voiceInputs
      : [
          {
            id: 1,
            name: 'Microphone 1 (Primary · Lead)',
            deviceId: raw.audioInputId,
            channelRoute: raw.voiceChannel ?? '1',
            gain: typeof raw.inputGain === 'number' ? raw.inputGain : 1,
            enabled: true
          }
        ];

    if (raw.voice2Enabled && raw.audioInput2Id && !voiceInputs.some((v) => v.id === 2)) {
      voiceInputs.push({
        id: 2,
        name: 'Microphone 2 (Guest / Singer 2)',
        deviceId: raw.audioInput2Id,
        channelRoute: raw.voice2Channel ?? '2',
        gain: typeof raw.inputGain2 === 'number' ? raw.inputGain2 : 1,
        enabled: true
      });
    }

    return {
      mode: raw.mode === 'talk' ? 'talk' : 'music',
      cameraQuality: raw.cameraQuality || 'standard',
      receiveQuality: raw.receiveQuality || 'standard',
      performanceMode: raw.performanceMode || 'balanced',
      stereoMusic: raw.stereoMusic !== undefined ? Boolean(raw.stereoMusic) : true,
      sampleRate: raw.sampleRate ? Number(raw.sampleRate) : 44_100,
      inputGain: voiceInputs[0]?.gain ?? 1,
      outputVolume: typeof raw.outputVolume === 'number' ? raw.outputVolume : 1,
      musicBitrate: typeof raw.musicBitrate === 'number' ? raw.musicBitrate : 256_000,
      audioOnly: Boolean(raw.audioOnly),
      cameraId: raw.cameraId,
      audioInputId: voiceInputs[0]?.deviceId,
      voiceChannel: voiceInputs[0]?.channelRoute ?? '1',
      voiceInputs,
      musicSourceType: raw.musicSourceType || 'app',
      musicAppPid: typeof raw.musicAppPid === 'number' ? raw.musicAppPid : undefined,
      musicAppName: raw.musicAppName,
      musicInputId: raw.musicInputId,
      musicChannel: raw.musicChannel ?? '1-2',
      audioOutputId: raw.audioOutputId,
      outputChannel: raw.outputChannel ?? '1-2'
    };
  } catch {
    return {
      mode: 'music',
      cameraQuality: 'standard',
      receiveQuality: 'standard',
      performanceMode: 'balanced',
      stereoMusic: true,
      sampleRate: 44_100,
      inputGain: 1,
      musicBitrate: 256_000,
      audioOnly: false,
      voiceInputs: [
        { id: 1, name: 'Microphone 1 (Primary · Lead)', channelRoute: '1', gain: 1, enabled: true }
      ],
      musicSourceType: 'app'
    };
  }
}
function savePreferences(): void {
  const json = JSON.stringify(prefs);
  localStorage.setItem('jameet-preferences', json);
}
function showView(id: string): void {
  for (const view of views) $(view)?.classList.toggle('hidden', view !== id);
  updateLocalPreviews();
}
function setText(id: string, text: string): void {
  const node = $(id);
  if (node) node.textContent = text;
}
function setMessage(id: string, message: string, error = false): void { const node = $(id); if (node) { node.textContent = message; node.classList.toggle('error', error); } }
function setBusy(busy: boolean): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('#create-button, #join-button, #enter-session');
  for (const button of buttons) button.disabled = busy;
}
function metadata(): MediaMetadata {
  return {
    audioSources: audio.metadata(),
    cameraEnabled,
    outgoingVideoQuality: effectiveVideoQuality(prefs.cameraQuality),
    preferredReceiveVideoQuality: effectiveVideoQuality(prefs.receiveQuality),
    sharingScreen: Boolean(screenTrack),
    audioOnly,
    performanceMode: prefs.performanceMode
  };
}
function effectiveVideoQuality(selected: VideoQuality): VideoQuality {
  return performanceVideoQuality(selected, prefs.performanceMode);
}
function currentStream(): MediaStream {
  const visibleTrack = screenTrack ?? (cameraEnabled ? videoTrack : undefined);
  return new MediaStream(visibleTrack ? [visibleTrack] : []);
}

function applyParticipantViewLayout(): void {
  const workspace = document.getElementById('session-workspace');
  const videoGrid = document.getElementById('video-grid');
  const remoteTile = document.getElementById('remote-tile');
  const localTile = document.getElementById('local-tile');
  if (!workspace || !videoGrid || !remoteTile || !localTile) return;

  const isLocalSharing = Boolean(screenTrack);
  const isRemoteSharing = Boolean(remoteMedia?.sharingScreen && remoteVideoStream);
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
        remoteTile.setAttribute('title', `Click to switch focus to ${peerIdentity?.displayName || 'Musician'}`);
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
        remoteTile.setAttribute('title', `Click to switch focus to ${peerIdentity?.displayName || 'Musician'}`);
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

function updateSessionViewButton(): void {
  const isLocalSharing = Boolean(screenTrack);
  const isRemoteSharing = Boolean(remoteMedia?.sharingScreen && remoteVideoStream);
  const isAnySharing = isLocalSharing || isRemoteSharing;

  const btn = document.getElementById('session-view-btn');
  const iconEl = document.getElementById('session-view-btn-icon');
  const labelEl = document.getElementById('session-view-btn-label');
  if (!btn || !iconEl || !labelEl) return;

  if (isAnySharing) {
    if (currentScreenViewMode === 'side-by-side') {
      iconEl.innerHTML = icons.sideBySide({ size: 13 });
      labelEl.textContent = 'Side by Side';
    } else if (currentScreenViewMode === 'screen-focus') {
      iconEl.innerHTML = icons.maximize({ size: 13 });
      labelEl.textContent = 'Screen Focus';
    } else {
      iconEl.innerHTML = icons.monitor({ size: 13 });
      labelEl.textContent = 'Screen View';
    }
  } else {
    if (currentCameraViewMode === 'speaker') {
      iconEl.innerHTML = icons.layoutSpeaker({ size: 13 });
      labelEl.textContent = 'Speaker';
    } else if (currentCameraViewMode === 'focus') {
      iconEl.innerHTML = icons.pin({ size: 13 });
      const targetName = currentFocusTarget === 'remote' ? (peerIdentity?.displayName || 'Musician') : 'You';
      labelEl.textContent = `Focus: ${targetName}`;
    } else {
      iconEl.innerHTML = icons.layoutGrid({ size: 13 });
      labelEl.textContent = 'Gallery';
    }
  }
}

function renderSessionViewMenu(): void {
  const menu = document.getElementById('session-view-menu');
  if (!menu) return;

  const isLocalSharing = Boolean(screenTrack);
  const isRemoteSharing = Boolean(remoteMedia?.sharingScreen && remoteVideoStream);
  const isAnySharing = isLocalSharing || isRemoteSharing;

  const remoteName = peerIdentity?.displayName || 'Musician';
  const localName = myIdentity?.displayName || 'You';

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

function toggleSessionViewMenu(e?: Event): void {
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

function closeSessionViewMenu(): void {
  const menu = document.getElementById('session-view-menu');
  const btn = document.getElementById('session-view-btn');
  if (menu) menu.classList.add('hidden');
  if (btn) {
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
  }
}

function checkActiveSpeaker(): void {
  const VOICE_THRESHOLD_DB = -46;
  const now = performance.now();

  const isLocalSpeaking = (!muted) && lastLocalVoiceDb > VOICE_THRESHOLD_DB;
  const isRemoteSpeaking = (!remoteMuted) && lastRemoteVoiceDb > VOICE_THRESHOLD_DB;

  $('remote-tile')?.classList.toggle('is-speaking', isRemoteSpeaking);
  $('local-tile')?.classList.toggle('is-speaking', isLocalSpeaking);

  let newSpeaker: ParticipantTarget | null = null;
  if (isRemoteSpeaking && (!isLocalSpeaking || lastRemoteVoiceDb > lastLocalVoiceDb + 2)) {
    newSpeaker = 'remote';
  } else if (isLocalSpeaking && (!isRemoteSpeaking || lastLocalVoiceDb > lastRemoteVoiceDb + 2)) {
    newSpeaker = 'local';
  }

  if (newSpeaker && newSpeaker !== currentActiveSpeaker) {
    if (now - lastSpeakerSwitchTime > SPEAKER_SWITCH_HOLD_MS) {
      currentActiveSpeaker = newSpeaker;
      lastSpeakerSwitchTime = now;
      if (currentCameraViewMode === 'speaker') {
        applyParticipantViewLayout();
      }
    }
  }
}

let participantTileInteractionsBound = false;
function setupParticipantTileInteractions(): void {
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

function updateSessionStage(): void {
  const workspace = document.getElementById('session-workspace');
  const stageTile = document.getElementById('stage-tile');
  const stageVideo = document.getElementById('stage-video') as HTMLVideoElement | null;
  const stageStopBtn = document.getElementById('stage-stop-share-btn');
  const stageTitle = document.getElementById('stage-title-text');
  if (!workspace || !stageTile || !stageVideo) return;

  const isLocalSharing = Boolean(screenTrack);
  const isRemoteSharing = Boolean(remoteMedia?.sharingScreen && remoteVideoStream);
  const isAnySharing = isLocalSharing || isRemoteSharing;

  stageTile.classList.toggle('hidden', !isAnySharing);

  if (isLocalSharing && screenTrack) {
    const screenStream = new MediaStream([screenTrack]);
    stageVideo.classList.remove('hidden');
    if (stageVideo.srcObject !== screenStream) stageVideo.srcObject = screenStream;
    if (stageVideo.paused) stageVideo.play().catch(() => {});
    if (stageTitle) stageTitle.textContent = currentSharingSourceTitle ? `Sharing: ${currentSharingSourceTitle}` : 'Sharing Screen';
    if (stageStopBtn) stageStopBtn.classList.remove('hidden');
  } else if (isRemoteSharing && remoteVideoStream) {
    stageVideo.classList.remove('hidden');
    if (stageVideo.srcObject !== remoteVideoStream) stageVideo.srcObject = remoteVideoStream;
    if (stageVideo.paused) stageVideo.play().catch(() => {});
    if (stageTitle) stageTitle.textContent = 'Musician is sharing Screen / DAW';
    if (stageStopBtn) stageStopBtn.classList.add('hidden');
  } else {
    stageVideo.srcObject = null;
    stageVideo.classList.remove('hidden');
  }

  applyParticipantViewLayout();
}

function updateLocalPreviews(): void {
  const setupVisible = !$('setup-view')?.classList.contains('hidden');
  const callVisible = !$('call-view')?.classList.contains('hidden');
  const setupVideo = $<HTMLVideoElement>('setup-video');
  const localVideo = $<HTMLVideoElement>('local-video');
  
  if (setupVisible && setupVideo) {
    const stream = currentStream();
    if (setupVideo.srcObject !== stream) setupVideo.srcObject = stream;
    if (stream && setupVideo.paused) {
      setupVideo.play().catch(() => {});
    }
  }
  if (callVisible && localVideo) {
    const camStream = (cameraEnabled && videoTrack) ? new MediaStream([videoTrack]) : null;
    if (localVideo.srcObject !== camStream) localVideo.srcObject = camStream;
    if (camStream && localVideo.paused) {
      localVideo.play().catch(() => {});
    }
    localVideo.classList.toggle('mirror', true);
  }
  
  const isVideoLive = Boolean(videoTrack && cameraEnabled);
  $('setup-video-placeholder')?.classList.toggle('hidden', isVideoLive);
  $('local-placeholder')?.classList.toggle('hidden', isVideoLive);
  const modeLabel = $('mode-label');
  if (modeLabel) modeLabel.textContent = prefs.mode === 'music' ? 'Music Mode' : 'Talk Mode';

  updateSessionStage();
}

async function acquireVideo(deviceId?: string): Promise<MediaStreamTrack> {
  let stream: MediaStream | undefined;
  if (deviceId) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: cameraConstraints(effectiveVideoQuality(prefs.cameraQuality), deviceId),
        audio: false
      });
    } catch {
      // Fall through to generic camera constraints
    }
  }
  if (!stream) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: cameraConstraints(effectiveVideoQuality(prefs.cameraQuality), undefined),
        audio: false
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
  }
  const next = stream.getVideoTracks()[0];
  if (!next) throw new Error('The selected camera did not provide video.');
  next.enabled = cameraEnabled;
  return next;
}

async function replaceCamera(deviceId?: string): Promise<void> {
  if (screenTrack) throw new Error('Stop screen sharing before changing the camera.');
  const next = await acquireVideo(deviceId);
  try { if (inCall) await rtc.replaceVideoTrack(next); }
  catch (error) { next.stop(); throw error; }
  videoTrack?.stop();
  videoTrack = next;
  rtc.setVideoTrack(next);
  prefs.cameraId = deviceId;
  savePreferences();
  updateCameraButtonState();
  updateLocalPreviews();
}

async function syncAllVoiceMics(mode = prefs.mode): Promise<void> {
  const activeIds = new Set(prefs.voiceInputs.filter((v) => v.enabled).map((v) => v.id));

  for (const id of Array.from(voiceMeters.keys())) {
    if (!activeIds.has(id)) {
      const m = voiceMeters.get(id);
      if (m) await m.stop();
      voiceMeters.delete(id);
      activeMicLevels.delete(id);
      await audio.removeVoiceMic(id);
    }
  }

  for (const mic of prefs.voiceInputs) {
    if (!mic.enabled) continue;
    try {
      await audio.acquireVoiceMic(mic.id, mic.deviceId, mode, {
        sampleRate: prefs.sampleRate ?? 44_100,
        inputGain: mic.gain ?? 1,
        stereo: prefs.stereoMusic !== false,
        channelRoute: mic.channelRoute ?? '1'
      });
      const node = audio.getVoiceMicNode(mic.id);
      if (node) {
        const m = getOrCreateVoiceMeter(mic.id);
        await m.startFromNode(node, meterInterval(), (reading) => renderVoiceLevel(mic.id, reading));
      } else {
        const track = audio.getVoiceRawTrack(mic.id);
        if (track) {
          const m = getOrCreateVoiceMeter(mic.id);
          await m.start(track, (reading) => renderVoiceLevel(mic.id, reading), meterInterval());
        }
      }
    } catch (error) {
      logger.warn('audio_init_failure', `Failed to acquire microphone ${mic.id}`, { micId: mic.id, deviceId: mic.deviceId, sampleRate: prefs.sampleRate }, error);
      console.warn(`Failed to acquire microphone ${mic.id}:`, error);
    }
  }

  renderAudioLimitations();
  updateLocalPreviews();
  if (inCall) {
    signaling.updateMedia(currentCode, metadata());
    await rtc.audioChanged(mode);
    updateCallMode();
  }
}

async function replaceAudioInput(deviceId: string | undefined, mode = prefs.mode): Promise<void> {
  if (prefs.voiceInputs.length === 0) {
    prefs.voiceInputs.push({ id: 1, name: 'Microphone 1 (Primary · Lead)', deviceId, channelRoute: '1', gain: 1, enabled: true });
  } else {
    prefs.voiceInputs[0]!.deviceId = deviceId;
  }
  prefs.audioInputId = deviceId;
  prefs.mode = mode;
  savePreferences();
  await syncAllVoiceMics(mode);
}
function meterInterval(): number { return prefs.performanceMode === 'low' ? 125 : prefs.performanceMode === 'quality' ? 40 : 66; }
function effectiveMusicBitrate(): number {
  const cap: Record<PerformanceMode, number> = { low: 192_000, balanced: 384_000, quality: 510_000 };
  return Math.min(prefs.musicBitrate, cap[prefs.performanceMode]);
}

let cachedRunningApps: Array<{ pid: number; name: string; bundleId: string; isDaw: boolean; category?: string; iconDataUrl?: string }> = [];

function updateAppIconBadge(pid: number | undefined): void {
  const app = cachedRunningApps.find((a) => a.pid === pid);
  for (const prefix of ['', 'call-']) {
    const wrap = document.getElementById(`${prefix}music-app-icon-wrap`);
    const img = document.getElementById(`${prefix}music-app-icon`) as HTMLImageElement | null;
    if (wrap && img) {
      if (app?.iconDataUrl) {
        img.src = app.iconDataUrl;
        wrap.classList.remove('hidden');
      } else {
        img.removeAttribute('src');
        wrap.classList.add('hidden');
      }
    }
  }
}

async function refreshRunningApps(): Promise<void> {
  const desktopApi = typeof window !== 'undefined' ? (window.jameet || window.musiczoom) : undefined;
  if (desktopApi?.listAudioApplications) {
    cachedRunningApps = await desktopApi.listAudioApplications().catch(() => []);
  }

  for (const id of ['music-app-select', 'call-music-app-select']) {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (!select) continue;
    select.replaceChildren();

    if (!cachedRunningApps.length) {
      select.add(new Option('No running audio apps found', ''));
      continue;
    }

    const musicGroup = document.createElement('optgroup');
    musicGroup.label = 'DAWs & Music Apps';
    const mediaGroup = document.createElement('optgroup');
    mediaGroup.label = 'Browsers & Media Players';
    const otherGroup = document.createElement('optgroup');
    otherGroup.label = 'Other Applications';

    for (const app of cachedRunningApps) {
      // Clean application name only: NO PID! NO internal process identifiers!
      const opt = new Option(app.name, String(app.pid));

      if (app.category === 'music' || app.isDaw) {
        musicGroup.appendChild(opt);
      } else if (app.category === 'media') {
        mediaGroup.appendChild(opt);
      } else {
        otherGroup.appendChild(opt);
      }
    }

    if (musicGroup.childElementCount > 0) select.appendChild(musicGroup);
    if (mediaGroup.childElementCount > 0) select.appendChild(mediaGroup);
    if (otherGroup.childElementCount > 0) select.appendChild(otherGroup);

    if (prefs.musicAppPid && cachedRunningApps.some((a) => a.pid === prefs.musicAppPid)) {
      select.value = String(prefs.musicAppPid);
    } else {
      const defaultApp = cachedRunningApps.find((a) => a.isDaw || a.category === 'music') ||
                         cachedRunningApps.find((a) => a.category === 'media') ||
                         cachedRunningApps[0];
      if (defaultApp) {
        select.value = String(defaultApp.pid);
        prefs.musicAppPid = defaultApp.pid;
        prefs.musicAppName = defaultApp.name;
      }
    }
  }

  updateAppIconBadge(prefs.musicAppPid);
}

async function replaceMusicInput(): Promise<void> {
  const type = prefs.musicSourceType;
  if (type === 'none') {
    await musicMeter.stop();
    await audio.remove('music');
    $('music-in-indicator')?.classList.remove('active');
  } else if (type === 'app') {
    const pid = prefs.musicAppPid;
    if (pid) {
      try {
        const source = await audio.acquireMusicFromApp(pid, prefs.musicAppName || 'Application');
        const musicNode = audio.getMusicNode();
        if (musicNode) {
          await musicMeter.startFromNode(musicNode, meterInterval(), renderMusicLevel);
        } else {
          await musicMeter.start(source.track, renderMusicLevel, meterInterval());
        }
        for (const statusId of ['music-app-status', 'call-music-app-status']) {
          const el = document.getElementById(statusId);
          if (el) el.textContent = `Capturing ${prefs.musicAppName || 'App'} · Stereo 48 kHz (Native)`;
        }
      } catch (err) {
        logger.warn('audio_init_failure', 'Failed to acquire application audio output', { type: 'app', pid, appName: prefs.musicAppName }, err);
        await musicMeter.stop();
        await audio.remove('music');
        for (const statusId of ['music-app-status', 'call-music-app-status']) {
          const el = document.getElementById(statusId);
          if (el) el.textContent = `Waiting for application audio output`;
        }
      }
    } else {
      await musicMeter.stop();
      await audio.remove('music');
    }
  } else if (type === 'system') {
    try {
      const source = await audio.acquireMusicFromApp('global', 'Computer Audio');
      const musicNode = audio.getMusicNode();
      if (musicNode) {
        await musicMeter.startFromNode(musicNode, meterInterval(), renderMusicLevel);
      } else {
        await musicMeter.start(source.track, renderMusicLevel, meterInterval());
      }
    } catch (err) {
      logger.warn('audio_init_failure', 'Failed to acquire system computer audio', { type: 'system' }, err);
      await musicMeter.stop();
      await audio.remove('music');
      $('music-in-indicator')?.classList.remove('active');
    }
  } else if (type === 'interface') {
    const selectedDeviceId = prefs.musicInputId || prefs.audioOutputId || 'default';
    const hw = cachedHardwareDevices.find((d) => d.uid === selectedDeviceId) ||
               cachedHardwareDevices.find((d) => selectedDeviceId && d.uid.includes(selectedDeviceId)) ||
               cachedHardwareDevices.find((d) => d.defaultOutput) ||
               cachedHardwareDevices[0];
    const targetUID = hw?.uid || selectedDeviceId;
    try {
      const source = await audio.acquireMusic(targetUID, {
        sampleRate: prefs.sampleRate,
        stereo: prefs.stereoMusic !== false,
        channelRoute: prefs.musicChannel || '1-2'
      });
      const musicNode = audio.getMusicNode();
      if (musicNode) {
        await musicMeter.startFromNode(musicNode, meterInterval(), renderMusicLevel);
      } else {
        await musicMeter.start(source.track, renderMusicLevel, meterInterval());
      }
    } catch (err) {
      logger.warn('audio_init_failure', 'Failed to acquire audio interface for music', { type: 'interface', targetUID }, err);
      await musicMeter.stop();
      await audio.remove('music');
      $('music-in-indicator')?.classList.remove('active');
    }
  }
  savePreferences();
  if (inCall) {
    await rtc.audioSourceChanged('music');
    signaling.updateMedia(currentCode, metadata());
  }
}

type HardwareAudioDeviceInfo = {
  id: number;
  name: string;
  uid: string;
  inputChannels: number;
  outputChannels: number;
  sampleRate: number;
  defaultInput: boolean;
  defaultOutput: boolean;
  inputChannelNames?: string[];
  outputChannelNames?: string[];
};

let cachedHardwareDevices: HardwareAudioDeviceInfo[] = [];

function findHardwareDevice(deviceId: string | undefined, devices: MediaDeviceInfo[]): HardwareAudioDeviceInfo | undefined {
  if (!cachedHardwareDevices.length) return undefined;
  const mediaDevice = deviceId ? devices.find((d) => d.deviceId === deviceId) : undefined;
  if (!mediaDevice) {
    return cachedHardwareDevices.find((hw) => hw.defaultInput || hw.defaultOutput);
  }
  const label = (mediaDevice.label || '').toLowerCase();
  return cachedHardwareDevices.find((hw) =>
    (hw.uid && mediaDevice.deviceId && hw.uid === mediaDevice.deviceId) ||
    (hw.name && label && label.includes(hw.name.toLowerCase())) ||
    (hw.name && label && hw.name.toLowerCase().includes(label))
  );
}

export type ChannelDropdownOption = {
  value: string;
  label: string;
  group?: string;
};

function formatDeviceDisplayName(rawName: string | undefined): string {
  if (!rawName) return 'Default Audio Device';
  let name = rawName.trim();
  if (name === 'Universal Audio Thunderbolt' || name.toLowerCase().includes('uad2audioengine') || name.toLowerCase().includes('apollo')) {
    return 'Universal Audio Apollo';
  }
  if (name === 'BuiltInSpeakerDevice' || name === 'MacBook Pro Speakers') {
    return 'MacBook Pro Speakers';
  }
  if (name === 'BuiltInMicrophoneDevice' || name === 'MacBook Pro Microphone') {
    return 'MacBook Pro Microphone';
  }
  name = name.replace(/:\d+$/, '').replace(/_DeviceUID$/, '');
  return name;
}

function formatOutputChannelName(rawName: string | undefined, chNumber: number): { name: string; isUnassigned: boolean } {
  if (!rawName || rawName.trim().length === 0) {
    return { name: `Output ${chNumber}`, isUnassigned: false };
  }
  const trimmed = rawName.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'none' || lower.startsWith('none (') || lower.startsWith('none(')) {
    return { name: `Output ${chNumber} (Unassigned)`, isUnassigned: true };
  }
  if (lower.startsWith('input ') || lower.startsWith('in ')) {
    return { name: `Output ${chNumber}`, isUnassigned: false };
  }
  return { name: trimmed, isUnassigned: false };
}

function generateInputChannelOptions(channelCount: number, channelNames?: string[]): ChannelDropdownOption[] {
  const names = channelNames || [];

  if (channelCount <= 2) {
    const ch1Name = names[0] ? ` (${names[0]})` : '';
    const ch2Name = names[1] ? ` (${names[1]})` : '';
    return [
      { value: 'all', label: 'All Channels (Default Mix)', group: 'Hardware Mix' },
      { value: '1', label: `Input 1${ch1Name} (Mono)`, group: 'Discrete Inputs' },
      { value: '2', label: `Input 2${ch2Name} (Mono)`, group: 'Discrete Inputs' },
      { value: '1-2', label: 'Inputs 1 & 2 (Stereo L/R)', group: 'Stereo Pairs' }
    ];
  }

  const options: ChannelDropdownOption[] = [];
  const discrete: ChannelDropdownOption[] = [];
  const pairs: ChannelDropdownOption[] = [];

  // Discrete Inputs
  for (let ch = 1; ch <= channelCount; ch++) {
    const rawName = names[ch - 1] || `Input ${ch}`;
    const isNone = rawName.toLowerCase().includes('none');
    if (isNone) continue;
    discrete.push({
      value: String(ch),
      label: `Input ${ch} (${rawName})`,
      group: 'Discrete Inputs'
    });
  }

  // Stereo Pairs
  for (let ch = 1; ch < channelCount; ch += 2) {
    const lName = names[ch - 1] || `In ${ch}`;
    const rName = names[ch] || `In ${ch + 1}`;
    const isNone = lName.toLowerCase().includes('none') && rName.toLowerCase().includes('none');
    if (isNone) continue;
    pairs.push({
      value: `${ch}-${ch + 1}`,
      label: `Inputs ${ch} & ${ch + 1} (${lName} / ${rName})`,
      group: 'Stereo Input Pairs'
    });
  }

  options.push(...pairs);
  options.push(...discrete);
  options.push({
    value: 'all',
    label: `All ${channelCount} Channels (Hardware Mix)`,
    group: 'Hardware Mix'
  });

  return options;
}

function generateOutputChannelOptions(channelCount: number, channelNames?: string[]): ChannelDropdownOption[] {
  const names = channelNames || [];

  if (channelCount <= 2) {
    const lInfo = formatOutputChannelName(names[0], 1);
    const rInfo = formatOutputChannelName(names[1], 2);
    const hasNamed = names[0] && names[1] && names[0].trim().length > 0 && names[1].trim().length > 0 && !lInfo.isUnassigned && !rInfo.isUnassigned;
    const pairLabel = hasNamed ? `${lInfo.name} / ${rInfo.name}` : 'Outputs 1 & 2 (Main Stereo)';
    return [
      { value: '1-2', label: pairLabel, group: 'Stereo Output Pairs' },
      { value: '1', label: `${lInfo.name} (Output 1 · Left)`, group: 'Discrete Outputs' },
      { value: '2', label: `${rInfo.name} (Output 2 · Right)`, group: 'Discrete Outputs' },
      { value: 'all', label: 'All Active Outputs (Hardware Master Mix)', group: 'Hardware Sum' }
    ];
  }

  const options: ChannelDropdownOption[] = [];
  const stereoPairs: ChannelDropdownOption[] = [];
  const discreteMono: ChannelDropdownOption[] = [];

  // 1. Stereo Pairs (Primary)
  for (let ch = 1; ch < channelCount; ch += 2) {
    const lInfo = formatOutputChannelName(names[ch - 1], ch);
    const rInfo = formatOutputChannelName(names[ch], ch + 1);

    // Hide unassigned / NONE pairs from primary list by default
    if (lInfo.isUnassigned && rInfo.isUnassigned) {
      continue;
    }

    const pairLabel = `${lInfo.name} / ${rInfo.name}`;
    stereoPairs.push({
      value: `${ch}-${ch + 1}`,
      label: pairLabel,
      group: 'Stereo Output Pairs'
    });
  }

  if (stereoPairs.length === 0) {
    stereoPairs.push({
      value: '1-2',
      label: 'Outputs 1 & 2 (Main Stereo)',
      group: 'Stereo Output Pairs'
    });
  }

  // 2. Discrete Mono Outputs (Secondary / Advanced)
  for (let ch = 1; ch <= channelCount; ch++) {
    const info = formatOutputChannelName(names[ch - 1], ch);
    if (info.isUnassigned) {
      continue;
    }
    discreteMono.push({
      value: String(ch),
      label: info.name,
      group: 'Discrete Mono Outputs'
    });
  }

  options.push(...stereoPairs);
  options.push(...discreteMono);

  // 3. Hardware Sum / Master
  options.push({
    value: 'all',
    label: `All Active Outputs (Hardware Master Mix)`,
    group: 'Hardware Sum'
  });

  return options;
}

function populateChannelDropdowns(ids: string[], options: ChannelDropdownOption[], selectedValue?: string): void {
  for (const id of ids) {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (!select) continue;
    select.replaceChildren();

    const groups = new Map<string, HTMLOptGroupElement>();

    for (const opt of options) {
      if (opt.group) {
        if (!groups.has(opt.group)) {
          const grp = document.createElement('optgroup');
          grp.label = opt.group;
          groups.set(opt.group, grp);
          select.appendChild(grp);
        }
        const optEl = new Option(opt.label, opt.value);
        groups.get(opt.group)!.appendChild(optEl);
      } else {
        select.add(new Option(opt.label, opt.value));
      }
    }

    if (selectedValue && options.some((opt) => opt.value === selectedValue)) {
      select.value = selectedValue;
    } else if (options.length > 0) {
      select.value = options[0]!.value;
    }
  }
}

function getOrCreateVoiceMeter(id: number): LevelMeter {
  let m = voiceMeters.get(id);
  if (!m) {
    m = new LevelMeter();
    voiceMeters.set(id, m);
  }
  return m;
}

function updateVoiceInIndicator(): void {
  let anyActive = false;
  for (const db of activeMicLevels.values()) {
    if (db > -48) {
      anyActive = true;
      break;
    }
  }
  $('voice-in-indicator')?.classList.toggle('active', !muted && anyActive);
}

function renderVoiceLevel(micId: number, reading: LevelReading): void {
  const width = `${Math.max(0, Math.min(100, ((reading.rmsDb + 60) / 60) * 100))}%`;
  for (const prefix of ['setup-meter', 'call-meter', 'topbar-meter', 'unit-meter']) {
    const bar = document.getElementById(`${prefix}-${micId}`);
    if (bar) {
      bar.style.width = width;
      bar.parentElement?.classList.toggle('clip', reading.clipping);
    }
  }
  for (const prefix of ['setup-db', 'call-db', 'topbar-db', 'unit-db']) {
    const el = document.getElementById(`${prefix}-${micId}`);
    if (el) el.textContent = `${Math.round(reading.rmsDb)} dB`;
  }
  activeMicLevels.set(micId, reading.rmsDb);
  let maxLocal = -60;
  for (const db of activeMicLevels.values()) {
    if (db > maxLocal) maxLocal = db;
  }
  lastLocalVoiceDb = maxLocal;
  updateVoiceInIndicator();
  checkActiveSpeaker();
}

function renderMusicLevel(reading: LevelReading): void {
  const musicActive = Boolean(audio.music?.enabled) && reading.rmsDb > -48;
  $('music-in-indicator')?.classList.toggle('active', musicActive);
  const width = `${Math.max(0, Math.min(100, ((reading.rmsDb + 60) / 60) * 100))}%`;
  const bar = document.getElementById('topbar-music-meter');
  if (bar) {
    bar.style.width = width;
    bar.parentElement?.classList.toggle('clip', reading.clipping);
  }
  const dbEl = document.getElementById('topbar-music-db');
  if (dbEl) {
    dbEl.textContent = `${Math.round(reading.rmsDb)} dB`;
  }
}

function renderVoiceInputControls(audioInputs: MediaDeviceInfo[]): void {
  const voiceMicsList = document.getElementById('voice-mics-list');
  const callVoiceMicsList = document.getElementById('call-voice-mics-list');
  const setupMetersList = document.getElementById('setup-meters-list');
  const topbarMicsBar = document.getElementById('call-topbar-mics-bar');

  if (voiceMicsList) voiceMicsList.replaceChildren();
  if (callVoiceMicsList) callVoiceMicsList.replaceChildren();
  if (setupMetersList) setupMetersList.replaceChildren();
  if (topbarMicsBar) topbarMicsBar.replaceChildren();

  const countBadge = document.getElementById('voice-count-badge');
  const callCountBadge = document.getElementById('call-voice-count-badge');
  const activeCount = prefs.voiceInputs.filter((v) => v.enabled).length;
  const countText = `${activeCount} Active ${activeCount === 1 ? 'Mic' : 'Mics'}`;
  if (countBadge) countBadge.textContent = countText;
  if (callCountBadge) callCountBadge.textContent = countText;

  prefs.voiceInputs.forEach((mic) => {
    const isPrimary = mic.id === 1;
    const badgeClass = isPrimary ? '' : mic.id === 2 ? 'secondary' : mic.id === 3 ? 'guest' : 'room';
    const shortTitle = isPrimary ? 'Microphone 1 (Lead)' : mic.id === 2 ? 'Microphone 2 (Singer / Co-Host)' : mic.id === 3 ? 'Microphone 3 (Guest)' : `Microphone ${mic.id} (Room)`;

    const hw = findHardwareDevice(mic.deviceId, audioInputs);
    const channels = hw?.inputChannels ?? 2;
    const channelOptions = generateInputChannelOptions(channels, hw?.inputChannelNames);

    // 1. Setup & In-call Dialog Unit Cards
    for (const container of [voiceMicsList, callVoiceMicsList]) {
      if (!container) continue;
      const isCall = container === callVoiceMicsList;
      const card = document.createElement('div');
      card.className = `mic-unit ${isPrimary ? 'primary-mic-unit' : 'secondary-mic-unit'}`;

      const header = document.createElement('div');
      header.className = 'mic-unit-header';
      header.innerHTML = `
        <div class="mic-unit-title-wrap">
          <span class="mic-pill-badge ${badgeClass}">${icons.mic({ size: 13 })} Mic ${mic.id}</span>
          <span class="mic-unit-title">${shortTitle}</span>
        </div>
        ${!isPrimary ? `
          <button type="button" class="btn-remove-mic" data-mic-id="${mic.id}" title="Remove Microphone ${mic.id}">
            <span class="btn-remove-icon">${icons.x({ size: 14 })}</span>
            <span>Remove</span>
          </button>
        ` : '<span class="primary-mic-tag">Primary</span>'}
      `;
      card.appendChild(header);

      const body = document.createElement('div');
      body.className = 'field-wrap';

      // Device Select
      const devSelect = document.createElement('select');
      devSelect.className = 'custom-select mb-2';
      devSelect.id = `${isCall ? 'call-' : ''}voice-dev-${mic.id}`;
      if (!audioInputs.length) devSelect.add(new Option('Default Audio Input', ''));
      audioInputs.forEach((d, i) => devSelect.add(new Option(formatDeviceDisplayName(d.label) || `Audio Input ${i + 1}`, d.deviceId)));
      if (mic.deviceId && audioInputs.some((d) => d.deviceId === mic.deviceId)) devSelect.value = mic.deviceId;
      else if (audioInputs.length) devSelect.value = audioInputs[0]!.deviceId;

      devSelect.addEventListener('change', async () => {
        mic.deviceId = devSelect.value || undefined;
        if (isPrimary) prefs.audioInputId = mic.deviceId;
        savePreferences();
        await syncAllVoiceMics();
        await enumerateAndPopulate();
      });
      body.appendChild(devSelect);

      // Channel Select
      const chRow = document.createElement('div');
      chRow.className = 'channel-picker-row mb-2';
      chRow.innerHTML = `<span class="sub-field-label">Interface Channel:</span>`;
      const chSelect = document.createElement('select');
      chSelect.className = 'custom-select mini-channel-select';
      chSelect.id = `${isCall ? 'call-' : ''}voice-ch-${mic.id}`;
      channelOptions.forEach((opt) => chSelect.add(new Option(opt.label, opt.value)));
      if (channelOptions.some((opt) => opt.value === mic.channelRoute)) chSelect.value = mic.channelRoute;
      else chSelect.value = '1';

      chSelect.addEventListener('change', async () => {
        mic.channelRoute = chSelect.value;
        if (isPrimary) prefs.voiceChannel = chSelect.value;
        savePreferences();
        await syncAllVoiceMics();
        await enumerateAndPopulate();
      });
      chRow.appendChild(chSelect);
      body.appendChild(chRow);

      if (!isCall) {
        // Gain Slider (Sound Check only)
        const gainRow = document.createElement('div');
        gainRow.className = 'mic-gain-row';
        gainRow.innerHTML = `
          <div class="label-with-val">
            <span class="sub-field-label">Mic ${mic.id} Level (Gain):</span>
            <output id="gain-val-${mic.id}" class="badge-value">${Math.round((mic.gain ?? 1) * 100)}%</output>
          </div>
          <input id="gain-${mic.id}" type="range" min="0" max="1.5" step="0.05" value="${mic.gain ?? 1}" class="custom-slider mini-slider" />
        `;
        const slider = gainRow.querySelector<HTMLInputElement>(`#gain-${mic.id}`);
        const valLabel = gainRow.querySelector<HTMLElement>(`#gain-val-${mic.id}`);
        slider?.addEventListener('input', (event) => {
          const val = Number((event.currentTarget as HTMLInputElement).value);
          mic.gain = val;
          if (isPrimary) prefs.inputGain = val;
          savePreferences();
          if (valLabel) valLabel.textContent = `${Math.round(val * 100)}%`;
          void audio.setVoiceMicGain(mic.id, val);
        });
        body.appendChild(gainRow);
      }

      card.appendChild(body);
      container.appendChild(card);
    }

    // 2. Setup Left Column Studio Meter Card
    if (setupMetersList) {
      const studioCard = document.createElement('div');
      studioCard.className = `studio-meter-card ${isPrimary ? '' : 'secondary-meter-card'}`;
      studioCard.innerHTML = `
        <div class="meter-header">
          <div class="meter-title-wrap">
            <span class="meter-dot ${isPrimary ? '' : 'mic2-dot'}"></span>
            <span class="meter-title">VOICE INPUT ${mic.id}</span>
          </div>
          <output id="setup-db-${mic.id}" class="db-readout">−60 dB</output>
        </div>
        <div class="meter-scale">
          <span>-60</span>
          <span>-36</span>
          <span>-24</span>
          <span>-12</span>
          <span>-6</span>
          <span>0 dB</span>
        </div>
        <div class="meter">
          <div id="setup-meter-${mic.id}" class="meter-fill"></div>
          <i class="clip" title="Clipping (Peak over 0 dBFS)"></i>
        </div>
      `;
      setupMetersList.appendChild(studioCard);
    }

    // 3. Topbar Mini Meter Pill
    if (topbarMicsBar) {
      const topbarPill = document.createElement('div');
      topbarPill.className = 'topbar-meter-unit';
      topbarPill.innerHTML = `
        ${activeCount > 1 ? `<span class="topbar-mic-tag">M${mic.id}</span>` : ''}
        <div class="topbar-meter-track">
          <div id="topbar-meter-${mic.id}" class="meter-fill"></div>
          <i class="clip"></i>
        </div>
        <output id="topbar-db-${mic.id}" class="topbar-db-num">−60 dB</output>
      `;
      topbarMicsBar.appendChild(topbarPill);
    }
  });

  // Attach remove buttons listeners
  document.querySelectorAll<HTMLButtonElement>('.btn-remove-mic').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const micId = Number(btn.getAttribute('data-mic-id'));
      if (!micId || micId === 1) return;
      prefs.voiceInputs = prefs.voiceInputs.filter((m) => m.id !== micId);
      savePreferences();
      const m = voiceMeters.get(micId);
      if (m) await m.stop();
      voiceMeters.delete(micId);
      activeMicLevels.delete(micId);
      await audio.removeVoiceMic(micId);
      await syncAllVoiceMics();
      await enumerateAndPopulate();
      setMessage(inCall ? 'device-dialog-status' : 'setup-status', `Microphone ${micId} removed.`);
    });
  });
}

async function enumerateAndPopulate(): Promise<void> {
  const desktopApi = typeof window !== 'undefined' ? (window.jameet || window.musiczoom) : undefined;
  if (desktopApi?.getHardwareAudioDevices) {
    cachedHardwareDevices = await desktopApi.getHardwareAudioDevices().catch(() => []);
  }
  await refreshRunningApps();

  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const groups: Record<MediaDeviceKind, MediaDeviceInfo[]> = { videoinput: [], audioinput: [], audiooutput: [] };
  for (const device of devices) groups[device.kind]?.push(device);
  
  fillSelects(['camera-select', 'call-camera-select'], groups.videoinput, prefs.cameraId, 'Camera');
  fillSelects(['audio-output-select', 'call-audio-output-select'], groups.audiooutput, prefs.audioOutputId, 'System default');

  const interfaceList = groups.audiooutput.length > 0 ? groups.audiooutput : groups.audioinput;
  fillSelects(['music-input-select', 'call-music-input-select'], interfaceList, prefs.musicInputId || prefs.audioOutputId, 'Default Audio Interface');

  renderVoiceInputControls(groups.audioinput);

  const selectedMusicDeviceId = prefs.musicInputId || prefs.audioOutputId;
  const musicHw = findHardwareDevice(selectedMusicDeviceId, groups.audiooutput) || findHardwareDevice(selectedMusicDeviceId, groups.audioinput);
  const musicOutChannels = musicHw?.outputChannels ?? 2;
  const musicOutNames = musicHw?.outputChannelNames;
  populateChannelDropdowns(['music-channel-select', 'call-music-channel-select'], generateOutputChannelOptions(musicOutChannels, musicOutNames), prefs.musicChannel ?? (musicOutChannels >= 2 ? '1-2' : '1'));

  const outputHw = findHardwareDevice(prefs.audioOutputId, groups.audiooutput);
  const outChannels = outputHw?.outputChannels ?? 2;
  const outNames = outputHw?.outputChannelNames;
  populateChannelDropdowns(['output-channel-select', 'call-output-channel-select'], generateOutputChannelOptions(outChannels, outNames), prefs.outputChannel ?? (outChannels >= 2 ? '1-2' : '1'));

  for (const id of ['music-source-type-select', 'call-music-source-type-select']) {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = prefs.musicSourceType || 'app';
  }

  const isApp = (prefs.musicSourceType || 'app') === 'app';
  const isInterface = prefs.musicSourceType === 'interface';
  const isSystem = prefs.musicSourceType === 'system';
  $('music-app-group')?.classList.toggle('hidden', !isApp);
  $('call-music-app-group')?.classList.toggle('hidden', !isApp);
  $('music-interface-group')?.classList.toggle('hidden', !isInterface);
  $('call-music-interface-group')?.classList.toggle('hidden', !isInterface);
  $('music-system-group')?.classList.toggle('hidden', !isSystem);
  $('call-music-system-group')?.classList.toggle('hidden', !isSystem);

  const voiceHw = findHardwareDevice(prefs.audioInputId, groups.audioinput);
  const activeRate = voiceHw?.sampleRate || outputHw?.sampleRate || prefs.sampleRate || 44100;
  for (const rateId of ['active-sample-rate', 'call-active-sample-rate']) {
    const el = document.getElementById(rateId);
    if (el) el.textContent = `${Math.round(activeRate).toLocaleString()} Hz`;
  }

  const outVolEl = document.getElementById('call-output-volume') as HTMLInputElement | null;
  if (outVolEl) outVolEl.value = String(prefs.outputVolume ?? 1);
  const outVolVal = document.getElementById('call-output-volume-val');
  if (outVolVal) outVolVal.textContent = `${Math.round((prefs.outputVolume ?? 1) * 100)}%`;

  for (const id of ['camera-quality-select', 'call-camera-quality-select']) {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = prefs.cameraQuality;
  }
  for (const id of ['receive-quality-select', 'call-receive-quality-select']) {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = prefs.receiveQuality;
  }
  for (const id of ['performance-select', 'call-performance-select']) {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = prefs.performanceMode;
  }
  for (const id of ['channel-mode-select', 'call-channel-mode-select']) {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = prefs.stereoMusic ? 'stereo' : 'mono';
  }
  for (const id of ['sample-rate-select', 'call-sample-rate-select']) {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = String(prefs.sampleRate ?? 44100);
  }
  for (const id of ['music-quality-select', 'call-music-quality-select']) {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) el.value = String(prefs.musicBitrate);
  }
  const audioOnlyEl = document.getElementById('audio-only-setup') as HTMLInputElement | null;
  if (audioOnlyEl) audioOnlyEl.checked = audioOnly;
}

function fillSelects(ids: string[], devices: MediaDeviceInfo[], selected: string | undefined, fallback: string): void {
  for (const id of ids) {
    const select = document.getElementById(id) as HTMLSelectElement | null;
    if (!select) continue;
    select.replaceChildren();
    if (!devices.length || id.includes('output') || id.includes('music-input')) select.add(new Option(fallback, ''));
    devices.forEach((device, index) => {
      const displayLabel = formatDeviceDisplayName(device.label) || `${fallback} ${index + 1}`;
      select.add(new Option(displayLabel, device.deviceId));
    });
    if (selected && devices.some((device) => device.deviceId === selected)) select.value = selected;
    else if (selected) {
      const key = id.includes('camera') ? 'cameraId' : id.includes('output') ? 'audioOutputId' : id.includes('music-input') ? 'musicInputId' : 'audioInputId';
      prefs[key] = undefined;
      select.value = '';
      setMessage(inCall ? 'device-dialog-status' : 'setup-status', `A saved ${fallback.toLowerCase()} is unavailable; using the system default.`);
    }
  }
  savePreferences();
}

async function prepareStudio(action: PendingAction): Promise<void> {
  pending = action;
  if (action.type === 'join') {
    currentCode = action.code;
  } else if (!currentCode) {
    currentCode = (Math.random().toString(36).substring(2, 6) + Math.random().toString(36).substring(2, 6)).slice(0, 8).toUpperCase();
  }
  showView('setup-view');
  setText('setup-code', currentCode);
  if (action.type === 'create') {
    $('setup-waiting-room-group')?.classList.remove('hidden');
  } else {
    $('setup-waiting-room-group')?.classList.add('hidden');
  }
  setMessage('setup-status', 'Connecting studio audio & camera…');
  setBusy(true);

  // Immediately render default UI state so everything is visible
  setModeRadios(prefs.mode);
  updateMusicWarning();
  updateCameraButtonState();
  updateLocalPreviews();

  try {
    // 1. Quick device enumeration
    await enumerateAndPopulate().catch((e) => console.warn('enumerateAndPopulate error:', e));

    // 2. Parallel acquisition of microphone, camera, and music inputs for instantaneous loading!
    await Promise.all([
      syncAllVoiceMics(prefs.mode).catch((e) => console.warn('syncAllVoiceMics error:', e)),
      (!audioOnly ? replaceCamera(prefs.cameraId) : Promise.resolve()).catch((e) => console.warn('replaceCamera error:', e)),
      replaceMusicInput().catch((e) => console.warn('replaceMusicInput error:', e))
    ]);

    updateLocalPreviews();
    setMessage('setup-status', 'Studio audio & camera ready.');
  } catch (error) {
    setMessage('setup-status', deviceError(error), true);
  } finally {
    setBusy(false);
  }
}

function deviceError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Camera or microphone access was denied. Allow access in system settings, then try again.';
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'No usable camera or audio input was found.';
  return error instanceof Error ? error.message : 'The selected device could not be opened.';
}

function renderAudioLimitations(): void {
  const source = audio.primary;
  if (!source) return;
  const effectiveHz = prefs.sampleRate ?? source.effective.sampleRate ?? 44_100;
  const hzText = `${effectiveHz.toLocaleString()} Hz`;
  const isStereo = prefs.stereoMusic !== false;
  const channelText = isStereo ? 'Stereo' : 'Mono';
  
  for (const id of ['active-sample-rate', 'call-active-sample-rate', 'advanced-quick-spec']) {
    const el = document.getElementById(id);
    if (el) el.textContent = `${hzText} · ${channelText}`;
  }

  const summary = `Hardware Stream: ${hzText} · ${channelText}`;
  const limits = audioLimitations(source.mode, { ...source.effective, channelCount: isStereo ? 2 : 1, sampleRate: effectiveHz });
  setMessage('audio-limitations', [summary, ...limits].join('  '), limits.length > 0);
  for (const id of ['input-gain', 'call-input-gain']) {
    const control = $<HTMLInputElement>(id);
    if (control) {
      control.disabled = false;
      control.title = 'Hardware & stream input gain';
    }
  }
}
function setModeRadios(mode: AudioMode): void {
  const radio = document.querySelector<HTMLInputElement>(`input[name="setup-mode"][value="${mode}"]`);
  if (radio) radio.checked = true;
}
function updateMusicWarning(): void {
  updateHeadphoneWarning();
}
let sessionStartTime = 0;
let sessionTimerHandle: number | undefined;

function startSessionTimer(): void {
  stopSessionTimer();
  sessionStartTime = Date.now();
  sessionTimerHandle = window.setInterval(() => {
    if (!inCall) return;
    const elapsedSec = Math.floor((Date.now() - sessionStartTime) / 1000);
    const m = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
    const s = (elapsedSec % 60).toString().padStart(2, '0');
    const peerStatus = remoteVideoStream || remoteAudioTracks.size > 0 ? 'Connected' : 'Waiting for Musician…';
    setCallStatus(`${peerStatus} · ${m}:${s}`);
  }, 1000);
}

function stopSessionTimer(): void {
  if (sessionTimerHandle) {
    window.clearInterval(sessionTimerHandle);
    sessionTimerHandle = undefined;
  }
}

function updateCallMode(): void {
  const music = prefs.mode === 'music';
  const label = $('mode-label');
  if (label) label.textContent = music ? 'Music Mode' : 'Talk Mode';
  const modeBtn = $('mode-button');
  if (modeBtn) modeBtn.textContent = music ? 'Talk Mode' : 'Music Mode';
  
  $('mode-music-btn')?.classList.toggle('active', music);
  $('mode-talk-btn')?.classList.toggle('active', !music);
  
  updateHeadphoneWarning();
  updateLocalPreviews();
}

let currentSharingSourceTitle = '';

async function startScreenShare(sourceId: string, optimizeFor: 'detail' | 'motion' = 'detail'): Promise<void> {
  if (!inCall || screenTrack) return;
  
  const isMotion = optimizeFor === 'motion';
  const fps = isMotion ? 30 : 15;
  const targetRes = isMotion ? { width: 1280, height: 720 } : { width: 1920, height: 1080 };

  let next: MediaStreamTrack | undefined;
  const desktopApi = typeof window !== 'undefined' ? (window.jameet || window.musiczoom) : undefined;

  // 1. For entire display sharing on macOS, use native ScreenCaptureKit capture with SCContentFilter app exclusion
  if (sourceId.startsWith('screen:') && desktopApi?.platform === 'darwin') {
    try {
      const displayIndex = parseInt(sourceId.split(':')[1], 10) || 0;
      next = await presenter.createScreenCaptureTrack(displayIndex, { fps, width: targetRes.width, height: targetRes.height });
    } catch (err) {
      console.warn('Native ScreenCaptureKit failed, falling back to standard getDisplayMedia:', err);
    }
  }

  // 2. Standard getDisplayMedia fallback or window sharing
  if (!next) {
    const selected = desktopApi?.selectDisplaySource ? desktopApi.selectDisplaySource(sourceId) : true;
    if (!selected) throw new Error('The selected screen could not be authorized.');
    
    const fpsConstraint = isMotion ? { ideal: 30, max: 30 } : { ideal: 15, max: 15 };
    const resConstraint = isMotion ? { width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { ...resConstraint, frameRate: fpsConstraint },
        audio: true
      });
    } catch {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { ...resConstraint, frameRate: fpsConstraint },
        audio: false
      });
    }
    next = stream.getVideoTracks()[0];
    if (!next) throw new Error('Screen sharing did not provide a video track.');
    const displayAudio = stream.getAudioTracks()[0];
    if (displayAudio) {
      await audio.addExternal('screen-audio', 'music', displayAudio);
      await rtc.audioSourceChanged('screen-audio');
    }
  }

  next.contentHint = isMotion ? 'motion' : 'detail';
  try { await rtc.replaceVideoTrack(next); }
  catch (error) {
    next.stop();
    await presenter.stopNativeCapture();
    await presenter.exitPresenterMode();
    throw error;
  }
  screenTrack = next;
  // NOTE: Keep videoTrack running so local camera remains visible in the camera strip!
  rtc.setVideoTrack(next);
  next.onended = () => void stopScreenShare();
  setScreenSharingUi(true);
  updateLocalPreviews();
  setCallStatus(`Sharing: ${currentSharingSourceTitle || 'Screen'}`);
  signaling.updateMedia(currentCode, metadata());

  // 3. Automatically transition into Presenter Mode
  presenter.setRemoteVideoElement($<HTMLVideoElement>('remote-video'));
  presenter.setLocalVideoElement($<HTMLVideoElement>('local-video'));
  presenter.setParticipantInfo(
    'Musician',
    auth.getUser()?.name || auth.getGuestName() || 'You',
    lastRemoteVoiceDb,
    lastLocalVoiceDb
  );
  $('session-presenter-banner')?.classList.add('hidden');
  await presenter.enterPresenterMode({
    micMuted: muted,
    camEnabled: cameraEnabled,
    mode: prefs.mode,
    paused: false,
    pipVisible: true
  });
}

async function stopScreenShare(): Promise<void> {
  const previous = screenTrack;
  if (!previous) return;
  previous.onended = null;
  currentSharingSourceTitle = '';
  try {
    if (cameraEnabled && videoTrack) {
      await rtc.replaceVideoTrack(videoTrack);
      rtc.setVideoTrack(videoTrack);
    } else if (cameraEnabled) {
      const camera = await acquireVideo(prefs.cameraId);
      await rtc.replaceVideoTrack(camera);
      videoTrack = camera;
      rtc.setVideoTrack(camera);
    } else {
      await rtc.removeVideoTrack();
      rtc.setVideoTrack(undefined);
    }
  } catch (error) {
    await rtc.removeVideoTrack();
    setCallStatus(`Screen sharing stopped. ${deviceError(error)}`);
  } finally {
    await audio.remove('screen-audio');
    await rtc.audioSourceChanged('screen-audio');
    screenTrack = undefined;
    previous.stop();
    await presenter.stopNativeCapture();
    await presenter.exitPresenterMode();
    $('session-presenter-banner')?.classList.add('hidden');
    setScreenSharingUi(false);
    updateLocalPreviews();
    signaling.updateMedia(currentCode, metadata());
  }
}

function setScreenSharingUi(active: boolean): void {
  const toggleBtn = document.getElementById('toggle-screen');
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', active);
    toggleBtn.innerHTML = `<span class="tool-icon">${active ? icons.stopSquare({ size: 18 }) : icons.monitor({ size: 18 })}</span><span class="tool-text">${active ? 'Stop Sharing' : 'Share Screen'}</span>`;
  }
  const shareOverlay = document.getElementById('local-share-overlay');
  if (shareOverlay) {
    shareOverlay.classList.toggle('hidden', !active);
    const titleEl = document.getElementById('local-share-title');
    if (titleEl) titleEl.textContent = currentSharingSourceTitle ? `Sharing: ${currentSharingSourceTitle}` : 'Sharing Screen';
  }
  const localTile = document.querySelector('.video-tile.local-tile');
  if (localTile) {
    localTile.classList.toggle('sharing-screen', active);
  }
  const camBtn = $<HTMLButtonElement>('toggle-camera');
  if (camBtn) camBtn.disabled = active;
  const callCamSel = $<HTMLSelectElement>('call-camera-select');
  if (callCamSel) callCamSel.disabled = active;
}

async function showScreenPicker(): Promise<void> {
  if (screenTrack) { await stopScreenShare(); return; }
  const dialog = $<HTMLDialogElement>('screen-dialog');
  if (!dialog) return;

  const dawGrid = $('screen-daw-grid');
  const appsGrid = $('screen-apps-grid');
  const screensGrid = $('screen-displays-grid');
  if (dawGrid) dawGrid.replaceChildren();
  if (appsGrid) appsGrid.replaceChildren();
  if (screensGrid) screensGrid.replaceChildren();

  setMessage('screen-status', 'Loading available screens and DAW windows…');
  dialog.showModal();

  const dawPattern = /logic|ableton|cubase|pro tools|studio one|reaper|fl studio|reason|bitwig|garageband/i;

  try {
    const desktopApi = typeof window !== 'undefined' ? (window.jameet || window.musiczoom) : undefined;
    const sources = desktopApi?.listDisplaySources ? await desktopApi.listDisplaySources() : [];
    if (!sources.length) {
      setMessage('screen-status', 'No screens or windows found. On macOS, make sure Screen Recording permission is allowed in System Settings > Privacy & Security.', true);
      return;
    }
    setMessage('screen-status', '');

    const screens = sources.filter((s) => s.id.startsWith('screen:'));
    const windows = sources.filter((s) => !s.id.startsWith('screen:'));
    const daws = windows.filter((w) => dawPattern.test(w.name));
    const otherApps = windows.filter((w) => !dawPattern.test(w.name));

    setText('apps-count-badge', String(windows.length));
    setText('screens-count-badge', String(screens.length));

    const getOptimizationPreset = (): 'detail' | 'motion' => {
      const checked = document.querySelector<HTMLInputElement>('input[name="share-preset"]:checked');
      return (checked?.value as 'detail' | 'motion') || 'detail';
    };

    const createCard = (source: { id: string; name: string; thumbnail: string }, isDaw = false) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'screen-source-card';
      card.innerHTML = `
        <div class="source-thumbnail-wrap">
          <img src="${source.thumbnail}" alt="" />
          ${isDaw ? `<span class="daw-badge">${icons.music({ size: 12 })} DAW</span>` : ''}
        </div>
        <div class="source-card-info">
          <span class="source-card-icon">${isDaw ? icons.piano({ size: 16 }) : source.id.startsWith('screen:') ? icons.monitor({ size: 16 }) : icons.appWindow({ size: 16 })}</span>
          <span class="source-card-name" title="${escapeHtml(source.name)}">${escapeHtml(source.name)}</span>
        </div>
      `;
      card.addEventListener('click', () => {
        dialog.close();
        currentSharingSourceTitle = source.name;
        const preset = getOptimizationPreset();
        void startScreenShare(source.id, preset).catch((error) => setCallStatus(deviceError(error)));
      });
      return card;
    };

    // Populate DAWs
    if (dawGrid) {
      if (daws.length === 0) {
        dawGrid.innerHTML = '<div class="no-daws-hint"><span>No running DAWs detected. Open Logic Pro, Ableton, FL Studio, or Pro Tools to share directly.</span></div>';
      } else {
        daws.forEach((daw) => dawGrid.appendChild(createCard(daw, true)));
      }
    }

    // Populate Other Windows
    if (appsGrid) {
      otherApps.forEach((app) => appsGrid.appendChild(createCard(app, false)));
    }

    // Populate Displays
    if (screensGrid) {
      screens.forEach((scr) => screensGrid.appendChild(createCard(scr, false)));
    }
  } catch (error) {
    setMessage('screen-status', deviceError(error), true);
  }
}

async function setOutputDevice(deviceId?: string): Promise<void> {
  prefs.audioOutputId = deviceId;
  savePreferences();
  const media = [$<HTMLAudioElement>('remote-voice-audio'), $<HTMLAudioElement>('remote-music-audio'), microphonePlayback].filter(Boolean) as HTMLMediaElement[];
  for (const element of media) {
    if (!element.setSinkId) {
      if (deviceId) throw new Error('Audio output selection is not supported on this system.');
      continue;
    }
    await element.setSinkId(deviceId ?? '');
  }
  updateHeadphoneWarning();
}

async function testSpeakers(pan: 'both' | 'left' | 'right' = 'both'): Promise<void> {
  const context = new AudioContext();
  if (context.state === 'suspended') await context.resume();
  const destination = context.createMediaStreamDestination();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const volume = prefs.outputVolume ?? 1;
  oscillator.frequency.value = pan === 'left' ? 380 : pan === 'right' ? 520 : 440;
  gain.gain.value = 0.12 * volume;

  const merger = context.createChannelMerger(2);
  if (pan === 'left') {
    gain.connect(merger, 0, 0); // Left
  } else if (pan === 'right') {
    gain.connect(merger, 0, 1); // Right
  } else {
    gain.connect(merger, 0, 0);
    gain.connect(merger, 0, 1);
  }
  oscillator.connect(gain);
  merger.connect(destination);

  const element = new Audio();
  element.srcObject = destination.stream;
  if (element.setSinkId) await element.setSinkId(prefs.audioOutputId ?? '');
  await element.play();
  oscillator.start();
  oscillator.stop(context.currentTime + 0.7);
  await new Promise((resolve) => window.setTimeout(resolve, 850));
  element.pause();
  await context.close();
}

let microphonePlayback: HTMLAudioElement | undefined;
async function testMicrophone(): Promise<void> {
  const track = audio.primary?.track;
  if (!track) throw new Error('Choose an audio input first.');
  setMessage('setup-status', 'Recording a 3-second microphone test…');
  const clone = track.clone();
  const recorder = new MediaRecorder(new MediaStream([clone]));
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  recorder.start();
  await new Promise((resolve) => window.setTimeout(resolve, 3_000));
  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  recorder.stop();
  await stopped;
  clone.stop();
  microphonePlayback?.pause();
  const mimeType = recorder.mimeType || 'audio/webm';
  microphonePlayback = new Audio(URL.createObjectURL(new Blob(chunks, { type: mimeType })));
  if (microphonePlayback.setSinkId) await microphonePlayback.setSinkId(prefs.audioOutputId ?? '');
  await microphonePlayback.play();
  setMessage('setup-status', 'Playing the recorded microphone test.');
}

async function initializeActiveCall(ack: MeetingAck): Promise<void> {
  currentCode = ack.code;
  currentRole = ack.role;
  currentIceServers = ack.iceServers;
  myIdentity = ack.identity;
  hostIdentity = ack.hostIdentity;
  peerIdentity = ack.peerIdentity ?? null;
  peerParticipantId = ack.peerParticipantId ?? null;
  inCall = true;
  rtc.setVideoTrack(videoTrack);
  rtc.configure(ack.code, ack.role, ack.iceServers, prefs.mode, effectiveVideoQuality(prefs.cameraQuality), effectiveMusicBitrate(), ack.peerMedia);
  setText('call-code', ack.code);
  updateCallMode();
  updateCameraButtonState();
  updateLocalPreviews();
  updateParticipantIdentityUi();

  // In-Session Workspace Integration
  if (ack.projectId) {
    sessionProjectId = ack.projectId;
    const t = auth.getToken();
    if (t) {
      void projectsApi.fetchProject(t, ack.projectId).then((p) => {
        activeProject = p;
        activeProjectId = p.id;
        setText('session-workspace-project-name', p.name);
        syncWorkspaceInputsFromProject(true);
        void signaling.joinProjectWorkspace(p.id, t).then((joinRes) => {
          if (joinRes?.ok && joinRes.workspace && activeProject) {
            activeProject.workspace = joinRes.workspace;
            syncWorkspaceInputsFromProject(true);
          }
        });
        $('toggle-session-workspace')?.classList.remove('hidden');
      }).catch(() => {
        $('toggle-session-workspace')?.classList.add('hidden');
      });
    } else {
      $('toggle-session-workspace')?.classList.add('hidden');
    }
  } else {
    sessionProjectId = undefined;
    $('toggle-session-workspace')?.classList.add('hidden');
  }

  resetChatUi();
  isSessionLocked = Boolean(ack.locked);
  updateLockUi();
  showView('call-view');
  startSessionTimer();
  setCallStatus(ack.peerPresent ? 'Connected · 00:00' : 'Waiting for Musician…');
  if (pendingPeerMedia) { await rtc.peerReady(pendingPeerMedia); pendingPeerMedia = undefined; }
  else if (ack.peerPresent && ack.peerMedia) await rtc.peerReady(ack.peerMedia);
}

function updateLockUi(): void {
  const btn = $('btn-lock-session');
  if (!btn) return;
  if (currentRole !== 'host') {
    btn.classList.add('hidden');
    return;
  }
  btn.classList.remove('hidden');
  btn.classList.toggle('is-locked', isSessionLocked);
  $('lock-icon-unlocked')?.classList.toggle('hidden', isSessionLocked);
  $('lock-icon-locked')?.classList.toggle('hidden', !isSessionLocked);
  setText('btn-lock-session-label', isSessionLocked ? 'Locked' : 'Lock');
  btn.title = isSessionLocked ? 'Unlock Session (Allow participants to join)' : 'Lock Session (Prevent new participants from joining)';
}

async function enterSession(): Promise<void> {
  if (!pending || !audio.primary || (!audioOnly && !videoTrack)) throw new Error('Voice input and the selected session devices must be ready before entering.');
  setBusy(true);
  setMessage('setup-status', pending.type === 'create' ? 'Creating session…' : 'Joining session…');
  try {
    const token = auth.getToken() || undefined;
    const guestName = auth.getGuestName() || undefined;
    const waitingRoomEnabled = $<HTMLInputElement>('setup-waiting-room')?.checked ?? false;
    const ack: MeetingAck = pending.type === 'create'
      ? await signaling.create(participantId, metadata(), token, guestName, activeProjectId, waitingRoomEnabled)
      : await signaling.join(pending.code, participantId, metadata(), token, guestName);
    if (!ack.ok) {
      if (ack.code === 'AUTH_REQUIRED') {
        setMessage('setup-status', 'Authentication required to create or join a session.', true);
        openAuthView('login');
      } else if (ack.code === 'ACCESS_DENIED') {
        setMessage('setup-status', 'Your account does not currently have access to JaMeet sessions.', true);
      } else if (ack.code === 'BETA_ENDED') {
        setMessage('setup-status', 'JaMeet Beta has ended.\nA JaMeet subscription will be required to continue creating or joining sessions.', true);
      } else {
        setMessage('setup-status', ack.message, true);
      }
      return;
    }
    if (ack.waiting) {
      currentCode = ack.code;
      logger.setSessionContext(ack.code);
      hostIdentity = ack.hostIdentity;
      myIdentity = ack.identity;
      setText('waiting-host-name', ack.hostIdentity?.displayName || 'Host Musician');
      setText('waiting-code', ack.code);
      showView('waiting-view');
      return;
    }
    logger.setSessionContext(ack.code);
    await initializeActiveCall(ack);
  } finally { setBusy(false); }
}

function setRemoteStream(stream?: MediaStream): void {
  remoteVideoStream = stream;
  const video = $<HTMLVideoElement>('remote-video');
  const shouldRender = Boolean(stream && (!remoteMedia?.audioOnly || remoteMedia.sharingScreen));
  if (video) video.srcObject = shouldRender ? stream! : null;
  $('remote-placeholder')?.classList.toggle('hidden', shouldRender && Boolean(stream?.getVideoTracks().length));
  if (stream) void setOutputDevice(prefs.audioOutputId).catch((error) => setCallStatus(deviceError(error)));
  updateSessionStage();
}
let remoteAudioCtx: AudioContext | undefined;
let remoteVoiceSourceNode: MediaStreamAudioSourceNode | undefined;
let remoteMusicSourceNode: MediaStreamAudioSourceNode | undefined;
let remoteVoiceGain: GainNode | undefined;
let remoteMusicGain: GainNode | undefined;
let remoteMasterGain: GainNode | undefined;
let remoteLimiter: DynamicsCompressorNode | undefined;

async function getOrCreateRemoteAudioContext(): Promise<AudioContext> {
  if (!remoteAudioCtx || remoteAudioCtx.state === 'closed') {
    remoteAudioCtx = new AudioContext({ sampleRate: 48000 });
    remoteVoiceGain = remoteAudioCtx.createGain();
    remoteMusicGain = remoteAudioCtx.createGain();
    remoteMasterGain = remoteAudioCtx.createGain();
    remoteLimiter = remoteAudioCtx.createDynamicsCompressor();

    // Studio protective limiter (transparent ceiling at -0.5 dB)
    remoteLimiter.threshold.setValueAtTime(-0.5, remoteAudioCtx.currentTime);
    remoteLimiter.knee.setValueAtTime(4.0, remoteAudioCtx.currentTime);
    remoteLimiter.ratio.setValueAtTime(20.0, remoteAudioCtx.currentTime);
    remoteLimiter.attack.setValueAtTime(0.003, remoteAudioCtx.currentTime);
    remoteLimiter.release.setValueAtTime(0.1, remoteAudioCtx.currentTime);

    remoteVoiceGain.connect(remoteMasterGain);
    remoteMusicGain.connect(remoteMasterGain);
    remoteMasterGain.connect(remoteLimiter);
    remoteLimiter.connect(remoteAudioCtx.destination);
  }
  if (remoteAudioCtx.state === 'suspended') {
    await remoteAudioCtx.resume().catch(() => {});
  }
  return remoteAudioCtx;
}

function setRemoteAudio(id: string, purpose: 'voice' | 'music', track: MediaStreamTrack): void {
  remoteAudioTracks.get(id)?.track.stop();
  remoteAudioTracks.set(id, { purpose, track });
  track.onended = () => { remoteAudioTracks.delete(id); void refreshRemoteAudio(); };
  void refreshRemoteAudio();
}

async function refreshRemoteAudio(): Promise<void> {
  const voice = [...remoteAudioTracks.values()].filter((item) => item.purpose === 'voice').map((item) => item.track);
  const music = [...remoteAudioTracks.values()].filter((item) => item.purpose === 'music').map((item) => item.track);

  const ctx = await getOrCreateRemoteAudioContext();

  if (voice.length > 0) {
    const voiceStream = new MediaStream(voice);
    try { remoteVoiceSourceNode?.disconnect(); } catch {}
    remoteVoiceSourceNode = ctx.createMediaStreamSource(voiceStream);
    if (remoteVoiceGain) remoteVoiceSourceNode.connect(remoteVoiceGain);
    void startRemoteVoiceBridge(ctx, remoteVoiceSourceNode);

    if (!remoteVoiceMeter) {
      remoteVoiceMeter = new LevelMeter();
    }
    void remoteVoiceMeter.startFromNode(remoteVoiceSourceNode, 66, (reading) => {
      lastRemoteVoiceDb = (!remoteMuted) ? reading.rmsDb : -60;
      checkActiveSpeaker();
    });
  } else {
    stopRemoteVoiceBridge();
    try { remoteVoiceSourceNode?.disconnect(); } catch {}
    remoteVoiceSourceNode = undefined;
    if (remoteVoiceMeter) {
      void remoteVoiceMeter.stop();
      remoteVoiceMeter = undefined;
    }
    lastRemoteVoiceDb = -60;
    checkActiveSpeaker();
  }

  if (music.length > 0) {
    const musicStream = new MediaStream(music);
    try { remoteMusicSourceNode?.disconnect(); } catch {}
    remoteMusicSourceNode = ctx.createMediaStreamSource(musicStream);
    if (remoteMusicGain) remoteMusicSourceNode.connect(remoteMusicGain);
  } else {
    try { remoteMusicSourceNode?.disconnect(); } catch {}
    remoteMusicSourceNode = undefined;
  }

  const voiceEl = $<HTMLAudioElement>('remote-voice-audio');
  const musicEl = $<HTMLAudioElement>('remote-music-audio');
  if (voiceEl) voiceEl.srcObject = new MediaStream(voice);
  if (musicEl) musicEl.srcObject = new MediaStream(music);

  updateRemoteVolumes();
  void setOutputDevice(prefs.audioOutputId).catch((error) => setCallStatus(deviceError(error)));
}

function handleRemoteMedia(media: MediaMetadata): void {
  remoteMedia = media;
  const shouldRender = Boolean(remoteVideoStream && (!media.audioOnly || media.sharingScreen));
  const video = $<HTMLVideoElement>('remote-video');
  if (video) video.srcObject = shouldRender ? remoteVideoStream! : null;
  $('remote-placeholder')?.classList.toggle('hidden', shouldRender);
  const fullShareBtn = $<HTMLButtonElement>('fullscreen-share-button');
  if (fullShareBtn) fullShareBtn.disabled = !media.sharingScreen;
  setText('remote-placeholder', media.sharingScreen ? 'Loading shared screen…' : media.audioOnly || !media.cameraEnabled ? 'Musician is in Audio Only' : 'Waiting for Musician');
  updateSessionStage();
}

function updateRemoteVolumes(): void {
  const master = Number($<HTMLInputElement>('remote-volume')?.value ?? 1);
  const voice = Number($<HTMLInputElement>('voice-fader')?.value ?? 1);
  const music = Number($<HTMLInputElement>('music-fader')?.value ?? 1);

  if (remoteAudioCtx && remoteAudioCtx.state !== 'closed') {
    const now = remoteAudioCtx.currentTime;
    if (remoteVoiceGain) remoteVoiceGain.gain.setValueAtTime(remoteMuted ? 0 : voice, now);
    if (remoteMusicGain) remoteMusicGain.gain.setValueAtTime(remoteMuted ? 0 : music, now);
    if (remoteMasterGain) remoteMasterGain.gain.setValueAtTime(remoteMuted ? 0 : master, now);
  }

  const voiceAudio = document.getElementById('remote-voice-audio') as HTMLAudioElement | null;
  const musicAudio = document.getElementById('remote-music-audio') as HTMLAudioElement | null;
  if (voiceAudio) voiceAudio.volume = remoteMuted ? 0 : Math.min(1.0, master * voice);
  if (musicAudio) musicAudio.volume = remoteMuted ? 0 : Math.min(1.0, master * music);

  setText('remote-volume-val', `${Math.round(master * 100)}%`);
  setText('voice-fader-val', `${Math.round(voice * 100)}%`);
  setText('music-fader-val', `${Math.round(music * 100)}%`);
}
function setCallStatus(status: string): void { setText('call-status', status); }

async function leaveSession(endedMessage?: string): Promise<void> {
  stopSessionTimer();
  logger.info('session_leave', 'Left session', { code: currentCode }, { sessionCode: currentCode });
  logger.setSessionContext(undefined);
  if (inCall) signaling.leave();
  inCall = false;
  rtc.dispose();
  for (const m of voiceMeters.values()) await m.stop();
  voiceMeters.clear();
  activeMicLevels.clear();
  audio.dispose();
  const sharing = screenTrack;
  screenTrack = undefined;
  if (sharing) { sharing.onended = null; sharing.stop(); }
  await presenter.stopNativeCapture();
  await presenter.exitPresenterMode();
  videoTrack?.stop();
  videoTrack = undefined;
  await musicMeter.stop();
  if (remoteVoiceMeter) {
    await remoteVoiceMeter.stop();
    remoteVoiceMeter = undefined;
  }
  lastLocalVoiceDb = -60;
  lastRemoteVoiceDb = -60;
  $('remote-tile')?.classList.remove('is-speaking');
  $('local-tile')?.classList.remove('is-speaking');
  closeSessionViewMenu();
  $('voice-in-indicator')?.classList.remove('active');
  $('music-in-indicator')?.classList.remove('active');
  remoteAudioTracks.clear();
  stopRemoteVoiceBridge();
  void refreshRemoteAudio();
  if (remoteAudioCtx && remoteAudioCtx.state !== 'closed') {
    void remoteAudioCtx.close().catch(() => {});
    remoteAudioCtx = undefined;
  }
  remoteMedia = undefined;
  currentCode = '';
  pending = undefined;
  peerIdentity = null;
  peerParticipantId = null;
  sessionProjectId = undefined;
  $('session-workspace-drawer')?.classList.add('hidden');
  $('toggle-session-workspace')?.classList.remove('active');
  $('toggle-session-workspace')?.classList.add('hidden');
  $('waiting-room-banner')?.classList.add('hidden');
  const waitingListEl = $('waiting-banner-list');
  if (waitingListEl) waitingListEl.innerHTML = '';
  sessionWorkspaceOpen = false;
  resetChatUi();
  isSessionLocked = false;
  updateLockUi();
  if (endedMessage) {
    setMessage('home-error', endedMessage, endedMessage.toLowerCase().includes('ended') || endedMessage.toLowerCase().includes('left'));
  }
  showView('home-view');
  if (!audioOnly) void replaceCamera(prefs.cameraId).catch(() => {});
  void syncAllVoiceMics().catch(() => {});
}

function bindSelect(id: string, handler: (value: string) => Promise<void>): void {
  const select = document.getElementById(id) as HTMLSelectElement | null;
  if (!select) return;
  select.addEventListener('change', async (event) => {
    const target = event.currentTarget as HTMLSelectElement;
    const previous = id.includes('camera') ? prefs.cameraId : id.includes('output') ? prefs.audioOutputId : prefs.audioInputId;
    try { await handler(target.value); await enumerateAndPopulate(); setMessage(inCall ? 'device-dialog-status' : 'setup-status', 'Device changed.'); }
    catch (error) { target.value = previous ?? ''; setMessage(inCall ? 'device-dialog-status' : 'setup-status', deviceError(error), true); }
  });
}

async function changeCameraQuality(quality: VideoQuality): Promise<void> {
  const previous = prefs.cameraQuality;
  prefs.cameraQuality = quality;
  savePreferences();
  try {
    if (inCall) await rtc.videoQualityChanged(effectiveVideoQuality(quality));
    if (!screenTrack) await replaceCamera(prefs.cameraId);
    await enumerateAndPopulate();
    setMessage(inCall ? 'device-dialog-status' : 'setup-status', `Camera quality set to ${quality}.`);
  } catch (error) {
    prefs.cameraQuality = previous;
    savePreferences();
    if (inCall) await rtc.videoQualityChanged(effectiveVideoQuality(previous));
    await enumerateAndPopulate();
    throw error;
  }
}

async function changeReceiveQuality(quality: VideoQuality): Promise<void> {
  prefs.receiveQuality = quality;
  savePreferences();
  if (inCall) signaling.updateMedia(currentCode, metadata());
  await enumerateAndPopulate();
  setMessage(inCall ? 'device-dialog-status' : 'setup-status', `Received video preference set to ${quality}.`);
}

async function changePerformanceMode(mode: PerformanceMode): Promise<void> {
  prefs.performanceMode = mode;
  savePreferences();
  if (inCall) await rtc.videoQualityChanged(effectiveVideoQuality(prefs.cameraQuality));
  if (inCall) await rtc.musicQualityChanged(effectiveMusicBitrate());
  if (!screenTrack && videoTrack) await replaceCamera(prefs.cameraId);
  await syncAllVoiceMics(prefs.mode);
  if (inCall) signaling.updateMedia(currentCode, metadata());
  await enumerateAndPopulate();
}

async function setAudioOnly(enabled: boolean): Promise<void> {
  audioOnly = enabled;
  prefs.audioOnly = enabled;
  savePreferences();
  if (enabled) {
    cameraEnabled = false;
    videoTrack?.stop();
    videoTrack = undefined;
    if (inCall && !screenTrack) await rtc.removeVideoTrack();
  } else {
    cameraEnabled = true;
    if (!screenTrack) await replaceCamera(prefs.cameraId);
  }
  const audioBtn = $('audio-only-button');
  if (audioBtn) audioBtn.textContent = enabled ? 'Enable Video' : 'Audio Only';
  $('camera-button')?.classList.toggle('hidden', enabled);
  updateCameraButtonState();
  updateLocalPreviews();
  if (inCall) signaling.updateMedia(currentCode, metadata());
}

function updateCameraButtonState(): void {
  const camBtn = document.getElementById('camera-button');
  if (camBtn) camBtn.textContent = cameraEnabled ? 'Stop Camera' : 'Start Camera';

  const toggleCam = document.getElementById('toggle-camera');
  if (toggleCam) {
    toggleCam.classList.toggle('active', cameraEnabled);
    toggleCam.classList.toggle('muted', !cameraEnabled);
    toggleCam.innerHTML = `<span class="tool-icon">${cameraEnabled ? icons.video({ size: 18 }) : icons.videoOff({ size: 18 })}</span><span class="tool-text">${cameraEnabled ? 'Stop Camera' : 'Start Camera'}</span>`;
  }
}

async function toggleCamera(): Promise<void> {
  if (audioOnly) return;
  if (cameraEnabled) {
    cameraEnabled = false;
    videoTrack?.stop();
    videoTrack = undefined;
    if (inCall && !screenTrack) await rtc.removeVideoTrack();
  } else {
    cameraEnabled = true;
    if (screenTrack) {
      videoTrack = await acquireVideo(prefs.cameraId);
    } else {
      await replaceCamera(prefs.cameraId);
    }
  }
  updateCameraButtonState();
  updateLocalPreviews();
  if (inCall) signaling.updateMedia(currentCode, metadata());
}

async function applyAdvancedAudioSettings(): Promise<void> {
  await syncAllVoiceMics(prefs.mode);
  await replaceMusicInput();
  await enumerateAndPopulate();
}

function updateHeadphoneWarning(): void {
  const outputs = $<HTMLSelectElement>('audio-output-select');
  const label = outputs.selectedOptions[0]?.textContent?.toLowerCase() ?? '';
  const headphones = /headphone|headset|airpods|buds|phones/.test(label);
  const warning = prefs.mode === 'music';
  $('music-warning').classList.toggle('hidden', !warning);
  $('call-warning').classList.toggle('hidden', !warning);
  if (warning) $('music-warning').innerHTML = `${headphones ? icons.headphones({ size: 16 }) : icons.alertTriangle({ size: 16 })} <span>${headphones ? 'Music Mode is unprocessed. Keep headphones connected to prevent feedback.' : 'Music Mode disables echo cancellation. The selected output may be speakers; headphones are recommended to prevent feedback.'}</span>`;
}

async function fullscreenRemote(requireShare: boolean): Promise<void> {
  if (requireShare && !remoteMedia?.sharingScreen) return;
  const tile = $<HTMLVideoElement>('remote-video').closest<HTMLElement>('.video-tile');
  if (tile && document.fullscreenElement !== tile) await tile.requestFullscreen();
}

$('create-button').addEventListener('click', () => {
  if (!auth.getUser()) {
    openAuthView('login');
    return;
  }
  void prepareStudio({ type: 'create' });
});
$('home-settings-button')?.addEventListener('click', async () => {
  try {
    await enumerateAndPopulate();
    $<HTMLDialogElement>('devices-dialog').showModal();
  } catch (error) {
    setMessage('home-error', deviceError(error), true);
  }
});
$('join-button').addEventListener('click', () => {
  const code = normalizeMeetingCode($<HTMLInputElement>('join-code').value);
  const parsed = meetingCodeSchema.safeParse(code);
  if (!parsed.success) return setMessage('home-error', 'Enter a valid 8-character session code.', true);
  if (!auth.getUser()) {
    pendingJoinCode = code;
    openAuthView('login');
    return;
  }
  void prepareStudio({ type: 'join', code });
});
$<HTMLInputElement>('join-code').addEventListener('keydown', (event) => { if (event.key === 'Enter') $('join-button').click(); });
$('setup-cancel').addEventListener('click', async () => {
  for (const m of voiceMeters.values()) await m.stop();
  voiceMeters.clear();
  activeMicLevels.clear();
  audio.dispose();
  videoTrack?.stop();
  videoTrack = undefined;
  await musicMeter.stop();
  showView('home-view');
});
for (const id of ['setup-advanced-button', 'setup-advanced-action-button']) {
  $(id)?.addEventListener('click', async () => {
    try {
      await enumerateAndPopulate();
      $<HTMLDialogElement>('devices-dialog').showModal();
    } catch (error) {
      setMessage('setup-status', deviceError(error), true);
    }
  });
}
$('enter-session').addEventListener('click', () => void enterSession().catch((error) => setMessage('setup-status', deviceError(error), true)));
$('speaker-test').addEventListener('click', () => void testSpeakers().then(() => setMessage('setup-status', 'Speaker test complete.')).catch((error) => setMessage('setup-status', deviceError(error), true)));
$('microphone-test').addEventListener('click', () => void testMicrophone().catch((error) => setMessage('setup-status', deviceError(error), true)));

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="setup-mode"]')) {
  radio.addEventListener('change', () => void syncAllVoiceMics(radio.value as AudioMode)
    .then(() => { updateMusicWarning(); setMessage('setup-status', `${radio.value === 'music' ? 'Music' : 'Talk'} Mode ready.`); })
    .catch((error) => { setModeRadios(prefs.mode); setMessage('setup-status', deviceError(error), true); }));
}
bindSelect('camera-select', (value) => replaceCamera(value || undefined));
bindSelect('call-camera-select', (value) => replaceCamera(value || undefined));
bindSelect('music-input-select', async (value) => { prefs.musicInputId = value || undefined; await replaceMusicInput(); await enumerateAndPopulate(); });
bindSelect('call-music-input-select', async (value) => { prefs.musicInputId = value || undefined; await replaceMusicInput(); await enumerateAndPopulate(); });
bindSelect('audio-output-select', async (value) => { await setOutputDevice(value || undefined); await enumerateAndPopulate(); });
bindSelect('call-audio-output-select', async (value) => { await setOutputDevice(value || undefined); await enumerateAndPopulate(); });

for (const id of ['add-voice-mic-btn', 'call-add-voice-mic-btn']) {
  $(id)?.addEventListener('click', async () => {
    const newId = (prefs.voiceInputs.reduce((max, m) => Math.max(max, m.id), 0) || 0) + 1;
    const channelSuggestion = String(Math.min(32, newId));
    const newMic: VoiceInputConfig = {
      id: newId,
      name: `Microphone ${newId} (Singer / Musician / Room)`,
      deviceId: prefs.voiceInputs[0]?.deviceId,
      channelRoute: channelSuggestion,
      gain: 1.0,
      enabled: true
    };
    prefs.voiceInputs.push(newMic);
    savePreferences();
    await syncAllVoiceMics();
    await enumerateAndPopulate();
    setMessage(inCall ? 'device-dialog-status' : 'setup-status', `Microphone ${newId} added.`);
  });
}

for (const id of ['music-source-type-select', 'call-music-source-type-select']) {
  $<HTMLSelectElement>(id)?.addEventListener('change', async (event) => {
    const val = (event.currentTarget as HTMLSelectElement).value as 'app' | 'interface' | 'system' | 'none';
    prefs.musicSourceType = val;
    savePreferences();
    for (const other of ['music-source-type-select', 'call-music-source-type-select']) {
      const el = $<HTMLSelectElement>(other);
      if (el && el !== event.currentTarget) el.value = val;
    }
    const isApp = val === 'app';
    const isInterface = val === 'interface';
    const isSystem = val === 'system';
    $('music-app-group')?.classList.toggle('hidden', !isApp);
    $('call-music-app-group')?.classList.toggle('hidden', !isApp);
    $('music-interface-group')?.classList.toggle('hidden', !isInterface);
    $('call-music-interface-group')?.classList.toggle('hidden', !isInterface);
    $('music-system-group')?.classList.toggle('hidden', !isSystem);
    $('call-music-system-group')?.classList.toggle('hidden', !isSystem);

    try {
      await replaceMusicInput();
      setMessage(inCall ? 'device-dialog-status' : 'setup-status', `Music Source: ${val === 'app' ? 'Application Audio' : val === 'interface' ? 'Audio Interface Output' : val === 'system' ? 'Computer Audio' : 'Disabled'}`);
    } catch (error) {
      setMessage(inCall ? 'device-dialog-status' : 'setup-status', deviceError(error), true);
    }
  });
}

for (const id of ['music-app-select', 'call-music-app-select']) {
  $<HTMLSelectElement>(id)?.addEventListener('change', async (event) => {
    const pid = Number((event.currentTarget as HTMLSelectElement).value);
    prefs.musicAppPid = pid;
    const matched = cachedRunningApps.find((a) => a.pid === pid);
    if (matched) prefs.musicAppName = matched.name;
    savePreferences();
    updateAppIconBadge(pid);
    for (const other of ['music-app-select', 'call-music-app-select']) {
      const el = $<HTMLSelectElement>(other);
      if (el && el !== event.currentTarget) el.value = String(pid);
    }
    try {
      await replaceMusicInput();
      setMessage(inCall ? 'device-dialog-status' : 'setup-status', `Capturing ${prefs.musicAppName || 'App'}`);
    } catch (error) {
      setMessage(inCall ? 'device-dialog-status' : 'setup-status', deviceError(error), true);
    }
  });
}

for (const id of ['refresh-apps-button', 'call-refresh-apps-button']) {
  $(id)?.addEventListener('click', async () => {
    try {
      await refreshRunningApps();
      setMessage(inCall ? 'device-dialog-status' : 'setup-status', 'Refreshed running audio applications.');
    } catch (error) {
      setMessage(inCall ? 'device-dialog-status' : 'setup-status', deviceError(error), true);
    }
  });
}
bindSelect('camera-quality-select', (value) => changeCameraQuality(value as VideoQuality));
bindSelect('call-camera-quality-select', (value) => changeCameraQuality(value as VideoQuality));
bindSelect('receive-quality-select', (value) => changeReceiveQuality(value as VideoQuality));
bindSelect('call-receive-quality-select', (value) => changeReceiveQuality(value as VideoQuality));
bindSelect('performance-select', (value) => changePerformanceMode(value as PerformanceMode));
bindSelect('call-performance-select', (value) => changePerformanceMode(value as PerformanceMode));

function syncMediaActiveState(): void {
  const isMicLive = !muted && audio.hasActiveSources();
  const isCamLive = Boolean(cameraEnabled && videoTrack && videoTrack.readyState === 'live');
  const isScreenLive = Boolean(screenTrack && screenTrack.readyState === 'live');
  const isAnyLive = Boolean(isCamLive || isScreenLive || isMicLive);
  const desktopApi = (window as any).jameet || (window as any).musiczoom;
  if (desktopApi?.setMediaActive) {
    desktopApi.setMediaActive(isAnyLive);
  }
}
setInterval(syncMediaActiveState, 500);

function toggleMute(): void {
  muted = !muted;
  audio.setEnabled('voice', !muted);
  const muteBtn = $('mute-button');
  if (muteBtn) muteBtn.textContent = muted ? 'Unmute' : 'Mute';
  const toggleMic = $('toggle-mic');
  if (toggleMic) {
    toggleMic.classList.toggle('active', !muted);
    toggleMic.classList.toggle('muted', muted);
    toggleMic.innerHTML = `<span class="tool-icon">${muted ? icons.micOff({ size: 18 }) : icons.mic({ size: 18 })}</span><span class="tool-text">${muted ? 'Unmute Mic' : 'Mute Mic'}</span>`;
  }
  if (muted) $('voice-in-indicator')?.classList.remove('active');
  if (inCall) signaling.updateMedia(currentCode, metadata());
  syncMediaActiveState();
}

for (const id of ['toggle-mic', 'mute-button']) $(id)?.addEventListener('click', toggleMute);

for (const id of ['toggle-camera', 'camera-button']) {
  $(id)?.addEventListener('click', () => void toggleCamera().catch((error) => setCallStatus(deviceError(error))));
}

for (const id of ['toggle-screen', 'screen-button']) {
  $(id)?.addEventListener('click', () => void showScreenPicker().then(() => {
    $('toggle-screen')?.classList.toggle('active', Boolean(screenTrack));
  }).catch((error) => setCallStatus(deviceError(error))));
}

$('mode-music-btn')?.addEventListener('click', () => {
  if (prefs.mode !== 'music') {
    void replaceAudioInput(prefs.audioInputId, 'music').catch((e) => setCallStatus(deviceError(e)));
  }
});
$('mode-talk-btn')?.addEventListener('click', () => {
  if (prefs.mode !== 'talk') {
    void replaceAudioInput(prefs.audioInputId, 'talk').catch((e) => setCallStatus(deviceError(e)));
  }
});
$('mode-button')?.addEventListener('click', () => {
  const next: AudioMode = prefs.mode === 'music' ? 'talk' : 'music';
  void replaceAudioInput(prefs.audioInputId, next).catch((error) => setCallStatus(deviceError(error)));
});

$('audio-only-button')?.addEventListener('click', () => void setAudioOnly(!audioOnly).catch((error) => setCallStatus(deviceError(error))));
$<HTMLInputElement>('audio-only-setup')?.addEventListener('change', (event) => void setAudioOnly((event.currentTarget as HTMLInputElement).checked).catch((error) => setMessage('setup-status', deviceError(error), true)));

for (const id of ['open-settings', 'devices-button']) {
  $(id)?.addEventListener('click', () => {
    void enumerateAndPopulate();
    $<HTMLDialogElement>('devices-dialog').showModal();
  });
}

for (const id of ['leave-call', 'leave-button']) {
  $(id)?.addEventListener('click', () => void leaveSession('You left the session.'));
}
$('home-button')?.addEventListener('click', () => showView('home-view'));

$('copy-invite')?.addEventListener('click', () => {
  if (!currentCode) return;
  const link = `jameet://join/${currentCode}`;
  const api = window.jameet || window.musiczoom;
  void (api?.copyText ? api.copyText(link) : Promise.reject()).then(() => {
    const btn = $('copy-invite');
    if (btn) {
      const origHtml = btn.innerHTML;
      btn.innerHTML = `${icons.check({ size: 13 })} <span>Copied!</span>`;
      window.setTimeout(() => { btn.innerHTML = origHtml; }, 1800);
    }
  }).catch(() => {
    void navigator.clipboard?.writeText(link);
    const btn = $('copy-invite');
    if (btn) {
      const origHtml = btn.innerHTML;
      btn.innerHTML = `${icons.check({ size: 13 })} <span>Copied!</span>`;
      window.setTimeout(() => { btn.innerHTML = origHtml; }, 1800);
    }
  });
});

// ========================================================
// Presenter Mode Coordination & In-Session Return Banner
// ========================================================
presenter.setActionHandler(async (action) => {
  switch (action) {
    case 'toggle-mic':
      toggleMute();
      presenter.updateState({ micMuted: muted });
      break;
    case 'toggle-cam':
      void toggleCamera().then(() => {
        presenter.updateState({ camEnabled: cameraEnabled });
      }).catch((e) => setCallStatus(deviceError(e)));
      break;
    case 'toggle-mode': {
      const next: AudioMode = prefs.mode === 'music' ? 'talk' : 'music';
      void replaceAudioInput(prefs.audioInputId, next).then(() => {
        presenter.updateState({ mode: prefs.mode });
      }).catch((e) => setCallStatus(deviceError(e)));
      break;
    }
    case 'toggle-workspace':
      setSessionWorkspaceOpen(!sessionWorkspaceOpen);
      break;
    case 'toggle-pause':
      if (screenTrack) {
        screenTrack.enabled = !screenTrack.enabled;
        presenter.updateState({ paused: !screenTrack.enabled });
        setCallStatus(screenTrack.enabled ? `Sharing: ${currentSharingSourceTitle || 'Screen'}` : 'Screen Share Paused');
      }
      break;
    case 'toggle-layout': {
      const isAnySharing = Boolean(screenTrack) || Boolean(remoteMedia?.sharingScreen && remoteVideoStream);
      if (isAnySharing) {
        if (currentScreenViewMode === 'screen-view') currentScreenViewMode = 'side-by-side';
        else if (currentScreenViewMode === 'side-by-side') currentScreenViewMode = 'screen-focus';
        else currentScreenViewMode = 'screen-view';
      } else {
        if (currentCameraViewMode === 'gallery') currentCameraViewMode = 'speaker';
        else if (currentCameraViewMode === 'speaker') currentCameraViewMode = 'focus';
        else currentCameraViewMode = 'gallery';
      }
      applyParticipantViewLayout();
      break;
    }
    case 'show-main-window':
      await presenter.showMainWindow();
      $('session-presenter-banner')?.classList.remove('hidden');
      break;
    case 'change-source':
      await presenter.showMainWindow();
      $('session-presenter-banner')?.classList.remove('hidden');
      void showScreenPicker();
      break;
    case 'open-remote-mixer':
      await presenter.showMainWindow();
      $('session-presenter-banner')?.classList.remove('hidden');
      $<HTMLDialogElement>('remote-mixer-dialog')?.showModal();
      break;
    case 'open-audio-settings':
      await presenter.showMainWindow();
      $('session-presenter-banner')?.classList.remove('hidden');
      void enumerateAndPopulate();
      $<HTMLDialogElement>('devices-dialog')?.showModal();
      break;
    case 'toggle-floating-video':
      await presenter.toggleRemoteVideoPiP();
      break;
    case 'stop-share':
      await stopScreenShare();
      break;
  }
});

$('btn-return-presenter')?.addEventListener('click', () => {
  $('session-presenter-banner')?.classList.add('hidden');
  void presenter.enterPresenterMode({
    micMuted: muted,
    camEnabled: cameraEnabled,
    mode: prefs.mode,
    paused: screenTrack ? !screenTrack.enabled : false,
    pipVisible: true
  });
});

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    if (inCall) toggleMute();
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    if (inCall) void toggleCamera().catch(() => {});
  }
  if (e.key === 'Escape') {
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close());
  }
});

for (const id of ['voice-channel-select', 'call-voice-channel-select']) {
  $<HTMLSelectElement>(id)?.addEventListener('change', async (event) => {
    const val = (event.currentTarget as HTMLSelectElement).value;
    prefs.voiceChannel = val;
    savePreferences();
    for (const other of ['voice-channel-select', 'call-voice-channel-select']) {
      const el = $<HTMLSelectElement>(other);
      if (el && el !== event.currentTarget) el.value = val;
    }
    try {
      await replaceAudioInput(prefs.audioInputId);
      setMessage(inCall ? 'device-dialog-status' : 'setup-status', `Voice Input routed to: ${val}`);
    } catch (error) {
      setMessage(inCall ? 'device-dialog-status' : 'setup-status', deviceError(error), true);
    }
  });
}

for (const id of ['music-channel-select', 'call-music-channel-select']) {
  $<HTMLSelectElement>(id)?.addEventListener('change', async (event) => {
    const val = (event.currentTarget as HTMLSelectElement).value;
    prefs.musicChannel = val;
    savePreferences();
    for (const other of ['music-channel-select', 'call-music-channel-select']) {
      const el = $<HTMLSelectElement>(other);
      if (el && el !== event.currentTarget) el.value = val;
    }
    try {
      await replaceMusicInput();
      setMessage(inCall ? 'device-dialog-status' : 'setup-status', `Hardware Output routed to: Output ${val}`);
    } catch (error) {
      setMessage(inCall ? 'device-dialog-status' : 'setup-status', deviceError(error), true);
    }
  });
}

for (const id of ['output-channel-select', 'call-output-channel-select']) {
  $<HTMLSelectElement>(id)?.addEventListener('change', async (event) => {
    const val = (event.currentTarget as HTMLSelectElement).value;
    prefs.outputChannel = val;
    savePreferences();
    for (const other of ['output-channel-select', 'call-output-channel-select']) {
      const el = $<HTMLSelectElement>(other);
      if (el && el !== event.currentTarget) el.value = val;
    }
    try {
      await setOutputDevice(prefs.audioOutputId);
      setMessage(inCall ? 'device-dialog-status' : 'setup-status', `Output routed to: ${val}`);
    } catch (error) {
      setMessage(inCall ? 'device-dialog-status' : 'setup-status', deviceError(error), true);
    }
  });
}

$('call-output-volume')?.addEventListener('input', (event) => {
  const val = Number((event.currentTarget as HTMLInputElement).value);
  prefs.outputVolume = val;
  savePreferences();
  const label = document.getElementById('call-output-volume-val');
  if (label) label.textContent = `${Math.round(val * 100)}%`;
  updateRemoteVolumes();
});

$('test-output-both')?.addEventListener('click', () => void testSpeakers('both').then(() => setMessage('device-dialog-status', 'Stereo test complete.')).catch((e) => setMessage('device-dialog-status', deviceError(e), true)));
$('test-output-left')?.addEventListener('click', () => void testSpeakers('left').then(() => setMessage('device-dialog-status', 'Left channel test complete.')).catch((e) => setMessage('device-dialog-status', deviceError(e), true)));
$('test-output-right')?.addEventListener('click', () => void testSpeakers('right').then(() => setMessage('device-dialog-status', 'Right channel test complete.')).catch((e) => setMessage('device-dialog-status', deviceError(e), true)));

for (const id of ['channel-mode-select', 'call-channel-mode-select']) {
  $<HTMLSelectElement>(id)?.addEventListener('change', async (event) => {
    const isStereo = (event.currentTarget as HTMLSelectElement).value === 'stereo';
    prefs.stereoMusic = isStereo;
    savePreferences();
    try {
      await applyAdvancedAudioSettings();
      const actualChannels = audio.primary?.track.getSettings().channelCount ?? audio.primary?.effective.channelCount ?? (isStereo ? 2 : 1);
      setMessage(inCall ? 'device-dialog-status' : 'setup-status', `Hardware Channels: ${actualChannels === 1 ? 'Mono' : 'Stereo'}`);
    } catch (error) {
      setMessage(inCall ? 'device-dialog-status' : 'setup-status', deviceError(error), true);
    }
  });
}
for (const id of ['open-system-audio', 'call-open-system-audio']) {
  $(id)?.addEventListener('click', () => {
    const desktopApi = typeof window !== 'undefined' ? (window.jameet || window.musiczoom) : undefined;
    void desktopApi?.openSystemAudioSettings?.();
  });
}
for (const id of ['sample-rate-select', 'call-sample-rate-select']) {
  $<HTMLSelectElement>(id)?.addEventListener('change', async (event) => {
    const value = Number((event.currentTarget as HTMLSelectElement).value);
    prefs.sampleRate = value || undefined;
    savePreferences();
    try {
      const desktopApi = typeof window !== 'undefined' ? (window.jameet || window.musiczoom) : undefined;
      if (value > 0 && desktopApi?.setSystemSampleRate) {
        await desktopApi.setSystemSampleRate(value);
      }
      await applyAdvancedAudioSettings();
      const rateLabel = value ? `${value.toLocaleString()} Hz` : 'Device Default';
      setMessage(inCall ? 'device-dialog-status' : 'setup-status', `Hardware & System Rate set to ${rateLabel}`);
    } catch (error) {
      setMessage(inCall ? 'device-dialog-status' : 'setup-status', deviceError(error), true);
    }
  });
}
for (const id of ['music-quality-select', 'call-music-quality-select']) {
  $<HTMLSelectElement>(id)?.addEventListener('change', (event) => {
    prefs.musicBitrate = Number((event.currentTarget as HTMLSelectElement).value);
    savePreferences();
    if (inCall) void rtc.musicQualityChanged(effectiveMusicBitrate());
    void enumerateAndPopulate();
  });
}
for (const id of ['input-gain', 'call-input-gain']) {
  $<HTMLInputElement>(id)?.addEventListener('input', (event) => {
    const val = Number((event.currentTarget as HTMLInputElement).value);
    prefs.inputGain = val;
    for (const labelId of ['gain-value', 'call-gain-value']) {
      const el = document.getElementById(labelId);
      if (el) el.textContent = `${Math.round(val * 100)}%`;
    }
    for (const otherId of ['input-gain', 'call-input-gain']) {
      const el = $<HTMLInputElement>(otherId);
      if (el && el !== event.currentTarget) el.value = String(val);
    }
    savePreferences();
    void audio.applyVoiceGain(val);
    const desktopApi = typeof window !== 'undefined' ? (window.jameet || window.musiczoom) : undefined;
    if (desktopApi?.setSystemInputVolume) {
      void desktopApi.setSystemInputVolume(Math.min(1.0, val));
    }
  });
}
for (const id of ['remote-volume', 'voice-fader', 'music-fader']) {
  document.getElementById(id)?.addEventListener('input', updateRemoteVolumes);
}
$('remote-mute-button')?.addEventListener('click', () => {
  remoteMuted = !remoteMuted;
  setText('remote-mute-button', remoteMuted ? 'Unmute Remote' : 'Mute Remote');
  updateRemoteVolumes();
});
$('fullscreen-video-button')?.addEventListener('click', () => void fullscreenRemote(false));
$('fullscreen-share-button')?.addEventListener('click', () => void fullscreenRemote(true));

// Screen Sharing Tabs & Floating Stop Button
$('tab-btn-apps')?.addEventListener('click', () => {
  $('tab-btn-apps')?.classList.add('active');
  $('tab-btn-screens')?.classList.remove('active');
  $('section-apps')?.classList.remove('hidden');
  $('section-screens')?.classList.add('hidden');
});

$('tab-btn-screens')?.addEventListener('click', () => {
  $('tab-btn-screens')?.classList.add('active');
  $('tab-btn-apps')?.classList.remove('active');
  $('section-screens')?.classList.remove('hidden');
  $('section-apps')?.classList.add('hidden');
});

$('btn-stop-share-floating')?.addEventListener('click', () => void stopScreenShare());
$('stage-stop-share-btn')?.addEventListener('click', () => void stopScreenShare());

// Session View Selector Controls
$('session-view-btn')?.addEventListener('click', (e) => {
  toggleSessionViewMenu(e);
});

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement | null;
  if (!target?.closest('#session-view-selector')) {
    closeSessionViewMenu();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSessionViewMenu();
  }
});

// Session Diagnostics & Stats Modal Management
let statsTimerHandle: number | undefined;

async function refreshStatsModal(): Promise<void> {
  const report = await rtc.getStatsReport();
  if (!report) {
    setText('stat-conn-state', inCall ? 'Connecting P2P…' : 'Standby');
    setText('stat-ice-state', inCall ? 'Negotiating ICE…' : 'Not Connected');
    setText('stat-rtt', '—');
    setText('stat-jitter', '—');
    setText('stat-loss', '—');
    setText('stat-audio-bitrate', '—');
    setText('stat-video-out', '—');
    setText('stat-video-in', '—');
    setText('stat-video-bitrate', '—');
    return;
  }

  // Connection & Latency
  const connStateText = report.connectionState === 'connected' ? 'Connected' : report.connectionState === 'connecting' ? 'Connecting' : report.connectionState;
  setText('stat-conn-state', connStateText);
  setText('stat-ice-state', `${report.candidateType} (${report.protocol})`);
  setText('stat-rtt', report.rttMs !== null ? `${report.rttMs} ms` : inCall ? '< 1 ms (Local/Direct)' : '—');
  setText('stat-jitter', report.audioJitterMs !== null ? `${report.audioJitterMs} ms` : '0 ms');
  setText('stat-loss', `${report.packetLossPercent.toFixed(1)}%`);

  // Audio Fidelity & Clock
  const profileName = prefs.mode === 'music' ? 'Music Mode (Unprocessed Stereo 48 kHz)' : 'Talk Mode (Speech Enhanced & AEC)';
  setText('stat-audio-profile', profileName);
  setText('stat-audio-bitrate', `Tx: ${report.audioOutKbps} kbps · Rx: ${report.audioInKbps} kbps`);
  setText('stat-audio-codec', report.audioCodec);
  const activeRate = prefs.sampleRate ?? audio.primary?.effective.sampleRate ?? 44100;
  setText('stat-sample-rate', `${activeRate.toLocaleString()} Hz (CoreAudio Engine)`);
  
  const activeMicCount = (prefs.voiceInputs || []).filter((v) => v.enabled).length;
  setText('stat-active-mics', `${activeMicCount} Active Input${activeMicCount === 1 ? '' : 's'}`);

  // Video & Screen Performance
  const outRes = report.videoResolutionOut ? `${report.videoResolutionOut}${report.videoFpsOut ? ` @ ${report.videoFpsOut} FPS` : ''}` : screenTrack ? '1920×1080 @ 30 FPS (Screen)' : videoTrack && cameraEnabled ? '1280×720 @ 30 FPS (Camera)' : 'Disabled';
  const inRes = report.videoResolutionIn ? `${report.videoResolutionIn}${report.videoFpsIn ? ` @ ${report.videoFpsIn} FPS` : ''}` : remoteVideoStream ? '1280×720 @ 30 FPS' : 'Waiting for remote stream…';
  
  setText('stat-video-out', outRes);
  setText('stat-video-in', inRes);
  setText('stat-video-bitrate', `Tx: ${report.videoOutKbps} kbps · Rx: ${report.videoInKbps} kbps`);
  setText('stat-video-codec', report.videoCodec);
}

function openStatsDialog(): void {
  const dialog = $<HTMLDialogElement>('stats-dialog');
  if (!dialog) return;
  void refreshStatsModal();
  if (statsTimerHandle) window.clearInterval(statsTimerHandle);
  statsTimerHandle = window.setInterval(() => {
    if (dialog.open) void refreshStatsModal();
  }, 1000);
  dialog.showModal();
}

$('call-stats-btn')?.addEventListener('click', () => {
  openStatsDialog();
});

$<HTMLDialogElement>('stats-dialog')?.addEventListener('close', () => {
  if (statsTimerHandle) {
    window.clearInterval(statsTimerHandle);
    statsTimerHandle = undefined;
  }
});

$('stats-dialog')?.addEventListener('click', (e) => {
  const dialog = $<HTMLDialogElement>('stats-dialog');
  if (e.target === dialog) {
    dialog.close();
  }
});

function updateParticipantIdentityUi(): void {
  const localLabel = myIdentity
    ? `${myIdentity.displayName}${myIdentity.isHost ? ' (Host)' : myIdentity.isGuest ? ' (Guest)' : ''}`
    : 'You';
  setText('local-user-name', localLabel);
  const localIconEl = $('local-user-icon');
  if (localIconEl) localIconEl.innerHTML = myIdentity?.isHost ? icons.crown({ size: 12 }) : icons.headphones({ size: 12 });

  const remoteLabel = peerIdentity
    ? `${peerIdentity.displayName}${peerIdentity.username ? ` (@${peerIdentity.username})` : ''}${peerIdentity.isHost ? ' (Host)' : peerIdentity.isGuest ? ' (Guest)' : ''}`
    : 'Musician';
  setText('remote-user-name', remoteLabel);
  const remoteIconEl = $('remote-user-icon');
  if (remoteIconEl) remoteIconEl.innerHTML = peerIdentity?.isHost ? icons.crown({ size: 12 }) : icons.user({ size: 12 });

  const removeBtn = $('btn-remove-participant');
  if (removeBtn) {
    if (currentRole === 'host' && Boolean(peerParticipantId)) {
      removeBtn.classList.remove('hidden');
    } else {
      removeBtn.classList.add('hidden');
    }
  }

  updateSessionViewButton();
  renderSessionViewMenu();
}

let editingAvatarColor = '#06b6d4';
let editingAvatarUrl: string | undefined = undefined;

function applyAvatarToElement(
  el: HTMLElement | null,
  displayName: string,
  avatarColor = '#06b6d4',
  avatarUrl?: string
): void {
  if (!el) return;
  const initials = displayName
    ? displayName.trim().split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'U';
  if (avatarUrl) {
    el.textContent = '';
    el.style.backgroundImage = `url("${avatarUrl}")`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.backgroundColor = 'transparent';
  } else {
    const safeColor = safeAvatarColor(avatarColor, '#06b6d4');
    el.textContent = initials;
    el.style.backgroundImage = 'none';
    el.style.backgroundColor = safeColor;
    el.style.background = `linear-gradient(135deg, ${safeColor}, #0284c7)`;
  }
}

function highlightActiveSwatch(color: string): void {
  const swatches = document.querySelectorAll<HTMLButtonElement>('.color-swatch-btn');
  swatches.forEach((swatch) => {
    const swatchColor = swatch.dataset.color?.toLowerCase();
    swatch.classList.toggle('active', swatchColor === color.toLowerCase());
  });
}

function updateProfileLivePreview(): void {
  const nameInput = $<HTMLInputElement>('profile-edit-display-name')?.value.trim();
  const roleInput = $<HTMLInputElement>('profile-edit-role')?.value.trim();
  const locInput = $<HTMLInputElement>('profile-edit-location')?.value.trim();
  const dawInput = $<HTMLSelectElement>('profile-edit-daw')?.value.trim();

  const user = auth.getUser();
  const name = nameInput || user?.displayName || 'Musician';
  setText('profile-display-name', name);
  setText('profile-role-text', roleInput || 'Musician');

  const locChip = $('profile-location-chip');
  if (locChip) {
    locChip.classList.toggle('hidden', !locInput);
    setText('profile-location-text', locInput);
  }

  const dawChip = $('profile-daw-chip');
  if (dawChip) {
    dawChip.classList.toggle('hidden', !dawInput);
    setText('profile-daw-text', dawInput);
  }

  const circle = $('profile-avatar-circle');
  applyAvatarToElement(circle, name, editingAvatarColor, editingAvatarUrl);
  const largePrev = $('avatar-upload-preview');
  applyAvatarToElement(largePrev, name, editingAvatarColor, editingAvatarUrl);
}

function switchProfileSubtab(tabName: 'info' | 'avatar' | 'security'): void {
  const tabs = ['info', 'avatar', 'security'] as const;
  for (const t of tabs) {
    const isCur = t === tabName;
    $(`profile-subtab-${t}`)?.classList.toggle('active', isCur);
    $(`profile-panel-${t}`)?.classList.toggle('hidden', !isCur);
  }
}

function showProfileFeedback(msg: string, type: 'error' | 'success' | 'info'): void {
  const el = $('profile-feedback-msg');
  if (!el) return;
  el.textContent = msg;
  el.className = `message ${type}`;
  el.classList.remove('hidden');
  if (type === 'success') {
    setTimeout(() => {
      el.classList.add('hidden');
    }, 4000);
  }
}

// User Authentication, Personalized Home & Identity Management
function updateAuthUi(user: UserProfile | null, guestName: string): void {
  const isLogged = Boolean(user);
  const avatarBg = safeAvatarColor(user?.avatarColor, '#38bdf8');
  const avatarUrl = user?.avatarUrl;

  // 1. Home Navigation Bar Controls
  const navGuest = $('home-auth-nav-guest');
  const navUser = $('home-auth-nav-user');
  if (navGuest) navGuest.classList.toggle('hidden', isLogged);
  if (navUser) navUser.classList.toggle('hidden', !isLogged);

  if (isLogged && user) {
    setText('nav-user-name', user.displayName);
    setText('nav-user-handle', `@${user.username}`);
    const navAvatar = $('nav-user-avatar');
    applyAvatarToElement(navAvatar, user.displayName, avatarBg, avatarUrl);
  }

  // 2. Home Hero Area (Personalized for logged in vs Guest)
  const homeHeroUser = $('home-user-hero');
  const homeHeroGuest = $('home-guest-hero');
  const recentSection = $('recent-sessions-section');
  const scheduledSection = $('scheduled-sessions-section');
  const projectsSection = $('projects-section');
  if (homeHeroUser) homeHeroUser.classList.toggle('hidden', !isLogged);
  if (homeHeroGuest) homeHeroGuest.classList.toggle('hidden', isLogged);
  if (scheduledSection) scheduledSection.classList.toggle('hidden', !isLogged);
  if (recentSection) recentSection.classList.toggle('hidden', !isLogged);
  if (projectsSection) projectsSection.classList.toggle('hidden', !isLogged);

  if (isLogged && user) {
    setText('home-user-greeting', user.displayName);
    setText('home-user-handle-display', `@${user.username}`);
    setText('home-user-email-display', user.email);
    const heroAvatar = $('home-hero-avatar');
    applyAvatarToElement(heroAvatar, user.displayName, avatarBg, avatarUrl);

    const createBtn = $<HTMLButtonElement>('create-button');
    if (createBtn) createBtn.textContent = `Start New Session (Host as ${user.displayName})`;
    void loadScheduledSessions();
    void loadRecentSessions();
    void loadProjects();
  } else {
    scheduledNotifications.stop();
    const createBtn = $<HTMLButtonElement>('create-button');
    if (createBtn) createBtn.textContent = 'Start New Session';
  }

  // 3. Sound Check Header Pill
  setText('setup-user-name', user ? user.displayName : guestName ? `${guestName} (Guest)` : 'Account');
  const setupBadge = $('setup-avatar-badge');
  if (setupBadge) {
    if (isLogged && user?.displayName) {
      applyAvatarToElement(setupBadge, user.displayName, avatarBg, avatarUrl);
    } else {
      setupBadge.innerHTML = icons.user({ size: 14 });
    }
  }

  // 4. Call Header Pill
  setText('call-user-name', user ? user.displayName : guestName ? `${guestName} (Guest)` : 'Host');
  const callBadge = $('call-avatar-badge');
  if (callBadge) {
    if (myIdentity?.isHost) {
      callBadge.innerHTML = icons.crown({ size: 14 });
    } else if (isLogged && user?.displayName) {
      applyAvatarToElement(callBadge, user.displayName, avatarBg, avatarUrl);
    } else {
      callBadge.innerHTML = icons.user({ size: 14 });
    }
  }

  // 5. Modal Panels Configuration & Profile Form Initialization
  $('auth-tabs')?.classList.toggle('hidden', isLogged);
  $('panel-auth-login')?.classList.toggle('hidden', isLogged);
  $('panel-auth-register')?.classList.add('hidden');
  $('panel-auth-profile')?.classList.toggle('hidden', !isLogged);

  if (isLogged && user) {
    setText('auth-dialog-title', 'Account Profile');
    editingAvatarColor = safeAvatarColor(user.avatarColor, '#06b6d4');
    editingAvatarUrl = user.avatarUrl;

    // Populate profile form fields
    const nameInp = $<HTMLInputElement>('profile-edit-display-name');
    if (nameInp) nameInp.value = user.displayName;
    const roleInp = $<HTMLInputElement>('profile-edit-role');
    if (roleInp) roleInp.value = user.role || '';
    const locInp = $<HTMLInputElement>('profile-edit-location');
    if (locInp) locInp.value = user.location || '';
    const dawInp = $<HTMLSelectElement>('profile-edit-daw');
    if (dawInp) dawInp.value = user.primaryDaw || '';
    const genresInp = $<HTMLInputElement>('profile-edit-genres');
    if (genresInp) genresInp.value = user.genres ? user.genres.join(', ') : '';
    const bioInp = $<HTMLTextAreaElement>('profile-edit-bio');
    if (bioInp) bioInp.value = user.bio || '';
    const socialInp = $<HTMLInputElement>('profile-edit-social');
    if (socialInp) socialInp.value = user.socialHandle || user.website || '';

    // Clear password inputs
    const curPass = $<HTMLInputElement>('profile-input-cur-password');
    const newPass = $<HTMLInputElement>('profile-input-new-password');
    const confPass = $<HTMLInputElement>('profile-input-confirm-password');
    if (curPass) curPass.value = '';
    if (newPass) newPass.value = '';
    if (confPass) confPass.value = '';

    // Set preview card & avatar
    setText('profile-username', `@${user.username}`);
    setText('profile-email', user.email);
    highlightActiveSwatch(editingAvatarColor);
    $('btn-remove-avatar-photo')?.classList.toggle('hidden', !Boolean(editingAvatarUrl));
    $('profile-feedback-msg')?.classList.add('hidden');

    switchProfileSubtab('info');
    updateProfileLivePreview();
  } else {
    setText('auth-dialog-title', 'Sign In or Register');
  }
}

function formatSessionDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today at ${timeStr}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
}

function formatDuration(sec?: number): string {
  if (!sec) return '';
  if (sec < 60) return `${sec}s`;
  const mins = Math.round(sec / 60);
  return `${mins} min`;
}

function openSessionSummaryDialog(session: SessionHistoryItem): void {
  const dialog = $<HTMLDialogElement>('session-summary-dialog');
  if (!dialog) return;

  setText('summary-room-code', session.code || '--------');
  setText('summary-duration', formatDuration(session.durationSeconds || session.summary?.durationSeconds) || '0 min');
  setText('summary-time-range', formatSessionDate(session.startedAt));

  const projectPill = $('summary-project-pill');
  if (session.summary?.projectName) {
    projectPill?.classList.remove('hidden');
    setText('summary-project-name', session.summary.projectName);
  } else {
    projectPill?.classList.add('hidden');
  }

  // Participants
  const participantsListEl = $('summary-participants-list');
  if (participantsListEl) {
    participantsListEl.innerHTML = '';
    const participants = session.summary?.participants && session.summary.participants.length > 0
      ? session.summary.participants
      : [
          {
            displayName: session.role === 'host' ? (auth.getUser()?.displayName || 'Host') : (session.collaborator?.displayName || 'Host'),
            username: session.role === 'host' ? auth.getUser()?.username : session.collaborator?.username,
            role: 'Host',
            isHost: session.role === 'host',
            isGuest: false,
            avatarColor: session.role === 'host' ? safeAvatarColor(auth.getUser()?.avatarColor, '#38bdf8') : safeAvatarColor(session.collaborator?.avatarColor, '#38bdf8')
          },
          ...(session.collaborator ? [{
            displayName: session.collaborator.displayName,
            username: session.collaborator.username,
            role: 'Collaborator',
            isHost: false,
            isGuest: session.collaborator.isGuest,
            avatarColor: safeAvatarColor(session.collaborator.avatarColor, '#38bdf8')
          }] : [])
        ];

    for (const p of participants) {
      const row = document.createElement('div');
      row.className = 'summary-participant-row';
      const initials = (p.displayName || 'MZ').split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
      const handle = p.username ? `@${p.username}` : p.isGuest ? 'Guest' : '';
      const roleTagClass = p.isHost ? 'role-host' : 'role-participant';
      const roleText = p.isHost ? 'Host' : 'Collaborator';
      const safeBg = safeAvatarColor(p.avatarColor, '#38bdf8');

      row.innerHTML = `
        <div class="summary-participant-info">
          <div class="summary-participant-avatar" style="background-color: ${safeBg}">${escapeHtml(initials)}</div>
          <div>
            <span class="summary-participant-name">${escapeHtml(p.displayName)}</span>
            ${handle ? `<span class="summary-participant-handle"> (${escapeHtml(handle)})</span>` : ''}
          </div>
        </div>
        <span class="session-history-role-tag ${roleTagClass}">${roleText}</span>
      `;
      participantsListEl.appendChild(row);
    }
  }

  // Chat count
  const chatCount = session.summary?.chatMessagesCount ?? 0;
  setText('summary-chat-count-badge', `${chatCount} chat ${chatCount === 1 ? 'message' : 'messages'}`);

  // Events Timeline
  const eventsTimelineEl = $('summary-events-timeline');
  const emptyStateEl = $('summary-empty-state');
  if (eventsTimelineEl && emptyStateEl) {
    eventsTimelineEl.innerHTML = '';
    const events = session.summary?.events || [];
    if (events.length === 0) {
      emptyStateEl.classList.remove('hidden');
    } else {
      emptyStateEl.classList.add('hidden');
      for (const ev of events) {
        const item = document.createElement('div');
        item.className = 'summary-event-item';
        const timeStr = new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const catClass = `cat-${ev.category}`;
        const catLabel = ev.category.toUpperCase();

        item.innerHTML = `
          <span class="summary-event-pill ${catClass}">${catLabel}</span>
          <div class="summary-event-body">
            <span class="summary-event-desc">${escapeHtml(ev.description)}</span>
            <span class="summary-event-time">${timeStr}</span>
          </div>
        `;
        eventsTimelineEl.appendChild(item);
      }
    }
  }

  dialog.showModal();
}

function createRecentSessionElement(session: SessionHistoryItem): HTMLElement {
  const item = document.createElement('div');
  item.className = 'session-history-item';

  const collabName = session.collaborator?.displayName || 'Solo Studio Session';
  const collabHandle = session.collaborator?.username ? `@${session.collaborator.username}` : session.collaborator?.isGuest ? 'Guest' : '';
  const avatarColor = safeAvatarColor(session.collaborator?.avatarColor, '#38bdf8');
  const initials = session.collaborator
    ? session.collaborator.displayName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'MZ';
  const roleIcon = session.role === 'host' ? icons.crown({ size: 12 }) : icons.mic({ size: 12 });
  const roleLabel = `${roleIcon} <span>${session.role === 'host' ? 'Host' : 'Collaborator'}</span>`;
  const roleClass = session.role === 'host' ? 'role-host' : 'role-participant';
  const durationText = formatDuration(session.durationSeconds);
  const timeText = `${formatSessionDate(session.startedAt)} · Room ${session.code}${durationText ? ` · ${durationText}` : ''}`;

  item.innerHTML = `
    <div class="session-history-left">
      <div class="session-history-avatar" style="background-color: ${avatarColor}">${escapeHtml(initials)}</div>
      <div class="session-history-meta">
        <div class="session-history-collab-row">
          <span class="session-history-collaborator">${escapeHtml(collabName)}</span>
          ${collabHandle ? `<span class="user-hero-sub" style="font-size: 11.5px;">(${escapeHtml(collabHandle)})</span>` : ''}
          <span class="session-history-role-tag ${roleClass}">${roleLabel}</span>
        </div>
        <span class="session-history-time">${escapeHtml(timeText)}</span>
      </div>
    </div>
    <div class="session-history-right">
      <button type="button" class="btn-view-summary" title="View verified session summary">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>Summary</span>
      </button>
      <button type="button" class="btn-start-with-collab" title="Start a fresh new studio session">
        <span class="btn-icon-inner">${icons.zap({ size: 13 })}</span>
        <span>Start New Session</span>
      </button>
    </div>
  `;

  item.querySelector('.btn-view-summary')?.addEventListener('click', () => {
    openSessionSummaryDialog(session);
  });

  const btnStart = item.querySelector<HTMLButtonElement>('.btn-start-with-collab');
  btnStart?.addEventListener('click', () => {
    void prepareStudio({ type: 'create' });
  });

  return item;
}

async function loadRecentSessions(): Promise<void> {
  const listEl = $('recent-sessions-list');
  const emptyEl = $('recent-sessions-empty');
  const countBadge = $('recent-sessions-count');
  const footerEl = $('recent-sessions-footer');
  const footerText = $('recent-sessions-footer-text');
  const headerViewAllBtn = $('btn-view-all-sessions-header');

  const allListEl = $('all-sessions-list');
  const allEmptyEl = $('all-sessions-empty');
  const allTotalBadge = $('all-sessions-total-badge');
  const allPanelCount = $('all-sessions-panel-count');

  if (!auth.getUser()) return;

  const sessions = await auth.getRecentSessions();
  const totalCount = sessions.length;

  if (countBadge) countBadge.textContent = String(totalCount);
  if (allTotalBadge) allTotalBadge.textContent = `${totalCount} ${totalCount === 1 ? 'session' : 'sessions'}`;
  if (allPanelCount) allPanelCount.textContent = String(totalCount);

  // 1. Render Home Recent Sessions (Limited to 5)
  if (listEl) {
    if (!totalCount) {
      listEl.replaceChildren();
      emptyEl?.classList.remove('hidden');
      footerEl?.classList.add('hidden');
      headerViewAllBtn?.classList.add('hidden');
    } else {
      emptyEl?.classList.add('hidden');
      listEl.replaceChildren();

      const top5 = sessions.slice(0, 5);
      for (const session of top5) {
        listEl.appendChild(createRecentSessionElement(session));
      }

      // Show "View All" header button whenever sessions exist
      headerViewAllBtn?.classList.remove('hidden');

      // Show bottom footer View All button if there are more than 5 sessions
      if (totalCount > 5) {
        footerEl?.classList.remove('hidden');
        if (footerText) footerText.textContent = `View All ${totalCount} Sessions`;
      } else {
        footerEl?.classList.add('hidden');
      }
    }
  }

  // 2. Render Full Dedicated Sessions History View
  if (allListEl) {
    if (!totalCount) {
      allListEl.replaceChildren();
      allEmptyEl?.classList.remove('hidden');
    } else {
      allEmptyEl?.classList.add('hidden');
      allListEl.replaceChildren();
      for (const session of sessions) {
        allListEl.appendChild(createRecentSessionElement(session));
      }
    }
  }
}

function openAllSessionsView(): void {
  showView('all-sessions-view');
  void loadRecentSessions();
}

$('btn-refresh-sessions')?.addEventListener('click', () => void loadRecentSessions());

// ========================================================
// SCHEDULED SESSIONS SYSTEM
// ========================================================
async function loadScheduledSessions(): Promise<void> {
  const listEl = $('scheduled-sessions-list');
  const emptyEl = $('scheduled-sessions-empty');
  const countBadge = $('scheduled-sessions-count');

  const token = auth.getToken();
  if (!token) return;

  try {
    const sessions = await fetchScheduledSessions(token);
    scheduledNotifications.syncSessions(sessions);
    scheduledNotifications.start();
    const totalCount = sessions.length;
    if (countBadge) countBadge.textContent = String(totalCount);

    if (!listEl) return;
    listEl.replaceChildren();

    if (!totalCount) {
      emptyEl?.classList.remove('hidden');
    } else {
      emptyEl?.classList.add('hidden');
      for (const session of sessions) {
        listEl.appendChild(createScheduledSessionElement(session));
      }
    }
  } catch (err) {
    console.error('Failed to load scheduled sessions:', err);
  }
}

function createScheduledSessionElement(session: ScheduledSession): HTMLElement {
  const item = document.createElement('div');
  const dateObj = new Date(session.scheduledAt);
  const isPast = dateObj.getTime() < Date.now();
  item.className = `scheduled-session-item ${isPast ? 'is-past' : ''}`;
  item.dataset.sessionId = session.id;

  const left = document.createElement('div');
  left.className = 'scheduled-session-left';

  const iconWrap = document.createElement('div');
  iconWrap.className = 'scheduled-session-icon-wrap';
  iconWrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>`;

  const meta = document.createElement('div');
  meta.className = 'scheduled-session-meta';

  const titleRow = document.createElement('div');
  titleRow.className = 'scheduled-session-title-row';

  const title = document.createElement('span');
  title.className = 'scheduled-session-title';
  title.textContent = session.title;
  titleRow.appendChild(title);

  const badge = document.createElement('span');
  badge.className = `scheduled-session-badge ${isPast ? 'past' : ''}`;
  badge.textContent = isPast ? 'Past' : 'Upcoming';
  titleRow.appendChild(badge);

  const time = document.createElement('span');
  time.className = 'scheduled-session-time';
  time.textContent = dateObj.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });

  meta.appendChild(titleRow);
  meta.appendChild(time);
  left.appendChild(iconWrap);
  left.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'scheduled-session-actions';

  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'btn-scheduled-start';
  startBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><polygon points="6 3 20 12 6 21 6 3"/></svg><span>Start</span>`;
  startBtn.addEventListener('click', () => {
    void prepareStudio({ type: 'create' });
  });

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn-scheduled-edit';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => {
    openScheduledDialog(session);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-scheduled-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', async () => {
    const confirmed = window.confirm(`Cancel scheduled session "${session.title}"?`);
    if (!confirmed) return;
    const token = auth.getToken();
    if (!token) return;
    cancelBtn.disabled = true;
    try {
      await deleteScheduledSession(token, session.id);
      await loadScheduledSessions();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel scheduled session');
      cancelBtn.disabled = false;
    }
  });

  actions.appendChild(startBtn);
  actions.appendChild(editBtn);
  actions.appendChild(cancelBtn);

  item.appendChild(left);
  item.appendChild(actions);

  return item;
}

function openScheduledDialog(existingSession?: ScheduledSession): void {
  const dialog = $<HTMLDialogElement>('scheduled-session-dialog');
  const titleInput = $<HTMLInputElement>('scheduled-session-title-input');
  const datetimeInput = $<HTMLInputElement>('scheduled-session-datetime-input');
  const editIdInput = $<HTMLInputElement>('scheduled-session-edit-id');
  const dialogTitle = $('scheduled-dialog-title');
  const statusEl = $('scheduled-dialog-status');

  if (!dialog || !titleInput || !datetimeInput || !editIdInput) return;

  statusEl?.classList.add('hidden');

  if (existingSession) {
    if (dialogTitle) dialogTitle.textContent = 'Edit Scheduled Session';
    editIdInput.value = existingSession.id;
    titleInput.value = existingSession.title;
    // Convert existing UTC ISO to local datetime-local format YYYY-MM-DDTHH:mm
    const d = new Date(existingSession.scheduledAt);
    const localIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    datetimeInput.value = localIso;
  } else {
    if (dialogTitle) dialogTitle.textContent = 'Schedule a Session';
    editIdInput.value = '';
    titleInput.value = '';
    // Default to 1 hour in the future in local time
    const nextHour = new Date(Date.now() + 3600000);
    nextHour.setMinutes(0, 0, 0);
    const localIso = new Date(nextHour.getTime() - nextHour.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    datetimeInput.value = localIso;
  }

  dialog.showModal();
}

$('btn-new-scheduled-session')?.addEventListener('click', () => openScheduledDialog());
$('btn-refresh-scheduled-sessions')?.addEventListener('click', () => void loadScheduledSessions());
$('btn-close-scheduled-dialog')?.addEventListener('click', () => $<HTMLDialogElement>('scheduled-session-dialog')?.close());
$('btn-cancel-scheduled-dialog')?.addEventListener('click', () => $<HTMLDialogElement>('scheduled-session-dialog')?.close());

$('scheduled-session-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = auth.getToken();
  if (!token) return;

  const titleInput = $<HTMLInputElement>('scheduled-session-title-input');
  const datetimeInput = $<HTMLInputElement>('scheduled-session-datetime-input');
  const editIdInput = $<HTMLInputElement>('scheduled-session-edit-id');
  const submitBtn = $<HTMLButtonElement>('btn-submit-scheduled-dialog');
  const statusEl = $('scheduled-dialog-status');

  if (!titleInput || !datetimeInput) return;

  const title = titleInput.value.trim();
  const localDateTimeStr = datetimeInput.value;
  if (!title || !localDateTimeStr) return;

  // Convert user's local selected datetime to UTC ISO string
  const utcIso = new Date(localDateTimeStr).toISOString();

  if (submitBtn) submitBtn.disabled = true;
  statusEl?.classList.add('hidden');

  try {
    const editId = editIdInput?.value;
    if (editId) {
      await updateScheduledSession(token, editId, { title, scheduledAt: utcIso });
    } else {
      await createScheduledSession(token, { title, scheduledAt: utcIso });
    }
    $<HTMLDialogElement>('scheduled-session-dialog')?.close();
    await loadScheduledSessions();
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = err instanceof Error ? err.message : 'Failed to save scheduled session';
      statusEl.classList.remove('hidden');
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});
$('btn-refresh-all-sessions')?.addEventListener('click', () => void loadRecentSessions());
$('btn-view-all-sessions')?.addEventListener('click', () => openAllSessionsView());
$('btn-view-all-sessions-header')?.addEventListener('click', () => openAllSessionsView());
$('btn-sessions-back')?.addEventListener('click', () => showView('home-view'));
$('btn-start-session-from-history')?.addEventListener('click', () => {
  void prepareStudio({ type: 'create' });
});

function openAuthView(tab: 'login' | 'register' = 'login'): void {
  showView('auth-view');
  if (tab === 'register') {
    switchAuthViewTab('register');
  } else {
    switchAuthViewTab('login');
  }
}

function switchAuthViewTab(tab: 'login' | 'register'): void {
  const isLogin = tab === 'login';
  $('view-tab-login')?.classList.toggle('active', isLogin);
  $('view-tab-register')?.classList.toggle('active', !isLogin);
  $('view-panel-login')?.classList.toggle('hidden', !isLogin);
  $('view-panel-register')?.classList.toggle('hidden', isLogin);
  setText('auth-view-crumb', isLogin ? 'Sign In' : 'Create Account');
  $('view-login-error')?.classList.add('hidden');
  $('view-reg-error')?.classList.add('hidden');
  if (isLogin) {
    setTimeout(() => $<HTMLInputElement>('view-login-identifier')?.focus(), 50);
  } else {
    setTimeout(() => $<HTMLInputElement>('view-reg-display-name')?.focus(), 50);
  }
}

function openAuthDialog(tab: 'login' | 'register' = 'login'): void {
  const user = auth.getUser();
  if (user) {
    updateAuthUi(user, auth.getGuestName());
    const dialog = $<HTMLDialogElement>('auth-dialog');
    dialog?.showModal();
  } else {
    openAuthView(tab);
  }
}

// Navigation & Hero button listeners
$('nav-btn-signin')?.addEventListener('click', () => openAuthView('login'));
$('nav-btn-register')?.addEventListener('click', () => openAuthView('register'));
$('hero-btn-signin')?.addEventListener('click', () => openAuthView('login'));
$('hero-btn-register')?.addEventListener('click', () => openAuthView('register'));
$('nav-profile-pill')?.addEventListener('click', () => openAuthDialog());
$('home-view-profile-btn')?.addEventListener('click', () => openAuthDialog());
$('setup-user-btn')?.addEventListener('click', () => openAuthDialog());
$('call-user-btn')?.addEventListener('click', () => openAuthDialog());

// Dedicated Auth View actions
$('btn-auth-view-back')?.addEventListener('click', () => showView('home-view'));
$('view-tab-login')?.addEventListener('click', () => switchAuthViewTab('login'));
$('view-tab-register')?.addEventListener('click', () => switchAuthViewTab('register'));
$('view-link-to-register')?.addEventListener('click', (e) => { e.preventDefault(); switchAuthViewTab('register'); });
$('view-link-to-login')?.addEventListener('click', (e) => { e.preventDefault(); switchAuthViewTab('login'); });
$('btn-view-login-as-guest')?.addEventListener('click', () => showView('home-view'));
$('btn-view-reg-as-guest')?.addEventListener('click', () => showView('home-view'));

$('btn-view-submit-login')?.addEventListener('click', async () => {
  const submitBtn = $<HTMLButtonElement>('btn-view-submit-login');
  const identifier = $<HTMLInputElement>('view-login-identifier')?.value.trim();
  const password = $<HTMLInputElement>('view-login-password')?.value;
  const errEl = $('view-login-error');
  if (!identifier || !password) {
    if (errEl) { errEl.textContent = 'Please enter your username/email and password.'; errEl.classList.remove('hidden'); }
    return;
  }
  const originalHtml = submitBtn ? submitBtn.innerHTML : '<span>Sign In</span>';
  try {
    if (errEl) errEl.classList.add('hidden');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Signing In…</span>';
    }
    await auth.login({ usernameOrEmail: identifier, password });
    if (pendingJoinCode) {
      const code = pendingJoinCode;
      pendingJoinCode = '';
      void prepareStudio({ type: 'join', code });
    } else {
      showView('home-view');
    }
  } catch (err: unknown) {
    if (errEl) {
      errEl.textContent = err instanceof Error ? err.message : 'Login failed.';
      errEl.classList.remove('hidden');
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalHtml;
    }
  }
});

$('btn-view-submit-register')?.addEventListener('click', async () => {
  const submitBtn = $<HTMLButtonElement>('btn-view-submit-register');
  const displayName = $<HTMLInputElement>('view-reg-display-name')?.value.trim();
  const username = $<HTMLInputElement>('view-reg-username')?.value.trim();
  const email = $<HTMLInputElement>('view-reg-email')?.value.trim();
  const password = $<HTMLInputElement>('view-reg-password')?.value;
  const errEl = $('view-reg-error');
  if (!displayName || !username || !email || !password) {
    if (errEl) { errEl.textContent = 'Please fill out all registration fields.'; errEl.classList.remove('hidden'); }
    return;
  }
  const originalHtml = submitBtn ? submitBtn.innerHTML : '<span>Create Account</span>';
  try {
    if (errEl) errEl.classList.add('hidden');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Creating Account…</span>';
    }
    await auth.register({ displayName, username, email, password });
    showView('home-view');
  } catch (err: unknown) {
    if (errEl) {
      errEl.textContent = err instanceof Error ? err.message : 'Registration failed.';
      errEl.classList.remove('hidden');
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalHtml;
    }
  }
});

// Bind Enter key submissions on all inputs
['view-login-identifier', 'view-login-password'].forEach((id) => {
  $<HTMLInputElement>(id)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('btn-view-submit-login')?.click();
    }
  });
});

['view-reg-display-name', 'view-reg-username', 'view-reg-email', 'view-reg-password'].forEach((id) => {
  $<HTMLInputElement>(id)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('btn-view-submit-register')?.click();
    }
  });
});

$<HTMLInputElement>('guest-name-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-confirm-guest-join')?.click(); });
$<HTMLInputElement>('guest-name-input')?.addEventListener('input', (e) => {
  const val = (e.currentTarget as HTMLInputElement).value.trim();
  const avatar = $('guest-avatar-preview');
  if (avatar) {
    if (val) {
      avatar.textContent = val[0]?.toUpperCase() ?? '';
    } else {
      avatar.innerHTML = icons.user({ size: 22 });
    }
  }
});

// Guest modal sign in redirect
$('link-guest-to-login')?.addEventListener('click', (e) => {
  e.preventDefault();
  $<HTMLDialogElement>('guest-join-dialog')?.close();
  openAuthView('login');
});
$('btn-guest-modal-signin')?.addEventListener('click', () => {
  $<HTMLDialogElement>('guest-join-dialog')?.close();
  openAuthView('login');
});

$('btn-auth-logout')?.addEventListener('click', async () => {
  await auth.logout();
  $<HTMLDialogElement>('auth-dialog')?.close();
});

// Profile Sub-tab Navigation
$('profile-subtab-info')?.addEventListener('click', () => switchProfileSubtab('info'));
$('profile-subtab-avatar')?.addEventListener('click', () => switchProfileSubtab('avatar'));
$('profile-subtab-security')?.addEventListener('click', () => switchProfileSubtab('security'));

// Live preview inputs
$('profile-edit-display-name')?.addEventListener('input', () => updateProfileLivePreview());
$('profile-edit-role')?.addEventListener('input', () => updateProfileLivePreview());
$('profile-edit-location')?.addEventListener('input', () => updateProfileLivePreview());
$('profile-edit-daw')?.addEventListener('change', () => updateProfileLivePreview());

// Quick role presets
document.querySelectorAll<HTMLButtonElement>('.btn-role-preset').forEach((btn) => {
  btn.addEventListener('click', () => {
    const role = btn.dataset.role || '';
    const roleInp = $<HTMLInputElement>('profile-edit-role');
    if (roleInp) {
      roleInp.value = role;
      updateProfileLivePreview();
    }
  });
});

// Avatar Color Swatches
document.querySelectorAll<HTMLButtonElement>('.color-swatch-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const color = btn.dataset.color;
    if (color) {
      editingAvatarColor = color;
      highlightActiveSwatch(color);
      updateProfileLivePreview();
    }
  });
});

// Avatar Photo Upload & Removal
$('btn-trigger-avatar-upload')?.addEventListener('click', () => {
  switchProfileSubtab('avatar');
  $<HTMLInputElement>('profile-avatar-file-input')?.click();
});

$('profile-avatar-file-input')?.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showProfileFeedback('Image file is too large. Please select an image under 2MB.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    editingAvatarUrl = reader.result as string;
    $('btn-remove-avatar-photo')?.classList.remove('hidden');
    updateProfileLivePreview();
    showProfileFeedback('Photo loaded. Click "Save Profile Changes" to apply.', 'info');
  };
  reader.readAsDataURL(file);
});

$('btn-remove-avatar-photo')?.addEventListener('click', () => {
  editingAvatarUrl = undefined;
  const fileInput = $<HTMLInputElement>('profile-avatar-file-input');
  if (fileInput) fileInput.value = '';
  $('btn-remove-avatar-photo')?.classList.add('hidden');
  updateProfileLivePreview();
  showProfileFeedback('Photo removed. Click "Save Profile Changes" to apply.', 'info');
});

// Save Profile Changes
$('btn-profile-save')?.addEventListener('click', async () => {
  const displayName = $<HTMLInputElement>('profile-edit-display-name')?.value.trim();
  const role = $<HTMLInputElement>('profile-edit-role')?.value.trim();
  const location = $<HTMLInputElement>('profile-edit-location')?.value.trim();
  const primaryDaw = $<HTMLSelectElement>('profile-edit-daw')?.value.trim();
  const genresRaw = $<HTMLInputElement>('profile-edit-genres')?.value.trim();
  const bio = $<HTMLTextAreaElement>('profile-edit-bio')?.value.trim();
  const social = $<HTMLInputElement>('profile-edit-social')?.value.trim();

  const curPass = $<HTMLInputElement>('profile-input-cur-password')?.value;
  const newPass = $<HTMLInputElement>('profile-input-new-password')?.value;
  const confPass = $<HTMLInputElement>('profile-input-confirm-password')?.value;

  if (!displayName) {
    showProfileFeedback('Display Name cannot be empty.', 'error');
    switchProfileSubtab('info');
    return;
  }

  if (newPass || curPass || confPass) {
    if (!curPass) {
      showProfileFeedback('Current password is required to change password.', 'error');
      switchProfileSubtab('security');
      return;
    }
    if (!newPass || newPass.length < 8) {
      showProfileFeedback('New password must be at least 8 characters long.', 'error');
      switchProfileSubtab('security');
      return;
    }
    if (newPass !== confPass) {
      showProfileFeedback('New passwords do not match.', 'error');
      switchProfileSubtab('security');
      return;
    }
  }

  const genres = genresRaw
    ? genresRaw.split(',').map((g) => g.trim()).filter(Boolean)
    : [];

  const saveBtn = $<HTMLButtonElement>('btn-profile-save');
  try {
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = `<span>Saving Changes…</span>`;
    }

    const payload: UpdateProfileRequest = {
      displayName,
      role: role || undefined,
      location: location || undefined,
      primaryDaw: primaryDaw || undefined,
      genres: genres.length > 0 ? genres : undefined,
      bio: bio || undefined,
      socialHandle: social || undefined,
      avatarColor: editingAvatarColor,
      avatarUrl: editingAvatarUrl || ''
    };

    if (newPass && curPass) {
      payload.currentPassword = curPass;
      payload.newPassword = newPass;
    }

    await auth.updateProfile(payload);
    showProfileFeedback('✓ Profile updated successfully!', 'success');

    // clear password inputs
    const curPassEl = $<HTMLInputElement>('profile-input-cur-password');
    const newPassEl = $<HTMLInputElement>('profile-input-new-password');
    const confPassEl = $<HTMLInputElement>('profile-input-confirm-password');
    if (curPassEl) curPassEl.value = '';
    if (newPassEl) newPassEl.value = '';
    if (confPassEl) confPassEl.value = '';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to update profile.';
    showProfileFeedback(msg, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `
        <span class="btn-icon-inner">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><polyline points="20 6 9 17 4 12"/></svg>
        </span>
        <span>Save Profile Changes</span>
      `;
    }
  }
});

let pendingJoinCode = '';

$('btn-confirm-guest-join')?.addEventListener('click', () => {
  const input = $<HTMLInputElement>('guest-name-input');
  const name = input?.value.trim() || 'Guest Musician';
  auth.setGuestName(name);
  $<HTMLDialogElement>('guest-join-dialog')?.close();
  if (pendingJoinCode) {
    const code = pendingJoinCode;
    pendingJoinCode = '';
    void prepareStudio({ type: 'join', code });
  }
});

auth.onStateChange((user, guestName) => updateAuthUi(user, guestName || ''));

signaling.on('peer:ready', (payload: { media: MediaMetadata; identity?: ParticipantIdentity; participantId?: string }) => {
  setCallStatus('Connecting…');
  if (payload.participantId) {
    peerParticipantId = payload.participantId;
  }
  if (payload.identity) {
    peerIdentity = payload.identity;
  }
  updateParticipantIdentityUi();
  if (!inCall) pendingPeerMedia = payload.media;
  else void rtc.peerReady(payload.media);
});
signaling.on('peer:disconnected', () => setCallStatus('Musician reconnecting…'));
signaling.on('peer:left', () => {
  rtc.resetPeer();
  remoteAudioTracks.clear();
  refreshRemoteAudio();
  peerIdentity = null;
  peerParticipantId = null;
  updateParticipantIdentityUi();
  setCallStatus('Waiting for Musician…');
  setText('remote-placeholder', 'Waiting for Musician');
});
signaling.on('meeting:ended', () => void leaveSession('The session creator ended the session.'));
signaling.on('meeting:removed', (payload: { code: string; message?: string }) => {
  void leaveSession(payload.message || 'You have been removed from the session by the host.');
});
signaling.on('disconnect', () => { if (inCall) setCallStatus('Signaling reconnecting…'); });
signaling.on('connect', () => { if (inCall) setCallStatus('Reconnecting session…'); });

signaling.on('waiting:update', (waitingList: WaitingParticipantItem[]) => {
  renderWaitingBanner(waitingList);
});

signaling.on('waiting:admitted', async (ack: MeetingAck) => {
  if (!ack.ok) return;
  const token = auth.getToken() || undefined;
  const guestName = auth.getGuestName() || undefined;
  signaling.setResume(ack.code, participantId, metadata(), token, guestName, ack.reconnectToken);
  await initializeActiveCall(ack);
});

function renderWaitingBanner(waitingList: WaitingParticipantItem[]): void {
  const banner = $('waiting-room-banner');
  const bannerText = $('waiting-banner-text');
  const bannerList = $('waiting-banner-list');
  if (!banner || !bannerText || !bannerList) return;

  if (!waitingList || waitingList.length === 0) {
    banner.classList.add('hidden');
    bannerList.innerHTML = '';
    return;
  }

  banner.classList.remove('hidden');
  const count = waitingList.length;
  bannerText.textContent = `${count} ${count === 1 ? 'participant' : 'participants'} in waiting room`;
  bannerList.innerHTML = '';

  for (const item of waitingList) {
    const chip = document.createElement('div');
    chip.className = 'waiting-participant-chip';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'waiting-participant-name';
    nameSpan.textContent = item.identity.displayName || 'Guest Musician';

    const admitBtn = document.createElement('button');
    admitBtn.type = 'button';
    admitBtn.className = 'btn-admit-chip';
    admitBtn.textContent = 'Admit';
    admitBtn.addEventListener('click', async () => {
      admitBtn.disabled = true;
      admitBtn.textContent = 'Admitting…';
      try {
        const res = await signaling.admitParticipant(currentCode, item.participantId);
        if (!res.ok) {
          admitBtn.disabled = false;
          admitBtn.textContent = 'Admit';
          setMessage('call-status', res.message || 'Failed to admit', true);
        }
      } catch {
        admitBtn.disabled = false;
        admitBtn.textContent = 'Admit';
      }
    });

    chip.appendChild(nameSpan);
    chip.appendChild(admitBtn);
    bannerList.appendChild(chip);
  }
}

$('btn-leave-waiting')?.addEventListener('click', async () => {
  signaling.leave();
  inCall = false;
  currentCode = '';
  pending = undefined;
  for (const m of voiceMeters.values()) await m.stop();
  voiceMeters.clear();
  activeMicLevels.clear();
  audio.dispose();
  videoTrack?.stop();
  videoTrack = undefined;
  await musicMeter.stop();
  showView('home-view');
});

signaling.on('session:locked', (payload: { code: string; locked: boolean }) => {
  if (payload.code === currentCode) {
    isSessionLocked = payload.locked;
    updateLockUi();
  }
});

$('btn-lock-session')?.addEventListener('click', async () => {
  if (currentRole !== 'host' || !currentCode) return;
  const targetState = !isSessionLocked;
  const btn = $<HTMLButtonElement>('btn-lock-session');
  if (btn) btn.disabled = true;
  try {
    const res = await signaling.setSessionLock(currentCode, targetState);
    if (res.ok) {
      isSessionLocked = Boolean(res.locked);
      updateLockUi();
    } else {
      setMessage('call-status', res.message || 'Failed to update session lock', true);
    }
  } catch {
    // Keep current state on error
  } finally {
    if (btn) btn.disabled = false;
  }
});

$('btn-remove-participant')?.addEventListener('click', async () => {
  if (currentRole !== 'host' || !currentCode || !peerParticipantId) return;
  const peerName = peerIdentity?.displayName || 'this participant';
  const confirmed = window.confirm(`Are you sure you want to remove ${peerName} from the session?`);
  if (!confirmed) return;
  const btn = $<HTMLButtonElement>('btn-remove-participant');
  if (btn) btn.disabled = true;
  try {
    const res = await signaling.removeParticipant(currentCode, peerParticipantId);
    if (!res.ok) {
      setMessage('call-status', res.message || 'Failed to remove participant', true);
    }
  } catch {
    // Keep current state on error
  } finally {
    if (btn) btn.disabled = false;
  }
});

navigator.mediaDevices.addEventListener('devicechange', () => void enumerateAndPopulate());
window.addEventListener('beforeunload', () => {
  signaling.leave();
  signaling.disconnect();
  rtc.dispose();
  audio.dispose();
  const sharing = screenTrack;
  screenTrack = undefined;
  if (sharing) { sharing.onended = null; sharing.stop(); }
  void presenter.stopNativeCapture();
  void presenter.exitPresenterMode();
  videoTrack?.stop();
  stopRemoteVoiceBridge();
  for (const m of voiceMeters.values()) void m.stop();
  void musicMeter.stop();
});

async function handleDeepLink(url: string): Promise<void> {
  const callView = $('call-view');
  const waitingView = $('waiting-view');
  if (inCall || callView?.classList.contains('active') || waitingView?.classList.contains('active')) {
    // If JaMeet is already in an active session or waiting room,
    // do not interrupt, leave, replace, or restart the current session.
    return;
  }
  const code = normalizeMeetingCode(url);
  if (meetingCodeSchema.safeParse(code).success) {
    const joinInput = $<HTMLInputElement>('join-input');
    if (joinInput) {
      joinInput.value = code;
    }
    if (!auth.getUser()) {
      pendingJoinCode = code;
      openAuthView('login');
    } else {
      await prepareStudio({ type: 'join', code });
    }
  }
}
const desktopBridge = typeof window !== 'undefined' ? (window.jameet || window.musiczoom) : undefined;
desktopBridge?.onDeepLink?.((url) => void handleDeepLink(url));
void desktopBridge?.getInitialDeepLink?.().then((url) => { if (url) void handleDeepLink(url); });

// Dialog close button and backdrop click listeners
document.querySelectorAll<HTMLDialogElement>('dialog').forEach((dialog) => {
  dialog.querySelectorAll('.dialog-close, [value="cancel"], [value="done"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      dialog.close();
    });
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
});

// Initial startup view and background device pre-warming
showView('home-view');
void auth.init().catch(() => {});
void enumerateAndPopulate().then(() => {
  if (!audioOnly) void replaceCamera(prefs.cameraId).catch(() => {});
  void syncAllVoiceMics(prefs.mode).catch(() => {});
});

// ======= PROJECTS SYSTEM =======

async function loadProjects(): Promise<void> {
  const token = auth.getToken();
  if (!token) {
    projectsList = [];
    renderProjectsGrid();
    return;
  }
  try {
    projectsList = await projectsApi.fetchProjects(token);
  } catch (err) {
    console.warn('[Projects] Failed to load projects:', err);
    projectsList = [];
  } finally {
    renderProjectsGrid();
  }
}

function renderProjectsGrid(): void {
  const grid = $('projects-grid');
  const empty = $('projects-empty');
  const count = $('projects-count');
  if (!grid) return;

  if (count) count.textContent = String(projectsList.length);

  if (!projectsList.length) {
    grid.replaceChildren();
    grid.classList.add('hidden');
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  grid.classList.remove('hidden');
  grid.replaceChildren();

  const user = auth.getUser();

  for (const project of projectsList) {
    const card = document.createElement('div');
    card.className = `project-card${project.archived ? ' archived' : ''}`;
    card.dataset.projectId = project.id;

    const isOwner = user?.id === project.ownerId;
    const collabCount = project.collaborators.length;
    const sessionCount = project.sessionCount || project.sessions?.length || 0;
    const lastActivity = projectsApi.formatRelativeTime(project.lastActivityAt);

    // Collaborator avatars (show up to 4)
    let collabAvatarsHtml = '';
    const showCollabs = project.collaborators.slice(0, 4);
    for (const c of showCollabs) {
      const ini = c.displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
      const safeBg = safeAvatarColor(c.avatarColor, '#38bdf8');
      collabAvatarsHtml += `<div class="project-card-avatar" style="background-color: ${safeBg};" title="${escapeHtml(c.displayName)} (@${escapeHtml(c.username)})">${escapeHtml(ini)}</div>`;
    }
    if (collabCount > 4) {
      collabAvatarsHtml += `<div class="project-card-avatar project-card-avatar-overflow">+${collabCount - 4}</div>`;
    }

    const badgeIcon = project.archived ? icons.archive({ size: 12 }) : isOwner ? icons.crown({ size: 12 }) : icons.users({ size: 12 });
    const badgeText = project.archived ? 'Archived' : isOwner ? 'Owner' : 'Shared';
    const badgeLabel = `${badgeIcon} <span>${badgeText}</span>`;
    const badgeClass = project.archived ? 'badge-archived' : isOwner ? 'badge-owner' : 'badge-collab';

    card.innerHTML = `
      <div class="project-card-header">
        <div class="project-card-icon">${icons.disc({ size: 22 })}</div>
        <div class="project-card-heading">
          <div class="project-card-title-row">
            <h4 class="project-card-title">${escapeHtml(project.name)}</h4>
            <span class="project-card-pill ${badgeClass}">${badgeLabel}</span>
          </div>
          ${project.description ? `<p class="project-card-desc">${escapeHtml(project.description)}</p>` : ''}
        </div>
      </div>
      <div class="project-card-meta">
        <div class="project-card-meta-item"><span class="meta-icon">${icons.clock({ size: 13 })}</span> <span>${escapeHtml(lastActivity)}</span></div>
        <div class="project-card-meta-item"><span class="meta-icon">${icons.headphones({ size: 13 })}</span> <span>${sessionCount} session${sessionCount !== 1 ? 's' : ''}</span></div>
        ${collabCount > 0 ? `<div class="project-card-meta-item"><span class="meta-icon">${icons.users({ size: 13 })}</span> <span>${collabCount} member${collabCount !== 1 ? 's' : ''}</span></div>` : ''}
      </div>
      <div class="project-card-footer">
        <div class="project-card-collaborators">${collabAvatarsHtml}</div>
        <span class="project-card-open-hint"><span>Open Project</span> <span class="btn-arrow">${icons.arrowRight({ size: 13 })}</span></span>
      </div>
    `;

    card.addEventListener('click', () => void openProjectView(project.id));
    grid.appendChild(card);
  }
}

async function openProjectView(projectId: string): Promise<void> {
  const token = auth.getToken();
  if (!token) {
    showView('auth-view');
    return;
  }
  try {
    const project = await projectsApi.fetchProject(token, projectId);
    activeProject = project;
    activeProjectId = projectId;
    showView('project-view');
    resetProjectTabs();
    renderProjectView();
    syncWorkspaceInputsFromProject(true);

    void signaling.joinProjectWorkspace(projectId, token).then((joinRes) => {
      if (joinRes?.ok && joinRes.workspace && activeProject && activeProject.id === projectId) {
        activeProject.workspace = joinRes.workspace;
        syncWorkspaceInputsFromProject(true);
      }
    }).catch((e) => console.warn('[Signaling] Failed to join project workspace socket room:', e));
  } catch (err) {
    console.error('Failed to open project:', err);
    alert(`Could not open project: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

function resetProjectTabs(): void {
  const tabBtns = document.querySelectorAll<HTMLButtonElement>('.project-tab-btn');
  tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === 'overview'));
  const panels = document.querySelectorAll<HTMLElement>('.project-tab-panel');
  panels.forEach((p) => p.classList.toggle('hidden', p.id !== 'project-panel-overview'));
}

function renderProjectView(): void {
  if (!activeProject) return;
  const p = activeProject;
  const user = auth.getUser();
  const isOwner = user?.id === p.ownerId;

  // Breadcrumb
  setText('project-view-name-crumb', p.name);

  // Hero
  setText('project-title', p.name);
  const roleBadge = $('project-role-badge');
  if (roleBadge) {
    if (p.archived) {
      roleBadge.innerHTML = `${icons.archive({ size: 14 })} <span>Archived</span>`;
      roleBadge.className = 'project-status-pill badge-archived';
    } else if (isOwner) {
      roleBadge.innerHTML = `${icons.crown({ size: 14 })} <span>Owner</span>`;
      roleBadge.className = 'project-status-pill badge-owner';
    } else {
      roleBadge.innerHTML = `${icons.users({ size: 14 })} <span>Shared</span>`;
      roleBadge.className = 'project-status-pill badge-collab';
    }
  }

  const descEl = $('project-description');
  if (descEl) {
    descEl.textContent = p.description || '';
    descEl.classList.toggle('hidden', !p.description);
  }
  setText('project-created-date', new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
  setText('project-last-activity', projectsApi.formatRelativeTime(p.lastActivityAt));
  
  const sessionCountNum = p.sessions?.length || p.sessionCount || 0;
  const totalMembersNum = 1 + (p.collaborators?.length || 0);

  setText('project-session-count', String(sessionCountNum));
  setText('tab-sessions-count', String(sessionCountNum));
  setText('project-collaborators-count', String(totalMembersNum));
  setText('tab-collab-count', String(totalMembersNum));
  setText('project-owner-name', p.ownerDisplayName);

  // Archive button text
  const archiveBtn = $('btn-project-archive');
  if (archiveBtn) archiveBtn.innerHTML = `${icons.archive({ size: 15 })} <span>${p.archived ? 'Unarchive Project' : 'Archive Project'}</span>`;

  // Show/hide owner-only controls
  const menuBtn = $('btn-project-menu');
  if (menuBtn) menuBtn.classList.toggle('hidden', !isOwner);
  const addCollabBtn = $('btn-project-add-collab');
  if (addCollabBtn) addCollabBtn.classList.toggle('hidden', !isOwner);
  const addCollabTabBtn = $('btn-project-add-collab-tab');
  if (addCollabTabBtn) addCollabTabBtn.classList.toggle('hidden', !isOwner);

  // Collaborators
  renderProjectCollaborators();

  // Sessions
  renderProjectSessions();
}

function renderProjectCollaborators(): void {
  if (!activeProject) return;
  const listOverview = $('project-collaborators-list');
  const listFull = $('project-collaborators-full-list');

  const user = auth.getUser();
  const isOwner = user?.id === activeProject.ownerId;
  const allMembers = [
    { userId: activeProject.ownerId, displayName: activeProject.ownerDisplayName, username: activeProject.ownerUsername, avatarColor: safeAvatarColor(activeProject.ownerAvatarColor, '#f59e0b'), role: 'owner' as const, addedAt: activeProject.createdAt },
    ...activeProject.collaborators
  ];

  const buildItems = (container: HTMLElement | null) => {
    if (!container) return;
    container.replaceChildren();

    for (const member of allMembers) {
      const ini = member.displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
      const roleIcon = member.role === 'owner' ? icons.crown({ size: 12 }) : icons.users({ size: 12 });
      const roleLabel = `${roleIcon} <span>${member.role === 'owner' ? 'Owner' : member.role.charAt(0).toUpperCase() + member.role.slice(1)}</span>`;
      const roleClass = member.role === 'owner' ? 'role-owner' : 'role-collaborator';
      const safeBg = safeAvatarColor(member.avatarColor, '#f59e0b');
      const item = document.createElement('div');
      item.className = 'collab-item';
      item.innerHTML = `
        <div class="collab-avatar" style="background-color: ${safeBg};">${escapeHtml(ini)}</div>
        <div class="collab-info">
          <div class="collab-name">${escapeHtml(member.displayName)}</div>
          <div class="collab-username">@${escapeHtml(member.username)}</div>
        </div>
        <span class="collab-role-badge ${roleClass}">${roleLabel}</span>
        ${isOwner && member.role !== 'owner' ? `<button class="collab-remove-btn" data-user-id="${escapeHtml(member.userId)}" title="Remove member">${icons.x({ size: 14 })}</button>` : ''}
      `;
      const removeBtn = item.querySelector<HTMLButtonElement>('.collab-remove-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          void removeProjectCollaborator(member.userId);
        });
      }
      container.appendChild(item);
    }
  };

  buildItems(listOverview);
  buildItems(listFull);
}

function renderProjectSessions(): void {
  if (!activeProject) return;
  const listOverview = $('project-sessions-list');
  const listFull = $('project-sessions-full-list');
  const emptyEl = $('project-sessions-empty');

  const sessions = activeProject.sessions || [];

  if (listOverview) {
    if (!sessions.length) {
      listOverview.replaceChildren();
      if (emptyEl) { emptyEl.classList.remove('hidden'); listOverview.appendChild(emptyEl); }
    } else {
      if (emptyEl) emptyEl.classList.add('hidden');
      listOverview.replaceChildren();
      for (const session of sessions) {
        listOverview.appendChild(createSessionItemEl(session));
      }
    }
  }

  if (listFull) {
    if (!sessions.length) {
      listFull.innerHTML = `<div class="projects-empty"><p>No session history in this project yet.</p></div>`;
    } else {
      listFull.replaceChildren();
      for (const session of sessions) {
        listFull.appendChild(createSessionItemEl(session));
      }
    }
  }
}

function createSessionItemEl(session: ProjectSessionItem): HTMLElement {
  const item = document.createElement('div');
  item.className = 'project-session-item';
  const collabText = session.collaborator ? session.collaborator.displayName : 'Solo Studio Session';
  const collabAvatarBg = safeAvatarColor(session.collaborator?.avatarColor, '#38bdf8');
  const initials = session.collaborator
    ? session.collaborator.displayName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'MZ';
  const timeText = projectsApi.formatRelativeTime(session.startedAt);
  const durationText = projectsApi.formatSessionDuration(session.durationSeconds);
  const roleIcon = session.role === 'host' ? icons.crown({ size: 12 }) : icons.mic({ size: 12 });
  const roleLabel = `${roleIcon} <span>${session.role === 'host' ? 'Host' : 'Guest'}</span>`;
  const roleClass = session.role === 'host' ? 'role-host' : 'role-participant';

  item.innerHTML = `
    <div class="project-session-left">
      <div class="session-avatar-mini" style="background-color: ${collabAvatarBg};">${escapeHtml(initials)}</div>
      <div class="project-session-details">
        <div class="project-session-collab-row">
          <span class="project-session-collab">${escapeHtml(collabText)}</span>
          <span class="session-role-pill ${roleClass}">${roleLabel}</span>
        </div>
        <div class="project-session-sub-row">
          <span class="project-session-code">${escapeHtml(session.code)}</span>
          <span class="meta-dot">·</span>
          <span class="project-session-time">${escapeHtml(timeText)}</span>
        </div>
      </div>
    </div>
    <div class="project-session-right">
      <span class="project-session-duration"><span class="meta-icon">${icons.clock({ size: 13 })}</span> <span>${escapeHtml(durationText)}</span></span>
    </div>
  `;
  return item;
}

async function removeProjectCollaborator(targetUserId: string): Promise<void> {
  if (!activeProject) return;
  const token = auth.getToken();
  if (!token) return;
  try {
    activeProject = await projectsApi.removeCollaborator(token, activeProject.id, targetUserId);
    renderProjectCollaborators();
  } catch (err) {
    console.error('Failed to remove collaborator:', err);
  }
}

// --- Tab bar listeners ---
document.querySelectorAll<HTMLButtonElement>('.project-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetTab = btn.dataset.tab;
    if (!targetTab) return;
    document.querySelectorAll<HTMLButtonElement>('.project-tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll<HTMLElement>('.project-tab-panel').forEach((panel) => {
      panel.classList.toggle('hidden', panel.id !== `project-panel-${targetTab}`);
    });
    if (targetTab === 'lyrics') {
      setTimeout(() => updateLyricsDocumentPagination(), 20);
    }
  });
});

// --- Project Event Listeners ---

function openNewProjectModal(): void {
  const nameInput = $<HTMLInputElement>('new-project-name');
  const descInput = $<HTMLInputElement>('new-project-desc');
  if (nameInput) nameInput.value = '';
  if (descInput) descInput.value = '';
  setText('new-project-error', '');
  $('new-project-modal')?.classList.remove('hidden');
  setTimeout(() => nameInput?.focus(), 50);
}

$('btn-new-project')?.addEventListener('click', openNewProjectModal);
$('btn-create-first-project')?.addEventListener('click', openNewProjectModal);

$('btn-close-new-project')?.addEventListener('click', () => $('new-project-modal')?.classList.add('hidden'));
$('btn-cancel-new-project')?.addEventListener('click', () => $('new-project-modal')?.classList.add('hidden'));

$<HTMLInputElement>('new-project-name')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $<HTMLButtonElement>('btn-create-project')?.click();
  }
});
$<HTMLInputElement>('new-project-desc')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $<HTMLButtonElement>('btn-create-project')?.click();
  }
});

$('btn-create-project')?.addEventListener('click', async () => {
  const name = $<HTMLInputElement>('new-project-name')?.value.trim();
  const desc = $<HTMLInputElement>('new-project-desc')?.value.trim();
  if (!name) {
    setText('new-project-error', 'Please enter a song or project name.');
    $<HTMLInputElement>('new-project-name')?.focus();
    return;
  }
  const token = auth.getToken();
  if (!token) {
    setText('new-project-error', 'Please sign in to your JaMeet account to create projects.');
    return;
  }
  const submitBtn = $<HTMLButtonElement>('btn-create-project');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating…';
  }
  try {
    setText('new-project-error', '');
    const created = await projectsApi.createProject(token, { name, description: desc || undefined });
    $('new-project-modal')?.classList.add('hidden');
    await loadProjects();
    // Open the newly created project immediately!
    if (created?.id) {
      await openProjectView(created.id);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not create project. Please try again.';
    setText('new-project-error', msg);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Project';
    }
  }
});

$('btn-refresh-projects')?.addEventListener('click', () => void loadProjects());

$('btn-project-back')?.addEventListener('click', () => {
  activeProjectId = undefined;
  activeProject = undefined;
  showView('home-view');
  void loadProjects();
});
$('project-view-home-crumb')?.addEventListener('click', () => {
  activeProjectId = undefined;
  activeProject = undefined;
  showView('home-view');
  void loadProjects();
});

$('btn-project-start-session')?.addEventListener('click', async () => {
  if (!activeProject) return;
  activeProjectId = activeProject.id;
  await prepareStudio({ type: 'create' });
});

// Project Menu
let projectMenuOpen = false;
$('btn-project-menu')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const dropdown = $('project-menu-dropdown');
  if (!dropdown) return;
  projectMenuOpen = !projectMenuOpen;
  dropdown.classList.toggle('hidden', !projectMenuOpen);
  if (projectMenuOpen) {
    const btn = $('btn-project-menu');
    if (btn) {
      const rect = btn.getBoundingClientRect();
      dropdown.style.top = `${rect.bottom + 6}px`;
      dropdown.style.right = `${window.innerWidth - rect.right}px`;
      dropdown.style.left = 'auto';
    }
  }
});
document.addEventListener('click', () => {
  if (projectMenuOpen) {
    $('project-menu-dropdown')?.classList.add('hidden');
    projectMenuOpen = false;
  }
});

$('btn-project-rename')?.addEventListener('click', () => {
  if (!activeProject) return;
  $('project-menu-dropdown')?.classList.add('hidden');
  projectMenuOpen = false;
  $<HTMLInputElement>('rename-project-name').value = activeProject.name;
  $<HTMLTextAreaElement>('rename-project-desc').value = activeProject.description || '';
  setText('rename-project-error', '');
  $('rename-project-modal')?.classList.remove('hidden');
  $<HTMLInputElement>('rename-project-name')?.focus();
});
$('btn-close-rename-project')?.addEventListener('click', () => $('rename-project-modal')?.classList.add('hidden'));
$('btn-cancel-rename-project')?.addEventListener('click', () => $('rename-project-modal')?.classList.add('hidden'));
$('btn-save-rename-project')?.addEventListener('click', async () => {
  if (!activeProject) return;
  const name = $<HTMLInputElement>('rename-project-name')?.value.trim();
  const desc = $<HTMLTextAreaElement>('rename-project-desc')?.value.trim();
  if (!name) { setText('rename-project-error', 'Project name cannot be empty.'); return; }
  const token = auth.getToken();
  if (!token) { setText('rename-project-error', 'You must be signed in to edit projects.'); return; }
  const saveBtn = $<HTMLButtonElement>('btn-save-rename-project');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
  }
  try {
    setText('rename-project-error', '');
    const updated = await projectsApi.updateProject(token, activeProject.id, { name, description: desc || '' });
    activeProject = updated;
    renderProjectView();
    void loadProjects();
    $('rename-project-modal')?.classList.add('hidden');
  } catch (err) {
    setText('rename-project-error', err instanceof Error ? err.message : 'Failed to update project.');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  }
});

$('btn-project-archive')?.addEventListener('click', async () => {
  if (!activeProject) return;
  $('project-menu-dropdown')?.classList.add('hidden');
  projectMenuOpen = false;
  const token = auth.getToken();
  if (!token) return;
  try {
    if (activeProject.archived) {
      activeProject = await projectsApi.unarchiveProject(token, activeProject.id);
    } else {
      activeProject = await projectsApi.archiveProject(token, activeProject.id);
    }
    renderProjectView();
    void loadProjects();
  } catch (err) {
    console.error('Failed to archive/unarchive project:', err);
  }
});

$('btn-project-delete')?.addEventListener('click', () => {
  if (!activeProject) return;
  $('project-menu-dropdown')?.classList.add('hidden');
  projectMenuOpen = false;
  setText('delete-project-name-confirm', activeProject.name);
  $('delete-project-modal')?.classList.remove('hidden');
});
$('btn-close-delete-project')?.addEventListener('click', () => $('delete-project-modal')?.classList.add('hidden'));
$('btn-cancel-delete-project')?.addEventListener('click', () => $('delete-project-modal')?.classList.add('hidden'));
$('btn-confirm-delete-project')?.addEventListener('click', async () => {
  if (!activeProject) return;
  const token = auth.getToken();
  if (!token) return;
  const confirmBtn = $<HTMLButtonElement>('btn-confirm-delete-project');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting…';
  }
  try {
    await projectsApi.deleteProject(token, activeProject.id);
    $('delete-project-modal')?.classList.add('hidden');
    activeProject = undefined;
    activeProjectId = undefined;
    showView('home-view');
    void loadProjects();
  } catch (err) {
    console.error('Failed to delete project:', err);
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Delete Project';
    }
  }
});

// Add Collaborator
const openAddCollabModal = () => {
  $<HTMLInputElement>('add-collab-username').value = '';
  setText('add-collab-error', '');
  $('add-collab-modal')?.classList.remove('hidden');
  $<HTMLInputElement>('add-collab-username')?.focus();
};
$('btn-project-add-collab')?.addEventListener('click', openAddCollabModal);
$('btn-project-add-collab-tab')?.addEventListener('click', openAddCollabModal);

$('btn-close-add-collab')?.addEventListener('click', () => $('add-collab-modal')?.classList.add('hidden'));
$('btn-cancel-add-collab')?.addEventListener('click', () => $('add-collab-modal')?.classList.add('hidden'));
$('btn-confirm-add-collab')?.addEventListener('click', async () => {
  if (!activeProject) return;
  const usernameOrEmail = $<HTMLInputElement>('add-collab-username')?.value.trim();
  if (!usernameOrEmail) { setText('add-collab-error', 'Please enter a username or email.'); return; }
  const token = auth.getToken();
  if (!token) return;
  try {
    setText('add-collab-error', '');
    activeProject = await projectsApi.addCollaborator(token, activeProject.id, usernameOrEmail);
    renderProjectView();
    $('add-collab-modal')?.classList.add('hidden');
  } catch (err) {
    setText('add-collab-error', err instanceof Error ? err.message : 'Failed to add collaborator.');
  }
});

// Close modals on overlay click
for (const modalId of ['new-project-modal', 'rename-project-modal', 'add-collab-modal', 'delete-project-modal']) {
  const modal = $(modalId);
  modal?.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
}

// ========================================================
// PROJECT WORKSPACE: GOOGLE DOCS-INSPIRED SONGWRITING STUDIO & MULTI-DOC ENGINE
// ========================================================
let lyricsSaveTimeout: ReturnType<typeof setTimeout> | null = null;
let notesSaveTimeout: ReturnType<typeof setTimeout> | null = null;
let currentLyricsStatus: 'saving' | 'saved' | 'unsaved' = 'saved';
let currentNotesStatus: 'saving' | 'saved' | 'unsaved' = 'saved';
let currentStructureStatus: 'saving' | 'saved' | 'unsaved' = 'saved';
let currentTasksStatus: 'saving' | 'saved' | 'unsaved' = 'saved';
let sessionWorkspaceOpen = false;

// Snapshot of last confirmed server state for 3-way merging
let lastSyncedLyrics = '';
let lastSyncedNotes = '';

/**
 * Applies text update to a textarea (e.g. Notes) while preserving active cursor position
 */
function applyTextareaUpdatePreservingCursor(
  textarea: HTMLTextAreaElement,
  newText: string
): void {
  if (textarea.value === newText) return;
  const isFocused = document.activeElement === textarea;
  const oldText = textarea.value;
  const oldStart = textarea.selectionStart ?? oldText.length;
  const oldEnd = textarea.selectionEnd ?? oldText.length;

  textarea.value = newText;

  if (isFocused) {
    let newStart = oldStart;
    let newEnd = oldEnd;
    if (newText.length !== oldText.length) {
      let commonPrefix = 0;
      while (commonPrefix < oldText.length && commonPrefix < newText.length && oldText[commonPrefix] === newText[commonPrefix]) {
        commonPrefix++;
      }
      if (oldStart <= commonPrefix) {
        newStart = oldStart;
        newEnd = oldEnd;
      } else {
        const diff = newText.length - oldText.length;
        newStart = Math.max(0, Math.min(newText.length, oldStart + diff));
        newEnd = Math.max(0, Math.min(newText.length, oldEnd + diff));
      }
    }
    try {
      textarea.setSelectionRange(newStart, newEnd);
    } catch {
      // ignore
    }
  }
}

/**
 * Intelligent 3-way non-destructive line merge for collaborative notes & text
 */
function threeWayLineMerge(base: string, local: string, remote: string): string {
  if (local === remote) return local;
  if (local === base) return remote;
  if (remote === base) return local;

  if (local.startsWith(base) && base.length > 0) {
    const appended = local.slice(base.length);
    return remote + appended;
  }
  if (remote.startsWith(base) && base.length > 0) {
    const appended = remote.slice(base.length);
    return local + appended;
  }

  const baseLines = base.split('\n');
  const localLines = local.split('\n');
  const remoteLines = remote.split('\n');

  const resultLines: string[] = [];
  let bIdx = 0, lIdx = 0, rIdx = 0;

  while (lIdx < localLines.length || rIdx < remoteLines.length) {
    const bLine = bIdx < baseLines.length ? baseLines[bIdx] : undefined;
    const lLine = lIdx < localLines.length ? localLines[lIdx] : undefined;
    const rLine = rIdx < remoteLines.length ? remoteLines[rIdx] : undefined;

    if (lLine === rLine) {
      if (lLine !== undefined) resultLines.push(lLine);
      bIdx++; lIdx++; rIdx++;
    } else if (lLine === bLine) {
      if (rLine !== undefined) resultLines.push(rLine);
      bIdx++; lIdx++; rIdx++;
    } else if (rLine === bLine) {
      if (lLine !== undefined) resultLines.push(lLine);
      bIdx++; lIdx++; rIdx++;
    } else {
      if (lLine !== undefined) resultLines.push(lLine);
      if (rLine !== undefined && rLine !== lLine && !localLines.includes(rLine)) {
        resultLines.push(rLine);
      }
      bIdx++; lIdx++; rIdx++;
    }
  }

  return resultLines.join('\n');
}

function getActiveLyricsDoc(): { id: string; title: string; content: string; updatedAt: number } {
  if (!activeProject) {
    return { id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: 0 };
  }
  if (!activeProject.workspace) {
    activeProject.workspace = {
      lyrics: {
        activeDocumentId: 'doc-main',
        documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: Date.now() }],
        content: '',
        updatedAt: Date.now()
      },
      notes: { content: '', updatedAt: Date.now() }
    };
  }
  if (!activeProject.workspace.lyrics) {
    activeProject.workspace.lyrics = {
      activeDocumentId: 'doc-main',
      documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: Date.now() }],
      content: '',
      updatedAt: Date.now()
    };
  }

  const ws = activeProject.workspace.lyrics;
  if (!ws.documents || !Array.isArray(ws.documents) || ws.documents.length === 0) {
    ws.documents = [{ id: 'doc-main', title: 'Main Lyrics', content: ws.content || '', updatedAt: ws.updatedAt || Date.now() }];
    ws.activeDocumentId = 'doc-main';
  }

  const activeId = ws.activeDocumentId || ws.documents[0].id;
  const doc = ws.documents.find((d) => d && d.id === activeId) || ws.documents[0];
  ws.activeDocumentId = doc.id;
  return doc;
}

let lyricsFilterQuery = '';

function renderLyricsDocTabs(): void {
  const activeDoc = getActiveLyricsDoc();
  if (!activeProject?.workspace?.lyrics) return;
  const ws = activeProject.workspace.lyrics;
  const docs = ws.documents || [];
  const activeId = ws.activeDocumentId || activeDoc.id;

  // 1. Render Dedicated Lyrics Sidebar Document List
  const sidebarList = $('lyrics-sidebar-doc-list');
  if (sidebarList) {
    sidebarList.innerHTML = '';
    const filteredDocs = lyricsFilterQuery
      ? docs.filter((d) => d && d.title.toLowerCase().includes(lyricsFilterQuery.toLowerCase()))
      : docs;

    if (filteredDocs.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'sidebar-empty-hint';
      emptyEl.style.cssText = 'padding: 16px 8px; text-align: center; color: #64748b; font-size: 11px;';
      emptyEl.textContent = lyricsFilterQuery ? 'No drafts matching filter' : 'No drafts found';
      sidebarList.appendChild(emptyEl);
    } else {
      filteredDocs.forEach((doc, idx) => {
        if (!doc) return;
        const isActive = doc.id === activeId;
        const item = document.createElement('div');
        item.className = `lyrics-sidebar-item ${isActive ? 'active' : ''}`;
        item.dataset.docId = doc.id;

        const timeStr = doc.updatedAt ? projectsApi.formatRelativeTime(doc.updatedAt) : 'Draft';

        item.innerHTML = `
          <div class="sidebar-item-main">
            <span class="sidebar-item-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
            </span>
            <div class="sidebar-item-info">
              <div class="sidebar-item-title">${escapeHtml(doc.title || 'Untitled')}</div>
              <div class="sidebar-item-sub">${timeStr}</div>
            </div>
          </div>
          <div class="sidebar-item-actions">
            ${idx > 0 ? `<button type="button" class="btn-sidebar-item-action btn-move-up" title="Move Up"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="m18 15-6-6-6 6"/></svg></button>` : ''}
            ${idx < docs.length - 1 ? `<button type="button" class="btn-sidebar-item-action btn-move-down" title="Move Down"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="m6 9 6 6 6-6"/></svg></button>` : ''}
            <button type="button" class="btn-sidebar-item-action btn-dup" title="Duplicate"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>
            ${docs.length > 1 ? `<button type="button" class="btn-sidebar-item-action btn-del" title="Delete Draft"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>` : ''}
          </div>
        `;

        item.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('.btn-sidebar-item-action')) return;
          switchActiveLyricsDoc(doc.id);
        });

        item.querySelector('.btn-move-up')?.addEventListener('click', (e) => {
          e.stopPropagation();
          moveLyricsDoc(doc.id, 'up');
        });

        item.querySelector('.btn-move-down')?.addEventListener('click', (e) => {
          e.stopPropagation();
          moveLyricsDoc(doc.id, 'down');
        });

        item.querySelector('.btn-dup')?.addEventListener('click', (e) => {
          e.stopPropagation();
          duplicateLyricsDoc(doc.id);
        });

        item.querySelector('.btn-del')?.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteLyricsDoc(doc.id);
        });

        sidebarList.appendChild(item);
      });
    }
  }

  // Update total drafts count badge
  setText('lyrics-sidebar-doc-count', `${docs.length} ${docs.length === 1 ? 'Draft' : 'Drafts'} in Project`);

  // 2. Render In-Call Drawer Document Select
  const drawerDocSelect = $<HTMLSelectElement>('session-lyrics-doc-select');
  if (drawerDocSelect) {
    drawerDocSelect.innerHTML = '';
    docs.forEach((doc) => {
      if (!doc) return;
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = doc.title || 'Untitled';
      opt.selected = doc.id === activeId;
      drawerDocSelect.appendChild(opt);
    });
  }

  // 3. Set current document title in sheet header input
  const titleInput = $<HTMLInputElement>('lyrics-current-doc-title');
  if (titleInput && document.activeElement !== titleInput) {
    titleInput.value = activeDoc.title || '';
  }
}

function moveLyricsDoc(docId: string, direction: 'up' | 'down'): void {
  if (!activeProject?.workspace?.lyrics?.documents) return;
  const docs = activeProject.workspace.lyrics.documents;
  const idx = docs.findIndex((d) => d && d.id === docId);
  if (idx === -1) return;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= docs.length) return;

  const [moved] = docs.splice(idx, 1);
  docs.splice(targetIdx, 0, moved);
  renderLyricsDocTabs();

  const activeDoc = getActiveLyricsDoc();
  void saveLyricsWorkspace(activeDoc.content, activeDoc.id, activeDoc.title);
}

function duplicateLyricsDoc(docId: string): void {
  if (!activeProject?.workspace?.lyrics?.documents) return;
  const docs = activeProject.workspace.lyrics.documents;
  const source = docs.find((d) => d && d.id === docId) || getActiveLyricsDoc();
  const newId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const newTitle = `${source.title} (Copy)`;

  docs.push({
    id: newId,
    title: newTitle,
    content: source.content || '',
    updatedAt: Date.now()
  });
  activeProject.workspace.lyrics.activeDocumentId = newId;
  switchActiveLyricsDoc(newId);
}

function deleteLyricsDoc(docId: string): void {
  if (!activeProject?.workspace?.lyrics?.documents) return;
  const docs = activeProject.workspace.lyrics.documents;
  if (docs.length <= 1) {
    alert('A project must have at least one Lyrics document.');
    return;
  }
  const targetDoc = docs.find((d) => d && d.id === docId);
  if (!targetDoc) return;
  if (confirm(`Are you sure you want to delete "${targetDoc.title}"?`)) {
    const idx = docs.findIndex((d) => d.id === docId);
    if (idx !== -1) docs.splice(idx, 1);
    const nextDoc = docs[0];
    activeProject.workspace.lyrics.activeDocumentId = nextDoc.id;
    switchActiveLyricsDoc(nextDoc.id);
  }
}

function switchActiveLyricsDoc(docId: string): void {
  if (!activeProject?.workspace?.lyrics) return;
  activeProject.workspace.lyrics.activeDocumentId = docId;
  renderLyricsDocTabs();

  const doc = getActiveLyricsDoc();
  const projectEditor = $('project-lyrics-editor');
  const sessionEditor = $('session-lyrics-editor');

  if (projectEditor) projectEditor.innerHTML = sanitizeLyricsHtml(doc.content || '');
  if (sessionEditor) sessionEditor.innerHTML = sanitizeLyricsHtml(doc.content || '');

  lastSyncedLyrics = doc.content || '';
  updateLyricsStatsFromHtml(doc.content || '');
  setLyricsStatus('saved');

  // Debounce save active document switch
  void saveLyricsWorkspace(doc.content || '', doc.id, doc.title);
}

function updateLyricsDocumentPagination(): void {
  const projectEditor = $('project-lyrics-editor');
  const pagesBg = $('lyrics-pages-background');
  if (!projectEditor || !pagesBg) return;

  const PAGE_HEIGHT = 1056; // 11 inches at 96 DPI
  const PAGE_GAP = 28;      // physical separation gap
  const PAGE_TOP_MARGIN = 52;
  const PAGE_BOTTOM_MARGIN = 56;
  const PAGE_PITCH = PAGE_HEIGHT + PAGE_GAP; // 1084px

  // Reset any previous page-break gap margins to measure natural positioning
  const children = Array.from(projectEditor.children) as HTMLElement[];
  children.forEach((child) => {
    if (child.classList.contains('doc-page-break-gap')) {
      child.style.marginTop = '';
      child.classList.remove('doc-page-break-gap');
    }
  });

  // Calculate page distribution for block elements
  let currentPageIndex = 0; // 0 = Page 1
  let currentSheetPrintableBottom = PAGE_HEIGHT - PAGE_BOTTOM_MARGIN;

  if (children.length > 0) {
    children.forEach((child) => {
      const childTop = child.offsetTop;
      const childHeight = child.offsetHeight || 24;
      const childBottom = childTop + childHeight;

      if (childBottom > currentSheetPrintableBottom) {
        // Child overflows current page printable boundary; push to next page
        currentPageIndex++;
        const targetPrintableTop = (currentPageIndex * PAGE_PITCH) + PAGE_TOP_MARGIN;
        const neededMargin = Math.max(0, targetPrintableTop - child.offsetTop);
        child.style.marginTop = `${neededMargin}px`;
        child.classList.add('doc-page-break-gap');
        currentSheetPrintableBottom = (currentPageIndex * PAGE_PITCH) + PAGE_HEIGHT - PAGE_BOTTOM_MARGIN;
      }
    });
  }

  let totalPages = Math.max(1, currentPageIndex + 1);

  // Secondary height check to ensure pages background always covers entire editor extent
  const editorHeight = projectEditor.scrollHeight || projectEditor.offsetHeight;
  const minPagesByHeight = Math.max(1, Math.ceil((editorHeight + 80) / PAGE_PITCH));
  if (minPagesByHeight > totalPages) {
    totalPages = minPagesByHeight;
  }

  // Render or update background US Letter page sheets
  const activeDoc = getActiveLyricsDoc();
  const rawTitle = activeDoc.title || 'Main Lyrics';
  const docTitle = escapeHtml(rawTitle);
  const existingSheets = pagesBg.querySelectorAll('.lyrics-page-sheet');

  if (existingSheets.length !== totalPages) {
    let sheetsHtml = '';
    for (let i = 1; i <= totalPages; i++) {
      const isFirst = i === 1;
      sheetsHtml += `
        <div class="lyrics-page-sheet" data-page="${i}">
          <div class="page-sheet-header-guide">
            <span class="page-running-title">${isFirst ? docTitle : `${docTitle} · Page ${i}`}</span>
            <span class="page-running-doc-badge">${isFirst ? 'US Letter · 8.5" × 11"' : `Page ${i}`}</span>
          </div>
          <div class="page-sheet-footer-guide">
            <span class="page-sheet-number-pill">Page ${i} of ${totalPages}</span>
          </div>
        </div>
      `;
    }
    pagesBg.innerHTML = sheetsHtml;
  } else {
    existingSheets.forEach((sheet, idx) => {
      const pageNum = idx + 1;
      const isFirst = pageNum === 1;
      const titleEl = sheet.querySelector('.page-running-title');
      const numEl = sheet.querySelector('.page-sheet-number-pill');
      if (titleEl) titleEl.textContent = isFirst ? rawTitle : `${rawTitle} · Page ${pageNum}`;
      if (numEl) numEl.textContent = `Page ${pageNum} of ${totalPages}`;
    });
  }

  // Update editor min-height to match total pages
  projectEditor.style.minHeight = `${totalPages * PAGE_PITCH - PAGE_GAP - 120}px`;
}

function updateLyricsStatsFromHtml(html: string): void {
  const temp = document.createElement('div');
  temp.innerHTML = html || '';
  const text = temp.innerText || temp.textContent || '';

  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  const lines = text ? text.split('\n').filter((l) => l.trim().length > 0).length : 0;
  const chars = text.length;

  // Singing time estimate at 130 words per minute
  const totalSeconds = words > 0 ? Math.max(15, Math.round((words / 130) * 60)) : 0;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const singTimeStr = words > 0 ? `~${mins}:${secs < 10 ? '0' : ''}${secs} singing time` : '~0:00 singing time';

  // Run dynamic US Letter pagination calculation
  updateLyricsDocumentPagination();

  const pagesBg = $('lyrics-pages-background');
  const pageCount = pagesBg?.querySelectorAll('.lyrics-page-sheet').length || 1;
  const pageStr = `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`;

  setText('project-lyrics-stats', `${pageStr} · ${words} ${words === 1 ? 'word' : 'words'} · ${lines} ${lines === 1 ? 'line' : 'lines'}`);
  setText('lyrics-footer-char-count', `${chars} ${chars === 1 ? 'character' : 'characters'} · US Letter`);
  setText('lyrics-footer-read-time', singTimeStr);
}

function setLyricsStatus(status: 'saving' | 'saved' | 'unsaved'): void {
  currentLyricsStatus = status;
  const badges = [$('project-lyrics-status'), $('session-workspace-status')];
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed';
  badges.forEach((b) => {
    if (!b) return;
    b.className = `workspace-status-badge ${status}`;
    b.innerHTML = `<span class="status-dot"></span> ${label}`;
  });
  if (status === 'saved') {
    setText('lyrics-footer-last-saved', `Saved to cloud at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
  } else if (status === 'unsaved') {
    setText('lyrics-footer-last-saved', 'Save failed · Unsaved changes');
  }
}

function setNotesStatus(status: 'saving' | 'saved' | 'unsaved'): void {
  currentNotesStatus = status;
  const badges = [$('project-notes-status'), $('session-workspace-status')];
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed';
  badges.forEach((b) => {
    if (!b) return;
    b.className = `workspace-status-badge ${status}`;
    b.innerHTML = `<span class="status-dot"></span> ${label}`;
  });
}

function applyAuthoritativeWorkspaceUpdate(
  savedArea: 'lyrics' | 'notes' | 'structure' | 'tasks',
  serverWorkspace: any
): void {
  if (!activeProject || !serverWorkspace) return;
  if (!activeProject.workspace) {
    activeProject.workspace = {
      lyrics: { activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: Date.now() }], content: '', updatedAt: Date.now() },
      notes: { content: '', updatedAt: Date.now() },
      structure: { sections: [], updatedAt: Date.now() },
      tasks: { tasks: [], updatedAt: Date.now() }
    };
  }

  // 1. Lyrics
  const hasPendingLyrics = lyricsSaveTimeout !== null || currentLyricsStatus === 'saving' || currentLyricsStatus === 'unsaved';
  if (savedArea === 'lyrics' || (!hasPendingLyrics && serverWorkspace.lyrics)) {
    if (serverWorkspace.lyrics) {
      activeProject.workspace.lyrics = serverWorkspace.lyrics;
    }
  }

  // 2. Notes
  const currentLocalNotes = activeProject.workspace?.notes?.content ?? '';
  const hasPendingNotes = notesSaveTimeout !== null || currentNotesStatus === 'saving' || currentNotesStatus === 'unsaved' || currentLocalNotes !== lastSyncedNotes;
  if (savedArea === 'notes' || (!hasPendingNotes && serverWorkspace.notes)) {
    if (serverWorkspace.notes) {
      activeProject.workspace.notes = serverWorkspace.notes;
    }
  }

  // 3. Structure
  const hasPendingStructure = structureSaveTimeout !== null || currentStructureStatus === 'saving' || currentStructureStatus === 'unsaved';
  if (savedArea === 'structure' || (!hasPendingStructure && serverWorkspace.structure)) {
    if (serverWorkspace.structure) {
      activeProject.workspace.structure = serverWorkspace.structure;
    }
  }

  // 4. Tasks
  const hasPendingTasks = tasksSaveTimeout !== null || currentTasksStatus === 'saving' || currentTasksStatus === 'unsaved';
  if (savedArea === 'tasks' || (!hasPendingTasks && serverWorkspace.tasks)) {
    if (serverWorkspace.tasks) {
      activeProject.workspace.tasks = serverWorkspace.tasks;
    }
  }
}

function parseMusicalKey(keyString: string): { root: string; mode: 'Major' | 'Minor' } {
  if (!keyString || !keyString.trim()) {
    return { root: '', mode: 'Major' };
  }
  const clean = keyString.trim();
  const isMinor = /minor|min|\bm\b/i.test(clean);
  const mode: 'Major' | 'Minor' = isMinor ? 'Minor' : 'Major';

  const rootPart = clean.replace(/\s*(major|minor|maj|min)\s*/gi, '').trim();

  if (/^c[#♯]|^db|^d♭/i.test(rootPart)) return { root: 'C#', mode };
  if (/^d[#♯]|^eb|^e♭/i.test(rootPart)) return { root: 'Eb', mode };
  if (/^f[#♯]|^gb|^g♭/i.test(rootPart)) return { root: 'F#', mode };
  if (/^g[#♯]|^ab|^a♭/i.test(rootPart)) return { root: 'Ab', mode };
  if (/^a[#♯]|^bb|^b♭/i.test(rootPart)) return { root: 'Bb', mode };
  if (/^c/i.test(rootPart)) return { root: 'C', mode };
  if (/^d/i.test(rootPart)) return { root: 'D', mode };
  if (/^e/i.test(rootPart)) return { root: 'E', mode };
  if (/^f/i.test(rootPart)) return { root: 'F', mode };
  if (/^g/i.test(rootPart)) return { root: 'G', mode };
  if (/^a/i.test(rootPart)) return { root: 'A', mode };
  if (/^b/i.test(rootPart)) return { root: 'B', mode };

  return { root: '', mode: 'Major' };
}

function formatMusicalKey(root: string, mode: 'Major' | 'Minor'): string {
  if (!root) return '';
  const ROOT_DISPLAY: Record<string, string> = {
    'C': 'C',
    'C#': 'C♯',
    'D': 'D',
    'Eb': 'E♭',
    'E': 'E',
    'F': 'F',
    'F#': 'F♯',
    'G': 'G',
    'Ab': 'A♭',
    'A': 'A',
    'Bb': 'B♭',
    'B': 'B'
  };
  const rootName = ROOT_DISPLAY[root] || root;
  return `${rootName} ${mode}`;
}

function applyKeyToControls(keyString: string, force: boolean = false): void {
  const { root, mode } = parseMusicalKey(keyString);
  const pRoot = $<HTMLSelectElement>('project-notes-key-root');
  const pMode = $<HTMLSelectElement>('project-notes-key-mode');
  const sRoot = $<HTMLSelectElement>('session-notes-key-root');
  const sMode = $<HTMLSelectElement>('session-notes-key-mode');

  if (pRoot && (force || document.activeElement !== pRoot)) pRoot.value = root;
  if (pMode && (force || document.activeElement !== pMode)) {
    pMode.value = mode;
    pMode.disabled = !root;
    pMode.style.opacity = root ? '1' : '0.45';
  }

  if (sRoot && (force || document.activeElement !== sRoot)) sRoot.value = root;
  if (sMode && (force || document.activeElement !== sMode)) {
    sMode.value = mode;
    sMode.disabled = !root;
    sMode.style.opacity = root ? '1' : '0.45';
  }
}

function syncWorkspaceInputsFromProject(force = false): void {
  if (!activeProject) return;
  const ws = activeProject.workspace || {
    lyrics: { activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: 0 }], content: '', updatedAt: 0 },
    notes: { content: '', updatedAt: 0 }
  };

  renderLyricsDocTabs();
  const activeDoc = getActiveLyricsDoc();
  const lyricsHtml = activeDoc.content || '';
  const notesContent = ws.notes?.content || '';
  const notesBpm = ws.notes?.bpm || '';
  const notesKey = ws.notes?.key || '';

  if (force) {
    lastSyncedLyrics = lyricsHtml;
    lastSyncedNotes = notesContent;
  }

  const projectEditor = $('project-lyrics-editor');
  const sessionEditor = $('session-lyrics-editor');
  if (projectEditor && (force || document.activeElement !== projectEditor)) {
    projectEditor.innerHTML = sanitizeLyricsHtml(lyricsHtml);
  }
  if (sessionEditor && (force || document.activeElement !== sessionEditor)) {
    sessionEditor.innerHTML = sanitizeLyricsHtml(lyricsHtml);
  }
  updateLyricsStatsFromHtml(lyricsHtml);

  const projectNotesInput = $<HTMLTextAreaElement>('project-notes-input');
  const sessionNotesInput = $<HTMLTextAreaElement>('session-notes-input');
  if (projectNotesInput) applyTextareaUpdatePreservingCursor(projectNotesInput, notesContent);
  if (sessionNotesInput) applyTextareaUpdatePreservingCursor(sessionNotesInput, notesContent);

  const projectBpm = $<HTMLInputElement>('project-notes-bpm');
  const sessionBpm = $<HTMLInputElement>('session-notes-bpm');
  if (projectBpm && (force || document.activeElement !== projectBpm)) projectBpm.value = notesBpm;
  if (sessionBpm && (force || document.activeElement !== sessionBpm)) sessionBpm.value = notesBpm;

  applyKeyToControls(notesKey, force);

  renderStructureWorkspace();
  renderTasksWorkspace();
  renderProjectActivities(activeProject ?? null);

  if (force || (currentLyricsStatus !== 'unsaved' && currentLyricsStatus !== 'saving' && lyricsSaveTimeout === null)) {
    setLyricsStatus('saved');
  }
  if (force || (currentNotesStatus !== 'unsaved' && currentNotesStatus !== 'saving' && notesSaveTimeout === null)) {
    setNotesStatus('saved');
  }
  if (force || (currentStructureStatus !== 'unsaved' && currentStructureStatus !== 'saving' && structureSaveTimeout === null)) {
    setStructureStatus('saved');
  }
  if (force || (currentTasksStatus !== 'unsaved' && currentTasksStatus !== 'saving' && tasksSaveTimeout === null)) {
    setTasksStatus('saved');
  }
}

function handleLyricsEditorInput(source: 'project' | 'session'): void {
  if (!activeProject) return;
  const projectEditor = $('project-lyrics-editor');
  const sessionEditor = $('session-lyrics-editor');
  const sourceEl = source === 'project' ? projectEditor : sessionEditor;
  const targetEl = source === 'project' ? sessionEditor : projectEditor;

  const newHtml = sanitizeLyricsHtml(sourceEl?.innerHTML || '');
  if (targetEl && document.activeElement !== targetEl) {
    targetEl.innerHTML = newHtml;
  }

  const activeDoc = getActiveLyricsDoc();
  activeDoc.content = newHtml;
  activeDoc.updatedAt = Date.now();
  if (activeProject.workspace?.lyrics) {
    activeProject.workspace.lyrics.content = newHtml;
  }

  updateLyricsStatsFromHtml(newHtml);
  setLyricsStatus('saving');

  if (lyricsSaveTimeout) clearTimeout(lyricsSaveTimeout);
  lyricsSaveTimeout = setTimeout(() => {
    lyricsSaveTimeout = null;
    void saveLyricsWorkspace(newHtml, activeDoc.id, activeDoc.title);
  }, 350);
}

async function saveLyricsWorkspace(content: string, documentId?: string, title?: string): Promise<void> {
  if (!activeProject) return;
  const token = auth.getToken();
  if (!token) {
    setLyricsStatus('unsaved');
    return;
  }
  try {
    const activeDoc = getActiveLyricsDoc();
    const docId = documentId || activeDoc.id;
    const docTitle = title || activeDoc.title;

    const payload = {
      lyrics: {
        activeDocumentId: activeProject.workspace.lyrics.activeDocumentId,
        documents: activeProject.workspace.lyrics.documents,
        content,
        documentId: docId,
        title: docTitle
      }
    };

    const res = await signaling.updateProjectWorkspace(activeProject.id, payload, token);
    if (res?.ok && res.workspace && activeProject) {
      applyAuthoritativeWorkspaceUpdate('lyrics', res.workspace);
      const syncedDoc = getActiveLyricsDoc();
      lastSyncedLyrics = syncedDoc.content ?? content;
      setLyricsStatus('saved');
    } else {
      setLyricsStatus('unsaved');
    }
  } catch (err) {
    console.error('Failed to save lyrics document:', err);
    setLyricsStatus('unsaved');
  }
}

// Rich Text Document Formatting Execution
function execDocFormat(command: string, value: string = ''): void {
  const projectEditor = $('project-lyrics-editor');
  const sessionEditor = $('session-lyrics-editor');
  const activeEditor = inCall && document.activeElement === sessionEditor ? sessionEditor : projectEditor || sessionEditor;

  if (activeEditor) {
    activeEditor.focus();
  }
  document.execCommand(command, false, value);
  handleLyricsEditorInput(inCall && document.activeElement === sessionEditor ? 'session' : 'project');
}

// Musician Songwriting Section Insert
function insertSongSectionTag(sectionName: string): void {
  const projectEditor = $('project-lyrics-editor');
  const sessionEditor = $('session-lyrics-editor');
  const activeEditor = inCall && document.activeElement === sessionEditor ? sessionEditor : projectEditor || sessionEditor;
  if (!activeEditor) return;

  activeEditor.focus();
  const selection = window.getSelection();
  const tagHtml = `<div class="song-section-tag">[${escapeHtml(sectionName)}]</div><div><br></div>`;

  if (selection && selection.rangeCount > 0) {
    document.execCommand('insertHTML', false, tagHtml);
  } else {
    activeEditor.innerHTML += tagHtml;
  }
  handleLyricsEditorInput(inCall && document.activeElement === sessionEditor ? 'session' : 'project');
}

// Attach Rich Formatting Toolbar Event Listeners
$('btn-doc-undo')?.addEventListener('click', () => execDocFormat('undo'));
$('btn-doc-redo')?.addEventListener('click', () => execDocFormat('redo'));
$('btn-doc-bold')?.addEventListener('click', () => execDocFormat('bold'));
$('btn-doc-italic')?.addEventListener('click', () => execDocFormat('italic'));
$('btn-doc-underline')?.addEventListener('click', () => execDocFormat('underline'));
$('btn-doc-strike')?.addEventListener('click', () => execDocFormat('strikeThrough'));
$('btn-doc-align-left')?.addEventListener('click', () => execDocFormat('justifyLeft'));
$('btn-doc-align-center')?.addEventListener('click', () => execDocFormat('justifyCenter'));
$('btn-doc-align-right')?.addEventListener('click', () => execDocFormat('justifyRight'));
$('btn-doc-list-bullet')?.addEventListener('click', () => execDocFormat('insertUnorderedList'));
$('btn-doc-list-num')?.addEventListener('click', () => execDocFormat('insertOrderedList'));
$('btn-doc-indent')?.addEventListener('click', () => execDocFormat('indent'));
$('btn-doc-outdent')?.addEventListener('click', () => execDocFormat('outdent'));
$('btn-doc-clear')?.addEventListener('click', () => execDocFormat('removeFormat'));

$('select-doc-heading')?.addEventListener('change', (e) => {
  const val = (e.target as HTMLSelectElement).value;
  execDocFormat('formatBlock', `<${val}>`);
});

$('select-doc-font')?.addEventListener('change', (e) => {
  const font = (e.target as HTMLSelectElement).value;
  execDocFormat('fontName', font);
});

$('select-doc-fontsize')?.addEventListener('change', (e) => {
  const size = (e.target as HTMLSelectElement).value;
  const projectEditor = $('project-lyrics-editor');
  if (projectEditor) projectEditor.style.fontSize = size;
  const sessionEditor = $('session-lyrics-editor');
  if (sessionEditor) sessionEditor.style.fontSize = size;
  updateLyricsDocumentPagination();
});

$('select-doc-spacing')?.addEventListener('change', (e) => {
  const spacing = (e.target as HTMLSelectElement).value;
  const projectEditor = $('project-lyrics-editor');
  if (projectEditor) projectEditor.style.lineHeight = spacing;
  const sessionEditor = $('session-lyrics-editor');
  if (sessionEditor) sessionEditor.style.lineHeight = spacing;
  updateLyricsDocumentPagination();
});

window.addEventListener('resize', () => {
  if (!$('project-panel-lyrics')?.classList.contains('hidden')) {
    updateLyricsDocumentPagination();
  }
});

// Color Picker Popovers Toggle
$('btn-doc-color-trigger')?.addEventListener('click', (e) => {
  e.stopPropagation();
  $('doc-color-palette')?.classList.toggle('hidden');
  $('doc-hilite-palette')?.classList.add('hidden');
});

$('btn-doc-hilite-trigger')?.addEventListener('click', (e) => {
  e.stopPropagation();
  $('doc-hilite-palette')?.classList.toggle('hidden');
  $('doc-color-palette')?.classList.add('hidden');
});

document.addEventListener('click', () => {
  $('doc-color-palette')?.classList.add('hidden');
  $('doc-hilite-palette')?.classList.add('hidden');
  $('lyrics-doc-options-popover')?.classList.add('hidden');
});

document.querySelectorAll<HTMLButtonElement>('.palette-swatch').forEach((swatch) => {
  swatch.addEventListener('click', (e) => {
    e.stopPropagation();
    const cmd = swatch.dataset.cmd;
    const color = swatch.dataset.color;
    if (cmd && color) {
      execDocFormat(cmd, color);
      if (cmd === 'foreColor') {
        const bar = $('current-text-color-bar');
        if (bar) bar.style.background = color;
      } else if (cmd === 'hiliteColor') {
        const bar = $('current-hilite-color-bar');
        if (bar) bar.style.background = color === 'transparent' ? 'transparent' : color;
      }
    }
    $('doc-color-palette')?.classList.add('hidden');
    $('doc-hilite-palette')?.classList.add('hidden');
  });
});

// Section Insert Helpers
document.querySelectorAll<HTMLButtonElement>('.btn-section-insert, .btn-session-section-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    const section = btn.dataset.section;
    if (section) insertSongSectionTag(section);
  });
});

// In-Session Formatting Toolbar
function updateSessionDocFormattingState(): void {
  try {
    $('btn-session-doc-bold')?.classList.toggle('active', document.queryCommandState('bold'));
    $('btn-session-doc-italic')?.classList.toggle('active', document.queryCommandState('italic'));
    $('btn-session-doc-underline')?.classList.toggle('active', document.queryCommandState('underline'));
  } catch {
    // ignore
  }
}

$('btn-session-doc-bold')?.addEventListener('click', () => {
  execDocFormat('bold');
  updateSessionDocFormattingState();
});
$('btn-session-doc-italic')?.addEventListener('click', () => {
  execDocFormat('italic');
  updateSessionDocFormattingState();
});
$('btn-session-doc-underline')?.addEventListener('click', () => {
  execDocFormat('underline');
  updateSessionDocFormattingState();
});

$('session-lyrics-editor')?.addEventListener('keyup', updateSessionDocFormattingState);
$('session-lyrics-editor')?.addEventListener('mouseup', updateSessionDocFormattingState);
$('session-lyrics-editor')?.addEventListener('click', updateSessionDocFormattingState);

// Search & Replace Bar in Document
$('btn-doc-search-toggle')?.addEventListener('click', () => {
  const bar = $('lyrics-search-bar');
  bar?.classList.toggle('hidden');
  if (!bar?.classList.contains('hidden')) {
    $<HTMLInputElement>('doc-search-input')?.focus();
  }
});

$('btn-doc-search-close')?.addEventListener('click', () => {
  $('lyrics-search-bar')?.classList.add('hidden');
});

$('btn-doc-find-next')?.addEventListener('click', () => {
  const query = $<HTMLInputElement>('doc-search-input')?.value.trim();
  if (query) (window as any).find?.(query, false, false, true, false, false, false);
});

$('btn-doc-find-prev')?.addEventListener('click', () => {
  const query = $<HTMLInputElement>('doc-search-input')?.value.trim();
  if (query) (window as any).find?.(query, false, true, true, false, false, false);
});

$('btn-doc-replace-one')?.addEventListener('click', () => {
  const findVal = $<HTMLInputElement>('doc-search-input')?.value;
  const replaceVal = $<HTMLInputElement>('doc-replace-input')?.value ?? '';
  if (!findVal) return;

  const activeDoc = getActiveLyricsDoc();
  if (activeDoc.content.includes(findVal)) {
    activeDoc.content = sanitizeLyricsHtml(activeDoc.content.replace(findVal, replaceVal));
    const editor = $('project-lyrics-editor');
    if (editor) editor.innerHTML = activeDoc.content;
    handleLyricsEditorInput('project');
  }
});

$('btn-doc-replace-all')?.addEventListener('click', () => {
  const findVal = $<HTMLInputElement>('doc-search-input')?.value;
  const replaceVal = $<HTMLInputElement>('doc-replace-input')?.value ?? '';
  if (!findVal) return;

  const activeDoc = getActiveLyricsDoc();
  const re = new RegExp(escapeRegex(findVal), 'g');
  activeDoc.content = sanitizeLyricsHtml(activeDoc.content.replace(re, replaceVal));
  const editor = $('project-lyrics-editor');
  if (editor) editor.innerHTML = activeDoc.content;
  handleLyricsEditorInput('project');
});

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Document Title Rename
$('lyrics-doc-filter-input')?.addEventListener('input', (e) => {
  lyricsFilterQuery = (e.target as HTMLInputElement).value.trim();
  renderLyricsDocTabs();
});

// Document Title Rename in Sheet Header
$('lyrics-current-doc-title')?.addEventListener('input', (e) => {
  const newTitle = (e.target as HTMLInputElement).value.trim();
  if (!newTitle) return;
  const activeDoc = getActiveLyricsDoc();
  activeDoc.title = newTitle;
  renderLyricsDocTabs();
  if (lyricsSaveTimeout) clearTimeout(lyricsSaveTimeout);
  lyricsSaveTimeout = setTimeout(() => {
    lyricsSaveTimeout = null;
    void saveLyricsWorkspace(activeDoc.content, activeDoc.id, newTitle);
  }, 400);
});

// New Document Creation Modal
$('btn-new-lyrics-doc')?.addEventListener('click', () => {
  setText('new-doc-error', '');
  const titleInp = $<HTMLInputElement>('input-new-doc-title');
  if (titleInp) titleInp.value = `Draft ${(activeProject?.workspace?.lyrics?.documents?.length || 1) + 1}`;
  $('new-lyrics-doc-modal')?.classList.remove('hidden');
  titleInp?.focus();
});

$('btn-session-new-doc')?.addEventListener('click', () => {
  setText('new-doc-error', '');
  const titleInp = $<HTMLInputElement>('input-new-doc-title');
  if (titleInp) titleInp.value = `Draft ${(activeProject?.workspace?.lyrics?.documents?.length || 1) + 1}`;
  $('new-lyrics-doc-modal')?.classList.remove('hidden');
  titleInp?.focus();
});

$('btn-close-new-doc-modal')?.addEventListener('click', () => {
  $('new-lyrics-doc-modal')?.classList.add('hidden');
});

$('btn-cancel-new-doc')?.addEventListener('click', () => {
  $('new-lyrics-doc-modal')?.classList.add('hidden');
});

document.querySelectorAll<HTMLButtonElement>('.btn-doc-title-preset').forEach((btn) => {
  btn.addEventListener('click', () => {
    const title = btn.dataset.title;
    const titleInp = $<HTMLInputElement>('input-new-doc-title');
    if (title && titleInp) {
      titleInp.value = title;
      titleInp.focus();
    }
  });
});

$('btn-confirm-create-doc')?.addEventListener('click', () => {
  const title = $<HTMLInputElement>('input-new-doc-title')?.value.trim() || 'Untitled Lyrics';
  const newId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  if (!activeProject?.workspace?.lyrics) return;
  const curLyrics = activeProject.workspace.lyrics;
  if (!curLyrics.documents) curLyrics.documents = [];

  curLyrics.documents.push({
    id: newId,
    title,
    content: '',
    updatedAt: Date.now()
  });
  curLyrics.activeDocumentId = newId;

  $('new-lyrics-doc-modal')?.classList.add('hidden');
  switchActiveLyricsDoc(newId);
});

// Document Options Popover Menu
$('btn-doc-options-menu')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const pop = $('lyrics-doc-options-popover');
  if (!pop) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  pop.style.top = `${rect.bottom + 6}px`;
  pop.style.left = `${Math.max(10, rect.right - 180)}px`;
  pop.classList.toggle('hidden');
});

$('btn-doc-opt-duplicate')?.addEventListener('click', () => {
  $('lyrics-doc-options-popover')?.classList.add('hidden');
  const activeDoc = getActiveLyricsDoc();
  const newId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const newTitle = `${activeDoc.title} (Copy)`;

  activeProject?.workspace?.lyrics?.documents?.push({
    id: newId,
    title: newTitle,
    content: activeDoc.content,
    updatedAt: Date.now()
  });
  if (activeProject?.workspace?.lyrics) {
    activeProject.workspace.lyrics.activeDocumentId = newId;
  }
  switchActiveLyricsDoc(newId);
});

$('btn-doc-opt-copy-text')?.addEventListener('click', async () => {
  $('lyrics-doc-options-popover')?.classList.add('hidden');
  const activeDoc = getActiveLyricsDoc();
  const temp = document.createElement('div');
  temp.innerHTML = activeDoc.content;
  const plain = temp.innerText || temp.textContent || '';
  try {
    await navigator.clipboard.writeText(plain);
    alert('✓ Lyrics copied to clipboard!');
  } catch {
    // ignore
  }
});

$('btn-doc-opt-delete')?.addEventListener('click', () => {
  $('lyrics-doc-options-popover')?.classList.add('hidden');
  const docs = activeProject?.workspace?.lyrics?.documents;
  if (!docs || docs.length <= 1) {
    alert('A project must have at least one Lyrics document.');
    return;
  }
  const activeDoc = getActiveLyricsDoc();
  if (confirm(`Are you sure you want to delete "${activeDoc.title}"?`)) {
    const idx = docs.findIndex((d) => d.id === activeDoc.id);
    if (idx !== -1) docs.splice(idx, 1);
    const nextDoc = docs[0];
    if (activeProject?.workspace?.lyrics) {
      activeProject.workspace.lyrics.activeDocumentId = nextDoc.id;
    }
    switchActiveLyricsDoc(nextDoc.id);
  }
});

// In-Session Document Select Dropdown
$<HTMLSelectElement>('session-lyrics-doc-select')?.addEventListener('change', (e) => {
  const docId = (e.target as HTMLSelectElement).value;
  if (docId) switchActiveLyricsDoc(docId);
});

// Editor Input Listeners
$('project-lyrics-editor')?.addEventListener('input', () => handleLyricsEditorInput('project'));
$('session-lyrics-editor')?.addEventListener('input', () => handleLyricsEditorInput('session'));

// Notes Management
function handleNotesInput(): void {
  if (!activeProject) return;
  if (!activeProject.workspace) {
    activeProject.workspace = {
      lyrics: {
        activeDocumentId: 'doc-main',
        documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: 0 }],
        content: '',
        updatedAt: 0
      },
      notes: { content: '', updatedAt: 0 }
    };
  }

  const projectNotesInput = $<HTMLTextAreaElement>('project-notes-input');
  const sessionNotesInput = $<HTMLTextAreaElement>('session-notes-input');
  const activeNotesEl = document.activeElement === sessionNotesInput ? sessionNotesInput : projectNotesInput;
  const content = activeNotesEl?.value ?? activeProject.workspace.notes.content ?? '';

  const projectBpm = $<HTMLInputElement>('project-notes-bpm');
  const sessionBpm = $<HTMLInputElement>('session-notes-bpm');
  const activeBpmEl = document.activeElement === sessionBpm ? sessionBpm : projectBpm;
  const bpm = activeBpmEl?.value ?? activeProject.workspace.notes.bpm ?? '';

  const pRoot = $<HTMLSelectElement>('project-notes-key-root');
  const pMode = $<HTMLSelectElement>('project-notes-key-mode');
  const sRoot = $<HTMLSelectElement>('session-notes-key-root');
  const sMode = $<HTMLSelectElement>('session-notes-key-mode');

  let activeRoot = '';
  let activeMode: 'Major' | 'Minor' = 'Major';

  if (document.activeElement === sRoot || document.activeElement === sMode) {
    activeRoot = sRoot?.value ?? '';
    activeMode = (sMode?.value as 'Major' | 'Minor') || 'Major';
  } else if (document.activeElement === pRoot || document.activeElement === pMode) {
    activeRoot = pRoot?.value ?? '';
    activeMode = (pMode?.value as 'Major' | 'Minor') || 'Major';
  } else {
    const existing = parseMusicalKey(activeProject.workspace.notes.key ?? '');
    activeRoot = existing.root;
    activeMode = existing.mode;
  }

  const key = formatMusicalKey(activeRoot, activeMode);

  activeProject.workspace.notes.content = content;
  activeProject.workspace.notes.bpm = bpm;
  activeProject.workspace.notes.key = key;

  // Sync to other inputs
  if (projectNotesInput && document.activeElement !== projectNotesInput) {
    applyTextareaUpdatePreservingCursor(projectNotesInput, content);
  }
  if (sessionNotesInput && document.activeElement !== sessionNotesInput) {
    applyTextareaUpdatePreservingCursor(sessionNotesInput, content);
  }
  if (projectBpm && document.activeElement !== projectBpm) projectBpm.value = bpm;
  if (sessionBpm && document.activeElement !== sessionBpm) sessionBpm.value = bpm;
  applyKeyToControls(key, false);

  setNotesStatus('saving');
  if (notesSaveTimeout) clearTimeout(notesSaveTimeout);
  notesSaveTimeout = setTimeout(() => {
    notesSaveTimeout = null;
    void saveNotesWorkspace(content, bpm, key);
  }, 350);
}

async function saveNotesWorkspace(content: string, bpm: string, key: string): Promise<void> {
  if (!activeProject) return;
  const token = auth.getToken();
  if (!token) {
    setNotesStatus('unsaved');
    return;
  }
  try {
    const res = await signaling.updateProjectWorkspace(activeProject.id, { notes: { content, bpm, key } }, token);
    if (res?.ok && res.workspace && activeProject) {
      applyAuthoritativeWorkspaceUpdate('notes', res.workspace);
      lastSyncedNotes = res.workspace.notes?.content ?? content;
      setNotesStatus('saved');
    } else {
      setNotesStatus('unsaved');
    }
  } catch (err) {
    console.error('Failed to save notes:', err);
    setNotesStatus('unsaved');
  }
}

// Attach Input Listeners for Notes
$<HTMLTextAreaElement>('project-notes-input')?.addEventListener('input', () => handleNotesInput());
$<HTMLTextAreaElement>('session-notes-input')?.addEventListener('input', () => handleNotesInput());
$<HTMLInputElement>('project-notes-bpm')?.addEventListener('input', () => handleNotesInput());
$<HTMLInputElement>('session-notes-bpm')?.addEventListener('input', () => handleNotesInput());
$('project-notes-key-root')?.addEventListener('change', () => handleNotesInput());
$('project-notes-key-mode')?.addEventListener('change', () => handleNotesInput());
$('session-notes-key-root')?.addEventListener('change', () => handleNotesInput());
$('session-notes-key-mode')?.addEventListener('change', () => handleNotesInput());

// ========================================================
// PROJECT WORKSPACE: SONG STRUCTURE & ARRANGEMENT ENGINE
// ========================================================
let structureSaveTimeout: ReturnType<typeof setTimeout> | null = null;

const SECTION_TYPE_LABELS: Record<string, string> = {
  'intro': 'Intro',
  'verse': 'Verse',
  'pre-chorus': 'Pre-Chorus',
  'chorus': 'Chorus',
  'post-chorus': 'Post-Chorus',
  'hook': 'Hook',
  'bridge': 'Bridge',
  'breakdown': 'Breakdown',
  'solo': 'Solo',
  'outro': 'Outro',
  'custom': 'Custom'
};

const SECTION_TYPE_DEFAULT_BARS: Record<string, number> = {
  'intro': 8,
  'verse': 16,
  'pre-chorus': 8,
  'chorus': 16,
  'post-chorus': 8,
  'hook': 8,
  'bridge': 8,
  'breakdown': 8,
  'solo': 8,
  'outro': 8,
  'custom': 8
};

function getStructureSections(): any[] {
  if (!activeProject) return [];
  if (!activeProject.workspace) {
    activeProject.workspace = {
      lyrics: { activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: Date.now() }], content: '', updatedAt: Date.now() },
      notes: { content: '', updatedAt: Date.now() },
      structure: { sections: [], updatedAt: Date.now() }
    };
  }
  if (!activeProject.workspace.structure) {
    activeProject.workspace.structure = { sections: [], updatedAt: Date.now() };
  }
  if (!Array.isArray(activeProject.workspace.structure.sections)) {
    activeProject.workspace.structure.sections = [];
  }
  return activeProject.workspace.structure.sections;
}

function setStructureStatus(status: 'saving' | 'saved' | 'unsaved'): void {
  currentStructureStatus = status;
  const badge = $('project-structure-status');
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed';
  if (badge) {
    badge.className = `workspace-status-badge ${status}`;
    badge.innerHTML = `<span class="status-dot"></span> ${label}`;
  }
}

function renderStructureWorkspace(): void {
  const sections = getStructureSections();
  const totalSections = sections.length;
  const totalBars = sections.reduce((sum, s) => sum + (Number(s.bars) || 0), 0);

  // 1. Update Header Metrics
  setText('structure-summary-sections', `${totalSections} ${totalSections === 1 ? 'Section' : 'Sections'}`);
  setText('structure-summary-bars', `${totalBars} Total Bars`);
  setText('session-structure-summary', `${totalSections} ${totalSections === 1 ? 'Section' : 'Sections'} · ${totalBars} Bars`);

  // 2. Render Arrangement Timeline Ribbon (Proportional DAW Blocks)
  const timelineEl = $('structure-timeline-ribbon');
  const sessionTimelineEl = $('session-structure-timeline');

  const renderTimeline = (container: HTMLElement | null, isDrawer: boolean) => {
    if (!container) return;
    container.innerHTML = '';
    if (sections.length === 0) {
      const emptyHint = document.createElement('div');
      emptyHint.style.cssText = 'color:#64748b; font-size:11px; padding:12px 6px; font-style:italic;';
      emptyHint.textContent = 'No sections added yet · Click + Verse or + Chorus to start mapping';
      container.appendChild(emptyHint);
      return;
    }

    sections.forEach((sec) => {
      const block = document.createElement('div');
      block.className = `timeline-block type-${sec.type || 'verse'}`;
      block.dataset.sectionId = sec.id;
      
      const bars = Number(sec.bars) || 8;
      // Proportional bar width: 8 bars ~ 76px, 16 bars ~ 140px, 32 bars ~ 270px
      const blockWidth = isDrawer ? Math.max(56, bars * 6.5) : Math.max(76, bars * 8.5);
      block.style.minWidth = `${blockWidth}px`;
      block.style.flex = `${bars} 0 auto`;

      block.innerHTML = `
        <span class="timeline-block-name">${escapeHtml(sec.name || SECTION_TYPE_LABELS[sec.type] || 'Section')}</span>
        <span class="timeline-block-bars">${sec.bars ? `${sec.bars} Bars` : '—'}</span>
      `;
      block.addEventListener('click', () => {
        const card = findSectionCard(sec.id);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.add('focused');
          container.querySelectorAll('.timeline-block').forEach((b) => b.classList.remove('active-section'));
          block.classList.add('active-section');
          setTimeout(() => card.classList.remove('focused'), 1600);
        }
      });
      container.appendChild(block);
    });
  };

  renderTimeline(timelineEl, false);
  renderTimeline(sessionTimelineEl, true);

  // 3. Render Arrangement Section Cards List (Ultra-Compact Single Row)
  const listEl = $('structure-sections-list');
  const emptyEl = $('structure-sections-empty');
  const sessionListEl = $('session-structure-sections-list');

  if (emptyEl) {
    emptyEl.classList.toggle('hidden', sections.length > 0);
  }

  const renderCards = (container: HTMLElement | null, isDrawer: boolean) => {
    if (!container) return;
    container.innerHTML = '';

    sections.forEach((sec, idx) => {
      const card = document.createElement('div');
      card.className = `${isDrawer ? 'drawer-section-card' : 'structure-section-card'} type-${sec.type || 'verse'}`;
      card.dataset.sectionId = sec.id;
      card.setAttribute('draggable', 'true');

      const COMMON_BAR_PRESETS = [1, 2, 4, 8, 12, 16, 24, 32];
      const curBars = Number(sec.bars) || 8;
      const isCustomBar = !COMMON_BAR_PRESETS.includes(curBars);

      if (isDrawer) {
        card.innerHTML = `
          <span class="drag-handle" title="Drag to reorder section">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
          </span>
          <span class="section-type-pill type-${sec.type || 'verse'}">${escapeHtml(SECTION_TYPE_LABELS[sec.type] || sec.type || 'VERSE')}</span>
          <input type="text" class="section-name-input" value="${escapeHtml(sec.name || '')}" placeholder="Title…" maxlength="80" />
          <select class="section-bars-select" aria-label="Section Bar Count" title="Section Length">
            <option value="1" ${curBars === 1 ? 'selected' : ''}>1 Bar</option>
            <option value="2" ${curBars === 2 ? 'selected' : ''}>2 Bars</option>
            <option value="4" ${curBars === 4 ? 'selected' : ''}>4 Bars</option>
            <option value="8" ${curBars === 8 && !isCustomBar ? 'selected' : ''}>8 Bars</option>
            <option value="12" ${curBars === 12 ? 'selected' : ''}>12 Bars</option>
            <option value="16" ${curBars === 16 ? 'selected' : ''}>16 Bars</option>
            <option value="24" ${curBars === 24 ? 'selected' : ''}>24 Bars</option>
            <option value="32" ${curBars === 32 ? 'selected' : ''}>32 Bars</option>
          </select>
          <button type="button" class="btn-card-action btn-del" title="Delete Section">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </button>
        `;
      } else {
        card.innerHTML = `
          <span class="drag-handle" title="Drag to reorder section">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
          </span>
          <span class="section-type-pill type-${sec.type || 'verse'}">${escapeHtml(SECTION_TYPE_LABELS[sec.type] || sec.type || 'VERSE')}</span>
          <input type="text" class="section-name-input" value="${escapeHtml(sec.name || '')}" placeholder="Section title…" maxlength="80" />
          
          <div class="section-note-compact-wrap">
            <input type="text" class="section-note-input" value="${escapeHtml(sec.note || '')}" placeholder="Arrangement note…" maxlength="300" />
          </div>

          <div class="section-bars-control-wrap" title="Section length in bars">
            <select class="section-bars-select" aria-label="Section Bar Count">
              <option value="1" ${curBars === 1 ? 'selected' : ''}>1 Bar</option>
              <option value="2" ${curBars === 2 ? 'selected' : ''}>2 Bars</option>
              <option value="4" ${curBars === 4 ? 'selected' : ''}>4 Bars</option>
              <option value="8" ${curBars === 8 && !isCustomBar ? 'selected' : ''}>8 Bars</option>
              <option value="12" ${curBars === 12 ? 'selected' : ''}>12 Bars</option>
              <option value="16" ${curBars === 16 ? 'selected' : ''}>16 Bars</option>
              <option value="24" ${curBars === 24 ? 'selected' : ''}>24 Bars</option>
              <option value="32" ${curBars === 32 ? 'selected' : ''}>32 Bars</option>
              <option value="custom" ${isCustomBar ? 'selected' : ''}>Custom…</option>
            </select>
            <input type="number" class="section-bars-custom-input ${isCustomBar ? '' : 'hidden'}" value="${curBars}" min="1" max="256" placeholder="Bars" />
          </div>

          <div class="section-card-actions">
            ${idx > 0 ? `<button type="button" class="btn-card-action btn-move-up" title="Move Up"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="m18 15-6-6-6 6"/></svg></button>` : ''}
            ${idx < sections.length - 1 ? `<button type="button" class="btn-card-action btn-move-down" title="Move Down"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="m6 9 6 6 6-6"/></svg></button>` : ''}
            <button type="button" class="btn-card-action btn-dup" title="Duplicate"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>
            <button type="button" class="btn-card-action btn-del" title="Delete Section"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
          </div>
        `;
      }

      // Drag and Drop Event Listeners
      card.addEventListener('dragstart', (e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'BUTTON' || target.tagName === 'SELECT' || target.closest('button, input, select')) {
          e.preventDefault();
          return;
        }
        draggedStructureSectionId = sec.id;
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', sec.id);
          e.dataTransfer.effectAllowed = 'move';
        }
        setTimeout(() => {
          card.classList.add('dragging');
        }, 0);
      });

      card.addEventListener('dragend', () => {
        draggedStructureSectionId = null;
        card.classList.remove('dragging');
        container.querySelectorAll('.drop-target-above, .drop-target-below, .dragging').forEach((el) => {
          el.classList.remove('drop-target-above', 'drop-target-below', 'dragging');
        });
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedStructureSectionId || draggedStructureSectionId === sec.id) return;
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

        const rect = card.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const isAbove = e.clientY < midY;

        if (isAbove) {
          card.classList.add('drop-target-above');
          card.classList.remove('drop-target-below');
        } else {
          card.classList.add('drop-target-below');
          card.classList.remove('drop-target-above');
        }
      });

      card.addEventListener('dragleave', (e) => {
        if (!card.contains(e.relatedTarget as Node)) {
          card.classList.remove('drop-target-above', 'drop-target-below');
        }
      });

      card.addEventListener('drop', (e) => {
        e.preventDefault();
        const sourceId = e.dataTransfer?.getData('text/plain') || draggedStructureSectionId;
        card.classList.remove('drop-target-above', 'drop-target-below');

        if (sourceId && sourceId !== sec.id) {
          const rect = card.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const isAbove = e.clientY < midY;
          reorderStructureSectionToPosition(sourceId, sec.id, isAbove ? 'before' : 'after');
        }
      });

      // Highlight corresponding timeline block on card focus
      card.addEventListener('focusin', () => {
        document.querySelectorAll('.timeline-block').forEach((b) => b.classList.remove('active-section'));
        const matchingBlocks = findTimelineBlocks(sec.id);
        matchingBlocks.forEach((b) => b.classList.add('active-section'));
      });

      card.addEventListener('focusout', (e) => {
        if (!card.contains(e.relatedTarget as Node)) {
          const matchingBlocks = findTimelineBlocks(sec.id);
          matchingBlocks.forEach((b) => b.classList.remove('active-section'));
        }
      });

      // Inline Edit Name
      const nameInput = card.querySelector<HTMLInputElement>('.section-name-input');
      nameInput?.addEventListener('input', (e) => {
        sec.name = (e.target as HTMLInputElement).value;
        sec.updatedAt = Date.now();
        // Update timeline title live
        findTimelineBlocks(sec.id).forEach((block) => {
          const blockName = block.querySelector('.timeline-block-name');
          if (blockName) blockName.textContent = sec.name || SECTION_TYPE_LABELS[sec.type] || 'Section';
        });
        debounceSaveStructure();
      });

      // Interactive Bar Selector (Common Presets + Custom)
      const barsSelect = card.querySelector<HTMLSelectElement>('.section-bars-select');
      const customBarsInput = card.querySelector<HTMLInputElement>('.section-bars-custom-input');

      const applyBarsChange = (val: number | undefined) => {
        sec.bars = val && val > 0 ? val : 8;
        sec.updatedAt = Date.now();
        // Update timeline block display live and adjust width
        findTimelineBlocks(sec.id).forEach((block) => {
          const blockBars = block.querySelector('.timeline-block-bars');
          if (blockBars) blockBars.textContent = `${sec.bars} Bars`;
          const bVal = sec.bars;
          block.style.minWidth = `${Math.max(76, bVal * 8.5)}px`;
          block.style.flex = `${bVal} 0 auto`;
        });
        const totalBars = sections.reduce((sum, s) => sum + (Number(s.bars) || 0), 0);
        setText('structure-summary-bars', `${totalBars} Total Bars`);
        setText('session-structure-summary', `${sections.length} ${sections.length === 1 ? 'Section' : 'Sections'} · ${totalBars} Bars`);
        debounceSaveStructure();
      };

      barsSelect?.addEventListener('change', () => {
        const selectedVal = barsSelect.value;
        if (selectedVal === 'custom') {
          customBarsInput?.classList.remove('hidden');
          customBarsInput?.focus();
          customBarsInput?.select();
        } else {
          customBarsInput?.classList.add('hidden');
          applyBarsChange(parseInt(selectedVal, 10));
        }
      });

      customBarsInput?.addEventListener('input', () => {
        const val = parseInt(customBarsInput.value, 10);
        if (!isNaN(val) && val > 0) {
          applyBarsChange(val);
        }
      });

      // Inline Edit Note
      const noteInput = card.querySelector<HTMLInputElement>('.section-note-input');
      noteInput?.addEventListener('input', (e) => {
        sec.note = (e.target as HTMLInputElement).value;
        sec.updatedAt = Date.now();
        debounceSaveStructure();
      });

      // Move Up
      card.querySelector('.btn-move-up')?.addEventListener('click', (e) => {
        e.stopPropagation();
        moveStructureSection(sec.id, 'up');
      });

      // Move Down
      card.querySelector('.btn-move-down')?.addEventListener('click', (e) => {
        e.stopPropagation();
        moveStructureSection(sec.id, 'down');
      });

      // Duplicate
      card.querySelector('.btn-dup')?.addEventListener('click', (e) => {
        e.stopPropagation();
        duplicateStructureSection(sec.id);
      });

      // Delete
      card.querySelector('.btn-del')?.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteStructureSection(sec.id);
      });

      container.appendChild(card);
    });
  };

  renderCards(listEl, false);
  renderCards(sessionListEl, true);
}

let draggedStructureSectionId: string | null = null;

function reorderStructureSectionToPosition(
  sourceId: string,
  targetId: string,
  position: 'before' | 'after'
): void {
  const sections = getStructureSections();
  const sourceIdx = sections.findIndex((s) => s.id === sourceId);
  const targetIdx = sections.findIndex((s) => s.id === targetId);
  if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) return;

  const [moved] = sections.splice(sourceIdx, 1);
  const newTargetIdx = sections.findIndex((s) => s.id === targetId);
  const insertIndex = position === 'before' ? newTargetIdx : newTargetIdx + 1;
  sections.splice(insertIndex, 0, moved);

  renderStructureWorkspace();
  debounceSaveStructure();
}

function debounceSaveStructure(): void {
  setStructureStatus('saving');
  if (structureSaveTimeout) clearTimeout(structureSaveTimeout);
  structureSaveTimeout = setTimeout(() => {
    structureSaveTimeout = null;
    void saveStructureWorkspace();
  }, 350);
}

async function saveStructureWorkspace(): Promise<void> {
  if (!activeProject) return;
  const token = auth.getToken();
  if (!token) {
    setStructureStatus('unsaved');
    return;
  }
  try {
    const sections = getStructureSections();
    const res = await signaling.updateProjectWorkspace(activeProject.id, { structure: { sections } }, token);
    if (res?.ok && res.workspace && activeProject) {
      applyAuthoritativeWorkspaceUpdate('structure', res.workspace);
      setStructureStatus('saved');
    } else {
      setStructureStatus('unsaved');
    }
  } catch (err) {
    console.error('Failed to save structure workspace:', err);
    setStructureStatus('unsaved');
  }
}

function addStructureSection(type: string): void {
  const sections = getStructureSections();
  const sameTypeCount = sections.filter((s) => s.type === type).length;
  const baseLabel = SECTION_TYPE_LABELS[type] || 'Section';
  const name = sameTypeCount === 0 && (type === 'intro' || type === 'bridge' || type === 'outro' || type === 'hook')
    ? baseLabel
    : `${baseLabel} ${sameTypeCount + 1}`;
  const bars = SECTION_TYPE_DEFAULT_BARS[type] || 8;
  const newId = `sec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  sections.push({
    id: newId,
    type: type as any,
    name,
    bars,
    note: '',
    updatedAt: Date.now()
  });

  renderStructureWorkspace();
  debounceSaveStructure();

  setTimeout(() => {
    const card = findSectionCard(newId);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.querySelector<HTMLInputElement>('.section-name-input')?.focus();
    }
  }, 50);
}

function moveStructureSection(id: string, direction: 'up' | 'down'): void {
  const sections = getStructureSections();
  const idx = sections.findIndex((s) => s.id === id);
  if (idx === -1) return;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= sections.length) return;

  const [moved] = sections.splice(idx, 1);
  sections.splice(targetIdx, 0, moved);
  renderStructureWorkspace();
  debounceSaveStructure();
}

function duplicateStructureSection(id: string): void {
  const sections = getStructureSections();
  const idx = sections.findIndex((s) => s.id === id);
  if (idx === -1) return;
  const source = sections[idx];
  const newId = `sec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  sections.splice(idx + 1, 0, {
    id: newId,
    type: source.type,
    name: `${source.name} (Copy)`,
    bars: source.bars,
    note: source.note || '',
    updatedAt: Date.now()
  });

  renderStructureWorkspace();
  debounceSaveStructure();
}

function deleteStructureSection(id: string): void {
  const sections = getStructureSections();
  const idx = sections.findIndex((s) => s.id === id);
  if (idx === -1) return;
  sections.splice(idx, 1);
  renderStructureWorkspace();
  debounceSaveStructure();
}

// Attach 1-Click Section Insert Listeners (Primary & More Sections Menu)
document.querySelectorAll<HTMLButtonElement>('.btn-add-section-preset:not(.btn-more-sections), .more-sec-item, .btn-drawer-add-sec').forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.sectionType || 'verse';
    addStructureSection(type);
    $('more-sections-menu')?.classList.add('hidden');
  });
});

// Toggle More Sections Dropdown Menu
$('btn-more-sections-toggle')?.addEventListener('click', (e) => {
  e.stopPropagation();
  $('more-sections-menu')?.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (!$( 'more-sections-menu')?.contains(e.target as Node) && e.target !== $('btn-more-sections-toggle')) {
    $('more-sections-menu')?.classList.add('hidden');
  }
});

// Real-Time Socket Workspace Sync
signaling.on('project:workspace:synced', (data: { projectId: string; workspace: any; updatedBy?: string; updatedByName?: string }) => {
  if (!data?.workspace) return;
  const matchesCurrent = activeProject?.id === data.projectId || sessionProjectId === data.projectId;
  if (!matchesCurrent) return;

  if (!activeProject) return;
  if (!activeProject.workspace) {
    activeProject.workspace = {
      lyrics: { activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: Date.now() }], content: '', updatedAt: Date.now() },
      notes: { content: '', updatedAt: Date.now() },
      structure: { sections: [], updatedAt: Date.now() },
      tasks: { tasks: [], updatedAt: Date.now() }
    };
  }

  // 1. Sync Lyrics Documents & Active Document
  const hasPendingLyrics = lyricsSaveTimeout !== null || currentLyricsStatus === 'saving' || currentLyricsStatus === 'unsaved';
  if (!hasPendingLyrics && data.workspace.lyrics) {
    activeProject.workspace.lyrics = data.workspace.lyrics;
    renderLyricsDocTabs();
    const activeDoc = getActiveLyricsDoc();
    const incomingLyrics = activeDoc.content || '';

    const projectEditor = $('project-lyrics-editor');
    const sessionEditor = $('session-lyrics-editor');
    const isEditingProject = document.activeElement === projectEditor;
    const isEditingSession = document.activeElement === sessionEditor;

    if (!isEditingProject && projectEditor) {
      projectEditor.innerHTML = sanitizeLyricsHtml(incomingLyrics);
    }
    if (!isEditingSession && sessionEditor) {
      sessionEditor.innerHTML = sanitizeLyricsHtml(incomingLyrics);
    }
    updateLyricsStatsFromHtml(incomingLyrics);
    lastSyncedLyrics = incomingLyrics;
    setLyricsStatus('saved');
  }

  // 2. Converge Notes
  const projectNotesInput = $<HTMLTextAreaElement>('project-notes-input');
  const sessionNotesInput = $<HTMLTextAreaElement>('session-notes-input');
  const incomingNotes = data.workspace.notes?.content ?? '';
  const currentLocalNotes = activeProject?.workspace?.notes?.content ?? '';
  const hasPendingNotes = notesSaveTimeout !== null || currentNotesStatus === 'saving' || currentNotesStatus === 'unsaved' || currentLocalNotes !== lastSyncedNotes;

  if (hasPendingNotes) {
    if (incomingNotes !== currentLocalNotes) {
      const mergedNotes = threeWayLineMerge(lastSyncedNotes, currentLocalNotes, incomingNotes);
      if (projectNotesInput) applyTextareaUpdatePreservingCursor(projectNotesInput, mergedNotes);
      if (sessionNotesInput) applyTextareaUpdatePreservingCursor(sessionNotesInput, mergedNotes);
      if (activeProject.workspace.notes) activeProject.workspace.notes.content = mergedNotes;
      lastSyncedNotes = incomingNotes;
      if (notesSaveTimeout) clearTimeout(notesSaveTimeout);
      setNotesStatus('saving');
      notesSaveTimeout = setTimeout(() => {
        notesSaveTimeout = null;
        void saveNotesWorkspace(mergedNotes, activeProject?.workspace?.notes?.bpm || '', activeProject?.workspace?.notes?.key || '');
      }, 350);
    }
  } else {
    if (data.workspace.notes) {
      if (activeProject.workspace.notes) activeProject.workspace.notes.content = incomingNotes;
      lastSyncedNotes = incomingNotes;
      if (projectNotesInput) applyTextareaUpdatePreservingCursor(projectNotesInput, incomingNotes);
      if (sessionNotesInput) applyTextareaUpdatePreservingCursor(sessionNotesInput, incomingNotes);

      const projectBpm = $<HTMLInputElement>('project-notes-bpm');
      const sessionBpm = $<HTMLInputElement>('session-notes-bpm');
      const incomingBpm = data.workspace.notes?.bpm ?? '';
      const incomingKey = data.workspace.notes?.key ?? '';

      if (projectBpm && document.activeElement !== projectBpm) projectBpm.value = incomingBpm;
      if (sessionBpm && document.activeElement !== sessionBpm) sessionBpm.value = incomingBpm;
      if (activeProject.workspace.notes) activeProject.workspace.notes.bpm = incomingBpm;

      if (activeProject.workspace.notes) activeProject.workspace.notes.key = incomingKey;
      applyKeyToControls(incomingKey, false);

      setNotesStatus('saved');
    }
  }

  // 3. Sync Song Structure
  const hasPendingStructure = structureSaveTimeout !== null || currentStructureStatus === 'saving' || currentStructureStatus === 'unsaved';
  if (!hasPendingStructure && data.workspace.structure) {
    const activeInputInStructure = document.activeElement && (
      document.activeElement.classList.contains('section-name-input') ||
      document.activeElement.classList.contains('section-bars-input') ||
      document.activeElement.classList.contains('section-note-input')
    );
    if (!activeInputInStructure) {
      activeProject.workspace.structure = data.workspace.structure;
      renderStructureWorkspace();
      setStructureStatus('saved');
    }
  }

  // 4. Sync Project Tasks with non-intrusive convergence
  const hasPendingTasks = tasksSaveTimeout !== null || currentTasksStatus === 'saving' || currentTasksStatus === 'unsaved';
  if (!hasPendingTasks && data.workspace?.tasks) {
    const activeTaskEl = document.activeElement;
    const isEditingTask = activeTaskEl && (
      activeTaskEl.classList.contains('task-title-input') ||
      activeTaskEl.classList.contains('task-note-input') ||
      activeTaskEl.classList.contains('drawer-task-title')
    );

    if (!isEditingTask) {
      activeProject.workspace.tasks = {
        tasks: Array.isArray(data.workspace.tasks.tasks) ? data.workspace.tasks.tasks : [],
        updatedAt: data.workspace.tasks.updatedAt || Date.now()
      };
      renderTasksWorkspace();
      setTasksStatus('saved');
    }
  }

  // 5. Sync Project Activities
  if (data.activities && activeProject) {
    activeProject.activities = data.activities;
    renderProjectActivities(activeProject ?? null);
  }
});

signaling.on('project:activity:new', (data: { projectId: string; activities: ProjectActivityItem[] }) => {
  if (activeProject && activeProject.id === data.projectId) {
    activeProject.activities = data.activities;
    renderProjectActivities(activeProject ?? null);
  }
});

// ========================================================
// IN-SESSION PROJECT WORKSPACE DRAWER & STUDIO DESK ENGINE
// ========================================================

// Initialize saved workspace width
try {
  const savedDrawerWidth = parseInt(localStorage.getItem('jameet-session-workspace-width') || localStorage.getItem('musiczoom-session-workspace-width') || '460', 10);
  if (savedDrawerWidth && savedDrawerWidth >= 340 && savedDrawerWidth <= 780) {
    document.documentElement.style.setProperty('--session-drawer-width', `${savedDrawerWidth}px`);
  }
} catch {
  // ignore
}

function setSessionWorkspaceOpen(open: boolean): void {
  sessionWorkspaceOpen = open;
  $('session-workspace-drawer')?.classList.toggle('hidden', !open);
  $('toggle-session-workspace')?.classList.toggle('active', open);
  $('call-view')?.classList.toggle('has-drawer-open', open);

  if (open) {
    const titleEl = $('session-workspace-project-name');
    if (titleEl && activeProject) {
      titleEl.textContent = activeProject.name || 'Project Workspace';
    }
    syncWorkspaceInputsFromProject();

    // Restore saved workspace tab
    const savedTab = localStorage.getItem('jameet-session-workspace-tab') || localStorage.getItem('musiczoom-session-workspace-tab') || 'lyrics';
    const targetTabBtn = document.querySelector<HTMLButtonElement>(`.drawer-tab-btn[data-drawer-tab="${savedTab}"]`);
    if (targetTabBtn) {
      targetTabBtn.click();
    }
  }
}

// In-Session Workspace Drawer Toggle
$('toggle-session-workspace')?.addEventListener('click', () => {
  setSessionWorkspaceOpen(!sessionWorkspaceOpen);
});

$('btn-close-session-workspace')?.addEventListener('click', () => {
  setSessionWorkspaceOpen(false);
});

// In-Session Drawer Tabs
document.querySelectorAll<HTMLButtonElement>('.drawer-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.drawerTab;
    if (!tab) return;
    document.querySelectorAll<HTMLButtonElement>('.drawer-tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    $('drawer-panel-lyrics')?.classList.toggle('hidden', tab !== 'lyrics');
    $('drawer-panel-structure')?.classList.toggle('hidden', tab !== 'structure');
    $('drawer-panel-notes')?.classList.toggle('hidden', tab !== 'notes');
    $('drawer-panel-tasks')?.classList.toggle('hidden', tab !== 'tasks');
    try {
      localStorage.setItem('jameet-session-workspace-tab', tab);
    } catch {
      // ignore
    }
  });
});

// Resizable Session Workspace Panel
let isResizingDrawer = false;
let resizeStartX = 0;
let resizeStartWidth = 400;

$('session-workspace-resize-handle')?.addEventListener('mousedown', (e) => {
  isResizingDrawer = true;
  resizeStartX = e.clientX;
  const drawer = $('session-workspace-drawer');
  resizeStartWidth = drawer?.getBoundingClientRect().width || 400;
  drawer?.classList.add('is-resizing');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});

window.addEventListener('mousemove', (e) => {
  if (!isResizingDrawer) return;
  const deltaX = resizeStartX - e.clientX; // Dragging left increases width
  const maxW = Math.min(window.innerWidth * 0.5, 720);
  const newWidth = Math.max(320, Math.min(maxW, resizeStartWidth + deltaX));
  document.documentElement.style.setProperty('--session-drawer-width', `${Math.round(newWidth)}px`);
});

window.addEventListener('mouseup', () => {
  if (!isResizingDrawer) return;
  isResizingDrawer = false;
  $('session-workspace-drawer')?.classList.remove('is-resizing');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  const currentWidth = $('session-workspace-drawer')?.getBoundingClientRect().width;
  if (currentWidth) {
    try {
      const w = Math.round(currentWidth).toString();
      localStorage.setItem('jameet-session-workspace-width', w);
    } catch {
      // ignore
    }
  }
});

// ========================================================
// PROJECT WORKSPACE: TASKS & CHECKLIST ENGINE
// ========================================================
let tasksSaveTimeout: ReturnType<typeof setTimeout> | null = null;
let currentTaskFilter: 'all' | 'todo' | 'in_progress' | 'done' = 'all';
let draggedTaskId: string | null = null;

function getProjectTasks(): ProjectTaskItem[] {
  if (!activeProject) return [];
  if (!activeProject.workspace) {
    activeProject.workspace = {
      lyrics: { activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: 0 }], content: '', updatedAt: 0 },
      notes: { content: '', updatedAt: 0 },
      structure: { sections: [], updatedAt: 0 },
      tasks: { tasks: [], updatedAt: 0 }
    };
  }
  if (!activeProject.workspace.tasks) {
    activeProject.workspace.tasks = { tasks: [], updatedAt: 0 };
  }
  if (!Array.isArray(activeProject.workspace.tasks.tasks)) {
    activeProject.workspace.tasks.tasks = [];
  }
  return activeProject.workspace.tasks.tasks;
}

function setTasksStatus(status: 'saving' | 'saved' | 'unsaved'): void {
  currentTasksStatus = status;
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed';
  const badge = $('project-tasks-status');
  if (badge) {
    badge.className = `workspace-status-badge ${status}`;
    badge.innerHTML = `<span class="status-dot"></span> ${label}`;
  }
  const sessionStatus = $('session-workspace-status');
  if (sessionStatus) {
    sessionStatus.className = `workspace-status-badge ${status}`;
    sessionStatus.innerHTML = `<span class="status-dot"></span> ${label}`;
  }
}

function debounceSaveTasks(): void {
  setTasksStatus('saving');
  if (tasksSaveTimeout) clearTimeout(tasksSaveTimeout);
  tasksSaveTimeout = setTimeout(() => {
    tasksSaveTimeout = null;
    void saveTasksWorkspace();
  }, 350);
}

async function saveTasksWorkspace(): Promise<void> {
  if (!activeProject) return;
  const token = auth.getToken();
  if (!token) {
    setTasksStatus('unsaved');
    return;
  }
  const tasks = getProjectTasks();
  try {
    const res = await signaling.updateProjectWorkspace(activeProject.id, {
      tasks: { tasks }
    }, token);
    if (res?.ok && res.workspace && activeProject) {
      applyAuthoritativeWorkspaceUpdate('tasks', res.workspace);
      setTasksStatus('saved');
    } else {
      setTasksStatus('unsaved');
    }
  } catch (err) {
    console.error('Failed to save tasks workspace:', err);
    setTasksStatus('unsaved');
  }
}

function formatShortDate(d: string): string {
  try {
    const parts = d.split('-');
    if (parts.length === 3) {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[parseInt(parts[1], 10) - 1] || parts[1];
      const day = parseInt(parts[2], 10);
      return `${month} ${day}`;
    }
  } catch {
    // ignore
  }
  return d;
}

function renderTasksWorkspace(): void {
  if (!activeProject) return;
  const tasks = getProjectTasks();

  const totalCount = tasks.length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length;
  const todoCount = tasks.filter((t) => t.status === 'todo').length;
  const remainingCount = totalCount - doneCount;

  // 1. Update metric counters
  setText('task-count-all', totalCount.toString());
  setText('task-count-todo', todoCount.toString());
  setText('task-count-in_progress', inProgressCount.toString());
  setText('task-count-done', doneCount.toString());

  setText('tasks-summary-remaining', `${remainingCount} Remaining`);
  setText('tasks-summary-completed', `${doneCount} Done`);
  setText('tab-tasks-count', remainingCount.toString());
  setText('session-tasks-summary', `${remainingCount} Remaining · ${doneCount} Done`);

  // 2. Populate assignee selector on creation bar
  const createAssigneeSelect = $<HTMLSelectElement>('task-new-assignee');
  const sessionAssigneeSelect = $<HTMLSelectElement>('session-task-new-assignee');
  let opts = '<option value="">👤 Unassigned</option>';
  if (activeProject.ownerId) {
    const ownerName = activeProject.ownerDisplayName || activeProject.ownerUsername || 'Owner';
    opts += `<option value="${activeProject.ownerId}|${escapeHtml(ownerName)}">${escapeHtml(ownerName)} (Owner)</option>`;
  }
  if (Array.isArray(activeProject.collaborators)) {
    for (const c of activeProject.collaborators) {
      if (c.userId !== activeProject.ownerId) {
        const cName = c.displayName || c.username || 'Collaborator';
        opts += `<option value="${c.userId}|${escapeHtml(cName)}">${escapeHtml(cName)}</option>`;
      }
    }
  }
  if (createAssigneeSelect) {
    const currentVal = createAssigneeSelect.value;
    createAssigneeSelect.innerHTML = opts;
    if (currentVal) createAssigneeSelect.value = currentVal;
  }
  if (sessionAssigneeSelect) {
    const currentSessionVal = sessionAssigneeSelect.value;
    sessionAssigneeSelect.innerHTML = opts;
    if (currentSessionVal) sessionAssigneeSelect.value = currentSessionVal;
  }

  // 3. Filter tasks
  const filteredTasks = tasks.filter((t) => {
    if (currentTaskFilter === 'all') return true;
    return t.status === currentTaskFilter;
  });

  const listEl = $('project-tasks-list');
  const emptyEl = $('project-tasks-empty');
  const sessionListEl = $('session-tasks-list');

  if (emptyEl) {
    emptyEl.classList.toggle('hidden', filteredTasks.length > 0);
  }

  const renderCards = (container: HTMLElement | null, isDrawer = false) => {
    if (!container) return;
    container.innerHTML = '';

    const tasksToRender = isDrawer ? tasks : filteredTasks;

    tasksToRender.forEach((task) => {
      const card = document.createElement('div');
      card.className = isDrawer ? `drawer-task-card status-${task.status}` : `task-card status-${task.status}`;
      card.dataset.taskId = task.id;

      if (!isDrawer) {
        card.setAttribute('draggable', 'true');
      }

      // Quick toggle icon
      let toggleIcon = '';
      if (task.status === 'done') {
        toggleIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      } else if (task.status === 'in_progress') {
        toggleIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>`;
      }

      // Build assignee options
      let assigneeOptions = '<option value="">Unassigned</option>';
      if (activeProject.ownerId) {
        const ownerName = activeProject.ownerDisplayName || activeProject.ownerUsername || 'Owner';
        const isOwnerSelected = task.assigneeId === activeProject.ownerId;
        assigneeOptions += `<option value="${activeProject.ownerId}|${escapeHtml(ownerName)}" ${isOwnerSelected ? 'selected' : ''}>${escapeHtml(ownerName)} (Owner)</option>`;
      }
      if (Array.isArray(activeProject.collaborators)) {
        for (const c of activeProject.collaborators) {
          if (c.userId !== activeProject.ownerId) {
            const cName = c.displayName || c.username || 'Collaborator';
            const isSelected = task.assigneeId === c.userId;
            assigneeOptions += `<option value="${c.userId}|${escapeHtml(cName)}" ${isSelected ? 'selected' : ''}>${escapeHtml(cName)}</option>`;
          }
        }
      }

      if (isDrawer) {
        const assigneeInitial = task.assigneeName ? task.assigneeName.charAt(0).toUpperCase() : '';
        const assigneeDisplay = task.assigneeId
          ? `<span class="drawer-task-avatar">${escapeHtml(assigneeInitial)}</span><span class="drawer-task-assignee-name">${escapeHtml(task.assigneeName || 'Assigned')}</span>`
          : `<span class="drawer-task-avatar unassigned"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span><span class="drawer-task-assignee-name unassigned">Unassigned</span>`;

        card.innerHTML = `
          <button type="button" class="task-quick-toggle drawer-task-toggle" title="${task.status === 'done' ? 'Reopen task' : 'Mark as Done'}">
            ${toggleIcon}
          </button>
          <input type="text" class="drawer-task-title" value="${escapeHtml(task.title)}" placeholder="Task title…" />
          <div class="drawer-task-assignee-wrap" title="Change assignee">
            ${assigneeDisplay}
            <select class="drawer-task-assignee" title="Assignee">
              ${assigneeOptions}
            </select>
          </div>
          <button type="button" class="btn-card-action btn-del" title="Delete Task">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </button>
        `;
      } else {
        // Build progressive disclosure metadata elements
        // 1. Assignee display
        let assigneeHtml = '';
        if (task.assigneeId) {
          const initial = (task.assigneeName || 'U').charAt(0).toUpperCase();
          assigneeHtml = `
            <div class="task-meta-wrap">
              <button type="button" class="task-meta-badge assignee-badge btn-trigger-assignee" title="Change Assignee">
                <span class="task-meta-avatar">${initial}</span>
                <span>${escapeHtml(task.assigneeName || 'Collaborator')}</span>
              </button>
              <select class="task-card-inline-select task-assignee-select hidden" title="Select Assignee">
                ${assigneeOptions}
              </select>
            </div>
          `;
        } else {
          assigneeHtml = `
            <div class="task-meta-wrap">
              <button type="button" class="btn-meta-ghost btn-trigger-assignee" title="Assign to collaborator">
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>
                <span>+ Assign</span>
              </button>
              <select class="task-card-inline-select task-assignee-select hidden" title="Select Assignee">
                ${assigneeOptions}
              </select>
            </div>
          `;
        }

        // 2. Due Date display
        let dueHtml = '';
        if (task.dueDate) {
          dueHtml = `
            <div class="task-meta-wrap">
              <button type="button" class="task-meta-badge due-badge btn-trigger-due" title="Change Due Date">
                <span>📅 ${escapeHtml(formatShortDate(task.dueDate))}</span>
              </button>
              <input type="date" class="task-card-inline-date task-due-input hidden" value="${escapeHtml(task.dueDate)}" />
            </div>
          `;
        } else {
          dueHtml = `
            <div class="task-meta-wrap">
              <button type="button" class="btn-meta-ghost btn-trigger-due" title="Set Due Date">
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                <span>+ Due</span>
              </button>
              <input type="date" class="task-card-inline-date task-due-input hidden" />
            </div>
          `;
        }

        // 3. Note display
        let noteHtml = '';
        if (task.note && task.note.trim()) {
          noteHtml = `
            <div class="task-meta-wrap">
              <button type="button" class="task-meta-badge note-badge btn-trigger-note" title="${escapeHtml(task.note)}">
                <span>💬 ${escapeHtml(task.note)}</span>
              </button>
              <input type="text" class="task-card-inline-note task-note-input hidden" value="${escapeHtml(task.note)}" placeholder="Note…" maxlength="500" />
            </div>
          `;
        } else {
          noteHtml = `
            <div class="task-meta-wrap">
              <button type="button" class="btn-meta-ghost btn-trigger-note" title="Add Note">
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span>+ Note</span>
              </button>
              <input type="text" class="task-card-inline-note task-note-input hidden" placeholder="Add note…" maxlength="500" />
            </div>
          `;
        }

        card.innerHTML = `
          <div class="drag-handle" title="Drag to reorder">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>
          </div>
          <button type="button" class="task-quick-toggle" title="${task.status === 'done' ? 'Reopen task' : 'Mark as Done'}">
            ${toggleIcon}
          </button>
          <select class="task-status-select status-${task.status}" title="Task Status">
            <option value="todo" ${task.status === 'todo' ? 'selected' : ''}>To Do</option>
            <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
            <option value="done" ${task.status === 'done' ? 'selected' : ''}>Done</option>
          </select>
          <input type="text" class="task-title-input" value="${escapeHtml(task.title)}" placeholder="Task title…" maxlength="150" />
          <div class="task-metadata-row">
            ${assigneeHtml}
            ${dueHtml}
            ${noteHtml}
            <button type="button" class="btn-card-action btn-del" title="Delete Task">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </div>
        `;
      }

      // Quick toggle action
      card.querySelector('.task-quick-toggle')?.addEventListener('click', (e) => {
        e.stopPropagation();
        quickToggleTask(task.id);
      });

      // Explicit Status select
      const statusSelect = card.querySelector<HTMLSelectElement>('.task-status-select');
      statusSelect?.addEventListener('change', (e) => {
        const newStatus = (e.target as HTMLSelectElement).value as ProjectTaskStatus;
        updateTaskStatus(task.id, newStatus);
      });

      // Title input
      const titleInput = card.querySelector<HTMLInputElement>(isDrawer ? '.drawer-task-title' : '.task-title-input');
      titleInput?.addEventListener('input', (e) => {
        task.title = (e.target as HTMLInputElement).value;
        task.updatedAt = Date.now();
        debounceSaveTasks();
      });

      // Progressive disclosure: Note
      const triggerNote = card.querySelector<HTMLButtonElement>('.btn-trigger-note');
      const noteInput = card.querySelector<HTMLInputElement>('.task-note-input');
      if (triggerNote && noteInput) {
        triggerNote.addEventListener('click', (e) => {
          e.stopPropagation();
          triggerNote.classList.add('hidden');
          noteInput.classList.remove('hidden');
          noteInput.focus();
        });
        noteInput.addEventListener('blur', () => {
          task.note = noteInput.value.trim() || undefined;
          task.updatedAt = Date.now();
          debounceSaveTasks();
          renderTasksWorkspace();
        });
        noteInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            noteInput.blur();
          }
        });
      }

      // Progressive disclosure: Assignee
      const triggerAssignee = card.querySelector<HTMLButtonElement>('.btn-trigger-assignee');
      const assigneeSelect = card.querySelector<HTMLSelectElement>(isDrawer ? '.drawer-task-assignee' : '.task-assignee-select');
      if (triggerAssignee && assigneeSelect) {
        triggerAssignee.addEventListener('click', (e) => {
          e.stopPropagation();
          triggerAssignee.classList.add('hidden');
          assigneeSelect.classList.remove('hidden');
          assigneeSelect.focus();
        });
        assigneeSelect.addEventListener('change', (e) => {
          const val = (e.target as HTMLSelectElement).value;
          if (!val) {
            task.assigneeId = undefined;
            task.assigneeName = undefined;
          } else {
            const [aId, aName] = val.split('|');
            task.assigneeId = aId;
            task.assigneeName = aName;
          }
          task.updatedAt = Date.now();
          debounceSaveTasks();
          renderTasksWorkspace();
        });
        assigneeSelect.addEventListener('blur', () => {
          renderTasksWorkspace();
        });
      } else if (isDrawer && assigneeSelect) {
        assigneeSelect.addEventListener('change', (e) => {
          const val = (e.target as HTMLSelectElement).value;
          if (!val) {
            task.assigneeId = undefined;
            task.assigneeName = undefined;
          } else {
            const [aId, aName] = val.split('|');
            task.assigneeId = aId;
            task.assigneeName = aName;
          }
          task.updatedAt = Date.now();
          debounceSaveTasks();
          renderTasksWorkspace();
        });
      }

      // Progressive disclosure: Due Date
      const triggerDue = card.querySelector<HTMLButtonElement>('.btn-trigger-due');
      const dueInput = card.querySelector<HTMLInputElement>('.task-due-input');
      if (triggerDue && dueInput) {
        triggerDue.addEventListener('click', (e) => {
          e.stopPropagation();
          triggerDue.classList.add('hidden');
          dueInput.classList.remove('hidden');
          dueInput.focus();
        });
        dueInput.addEventListener('change', () => {
          task.dueDate = dueInput.value || undefined;
          task.updatedAt = Date.now();
          debounceSaveTasks();
          renderTasksWorkspace();
        });
        dueInput.addEventListener('blur', () => {
          renderTasksWorkspace();
        });
      }

      // Delete action
      card.querySelector('.btn-del')?.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTask(task.id);
      });

      // Drag and Drop (Desktop list)
      if (!isDrawer) {
        card.addEventListener('dragstart', (e) => {
          draggedTaskId = task.id;
          card.classList.add('dragging');
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', task.id);
          }
        });

        card.addEventListener('dragend', () => {
          draggedTaskId = null;
          card.classList.remove('dragging');
          document.querySelectorAll('.task-card').forEach((c) => {
            c.classList.remove('drop-target-above', 'drop-target-below');
          });
        });

        card.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (!draggedTaskId || draggedTaskId === task.id) return;
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          const rect = card.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const isAbove = e.clientY < midY;
          card.classList.toggle('drop-target-above', isAbove);
          card.classList.toggle('drop-target-below', !isAbove);
        });

        card.addEventListener('dragleave', () => {
          card.classList.remove('drop-target-above', 'drop-target-below');
        });

        card.addEventListener('drop', (e) => {
          e.preventDefault();
          const sourceId = draggedTaskId || e.dataTransfer?.getData('text/plain');
          card.classList.remove('drop-target-above', 'drop-target-below');
          if (!sourceId || sourceId === task.id) return;
          const rect = card.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const isAbove = e.clientY < midY;
          reorderTaskToPosition(sourceId, task.id, isAbove ? 'before' : 'after');
        });
      }

      container.appendChild(card);
    });
  };

  renderCards(listEl, false);
  renderCards(sessionListEl, true);

  // 4. Render Overview Tasks Preview Card
  const overviewListEl = $('overview-tasks-list');
  if (overviewListEl) {
    overviewListEl.innerHTML = '';
    const pendingTasks = tasks.filter((t) => t.status !== 'done');
    setText('overview-tasks-count', pendingTasks.length.toString());

    if (pendingTasks.length === 0) {
      overviewListEl.innerHTML = `
        <div class="projects-empty" style="padding: 16px;">
          <p style="margin: 0; font-size: 12.5px; color: #94a3b8;">${tasks.length > 0 ? 'All production tasks are completed! 🎉' : 'No tasks added yet. Click View All Tasks to start tracking your to-dos.'}</p>
        </div>
      `;
    } else {
      pendingTasks.slice(0, 6).forEach((task) => {
        const item = document.createElement('div');
        item.className = `overview-task-item status-${task.status}`;
        const assigneeBadge = task.assigneeName ? `<span class="overview-task-assignee">${escapeHtml(task.assigneeName)}</span>` : '';
        const dueBadge = task.dueDate ? `<span class="overview-task-due">Due ${escapeHtml(task.dueDate)}</span>` : '';
        item.innerHTML = `
          <button type="button" class="task-quick-toggle" title="Mark as Done">
            ${task.status === 'in_progress' ? '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>' : ''}
          </button>
          <span class="overview-task-title">${escapeHtml(task.title)}</span>
          ${assigneeBadge}
          ${dueBadge}
        `;
        item.querySelector('.task-quick-toggle')?.addEventListener('click', (e) => {
          e.stopPropagation();
          quickToggleTask(task.id);
        });
        overviewListEl.appendChild(item);
      });
    }
  }
}

function createTask(
  title: string,
  assigneeId?: string,
  assigneeName?: string,
  dueDate?: string,
  note?: string
): void {
  const trimmed = title.trim();
  if (!trimmed) return;
  const tasks = getProjectTasks();
  const now = Date.now();
  const newTask: ProjectTaskItem = {
    id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    title: trimmed,
    status: 'todo',
    assigneeId: assigneeId || undefined,
    assigneeName: assigneeName || undefined,
    dueDate: dueDate || undefined,
    note: note || undefined,
    createdAt: now,
    updatedAt: now
  };
  tasks.unshift(newTask);
  renderTasksWorkspace();
  debounceSaveTasks();
}

function quickToggleTask(id: string): void {
  const tasks = getProjectTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  const now = Date.now();
  if (task.status === 'done') {
    task.status = 'todo';
    task.completedAt = undefined;
  } else {
    task.status = 'done';
    task.completedAt = now;
  }
  task.updatedAt = now;
  renderTasksWorkspace();
  debounceSaveTasks();
}

function updateTaskStatus(id: string, status: ProjectTaskStatus): void {
  const tasks = getProjectTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  const now = Date.now();
  task.status = status;
  if (status === 'done') {
    task.completedAt = now;
  } else {
    task.completedAt = undefined;
  }
  task.updatedAt = now;
  renderTasksWorkspace();
  debounceSaveTasks();
}

function deleteTask(id: string): void {
  const tasks = getProjectTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return;
  tasks.splice(idx, 1);
  renderTasksWorkspace();
  debounceSaveTasks();
}

function reorderTaskToPosition(
  sourceId: string,
  targetId: string,
  position: 'before' | 'after'
): void {
  const tasks = getProjectTasks();
  const sourceIdx = tasks.findIndex((t) => t.id === sourceId);
  const targetIdx = tasks.findIndex((t) => t.id === targetId);
  if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) return;

  const [moved] = tasks.splice(sourceIdx, 1);
  const newTargetIdx = tasks.findIndex((t) => t.id === targetId);
  const insertIndex = position === 'before' ? newTargetIdx : newTargetIdx + 1;
  tasks.splice(insertIndex, 0, moved);

  renderTasksWorkspace();
  debounceSaveTasks();
}

// Create Task Form Submit
$('form-create-task')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const titleInput = $<HTMLInputElement>('task-new-title');
  const assigneeSelect = $<HTMLSelectElement>('task-new-assignee');
  const dateInput = $<HTMLInputElement>('task-new-duedate');
  if (!titleInput) return;

  const title = titleInput.value.trim();
  if (!title) return;

  let aId: string | undefined;
  let aName: string | undefined;
  if (assigneeSelect && assigneeSelect.value) {
    const parts = assigneeSelect.value.split('|');
    aId = parts[0];
    aName = parts[1];
  }

  const dueDate = dateInput?.value || undefined;
  createTask(title, aId, aName, dueDate);
  titleInput.value = '';
  titleInput.focus();
});

// Quick Music Suggestion Chips
document.querySelectorAll<HTMLButtonElement>('.task-suggestion-chip:not(.btn-more-ideas), .more-idea-item').forEach((chip) => {
  chip.addEventListener('click', () => {
    const title = chip.dataset.taskTitle;
    if (title) {
      createTask(title);
    }
    $('more-ideas-menu')?.classList.add('hidden');
  });
});

// More Ideas Dropdown Toggle
$('btn-more-ideas-toggle')?.addEventListener('click', (e) => {
  e.stopPropagation();
  $('more-ideas-menu')?.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (!$('more-ideas-menu')?.contains(e.target as Node) && e.target !== $('btn-more-ideas-toggle')) {
    $('more-ideas-menu')?.classList.add('hidden');
  }
});

// Status Filter Buttons
document.querySelectorAll<HTMLButtonElement>('.task-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const filter = btn.dataset.filter as 'all' | 'todo' | 'in_progress' | 'done';
    if (!filter) return;
    currentTaskFilter = filter;
    document.querySelectorAll<HTMLButtonElement>('.task-filter-btn').forEach((b) => b.classList.toggle('active', b === btn));
    renderTasksWorkspace();
  });
});

// In-Session Drawer Create Task Form
$('session-form-create-task')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const titleInput = $<HTMLInputElement>('session-task-new-title');
  const assigneeSelect = $<HTMLSelectElement>('session-task-new-assignee');
  if (!titleInput) return;
  const title = titleInput.value.trim();
  if (!title) return;

  let aId: string | undefined;
  let aName: string | undefined;
  if (assigneeSelect?.value) {
    const parts = assigneeSelect.value.split('|');
    aId = parts[0];
    aName = parts[1];
  }

  createTask(title, aId, aName);
  titleInput.value = '';
  if (assigneeSelect) assigneeSelect.value = '';
  titleInput.focus();
});

// View All Tasks from Overview
$('btn-overview-view-tasks')?.addEventListener('click', () => {
  const taskTabBtn = document.querySelector<HTMLButtonElement>('.project-tab-btn[data-tab="tasks"]');
  taskTabBtn?.click();
});

// ========================================================
// ACTIVITY HISTORY & SESSION CHAT SUBSYSTEMS
// ========================================================
initActivityHistory(() => activeProject ?? null);
initSessionChat({ getSessionCode: () => currentCode, signaling });
