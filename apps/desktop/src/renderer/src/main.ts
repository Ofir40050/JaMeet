import type { AudioMode, MediaMetadata, MeetingAck, PerformanceMode, VideoQuality, ParticipantIdentity, UserProfile, UpdateProfileRequest, Project, ProjectSessionItem, SessionHistoryItem, ProjectTaskItem, ProjectTaskStatus, ProjectTaskStage, ProjectTaskSubtask, ProjectActivityItem, ProjectActivityType, SessionChatMessage, WaitingParticipantItem, ScheduledSession } from '@jameet/shared';
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
import { initSessionChat, resetChatUi, setSessionChatOpen, setOnChatOpenCallback } from './chat';
import { startRemoteVoiceBridge, stopRemoteVoiceBridge } from './remoteVoiceBridge';
import { logger } from './logger';
import './style.css';

export { escapeHtml, sanitizeLyricsHtml, safeAvatarColor };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const views = ['home-view', 'project-view', 'all-sessions-view', 'auth-view', 'setup-view', 'waiting-view', 'call-view', 'settings-view'] as const;
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
  mirrorCamera: boolean;
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
const activeMicPeaks = new Map<number, number>();
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
let lastLocalMusicDb = -60;
let lastLocalMusicPeakDb = -60;
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
      mirrorCamera: raw.mirrorCamera !== undefined ? Boolean(raw.mirrorCamera) : true,
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
      mirrorCamera: true,
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
  if (id === 'call-view') {
    updateAuthUi(auth.getUser(), auth.getGuestName());
    updateParticipantIdentityUi();
  }
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
      const targetName = currentFocusTarget === 'remote' ? (peerIdentity?.displayName || 'Musician') : 'You';
      if (labelEl) labelEl.textContent = `Focus: ${targetName}`;
      btn.title = `Stage Layout: Focus (${targetName})`;
    } else {
      iconEl.innerHTML = icons.layoutGrid({ size: 18 });
      if (labelEl) labelEl.textContent = 'Gallery';
      btn.title = 'Stage Layout: Gallery View';
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

function createDownscaledVideoTrack(rawTrack: MediaStreamTrack, width: number, height: number, fps: number): MediaStreamTrack {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const hiddenVideo = document.createElement('video');
  hiddenVideo.muted = true;
  hiddenVideo.playsInline = true;
  hiddenVideo.srcObject = new MediaStream([rawTrack]);
  hiddenVideo.play().catch(() => {});

  let animFrameId: number;
  const render = () => {
    if (rawTrack.readyState === 'ended') return;
    if (ctx && hiddenVideo.readyState >= 2) {
      ctx.drawImage(hiddenVideo, 0, 0, width, height);
    }
    animFrameId = requestAnimationFrame(render);
  };
  render();

  const scaledStream = canvas.captureStream(fps);
  const scaledTrack = scaledStream.getVideoTracks()[0];
  if (!scaledTrack) return rawTrack;

  const originalStop = scaledTrack.stop.bind(scaledTrack);
  scaledTrack.stop = () => {
    cancelAnimationFrame(animFrameId);
    hiddenVideo.srcObject = null;
    rawTrack.stop();
    originalStop();
  };
  return scaledTrack;
}

function updateLocalPreviews(): void {
  const setupVisible = !$('setup-view')?.classList.contains('hidden');
  const callVisible = !$('call-view')?.classList.contains('hidden');
  const settingsVisible = !$('settings-view')?.classList.contains('hidden');
  const setupVideo = $<HTMLVideoElement>('setup-video');
  const localVideo = $<HTMLVideoElement>('local-video');
  const settingsVideo = $<HTMLVideoElement>('settings-video');
  const isMirrored = prefs.mirrorCamera !== false;
  const visibleTrack = screenTrack ?? (cameraEnabled ? videoTrack : undefined);
  const isLowRes = prefs.cameraQuality === 'low';
  
  if (setupVisible && setupVideo) {
    const currentTrack = (setupVideo.srcObject as MediaStream)?.getVideoTracks()[0];
    if (currentTrack !== visibleTrack) {
      setupVideo.srcObject = visibleTrack ? new MediaStream([visibleTrack]) : null;
      if (visibleTrack) setupVideo.play().catch(() => {});
    }
    setupVideo.classList.toggle('mirror', isMirrored);
    setupVideo.classList.toggle('res-low', isLowRes);
  }
  if (callVisible && localVideo) {
    const camTrack = (cameraEnabled && videoTrack) ? videoTrack : undefined;
    const currentTrack = (localVideo.srcObject as MediaStream)?.getVideoTracks()[0];
    if (currentTrack !== camTrack) {
      localVideo.srcObject = camTrack ? new MediaStream([camTrack]) : null;
      if (camTrack) localVideo.play().catch(() => {});
    }
    localVideo.classList.toggle('mirror', isMirrored);
    localVideo.classList.toggle('res-low', isLowRes);
  }
  if (settingsVisible && settingsVideo) {
    const currentTrack = (settingsVideo.srcObject as MediaStream)?.getVideoTracks()[0];
    if (currentTrack !== visibleTrack) {
      settingsVideo.srcObject = visibleTrack ? new MediaStream([visibleTrack]) : null;
      if (visibleTrack) settingsVideo.play().catch(() => {});
    }
    settingsVideo.classList.toggle('mirror', isMirrored);
    settingsVideo.classList.toggle('res-low', isLowRes);
  }

  const badgeEl = $('settings-video-res-badge');
  if (badgeEl) {
    if (!videoTrack || !cameraEnabled) {
      badgeEl.textContent = 'Camera Off';
    } else {
      const q = prefs.cameraQuality;
      if (q === 'low') badgeEl.textContent = '360p · 15 fps (Low)';
      else if (q === 'standard') badgeEl.textContent = '540p · 24 fps (Standard)';
      else if (q === 'high') badgeEl.textContent = '720p · 30 fps (HD)';
      else if (q === 'fhd') badgeEl.textContent = '1080p · 30 fps (Full HD)';
      else if (q === 'qhd') badgeEl.textContent = '1440p · 30 fps (2K Quad HD)';
      else if (q === 'uhd') badgeEl.textContent = '2160p · 30 fps (4K Ultra HD)';
      else badgeEl.textContent = 'Auto (1080p · 30 fps)';
    }
  }
  
  const isVideoLive = Boolean(videoTrack && cameraEnabled);
  $('setup-video-placeholder')?.classList.toggle('hidden', isVideoLive);
  $('local-placeholder')?.classList.toggle('hidden', isVideoLive);
  $('settings-video-placeholder')?.classList.toggle('hidden', isVideoLive);
  const modeLabel = $('mode-label');
  if (modeLabel) modeLabel.textContent = prefs.mode === 'music' ? 'Music Mode' : 'Talk Mode';

  updateSessionStage();
}

async function acquireVideo(deviceId?: string): Promise<MediaStreamTrack> {
  let stream: MediaStream | undefined;
  const quality = effectiveVideoQuality(prefs.cameraQuality);
  
  if (deviceId) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: cameraConstraints(quality, deviceId),
        audio: false
      });
    } catch {
      // Fall through to generic camera constraints
    }
  }
  if (!stream) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: cameraConstraints(quality, undefined),
        audio: false
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
  }
  const rawTrack = stream.getVideoTracks()[0];
  if (!rawTrack) throw new Error('The selected camera did not provide video.');

  let finalTrack = rawTrack;
  if (quality === 'low') {
    finalTrack = createDownscaledVideoTrack(rawTrack, 640, 360, 15);
  } else if (quality === 'standard') {
    finalTrack = createDownscaledVideoTrack(rawTrack, 960, 540, 24);
  }

  finalTrack.enabled = cameraEnabled;
  return finalTrack;
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
  prefs.mode = mode;
  savePreferences();
  setModeRadios(mode);
  const activeIds = new Set(prefs.voiceInputs.filter((v) => v.enabled).map((v) => v.id));

  for (const id of Array.from(voiceMeters.keys())) {
    if (!activeIds.has(id)) {
      const m = voiceMeters.get(id);
      if (m) await m.stop();
      voiceMeters.delete(id);
      activeMicLevels.delete(id);
      activeMicPeaks.delete(id);
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

  syncMixerChannelsWithVoiceInputs();
  applyMixerAudioRouting();
  renderAudioLimitations();
  updateLocalPreviews();
  updateCallMode();
  if (inCall) {
    signaling.updateMedia(currentCode, metadata());
    await rtc.audioChanged(mode);
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
    lastLocalMusicDb = -60;
    lastLocalMusicPeakDb = -60;
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
        lastLocalMusicDb = -60;
        lastLocalMusicPeakDb = -60;
        await audio.remove('music');
        for (const statusId of ['music-app-status', 'call-music-app-status']) {
          const el = document.getElementById(statusId);
          if (el) el.textContent = `Waiting for application audio output`;
        }
      }
    } else {
      await musicMeter.stop();
      lastLocalMusicDb = -60;
      lastLocalMusicPeakDb = -60;
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
      lastLocalMusicDb = -60;
      lastLocalMusicPeakDb = -60;
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
      lastLocalMusicDb = -60;
      lastLocalMusicPeakDb = -60;
      await audio.remove('music');
      $('music-in-indicator')?.classList.remove('active');
    }
  }
  applyMixerAudioRouting();
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
  if (!rawName) return 'Default Device';
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
  // Strip trailing device IDs, hex hashes, vendor IDs, and anything in parentheses like (5bc678), (05ac:8514), etc.
  name = name.replace(/\s*\([^)]*\)\s*$/g, '').trim();
  name = name.replace(/:\d+$/, '').replace(/_DeviceUID$/, '').trim();
  return name || rawName.trim();
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
  const numId = Number(micId);
  const width = `${Math.max(0, Math.min(100, ((reading.rmsDb + 60) / 60) * 100))}%`;
  for (const prefix of ['setup-meter', 'call-meter', 'topbar-meter', 'unit-meter']) {
    const bar = document.getElementById(`${prefix}-${numId}`);
    if (bar) {
      bar.style.width = width;
      bar.parentElement?.classList.toggle('clip', reading.clipping);
    }
  }
  for (const prefix of ['setup-db', 'call-db', 'topbar-db', 'unit-db']) {
    const el = document.getElementById(`${prefix}-${numId}`);
    if (el) el.textContent = `${Math.round(reading.rmsDb)} dB`;
  }
  activeMicLevels.set(numId, reading.rmsDb);
  activeMicPeaks.set(numId, reading.peakDb);

  let maxLocal = -60;
  for (const db of activeMicLevels.values()) {
    if (db > maxLocal) maxLocal = db;
  }
  lastLocalVoiceDb = maxLocal;
  updateVoiceInIndicator();
  checkActiveSpeaker();
}

function renderMusicLevel(reading: LevelReading): void {
  lastLocalMusicDb = reading.rmsDb;
  lastLocalMusicPeakDb = reading.peakDb;
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
  const inCallMetersList = document.getElementById('in-call-meters-list');
  const topbarMicsBar = document.getElementById('call-topbar-mics-bar');

  if (voiceMicsList) voiceMicsList.replaceChildren();
  if (callVoiceMicsList) callVoiceMicsList.replaceChildren();
  if (setupMetersList) setupMetersList.replaceChildren();
  if (inCallMetersList) inCallMetersList.replaceChildren();
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
            <span class="btn-remove-icon">${icons.x({ size: 13 })}</span>
          </button>
        ` : ''}
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

      // Gain Slider (Both Sound Check & Settings!)
      const gainRow = document.createElement('div');
      gainRow.className = 'mic-gain-row';
      gainRow.innerHTML = `
        <div class="label-with-val">
          <span class="sub-field-label">Mic ${mic.id} Level (Gain):</span>
          <output id="${isCall ? 'call-' : ''}gain-val-${mic.id}" class="badge-value">${Math.round((mic.gain ?? 1) * 100)}%</output>
        </div>
        <input id="${isCall ? 'call-' : ''}gain-${mic.id}" type="range" min="0" max="2" step="0.01" value="${mic.gain ?? 1}" class="custom-slider mini-slider" />
      `;
      const slider = gainRow.querySelector<HTMLInputElement>(`#${isCall ? 'call-' : ''}gain-${mic.id}`);
      const valLabel = gainRow.querySelector<HTMLElement>(`#${isCall ? 'call-' : ''}gain-val-${mic.id}`);
      slider?.addEventListener('input', (event) => {
        const val = Number((event.currentTarget as HTMLInputElement).value);
        mic.gain = val;
        if (isPrimary) prefs.inputGain = val;
        savePreferences();
        if (valLabel) valLabel.textContent = `${Math.round(val * 100)}%`;
        for (const otherPrefix of ['', 'call-']) {
          const otherSlider = document.querySelector<HTMLInputElement>(`#${otherPrefix}gain-${mic.id}`);
          const otherValLabel = document.querySelector<HTMLElement>(`#${otherPrefix}gain-val-${mic.id}`);
          if (otherSlider && otherSlider !== event.currentTarget) otherSlider.value = String(val);
          if (otherValLabel && otherValLabel !== valLabel) otherValLabel.textContent = `${Math.round(val * 100)}%`;
        }
        // SYNC WITH STUDIO MIXER
        const chId = mic.id === 1 ? 'you-mic' : `you-mic-${mic.id}`;
        const micCh = studioMixerChannels.find((c) => c.id === chId || (mic.id === 1 && c.id === 'you-mic'));
        if (micCh) {
          micCh.volume = val;
          saveStudioMixerConfig(false);
          if (studioMixerOpen) {
            renderStudioMixer();
          }
        }

        applyMixerAudioRouting();

        const desktopApi = typeof window !== 'undefined' ? (window.jameet || window.musiczoom) : undefined;
        if (desktopApi?.setSystemInputVolume && isPrimary) {
          void desktopApi.setSystemInputVolume(Math.min(1.0, val));
        }
      });
      body.appendChild(gainRow);

      card.appendChild(body);
      container.appendChild(card);
    }

    // 2. Setup & In-Call Left Column Studio Meter Card
    for (const metersList of [setupMetersList, inCallMetersList]) {
      if (!metersList) continue;
      const prefix = metersList === inCallMetersList ? 'call-' : 'setup-';
      const studioCard = document.createElement('div');
      studioCard.className = `studio-meter-card ${isPrimary ? '' : 'secondary-meter-card'}`;
      studioCard.innerHTML = `
        <div class="meter-header">
          <div class="meter-title-wrap">
            <span class="meter-dot ${isPrimary ? '' : 'mic2-dot'}"></span>
            <span class="meter-title">VOICE INPUT ${mic.id}</span>
          </div>
          <output id="${prefix}db-${mic.id}" class="db-readout">−60 dB</output>
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
          <div id="${prefix}meter-${mic.id}" class="meter-fill"></div>
          <i class="clip" title="Clipping (Peak over 0 dBFS)"></i>
        </div>
      `;
      metersList.appendChild(studioCard);
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
      activeMicPeaks.delete(micId);
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
  const mirrorEl = document.getElementById('settings-mirror-camera') as HTMLInputElement | null;
  if (mirrorEl) mirrorEl.checked = prefs.mirrorCamera !== false;
  const audioOnlyEl = document.getElementById('audio-only-setup') as HTMLInputElement | null;
  if (audioOnlyEl) audioOnlyEl.checked = audioOnly;
  setModeRadios(prefs.mode);
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
  $('setup-waiting-room-group')?.classList.add('hidden');
  setMessage('setup-status', '');
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
    setMessage('setup-status', '');
  } catch (error) {
    showSessionErrorModal(parseSessionError(error));
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
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="setup-mode"], input[name="call-setup-mode"]')) {
    const isCur = radio.value === mode;
    radio.checked = isCur;
    const card = radio.closest<HTMLElement>('.mode-card');
    card?.classList.toggle('active', isCur);
  }
}
function updateMusicWarning(): void {
  updateHeadphoneWarning();
}
let sessionStartTime = 0;
let sessionTimerHandle: number | undefined;

function startSessionTimer(): void {
  stopSessionTimer();
  sessionStartTime = Date.now();
  setCallStatus('00:00');
  sessionTimerHandle = window.setInterval(() => {
    if (!inCall) return;
    const elapsedSec = Math.floor((Date.now() - sessionStartTime) / 1000);
    const m = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
    const s = (elapsedSec % 60).toString().padStart(2, '0');
    setCallStatus(`${m}:${s}`);
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
    toggleBtn.innerHTML = `<span class="tool-icon">${active ? icons.stopSquare({ size: 18 }) : icons.monitor({ size: 18 })}</span>`;
    toggleBtn.title = active ? 'Stop Sharing Screen' : 'Share Screen';
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
  if (remoteAudioCtx && remoteAudioCtx.state !== 'closed') {
    if (typeof (remoteAudioCtx as any).setSinkId === 'function') {
      await (remoteAudioCtx as any).setSinkId(deviceId ?? '');
    } else if (deviceId) {
      throw new Error('Audio output selection is not supported on this system.');
    }
  }

  const media = [$<HTMLAudioElement>('remote-voice-audio'), $<HTMLAudioElement>('remote-music-audio'), microphonePlayback].filter(Boolean) as HTMLMediaElement[];
  for (const element of media) {
    if (!element.setSinkId) {
      if (deviceId && !remoteAudioCtx) throw new Error('Audio output selection is not supported on this system.');
      continue;
    }
    await element.setSinkId(deviceId ?? '').catch(() => {});
  }

  prefs.audioOutputId = deviceId;
  savePreferences();
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

  // Reset Studio Mixer Mute & Solo for fresh session
  studioMixerChannels.forEach((ch) => {
    ch.muted = false;
    ch.soloed = false;
  });
  if (studioMixerOpen) {
    renderStudioMixer();
  }
  applyMixerAudioRouting();

  // In-Session Workspace Integration
  if (ack.projectId) {
    sessionProjectId = ack.projectId;
    const t = auth.getToken();
    if (t) {
      resetWorkspaceGenerations();
      const loadContextGen = currentWorkspaceContextGen;
      void projectsApi.fetchProject(t, ack.projectId).then((p) => {
        if (loadContextGen !== currentWorkspaceContextGen) return;
        activeProject = p;
        activeProjectId = p.id;
        setText('session-workspace-project-name', p.name);
        syncWorkspaceInputsFromProject(true);
        void signaling.joinProjectWorkspace(p.id, t).then((joinRes) => {
          if (joinRes?.ok && joinRes.workspace && activeProject && activeProject.id === p.id && loadContextGen === currentWorkspaceContextGen) {
            activeProject.workspace = joinRes.workspace;
            syncWorkspaceInputsFromProject(true);
          }
        });
        $('toggle-session-workspace')?.classList.remove('hidden');
      }).catch(() => {
        if (loadContextGen !== currentWorkspaceContextGen) return;
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

interface SessionErrorModalOptions {
  title: string;
  message: string;
  detail?: string;
  type?: 'error' | 'warning' | 'info';
  actionLabel?: string;
  dismissLabel?: string;
  onAction?: () => void;
}

function parseSessionError(error: unknown): SessionErrorModalOptions {
  const raw = error instanceof Error ? error.message : String(error || '');
  const lower = raw.toLowerCase();

  if (
    lower.includes('access to jameet') ||
    lower.includes('access restricted') ||
    lower.includes('access_denied') ||
    lower.includes('entitlement') ||
    lower.includes('does not currently have access') ||
    lower.includes('not have access') ||
    lower.includes('permission to access')
  ) {
    return {
      title: 'Session Access Restricted',
      message: 'Your account does not currently have access to JaMeet sessions.',
      detail: 'Creating and joining live studio sessions requires verified account access or an active plan. Please sign in or contact studio support.',
      type: 'warning',
      actionLabel: 'Sign In / Account',
      dismissLabel: 'Close',
      onAction: () => openAuthView('login')
    };
  }

  if (lower.includes('beta has ended') || lower.includes('beta_ended')) {
    return {
      title: 'JaMeet Beta Has Ended',
      message: 'The JaMeet public beta period has concluded. An active subscription is now required to create or join live studio sessions.',
      detail: 'Please sign in to manage your subscription or contact studio support.',
      type: 'warning',
      actionLabel: 'Sign In / Account',
      dismissLabel: 'Close',
      onAction: () => openAuthView('login')
    };
  }

  if (
    lower.includes('auth_required') ||
    lower.includes('sign in required') ||
    lower.includes('authentication required')
  ) {
    return {
      title: 'Sign In Required',
      message: 'An active JaMeet account is required to create or join studio sessions.',
      detail: 'Please sign in or create an account to start collaborating with low-latency audio.',
      type: 'info',
      actionLabel: 'Sign In',
      dismissLabel: 'Close',
      onAction: () => openAuthView('login')
    };
  }

  if (
    lower.includes('xhr poll error') ||
    lower.includes('websocket') ||
    lower.includes('polling') ||
    lower.includes('transport') ||
    lower.includes('network') ||
    lower.includes('failed to fetch') ||
    lower.includes('econnrefused') ||
    lower.includes('timeout')
  ) {
    return {
      title: 'Server Connection Unavailable',
      message: 'Could not establish a connection to the JaMeet studio network.',
      detail: 'Please check your internet connection or try again in a few moments. The studio server may be waking up or temporarily unavailable.',
      type: 'warning',
      actionLabel: 'Retry Connection',
      dismissLabel: 'Close',
      onAction: () => void enterSession()
    };
  }

  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return {
      title: 'Device Access Blocked',
      message: 'Microphone or camera permissions are required to enter the live session.',
      detail: 'Please grant microphone and camera permissions in System Settings (Privacy & Security), then try again.',
      type: 'warning',
      actionLabel: 'Try Again',
      dismissLabel: 'Close',
      onAction: () => void enterSession()
    };
  }

  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return {
      title: 'Audio Device Not Found',
      message: 'No connected microphone or audio input device was found.',
      detail: 'Please plug in your microphone or audio interface and ensure it appears under Voice Microphones.',
      type: 'error',
      actionLabel: 'Retry',
      dismissLabel: 'Close',
      onAction: () => void enterSession()
    };
  }

  return {
    title: 'Unable to Start Session',
    message: raw && raw !== 'The selected device could not be opened.' ? raw : 'An unexpected error occurred while preparing your live session.',
    detail: 'Please check your studio device connections and try entering the session again.',
    type: 'error',
    actionLabel: 'Try Again',
    dismissLabel: 'Close',
    onAction: () => void enterSession()
  };
}

function showSessionErrorModal(options: SessionErrorModalOptions): void {
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
    iconBadge.className = `modal-icon-badge ${options.type === 'warning' ? 'warning-icon-badge' : options.type === 'info' ? 'info-icon-badge' : 'error-icon-badge'}`;
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

let isEnteringSession = false;

async function enterSession(): Promise<void> {
  if (isEnteringSession) return;
  isEnteringSession = true;

  if (!pending || !audio.primary || (!audioOnly && !videoTrack)) {
    isEnteringSession = false;
    showSessionErrorModal({
      title: 'Studio Setup Required',
      message: 'Your microphone and session audio devices must be ready before entering.',
      detail: 'Please check your microphone connection and system audio permissions.',
      type: 'warning',
      actionLabel: 'OK'
    });
    return;
  }
  setBusy(true);
  try {
    const token = auth.getToken() || undefined;
    const guestName = auth.getGuestName() || undefined;
    const waitingRoomEnabled = $<HTMLInputElement>('setup-waiting-room')?.checked ?? false;
    let ack: MeetingAck = pending.type === 'create'
      ? await signaling.create(participantId, metadata(), token, guestName, activeProjectId, waitingRoomEnabled)
      : await signaling.join(pending.code, participantId, metadata(), token, guestName);

    if (!ack.ok && ack.message === 'Already in a session') {
      signaling.leave();
      ack = pending.type === 'create'
        ? await signaling.create(participantId, metadata(), token, guestName, activeProjectId, waitingRoomEnabled)
        : await signaling.join(pending.code, participantId, metadata(), token, guestName);
    }

    if (!ack.ok) {
      if (ack.code === 'AUTH_REQUIRED') {
        showSessionErrorModal({
          title: 'Sign In Required',
          message: 'An active JaMeet account is required to create or join studio sessions.',
          detail: 'Please sign in or create an account to start collaborating.',
          type: 'info',
          actionLabel: 'Sign In',
          onAction: () => openAuthView('login')
        });
      } else if (ack.code === 'BETA_ENDED') {
        showSessionErrorModal({
          title: 'JaMeet Beta Has Ended',
          message: 'The JaMeet public beta period has concluded. An active subscription is now required to create or join live studio sessions.',
          detail: 'Please sign in to manage your subscription or contact studio support.',
          type: 'warning',
          actionLabel: 'Sign In / Account',
          onAction: () => openAuthView('login')
        });
      } else if (ack.code === 'ACCESS_DENIED') {
        showSessionErrorModal({
          title: 'Access Restricted',
          message: 'Your account does not currently have permission to access JaMeet live sessions.',
          detail: 'Please check your account plan or contact studio support.',
          type: 'error',
          actionLabel: 'Sign In / Account',
          onAction: () => openAuthView('login')
        });
      } else if (ack.code === 'ROOM_FULL') {
        showSessionErrorModal({
          title: 'Session is Full',
          message: 'This session has reached its maximum participant limit.',
          detail: 'Ask the host to start a new session or try again later.',
          type: 'warning',
          actionLabel: 'OK'
        });
      } else if (ack.code === 'LOCKED') {
        showSessionErrorModal({
          title: 'Session is Locked',
          message: 'The host has locked this session to prevent new participants from joining.',
          detail: 'Please contact the session host to unlock the room.',
          type: 'warning',
          actionLabel: 'OK'
        });
      } else if (ack.code === 'NOT_FOUND') {
        showSessionErrorModal({
          title: 'Session Not Found',
          message: 'The session code is invalid or has already ended.',
          detail: 'Please verify the session code and try again.',
          type: 'error',
          actionLabel: 'OK'
        });
      } else {
        showSessionErrorModal({
          title: 'Unable to Join Session',
          message: ack.message || 'An unexpected error occurred while connecting to the studio session.',
          detail: 'Please check your connection and try again.',
          type: 'error',
          actionLabel: 'Retry',
          onAction: () => void enterSession()
        });
      }
      return;
    }

    $('session-error-modal')?.classList.add('hidden');

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
  } catch (error) {
    showSessionErrorModal(parseSessionError(error));
  } finally {
    isEnteringSession = false;
    setBusy(false);
  }
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
function getStereoBalanceGains(pan: number): { left: number; right: number } {
  const clamped = Math.max(-1, Math.min(1, pan));
  const left = clamped <= 0 ? 1.0 : Math.max(0, 1.0 - clamped);
  const right = clamped >= 0 ? 1.0 : Math.max(0, 1.0 + clamped);
  return { left, right };
}

let remoteAudioCtx: AudioContext | undefined;
let remoteVoiceGain: GainNode | undefined;
let remoteMusicGain: GainNode | undefined;
let remoteMasterGain: GainNode | undefined;
let remoteVoicePanner: StereoPannerNode | undefined;
let remoteMusicSplitter: ChannelSplitterNode | undefined;
let remoteMusicLeftGain: GainNode | undefined;
let remoteMusicRightGain: GainNode | undefined;
let remoteMusicMerger: ChannelMergerNode | undefined;
let remoteVoiceAnalyserL: AnalyserNode | undefined;
let remoteVoiceAnalyserR: AnalyserNode | undefined;
let remoteMusicAnalyserL: AnalyserNode | undefined;
let remoteMusicAnalyserR: AnalyserNode | undefined;
let remoteMasterAnalyserL: AnalyserNode | undefined;
let remoteMasterAnalyserR: AnalyserNode | undefined;
let remoteVoiceFxNodes: AudioNode[] = [];
let remoteMusicFxNodes: AudioNode[] = [];
let remoteLimiter: DynamicsCompressorNode | undefined;
let lastConnectedVoiceFx: string = '__uninitialized__';
let lastConnectedMusicFx: string = '__uninitialized__';
let remoteVoiceSourceNode: MediaStreamAudioSourceNode | undefined;
let remoteMusicSourceNode: MediaStreamAudioSourceNode | undefined;

async function getOrCreateRemoteAudioContext(): Promise<AudioContext> {
  if (!remoteAudioCtx || remoteAudioCtx.state === 'closed') {
    lastConnectedVoiceFx = '__uninitialized__';
    lastConnectedMusicFx = '__uninitialized__';
    remoteVoiceFxNodes = [];
    remoteMusicFxNodes = [];
    remoteAudioCtx = new AudioContext({ sampleRate: 48000 });
    remoteVoiceGain = remoteAudioCtx.createGain();
    remoteMusicGain = remoteAudioCtx.createGain();
    remoteMasterGain = remoteAudioCtx.createGain();
    remoteLimiter = remoteAudioCtx.createDynamicsCompressor();

    // Panning & Balance Stages:
    // Remote Voice: Constant Power Mono-to-Stereo Panner
    remoteVoicePanner = remoteAudioCtx.createStereoPanner();

    // Remote Music: True Stereo Balance (discrete L/R attenuation without crossfeed)
    remoteMusicSplitter = remoteAudioCtx.createChannelSplitter(2);
    remoteMusicLeftGain = remoteAudioCtx.createGain();
    remoteMusicRightGain = remoteAudioCtx.createGain();
    remoteMusicMerger = remoteAudioCtx.createChannelMerger(2);

    remoteMusicSplitter.connect(remoteMusicLeftGain, 0, 0);
    remoteMusicSplitter.connect(remoteMusicRightGain, 1, 0);
    remoteMusicLeftGain.connect(remoteMusicMerger, 0, 0);
    remoteMusicRightGain.connect(remoteMusicMerger, 0, 1);

    // Default bypass connections before mixer FX routing runs
    remoteVoiceGain.connect(remoteVoicePanner);
    remoteMusicGain.connect(remoteMusicSplitter);

    // Live Analysers for Real Level Metering (Stereo Measurement Taps)
    const voiceMeterSplitter = remoteAudioCtx.createChannelSplitter(2);
    remoteVoiceAnalyserL = remoteAudioCtx.createAnalyser();
    remoteVoiceAnalyserL.fftSize = 256;
    remoteVoiceAnalyserR = remoteAudioCtx.createAnalyser();
    remoteVoiceAnalyserR.fftSize = 256;

    remoteMusicAnalyserL = remoteAudioCtx.createAnalyser();
    remoteMusicAnalyserL.fftSize = 256;
    remoteMusicAnalyserR = remoteAudioCtx.createAnalyser();
    remoteMusicAnalyserR.fftSize = 256;

    const masterMeterSplitter = remoteAudioCtx.createChannelSplitter(2);
    remoteMasterAnalyserL = remoteAudioCtx.createAnalyser();
    remoteMasterAnalyserL.fftSize = 256;
    remoteMasterAnalyserR = remoteAudioCtx.createAnalyser();
    remoteMasterAnalyserR.fftSize = 256;

    // Protective Monitor Master Peak Limiter (fastest practical attack, hard knee, max ratio, ~ -0.5 dBFS threshold)
    remoteLimiter.threshold.setValueAtTime(-0.5, remoteAudioCtx.currentTime);
    remoteLimiter.knee.setValueAtTime(0.0, remoteAudioCtx.currentTime); // Hard knee for peak limiting
    remoteLimiter.ratio.setValueAtTime(20.0, remoteAudioCtx.currentTime); // High limiting ratio (20:1 max supported)
    remoteLimiter.attack.setValueAtTime(0.001, remoteAudioCtx.currentTime); // Minimum practical attack (1ms) supported by Web Audio DynamicsCompressorNode
    remoteLimiter.release.setValueAtTime(0.05, remoteAudioCtx.currentTime); // Fast release (50ms) to minimize pumping

    // Audio Graph Static Routing:
    // Panner / Balance -> Master
    remoteVoicePanner.connect(remoteMasterGain);
    remoteMusicMerger.connect(remoteMasterGain);

    // Measurement Taps (Measurement-only, not connected to output):
    remoteVoicePanner.connect(voiceMeterSplitter);
    voiceMeterSplitter.connect(remoteVoiceAnalyserL, 0);
    voiceMeterSplitter.connect(remoteVoiceAnalyserR, 1);

    remoteMusicLeftGain.connect(remoteMusicAnalyserL);
    remoteMusicRightGain.connect(remoteMusicAnalyserR);

    // Master: MasterGain -> Limiter -> Destination
    remoteMasterGain
      .connect(remoteLimiter)
      .connect(remoteAudioCtx.destination);

    remoteLimiter.connect(masterMeterSplitter);
    masterMeterSplitter.connect(remoteMasterAnalyserL, 0);
    masterMeterSplitter.connect(remoteMasterAnalyserR, 1);

    if (prefs.audioOutputId && typeof (remoteAudioCtx as any).setSinkId === 'function') {
      try {
        await (remoteAudioCtx as any).setSinkId(prefs.audioOutputId);
      } catch (err) {
        console.warn('Failed to setSinkId on remoteAudioCtx:', err);
      }
    }

    applyMixerAudioRouting();
  }
  if (remoteAudioCtx.state === 'suspended') {
    await remoteAudioCtx.resume().catch(() => {});
  }
  return remoteAudioCtx;
}

function setRemoteAudio(id: string, purpose: 'voice' | 'music', track: MediaStreamTrack): void {
  const existing = remoteAudioTracks.get(id);
  if (existing) {
    existing.track.onended = null;
    existing.track.stop();
  }
  remoteAudioTracks.set(id, { purpose, track });
  track.onended = () => {
    remoteAudioTracks.delete(id);
    if (!inCall) return;
    void refreshRemoteAudio();
  };
  if (inCall) {
    void refreshRemoteAudio();
  }
}

async function refreshRemoteAudio(): Promise<void> {
  const voice = [...remoteAudioTracks.values()].filter((item) => item.purpose === 'voice').map((item) => item.track);
  const music = [...remoteAudioTracks.values()].filter((item) => item.purpose === 'music').map((item) => item.track);

  if (voice.length === 0 && music.length === 0) {
    stopRemoteVoiceBridge();
    try { remoteVoiceSourceNode?.disconnect(); } catch {}
    remoteVoiceSourceNode = undefined;
    if (remoteVoiceMeter) {
      void remoteVoiceMeter.stop();
      remoteVoiceMeter = undefined;
    }
    lastRemoteVoiceDb = -60;
    checkActiveSpeaker();

    try { remoteMusicSourceNode?.disconnect(); } catch {}
    remoteMusicSourceNode = undefined;

    const voiceEl = $<HTMLAudioElement>('remote-voice-audio');
    const musicEl = $<HTMLAudioElement>('remote-music-audio');
    if (voiceEl) {
      voiceEl.srcObject = null;
      voiceEl.pause();
    }
    if (musicEl) {
      musicEl.srcObject = null;
      musicEl.pause();
    }

    if (remoteAudioCtx && remoteAudioCtx.state !== 'closed') {
      applyMixerAudioRouting();
    }
    return;
  }

  if (!inCall) return;

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
  if (voiceEl) {
    voiceEl.srcObject = null;
    voiceEl.pause();
  }
  if (musicEl) {
    musicEl.srcObject = null;
    musicEl.pause();
  }

  applyMixerAudioRouting();
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
  activeMicPeaks.clear();
  audio.dispose();
  const sharing = screenTrack;
  screenTrack = undefined;
  if (sharing) { sharing.onended = null; sharing.stop(); }
  await presenter.stopNativeCapture();
  await presenter.exitPresenterMode();
  videoTrack?.stop();
  videoTrack = undefined;
  await musicMeter.stop();

  // Clear track listeners and stop remote audio tracks
  for (const [, item] of remoteAudioTracks) {
    item.track.onended = null;
    try { item.track.stop(); } catch {}
  }
  remoteAudioTracks.clear();

  // Stop remote voice bridge and disconnect remote source nodes
  stopRemoteVoiceBridge();
  try { remoteVoiceSourceNode?.disconnect(); } catch {}
  remoteVoiceSourceNode = undefined;

  try { remoteMusicSourceNode?.disconnect(); } catch {}
  remoteMusicSourceNode = undefined;

  if (remoteVoiceMeter) {
    await remoteVoiceMeter.stop();
    remoteVoiceMeter = undefined;
  }
  lastLocalVoiceDb = -60;
  lastRemoteVoiceDb = -60;
  lastLocalMusicDb = -60;
  lastLocalMusicPeakDb = -60;
  checkActiveSpeaker();

  $('remote-tile')?.classList.remove('is-speaking');
  $('local-tile')?.classList.remove('is-speaking');
  closeSessionViewMenu();
  $('voice-in-indicator')?.classList.remove('active');
  $('music-in-indicator')?.classList.remove('active');

  const voiceEl = $<HTMLAudioElement>('remote-voice-audio');
  const musicEl = $<HTMLAudioElement>('remote-music-audio');
  if (voiceEl) {
    voiceEl.srcObject = null;
    voiceEl.pause();
  }
  if (musicEl) {
    musicEl.srcObject = null;
    musicEl.pause();
  }

  // Close and release remoteAudioCtx cleanly
  if (remoteAudioCtx && remoteAudioCtx.state !== 'closed') {
    try {
      await remoteAudioCtx.close();
    } catch {}
  }
  remoteAudioCtx = undefined;
  remoteVoiceGain = undefined;
  remoteMusicGain = undefined;
  remoteMasterGain = undefined;
  remoteVoicePanner = undefined;
  try { remoteMusicSplitter?.disconnect(); } catch {}
  remoteMusicSplitter = undefined;
  try { remoteMusicLeftGain?.disconnect(); } catch {}
  remoteMusicLeftGain = undefined;
  try { remoteMusicRightGain?.disconnect(); } catch {}
  remoteMusicRightGain = undefined;
  try { remoteMusicMerger?.disconnect(); } catch {}
  remoteMusicMerger = undefined;
  remoteVoiceAnalyserL = undefined;
  remoteVoiceAnalyserR = undefined;
  remoteMusicAnalyserL = undefined;
  remoteMusicAnalyserR = undefined;
  remoteMasterAnalyserL = undefined;
  remoteMasterAnalyserR = undefined;
  for (const node of remoteVoiceFxNodes) {
    try { node.disconnect(); } catch {}
  }
  remoteVoiceFxNodes = [];

  for (const node of remoteMusicFxNodes) {
    try { node.disconnect(); } catch {}
  }
  remoteMusicFxNodes = [];

  remoteLimiter = undefined;
  lastConnectedVoiceFx = '__uninitialized__';
  lastConnectedMusicFx = '__uninitialized__';
  remoteMedia = undefined;
  currentCode = '';

  // Reset Studio Mixer Mute & Solo
  studioMixerChannels.forEach((ch) => {
    ch.muted = false;
    ch.soloed = false;
  });
  if (studioMixerOpen) {
    renderStudioMixer();
  }
  const returnProjectId = sessionProjectId || activeProjectId;
  peerIdentity = null;
  peerParticipantId = null;
  sessionProjectId = undefined;
  $('session-workspace-drawer')?.classList.add('hidden');
  $('in-call-audio-modal')?.classList.add('hidden');
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
  if (returnProjectId && auth.getUser() && auth.getToken()) {
    void openProjectView(returnProjectId);
  } else {
    activeProjectId = undefined;
    activeProject = undefined;
    showView('home-view');
    void loadProjects();
  }
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
    toggleCam.innerHTML = `<span class="tool-icon">${cameraEnabled ? icons.video({ size: 18 }) : icons.videoOff({ size: 18 })}</span>`;
    toggleCam.title = cameraEnabled ? 'Stop Camera' : 'Start Camera';
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
  const el1 = document.getElementById('music-warning');
  if (el1) el1.classList.add('hidden');
  const el2 = document.getElementById('call-warning');
  if (el2) el2.classList.add('hidden');
  const el3 = document.getElementById('in-call-music-warning');
  if (el3) el3.classList.add('hidden');
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
    openSettings('audio');
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
  activeMicPeaks.clear();
  audio.dispose();
  videoTrack?.stop();
  videoTrack = undefined;
  await musicMeter.stop();
  lastLocalMusicDb = -60;
  lastLocalMusicPeakDb = -60;
  const returnProjectId = activeProjectId || sessionProjectId;
  if (returnProjectId && auth.getUser() && auth.getToken()) {
    void openProjectView(returnProjectId);
  } else {
    showView('home-view');
  }
});
for (const id of ['setup-advanced-button', 'setup-advanced-action-button']) {
  $(id)?.addEventListener('click', async () => {
    try {
      await enumerateAndPopulate();
      openSettings('audio');
    } catch (error) {
      showSessionErrorModal(parseSessionError(error));
    }
  });
}
$('enter-session').addEventListener('click', () => void enterSession());
for (const id of ['speaker-test', 'in-call-speaker-test']) {
  $(id)?.addEventListener('click', () => void testSpeakers().then(() => setMessage('setup-status', 'Speaker test complete.')).catch((error) => showSessionErrorModal(parseSessionError(error))));
}
for (const id of ['microphone-test', 'in-call-microphone-test']) {
  $(id)?.addEventListener('click', () => void testMicrophone().catch((error) => showSessionErrorModal(parseSessionError(error))));
}

async function switchAudioMode(mode: AudioMode): Promise<void> {
  prefs.mode = mode;
  savePreferences();
  setModeRadios(mode);
  updateCallMode();
  updateMusicWarning();
  try {
    await syncAllVoiceMics(mode);
    setMessage(inCall ? 'device-dialog-status' : 'setup-status', `Audio Profile: ${mode === 'music' ? 'Music Mode' : 'Talk Mode'}`);
  } catch (error) {
    logger.warn('mode_change_error', 'Failed to switch audio mode', { mode }, error);
    setModeRadios(prefs.mode);
    showSessionErrorModal(parseSessionError(error));
  }
}

for (const card of document.querySelectorAll<HTMLElement>('.mode-card')) {
  card.addEventListener('click', () => {
    const radio = card.querySelector<HTMLInputElement>('input[type="radio"]');
    if (radio && radio.value) {
      void switchAudioMode(radio.value as AudioMode);
    }
  });
}

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="setup-mode"], input[name="call-setup-mode"]')) {
  radio.addEventListener('change', () => {
    if (radio.checked) {
      void switchAudioMode(radio.value as AudioMode);
    }
  });
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

$('settings-mirror-camera')?.addEventListener('change', (event) => {
  prefs.mirrorCamera = (event.currentTarget as HTMLInputElement).checked;
  savePreferences();
  updateLocalPreviews();
});

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
  applyMixerAudioRouting();
  const muteBtn = $('mute-button');
  if (muteBtn) muteBtn.textContent = muted ? 'Unmute' : 'Mute';
  const toggleMic = $('toggle-mic');
  if (toggleMic) {
    toggleMic.classList.toggle('active', !muted);
    toggleMic.classList.toggle('muted', muted);
    toggleMic.innerHTML = `<span class="tool-icon">${muted ? icons.micOff({ size: 18 }) : icons.mic({ size: 18 })}</span>`;
    toggleMic.title = muted ? 'Unmute Microphone' : 'Mute Microphone';
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

$('mode-music-btn')?.addEventListener('click', () => void switchAudioMode('music'));
$('mode-talk-btn')?.addEventListener('click', () => void switchAudioMode('talk'));
$('mode-button')?.addEventListener('click', () => {
  const next: AudioMode = prefs.mode === 'music' ? 'talk' : 'music';
  void switchAudioMode(next);
});

$('audio-only-button')?.addEventListener('click', () => void setAudioOnly(!audioOnly).catch((error) => setCallStatus(deviceError(error))));
$<HTMLInputElement>('audio-only-setup')?.addEventListener('change', (event) => void setAudioOnly((event.currentTarget as HTMLInputElement).checked).catch((error) => setMessage('setup-status', deviceError(error), true)));

function openInCallAudioModal(): void {
  setModeRadios(prefs.mode);
  void enumerateAndPopulate();
  updateMusicWarning();
  $('in-call-audio-modal')?.classList.remove('hidden');
}

function closeInCallAudioModal(): void {
  $('in-call-audio-modal')?.classList.add('hidden');
}

$('btn-close-in-call-audio')?.addEventListener('click', closeInCallAudioModal);
$('btn-done-in-call-audio')?.addEventListener('click', closeInCallAudioModal);
$('in-call-audio-modal')?.addEventListener('click', (e) => {
  if (e.target === $('in-call-audio-modal')) closeInCallAudioModal();
});
$('in-call-advanced-settings-btn')?.addEventListener('click', () => {
  closeInCallAudioModal();
  openSettings('audio');
});

for (const id of ['open-settings', 'devices-button']) {
  $(id)?.addEventListener('click', () => {
    void enumerateAndPopulate();
    if (inCall || !$('call-view')?.classList.contains('hidden')) {
      openInCallAudioModal();
    } else {
      openSettings('audio');
    }
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
      openSettings('audio');
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

let pttActive = false;
let pttPreviousMutedState = false;

function isTypingContext(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') return true;
  if (target.closest('.ql-editor') || target.closest('[contenteditable="true"]')) return true;
  return false;
}

function toggleShortcutsModal(show?: boolean): void {
  const modal = $('call-shortcuts-modal');
  if (!modal) return;
  const shouldOpen = show !== undefined ? show : modal.classList.contains('hidden');
  modal.classList.toggle('hidden', !shouldOpen);
}

$('call-shortcuts-btn')?.addEventListener('click', () => {
  toggleShortcutsModal();
});

$('btn-close-shortcuts-modal')?.addEventListener('click', () => {
  toggleShortcutsModal(false);
});

$('call-shortcuts-modal')?.addEventListener('click', (e) => {
  if (e.target === $('call-shortcuts-modal')) {
    toggleShortcutsModal(false);
  }
});

window.addEventListener('keydown', (e) => {
  // Always handle Escape
  if (e.key === 'Escape') {
    const shortcutsModal = $('call-shortcuts-modal');
    if (shortcutsModal && !shortcutsModal.classList.contains('hidden')) {
      toggleShortcutsModal(false);
      return;
    }
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close());
    document.querySelectorAll<HTMLElement>('.modal-overlay:not(.hidden)').forEach((m) => m.classList.add('hidden'));
    return;
  }

  // If user is actively typing in a text field, do not trigger single-letter shortcuts
  if (isTypingContext(e.target)) return;

  // Shortcuts Cheatsheet: '?' or '/'
  if (e.key === '?' || (e.shiftKey && e.key === '/')) {
    e.preventDefault();
    toggleShortcutsModal();
    return;
  }

  // In-Call Shortcuts
  if (inCall) {
    // Push-to-Talk (Space bar)
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      if (!pttActive) {
        pttActive = true;
        pttPreviousMutedState = muted;
        if (muted) {
          toggleMute();
        }
        $('push-to-talk-hud')?.classList.remove('hidden');
      }
      return;
    }

    // Mute / Unmute Microphone: M or Cmd+D
    if (e.key === 'm' || e.key === 'M' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd')) {
      e.preventDefault();
      toggleMute();
      return;
    }

    // Toggle Camera: V or Cmd+E
    if (e.key === 'v' || e.key === 'V' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e')) {
      e.preventDefault();
      void toggleCamera().catch(() => {});
      return;
    }

    // Toggle Screen Share: S
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      $('toggle-screen')?.click();
      return;
    }

    // Toggle Talk / Music Mode: T
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      const nextMode = prefs.mode === 'talk' ? 'music' : 'talk';
      void switchAudioMode(nextMode);
      return;
    }

    // Toggle Workspace Drawer: W
    if (e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      if (activeProject) {
        setSessionWorkspaceOpen(!sessionWorkspaceOpen);
      }
      return;
    }

    // Toggle Session Chat: C
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      $('toggle-session-chat')?.click();
      return;
    }

    // Toggle Studio Mixer: X
    if (e.key === 'x' || e.key === 'X') {
      e.preventDefault();
      toggleStudioMixer();
      return;
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && pttActive) {
    pttActive = false;
    $('push-to-talk-hud')?.classList.add('hidden');
    // If it was muted before holding space, return to muted
    if (pttPreviousMutedState && !muted) {
      toggleMute();
    }
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
  applyMixerAudioRouting();
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
    if (prefs.voiceInputs && prefs.voiceInputs.length > 0 && prefs.voiceInputs[0]) {
      prefs.voiceInputs[0].gain = val;
    }
    for (const labelId of ['gain-value', 'call-gain-value']) {
      const el = document.getElementById(labelId);
      if (el) el.textContent = `${Math.round(val * 100)}%`;
    }
    for (const otherId of ['input-gain', 'call-input-gain']) {
      const el = $<HTMLInputElement>(otherId);
      if (el && el !== event.currentTarget) el.value = String(val);
    }
    savePreferences();
    
    // SYNC WITH STUDIO MIXER
    const micCh = studioMixerChannels.find((c) => c.id === 'you-mic');
    if (micCh) {
      micCh.volume = val;
      saveStudioMixerConfig(false);
      if (studioMixerOpen) {
        renderStudioMixer();
      }
    }
    applyMixerAudioRouting();

    const desktopApi = typeof window !== 'undefined' ? (window.jameet || window.musiczoom) : undefined;
    if (desktopApi?.setSystemInputVolume) {
      void desktopApi.setSystemInputVolume(Math.min(1.0, val));
    }
  });
}
$('remote-mute-button')?.addEventListener('click', () => {
  remoteMuted = !remoteMuted;
  setText('remote-mute-button', remoteMuted ? 'Unmute Remote' : 'Mute Remote');
  applyMixerAudioRouting();
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
  const user = auth.getUser();
  const guestName = auth.getGuestName();
  const isLogged = !!auth.getUser();
  const avatarBg = safeAvatarColor(user?.avatarColor, '#38bdf8');
  const avatarUrl = user?.avatarUrl;

  const localLabel = myIdentity
    ? `${myIdentity.displayName}${myIdentity.isHost ? ' (Host)' : myIdentity.isGuest ? ' (Guest)' : ''}`
    : user ? user.displayName : guestName ? `${guestName} (Guest)` : 'You';
  setText('local-user-name', localLabel);
  setText('call-user-name', user ? user.displayName : guestName ? `${guestName} (Guest)` : 'Host');

  const localIconEl = $('local-user-icon');
  if (localIconEl) localIconEl.innerHTML = myIdentity?.isHost ? icons.crown({ size: 12 }) : icons.headphones({ size: 12 });

  const callBadge = $('call-avatar-badge');
  if (callBadge) {
    if (isLogged && user) {
      applyAvatarToElement(callBadge, user.displayName || user.username, avatarBg, avatarUrl);
    } else if (guestName) {
      applyAvatarToElement(callBadge, guestName, '#06b6d4');
    } else {
      callBadge.innerHTML = icons.user({ size: 14 });
    }
  }

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

  // 1. Home Navigation Bar Controls (Always show profile / account pill)
  const navUser = $('home-auth-nav-user');
  if (navUser) navUser.classList.remove('hidden');

  const navAvatar = $('nav-user-avatar');
  if (navAvatar) {
    if (isLogged && user?.displayName) {
      applyAvatarToElement(navAvatar, user.displayName, avatarBg, avatarUrl);
      setText('nav-user-name', user.displayName);
      setText('nav-user-handle', `@${user.username}`);
    } else {
      navAvatar.style.background = 'var(--bg-elevated)';
      navAvatar.style.backgroundImage = 'none';
      navAvatar.innerHTML = icons.user({ size: 14 });
    }
  }

  const projectAvatar = $('project-user-avatar');
  if (projectAvatar) {
    if (isLogged && user?.displayName) {
      applyAvatarToElement(projectAvatar, user.displayName, avatarBg, avatarUrl);
    } else {
      projectAvatar.style.background = 'var(--bg-elevated)';
      projectAvatar.style.backgroundImage = 'none';
      projectAvatar.innerHTML = icons.user({ size: 14 });
    }
  }

  // 2. Home Hero Area & Action Blocks (Personalized for logged in vs Guest)
  const homeHeroUser = $('home-user-hero');
  const homeHeroGuest = $('home-guest-hero');
  const homeCards = $('home-cards-section');
  const recentSection = $('recent-sessions-section');
  const scheduledSection = $('scheduled-sessions-section');
  const projectsSection = $('projects-section');
  if (homeHeroUser) homeHeroUser.classList.toggle('hidden', !isLogged);
  if (homeHeroGuest) homeHeroGuest.classList.toggle('hidden', isLogged);
  if (homeCards) homeCards.classList.toggle('hidden', !isLogged);
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
    if (isLogged && user) {
      applyAvatarToElement(callBadge, user.displayName || user.username, avatarBg, avatarUrl);
    } else if (guestName) {
      applyAvatarToElement(callBadge, guestName, '#06b6d4');
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

      // Show bottom footer All Sessions button if there are more than 5 sessions
      if (totalCount > 5) {
        footerEl?.classList.remove('hidden');
        if (footerText) footerText.textContent = `All ${totalCount} Sessions`;
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

let lastActiveViewBeforeSettings = 'home-view';

function toggleAccountMenu(triggerEl?: HTMLElement | null): void {
  const menu = $('account-menu');
  if (!menu) return;
  const isHidden = menu.classList.contains('hidden');
  if (!isHidden) {
    closeAccountMenu();
    return;
  }
  const user = auth.getUser();
  const guestActions = $('account-menu-guest-actions');
  const userActions = $('account-menu-user-actions');
  const logoutDivider = $('account-menu-logout-divider');
  const logoutGroup = $('account-menu-logout-group');

  if (user) {
    setText('account-menu-name', user.displayName || user.username);
    setText('account-menu-handle', `@${user.username}`);
    const roleEl = $('account-menu-role');
    if (roleEl) {
      roleEl.textContent = user.role || 'Musician';
      roleEl.classList.remove('hidden');
    }
    const avatarBg = safeAvatarColor(user.avatarColor, '#38bdf8');
    applyAvatarToElement($('account-menu-avatar'), user.displayName || user.username, avatarBg, user.avatarUrl);
    userActions?.classList.remove('hidden');
    guestActions?.classList.add('hidden');
    logoutDivider?.classList.remove('hidden');
    logoutGroup?.classList.remove('hidden');
  } else {
    setText('account-menu-name', 'Guest Musician');
    setText('account-menu-handle', 'Not signed in');
    $('account-menu-role')?.classList.add('hidden');
    const menuAvatar = $('account-menu-avatar');
    if (menuAvatar) {
      menuAvatar.style.background = 'var(--bg-elevated)';
      menuAvatar.style.backgroundImage = 'none';
      menuAvatar.innerHTML = icons.user({ size: 18 });
    }
    userActions?.classList.add('hidden');
    guestActions?.classList.remove('hidden');
    logoutDivider?.classList.add('hidden');
    logoutGroup?.classList.add('hidden');
  }

  if (triggerEl) {
    const rect = triggerEl.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
    menu.style.left = 'auto';
  }
  menu.classList.remove('hidden');
}

function closeAccountMenu(): void {
  $('account-menu')?.classList.add('hidden');
}

function openSettings(section: 'general' | 'audio' | 'video' | 'screenshare' | 'account' = 'account'): void {
  closeAccountMenu();
  const currentActive = views.find((v) => !$(v)?.classList.contains('hidden') && v !== 'settings-view');
  if (currentActive) {
    lastActiveViewBeforeSettings = currentActive;
  }

  const user = auth.getUser();
  if (user) {
    updateAuthUi(user, auth.getGuestName());
  }
  void enumerateAndPopulate();

  switchSettingsSection(section);
  showView('settings-view');
}

function switchSettingsSection(section: 'general' | 'audio' | 'video' | 'screenshare' | 'account'): void {
  const sections = ['general', 'audio', 'video', 'screenshare', 'account'] as const;
  for (const s of sections) {
    const isCur = s === section;
    const navItem = document.querySelector(`.settings-nav-item[data-settings-tab="${s}"]`);
    navItem?.classList.toggle('active', isCur);
    $(`settings-panel-${s}`)?.classList.toggle('hidden', !isCur);
  }
  const crumbText =
    section === 'account'
      ? 'Account Profile'
      : section === 'audio'
        ? 'Audio & Hardware'
        : section === 'video'
          ? 'Video & Camera'
          : section === 'screenshare'
            ? 'Screen Sharing'
            : 'General Preferences';
  setText('settings-view-crumb', crumbText);
}

function openAuthDialog(tab: 'login' | 'register' = 'login'): void {
  const user = auth.getUser();
  if (user) {
    openSettings('account');
  } else {
    openAuthView(tab);
  }
}

// Navigation & Avatar menu listeners
$('nav-btn-signin')?.addEventListener('click', () => openAuthView('login'));
$('nav-btn-register')?.addEventListener('click', () => openAuthView('register'));
$('hero-btn-signin')?.addEventListener('click', () => openAuthView('login'));
$('hero-btn-register')?.addEventListener('click', () => openAuthView('register'));

$('nav-profile-pill')?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleAccountMenu($('nav-profile-pill'));
});
$('project-user-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleAccountMenu($('project-user-btn'));
});
$('setup-user-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleAccountMenu($('setup-user-btn'));
});
$('call-user-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleAccountMenu($('call-user-btn'));
});
$('home-view-profile-btn')?.addEventListener('click', () => openSettings('account'));

// Account Menu action buttons
$('account-menu-profile-btn')?.addEventListener('click', () => openSettings('account'));
$('account-menu-settings-btn')?.addEventListener('click', () => openSettings('general'));
$('account-menu-guest-settings-btn')?.addEventListener('click', () => openSettings('general'));
$('account-menu-signin-btn')?.addEventListener('click', () => {
  closeAccountMenu();
  openAuthView('login');
});
$('account-menu-register-btn')?.addEventListener('click', () => {
  closeAccountMenu();
  openAuthView('register');
});
$('account-menu-logout-btn')?.addEventListener('click', async () => {
  closeAccountMenu();
  await auth.logout();
  showView('home-view');
});

// Close account menu on click-outside or Escape
document.addEventListener('click', (e) => {
  const menu = $('account-menu');
  if (!menu || menu.classList.contains('hidden')) return;
  const target = e.target as HTMLElement;
  if (
    !menu.contains(target) &&
    !target.closest('#nav-profile-pill') &&
    !target.closest('#project-user-btn') &&
    !target.closest('#setup-user-btn') &&
    !target.closest('#call-user-btn')
  ) {
    closeAccountMenu();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAccountMenu();
  }
});

// Settings navigation listeners
document.querySelectorAll<HTMLButtonElement>('.settings-nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.settingsTab as any;
    if (tab) switchSettingsSection(tab);
  });
});
$('btn-settings-back')?.addEventListener('click', () => showView(lastActiveViewBeforeSettings || 'home-view'));
$('btn-settings-done')?.addEventListener('click', () => showView(lastActiveViewBeforeSettings || 'home-view'));
$('btn-settings-open-stats')?.addEventListener('click', () => $<HTMLDialogElement>('stats-dialog')?.showModal());

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="settings-default-mode"]')) {
  radio.addEventListener('change', () => {
    prefs.mode = radio.value as AudioMode;
    savePreferences();
    void syncAllVoiceMics(prefs.mode);
  });
}

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

  const missing: string[] = [];
  if (!identifier) missing.push('view-login-identifier');
  if (!password) missing.push('view-login-password');

  if (missing.length > 0) {
    showAuthFormError('view-login-error', 'Please enter your username/email and password.', missing);
    $<HTMLInputElement>(missing[0])?.focus();
    return;
  }

  clearAuthFormError('view-login-error', ['view-login-identifier', 'view-login-password']);
  const originalHtml = submitBtn ? submitBtn.innerHTML : '<span>Sign In</span>';
  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Signing In…</span>';
    }
    await auth.login({ usernameOrEmail: identifier!, password: password! });
    if (pendingJoinCode) {
      const code = pendingJoinCode;
      pendingJoinCode = '';
      void prepareStudio({ type: 'join', code });
    } else {
      showView('home-view');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Invalid credentials. Please try again.';
    showAuthFormError('view-login-error', msg, ['view-login-identifier', 'view-login-password']);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalHtml;
    }
  }
});

function setAuthInputError(inputId: string, isError: boolean): void {
  const el = $<HTMLInputElement>(inputId);
  if (el) {
    el.classList.toggle('input-error', isError);
  }
}

function showAuthFormError(errElId: string, message: string, invalidInputIds: string[] = []): void {
  const errEl = $(errElId);
  if (errEl) {
    errEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg><span>${message}</span>`;
    errEl.classList.remove('hidden');
  }
  invalidInputIds.forEach((id) => setAuthInputError(id, true));
}

function clearAuthFormError(errElId: string, inputIds: string[] = []): void {
  const errEl = $(errElId);
  if (errEl) errEl.classList.add('hidden');
  inputIds.forEach((id) => setAuthInputError(id, false));
}

function updatePasswordStrength(password: string): void {
  const wrap = $('password-strength-wrap');
  const statusEl = $('strength-text');
  if (!wrap || !statusEl) return;

  if (!password) {
    wrap.classList.add('hidden');
    return;
  }

  wrap.classList.remove('hidden');

  let score = 0;
  if (password.length >= 8) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password) || password.length >= 12) score++;

  wrap.classList.remove('strength-weak', 'strength-fair', 'strength-good', 'strength-strong');

  if (score <= 1) {
    wrap.classList.add('strength-weak');
    statusEl.textContent = 'Weak (Needs 8+ chars)';
  } else if (score === 2) {
    wrap.classList.add('strength-fair');
    statusEl.textContent = 'Fair';
  } else if (score === 3) {
    wrap.classList.add('strength-good');
    statusEl.textContent = 'Good';
  } else {
    wrap.classList.add('strength-strong');
    statusEl.textContent = 'Strong 🔒';
  }
}

// Real-time live validations for registration form
function validateRegisterInputsLive(): boolean {
  const displayName = $<HTMLInputElement>('view-reg-display-name')?.value.trim() || '';
  const username = $<HTMLInputElement>('view-reg-username')?.value.trim() || '';
  const email = $<HTMLInputElement>('view-reg-email')?.value.trim() || '';
  const emailConfirm = $<HTMLInputElement>('view-reg-email-confirm')?.value.trim() || '';
  const password = $<HTMLInputElement>('view-reg-password')?.value || '';
  const passwordConfirm = $<HTMLInputElement>('view-reg-password-confirm')?.value || '';

  updatePasswordStrength(password);

  // Check Display Name (English characters only)
  if (displayName.length > 0 && !/^[a-zA-Z0-9 .'-]+$/.test(displayName)) {
    showAuthFormError('view-reg-error', 'Display Name must contain only English letters and numbers.', ['view-reg-display-name']);
    return false;
  } else {
    setAuthInputError('view-reg-display-name', false);
  }

  // Check Username (English characters only)
  if (username.length > 0 && !/^[a-zA-Z0-9_]+$/.test(username)) {
    showAuthFormError('view-reg-error', 'Username must contain only English letters, numbers, and underscores.', ['view-reg-username']);
    return false;
  } else {
    setAuthInputError('view-reg-username', false);
  }

  // Check email confirmation
  if (emailConfirm.length > 0 && email.length > 0 && email.toLowerCase() !== emailConfirm.toLowerCase()) {
    showAuthFormError('view-reg-error', 'Email addresses do not match.', ['view-reg-email-confirm']);
    return false;
  } else {
    setAuthInputError('view-reg-email-confirm', false);
  }

  // Check password confirmation
  if (passwordConfirm.length > 0 && password.length > 0 && password !== passwordConfirm) {
    showAuthFormError('view-reg-error', 'Passwords do not match.', ['view-reg-password-confirm']);
    return false;
  } else {
    setAuthInputError('view-reg-password-confirm', false);
  }

  // Check password length
  if (password.length > 0 && password.length < 8) {
    showAuthFormError('view-reg-error', 'Password must be at least 8 characters long.', ['view-reg-password']);
    return false;
  } else {
    setAuthInputError('view-reg-password', false);
  }

  clearAuthFormError('view-reg-error', ['view-reg-display-name', 'view-reg-username', 'view-reg-email', 'view-reg-email-confirm', 'view-reg-password', 'view-reg-password-confirm']);
  return true;
}

['view-reg-display-name', 'view-reg-username', 'view-reg-email', 'view-reg-email-confirm', 'view-reg-password', 'view-reg-password-confirm'].forEach((id) => {
  $<HTMLInputElement>(id)?.addEventListener('input', () => {
    validateRegisterInputsLive();
  });
});

$('btn-view-submit-register')?.addEventListener('click', async () => {
  const submitBtn = $<HTMLButtonElement>('btn-view-submit-register');
  const displayName = $<HTMLInputElement>('view-reg-display-name')?.value.trim();
  const username = $<HTMLInputElement>('view-reg-username')?.value.trim();
  const phoneCode = $<HTMLSelectElement>('view-reg-phone-code')?.value?.replace('-ca', '') || '+1';
  const rawPhone = $<HTMLInputElement>('view-reg-phone-number')?.value.trim();
  const phoneNumber = rawPhone ? `${phoneCode} ${rawPhone}` : undefined;
  const email = $<HTMLInputElement>('view-reg-email')?.value.trim();
  const emailConfirm = $<HTMLInputElement>('view-reg-email-confirm')?.value.trim();
  const password = $<HTMLInputElement>('view-reg-password')?.value;
  const passwordConfirm = $<HTMLInputElement>('view-reg-password-confirm')?.value;

  const missing: string[] = [];
  if (!displayName) missing.push('view-reg-display-name');
  if (!username) missing.push('view-reg-username');
  if (!email) missing.push('view-reg-email');
  if (!emailConfirm) missing.push('view-reg-email-confirm');
  if (!password) missing.push('view-reg-password');
  if (!passwordConfirm) missing.push('view-reg-password-confirm');

  if (missing.length > 0) {
    showAuthFormError('view-reg-error', 'Please fill out all registration fields.', missing);
    $<HTMLInputElement>(missing[0])?.focus();
    return;
  }
  if (!/^[a-zA-Z0-9 .'-]+$/.test(displayName!)) {
    showAuthFormError('view-reg-error', 'Display Name must contain only English letters and numbers.', ['view-reg-display-name']);
    $<HTMLInputElement>('view-reg-display-name')?.focus();
    return;
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username!)) {
    showAuthFormError('view-reg-error', 'Username must contain only English letters, numbers, and underscores.', ['view-reg-username']);
    $<HTMLInputElement>('view-reg-username')?.focus();
    return;
  }
  if (username!.length < 3) {
    showAuthFormError('view-reg-error', 'Username must be at least 3 characters long.', ['view-reg-username']);
    $<HTMLInputElement>('view-reg-username')?.focus();
    return;
  }
  if (email && !email.includes('@')) {
    showAuthFormError('view-reg-error', 'Please enter a valid email address.', ['view-reg-email']);
    $<HTMLInputElement>('view-reg-email')?.focus();
    return;
  }
  if (email!.toLowerCase() !== emailConfirm!.toLowerCase()) {
    showAuthFormError('view-reg-error', 'Email addresses do not match.', ['view-reg-email-confirm']);
    $<HTMLInputElement>('view-reg-email-confirm')?.focus();
    return;
  }
  if (password !== passwordConfirm) {
    showAuthFormError('view-reg-error', 'Passwords do not match.', ['view-reg-password-confirm']);
    $<HTMLInputElement>('view-reg-password-confirm')?.focus();
    return;
  }
  if (password!.length < 8) {
    showAuthFormError('view-reg-error', 'Password must be at least 8 characters long.', ['view-reg-password']);
    $<HTMLInputElement>('view-reg-password')?.focus();
    return;
  }

  clearAuthFormError('view-reg-error', ['view-reg-display-name', 'view-reg-username', 'view-reg-email', 'view-reg-email-confirm', 'view-reg-password', 'view-reg-password-confirm']);

  const originalHtml = submitBtn ? submitBtn.innerHTML : '<span>Create Account</span>';
  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Creating Account…</span>';
    }
    await auth.register({ displayName: displayName!, username: username!, email: email!, password: password!, phoneNumber });
    showView('home-view');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Registration failed.';
    const invalidIds: string[] = [];
    if (msg.toLowerCase().includes('username')) invalidIds.push('view-reg-username');
    if (msg.toLowerCase().includes('email')) invalidIds.push('view-reg-email');
    showAuthFormError('view-reg-error', msg, invalidIds);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalHtml;
    }
  }
});

// Auto-format American phone numbers
$<HTMLInputElement>('view-reg-phone-number')?.addEventListener('input', (e) => {
  const input = e.target as HTMLInputElement;
  const code = $<HTMLSelectElement>('view-reg-phone-code')?.value;
  if (code === '+1' || code === '+1-ca') {
    const digits = input.value.replace(/\D/g, '').substring(0, 10);
    if (digits.length > 6) {
      input.value = `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}`;
    } else if (digits.length > 3) {
      input.value = `(${digits.substring(0, 3)}) ${digits.substring(3)}`;
    } else if (digits.length > 0) {
      input.value = `(${digits}`;
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

['view-reg-display-name', 'view-reg-username', 'view-reg-phone-number', 'view-reg-email', 'view-reg-email-confirm', 'view-reg-password', 'view-reg-password-confirm'].forEach((id) => {
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
  showView('home-view');
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
  activeMicPeaks.clear();
  audio.dispose();
  videoTrack?.stop();
  videoTrack = undefined;
  await musicMeter.stop();
  lastLocalMusicDb = -60;
  lastLocalMusicPeakDb = -60;
  const returnProjectId = activeProjectId || sessionProjectId;
  if (returnProjectId && auth.getUser() && auth.getToken()) {
    void openProjectView(returnProjectId);
  } else {
    showView('home-view');
  }
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

    card.innerHTML = `
      <div class="project-card-header">
        <h4 class="project-card-title">${escapeHtml(project.name)}</h4>
        ${project.archived ? `<span class="project-card-pill badge-archived">${icons.archive({ size: 11 })} <span>Archived</span></span>` : ''}
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

function resetWorkspaceGenerations(): void {
  currentWorkspaceContextGen++;
  lyricsEditGen = 0;
  lyricsSaveGen = 0;
  notesEditGen = 0;
  notesSaveGen = 0;
  structureEditGen = 0;
  structureSaveGen = 0;
  tasksEditGen = 0;
  tasksSaveGen = 0;
}

async function openProjectView(projectId: string): Promise<void> {
  const token = auth.getToken();
  if (!token) {
    showView('auth-view');
    return;
  }
  resetWorkspaceGenerations();
  const loadContextGen = currentWorkspaceContextGen;
  try {
    const project = await projectsApi.fetchProject(token, projectId);
    if (loadContextGen !== currentWorkspaceContextGen) return;
    activeProject = project;
    activeProjectId = projectId;
    showView('project-view');
    resetProjectTabs();
    renderProjectView();
    syncWorkspaceInputsFromProject(true);

    void signaling.joinProjectWorkspace(projectId, token).catch((e) =>
      console.warn('[Signaling] Failed to join project workspace socket room:', e)
    );
  } catch (err) {
    if (loadContextGen !== currentWorkspaceContextGen) return;
    console.error('Failed to open project:', err);
    alert(`Could not open project: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

function resetProjectTabs(): void {
  isSongStudioOpen = false;
  $('project-song-studio-view')?.classList.add('hidden');
  $('project-main-tabs-bar')?.classList.remove('hidden');
  const tabBtns = document.querySelectorAll<HTMLButtonElement>('.project-tab-btn');
  tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === 'overview'));
  const panels = document.querySelectorAll<HTMLElement>('.project-tab-panel');
  panels.forEach((p) => {
    if (!p.closest('#project-song-studio-view')) {
      p.classList.toggle('hidden', p.id !== 'project-panel-overview');
    }
  });
  renderProjectOverviewSongsList();
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
  const myCollabEntry = p.collaborators?.find((c) => c.userId === user?.id);
  const myRole = isOwner ? 'owner' : (myCollabEntry?.role || 'editor');
  const isViewer = myRole === 'viewer';

  const roleBadge = $('project-role-badge');
  if (roleBadge) {
    if (p.archived) {
      roleBadge.innerHTML = `${icons.archive({ size: 14 })} <span>Archived</span>`;
      roleBadge.className = 'project-status-pill badge-archived';
    } else if (isOwner) {
      roleBadge.innerHTML = `${icons.crown({ size: 14 })} <span>Owner</span>`;
      roleBadge.className = 'project-status-pill badge-owner';
    } else if (isViewer) {
      roleBadge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg> <span>View Only</span>`;
      roleBadge.className = 'project-status-pill badge-viewer';
    } else {
      roleBadge.innerHTML = `${icons.users({ size: 14 })} <span>Editor</span>`;
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
  currentProjectSessionsPage = 1;
  renderProjectSessions();

  // Enforce workspace edit/view permissions across UI
  applyWorkspacePermissions();
}

function renderProjectCollaborators(): void {
  if (!activeProject) return;
  const listOverview = $('project-collaborators-list');
  const listFull = $('project-collaborators-full-list');

  const user = auth.getUser();
  const isOwner = user?.id === activeProject.ownerId;
  const ownerAvatarUrl = activeProject.ownerId === user?.id ? user?.avatarUrl : (activeProject as any).ownerAvatarUrl;
  const allMembers = [
    {
      userId: activeProject.ownerId,
      displayName: activeProject.ownerDisplayName,
      username: activeProject.ownerUsername,
      avatarColor: safeAvatarColor(activeProject.ownerAvatarColor, '#f59e0b'),
      avatarUrl: ownerAvatarUrl,
      role: 'owner' as const,
      addedAt: activeProject.createdAt
    },
    ...activeProject.collaborators.map((c) => ({
      ...c,
      avatarUrl: c.userId === user?.id ? user?.avatarUrl : (c as any).avatarUrl
    }))
  ];

  const buildItems = (container: HTMLElement | null) => {
    if (!container) return;
    container.replaceChildren();

    for (const member of allMembers) {
      const isMemberOwner = member.role === 'owner';
      const isViewer = member.role === 'viewer';
      const isEditor = member.role === 'editor' || member.role === 'collaborator';

      let roleHtml = '';
      if (isMemberOwner) {
        roleHtml = `<span class="collab-role-badge role-owner">${icons.crown({ size: 12 })} <span>Owner</span></span>`;
      } else if (isOwner) {
        roleHtml = `
          <div class="collab-role-select-wrap">
            <select class="collab-role-dropdown" data-user-id="${escapeHtml(member.userId)}" aria-label="Permission Level">
              <option value="editor" ${isEditor ? 'selected' : ''}>Editor (Can Edit)</option>
              <option value="viewer" ${isViewer ? 'selected' : ''}>Viewer (View Only)</option>
            </select>
          </div>
        `;
      } else {
        roleHtml = `
          <span class="collab-role-badge ${isViewer ? 'role-viewer' : 'role-editor'}">
            <span>${isViewer ? 'Viewer' : 'Editor'}</span>
          </span>
        `;
      }

      const item = document.createElement('div');
      item.className = 'collab-item';
      item.innerHTML = `
        <div class="collab-avatar"></div>
        <div class="collab-info">
          <div class="collab-name">${escapeHtml(member.displayName)}</div>
          <div class="collab-username">@${escapeHtml(member.username)}</div>
        </div>
        ${roleHtml}
        ${isOwner && !isMemberOwner ? `<button class="collab-remove-btn" data-user-id="${escapeHtml(member.userId)}" title="Remove member">${icons.x({ size: 14 })}</button>` : ''}
      `;
      const avatarEl = item.querySelector<HTMLElement>('.collab-avatar');
      applyAvatarToElement(avatarEl, member.displayName, member.avatarColor, member.avatarUrl);

      const roleDropdown = item.querySelector<HTMLSelectElement>('.collab-role-dropdown');
      if (roleDropdown) {
        roleDropdown.addEventListener('change', async (e) => {
          e.stopPropagation();
          const targetRole = roleDropdown.value;
          const token = auth.getToken();
          if (!token || !activeProject) return;
          try {
            roleDropdown.disabled = true;
            activeProject = await projectsApi.updateCollaboratorRole(token, activeProject.id, member.userId, targetRole);
            renderProjectView();
          } catch (err) {
            alert(err instanceof Error ? err.message : 'Failed to update member permission.');
            renderProjectCollaborators();
          }
        });
      }

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

let currentProjectSessionsSearch = '';
let currentProjectSessionsFilter: 'all' | 'solo' | 'collab' = 'all';
let activeSummarySession: ProjectSessionItem | null = null;
const SESSIONS_PER_PAGE = 10;
let currentProjectSessionsPage = 1;

function formatTotalStudioTime(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds < 60) return '< 1m';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${m}m`;
}

function renderProjectSessions(): void {
  if (!activeProject) return;
  const listOverview = $('project-sessions-list');
  const listFull = $('project-sessions-full-list');
  const emptyEl = $('project-sessions-empty');
  const paginationEl = $('project-sessions-pagination');
  const paginationInfoEl = $('project-sessions-pagination-info');
  const pageBadgeEl = $('project-sessions-page-badge');
  const btnPrev = $<HTMLButtonElement>('btn-sessions-prev-page');
  const btnNext = $<HTMLButtonElement>('btn-sessions-next-page');

  const sessions = activeProject.sessions || [];

  // 1. Calculate & Render Stats
  const totalCount = sessions.length;
  const totalSec = sessions.reduce((acc, s) => acc + (s.durationSeconds || 0), 0);
  const lastActiveText = sessions.length > 0 ? projectsApi.formatRelativeTime(sessions[0].startedAt) : '—';

  setText('project-stat-sessions-time', `${formatTotalStudioTime(totalSec)} studio time`);
  setText('project-stat-sessions-last', `Last active: ${lastActiveText}`);

  // 2. Render mini list in Overview tab (top 5)
  if (listOverview) {
    if (!sessions.length) {
      listOverview.replaceChildren();
      if (emptyEl) { emptyEl.classList.remove('hidden'); listOverview.appendChild(emptyEl); }
    } else {
      if (emptyEl) emptyEl.classList.add('hidden');
      listOverview.replaceChildren();
      for (const session of sessions.slice(0, 5)) {
        listOverview.appendChild(createSessionItemEl(session));
      }
    }
  }

  // 3. Filter sessions for Full Sessions Tab
  if (listFull) {
    let filtered = sessions;

    // Filter by type
    if (currentProjectSessionsFilter === 'solo') {
      filtered = filtered.filter((s) => !s.collaborator);
    } else if (currentProjectSessionsFilter === 'collab') {
      filtered = filtered.filter((s) => Boolean(s.collaborator));
    }

    // Filter by search query
    if (currentProjectSessionsSearch.trim()) {
      const q = currentProjectSessionsSearch.trim().toLowerCase();
      filtered = filtered.filter((s) => {
        const codeMatch = s.code?.toLowerCase().includes(q);
        const nameMatch = s.collaborator?.displayName?.toLowerCase().includes(q);
        const userMatch = s.collaborator?.username?.toLowerCase().includes(q);
        return codeMatch || nameMatch || userMatch;
      });
    }

    // Update counter badge
    setText('project-sessions-counter-badge', `${filtered.length}`);

    const totalFiltered = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / SESSIONS_PER_PAGE));
    if (currentProjectSessionsPage > totalPages) currentProjectSessionsPage = totalPages;
    if (currentProjectSessionsPage < 1) currentProjectSessionsPage = 1;

    const startIndex = (currentProjectSessionsPage - 1) * SESSIONS_PER_PAGE;
    const paginated = filtered.slice(startIndex, startIndex + SESSIONS_PER_PAGE);

    if (!filtered.length) {
      if (paginationEl) paginationEl.classList.add('hidden');
      listFull.innerHTML = `
        <div class="projects-empty" style="padding: 24px 0; text-align: center;">
          <p style="margin: 0 0 4px; font-size: 12.5px; color: #cbd5e1; font-weight: 500;">
            ${sessions.length === 0 ? 'No session history in this project yet.' : 'No sessions matching your filter.'}
          </p>
          <p style="margin: 0; font-size: 11px; color: #64748b;">
            ${sessions.length === 0 ? 'Click Start Session to launch your first studio session.' : 'Try adjusting your search query or filter.'}
          </p>
        </div>
      `;
    } else {
      listFull.replaceChildren();
      for (const session of paginated) {
        listFull.appendChild(createProjectSessionCard(session));
      }

      // Update Pagination UI
      if (paginationEl) {
        if (totalFiltered <= SESSIONS_PER_PAGE) {
          paginationEl.classList.add('hidden');
        } else {
          paginationEl.classList.remove('hidden');
          const startNum = startIndex + 1;
          const endNum = Math.min(startIndex + SESSIONS_PER_PAGE, totalFiltered);
          if (paginationInfoEl) {
            paginationInfoEl.textContent = `Showing ${startNum}–${endNum} of ${totalFiltered}`;
          }
          if (pageBadgeEl) {
            pageBadgeEl.textContent = `Page ${currentProjectSessionsPage} of ${totalPages}`;
          }
          if (btnPrev) {
            btnPrev.disabled = currentProjectSessionsPage <= 1;
          }
          if (btnNext) {
            btnNext.disabled = currentProjectSessionsPage >= totalPages;
          }
        }
      }
    }
  }
}

function createProjectSessionCard(session: ProjectSessionItem): HTMLElement {
  const card = document.createElement('div');
  card.className = 'project-session-seamless-row';
  const isCollab = Boolean(session.collaborator);
  const collabText = isCollab ? `Session with ${session.collaborator!.displayName}` : 'Solo Studio Session';
  const timeText = projectsApi.formatRelativeTime(session.startedAt);
  const durationText = session.durationSeconds && session.durationSeconds > 0
    ? projectsApi.formatSessionDuration(session.durationSeconds)
    : '< 1m';

  const avatarContent = isCollab
    ? (session.collaborator!.displayName.charAt(0).toUpperCase())
    : `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></svg>`;

  card.innerHTML = `
    <div class="session-card-left">
      <div class="session-card-avatar ${isCollab ? 'is-collab' : ''}">
        ${avatarContent}
      </div>
      <div class="session-card-details">
        <div class="session-card-collab-row">
          <span class="session-card-title">${escapeHtml(collabText)}</span>
          <span class="session-card-role-badge">${session.role === 'host' ? 'Host' : 'Participant'}</span>
        </div>
        <div class="session-card-sub-row">
          <button type="button" class="session-code-pill" title="Click to copy session code">
            <span>${escapeHtml(session.code)}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          </button>
          <span class="meta-dot">·</span>
          <span class="session-card-time" title="${new Date(session.startedAt).toLocaleString()}">${escapeHtml(timeText)}</span>
        </div>
      </div>
    </div>
    <div class="session-card-right">
      <span class="session-card-duration">
        ${icons.clock({ size: 11 })}
        <span>${escapeHtml(durationText)}</span>
      </span>
      <div class="session-card-actions">
        <button type="button" class="session-card-btn btn-summary" title="View Session Summary & Activity">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span>Summary</span>
        </button>
        <button type="button" class="session-card-btn btn-start" title="Launch Project Session">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <span>Start</span>
        </button>
      </div>
    </div>
  `;

  // Copy Code on Click
  const codeBtn = card.querySelector<HTMLButtonElement>('.session-code-pill');
  codeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(session.code);
    codeBtn.innerHTML = `<span>Copied!</span> <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
    setTimeout(() => {
      codeBtn.innerHTML = `<span>${escapeHtml(session.code)}</span> <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
    }, 1500);
  });

  // Summary Click
  card.querySelector('.btn-summary')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openSessionSummaryModal(session);
  });

  // Start Click
  card.querySelector('.btn-start')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!activeProject) return;
    await flushAllWorkspacePendingSaves();
    activeProjectId = activeProject.id;
    await prepareStudio({ type: 'create' });
  });

  return card;
}

function openSessionSummaryModal(session: ProjectSessionItem): void {
  activeSummarySession = session;
  const modal = $('project-session-summary-modal');
  if (!modal || !activeProject) return;

  const isCollab = Boolean(session.collaborator);
  const titleText = isCollab ? `Session with ${session.collaborator!.displayName}` : 'Solo Studio Session';
  const durationText = session.durationSeconds && session.durationSeconds > 0
    ? projectsApi.formatSessionDuration(session.durationSeconds)
    : '< 1m';

  setText('session-summary-title', titleText);
  setText('session-summary-code', session.code);
  setText('session-summary-time', new Date(session.startedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }));
  setText('session-summary-duration', durationText);

  // Participants list
  const pList = $('session-summary-participants');
  if (pList) {
    pList.innerHTML = '';
    const ownerName = activeProject.ownerDisplayName || activeProject.ownerUsername || 'Owner';
    let text = `${ownerName} (Host)`;
    if (isCollab && session.collaborator) {
      text += `, ${session.collaborator.displayName}`;
    }
    const span = document.createElement('span');
    span.className = 'modal-participants-text';
    span.textContent = text;
    pList.appendChild(span);
  }

  // Activities list - only items that were actually modified during this session
  const actList = $('session-summary-activities');
  if (actList) {
    actList.innerHTML = '';
    
    // 1. Check for recorded factual session events
    const summaryEvents = session.summary?.events || [];
    
    // 2. Fallback to project activities strictly within session timestamps (excluding session_completed meta events)
    const sessionStart = session.startedAt;
    const sessionEnd = session.endedAt || (session.startedAt + (session.durationSeconds || 1) * 1000);
    
    const fallbackActs = (activeProject.activities || []).filter((a) => {
      const isWithinSession = a.createdAt >= sessionStart && a.createdAt <= sessionEnd + 1000;
      const isWorkspaceChange = a.type !== 'session_completed' && a.type !== 'collaborator_added' && a.type !== 'collaborator_removed';
      return isWithinSession && isWorkspaceChange;
    });

    const hasSummaryEvents = summaryEvents.length > 0;
    const hasFallbackActs = fallbackActs.length > 0;

    if (!hasSummaryEvents && !hasFallbackActs) {
      actList.innerHTML = `<div class="modal-empty-act">No workspace changes or task edits occurred during this session.</div>`;
    } else if (hasSummaryEvents) {
      for (const ev of summaryEvents) {
        const item = document.createElement('div');
        item.className = 'modal-act-item';
        let iconSvg = '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/>';
        if (ev.category === 'task') {
          iconSvg = '<path d="M12 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="m9 15 2 2 4-4"/>';
        } else if (ev.category === 'lyrics') {
          iconSvg = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>';
        } else if (ev.category === 'note') {
          iconSvg = '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>';
        } else if (ev.category === 'structure') {
          iconSvg = '<path d="M21 15V6"/><path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/>';
        }
        item.innerHTML = `
          <span class="modal-act-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon">${iconSvg}</svg>
          </span>
          <span class="modal-act-desc">${escapeHtml(ev.description)}</span>
          <span class="modal-act-time">${projectsApi.formatRelativeTime(ev.timestamp)}</span>
        `;
        actList.appendChild(item);
      }
    } else {
      for (const act of fallbackActs.slice(0, 15)) {
        const item = document.createElement('div');
        item.className = 'modal-act-item';
        let desc = act.summary || act.title || 'Workspace updated';
        item.innerHTML = `
          <span class="modal-act-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>
          </span>
          <span class="modal-act-desc">${escapeHtml(desc)}</span>
          <span class="modal-act-time">${projectsApi.formatRelativeTime(act.createdAt)}</span>
        `;
        actList.appendChild(item);
      }
    }
  }

  modal.classList.remove('hidden');
}

function createSessionItemEl(session: ProjectSessionItem): HTMLElement {
  const item = document.createElement('div');
  item.className = 'project-session-item';
  const collabText = session.collaborator ? session.collaborator.displayName : 'Solo Studio Session';
  const timeText = projectsApi.formatRelativeTime(session.startedAt);
  const durationText = session.durationSeconds && session.durationSeconds > 0
    ? projectsApi.formatSessionDuration(session.durationSeconds)
    : '< 1m';

  item.innerHTML = `
    <div class="project-session-left">
      <div class="project-session-details">
        <div class="project-session-collab-row">
          <span class="project-session-collab">${escapeHtml(collabText)}</span>
        </div>
        <div class="project-session-sub-row">
          <span class="project-session-code">${escapeHtml(session.code)}</span>
          <span class="meta-dot">·</span>
          <span class="project-session-time">${escapeHtml(timeText)}</span>
        </div>
      </div>
    </div>
    <div class="project-session-right">
      <span class="project-session-duration"><span class="meta-icon">${icons.clock({ size: 11 })}</span> <span>${escapeHtml(durationText)}</span></span>
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
      if (!panel.closest('#project-song-studio-view')) {
        panel.classList.toggle('hidden', panel.id !== `project-panel-${targetTab}`);
      }
    });
    if (targetTab === 'overview') {
      renderProjectOverviewSongsList();
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

$('btn-project-back')?.addEventListener('click', async () => {
  if (activeProject?.workspace) {
    await flushAllWorkspacePendingSaves();
  }
  activeProjectId = undefined;
  activeProject = undefined;
  showView('home-view');
  void loadProjects();
});
$('project-view-home-crumb')?.addEventListener('click', async () => {
  if (activeProject?.workspace) {
    await flushAllWorkspacePendingSaves();
  }
  activeProjectId = undefined;
  activeProject = undefined;
  showView('home-view');
  void loadProjects();
});

$('btn-project-start-session')?.addEventListener('click', async () => {
  if (!activeProject) return;
  await flushAllWorkspacePendingSaves();
  activeProjectId = activeProject.id;
  await prepareStudio({ type: 'create' });
});

$('btn-sessions-tab-start')?.addEventListener('click', async () => {
  if (!activeProject) return;
  await flushAllWorkspacePendingSaves();
  activeProjectId = activeProject.id;
  await prepareStudio({ type: 'create' });
});

$('project-sessions-search-input')?.addEventListener('input', (e) => {
  currentProjectSessionsSearch = (e.target as HTMLInputElement).value;
  currentProjectSessionsPage = 1;
  renderProjectSessions();
});

document.querySelectorAll<HTMLButtonElement>('.sessions-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentProjectSessionsFilter = (btn.dataset.filter as any) || 'all';
    currentProjectSessionsPage = 1;
    document.querySelectorAll('.sessions-filter-btn').forEach((b) => b.classList.toggle('active', b === btn));
    renderProjectSessions();
  });
});

$('btn-sessions-prev-page')?.addEventListener('click', () => {
  if (currentProjectSessionsPage > 1) {
    currentProjectSessionsPage--;
    renderProjectSessions();
  }
});

$('btn-sessions-next-page')?.addEventListener('click', () => {
  currentProjectSessionsPage++;
  renderProjectSessions();
});


$('btn-close-session-summary')?.addEventListener('click', () => {
  $('project-session-summary-modal')?.classList.add('hidden');
});

$('project-session-summary-modal')?.addEventListener('click', (e) => {
  if (e.target === $('project-session-summary-modal')) {
    $('project-session-summary-modal')?.classList.add('hidden');
  }
});

$('btn-session-summary-copy')?.addEventListener('click', () => {
  if (activeSummarySession) {
    void navigator.clipboard.writeText(activeSummarySession.code);
    const copyBtn = $('btn-session-summary-copy');
    if (copyBtn) {
      copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> <span>Copied!</span>';
      setTimeout(() => {
        copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> <span>Copy Code</span>';
      }, 1500);
    }
  }
});

$('btn-close-session-summary-footer')?.addEventListener('click', () => {
  $('project-session-summary-modal')?.classList.add('hidden');
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

const openRenameProjectModal = () => {
  if (!activeProject) return;
  $('project-menu-dropdown')?.classList.add('hidden');
  projectMenuOpen = false;
  $<HTMLInputElement>('rename-project-name').value = activeProject.name;
  $<HTMLTextAreaElement>('rename-project-desc').value = activeProject.description || '';
  setText('rename-project-error', '');
  $('rename-project-modal')?.classList.remove('hidden');
  $<HTMLInputElement>('rename-project-name')?.focus();
};

$('btn-project-rename')?.addEventListener('click', openRenameProjectModal);
$('project-title')?.addEventListener('dblclick', openRenameProjectModal);
$('project-view-name-crumb')?.addEventListener('dblclick', openRenameProjectModal);
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
  
  const targetPhrase = `delete ${activeProject.name}`;
  setText('delete-project-name-confirm', activeProject.name);
  setText('delete-phrase-target', targetPhrase);
  
  const confirmInput = $<HTMLInputElement>('delete-project-confirm-input');
  if (confirmInput) {
    confirmInput.value = '';
    confirmInput.placeholder = `Type "${targetPhrase}"`;
  }
  
  const confirmBtn = $<HTMLButtonElement>('btn-confirm-delete-project');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Delete Project';
  }
  
  const errEl = $('delete-project-error');
  if (errEl) {
    errEl.textContent = '';
    errEl.style.display = 'none';
  }

  $('delete-project-modal')?.classList.remove('hidden');
  setTimeout(() => confirmInput?.focus(), 50);
});

$('delete-project-confirm-input')?.addEventListener('input', (e) => {
  if (!activeProject) return;
  const inputEl = e.target as HTMLInputElement;
  const val = inputEl.value.trim().toLowerCase();
  const projName = activeProject.name.trim().toLowerCase();
  const targetA = `delete ${projName}`;
  const targetB = `delete - ${projName}`;
  const targetC = `delete "${projName}"`;
  
  const isMatch = val === targetA || val === targetB || val === targetC;
  inputEl.classList.toggle('is-matched', isMatch);
  const confirmBtn = $<HTMLButtonElement>('btn-confirm-delete-project');
  if (confirmBtn) {
    confirmBtn.disabled = !isMatch;
  }
});

$('delete-project-confirm-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const confirmBtn = $<HTMLButtonElement>('btn-confirm-delete-project');
    if (confirmBtn && !confirmBtn.disabled) {
      confirmBtn.click();
    }
  }
});

$('btn-close-delete-project')?.addEventListener('click', () => $('delete-project-modal')?.classList.add('hidden'));
$('btn-cancel-delete-project')?.addEventListener('click', () => $('delete-project-modal')?.classList.add('hidden'));

$('btn-confirm-delete-project')?.addEventListener('click', async () => {
  if (!activeProject) return;
  const token = auth.getToken();
  const errEl = $('delete-project-error');
  if (!token) {
    if (errEl) {
      errEl.textContent = 'You must be signed in to delete a project.';
      errEl.style.display = 'block';
    }
    return;
  }
  const confirmBtn = $<HTMLButtonElement>('btn-confirm-delete-project');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting…';
  }
  if (errEl) errEl.style.display = 'none';

  try {
    await projectsApi.deleteProject(token, activeProject.id);
    $('delete-project-modal')?.classList.add('hidden');
    activeProject = undefined;
    activeProjectId = undefined;
    showView('home-view');
    await loadProjects();
  } catch (err: any) {
    console.error('Failed to delete project:', err);
    if (errEl) {
      errEl.textContent = err?.message || 'Failed to delete project. Make sure you are the project owner.';
      errEl.style.display = 'block';
    }
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Delete Project';
    }
  }
});

// Add Collaborator
const openAddCollabModal = () => {
  const input = $<HTMLInputElement>('add-collab-username');
  if (input) input.value = '';
  const roleSelect = $<HTMLSelectElement>('add-collab-role');
  if (roleSelect) roleSelect.value = 'editor';
  setText('add-collab-error', '');
  $('add-collab-modal')?.classList.remove('hidden');
  input?.focus();
};
$('btn-project-add-collab')?.addEventListener('click', openAddCollabModal);
$('btn-project-add-collab-tab')?.addEventListener('click', openAddCollabModal);

$('btn-close-add-collab')?.addEventListener('click', () => $('add-collab-modal')?.classList.add('hidden'));
$('btn-cancel-add-collab')?.addEventListener('click', () => $('add-collab-modal')?.classList.add('hidden'));
$('btn-confirm-add-collab')?.addEventListener('click', async () => {
  if (!activeProject) return;
  const usernameOrEmail = $<HTMLInputElement>('add-collab-username')?.value.trim();
  if (!usernameOrEmail) { setText('add-collab-error', 'Please enter a username or email.'); return; }
  const role = $<HTMLSelectElement>('add-collab-role')?.value || 'editor';
  const token = auth.getToken();
  if (!token) return;
  try {
    setText('add-collab-error', '');
    activeProject = await projectsApi.addCollaborator(token, activeProject.id, usernameOrEmail, role);
    renderProjectView();
    $('add-collab-modal')?.classList.add('hidden');
  } catch (err) {
    setText('add-collab-error', err instanceof Error ? err.message : 'Failed to add collaborator.');
  }
});

// Delete Song Modal Handlers
let songPendingDeletion: ProjectSongItem | null = null;

function openDeleteSongModal(song: ProjectSongItem): void {
  if (!activeProject || !canUserEditProject()) return;
  songPendingDeletion = song;

  const sTitle = song.title || 'Untitled Song';
  const targetPhrase = `delete ${sTitle}`;
  setText('delete-song-name-confirm', sTitle);
  setText('delete-song-phrase-target', targetPhrase);

  const confirmInput = $<HTMLInputElement>('delete-song-confirm-input');
  if (confirmInput) {
    confirmInput.value = '';
    confirmInput.placeholder = `Type "${targetPhrase}"`;
    confirmInput.classList.remove('is-matched');
  }

  const confirmBtn = $<HTMLButtonElement>('btn-confirm-delete-song');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></svg>
      <span>Delete Track</span>
    `;
  }

  const errEl = $('delete-song-error');
  if (errEl) {
    errEl.textContent = '';
    errEl.style.display = 'none';
  }

  $('delete-song-modal')?.classList.remove('hidden');
  setTimeout(() => confirmInput?.focus(), 50);
}

$('delete-song-confirm-input')?.addEventListener('input', (e) => {
  if (!songPendingDeletion) return;
  const inputEl = e.target as HTMLInputElement;
  const val = inputEl.value.trim().toLowerCase();
  const sTitle = (songPendingDeletion.title || '').trim().toLowerCase();
  const targetA = `delete ${sTitle}`;
  const targetB = `delete - ${sTitle}`;
  const targetC = `delete "${sTitle}"`;
  const isMatch = val === targetA || val === targetB || val === targetC || val === 'delete' || val === sTitle;

  inputEl.classList.toggle('is-matched', isMatch);
  const confirmBtn = $<HTMLButtonElement>('btn-confirm-delete-song');
  if (confirmBtn) {
    confirmBtn.disabled = !isMatch;
  }
});

$('delete-song-confirm-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const confirmBtn = $<HTMLButtonElement>('btn-confirm-delete-song');
    if (confirmBtn && !confirmBtn.disabled) {
      confirmBtn.click();
    }
  }
});

$('btn-close-delete-song')?.addEventListener('click', () => {
  $('delete-song-modal')?.classList.add('hidden');
  songPendingDeletion = null;
});
$('btn-cancel-delete-song')?.addEventListener('click', () => {
  $('delete-song-modal')?.classList.add('hidden');
  songPendingDeletion = null;
});

$('btn-confirm-delete-song')?.addEventListener('click', async () => {
  if (!activeProject?.workspace || !songPendingDeletion || !canUserEditProject()) return;
  const songToDelete = songPendingDeletion;
  const ws = activeProject.workspace;
  const songs = ws.songs || [];

  const idx = songs.findIndex((s) => s.id === songToDelete.id);
  if (idx !== -1) {
    songs.splice(idx, 1);
  }

  // If no songs left, create a fresh initial song
  if (songs.length === 0) {
    const now = Date.now();
    const initSong: ProjectSongItem = {
      id: 'song-1',
      title: 'Song 1',
      order: 0,
      lyrics: { revision: 1, activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now }], content: '', updatedAt: now },
      notes: { revision: 1, content: '• ', bpm: '120 BPM', key: 'C Major', updatedAt: now },
      structure: { revision: 1, sections: [], updatedAt: now },
      createdAt: now,
      updatedAt: now
    };
    songs.push(initSong);
  }

  // If the deleted song was the active song, switch to another song
  if (ws.activeSongId === songToDelete.id) {
    const nextSong = songs[Math.max(0, idx - 1)] || songs[0];
    switchActiveSong(nextSong.id);
  }

  $('delete-song-modal')?.classList.add('hidden');
  songPendingDeletion = null;

  renderProjectSongsSelector();
  renderProjectOverviewSongsList();
  applyWorkspacePermissions();
  void saveSongsWorkspace();
});

// Close modals on overlay click
for (const modalId of ['new-project-modal', 'rename-project-modal', 'add-collab-modal', 'delete-project-modal', 'delete-song-modal']) {
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

// Generation counters for stale save response protection
let currentWorkspaceContextGen = 0;
let lyricsEditGen = 0;
let lyricsSaveGen = 0;
let notesEditGen = 0;
let notesSaveGen = 0;
let structureEditGen = 0;
let structureSaveGen = 0;
let tasksEditGen = 0;
let tasksSaveGen = 0;

// Snapshot of last confirmed server state for 3-way merging
let lastSyncedLyrics = '';
let lastSyncedNotes = '';
let lastSyncedNotesBpm = '';
let lastSyncedNotesKey = '';

function canUserEditProject(): boolean {
  if (!activeProject) return false;
  const user = auth.getUser();
  if (!user) return false;
  if (activeProject.ownerId === user.id || (user.username && activeProject.ownerUsername && activeProject.ownerUsername.toLowerCase() === user.username.toLowerCase())) {
    return true;
  }
  const collab = activeProject.collaborators?.find((c) => 
    c.userId === user.id || 
    (user.username && c.username && c.username.toLowerCase() === user.username.toLowerCase())
  );
  if (!collab) return false;
  return collab.role === 'editor' || collab.role === 'collaborator' || (collab.role as string) === 'owner';
}

function applyWorkspacePermissions(): void {
  const canEdit = canUserEditProject();
  const user = auth.getUser();
  const isOwner = user?.id === activeProject?.ownerId || (user?.username && activeProject?.ownerUsername && activeProject.ownerUsername.toLowerCase() === user.username.toLowerCase());

  // 1. Lyrics editor & formatting toolbar
  const projectLyricsEditor = $('project-lyrics-editor');
  const sessionLyricsEditor = $('session-lyrics-editor');
  if (projectLyricsEditor) {
    projectLyricsEditor.setAttribute('contenteditable', canEdit ? 'true' : 'false');
    projectLyricsEditor.classList.toggle('readonly-viewer', !canEdit);
    projectLyricsEditor.style.cursor = canEdit ? 'text' : 'default';
  }
  if (sessionLyricsEditor) {
    sessionLyricsEditor.setAttribute('contenteditable', canEdit ? 'true' : 'false');
    sessionLyricsEditor.classList.toggle('readonly-viewer', !canEdit);
    sessionLyricsEditor.style.cursor = canEdit ? 'text' : 'default';
  }
  const lyricsToolbar = $('lyrics-formatting-toolbar');
  if (lyricsToolbar) {
    lyricsToolbar.style.display = canEdit ? '' : 'none';
  }
  const btnNewDoc = $('btn-new-lyrics-doc');
  if (btnNewDoc) {
    btnNewDoc.style.display = canEdit ? '' : 'none';
  }
  const sectionHelperBar = document.querySelector<HTMLElement>('.lyrics-section-helpers-bar');
  if (sectionHelperBar) {
    sectionHelperBar.style.display = canEdit ? '' : 'none';
  }

  // 2. Notes & BPM / Key inputs
  const projectNotes = $<HTMLTextAreaElement>('project-notes-input');
  const sessionNotes = $<HTMLTextAreaElement>('session-notes-input');
  if (projectNotes) {
    projectNotes.readOnly = !canEdit;
    projectNotes.style.cursor = canEdit ? 'text' : 'default';
    projectNotes.placeholder = canEdit ? 'Add production notes, chords, mixing instructions, references…' : 'Notes (View Only)';
  }
  if (sessionNotes) {
    sessionNotes.readOnly = !canEdit;
    sessionNotes.style.cursor = canEdit ? 'text' : 'default';
    sessionNotes.placeholder = canEdit ? 'Session notes…' : 'Notes (View Only)';
  }

  const projectBpm = $<HTMLInputElement>('project-notes-bpm');
  const sessionBpm = $<HTMLInputElement>('session-notes-bpm');
  if (projectBpm) {
    projectBpm.readOnly = !canEdit;
    projectBpm.disabled = !canEdit;
    projectBpm.style.cursor = canEdit ? 'text' : 'default';
  }
  if (sessionBpm) {
    sessionBpm.readOnly = !canEdit;
    sessionBpm.disabled = !canEdit;
    sessionBpm.style.cursor = canEdit ? 'text' : 'default';
  }

  const keyRoot = $<HTMLSelectElement>('project-notes-key-root');
  const keyMode = $<HTMLSelectElement>('project-notes-key-mode');
  if (keyRoot) keyRoot.disabled = !canEdit;
  if (keyMode) keyMode.disabled = !canEdit;
  const sKeyRoot = $<HTMLSelectElement>('session-notes-key-root');
  const sKeyMode = $<HTMLSelectElement>('session-notes-key-mode');
  if (sKeyRoot) sKeyRoot.disabled = !canEdit;
  if (sKeyMode) sKeyMode.disabled = !canEdit;

  // 3. Tasks inputs & actions
  const taskInput = $<HTMLInputElement>('new-task-input');
  const taskAddBtn = $<HTMLButtonElement>('btn-add-task');
  const taskNewRow = document.querySelector<HTMLElement>('.reminders-new-task-row') || taskInput?.closest<HTMLElement>('.reminders-new-task-bar');
  if (taskNewRow) {
    taskNewRow.style.display = canEdit ? '' : 'none';
  }
  if (taskInput) {
    taskInput.disabled = !canEdit;
    taskInput.placeholder = canEdit ? 'Add a task or production reminder…' : 'View only mode';
  }
  if (taskAddBtn) taskAddBtn.disabled = !canEdit;

  const sessionTaskInput = $<HTMLInputElement>('session-new-task-input');
  const sessionTaskAddBtn = $<HTMLButtonElement>('session-btn-add-task');
  const sessionTaskNewRow = sessionTaskInput?.closest<HTMLElement>('.session-tasks-creation-bar');
  if (sessionTaskNewRow) {
    sessionTaskNewRow.style.display = canEdit ? '' : 'none';
  }
  if (sessionTaskInput) {
    sessionTaskInput.disabled = !canEdit;
    sessionTaskInput.placeholder = canEdit ? 'Add a task…' : 'View only';
  }
  if (sessionTaskAddBtn) sessionTaskAddBtn.disabled = !canEdit;

  // 4. Structure controls
  const structureAddBtn = $<HTMLButtonElement>('btn-structure-add-section');
  if (structureAddBtn) structureAddBtn.style.display = canEdit ? '' : 'none';
  const structureActionsBar = document.querySelector<HTMLElement>('.structure-actions-bar');
  if (structureActionsBar) structureActionsBar.style.display = canEdit ? '' : 'none';
  const structureQuickAdd = document.querySelector<HTMLElement>('.structure-quick-add');
  if (structureQuickAdd) structureQuickAdd.style.display = canEdit ? '' : 'none';
  const structureTimeline = $('structure-timeline-ribbon');
  if (structureTimeline) structureTimeline.classList.toggle('readonly-viewer', !canEdit);

  // 5. Song creation and toolbar actions
  for (const songBtnId of [
    'btn-overview-new-song',
    'btn-quick-new-song',
    'btn-open-new-song-modal',
    'btn-session-new-song',
    'btn-song-studio-add-song',
    'btn-song-studio-rename-song',
    'btn-song-studio-delete-song'
  ]) {
    const el = $(songBtnId);
    if (el) el.style.display = canEdit ? '' : 'none';
  }

  // 6. Collaborator add buttons (Only owner)
  const addCollabHero = $('btn-project-add-collab');
  if (addCollabHero) addCollabHero.style.display = isOwner ? '' : 'none';
  const addCollabTab = $('btn-project-add-collab-tab');
  if (addCollabTab) addCollabTab.style.display = isOwner ? '' : 'none';

  // 7. Enforce read-only state on rendered list items
  document.querySelectorAll<HTMLElement>('.structure-section-card, .drawer-section-card').forEach((card) => {
    if (!canEdit) {
      card.removeAttribute('draggable');
      card.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((el) => {
        el.disabled = true;
        if (el instanceof HTMLInputElement) el.readOnly = true;
      });
      card.querySelectorAll<HTMLElement>('.btn-dup, .btn-del, .drag-handle').forEach((el) => {
        el.style.display = 'none';
      });
    }
  });

  document.querySelectorAll<HTMLElement>('.reminders-task-row, .drawer-task-card').forEach((row) => {
    if (!canEdit) {
      row.removeAttribute('draggable');
      row.querySelectorAll<HTMLButtonElement>('.reminders-check-btn, .task-subtask-check').forEach((b) => {
        b.disabled = true;
        b.style.cursor = 'default';
        b.title = 'View only mode';
      });
      row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((el) => {
        el.disabled = true;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.readOnly = true;
      });
      row.querySelectorAll<HTMLElement>('.btn-del, .task-subtasks-add-row, .task-subtask-del').forEach((el) => {
        el.style.display = 'none';
      });
    }
  });
}

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

interface Change {
  baseStart: number;
  baseEnd: number;
  lines: string[];
}

function computeLcs(a: string[], b: string[]): Array<{ aIdx: number; bIdx: number }> {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const matches: Array<{ aIdx: number; bIdx: number }> = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      matches.push({ aIdx: i - 1, bIdx: j - 1 });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  matches.reverse();
  return matches;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function getChanges(base: string[], target: string[]): Change[] {
  const matches = computeLcs(base, target);
  const changes: Change[] = [];
  let lastBase = 0;
  let lastTarget = 0;

  for (const m of matches) {
    if (m.aIdx > lastBase || m.bIdx > lastTarget) {
      changes.push({
        baseStart: lastBase,
        baseEnd: m.aIdx,
        lines: target.slice(lastTarget, m.bIdx)
      });
    }
    lastBase = m.aIdx + 1;
    lastTarget = m.bIdx + 1;
  }

  if (lastBase < base.length || lastTarget < target.length) {
    changes.push({
      baseStart: lastBase,
      baseEnd: base.length,
      lines: target.slice(lastTarget)
    });
  }

  return changes;
}

function mergeIntervals(changesA: Change[], changesB: Change[], baseLength: number): Array<{ start: number; end: number }> {
  const allIntervals: Array<{ start: number; end: number }> = [];
  for (const c of changesA) allIntervals.push({ start: c.baseStart, end: c.baseEnd });
  for (const c of changesB) allIntervals.push({ start: c.baseStart, end: c.baseEnd });

  if (allIntervals.length === 0) return [];

  allIntervals.sort((x, y) => x.start - y.start || x.end - y.end);

  const merged: Array<{ start: number; end: number }> = [];
  let curr = { ...allIntervals[0] };

  for (let i = 1; i < allIntervals.length; i++) {
    const next = allIntervals[i];
    if (next.start < curr.end || (next.start === curr.end && (next.start === next.end || curr.start === curr.end || next.start < baseLength))) {
      curr.end = Math.max(curr.end, next.end);
    } else {
      merged.push(curr);
      curr = { ...next };
    }
  }
  merged.push(curr);

  return merged;
}

function reconstructSlice(base: string[], changes: Change[], start: number, end: number): string[] {
  const relevant = changes.filter((c) => c.baseStart >= start && c.baseEnd <= end);
  if (relevant.length === 0) {
    return base.slice(start, end);
  }

  const result: string[] = [];
  let currBase = start;

  for (const c of relevant) {
    if (c.baseStart > currBase) {
      result.push(...base.slice(currBase, c.baseStart));
    }
    result.push(...c.lines);
    currBase = c.baseEnd;
  }

  if (currBase < end) {
    result.push(...base.slice(currBase, end));
  }

  return result;
}

interface ThreeWayMergeResult {
  merged: string;
  hasConflict: boolean;
}

/**
 * Intelligent 3-way non-destructive line merge for collaborative notes & text
 */
function threeWayLineMergeDetailed(base: string, local: string, remote: string): ThreeWayMergeResult {
  if (local === remote) return { merged: local, hasConflict: false };
  if (local === base) return { merged: remote, hasConflict: false };
  if (remote === base) return { merged: local, hasConflict: false };

  const baseLines = base.split('\n');
  const localLines = local.split('\n');
  const remoteLines = remote.split('\n');

  const changesLocal = getChanges(baseLines, localLines);
  const changesRemote = getChanges(baseLines, remoteLines);

  const combinedIntervals = mergeIntervals(changesLocal, changesRemote, baseLines.length);

  const resultLines: string[] = [];
  let prevEnd = 0;
  let hasConflict = false;

  for (const interval of combinedIntervals) {
    if (interval.start > prevEnd) {
      resultLines.push(...baseLines.slice(prevEnd, interval.start));
    }

    const localSlice = reconstructSlice(baseLines, changesLocal, interval.start, interval.end);
    const remoteSlice = reconstructSlice(baseLines, changesRemote, interval.start, interval.end);
    const baseSlice = baseLines.slice(interval.start, interval.end);

    const localChanged = !arraysEqual(localSlice, baseSlice);
    const remoteChanged = !arraysEqual(remoteSlice, baseSlice);

    if (localChanged && remoteChanged) {
      if (arraysEqual(localSlice, remoteSlice)) {
        resultLines.push(...localSlice);
      } else if (interval.start === interval.end) {
        // Pure simultaneous boundary insertion: preserve distinct lines from both collaborators
        const combined = [...localSlice];
        for (const r of remoteSlice) {
          if (!combined.includes(r)) {
            combined.push(r);
          }
        }
        resultLines.push(...combined);
      } else {
        hasConflict = true;
        resultLines.push(...localSlice);
      }
    } else if (localChanged) {
      resultLines.push(...localSlice);
    } else if (remoteChanged) {
      resultLines.push(...remoteSlice);
    } else {
      resultLines.push(...baseSlice);
    }

    prevEnd = interval.end;
  }

  if (prevEnd < baseLines.length) {
    resultLines.push(...baseLines.slice(prevEnd));
  }

  return {
    merged: hasConflict ? local : resultLines.join('\n'),
    hasConflict
  };
}

function threeWayLineMerge(base: string, local: string, remote: string): string {
  return threeWayLineMergeDetailed(base, local, remote).merged;
}

interface NotesStateValues {
  content?: string;
  bpm?: string;
  key?: string;
}

interface NotesReconciliationResult {
  content: string;
  bpm: string;
  key: string;
  hasUnresolvableConflict: boolean;
  bpmChangedRemotely: boolean;
  keyChangedRemotely: boolean;
  bpmChangedLocally: boolean;
  keyChangedLocally: boolean;
}

function reconcileNotesWorkspace(
  base: NotesStateValues,
  local: NotesStateValues,
  remote: NotesStateValues
): NotesReconciliationResult {
  const baseContent = base.content || '';
  const localContent = local.content || '';
  const remoteContent = remote.content || '';

  const baseBpm = (base.bpm || '').trim();
  const localBpm = (local.bpm || '').trim();
  const remoteBpm = (remote.bpm || '').trim();

  const baseKey = (base.key || '').trim();
  const localKey = (local.key || '').trim();
  const remoteKey = (remote.key || '').trim();

  // 1. Text reconciliation using robust 3-way line merge
  const textMerge = threeWayLineMergeDetailed(baseContent, localContent, remoteContent);

  // 2. BPM reconciliation
  const bpmChangedLocally = localBpm !== baseBpm;
  const bpmChangedRemotely = remoteBpm !== baseBpm;
  let resolvedBpm = localBpm;
  let bpmConflict = false;

  if (bpmChangedLocally && bpmChangedRemotely) {
    if (localBpm === remoteBpm) {
      resolvedBpm = localBpm;
    } else {
      bpmConflict = true;
      resolvedBpm = localBpm;
    }
  } else if (bpmChangedRemotely) {
    resolvedBpm = remoteBpm;
  } else {
    resolvedBpm = localBpm;
  }

  // 3. Key reconciliation
  const keyChangedLocally = localKey !== baseKey;
  const keyChangedRemotely = remoteKey !== baseKey;
  let resolvedKey = localKey;
  let keyConflict = false;

  if (keyChangedLocally && keyChangedRemotely) {
    if (localKey === remoteKey) {
      resolvedKey = localKey;
    } else {
      keyConflict = true;
      resolvedKey = localKey;
    }
  } else if (keyChangedRemotely) {
    resolvedKey = remoteKey;
  } else {
    resolvedKey = localKey;
  }

  const hasUnresolvableConflict = textMerge.hasConflict || bpmConflict || keyConflict;

  return {
    content: textMerge.merged,
    bpm: resolvedBpm,
    key: resolvedKey,
    hasUnresolvableConflict,
    bpmChangedRemotely: !bpmConflict && bpmChangedRemotely,
    keyChangedRemotely: !keyConflict && keyChangedRemotely,
    bpmChangedLocally,
    keyChangedLocally
  };
}

// ========================================================
// PROJECT WORKSPACE: MULTI-SONG TRACKS ARCHITECTURE
// ========================================================
function getActiveSong(): ProjectSongItem {
  const now = Date.now();
  if (!activeProject) {
    return {
      id: 'song-1',
      title: 'Song 1',
      order: 0,
      lyrics: { revision: 1, activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: 0 }], content: '', updatedAt: 0 },
      notes: { revision: 1, content: '', updatedAt: 0 },
      structure: { revision: 1, sections: [], updatedAt: 0 },
      createdAt: 0,
      updatedAt: 0
    };
  }

  if (!activeProject.workspace) {
    activeProject.workspace = {
      activeSongId: 'song-1',
      songs: [],
      lyrics: { revision: 1, activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now }], content: '', updatedAt: now },
      notes: { revision: 1, content: '', updatedAt: now },
      structure: { revision: 1, sections: [], updatedAt: now },
      tasks: { revision: 1, tasks: [], updatedAt: now }
    };
  }

  const ws = activeProject.workspace;
  if (!ws.songs || !Array.isArray(ws.songs) || ws.songs.length === 0) {
    const initialSong: ProjectSongItem = {
      id: 'song-1',
      title: activeProject.name ? activeProject.name : 'Song 1',
      order: 0,
      lyrics: ws.lyrics || { revision: 1, activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now }], content: '', updatedAt: now },
      notes: ws.notes || { revision: 1, content: '', updatedAt: now },
      structure: ws.structure || { revision: 1, sections: [], updatedAt: now },
      createdAt: now,
      updatedAt: now
    };
    ws.songs = [initialSong];
    ws.activeSongId = 'song-1';
  }

  const activeId = ws.activeSongId || ws.songs[0].id;
  const song = ws.songs.find((s) => s && s.id === activeId) || ws.songs[0];
  ws.activeSongId = song.id;

  // Mirror active song's data to top-level workspace for seamless subsystem compatibility
  ws.lyrics = song.lyrics;
  ws.notes = song.notes;
  ws.structure = song.structure;

  return song;
}

let isSongStudioOpen = false;
let currentSongStudioTab: 'lyrics' | 'structure' | 'notes' = 'lyrics';

function openSongStudio(songId?: string, targetTab: 'lyrics' | 'structure' | 'notes' = 'lyrics'): void {
  if (songId && activeProject?.workspace && activeProject.workspace.activeSongId !== songId) {
    switchActiveSong(songId);
  }
  const activeSong = getActiveSong();
  isSongStudioOpen = true;
  currentSongStudioTab = targetTab;

  // 1. Hide main project tabs bar and non-song-studio panels
  $('project-main-tabs-bar')?.classList.add('hidden');
  document.querySelectorAll<HTMLElement>('.project-tab-panel').forEach((p) => {
    if (!p.closest('#project-song-studio-view')) {
      p.classList.add('hidden');
    }
  });

  // 2. Show Song Studio View
  const studioView = $('project-song-studio-view');
  studioView?.classList.remove('hidden');

  // 3. Update breadcrumb project name and active song title
  setText('song-nav-project-name', activeProject?.name || 'Project Overview');
  setText('song-studio-active-title', activeSong.title || 'Untitled Song');

  // 4. Update Quick Switch dropdown
  const quickSelect = $<HTMLSelectElement>('select-song-studio-quick-switch');
  if (quickSelect && activeProject?.workspace?.songs) {
    quickSelect.innerHTML = '';
    activeProject.workspace.songs.forEach((s, i) => {
      if (!s) return;
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${i + 1}. ${s.title || `Song ${i + 1}`}`;
      opt.selected = s.id === activeSong.id;
      quickSelect.appendChild(opt);
    });
  }

  // 5. Activate tab
  document.querySelectorAll<HTMLButtonElement>('.song-studio-tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.songTab === targetTab);
  });
  $('project-panel-lyrics')?.classList.toggle('hidden', targetTab !== 'lyrics');
  $('project-panel-structure')?.classList.toggle('hidden', targetTab !== 'structure');
  $('project-panel-notes')?.classList.toggle('hidden', targetTab !== 'notes');

  if (targetTab === 'lyrics') {
    setTimeout(() => updateLyricsDocumentPagination(), 20);
  }

  applyWorkspacePermissions();
}

function closeSongStudio(): void {
  isSongStudioOpen = false;
  $('project-song-studio-view')?.classList.add('hidden');
  $('project-main-tabs-bar')?.classList.remove('hidden');

  // Set project tabs to overview
  const tabBtns = document.querySelectorAll<HTMLButtonElement>('.project-tab-btn');
  tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === 'overview'));

  const panels = document.querySelectorAll<HTMLElement>('.project-tab-panel');
  panels.forEach((p) => {
    if (!p.closest('#project-song-studio-view')) {
      p.classList.toggle('hidden', p.id !== 'project-panel-overview');
    }
  });

  applyWorkspacePermissions();
  renderProjectOverviewSongsList();
}

let currentSongsOverviewPage = 1;
const SONGS_PER_PAGE = 5;

function renderProjectOverviewSongsList(): void {
  if (!activeProject?.workspace) return;
  const activeSong = getActiveSong();
  const ws = activeProject.workspace;
  const songs = ws.songs || [];

  setText('project-overview-songs-count', songs.length.toString());

  const listEl = $('project-overview-songs-list');
  const pagEl = $('project-overview-songs-pagination');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (songs.length === 0) {
    if (pagEl) pagEl.classList.add('hidden');
    listEl.innerHTML = `
      <div class="workspace-empty-row" style="padding: 12px 0;">
        <div class="workspace-empty-text">
          <span class="workspace-empty-title" style="font-size: 13px; font-weight: 600;">No tracks in this project yet</span>
          <span class="workspace-empty-desc" style="font-size: 11px;">Click "+" above to create your first track.</span>
        </div>
      </div>
    `;
    return;
  }

  const totalPages = Math.ceil(songs.length / SONGS_PER_PAGE) || 1;
  if (currentSongsOverviewPage > totalPages) {
    currentSongsOverviewPage = totalPages;
  }
  if (currentSongsOverviewPage < 1) {
    currentSongsOverviewPage = 1;
  }

  const startIndex = (currentSongsOverviewPage - 1) * SONGS_PER_PAGE;
  const pageSongs = songs.slice(startIndex, startIndex + SONGS_PER_PAGE);

  pageSongs.forEach((song, pIdx) => {
    if (!song) return;
    const globalIdx = startIndex + pIdx;
    const isCurrent = song.id === activeSong.id;
    const card = document.createElement('div');
    card.className = `overview-song-card ${isCurrent ? 'active' : ''}`;
    card.dataset.songId = song.id;

    const bpmRaw = (song.notes?.bpm || activeProject.workspace?.notes?.bpm || '').trim();
    const bpmClean = bpmRaw ? (bpmRaw.toLowerCase().includes('bpm') ? bpmRaw : `${bpmRaw} BPM`) : '120 BPM';
    const keyRaw = (song.notes?.key || activeProject.workspace?.notes?.key || '').trim();
    const keyClean = keyRaw || 'C Major';

    const isArchived = Boolean(song.archived);
    const archivedBadge = isArchived ? `<span class="song-meta-badge badge-archived" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3);">Archived</span>` : '';

    card.innerHTML = `
      <div class="overview-song-left">
        <span class="overview-song-num">${String(globalIdx + 1).padStart(2, '0')}</span>
        <div class="overview-song-details">
          <span class="overview-song-title" title="Double click to rename">${escapeHtml(song.title || `Song ${globalIdx + 1}`)}</span>
          <div class="overview-song-meta">
            ${archivedBadge}
            <span class="song-meta-badge">${escapeHtml(bpmClean)}</span>
            <span class="song-meta-badge">${escapeHtml(keyClean)}</span>
          </div>
        </div>
      </div>
      <div class="overview-song-right">
        <button type="button" class="btn-open-song-studio" title="Open Song Studio" aria-label="Open Song Studio">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </button>
      </div>
    `;

    // Double-click inline rename
    const titleEl = card.querySelector('.overview-song-title') as HTMLElement;
    const startRename = () => {
      if (!canUserEditProject()) return;
      if (titleEl.querySelector('input')) return;
      const currentTitle = song.title || `Song ${globalIdx + 1}`;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'song-inline-rename-input';
      input.value = currentTitle;
      input.maxLength = 80;

      let committed = false;
      const commit = () => {
        if (committed) return;
        committed = true;
        const newTitle = input.value.trim();
        if (newTitle && newTitle !== currentTitle) {
          song.title = newTitle;
          void saveSongsWorkspace();
        }
        renderProjectSongsSelector();
      };

      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') {
          ke.preventDefault();
          commit();
        } else if (ke.key === 'Escape') {
          ke.preventDefault();
          committed = true;
          renderProjectSongsSelector();
        }
      });
      input.addEventListener('click', (ce) => ce.stopPropagation());
      input.addEventListener('dblclick', (de) => de.stopPropagation());
      input.addEventListener('blur', commit);

      titleEl.replaceChildren(input);
      input.focus();
      input.select();
    };

    titleEl?.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    titleEl?.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      e.preventDefault();
      startRename();
    });

    const openBtn = card.querySelector('.btn-open-song-studio') as HTMLElement;
    openBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      openSongStudio(song.id, 'lyrics');
    });

    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      openSongStudio(song.id, 'lyrics');
    });

    card.addEventListener('contextmenu', (e) => {
      showSongContextMenu(e, song);
    });

    listEl.appendChild(card);
  });

  // Render pagination controls
  if (pagEl) {
    if (totalPages > 1) {
      pagEl.classList.remove('hidden');
      const prevBtn = $('btn-songs-prev-page') as HTMLButtonElement;
      const nextBtn = $('btn-songs-next-page') as HTMLButtonElement;
      if (prevBtn) prevBtn.disabled = currentSongsOverviewPage <= 1;
      if (nextBtn) nextBtn.disabled = currentSongsOverviewPage >= totalPages;

      const indicatorsEl = $('songs-page-indicators');
      if (indicatorsEl) {
        indicatorsEl.innerHTML = '';
        for (let i = 1; i <= totalPages; i++) {
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className = `btn-songs-page-pill ${i === currentSongsOverviewPage ? 'active' : ''}`;
          pill.textContent = String(i);
          pill.addEventListener('click', (e) => {
            e.stopPropagation();
            currentSongsOverviewPage = i;
            renderProjectOverviewSongsList();
          });
          indicatorsEl.appendChild(pill);
        }
      }
    } else {
      pagEl.classList.add('hidden');
    }
  }
}

function renderProjectSongsSelector(): void {
  if (!activeProject?.workspace) return;
  const activeSong = getActiveSong();
  const ws = activeProject.workspace;
  const songs = ws.songs || [];

  // 1. Update active song trigger title & studio headers
  setText('active-song-title-display', activeSong.title || 'Untitled Song');
  setText('song-studio-active-title', activeSong.title || 'Untitled Song');
  setText('songs-dropdown-count', `${songs.length} Track${songs.length === 1 ? '' : 's'}`);

  // 2. Render Overview songs list
  renderProjectOverviewSongsList();

  // 3. Update Quick Switch in Song Studio
  const quickSelect = $<HTMLSelectElement>('select-song-studio-quick-switch');
  if (quickSelect) {
    quickSelect.innerHTML = '';
    songs.forEach((s, i) => {
      if (!s) return;
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${i + 1}. ${s.title || `Song ${i + 1}`}`;
      opt.selected = s.id === activeSong.id;
      quickSelect.appendChild(opt);
    });
  }

  // 4. Render dropdown songs list
  const listEl = $('project-songs-list');
  if (listEl) {
    listEl.innerHTML = '';
    songs.forEach((song, idx) => {
      if (!song) return;
      const isActive = song.id === activeSong.id;
      const item = document.createElement('div');
      item.className = `song-dropdown-item ${isActive ? 'active' : ''}`;
      item.dataset.songId = song.id;
      item.draggable = true;

      item.innerHTML = `
        <div class="song-item-left">
          <span class="song-item-idx">${idx + 1}</span>
          <span class="song-item-name" title="Double click to rename">${escapeHtml(song.title || `Song ${idx + 1}`)}</span>
        </div>
        <div class="song-item-actions">
          <button type="button" class="btn-song-item-action btn-rename" title="Rename"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button>
          <button type="button" class="btn-song-item-action btn-dup" title="Duplicate"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>
          ${songs.length > 1 ? `<button type="button" class="btn-song-item-action delete btn-del" title="Delete Song"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></svg></button>` : ''}
        </div>
      `;

      // Inline rename
      const nameEl = item.querySelector('.song-item-name') as HTMLElement;
      const startRename = () => {
        if (nameEl.querySelector('input')) return;
        const currentTitle = song.title || `Song ${idx + 1}`;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'sidebar-item-rename-input';
        input.value = currentTitle;
        input.maxLength = 80;

        const commit = () => {
          const newTitle = input.value.trim();
          if (newTitle && newTitle !== currentTitle) {
            song.title = newTitle;
            void saveSongsWorkspace();
          }
          renderProjectSongsSelector();
        };

        input.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter') {
            ke.preventDefault();
            input.blur();
          } else if (ke.key === 'Escape') {
            ke.preventDefault();
            renderProjectSongsSelector();
          }
        });
        input.addEventListener('click', (ce) => ce.stopPropagation());
        input.addEventListener('dblclick', (de) => de.stopPropagation());
        input.addEventListener('blur', commit);

        nameEl.replaceChildren(input);
        input.focus();
        input.select();
      };

      item.addEventListener('dblclick', (e) => {
        if ((e.target as HTMLElement).closest('.btn-song-item-action')) return;
        e.stopPropagation();
        startRename();
      });
      item.querySelector('.btn-rename')?.addEventListener('click', (e) => {
        e.stopPropagation();
        startRename();
      });
      item.querySelector('.btn-dup')?.addEventListener('click', (e) => {
        e.stopPropagation();
        duplicateSong(song.id);
      });
      item.querySelector('.btn-del')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openDeleteSongModal(song);
      });
      item.addEventListener('contextmenu', (e) => {
        showSongContextMenu(e, song);
      });
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.btn-song-item-action') || (e.target as HTMLElement).tagName === 'INPUT') return;
        switchActiveSong(song.id);
        $('project-songs-dropdown-menu')?.classList.add('hidden');
      });

      // Drag & Drop
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', song.id);
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const sourceId = e.dataTransfer?.getData('text/plain');
        if (sourceId && sourceId !== song.id) {
          reorderSongs(sourceId, song.id);
        }
      });

      listEl.appendChild(item);
    });
  }

  // 5. Update In-Session Drawer Song Select
  const drawerSongSelect = $<HTMLSelectElement>('session-workspace-song-select');
  if (drawerSongSelect) {
    drawerSongSelect.innerHTML = '';
    songs.forEach((s, idx) => {
      if (!s) return;
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${idx + 1}. ${s.title || `Song ${idx + 1}`}`;
      opt.selected = s.id === activeSong.id;
      drawerSongSelect.appendChild(opt);
    });
  }
}

function switchActiveSong(songId: string): void {
  if (!activeProject?.workspace?.songs) return;
  const ws = activeProject.workspace;
  const song = ws.songs.find((s) => s.id === songId);
  if (!song) return;

  // Persist current active song's edits first if pending
  if (lyricsSaveTimeout) {
    clearTimeout(lyricsSaveTimeout);
    lyricsSaveTimeout = null;
    const activeDoc = getActiveLyricsDoc();
    void saveLyricsWorkspace(activeDoc.content, activeDoc.id, activeDoc.title);
  }
  if (notesSaveTimeout) {
    clearTimeout(notesSaveTimeout);
    notesSaveTimeout = null;
    const vals = getNotesFieldValues();
    void saveNotesWorkspace(vals.content, vals.bpm, vals.key);
  }
  if (structureSaveTimeout) {
    clearTimeout(structureSaveTimeout);
    structureSaveTimeout = null;
    const sections = activeProject.workspace.structure?.sections || [];
    void saveStructureWorkspace(sections);
  }

  ws.activeSongId = songId;
  ws.lyrics = song.lyrics;
  ws.notes = song.notes;
  ws.structure = song.structure;

  syncWorkspaceInputsFromProject(true);
  void saveSongsWorkspace();
}

function createNewSong(title: string, autoOpenStudio: boolean = false): void {
  if (!activeProject || !canUserEditProject()) return;
  const ws = activeProject.workspace || { songs: [] };
  if (!ws.songs || !Array.isArray(ws.songs)) {
    ws.songs = [];
  }
  const songs = ws.songs;
  const now = Date.now();

  if (songs.length === 0) {
    const initSong: ProjectSongItem = {
      id: 'song-1',
      title: activeProject.name ? activeProject.name : 'Song 1',
      order: 0,
      lyrics: ws.lyrics || { revision: 1, activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now }], content: '', updatedAt: now },
      notes: ws.notes || { revision: 1, content: '• ', bpm: '120 BPM', key: 'C Major', updatedAt: now },
      structure: ws.structure || { revision: 1, sections: [], updatedAt: now },
      createdAt: now,
      updatedAt: now
    };
    songs.push(initSong);
  }

  const newId = `song_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const cleanTitle = title.trim() || `Song ${songs.length + 1}`;

  const newSong: ProjectSongItem = {
    id: newId,
    title: cleanTitle,
    order: songs.length,
    lyrics: {
      revision: 1,
      activeDocumentId: 'doc-main',
      documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now }],
      content: '',
      updatedAt: now
    },
    notes: { revision: 1, content: '• ', bpm: '120 BPM', key: 'C Major', updatedAt: now },
    structure: { revision: 1, sections: [], updatedAt: now },
    createdAt: now,
    updatedAt: now
  };

  songs.push(newSong);
  ws.songs = songs;
  ws.activeSongId = newId;
  ws.lyrics = newSong.lyrics;
  ws.notes = newSong.notes;
  ws.structure = newSong.structure;

  syncWorkspaceInputsFromProject(true);
  void saveSongsWorkspace();
  renderProjectSongsSelector();
  renderProjectOverviewSongsList();

  if (autoOpenStudio) {
    openSongStudio(newId, 'lyrics');
  }
}

function duplicateSong(songId: string): void {
  if (!activeProject?.workspace?.songs) return;
  const ws = activeProject.workspace;
  const source = ws.songs.find((s) => s.id === songId);
  if (!source) return;

  const newId = `song_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();
  const copySong: ProjectSongItem = {
    id: newId,
    title: `${source.title} (Copy)`,
    order: ws.songs.length,
    lyrics: JSON.parse(JSON.stringify(source.lyrics)),
    notes: JSON.parse(JSON.stringify(source.notes)),
    structure: JSON.parse(JSON.stringify(source.structure)),
    createdAt: now,
    updatedAt: now
  };
  copySong.lyrics.revision = 1;
  copySong.notes.revision = 1;
  copySong.structure.revision = 1;

  ws.songs.push(copySong);
  ws.activeSongId = newId;
  ws.lyrics = copySong.lyrics;
  ws.notes = copySong.notes;
  ws.structure = copySong.structure;

  syncWorkspaceInputsFromProject(true);
  void saveSongsWorkspace();
}

function deleteSong(songId: string): void {
  if (!activeProject?.workspace?.songs) return;
  const ws = activeProject.workspace;
  if (ws.songs.length <= 1) return;

  const idx = ws.songs.findIndex((s) => s.id === songId);
  if (idx === -1) return;

  ws.songs.splice(idx, 1);
  if (ws.activeSongId === songId) {
    const nextSong = ws.songs[Math.max(0, idx - 1)] || ws.songs[0];
    ws.activeSongId = nextSong.id;
    ws.lyrics = nextSong.lyrics;
    ws.notes = nextSong.notes;
    ws.structure = nextSong.structure;
  }

  syncWorkspaceInputsFromProject(true);
  void saveSongsWorkspace();
}

function reorderSongs(sourceId: string, targetId: string): void {
  if (!activeProject?.workspace?.songs) return;
  const songs = activeProject.workspace.songs;
  const fromIdx = songs.findIndex((s) => s && s.id === sourceId);
  const toIdx = songs.findIndex((s) => s && s.id === targetId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

  const [moved] = songs.splice(fromIdx, 1);
  songs.splice(toIdx, 0, moved);
  songs.forEach((s, i) => { s.order = i; });

  renderProjectSongsSelector();
  void saveSongsWorkspace();
}

async function saveSongsWorkspace(): Promise<boolean> {
  if (!activeProject?.workspace) return false;
  const token = auth.getToken();
  if (!token) return false;
  const targetProjectId = activeProject.id;
  const payload: UpdateProjectWorkspaceRequest = {
    activeSongId: activeProject.workspace.activeSongId,
    songs: JSON.parse(JSON.stringify(activeProject.workspace.songs || []))
  };

  try {
    let res: UpdateProjectWorkspaceResponse | null = null;
    if (signaling.isConnected()) {
      try {
        res = await signaling.updateProjectWorkspace(targetProjectId, payload, token);
      } catch {
        res = null;
      }
    }
    if (!res || !res.ok) {
      const httpRes = await projectsApi.updateProjectWorkspace(token, targetProjectId, payload);
      res = { ok: true, project: httpRes.project, workspace: httpRes.workspace };
    }
    if (res?.project && activeProject && activeProject.id === res.project.id) {
      activeProject.workspace = res.project.workspace;
      activeProject.updatedAt = res.project.updatedAt;
    }
    return true;
  } catch (err) {
    console.error('Failed to save songs workspace:', err);
    return false;
  }
}

function getActiveLyricsDoc(): { id: string; title: string; content: string; updatedAt: number } {
  const activeSong = getActiveSong();
  const ws = activeSong.lyrics;
  if (!ws.documents || !Array.isArray(ws.documents) || ws.documents.length === 0) {
    ws.documents = [{ id: 'doc-main', title: 'Main Lyrics', content: ws.content || '', updatedAt: ws.updatedAt || Date.now() }];
    ws.activeDocumentId = 'doc-main';
  }

  const activeId = ws.activeDocumentId || ws.documents[0].id;
  const doc = ws.documents.find((d) => d && d.id === activeId) || ws.documents[0];
  ws.activeDocumentId = doc.id;
  return doc;
}

function renderLyricsDocTabs(): void {
  const activeDoc = getActiveLyricsDoc();
  
  // Set current document title in sheet header input if present
  const titleInput = $<HTMLInputElement>('lyrics-current-doc-title');
  if (titleInput && document.activeElement !== titleInput) {
    titleInput.value = activeDoc.title || '';
  }
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
  lyricsEditGen++;
  setLyricsStatus('saving');

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
      sheetsHtml += `<div class="lyrics-page-sheet" data-page="${i}"></div>`;
    }
    pagesBg.innerHTML = sheetsHtml;
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
  setText('session-lyrics-stats-text', `${words} ${words === 1 ? 'Word' : 'Words'} · ${lines} ${lines === 1 ? 'Line' : 'Lines'}`);
  setText('lyrics-footer-char-count', `${chars} ${chars === 1 ? 'character' : 'characters'} · US Letter`);
  setText('lyrics-footer-read-time', singTimeStr);
}

function setLyricsStatus(status: 'saving' | 'saved' | 'unsaved'): void {
  currentLyricsStatus = status;
  const badges = [$('project-lyrics-status'), $('session-workspace-status'), $('session-workspace-status-badge')];
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed';
  badges.forEach((b) => {
    if (!b) return;
    b.className = `workspace-status-badge ${status}`;
    b.innerHTML = `<span class="status-dot"></span> <span id="session-workspace-status-text">${label}</span>`;
  });
  if (status === 'saved') {
    setText('lyrics-footer-last-saved', `Saved to cloud at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
  } else if (status === 'unsaved') {
    setText('lyrics-footer-last-saved', 'Save failed · Unsaved changes');
  }
}

function setNotesStatus(status: 'saving' | 'saved' | 'unsaved'): void {
  currentNotesStatus = status;
  const badges = [$('project-notes-status'), $('session-workspace-status'), $('session-workspace-status-badge')];
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed';
  badges.forEach((b) => {
    if (!b) return;
    b.className = `workspace-status-badge ${status}`;
    b.innerHTML = `<span class="status-dot"></span> <span id="session-workspace-status-text">${label}</span>`;
  });
}

function applyAuthoritativeWorkspaceUpdate(
  savedArea: 'lyrics' | 'notes' | 'structure' | 'tasks',
  serverWorkspace: any
): void {
  if (!activeProject || !serverWorkspace) return;
  if (!activeProject.workspace) {
    activeProject.workspace = {
      activeSongId: 'song-1',
      songs: [],
      lyrics: { revision: 1, activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: Date.now() }], content: '', updatedAt: Date.now() },
      notes: { revision: 1, content: '', updatedAt: Date.now() },
      structure: { revision: 1, sections: [], updatedAt: Date.now() },
      tasks: { revision: 1, tasks: [], updatedAt: Date.now() }
    };
  }

  const activeSong = getActiveSong();

  // Only apply authoritative state to the specific saved area
  if (savedArea === 'lyrics' && serverWorkspace.lyrics) {
    activeProject.workspace.lyrics = serverWorkspace.lyrics;
    activeSong.lyrics = serverWorkspace.lyrics;
    activeSong.updatedAt = Date.now();
  } else if (savedArea === 'notes' && serverWorkspace.notes) {
    activeProject.workspace.notes = serverWorkspace.notes;
    activeSong.notes = serverWorkspace.notes;
    activeSong.updatedAt = Date.now();
  } else if (savedArea === 'structure' && serverWorkspace.structure) {
    activeProject.workspace.structure = serverWorkspace.structure;
    activeSong.structure = serverWorkspace.structure;
    activeSong.updatedAt = Date.now();
  } else if (savedArea === 'tasks' && serverWorkspace.tasks) {
    activeProject.workspace.tasks = serverWorkspace.tasks;
  }

  if (serverWorkspace.songs && Array.isArray(serverWorkspace.songs)) {
    activeProject.workspace.songs = serverWorkspace.songs;
    if (serverWorkspace.activeSongId) {
      activeProject.workspace.activeSongId = serverWorkspace.activeSongId;
    }
    renderProjectSongsSelector();
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
  const activeSong = getActiveSong();
  renderProjectSongsSelector();

  const ws = activeProject.workspace || {
    lyrics: { activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: 0 }], content: '', updatedAt: 0 },
    notes: { content: '', updatedAt: 0 }
  };

  renderLyricsDocTabs();
  const activeDoc = getActiveLyricsDoc();
  const lyricsHtml = activeDoc.content || '';
  const notesContent = activeSong.notes?.content || '';
  const notesBpm = activeSong.notes?.bpm || '';
  const notesKey = activeSong.notes?.key || '';

  if (force) {
    lastSyncedLyrics = lyricsHtml;
    lastSyncedNotes = notesContent;
    lastSyncedNotesBpm = notesBpm;
    lastSyncedNotesKey = notesKey;
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
  renderProjectActivities(activeProject ?? null, auth.getUser());

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

  // Enforce read-only UI restrictions if user is viewer
  applyWorkspacePermissions();
}

function handleLyricsEditorInput(source: 'project' | 'session'): void {
  if (!activeProject || !canUserEditProject()) return;
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

  lyricsEditGen++;
  updateLyricsStatsFromHtml(newHtml);
  setLyricsStatus('saving');

  if (lyricsSaveTimeout) clearTimeout(lyricsSaveTimeout);
  lyricsSaveTimeout = setTimeout(() => {
    lyricsSaveTimeout = null;
    void saveLyricsWorkspace(newHtml, activeDoc.id, activeDoc.title);
  }, 350);
}

async function saveLyricsWorkspace(content: string, documentId?: string, title?: string): Promise<void> {
  if (!activeProject || !canUserEditProject()) return;
  const token = auth.getToken();
  if (!token) {
    setLyricsStatus('unsaved');
    return;
  }
  const activeSong = getActiveSong();
  const targetProjectId = activeProject.id;
  const targetContextGen = currentWorkspaceContextGen;
  const targetEditGen = lyricsEditGen;
  const targetSaveGen = ++lyricsSaveGen;
  const baseRevision = activeSong.lyrics?.revision ?? 1;

  try {
    const activeDoc = getActiveLyricsDoc();
    const docId = documentId || activeDoc.id;
    const docTitle = title || activeDoc.title;

    activeDoc.content = content;
    activeDoc.title = docTitle;
    activeDoc.updatedAt = Date.now();
    if (activeSong.lyrics) {
      activeSong.lyrics.content = content;
      activeSong.lyrics.updatedAt = Date.now();
    }
    if (activeProject.workspace?.lyrics) {
      activeProject.workspace.lyrics.content = content;
    }

    const payload: UpdateProjectWorkspaceRequest = {
      activeSongId: activeSong.id,
      songId: activeSong.id,
      songs: activeProject.workspace?.songs,
      lyrics: {
        baseRevision,
        activeDocumentId: activeSong.lyrics?.activeDocumentId,
        documents: activeSong.lyrics?.documents,
        content,
        documentId: docId,
        title: docTitle
      }
    };

    let res = await signaling.updateProjectWorkspace(targetProjectId, payload, token);
    if (!res?.ok && !res?.conflict && res?.code !== 'WORKSPACE_CONFLICT') {
      try {
        const httpRes = await projectsApi.updateProjectWorkspace(token, targetProjectId, payload);
        if (httpRes?.workspace) {
          res = { ok: true, workspace: httpRes.workspace, project: httpRes.project };
        }
      } catch (httpErr: any) {
        console.warn('HTTP workspace update fallback failed:', httpErr);
      }
    }
    const isLatest = (activeProject?.id === targetProjectId) &&
      (targetContextGen === currentWorkspaceContextGen) &&
      (targetSaveGen === lyricsSaveGen) &&
      (targetEditGen === lyricsEditGen);
    if (res?.ok && res.workspace && activeProject) {
      applyAuthoritativeWorkspaceUpdate('lyrics', res.workspace);
      if (res.project?.activities) {
        activeProject.activities = res.project.activities;
        renderProjectActivities(activeProject, auth.getUser());
      }
      const syncedDoc = getActiveLyricsDoc();
      lastSyncedLyrics = syncedDoc.content ?? content;
      setLyricsStatus('saved');
    } else if (res?.conflict || res?.code === 'WORKSPACE_CONFLICT') {
      // Confirmed WORKSPACE_CONFLICT: preserve local edits exactly, keep unsaved, do not overwrite local content
      setLyricsStatus('unsaved');
    } else {
      setLyricsStatus('unsaved');
    }
  } catch (err) {
    console.error('Failed to save lyrics document:', err);
    const isLatest = (activeProject?.id === targetProjectId) &&
      (targetContextGen === currentWorkspaceContextGen) &&
      (targetSaveGen === lyricsSaveGen) &&
      (targetEditGen === lyricsEditGen);
    if (isLatest) {
      setLyricsStatus('unsaved');
    }
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

$('select-doc-zoom')?.addEventListener('change', (e) => {
  const zoomVal = parseInt((e.target as HTMLSelectElement).value, 10) || 100;
  const scale = zoomVal / 100;
  const canvas = $('lyrics-document-canvas');
  const wrapper = $('lyrics-canvas-wrapper');
  if (canvas && wrapper) {
    if (scale === 1) {
      canvas.style.transform = '';
      wrapper.style.width = '';
      wrapper.style.height = '';
      wrapper.style.minWidth = '';
      wrapper.style.minHeight = '';
    } else {
      canvas.style.transform = `scale(${scale})`;
      const baseW = 816;
      const baseH = canvas.offsetHeight || 1056;
      const scaledW = Math.round(baseW * scale);
      const scaledH = Math.round(baseH * scale);
      wrapper.style.width = `${scaledW}px`;
      wrapper.style.height = `${scaledH}px`;
      wrapper.style.minWidth = `${scaledW}px`;
      wrapper.style.minHeight = `${scaledH}px`;
    }
  }
});

$('select-session-doc-zoom')?.addEventListener('change', (e) => {
  const zoomVal = parseInt((e.target as HTMLSelectElement).value, 10) || 100;
  const scale = zoomVal / 100;
  const canvas = document.querySelector<HTMLElement>('#session-lyrics-viewport .drawer-lyrics-document-canvas');
  const wrapper = document.querySelector<HTMLElement>('#session-lyrics-viewport .drawer-lyrics-canvas-wrapper');
  if (canvas && wrapper) {
    if (scale === 1) {
      canvas.style.transform = '';
      wrapper.style.width = '';
      wrapper.style.height = '';
      wrapper.style.minWidth = '';
      wrapper.style.minHeight = '';
    } else {
      canvas.style.transform = `scale(${scale})`;
      const baseW = 816;
      const baseH = canvas.offsetHeight || 1056;
      const scaledW = Math.round(baseW * scale);
      const scaledH = Math.round(baseH * scale);
      wrapper.style.width = `${scaledW}px`;
      wrapper.style.height = `${scaledH}px`;
      wrapper.style.minWidth = `${scaledW}px`;
      wrapper.style.minHeight = `${scaledH}px`;
    }
  }
});

$('select-doc-heading')?.addEventListener('change', (e) => {
  const val = (e.target as HTMLSelectElement).value;
  execDocFormat('formatBlock', `<${val}>`);
});

$('select-doc-font')?.addEventListener('change', (e) => {
  const font = (e.target as HTMLSelectElement).value;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    execDocFormat('fontName', font);
  } else {
    const projectEditor = $('project-lyrics-editor');
    if (projectEditor) projectEditor.style.fontFamily = font;
    const sessionEditor = $('session-lyrics-editor');
    if (sessionEditor) sessionEditor.style.fontFamily = font;
  }
  updateLyricsDocumentPagination();
});

$('select-session-doc-font')?.addEventListener('change', (e) => {
  const font = (e.target as HTMLSelectElement).value;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    execDocFormat('fontName', font);
  } else {
    const projectEditor = $('project-lyrics-editor');
    if (projectEditor) projectEditor.style.fontFamily = font;
    const sessionEditor = $('session-lyrics-editor');
    if (sessionEditor) sessionEditor.style.fontFamily = font;
  }
  handleLyricsEditorInput('session');
});

$('select-doc-fontsize')?.addEventListener('change', (e) => {
  const size = (e.target as HTMLSelectElement).value;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    const range = sel.getRangeAt(0);
    const span = document.createElement('span');
    span.style.fontSize = size;
    span.appendChild(range.extractContents());
    range.insertNode(span);
    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    sel.addRange(newRange);
  } else {
    const projectEditor = $('project-lyrics-editor');
    if (projectEditor) projectEditor.style.fontSize = size;
    const sessionEditor = $('session-lyrics-editor');
    if (sessionEditor) sessionEditor.style.fontSize = size;
  }
  updateLyricsDocumentPagination();
});

$('select-session-doc-fontsize')?.addEventListener('change', (e) => {
  const size = (e.target as HTMLSelectElement).value;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    const range = sel.getRangeAt(0);
    const span = document.createElement('span');
    span.style.fontSize = size;
    span.appendChild(range.extractContents());
    range.insertNode(span);
    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    sel.addRange(newRange);
  } else {
    const projectEditor = $('project-lyrics-editor');
    if (projectEditor) projectEditor.style.fontSize = size;
    const sessionEditor = $('session-lyrics-editor');
    if (sessionEditor) sessionEditor.style.fontSize = size;
  }
  handleLyricsEditorInput('session');
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

$('doc-custom-text-color')?.addEventListener('input', (e) => {
  const color = (e.target as HTMLInputElement).value;
  if (color) {
    execDocFormat('foreColor', color);
    const bar = $('current-text-color-bar');
    if (bar) bar.style.background = color;
  }
});

$('doc-custom-hilite-color')?.addEventListener('input', (e) => {
  const color = (e.target as HTMLInputElement).value;
  if (color) {
    execDocFormat('hiliteColor', color);
    const bar = $('current-hilite-color-bar');
    if (bar) bar.style.background = color;
  }
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
    $('btn-session-doc-strike')?.classList.toggle('active', document.queryCommandState('strikethrough'));
    $('btn-session-doc-align-left')?.classList.toggle('active', document.queryCommandState('justifyLeft'));
    $('btn-session-doc-align-center')?.classList.toggle('active', document.queryCommandState('justifyCenter'));
    $('btn-session-doc-align-right')?.classList.toggle('active', document.queryCommandState('justifyRight'));
  } catch {
    // ignore
  }
}

$('btn-session-doc-undo')?.addEventListener('click', () => {
  execDocFormat('undo');
  updateSessionDocFormattingState();
});
$('btn-session-doc-redo')?.addEventListener('click', () => {
  execDocFormat('redo');
  updateSessionDocFormattingState();
});
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
$('btn-session-doc-strike')?.addEventListener('click', () => {
  execDocFormat('strikethrough');
  updateSessionDocFormattingState();
});
$('btn-session-doc-align-left')?.addEventListener('click', () => {
  execDocFormat('justifyLeft');
  updateSessionDocFormattingState();
});
$('btn-session-doc-align-center')?.addEventListener('click', () => {
  execDocFormat('justifyCenter');
  updateSessionDocFormattingState();
});
$('btn-session-doc-align-right')?.addEventListener('click', () => {
  execDocFormat('justifyRight');
  updateSessionDocFormattingState();
});
$('select-session-doc-heading')?.addEventListener('change', (e) => {
  const val = (e.target as HTMLSelectElement).value;
  if (['h1', 'h2', 'h3', 'p'].includes(val)) {
    execDocFormat('formatBlock', `<${val}>`);
  } else if (['verse', 'chorus', 'bridge'].includes(val)) {
    const label = val === 'verse' ? 'Verse' : val === 'chorus' ? 'Chorus' : 'Bridge';
    insertSongSectionTag(label);
  }
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
  lyricsEditGen++;
  setLyricsStatus('saving');
  if (lyricsSaveTimeout) clearTimeout(lyricsSaveTimeout);
  lyricsSaveTimeout = setTimeout(() => {
    lyricsSaveTimeout = null;
    void saveLyricsWorkspace(activeDoc.content, activeDoc.id, newTitle);
  }, 400);
});

// Document Options Popover Menu
$('btn-doc-options-menu')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const pop = $('lyrics-doc-options-popover');
  if (!pop) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  pop.style.top = `${rect.bottom + 6}px`;
  pop.style.right = `${window.innerWidth - rect.right}px`;
  pop.style.left = 'auto';
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
  if (!activeProject || !canUserEditProject()) return;
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

  notesEditGen++;
  setNotesStatus('saving');
  if (notesSaveTimeout) clearTimeout(notesSaveTimeout);
  notesSaveTimeout = setTimeout(() => {
    notesSaveTimeout = null;
    void saveNotesWorkspace(content, bpm, key);
  }, 350);
}

async function saveNotesWorkspace(content: string, bpm: string, key: string): Promise<void> {
  if (!activeProject || !canUserEditProject()) return;
  const token = auth.getToken();
  if (!token) {
    setNotesStatus('unsaved');
    return;
  }
  const activeSong = getActiveSong();
  const targetProjectId = activeProject.id;
  const targetContextGen = currentWorkspaceContextGen;
  const targetEditGen = notesEditGen;
  const targetSaveGen = ++notesSaveGen;
  const baseRevision = activeSong.notes?.revision ?? 1;

  if (activeSong.notes) {
    activeSong.notes.content = content;
    activeSong.notes.bpm = bpm;
    activeSong.notes.key = key;
    activeSong.updatedAt = Date.now();
  }
  if (activeProject.workspace?.notes) {
    activeProject.workspace.notes.content = content;
    activeProject.workspace.notes.bpm = bpm;
    activeProject.workspace.notes.key = key;
  }

  const payload: UpdateProjectWorkspaceRequest = {
    activeSongId: activeSong.id,
    songId: activeSong.id,
    songs: activeProject.workspace?.songs,
    notes: { baseRevision, content, bpm, key }
  };

  try {
    let res = await signaling.updateProjectWorkspace(targetProjectId, payload, token);
    if (!res?.ok && !res?.conflict && res?.code !== 'WORKSPACE_CONFLICT') {
      try {
        const httpRes = await projectsApi.updateProjectWorkspace(token, targetProjectId, payload);
        if (httpRes?.workspace) {
          res = { ok: true, workspace: httpRes.workspace, project: httpRes.project };
        }
      } catch (httpErr: any) {
        console.warn('HTTP workspace update fallback failed for notes:', httpErr);
      }
    }
    const isLatest = (activeProject?.id === targetProjectId) &&
      (targetContextGen === currentWorkspaceContextGen) &&
      (targetSaveGen === notesSaveGen) &&
      (targetEditGen === notesEditGen);
    if (!isLatest) return;

    if (res?.ok && res.workspace && activeProject) {
      applyAuthoritativeWorkspaceUpdate('notes', res.workspace);
      if (res.project?.activities) {
        activeProject.activities = res.project.activities;
        renderProjectActivities(activeProject, auth.getUser());
      }
      lastSyncedNotes = res.workspace.notes?.content ?? content;
      lastSyncedNotesBpm = res.workspace.notes?.bpm ?? bpm;
      lastSyncedNotesKey = res.workspace.notes?.key ?? key;
      setNotesStatus('saved');
    } else if ((res?.conflict || res?.code === 'WORKSPACE_CONFLICT') && res.workspace?.notes && activeProject) {
      // Confirmed WORKSPACE_CONFLICT on Notes: safely reconcile content, BPM, and Key against authoritative server state
      const baseNotes: NotesStateValues = {
        content: lastSyncedNotes,
        bpm: lastSyncedNotesBpm,
        key: lastSyncedNotesKey
      };
      const localNotes: NotesStateValues = {
        content: activeProject.workspace?.notes?.content ?? content,
        bpm: activeProject.workspace?.notes?.bpm ?? bpm,
        key: activeProject.workspace?.notes?.key ?? key
      };
      const remoteNotes: NotesStateValues = {
        content: res.workspace.notes.content ?? '',
        bpm: res.workspace.notes.bpm ?? '',
        key: res.workspace.notes.key ?? ''
      };

      const reconciliation = reconcileNotesWorkspace(baseNotes, localNotes, remoteNotes);

      // If both sides changed the same BPM or Key field differently, preserve unresolved local work
      // and leave Notes unsaved without automatically overwriting persisted collaborator data.
      if (reconciliation.hasUnresolvableConflict) {
        if (activeProject.workspace?.notes) {
          activeProject.workspace.notes.content = reconciliation.content;
        }
        const projectNotesInput = $<HTMLTextAreaElement>('project-notes-input');
        const sessionNotesInput = $<HTMLTextAreaElement>('session-notes-input');
        if (projectNotesInput) applyTextareaUpdatePreservingCursor(projectNotesInput, reconciliation.content);
        if (sessionNotesInput) applyTextareaUpdatePreservingCursor(sessionNotesInput, reconciliation.content);
        setNotesStatus('unsaved');
        return;
      }

      // Safe reconciliation: update UI controls for remote updates
      const projectNotesInput = $<HTMLTextAreaElement>('project-notes-input');
      const sessionNotesInput = $<HTMLTextAreaElement>('session-notes-input');
      if (projectNotesInput) applyTextareaUpdatePreservingCursor(projectNotesInput, reconciliation.content);
      if (sessionNotesInput) applyTextareaUpdatePreservingCursor(sessionNotesInput, reconciliation.content);

      if (reconciliation.bpmChangedRemotely) {
        const projectBpm = $<HTMLInputElement>('project-notes-bpm');
        const sessionBpm = $<HTMLInputElement>('session-notes-bpm');
        if (projectBpm && document.activeElement !== projectBpm) projectBpm.value = reconciliation.bpm;
        if (sessionBpm && document.activeElement !== sessionBpm) sessionBpm.value = reconciliation.bpm;
      }

      if (reconciliation.keyChangedRemotely) {
        applyKeyToControls(reconciliation.key, false);
      }

      // Update authoritative baseline tracking and activeProject state
      lastSyncedNotes = remoteNotes.content || '';
      lastSyncedNotesBpm = remoteNotes.bpm || '';
      lastSyncedNotesKey = remoteNotes.key || '';

      const nextRevision = res.workspace.notes.revision ?? (res.currentRevision ?? activeProject.workspace?.notes?.revision ?? 1);
      if (activeProject.workspace?.notes) {
        activeProject.workspace.notes.content = reconciliation.content;
        activeProject.workspace.notes.bpm = reconciliation.bpm;
        activeProject.workspace.notes.key = reconciliation.key;
        activeProject.workspace.notes.revision = nextRevision;
      }

      setNotesStatus('saving');
      if (notesSaveTimeout) clearTimeout(notesSaveTimeout);
      notesSaveTimeout = setTimeout(() => {
        notesSaveTimeout = null;
        void saveNotesWorkspace(reconciliation.content, reconciliation.bpm, reconciliation.key);
      }, 350);
    } else {
      setNotesStatus('unsaved');
    }
  } catch (err) {
    console.error('Failed to save notes:', err);
    const isLatest = (activeProject?.id === targetProjectId) &&
      (targetContextGen === currentWorkspaceContextGen) &&
      (targetSaveGen === notesSaveGen) &&
      (targetEditGen === notesEditGen);
    if (isLatest) {
      setNotesStatus('unsaved');
    }
  }
}

// Automatic Bullet Points Management for Project Notes
function setupBulletPointBehavior(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) return;

  const enforceBulletsOnAllLines = () => {
    const val = textarea.value;
    if (!val || !val.trim()) {
      textarea.value = '• ';
      textarea.selectionStart = textarea.selectionEnd = 2;
      return;
    }
    const lines = val.split('\n');
    let modified = false;
    const fixedLines = lines.map((line) => {
      if (line.startsWith('• ')) return line;
      modified = true;
      if (line.startsWith('•')) return '• ' + line.slice(1).trimStart();
      return '• ' + line;
    });
    if (modified) {
      const pos = textarea.selectionStart;
      textarea.value = fixedLines.join('\n');
      textarea.selectionStart = textarea.selectionEnd = Math.max(2, pos);
    }
  };

  textarea.addEventListener('keydown', (e) => {
    const val = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    // 1. Enter: Always creates a new permanent bullet line
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const insertText = '\n• ';
      const newVal = val.substring(0, start) + insertText + val.substring(end);
      textarea.value = newVal;
      const newPos = start + insertText.length;
      textarea.selectionStart = textarea.selectionEnd = newPos;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    // 2. Backspace: Protect the bullet point from deletion
    if (e.key === 'Backspace') {
      if (start === end) {
        const lastNewline = val.lastIndexOf('\n', start - 1);
        const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;
        const offsetInLine = start - lineStart;

        // If cursor is at or before the bullet prefix (offset <= 2)
        if (offsetInLine <= 2) {
          e.preventDefault();
          if (lineStart === 0) {
            // First line: Cannot delete bullet
            return;
          }
          // Line 2+: Remove current empty line or join with previous line
          const lineEnd = val.indexOf('\n', start);
          const nextStart = lineEnd === -1 ? val.length : lineEnd;
          const currentLineContent = val.substring(lineStart + 2, nextStart);
          const prevLineEnd = lineStart - 1; // position of '\n'

          const newVal = val.substring(0, prevLineEnd) + (currentLineContent ? (' ' + currentLineContent) : '') + val.substring(nextStart);
          textarea.value = newVal;
          textarea.selectionStart = textarea.selectionEnd = prevLineEnd;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }
      }
    }

    // 3. Home key: jump after the bullet glyph
    if (e.key === 'Home') {
      const lastNewline = val.lastIndexOf('\n', start - 1);
      const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;
      e.preventDefault();
      textarea.selectionStart = textarea.selectionEnd = lineStart + 2;
      return;
    }
  });

  textarea.addEventListener('focus', enforceBulletsOnAllLines);
  textarea.addEventListener('click', () => {
    if (!textarea.value.trim()) {
      enforceBulletsOnAllLines();
    } else {
      const start = textarea.selectionStart;
      const lastNewline = textarea.value.lastIndexOf('\n', start - 1);
      const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;
      if (start < lineStart + 2) {
        textarea.selectionStart = textarea.selectionEnd = lineStart + 2;
      }
    }
  });

  textarea.addEventListener('input', enforceBulletsOnAllLines);
}

const projectNotesArea = $<HTMLTextAreaElement>('project-notes-input');
const sessionNotesArea = $<HTMLTextAreaElement>('session-notes-input');
setupBulletPointBehavior(projectNotesArea);
setupBulletPointBehavior(sessionNotesArea);

// Attach Input Listeners for Notes
projectNotesArea?.addEventListener('input', () => handleNotesInput());
sessionNotesArea?.addEventListener('input', () => handleNotesInput());
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
  const activeSong = getActiveSong();
  if (!activeSong.structure) {
    activeSong.structure = { revision: 1, sections: [], updatedAt: Date.now() };
  }
  if (!Array.isArray(activeSong.structure.sections)) {
    activeSong.structure.sections = [];
  }
  if (activeProject.workspace) {
    activeProject.workspace.structure = activeSong.structure;
  }
  return activeSong.structure.sections;
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

    const totalBars = sections.reduce((sum, s) => sum + (Number(s.bars) || 8), 0) || 1;

    sections.forEach((sec) => {
      const block = document.createElement('div');
      block.className = `timeline-block type-${sec.type || 'verse'}`;
      block.dataset.sectionId = sec.id;
      
      const bars = Number(sec.bars) || 8;
      const barPercent = ((bars / totalBars) * 100).toFixed(2);
      block.style.flex = `${bars} ${bars} 0%`;
      block.style.width = `${barPercent}%`;
      block.style.minWidth = '48px';
      block.style.boxSizing = 'border-box';

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
            <button type="button" class="btn-card-action btn-dup" title="Duplicate"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>
            <button type="button" class="btn-card-action btn-del" title="Delete Section"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg></button>
          </div>
        `;
      }

      const canEdit = canUserEditProject();
      if (!canEdit) {
        card.removeAttribute('draggable');
        card.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((el) => {
          el.disabled = true;
          if (el instanceof HTMLInputElement) el.readOnly = true;
        });
        card.querySelectorAll<HTMLElement>('.btn-dup, .btn-del, .drag-handle').forEach((el) => {
          el.style.display = 'none';
        });
      }

      // Drag and Drop Event Listeners
      card.addEventListener('dragstart', (e) => {
        if (!canUserEditProject()) {
          e.preventDefault();
          return;
        }
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
        
        const totalBars = sections.reduce((sum, s) => sum + (Number(s.bars) || 8), 0) || 1;
        setText('structure-summary-bars', `${totalBars} Total Bars`);
        setText('session-structure-summary', `${sections.length} ${sections.length === 1 ? 'Section' : 'Sections'} · ${totalBars} Bars`);

        // Update all timeline blocks proportionally
        sections.forEach((s) => {
          const sBars = Number(s.bars) || 8;
          const sPercent = ((sBars / totalBars) * 100).toFixed(2);
          findTimelineBlocks(s.id).forEach((block) => {
            const blockBars = block.querySelector('.timeline-block-bars');
            if (blockBars) blockBars.textContent = `${sBars} Bars`;
            block.style.flex = `${sBars} ${sBars} 0%`;
            block.style.width = `${sPercent}%`;
            block.style.minWidth = '48px';
          });
        });

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
  if (!canUserEditProject()) return;
  structureEditGen++;
  setStructureStatus('saving');
  if (structureSaveTimeout) clearTimeout(structureSaveTimeout);
  structureSaveTimeout = setTimeout(() => {
    structureSaveTimeout = null;
    void saveStructureWorkspace();
  }, 350);
}

async function saveStructureWorkspace(): Promise<void> {
  if (!activeProject || !canUserEditProject()) return;
  const token = auth.getToken();
  if (!token) {
    setStructureStatus('unsaved');
    return;
  }
  const activeSong = getActiveSong();
  const targetProjectId = activeProject.id;
  const targetContextGen = currentWorkspaceContextGen;
  const targetEditGen = structureEditGen;
  const targetSaveGen = ++structureSaveGen;
  const baseRevision = activeSong.structure?.revision ?? 1;

  try {
    const sections = getStructureSections();
    if (activeSong.structure) {
      activeSong.structure.sections = sections;
      activeSong.updatedAt = Date.now();
    }
    if (activeProject.workspace?.structure) {
      activeProject.workspace.structure.sections = sections;
    }

    const payload: UpdateProjectWorkspaceRequest = {
      activeSongId: activeSong.id,
      songId: activeSong.id,
      songs: activeProject.workspace?.songs,
      structure: { baseRevision, sections }
    };

    let res = await signaling.updateProjectWorkspace(targetProjectId, payload, token);
    if (!res?.ok && !res?.conflict && res?.code !== 'WORKSPACE_CONFLICT') {
      try {
        const httpRes = await projectsApi.updateProjectWorkspace(token, targetProjectId, payload);
        if (httpRes?.workspace) {
          res = { ok: true, workspace: httpRes.workspace, project: httpRes.project };
        }
      } catch (httpErr: any) {
        console.warn('HTTP workspace update fallback failed for structure:', httpErr);
      }
    }
    const isLatest = (activeProject?.id === targetProjectId) &&
      (targetContextGen === currentWorkspaceContextGen) &&
      (targetSaveGen === structureSaveGen) &&
      (targetEditGen === structureEditGen);
    if (!isLatest) return;

    if (res?.ok && res.workspace && activeProject) {
      applyAuthoritativeWorkspaceUpdate('structure', res.workspace);
      if (res.project?.activities) {
        activeProject.activities = res.project.activities;
        renderProjectActivities(activeProject);
      }
      setStructureStatus('saved');
    } else if (res?.conflict || res?.code === 'WORKSPACE_CONFLICT') {
      // Confirmed WORKSPACE_CONFLICT: preserve local edits exactly, keep unsaved, do not overwrite local content
      setStructureStatus('unsaved');
    } else {
      setStructureStatus('unsaved');
    }
  } catch (err) {
    console.error('Failed to save structure workspace:', err);
    const isLatest = (activeProject?.id === targetProjectId) &&
      (targetContextGen === currentWorkspaceContextGen) &&
      (targetSaveGen === structureSaveGen) &&
      (targetEditGen === structureEditGen);
    if (isLatest) {
      setStructureStatus('unsaved');
    }
  }
}

function addStructureSection(type: string): void {
  if (!canUserEditProject()) return;
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
  if (!canUserEditProject()) return;
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
  if (!canUserEditProject()) return;
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
  if (!canUserEditProject()) return;
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
signaling.on('project:workspace:synced', (data: { projectId: string; workspace: any; activities?: any[]; updatedBy?: string; updatedByName?: string }) => {
  if (!data?.workspace) return;
  const matchesCurrent = activeProject?.id === data.projectId || sessionProjectId === data.projectId;
  if (!matchesCurrent) return;

  if (data.activities && activeProject) {
    activeProject.activities = data.activities;
    renderProjectActivities(activeProject, auth.getUser());
  }

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
  const incomingNotesContent = data.workspace.notes?.content ?? '';
  const incomingNotesBpm = data.workspace.notes?.bpm ?? '';
  const incomingNotesKey = data.workspace.notes?.key ?? '';

  const currentLocalContent = activeProject?.workspace?.notes?.content ?? '';
  const currentLocalBpm = activeProject?.workspace?.notes?.bpm ?? '';
  const currentLocalKey = activeProject?.workspace?.notes?.key ?? '';

  const hasPendingNotes =
    notesSaveTimeout !== null ||
    currentNotesStatus === 'saving' ||
    currentNotesStatus === 'unsaved' ||
    currentLocalContent !== lastSyncedNotes ||
    currentLocalBpm !== lastSyncedNotesBpm ||
    currentLocalKey !== lastSyncedNotesKey;

  if (hasPendingNotes) {
    const baseNotes: NotesStateValues = {
      content: lastSyncedNotes,
      bpm: lastSyncedNotesBpm,
      key: lastSyncedNotesKey
    };
    const localNotes: NotesStateValues = {
      content: currentLocalContent,
      bpm: currentLocalBpm,
      key: currentLocalKey
    };
    const remoteNotes: NotesStateValues = {
      content: incomingNotesContent,
      bpm: incomingNotesBpm,
      key: incomingNotesKey
    };

    const reconciliation = reconcileNotesWorkspace(baseNotes, localNotes, remoteNotes);

    if (reconciliation.hasUnresolvableConflict) {
      if (activeProject.workspace?.notes) {
        activeProject.workspace.notes.content = reconciliation.content;
      }
      const projectNotesInput = $<HTMLTextAreaElement>('project-notes-input');
      const sessionNotesInput = $<HTMLTextAreaElement>('session-notes-input');
      if (projectNotesInput) applyTextareaUpdatePreservingCursor(projectNotesInput, reconciliation.content);
      if (sessionNotesInput) applyTextareaUpdatePreservingCursor(sessionNotesInput, reconciliation.content);
      setNotesStatus('unsaved');
    } else {
      const projectNotesInput = $<HTMLTextAreaElement>('project-notes-input');
      const sessionNotesInput = $<HTMLTextAreaElement>('session-notes-input');
      if (projectNotesInput) applyTextareaUpdatePreservingCursor(projectNotesInput, reconciliation.content);
      if (sessionNotesInput) applyTextareaUpdatePreservingCursor(sessionNotesInput, reconciliation.content);

      if (reconciliation.bpmChangedRemotely) {
        const projectBpm = $<HTMLInputElement>('project-notes-bpm');
        const sessionBpm = $<HTMLInputElement>('session-notes-bpm');
        if (projectBpm && document.activeElement !== projectBpm) projectBpm.value = reconciliation.bpm;
        if (sessionBpm && document.activeElement !== sessionBpm) sessionBpm.value = reconciliation.bpm;
      }

      if (reconciliation.keyChangedRemotely) {
        applyKeyToControls(reconciliation.key, false);
      }

      lastSyncedNotes = incomingNotesContent;
      lastSyncedNotesBpm = incomingNotesBpm;
      lastSyncedNotesKey = incomingNotesKey;

      if (activeProject.workspace?.notes) {
        activeProject.workspace.notes.content = reconciliation.content;
        activeProject.workspace.notes.bpm = reconciliation.bpm;
        activeProject.workspace.notes.key = reconciliation.key;
        if (data.workspace.notes?.revision !== undefined) {
          activeProject.workspace.notes.revision = data.workspace.notes.revision;
        }
      }

      const hasLocalRemainingChanges =
        reconciliation.content !== incomingNotesContent ||
        reconciliation.bpm !== incomingNotesBpm ||
        reconciliation.key !== incomingNotesKey;

      if (hasLocalRemainingChanges) {
        if (notesSaveTimeout) clearTimeout(notesSaveTimeout);
        setNotesStatus('saving');
        notesSaveTimeout = setTimeout(() => {
          notesSaveTimeout = null;
          void saveNotesWorkspace(reconciliation.content, reconciliation.bpm, reconciliation.key);
        }, 350);
      } else {
        setNotesStatus('saved');
      }
    }
  } else {
    if (data.workspace.notes) {
      if (activeProject.workspace?.notes) {
        activeProject.workspace.notes = data.workspace.notes;
      }
      lastSyncedNotes = incomingNotesContent;
      lastSyncedNotesBpm = incomingNotesBpm;
      lastSyncedNotesKey = incomingNotesKey;

      const projectNotesInput = $<HTMLTextAreaElement>('project-notes-input');
      const sessionNotesInput = $<HTMLTextAreaElement>('session-notes-input');
      if (projectNotesInput) applyTextareaUpdatePreservingCursor(projectNotesInput, incomingNotesContent);
      if (sessionNotesInput) applyTextareaUpdatePreservingCursor(sessionNotesInput, incomingNotesContent);

      const projectBpm = $<HTMLInputElement>('project-notes-bpm');
      const sessionBpm = $<HTMLInputElement>('session-notes-bpm');
      const incomingBpm = data.workspace.notes?.bpm ?? '';
      const incomingKey = data.workspace.notes?.key ?? '';

      if (projectBpm && document.activeElement !== projectBpm) projectBpm.value = incomingBpm;
      if (sessionBpm && document.activeElement !== sessionBpm) sessionBpm.value = incomingBpm;

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
        revision: data.workspace.tasks.revision || 1,
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
    renderProjectActivities(activeProject ?? null, auth.getUser());
  }
});

signaling.on('project:activity:new', (data: { projectId: string; activities: ProjectActivityItem[] }) => {
  if (activeProject && activeProject.id === data.projectId) {
    activeProject.activities = data.activities;
    renderProjectActivities(activeProject ?? null, auth.getUser());
  }
});

// ========================================================
// IN-SESSION PROJECT WORKSPACE DRAWER & STUDIO DESK ENGINE
// ========================================================

// Initialize saved workspace width
try {
  const savedDrawerWidth = parseInt(localStorage.getItem('jameet-session-workspace-width') || localStorage.getItem('musiczoom-session-workspace-width') || '540', 10);
  if (savedDrawerWidth && savedDrawerWidth >= 340 && savedDrawerWidth <= 1400) {
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
    // Close Session Chat if open so they never overlap
    setSessionChatOpen(false);

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

setOnChatOpenCallback(() => {
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
    
    // Hide top track selector bar specifically in Tasks tab
    $('session-drawer-song-bar')?.classList.toggle('hidden', tab === 'tasks');

    if (tab === 'tasks') {
      renderTasksWorkspace();
    } else if (tab === 'structure') {
      renderStructureWorkspace();
    } else if (tab === 'lyrics') {
      updateLyricsDocumentPagination();
    }
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
  const maxW = Math.max(900, Math.min(window.innerWidth - 60, 1400));
  const newWidth = Math.max(340, Math.min(maxW, resizeStartWidth + deltaX));
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
let currentTasksViewMode: 'list' | 'board' = 'list';
let currentTasksSongFilter: string = 'all';
let currentTasksStageFilter: string = 'all';
let currentTasksGrouping: 'song' | 'stage' | 'status' | 'none' = 'song';
let currentTasksSearchQuery: string = '';
let showCompletedTasks: boolean = true;
const tasksCollapsedGroups: Set<string> = new Set();
let draggedTaskId: string | null = null;
let currentSelectedTaskId: string | null = null;

const SONG_ICONS: Record<string, { label: string; svg: string }> = {
  music: {
    label: 'Music',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
  },
  mic: {
    label: 'Vocals',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>'
  },
  piano: {
    label: 'Keys',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 4v8"/><path d="M10 4v8"/><path d="M14 4v8"/><path d="M18 4v8"/></svg>'
  },
  guitar: {
    label: 'Guitar',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="m19 5-3 3"/><path d="m2 22 5.5-1.5L19 9a2.5 2.5 0 0 0-3.5-3.5L4 16.5Z"/><circle cx="14" cy="10" r="1"/></svg>'
  },
  drums: {
    label: 'Drums',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><ellipse cx="12" cy="8" rx="8" ry="4"/><path d="M4 8v8c0 2.2 3.6 4 8 4s8-1.8 8-4V8"/><path d="m7 12 5 5 5-5"/></svg>'
  },
  headphones: {
    label: 'Audio',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></svg>'
  },
  disc: {
    label: 'Vinyl',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>'
  },
  bolt: {
    label: 'Idea',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'
  },
  folder: {
    label: 'Album',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>'
  },
  tag: {
    label: 'Tag',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><circle cx="7" cy="7" r=".5" fill="currentColor"/></svg>'
  }
};

const SONG_COLORS = [
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Cyan', hex: '#06b6d4' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Purple', hex: '#8b5cf6' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Slate', hex: '#94a3b8' }
];

const STAGE_CONFIG: Record<ProjectTaskStage, { label: string; iconSvg: string }> = {
  writing: {
    label: 'Writing',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>'
  },
  recording: {
    label: 'Recording',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>'
  },
  arrangement: {
    label: 'Arrangement',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 4v8"/><path d="M10 4v8"/><path d="M14 4v8"/><path d="M18 4v8"/></svg>'
  },
  mix: {
    label: 'Mix',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="1" x2="7" y1="14" y2="14"/><line x1="9" x2="15" y1="8" y2="8"/><line x1="17" x2="23" y1="16" y2="16"/></svg>'
  },
  mastering: {
    label: 'Mastering',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>'
  },
  revisions: {
    label: 'Revisions',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>'
  },
  general: {
    label: 'General',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><circle cx="7" cy="7" r=".5" fill="currentColor"/></svg>'
  }
};

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
  tasksEditGen++;
  setTasksStatus('saving');
  if (tasksSaveTimeout) clearTimeout(tasksSaveTimeout);
  tasksSaveTimeout = setTimeout(() => {
    tasksSaveTimeout = null;
    void saveTasksWorkspace();
  }, 350);
}

async function flushAllWorkspacePendingSaves(): Promise<void> {
  if (!activeProject?.workspace) return;
  const promises: Promise<any>[] = [];

  if (lyricsSaveTimeout) {
    clearTimeout(lyricsSaveTimeout);
    lyricsSaveTimeout = null;
    const activeDoc = getActiveLyricsDoc();
    promises.push(saveLyricsWorkspace(activeDoc.content, activeDoc.id, activeDoc.title));
  }
  if (notesSaveTimeout) {
    clearTimeout(notesSaveTimeout);
    notesSaveTimeout = null;
    const vals = getNotesFieldValues();
    promises.push(saveNotesWorkspace(vals.content, vals.bpm, vals.key));
  }
  if (structureSaveTimeout) {
    clearTimeout(structureSaveTimeout);
    structureSaveTimeout = null;
    const sections = activeProject.workspace.structure?.sections || [];
    promises.push(saveStructureWorkspace(sections));
  }
  if (tasksSaveTimeout) {
    clearTimeout(tasksSaveTimeout);
    tasksSaveTimeout = null;
  }
  promises.push(saveTasksWorkspace());

  if (activeProject.workspace.songs) {
    promises.push(saveSongsWorkspace());
  }

  await Promise.allSettled(promises);
}

async function saveTasksWorkspace(): Promise<void> {
  if (!activeProject) return;
  const token = auth.getToken();
  if (!token) {
    setTasksStatus('unsaved');
    return;
  }
  const targetProjectId = activeProject.id;
  const targetContextGen = currentWorkspaceContextGen;
  const targetEditGen = tasksEditGen;
  const targetSaveGen = ++tasksSaveGen;
  const baseRevision = activeProject.workspace?.tasks?.revision ?? 1;
  const tasks = getProjectTasks().map((t) => ({
    id: t.id,
    title: t.title?.trim() || 'Untitled Task',
    status: t.status || 'todo',
    assigneeId: t.assigneeId || undefined,
    assigneeName: t.assigneeName || undefined,
    songId: t.songId || undefined,
    songTitle: t.songTitle || undefined,
    stage: t.stage || undefined,
    subtasks: Array.isArray(t.subtasks) && t.subtasks.length > 0 ? t.subtasks.map((st) => ({
      id: st.id,
      title: st.title.trim(),
      done: Boolean(st.done)
    })) : undefined,
    note: t.note && t.note.trim() ? t.note.trim() : undefined,
    dueDate: t.dueDate || undefined,
    createdAt: t.createdAt || Date.now(),
    completedAt: t.completedAt || undefined,
    updatedAt: t.updatedAt || Date.now()
  }));

  try {
    let res = await signaling.updateProjectWorkspace(targetProjectId, {
      tasks: { baseRevision, tasks }
    }, token);
    if (!res?.ok && !res?.conflict && res?.code !== 'WORKSPACE_CONFLICT') {
      try {
        const httpRes = await projectsApi.updateProjectWorkspace(token, targetProjectId, {
          tasks: { baseRevision, tasks }
        });
        if (httpRes?.workspace) {
          res = { ok: true, workspace: httpRes.workspace, project: httpRes.project };
        }
      } catch (httpErr: any) {
        console.warn('HTTP workspace update fallback failed for tasks:', httpErr);
      }
    }
    // If the server responded with a newer revision, always record it to prevent 409 conflict loops
    if (res?.ok && res.workspace?.tasks?.revision && activeProject?.workspace?.tasks) {
      activeProject.workspace.tasks.revision = res.workspace.tasks.revision;
    }

    const isLatest = (activeProject?.id === targetProjectId) &&
      (targetContextGen === currentWorkspaceContextGen) &&
      (targetSaveGen === tasksSaveGen) &&
      (targetEditGen === tasksEditGen);
    if (!isLatest) return;

    if (res?.ok && res.workspace && activeProject) {
      applyAuthoritativeWorkspaceUpdate('tasks', res.workspace);
      setTasksStatus('saved');
    } else if (res?.conflict || res?.code === 'WORKSPACE_CONFLICT') {
      if (res.workspace?.tasks?.revision && activeProject?.workspace?.tasks) {
        activeProject.workspace.tasks.revision = res.workspace.tasks.revision;
      } else if (res.currentRevision && activeProject?.workspace?.tasks) {
        activeProject.workspace.tasks.revision = res.currentRevision;
      }
      setTasksStatus('saving');
      debounceSaveTasks();
    } else {
      setTasksStatus('unsaved');
    }
  } catch (err) {
    console.error('Failed to save tasks workspace:', err);
    const isLatest = (activeProject?.id === targetProjectId) &&
      (targetContextGen === currentWorkspaceContextGen) &&
      (targetSaveGen === tasksSaveGen) &&
      (targetEditGen === tasksEditGen);
    if (isLatest) {
      setTasksStatus('unsaved');
    }
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

function addSubtask(taskId: string, title: string): void {
  if (!canUserEditProject()) return;
  const trimmed = title.trim();
  if (!trimmed) return;
  const tasks = getProjectTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (!Array.isArray(task.subtasks)) task.subtasks = [];
  task.subtasks.push({
    id: `sub_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    title: trimmed,
    done: false
  });
  task.updatedAt = Date.now();
  currentSelectedTaskId = taskId;
  renderTasksWorkspace();
  debounceSaveTasks();

  // Immediately keep focus on Add Subtask input so user can type the next subtask right away!
  setTimeout(() => {
    const taskRow = document.querySelector(`.reminders-task-row[data-task-id="${taskId}"]`);
    const addInput = taskRow?.querySelector<HTMLInputElement>('.task-subtask-add-input');
    if (addInput) {
      addInput.focus();
    }
  }, 10);
}

function toggleSubtask(taskId: string, subtaskId: string): void {
  if (!canUserEditProject()) return;
  const tasks = getProjectTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task || !Array.isArray(task.subtasks)) return;
  const sub = task.subtasks.find((s) => s.id === subtaskId);
  if (!sub) return;
  sub.done = !sub.done;
  task.updatedAt = Date.now();
  renderTasksWorkspace();
  debounceSaveTasks();
}

function deleteSubtask(taskId: string, subtaskId: string): void {
  if (!canUserEditProject()) return;
  const tasks = getProjectTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task || !Array.isArray(task.subtasks)) return;
  task.subtasks = task.subtasks.filter((s) => s.id !== subtaskId);
  task.updatedAt = Date.now();
  renderTasksWorkspace();
  debounceSaveTasks();
}

function updateTaskStage(id: string, stage: ProjectTaskStage | undefined): void {
  if (!canUserEditProject()) return;
  const tasks = getProjectTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  task.stage = stage;
  task.updatedAt = Date.now();
  renderTasksWorkspace();
  debounceSaveTasks();
}

function updateTaskSong(id: string, songId: string | undefined, songTitle: string | undefined): void {
  const tasks = getProjectTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  task.songId = songId;
  task.songTitle = songTitle;
  task.updatedAt = Date.now();
  renderTasksWorkspace();
  debounceSaveTasks();
}

function updateTaskAssignee(id: string, assigneeId: string | undefined, assigneeName: string | undefined): void {
  const tasks = getProjectTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  task.assigneeId = assigneeId;
  task.assigneeName = assigneeName;
  task.updatedAt = Date.now();
  currentSelectedTaskId = id;
  renderTasksWorkspace();
  debounceSaveTasks();
}

function duplicateTask(taskId: string): void {
  const tasks = getProjectTasks();
  const index = tasks.findIndex((t) => t.id === taskId);
  if (index === -1) return;
  const original = tasks[index];
  const now = Date.now();
  const copy: ProjectTaskItem = {
    ...original,
    id: `task_${now}_${Math.random().toString(36).substring(2, 7)}`,
    title: `${original.title} (Copy)`,
    createdAt: now,
    updatedAt: now,
    subtasks: Array.isArray(original.subtasks)
      ? original.subtasks.map((st) => ({
          id: `sub_${now}_${Math.random().toString(36).substring(2, 6)}`,
          title: st.title,
          done: st.done
        }))
      : []
  };
  tasks.splice(index + 1, 0, copy);
  renderTasksWorkspace();
  debounceSaveTasks();
}

function showSongContextMenu(e: MouseEvent, song: ProjectSongItem): void {
  e.preventDefault();
  e.stopPropagation();

  document.querySelectorAll('.task-context-menu, .song-context-menu').forEach((m) => m.remove());

  const canEdit = canUserEditProject();
  const menu = document.createElement('div');
  menu.className = 'task-context-menu song-context-menu';

  const isArchived = Boolean(song.archived);

  menu.innerHTML = `
    <div class="task-context-item" data-action="open-studio">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
        <span>Open in Song Studio</span>
      </div>
    </div>
    ${canEdit ? `
      <div class="task-context-item" data-action="rename">
        <div class="task-context-item-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
          <span>Rename Track</span>
        </div>
      </div>
      <div class="task-context-item" data-action="archive">
        <div class="task-context-item-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
          <span>${isArchived ? 'Unarchive Track' : 'Archive Track'}</span>
        </div>
      </div>
      <div class="task-context-divider"></div>
      <div class="task-context-item danger" data-action="delete">
        <div class="task-context-item-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></svg>
          <span>Delete Track</span>
        </div>
      </div>
    ` : ''}
  `;

  document.body.appendChild(menu);

  const menuWidth = 190;
  const menuHeight = menu.offsetHeight || 140;
  let x = e.clientX;
  let y = e.clientY;

  if (x + menuWidth > window.innerWidth - 10) x = window.innerWidth - menuWidth - 10;
  if (y + menuHeight > window.innerHeight - 10) y = window.innerHeight - menuHeight - 10;

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  menu.querySelectorAll<HTMLElement>('.task-context-item').forEach((item) => {
    item.addEventListener('click', (ev) => {
      ev.stopPropagation();
      menu.remove();
      const action = item.dataset.action;
      if (action === 'open-studio') {
        switchActiveSong(song.id);
        openSongStudio(song.id, 'lyrics');
      } else if (action === 'rename') {
        const songCard = document.querySelector(`.overview-song-card[data-song-id="${song.id}"]`);
        const titleEl = songCard?.querySelector('.overview-song-title') as HTMLElement;
        if (titleEl) {
          titleEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        }
      } else if (action === 'archive') {
        song.archived = !song.archived;
        renderProjectSongsSelector();
        renderProjectOverviewSongsList();
        void saveSongsWorkspace();
      } else if (action === 'delete') {
        openDeleteSongModal(song);
      }
    });
  });

  const closeHandler = () => {
    menu.remove();
    document.removeEventListener('click', closeHandler);
    document.removeEventListener('contextmenu', closeHandler);
  };
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
    document.addEventListener('contextmenu', closeHandler);
  }, 0);
}

function showTaskContextMenu(e: MouseEvent, task: ProjectTaskItem): void {
  e.preventDefault();
  e.stopPropagation();
  if (!canUserEditProject()) return;

  document.querySelectorAll('.task-context-menu').forEach((m) => m.remove());

  const menu = document.createElement('div');
  menu.className = 'task-context-menu';

  const isDone = task.status === 'done';

  menu.innerHTML = `
    <div class="task-context-item" data-action="toggle-status">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        <span>${isDone ? 'Mark as To Do' : 'Mark as Done'}</span>
      </div>
    </div>
    <div class="task-context-item" data-action="duplicate">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
        <span>Duplicate Task</span>
      </div>
    </div>
    <div class="task-context-item" data-action="copy">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/></svg>
        <span>Copy Title</span>
      </div>
    </div>
    <div class="task-context-divider"></div>
    <div class="task-context-item" data-action="add-subtask">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
        <span>Add Subtask</span>
      </div>
    </div>
    <div class="task-context-item" data-action="add-note">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        <span>${task.note && task.note.trim() ? 'Edit Note' : 'Add Note'}</span>
      </div>
    </div>
    <div class="task-context-divider"></div>
    <div class="task-context-item" data-action="due-today">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
        <span>Due Today</span>
      </div>
    </div>
    <div class="task-context-item" data-action="due-tomorrow">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
        <span>Due Tomorrow</span>
      </div>
    </div>
    ${task.dueDate ? `
      <div class="task-context-item" data-action="clear-due">
        <div class="task-context-item-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>
          <span>Remove Due Date</span>
        </div>
      </div>
    ` : ''}
    <div class="task-context-divider"></div>
    <div class="task-context-item danger" data-action="delete">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        <span>Delete Task</span>
      </div>
    </div>
  `;

  document.body.appendChild(menu);

  const menuWidth = 180;
  const menuHeight = menu.offsetHeight || 260;
  let posX = e.clientX;
  let posY = e.clientY;

  if (posX + menuWidth > window.innerWidth - 10) {
    posX = window.innerWidth - menuWidth - 10;
  }
  if (posY + menuHeight > window.innerHeight - 10) {
    posY = window.innerHeight - menuHeight - 10;
  }

  menu.style.left = `${posX}px`;
  menu.style.top = `${posY}px`;

  menu.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const item = (ev.target as HTMLElement).closest<HTMLElement>('.task-context-item');
    if (!item) return;
    const action = item.dataset.action;
    menu.remove();

    if (action === 'toggle-status') {
      quickToggleTask(task.id);
    } else if (action === 'duplicate') {
      duplicateTask(task.id);
    } else if (action === 'copy') {
      navigator.clipboard.writeText(task.title || '').catch(() => {});
    } else if (action === 'add-subtask') {
      addSubtask(task.id, 'New subtask');
    } else if (action === 'add-note') {
      if (!task.note) task.note = 'Note...';
      task.updatedAt = Date.now();
      renderTasksWorkspace();
      debounceSaveTasks();
    } else if (action === 'due-today') {
      const today = new Date().toISOString().split('T')[0];
      task.dueDate = today;
      task.updatedAt = Date.now();
      renderTasksWorkspace();
      debounceSaveTasks();
    } else if (action === 'due-tomorrow') {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      task.dueDate = tomorrow;
      task.updatedAt = Date.now();
      renderTasksWorkspace();
      debounceSaveTasks();
    } else if (action === 'clear-due') {
      task.dueDate = undefined;
      task.updatedAt = Date.now();
      renderTasksWorkspace();
      debounceSaveTasks();
    } else if (action === 'delete') {
      deleteTask(task.id);
    }
  });

  const closeHandler = (docEv: MouseEvent) => {
    if (!menu.contains(docEv.target as Node)) {
      menu.remove();
      document.removeEventListener('click', closeHandler);
      document.removeEventListener('contextmenu', closeHandler);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
    document.addEventListener('contextmenu', closeHandler);
  }, 0);
}

function openTaskInspector(task: ProjectTaskItem, anchorEl: HTMLElement): void {
  document.querySelectorAll('.reminders-inspector-popover').forEach((p) => p.remove());
  document.querySelectorAll('.task-context-menu').forEach((m) => m.remove());

  const popover = document.createElement('div');
  popover.className = 'reminders-inspector-popover';

  const songs = activeProject?.workspace?.songs || [];
  const hasDate = Boolean(task.dueDate);
  const stageKey = task.stage || 'general';

  const songOptionsHtml = `
    <option value="">No Track</option>
    ${songs
      .map(
        (s) => `
      <option value="${s.id}|${escapeHtml(s.title)}" ${s.id === task.songId ? 'selected' : ''}>${escapeHtml(s.title)}</option>
    `
      )
      .join('')}
  `;

  popover.innerHTML = `
    <!-- Header: Title & Notes -->
    <div class="inspector-card">
      <input type="text" class="inspector-title-input" value="${escapeHtml(task.title)}" placeholder="Task title" maxlength="150" />
      <textarea class="inspector-notes-textarea" placeholder="Notes" rows="2">${escapeHtml(task.note || '')}</textarea>
    </div>

    <!-- Date & Time -->
    <div class="inspector-section-title">Date & Time</div>
    <div class="inspector-card">
      <div class="inspector-row">
        <div class="inspector-row-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
          <span>Date</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <input type="date" class="inspector-date-input ${hasDate ? '' : 'hidden'}" value="${escapeHtml(task.dueDate || '')}" />
          <label class="inspector-switch">
            <input type="checkbox" class="inspector-date-toggle" ${hasDate ? 'checked' : ''} />
            <span class="inspector-slider"></span>
          </label>
        </div>
      </div>
      <div class="inspector-row">
        <div class="inspector-row-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>
          <span>Priority</span>
        </div>
        <select class="inspector-select inspector-priority-select">
          <option value="none" ${task.priority === 'none' || !task.priority ? 'selected' : ''}>None</option>
          <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Low</option>
          <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="high" ${task.priority === 'high' ? 'selected' : ''}>High</option>
          <option value="urgent" ${task.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
        </select>
      </div>
    </div>

    <!-- Organization -->
    <div class="inspector-section-title">Organization</div>
    <div class="inspector-card">
      <div class="inspector-row">
        <div class="inspector-row-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          <span>Track</span>
        </div>
        <select class="inspector-select inspector-song-select">
          ${songOptionsHtml}
        </select>
      </div>
      <div class="inspector-row">
        <div class="inspector-row-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
          <span>Stage</span>
        </div>
        <select class="inspector-select inspector-stage-select">
          <option value="general" ${stageKey === 'general' ? 'selected' : ''}>General</option>
          <option value="writing" ${stageKey === 'writing' ? 'selected' : ''}>Writing</option>
          <option value="recording" ${stageKey === 'recording' ? 'selected' : ''}>Recording</option>
          <option value="arrangement" ${stageKey === 'arrangement' ? 'selected' : ''}>Arrangement</option>
          <option value="mix" ${stageKey === 'mix' ? 'selected' : ''}>Mix</option>
          <option value="mastering" ${stageKey === 'mastering' ? 'selected' : ''}>Mastering</option>
          <option value="revisions" ${stageKey === 'revisions' ? 'selected' : ''}>Revisions</option>
        </select>
      </div>
    </div>
  `;

  document.body.appendChild(popover);

  const canEdit = canUserEditProject();
  if (!canEdit) {
    popover.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((el) => {
      el.disabled = true;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.readOnly = true;
      }
    });
    const slider = popover.querySelector<HTMLElement>('.inspector-slider');
    if (slider) slider.style.pointerEvents = 'none';
  }

  const rect = anchorEl.getBoundingClientRect();
  const popoverWidth = 320;
  const popoverHeight = popover.offsetHeight || 380;
  let posX = rect.right + 10;
  let posY = rect.top - 20;

  if (posX + popoverWidth > window.innerWidth - 16) {
    posX = rect.left - popoverWidth - 10;
  }
  if (posX < 10) posX = 10;

  if (posY + popoverHeight > window.innerHeight - 16) {
    posY = window.innerHeight - popoverHeight - 16;
  }
  if (posY < 10) posY = 10;

  popover.style.left = `${posX}px`;
  popover.style.top = `${posY}px`;

  if (canEdit) {
    const titleInput = popover.querySelector<HTMLInputElement>('.inspector-title-input');
    titleInput?.addEventListener('input', () => {
      if (!canUserEditProject()) return;
      task.title = titleInput.value;
      task.updatedAt = Date.now();
      renderTasksWorkspace();
      debounceSaveTasks();
    });

    const notesTextarea = popover.querySelector<HTMLTextAreaElement>('.inspector-notes-textarea');
    notesTextarea?.addEventListener('input', () => {
      if (!canUserEditProject()) return;
      task.note = notesTextarea.value;
      task.updatedAt = Date.now();
      renderTasksWorkspace();
      debounceSaveTasks();
    });

    const dateToggle = popover.querySelector<HTMLInputElement>('.inspector-date-toggle');
    const dateInput = popover.querySelector<HTMLInputElement>('.inspector-date-input');

    dateToggle?.addEventListener('change', () => {
      if (!canUserEditProject()) return;
      if (dateToggle.checked) {
        dateInput?.classList.remove('hidden');
        const today = new Date().toISOString().split('T')[0];
        task.dueDate = dateInput?.value || today;
        if (dateInput) dateInput.value = task.dueDate;
      } else {
        dateInput?.classList.add('hidden');
        task.dueDate = undefined;
      }
      task.updatedAt = Date.now();
      renderTasksWorkspace();
      debounceSaveTasks();
    });

    dateInput?.addEventListener('change', () => {
      if (!canUserEditProject()) return;
      task.dueDate = dateInput.value || undefined;
      task.updatedAt = Date.now();
      renderTasksWorkspace();
      debounceSaveTasks();
    });

    const prioritySelect = popover.querySelector<HTMLSelectElement>('.inspector-priority-select');
    prioritySelect?.addEventListener('change', () => {
      if (!canUserEditProject()) return;
      task.priority = prioritySelect.value as any;
      task.updatedAt = Date.now();
      renderTasksWorkspace();
      debounceSaveTasks();
    });

    const songSelect = popover.querySelector<HTMLSelectElement>('.inspector-song-select');
    songSelect?.addEventListener('change', () => {
      if (!canUserEditProject()) return;
      const val = songSelect.value;
      if (!val) {
        task.songId = undefined;
        task.songTitle = undefined;
      } else {
        const [sId, sTitle] = val.split('|');
        task.songId = sId;
        task.songTitle = sTitle;
      }
      task.updatedAt = Date.now();
      renderTasksWorkspace();
      debounceSaveTasks();
    });

    const stageSelect = popover.querySelector<HTMLSelectElement>('.inspector-stage-select');
    stageSelect?.addEventListener('change', () => {
      if (!canUserEditProject()) return;
      const val = stageSelect.value as ProjectTaskStage;
      task.stage = val === 'general' ? undefined : val;
      task.updatedAt = Date.now();
      renderTasksWorkspace();
      debounceSaveTasks();
    });
  }

  popover.addEventListener('click', (ev) => ev.stopPropagation());

  const closeHandler = (docEv: MouseEvent) => {
    if (!popover.contains(docEv.target as Node) && !anchorEl.contains(docEv.target as Node)) {
      popover.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
  }, 0);
}

function renderTasksWorkspace(): void {
  if (!activeProject) return;
  const tasks = getProjectTasks();
  const songs = activeProject.workspace?.songs || [];

  const totalCount = tasks.length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length;
  const todoCount = tasks.filter((t) => t.status === 'todo').length;
  const remainingCount = totalCount - doneCount;

  // 1. Update Apple Reminders Hero Title & Stats
  setText('tasks-hero-counter', remainingCount.toString());
  setText('session-tasks-hero-counter', remainingCount.toString());
  setText('tasks-completed-summary', `${doneCount} Completed`);
  setText('session-tasks-completed-summary', `${doneCount} Completed`);
  setText('tab-tasks-count', remainingCount.toString());
  setText('session-tasks-summary', `${remainingCount} Remaining · ${doneCount} Done`);

  const toggleDoneBtn = $('btn-tasks-toggle-completed');
  if (toggleDoneBtn) {
    toggleDoneBtn.textContent = showCompletedTasks ? 'Hide' : 'Show';
  }
  const sessionToggleDoneBtn = $('session-btn-tasks-toggle-completed');
  if (sessionToggleDoneBtn) {
    sessionToggleDoneBtn.textContent = showCompletedTasks ? 'Hide' : 'Show';
  }

  // 2. Populate assignee selector on creation bar
  const createAssigneeSelect = $<HTMLSelectElement>('task-new-assignee');
  const sessionAssigneeSelect = $<HTMLSelectElement>('session-task-new-assignee');
  let opts = '<option value="">Unassigned</option>';
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

  // 3. Populate song selector on creation bar
  const createSongSelect = $<HTMLSelectElement>('task-new-song');
  const sessionSongSelect = $<HTMLSelectElement>('session-task-new-song');
  let songOpts = '<option value="">All Tracks</option>';
  songs.forEach((s, i) => {
    songOpts += `<option value="${s.id}">${escapeHtml(s.title || `Song ${i + 1}`)}</option>`;
  });
  if (createSongSelect) {
    const curSongVal = createSongSelect.value;
    createSongSelect.innerHTML = songOpts;
    if (curSongVal && songs.some((s) => s.id === curSongVal)) createSongSelect.value = curSongVal;
  }
  if (sessionSongSelect) {
    const curSongVal = sessionSongSelect.value;
    sessionSongSelect.innerHTML = songOpts;
    if (curSongVal && songs.some((s) => s.id === curSongVal)) sessionSongSelect.value = curSongVal;
  }

  // 4. Update track filter dropdown on header bar
  const filterSongSelect = $<HTMLSelectElement>('tasks-filter-song');
  const sessionFilterSongSelect = $<HTMLSelectElement>('session-tasks-filter-song');
  let filterSongOpts = '<option value="all">All Tracks</option>';
  songs.forEach((s, i) => {
    filterSongOpts += `<option value="${s.id}" ${currentTasksSongFilter === s.id ? 'selected' : ''}>${escapeHtml(s.title || `Song ${i + 1}`)}</option>`;
  });
  if (filterSongSelect) filterSongSelect.innerHTML = filterSongOpts;
  if (sessionFilterSongSelect) sessionFilterSongSelect.innerHTML = filterSongOpts;

  // 5. Update stage & group by filter dropdowns
  const filterStageSelect = $<HTMLSelectElement>('tasks-filter-stage');
  const sessionFilterStageSelect = $<HTMLSelectElement>('session-tasks-filter-stage');
  if (filterStageSelect) filterStageSelect.value = currentTasksStageFilter;
  if (sessionFilterStageSelect) sessionFilterStageSelect.value = currentTasksStageFilter;

  const groupBySelect = $<HTMLSelectElement>('tasks-group-by');
  const sessionGroupBySelect = $<HTMLSelectElement>('session-tasks-group-by');
  if (groupBySelect) groupBySelect.value = currentTasksGrouping;
  if (sessionGroupBySelect) sessionGroupBySelect.value = currentTasksGrouping;

  // 6. Update view switcher buttons
  const btnList = $('btn-tasks-view-list');
  const btnBoard = $('btn-tasks-view-board');
  if (btnList && btnBoard) {
    btnList.classList.toggle('active', currentTasksViewMode === 'list');
    btnBoard.classList.toggle('active', currentTasksViewMode === 'board');
  }
  const sessionBtnList = $('session-btn-tasks-view-list');
  const sessionBtnBoard = $('session-btn-tasks-view-board');
  if (sessionBtnList && sessionBtnBoard) {
    sessionBtnList.classList.toggle('active', currentTasksViewMode === 'list');
    sessionBtnBoard.classList.toggle('active', currentTasksViewMode === 'board');
  }

  // 7. Filter tasks
  const filteredTasks = tasks.filter((t) => {
    if (!showCompletedTasks && t.status === 'done') return false;
    if (currentTaskFilter !== 'all' && t.status !== currentTaskFilter) return false;
    if (currentTasksSongFilter !== 'all' && t.songId !== currentTasksSongFilter) return false;
    if (currentTasksStageFilter !== 'all' && (t.stage || 'general') !== currentTasksStageFilter) return false;
    if (currentTasksSearchQuery) {
      const q = currentTasksSearchQuery.toLowerCase();
      const titleMatch = t.title.toLowerCase().includes(q);
      const noteMatch = t.note?.toLowerCase().includes(q);
      const assigneeMatch = t.assigneeName?.toLowerCase().includes(q);
      const songMatch = t.songTitle?.toLowerCase().includes(q);
      if (!titleMatch && !noteMatch && !assigneeMatch && !songMatch) return false;
    }
    return true;
  });

  const listContainer = $('project-tasks-list');
  const boardContainer = $('project-tasks-board');
  const emptyEl = $('project-tasks-empty');
  const sessionListContainer = $('session-tasks-list');
  const sessionBoardContainer = $('session-tasks-board');
  const sessionEmptyEl = $('session-tasks-empty');

  if (emptyEl) {
    emptyEl.classList.toggle('hidden', filteredTasks.length > 0);
  }
  if (sessionEmptyEl) {
    sessionEmptyEl.classList.toggle('hidden', filteredTasks.length > 0);
  }

  if (listContainer && boardContainer) {
    listContainer.classList.toggle('hidden', currentTasksViewMode !== 'list');
    boardContainer.classList.toggle('hidden', currentTasksViewMode !== 'board');
  }
  if (sessionListContainer && sessionBoardContainer) {
    sessionListContainer.classList.toggle('hidden', currentTasksViewMode !== 'list');
    sessionBoardContainer.classList.toggle('hidden', currentTasksViewMode !== 'board');
  }

  // 8. Build Assignee Options String for Card selects
  let assigneeOptions = '<option value="">Unassigned</option>';
  if (activeProject.ownerId) {
    const ownerName = activeProject.ownerDisplayName || activeProject.ownerUsername || 'Owner';
    assigneeOptions += `<option value="${activeProject.ownerId}|${escapeHtml(ownerName)}">${escapeHtml(ownerName)} (Owner)</option>`;
  }
  if (Array.isArray(activeProject.collaborators)) {
    for (const c of activeProject.collaborators) {
      if (c.userId !== activeProject.ownerId) {
        const cName = c.displayName || c.username || 'Collaborator';
        assigneeOptions += `<option value="${c.userId}|${escapeHtml(cName)}">${escapeHtml(cName)}</option>`;
      }
    }
  }

  // 9. Build Song Options String for Card selects
  let songSelectOptions = '<option value="">No Track</option>';
  songs.forEach((s, i) => {
    songSelectOptions += `<option value="${s.id}|${escapeHtml(s.title || `Song ${i + 1}`)}">${escapeHtml(s.title || `Song ${i + 1}`)}</option>`;
  });

  // 10. Helper: Render an Apple Reminders Task Row
  const renderListCard = (task: ProjectTaskItem): HTMLElement => {
    const isSelected = currentSelectedTaskId === task.id;
    const row = document.createElement('div');
    row.className = `reminders-task-row status-${task.status}${isSelected ? ' is-selected' : ''}`;
    row.dataset.taskId = task.id;
    row.setAttribute('draggable', 'true');

    let toggleIcon = '';
    if (task.status === 'done') {
      toggleIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    }

    // Unified Assignee Dropdown Pill
    let assigneeOpts = '<option value="">Unassigned</option>';
    if (activeProject?.ownerId) {
      const ownerName = activeProject.ownerDisplayName || activeProject.ownerUsername || 'Owner';
      const isOwnerSelected = task.assigneeId === activeProject.ownerId;
      assigneeOpts += `<option value="${activeProject.ownerId}|${escapeHtml(ownerName)}" ${isOwnerSelected ? 'selected' : ''}>${escapeHtml(ownerName)}</option>`;
    }
    if (Array.isArray(activeProject?.collaborators)) {
      for (const c of activeProject.collaborators) {
        if (c.userId !== activeProject.ownerId) {
          const cName = c.displayName || c.username || 'Collaborator';
          const isCollabSelected = task.assigneeId === c.userId;
          assigneeOpts += `<option value="${c.userId}|${escapeHtml(cName)}" ${isCollabSelected ? 'selected' : ''}>${escapeHtml(cName)}</option>`;
        }
      }
    }
    const assigneeHtml = `
      <select class="task-action-pill task-assignee-select" title="Assignee">
        ${assigneeOpts}
      </select>
    `;

    // Unified Due Date Pill
    const dueHtml = `
      <input type="date" class="task-action-pill task-due-input" value="${escapeHtml(task.dueDate || '')}" title="Due Date" />
    `;

    // Unified Stage Dropdown Pill
    const stageKey = task.stage || 'general';
    const stageBadgeHtml = `
      <select class="task-action-pill task-stage-select" title="Stage">
        <option value="general" ${stageKey === 'general' ? 'selected' : ''}>Stage: General</option>
        <option value="writing" ${stageKey === 'writing' ? 'selected' : ''}>Stage: Writing</option>
        <option value="recording" ${stageKey === 'recording' ? 'selected' : ''}>Stage: Recording</option>
        <option value="arrangement" ${stageKey === 'arrangement' ? 'selected' : ''}>Stage: Arrangement</option>
        <option value="mix" ${stageKey === 'mix' ? 'selected' : ''}>Stage: Mix</option>
        <option value="mastering" ${stageKey === 'mastering' ? 'selected' : ''}>Stage: Mastering</option>
        <option value="revisions" ${stageKey === 'revisions' ? 'selected' : ''}>Stage: Revisions</option>
      </select>
    `;

    // Unified Track Dropdown Pill
    let songPillHtml = '';
    if (songs.length > 0) {
      let sOpts = `<option value="">Track: None</option>`;
      songs.forEach((s, i) => {
        const isSongSelected = task.songId === s.id;
        sOpts += `<option value="${s.id}|${escapeHtml(s.title || `Song ${i + 1}`)}" ${isSongSelected ? 'selected' : ''}>${escapeHtml(s.title || `Song ${i + 1}`)}</option>`;
      });
      songPillHtml = `
        <select class="task-action-pill task-song-select" title="Linked Track">
          ${sOpts}
        </select>
      `;
    }

    // Subtasks checklist HTML
    const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
    const doneSubs = subtasks.filter((s) => s.done).length;

    row.innerHTML = `
      <div class="reminders-task-main">
        <button type="button" class="reminders-check-btn" title="${task.status === 'done' ? 'Reopen task' : 'Mark as Done'}">
          ${toggleIcon}
        </button>
        <input type="text" class="reminders-task-title-input" value="${escapeHtml(task.title)}" placeholder="Task" maxlength="150" />
        <div class="reminders-task-right">
          ${task.dueDate ? `<span class="task-meta-badge due-badge">${escapeHtml(formatShortDate(task.dueDate))}</span>` : ''}
          <button type="button" class="reminders-info-btn" title="Task Details">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          </button>
        </div>
      </div>

      <div class="task-subtasks-block">
        ${subtasks.length > 0 ? `
          <div class="task-subtasks-list">
            ${subtasks.map((st) => `
              <div class="task-subtask-item ${st.done ? 'done' : ''}" data-subtask-id="${st.id}">
                <button type="button" class="task-subtask-check ${st.done ? 'done' : ''}" title="${st.done ? 'Mark undone' : 'Mark done'}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
                <input type="text" class="task-subtask-text-input" value="${escapeHtml(st.title)}" maxlength="120" />
                <button type="button" class="task-subtask-del" title="Delete subtask">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
            `).join('')}
          </div>
        ` : ''}
        <div class="task-subtasks-add-row">
          <span class="subtask-add-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          </span>
          <input type="text" class="task-subtask-add-input" placeholder="Add subtask..." maxlength="120" />
          ${subtasks.length > 0 ? `
            <span class="task-subtasks-counter-pill"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><polyline points="20 6 9 17 4 12"/></svg><span>${doneSubs}/${subtasks.length}</span></span>
          ` : ''}
        </div>
      </div>

      <div class="reminders-task-details">
        <div class="task-note-inner">
          <textarea class="task-note-textarea" placeholder="Notes" rows="1">${escapeHtml(task.note || '')}</textarea>
        </div>
        <div class="reminders-task-meta-actions">
          ${stageBadgeHtml}
          ${songPillHtml}
          ${assigneeHtml}
          ${dueHtml}
        </div>
      </div>
    `;

    // Wiring Row Events
    row.querySelector('.reminders-check-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      quickToggleTask(task.id);
    });

    // Stage Change
    row.querySelector<HTMLSelectElement>('.task-stage-select')?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value as ProjectTaskStage;
      task.stage = val === 'general' ? undefined : val;
      task.updatedAt = Date.now();
      debounceSaveTasks();
      if (currentTasksGrouping === 'stage') {
        currentSelectedTaskId = task.id;
        renderTasksWorkspace();
      }
    });

    // Track Change
    row.querySelector<HTMLSelectElement>('.task-song-select')?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value;
      if (!val) {
        task.songId = undefined;
        task.songTitle = undefined;
      } else {
        const [sId, sTitle] = val.split('|');
        task.songId = sId;
        task.songTitle = sTitle;
      }
      task.updatedAt = Date.now();
      debounceSaveTasks();
      if (currentTasksGrouping === 'song') {
        currentSelectedTaskId = task.id;
        renderTasksWorkspace();
      }
    });

    // Assignee Change
    row.querySelector<HTMLSelectElement>('.task-assignee-select')?.addEventListener('change', (e) => {
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
    });

    // Due Date Change
    row.querySelector<HTMLInputElement>('.task-due-input')?.addEventListener('change', (e) => {
      task.dueDate = (e.target as HTMLInputElement).value || undefined;
      task.updatedAt = Date.now();
      const rightArea = row.querySelector('.reminders-task-right');
      if (rightArea) {
        let badge = rightArea.querySelector('.due-badge');
        if (task.dueDate) {
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'task-meta-badge due-badge';
            rightArea.insertBefore(badge, rightArea.querySelector('.reminders-info-btn'));
          }
          badge.textContent = formatShortDate(task.dueDate);
        } else if (badge) {
          badge.remove();
        }
      }
      debounceSaveTasks();
    });

    const titleInput = row.querySelector<HTMLInputElement>('.reminders-task-title-input');
    titleInput?.addEventListener('focus', () => {
      currentSelectedTaskId = task.id;
    });
    titleInput?.addEventListener('input', (e) => {
      task.title = (e.target as HTMLInputElement).value;
      task.updatedAt = Date.now();
      debounceSaveTasks();
    });
    titleInput?.addEventListener('blur', () => {
      task.title = titleInput.value.trim() || 'Untitled Task';
      task.updatedAt = Date.now();
      if (tasksSaveTimeout) {
        clearTimeout(tasksSaveTimeout);
        tasksSaveTimeout = null;
      }
      void saveTasksWorkspace();
    });

    // Subtask events
    row.querySelectorAll<HTMLElement>('.task-subtask-item').forEach((stItem) => {
      const sId = stItem.dataset.subtaskId;
      if (!sId) return;
      stItem.querySelector('.task-subtask-check')?.addEventListener('click', (e) => {
        e.stopPropagation();
        currentSelectedTaskId = task.id;
        toggleSubtask(task.id, sId);
      });
      stItem.querySelector('.task-subtask-del')?.addEventListener('click', (e) => {
        e.stopPropagation();
        currentSelectedTaskId = task.id;
        deleteSubtask(task.id, sId);
      });

      const subInput = stItem.querySelector<HTMLInputElement>('.task-subtask-text-input');
      subInput?.addEventListener('focus', () => {
        currentSelectedTaskId = task.id;
      });
      subInput?.addEventListener('input', (e) => {
        const sub = task.subtasks?.find((s) => s.id === sId);
        if (sub) {
          sub.title = (e.target as HTMLInputElement).value;
          task.updatedAt = Date.now();
          debounceSaveTasks();
        }
      });
      subInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const addInput = row.querySelector<HTMLInputElement>('.task-subtask-add-input');
          if (addInput) {
            addInput.focus();
          }
        }
      });
    });

    const subtaskAddInput = row.querySelector<HTMLInputElement>('.task-subtask-add-input');
    subtaskAddInput?.addEventListener('focus', () => {
      currentSelectedTaskId = task.id;
    });
    subtaskAddInput?.addEventListener('keydown', (ke) => {
      if (ke.key === 'Enter') {
        ke.preventDefault();
        const text = subtaskAddInput.value.trim();
        if (text) {
          currentSelectedTaskId = task.id;
          addSubtask(task.id, text);
          subtaskAddInput.value = '';
        }
      }
    });

    // Note textarea
    const noteTextarea = row.querySelector<HTMLTextAreaElement>('.task-note-textarea');
    if (noteTextarea) {
      const resizeNote = () => {
        noteTextarea.style.height = 'auto';
        noteTextarea.style.height = `${Math.max(20, noteTextarea.scrollHeight)}px`;
      };
      setTimeout(resizeNote, 0);

      noteTextarea.addEventListener('focus', () => {
        currentSelectedTaskId = task.id;
      });

      noteTextarea.addEventListener('input', () => {
        resizeNote();
        task.note = noteTextarea.value;
        task.updatedAt = Date.now();
        debounceSaveTasks();
      });

      noteTextarea.addEventListener('blur', () => {
        task.note = noteTextarea.value.trim() || undefined;
        task.updatedAt = Date.now();
        if (tasksSaveTimeout) {
          clearTimeout(tasksSaveTimeout);
          tasksSaveTimeout = null;
        }
        void saveTasksWorkspace();
      });
    }

    // Expand on Click / Selection
    row.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.reminders-check-btn, .reminders-info-btn, .task-subtask-check, .task-subtask-del')) {
        currentSelectedTaskId = task.id;
        document.querySelectorAll('.reminders-task-row.is-selected').forEach((r) => {
          if (r !== row) r.classList.remove('is-selected');
        });
        row.classList.add('is-selected');
      }
    });

    // Info Button (Apple Reminders Inspector)
    const infoBtn = row.querySelector<HTMLButtonElement>('.reminders-info-btn');
    infoBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      openTaskInspector(task, infoBtn);
    });

    // Right-Click Context Menu
    row.addEventListener('contextmenu', (e) => {
      showTaskContextMenu(e, task);
    });

    // Drag and Drop
    row.addEventListener('dragstart', (e) => {
      draggedTaskId = task.id;
      row.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }
    });

    row.addEventListener('dragend', () => {
      draggedTaskId = null;
      row.classList.remove('dragging');
      document.querySelectorAll('.reminders-task-row').forEach((r) => r.classList.remove('drag-over-top', 'drag-over-bottom'));
      document.querySelectorAll('.reminders-group-section').forEach((s) => s.classList.remove('drag-over'));
    });

    row.addEventListener('dragover', (e) => {
      if (!draggedTaskId || draggedTaskId === task.id) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

      const rect = row.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        row.classList.add('drag-over-top');
        row.classList.remove('drag-over-bottom');
      } else {
        row.classList.add('drag-over-bottom');
        row.classList.remove('drag-over-top');
      }
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    row.addEventListener('drop', (e) => {
      if (!draggedTaskId || draggedTaskId === task.id) return;
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove('drag-over-top', 'drag-over-bottom');

      const allTasks = getProjectTasks();
      const draggedIndex = allTasks.findIndex((t) => t.id === draggedTaskId);
      const targetIndex = allTasks.findIndex((t) => t.id === task.id);
      if (draggedIndex === -1 || targetIndex === -1) return;

      const [draggedItem] = allTasks.splice(draggedIndex, 1);

      // Inherit target properties
      if (currentTasksGrouping === 'song') {
        draggedItem.songId = task.songId;
        draggedItem.songTitle = task.songTitle;
      } else if (currentTasksGrouping === 'stage') {
        draggedItem.stage = task.stage;
      } else if (currentTasksGrouping === 'status') {
        draggedItem.status = task.status;
      }

      const rect = row.getBoundingClientRect();
      const insertAfter = e.clientY >= rect.top + rect.height / 2;
      const newTargetIndex = allTasks.findIndex((t) => t.id === task.id);
      const insertIndex = insertAfter ? newTargetIndex + 1 : newTargetIndex;
      allTasks.splice(insertIndex, 0, draggedItem);

      draggedItem.updatedAt = Date.now();
      currentSelectedTaskId = draggedItem.id;
      renderTasksWorkspace();
      debounceSaveTasks();
    });

    const canEdit = canUserEditProject();
    if (!canEdit) {
      row.removeAttribute('draggable');
      const checkBtn = row.querySelector<HTMLButtonElement>('.reminders-check-btn');
      if (checkBtn) {
        checkBtn.disabled = true;
        checkBtn.style.cursor = 'default';
        checkBtn.title = 'View only mode';
      }
      row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((el) => {
        el.disabled = true;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.readOnly = true;
      });
      row.querySelectorAll<HTMLElement>('.btn-del, .task-subtasks-add-row, .task-subtask-del').forEach((el) => {
        el.style.display = 'none';
      });
      row.querySelectorAll<HTMLButtonElement>('.task-subtask-check').forEach((el) => {
        el.disabled = true;
      });
    }

    return row;
  };

  // 11. Helper: Render Group Section
  const renderGroupSection = (group: {
    id: string;
    title: string;
    iconKey?: string;
    colorHex?: string;
    iconSvg?: string;
    tasks: ProjectTaskItem[];
    songRef?: ProjectSongItem;
    defaultSongId?: string;
    defaultStage?: ProjectTaskStage;
  }): HTMLElement => {
    const section = document.createElement('div');
    section.className = `reminders-group-section ${tasksCollapsedGroups.has(group.id) ? 'collapsed' : ''}`;
    section.dataset.groupId = group.id;

    const iconKey = group.songRef?.icon || group.iconKey || 'music';
    const colorHex = group.songRef?.color || group.colorHex || '#f43f5e';
    const iconSvg = SONG_ICONS[iconKey]?.svg || group.iconSvg || SONG_ICONS.music.svg;

    const header = document.createElement('div');
    header.className = 'reminders-group-header';
    header.innerHTML = `
      <div class="reminders-group-title-wrap">
        <span class="reminders-group-icon" style="color: ${colorHex};">
          ${iconSvg}
        </span>
        <h3 class="reminders-group-title">${escapeHtml(group.title)}</h3>
        <span class="reminders-group-count">${group.tasks.length}</span>
      </div>
      <div class="reminders-group-actions-right">
        <span class="reminders-group-chevron">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </span>
      </div>
    `;

    // Icon button click: open Customizer Popover
    const iconBtn = header.querySelector<HTMLButtonElement>('.reminders-group-icon-btn');
    if (iconBtn && group.songRef) {
      iconBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.song-customizer-popover').forEach((p) => p.remove());

        const popover = document.createElement('div');
        popover.className = 'song-customizer-popover';
        popover.innerHTML = `
          <div class="song-customizer-section-title">Track Icon</div>
          <div class="song-customizer-icons-grid">
            ${Object.entries(SONG_ICONS)
              .map(
                ([k, ic]) => `
              <button type="button" class="song-customizer-icon-item ${k === iconKey ? 'active' : ''}" data-icon-key="${k}" title="${escapeHtml(ic.label)}">
                ${ic.svg}
              </button>
            `
              )
              .join('')}
          </div>
          <div class="song-customizer-section-title" style="margin-top: 4px;">Track Color</div>
          <div class="song-customizer-colors-grid">
            ${SONG_COLORS.map(
              (c) => `
              <button type="button" class="song-customizer-color-dot ${c.hex === colorHex ? 'active' : ''}" data-color-hex="${c.hex}" title="${escapeHtml(c.name)}" style="background: ${c.hex};">
              </button>
            `
            ).join('')}
          </div>
        `;

        popover.addEventListener('click', (pe) => pe.stopPropagation());

        popover.querySelectorAll<HTMLButtonElement>('.song-customizer-icon-item').forEach((iBtn) => {
          iBtn.addEventListener('click', () => {
            const chosenKey = iBtn.dataset.iconKey;
            if (chosenKey && group.songRef) {
              group.songRef.icon = chosenKey;
              group.songRef.updatedAt = Date.now();
              void saveSongsWorkspace();
              renderTasksWorkspace();
              renderProjectSongsSelector();
            }
          });
        });

        popover.querySelectorAll<HTMLButtonElement>('.song-customizer-color-dot').forEach((cBtn) => {
          cBtn.addEventListener('click', () => {
            const chosenHex = cBtn.dataset.colorHex;
            if (chosenHex && group.songRef) {
              group.songRef.color = chosenHex;
              group.songRef.updatedAt = Date.now();
              void saveSongsWorkspace();
              renderTasksWorkspace();
              renderProjectSongsSelector();
            }
          });
        });

        section.appendChild(popover);

        const closeHandler = (docEv: MouseEvent) => {
          if (!popover.contains(docEv.target as Node) && docEv.target !== iconBtn) {
            popover.remove();
            document.removeEventListener('click', closeHandler);
          }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
      });
    }

    header.addEventListener('click', () => {
      if (tasksCollapsedGroups.has(group.id)) {
        tasksCollapsedGroups.delete(group.id);
        section.classList.remove('collapsed');
      } else {
        tasksCollapsedGroups.add(group.id);
        section.classList.add('collapsed');
      }
    });

    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'reminders-group-items';
    group.tasks.forEach((t) => itemsContainer.appendChild(renderListCard(t)));

    // Inline Quick Add Row at bottom of section
    const quickAddRow = document.createElement('div');
    quickAddRow.className = 'reminders-quick-add-row';
    quickAddRow.innerHTML = `
      <span class="reminders-dashed-circle"></span>
      <input type="text" class="reminders-quick-add-input" placeholder="" maxlength="150" />
    `;

    const quickInput = quickAddRow.querySelector<HTMLInputElement>('.reminders-quick-add-input');
    quickInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = quickInput.value.trim();
        if (val) {
          let songTitle: string | undefined;
          if (group.defaultSongId && activeProject?.workspace?.songs) {
            const s = activeProject.workspace.songs.find((x) => x.id === group.defaultSongId);
            songTitle = s?.title;
          }
          createTask(val, undefined, undefined, undefined, undefined, group.defaultSongId, songTitle, group.defaultStage);
          quickInput.value = '';
        }
      }
    });

    // Section-level Drag & Drop Target
    section.addEventListener('dragover', (e) => {
      if (!draggedTaskId) return;
      e.preventDefault();
      section.classList.add('drag-over');
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });

    section.addEventListener('dragleave', (e) => {
      if (!section.contains(e.relatedTarget as Node)) {
        section.classList.remove('drag-over');
      }
    });

    section.addEventListener('drop', (e) => {
      if (!draggedTaskId) return;
      e.preventDefault();
      section.classList.remove('drag-over');

      const allTasks = getProjectTasks();
      const draggedTask = allTasks.find((t) => t.id === draggedTaskId);
      if (!draggedTask) return;

      if (group.defaultSongId !== undefined) {
        if (group.defaultSongId === '') {
          draggedTask.songId = undefined;
          draggedTask.songTitle = undefined;
        } else {
          draggedTask.songId = group.defaultSongId;
          const s = activeProject?.workspace?.songs?.find((x) => x.id === group.defaultSongId);
          draggedTask.songTitle = s?.title;
        }
      }

      if (group.defaultStage !== undefined) {
        draggedTask.stage = group.defaultStage === 'general' ? undefined : group.defaultStage;
      }

      draggedTask.updatedAt = Date.now();
      currentSelectedTaskId = draggedTask.id;
      renderTasksWorkspace();
      debounceSaveTasks();
    });

    section.appendChild(header);
    section.appendChild(itemsContainer);
    section.appendChild(quickAddRow);
    return section;
  };

  // 12. Helper: Render Kanban Board
  const renderBoard = () => {
    const renderBoardCard = (task: ProjectTaskItem): HTMLElement => {
      const card = document.createElement('div');
      card.className = `board-task-card status-${task.status}`;
      card.dataset.taskId = task.id;
      card.setAttribute('draggable', 'true');

      const stageKey = task.stage || 'general';
      const stageCfg = STAGE_CONFIG[stageKey] || STAGE_CONFIG.general;
      const stageBadgeHtml = `<span class="task-stage-badge stage-${stageKey}">${stageCfg.iconSvg}<span>${escapeHtml(stageCfg.label)}</span></span>`;

      const linkedSong = songs.find((s) => s.id === task.songId);
      const songPillHtml = linkedSong
        ? `<span class="task-track-badge"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><span>${escapeHtml(linkedSong.title || 'Song')}</span></span>`
        : '';

      const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
      let subtasksPillHtml = '';
      if (subtasks.length > 0) {
        const doneSubs = subtasks.filter((s) => s.done).length;
        subtasksPillHtml = `<span class="task-subtasks-counter-pill"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><polyline points="20 6 9 17 4 12"/></svg><span>${doneSubs}/${subtasks.length}</span></span>`;
      }

      const assigneeInitial = task.assigneeName ? task.assigneeName.charAt(0).toUpperCase() : '';
      const assigneeHtml = task.assigneeName
        ? `<span class="board-card-assignee"><span class="task-meta-avatar">${escapeHtml(assigneeInitial)}</span><span>${escapeHtml(task.assigneeName)}</span></span>`
        : `<span class="board-card-assignee unassigned"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg><span>Unassigned</span></span>`;

      const dueHtml = task.dueDate
        ? `<span class="board-card-due" title="Due date"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg><span>${escapeHtml(formatShortDate(task.dueDate))}</span></span>`
        : '';

      card.innerHTML = `
        <div class="board-card-top-row">
          <span class="board-card-title">${escapeHtml(task.title)}</span>
        </div>
        <div class="board-card-meta-row">
          ${stageBadgeHtml}
          ${songPillHtml}
          ${assigneeHtml}
          ${dueHtml}
          ${subtasksPillHtml}
        </div>
      `;

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
        document.querySelectorAll('.board-column').forEach((col) => col.classList.remove('drag-over'));
      });

      // Right-click Context Menu
      card.addEventListener('contextmenu', (e) => {
        showTaskContextMenu(e, task);
      });

      return card;
    };

    const populateBoardInto = (
      todoEl: HTMLElement | null,
      inProgEl: HTMLElement | null,
      doneEl: HTMLElement | null,
      todoCountId: string,
      inProgCountId: string,
      doneCountId: string
    ) => {
      if (!todoEl || !inProgEl || !doneEl) return;
      todoEl.innerHTML = '';
      inProgEl.innerHTML = '';
      doneEl.innerHTML = '';

      const boardTasks = filteredTasks;
      const todoTasks = boardTasks.filter((t) => t.status === 'todo');
      const inProgTasks = boardTasks.filter((t) => t.status === 'in_progress');
      const doneTasks = boardTasks.filter((t) => t.status === 'done');

      setText(todoCountId, todoTasks.length.toString());
      setText(inProgCountId, inProgTasks.length.toString());
      setText(doneCountId, doneTasks.length.toString());

      todoTasks.forEach((t) => todoEl.appendChild(renderBoardCard(t)));
      inProgTasks.forEach((t) => inProgEl.appendChild(renderBoardCard(t)));
      doneTasks.forEach((t) => doneEl.appendChild(renderBoardCard(t)));
    };

    populateBoardInto(
      $('board-cards-todo'),
      $('board-cards-in_progress'),
      $('board-cards-done'),
      'board-count-todo',
      'board-count-in_progress',
      'board-count-done'
    );

    populateBoardInto(
      $('session-board-cards-todo'),
      $('session-board-cards-in_progress'),
      $('session-board-cards-done'),
      'session-board-count-todo',
      'session-board-count-in_progress',
      'session-board-count-done'
    );

    document.querySelectorAll<HTMLElement>('.board-column').forEach((col) => {
      const status = col.dataset.status as ProjectTaskStatus;
      if (!status) return;

      col.ondragover = (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        col.classList.add('drag-over');
      };

      col.ondragleave = () => {
        col.classList.remove('drag-over');
      };

      col.ondrop = (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const taskId = draggedTaskId || e.dataTransfer?.getData('text/plain');
        if (taskId) {
          updateTaskStatus(taskId, status);
        }
      };
    });
  };

  // 13. Render Grouped Sections or Flat List into Target Containers
  const renderTasksIntoList = (container: HTMLElement) => {
    container.innerHTML = '';

    if (currentTasksGrouping === 'song') {
      // Group by track
      const defaultTrackPalette = ['#f43f5e', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ec4899', '#f97316'];
      const trackGroups: { id: string; title: string; iconKey?: string; colorHex?: string; iconSvg?: string; tasks: ProjectTaskItem[]; songRef?: ProjectSongItem; defaultSongId?: string }[] = [];

      songs.forEach((s, idx) => {
        const sTasks = filteredTasks.filter((t) => t.songId === s.id);
        const color = s.color || defaultTrackPalette[idx % defaultTrackPalette.length];
        const iconKey = s.icon || 'music';
        trackGroups.push({
          id: `song_${s.id}`,
          title: s.title || `Song ${idx + 1}`,
          songRef: s,
          iconKey,
          colorHex: color,
          iconSvg: SONG_ICONS[iconKey]?.svg || SONG_ICONS.music.svg,
          tasks: sTasks,
          defaultSongId: s.id
        });
      });

      const unassignedTasks = filteredTasks.filter((t) => !t.songId || !songs.some((s) => s.id === t.songId));
      trackGroups.push({
        id: 'song_general',
        title: 'General Tasks',
        iconKey: 'tag',
        colorHex: '#94a3b8',
        iconSvg: SONG_ICONS.tag.svg,
        tasks: unassignedTasks,
        defaultSongId: ''
      });

      trackGroups.forEach((grp) => {
        container.appendChild(renderGroupSection(grp));
      });
    } else if (currentTasksGrouping === 'stage') {
      const stageKeys: ProjectTaskStage[] = ['writing', 'recording', 'arrangement', 'mix', 'mastering', 'revisions', 'general'];
      const stageColors: Record<ProjectTaskStage, string> = {
        writing: '#8b5cf6',
        recording: '#f43f5e',
        arrangement: '#06b6d4',
        mix: '#f59e0b',
        mastering: '#10b981',
        revisions: '#ec4899',
        general: '#94a3b8'
      };
      stageKeys.forEach((stg) => {
        const stgTasks = filteredTasks.filter((t) => (t.stage || 'general') === stg);
        const cfg = STAGE_CONFIG[stg] || STAGE_CONFIG.general;
        container.appendChild(
          renderGroupSection({
            id: `stage_${stg}`,
            title: cfg.label,
            colorHex: stageColors[stg] || '#94a3b8',
            iconSvg: cfg.iconSvg,
            tasks: stgTasks,
            defaultStage: stg === 'general' ? undefined : stg
          })
        );
      });
    } else if (currentTasksGrouping === 'status') {
      const statusGroups: { id: string; title: string; status: ProjectTaskStatus; colorHex: string; iconSvg: string }[] = [
        {
          id: 'status_todo',
          title: 'To Do',
          status: 'todo',
          colorHex: '#94a3b8',
          iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>'
        },
        {
          id: 'status_in_progress',
          title: 'In Progress',
          status: 'in_progress',
          colorHex: '#f59e0b',
          iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>'
        },
        {
          id: 'status_done',
          title: 'Done',
          status: 'done',
          colorHex: '#10b981',
          iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
        }
      ];
      statusGroups.forEach((grp) => {
        const sTasks = filteredTasks.filter((t) => t.status === grp.status);
        container.appendChild(
          renderGroupSection({
            id: grp.id,
            title: grp.title,
            colorHex: grp.colorHex,
            iconSvg: grp.iconSvg,
            tasks: sTasks
          })
        );
      });
    } else {
      // Flat list
      filteredTasks.forEach((t) => container.appendChild(renderListCard(t)));
    }
  };

  if (listContainer) renderTasksIntoList(listContainer);
  if (sessionListContainer) renderTasksIntoList(sessionListContainer);

  if (boardContainer || sessionBoardContainer) {
    renderBoard();
  }

  // 14. Render Overview Tasks Preview Card
  const overviewListEl = $('overview-tasks-list');
  if (overviewListEl) {
    overviewListEl.innerHTML = '';
    const pendingTasks = tasks.filter((t) => t.status !== 'done');
    setText('overview-tasks-count', pendingTasks.length.toString());

    if (pendingTasks.length === 0) {
      overviewListEl.innerHTML = `
        <div class="projects-empty" style="padding: 16px;">
          <p style="margin: 0; font-size: 12.5px; color: #94a3b8;">${tasks.length > 0 ? 'All production tasks are completed! 🎉' : 'No tasks added yet. Click All Tasks to start tracking your to-dos.'}</p>
        </div>
      `;
    } else {
      pendingTasks.slice(0, 5).forEach((task) => {
        const item = document.createElement('div');
        item.className = `overview-task-item status-${task.status}`;
        const assigneeBadge = task.assigneeName ? `<span class="overview-task-assignee">${escapeHtml(task.assigneeName)}</span>` : '';
        const dueBadge = task.dueDate ? `<span class="overview-task-due">Due ${escapeHtml(task.dueDate)}</span>` : '';
        item.innerHTML = `
          <button type="button" class="reminders-check-btn" title="Mark as Done">
            ${task.status === 'done' ? '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
          </button>
          <span class="overview-task-title">${escapeHtml(task.title)}</span>
          ${assigneeBadge}
          ${dueBadge}
        `;
        item.querySelector('.reminders-check-btn')?.addEventListener('click', (e) => {
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
  note?: string,
  songId?: string,
  songTitle?: string,
  stage?: ProjectTaskStage
): void {
  if (!canUserEditProject()) return;
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
    songId: songId || undefined,
    songTitle: songTitle || undefined,
    stage: stage || undefined,
    subtasks: [],
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
  if (!canUserEditProject()) return;
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
  if (!canUserEditProject()) return;
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
  if (!canUserEditProject()) return;
  const tasks = getProjectTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return;
  tasks.splice(idx, 1);
  renderTasksWorkspace();
  debounceSaveTasks();
}

// 15. Event Listeners for Apple Reminders Tasks Workspace
// Search Input Live Filter
$('tasks-search-input')?.addEventListener('input', (e) => {
  currentTasksSearchQuery = (e.target as HTMLInputElement).value.trim();
  const sessionSearch = $<HTMLInputElement>('session-tasks-search-input');
  if (sessionSearch && sessionSearch.value !== currentTasksSearchQuery) sessionSearch.value = currentTasksSearchQuery;
  renderTasksWorkspace();
});

$('session-tasks-search-input')?.addEventListener('input', (e) => {
  currentTasksSearchQuery = (e.target as HTMLInputElement).value.trim();
  const mainSearch = $<HTMLInputElement>('tasks-search-input');
  if (mainSearch && mainSearch.value !== currentTasksSearchQuery) mainSearch.value = currentTasksSearchQuery;
  renderTasksWorkspace();
});

// Group By Select
$('tasks-group-by')?.addEventListener('change', (e) => {
  currentTasksGrouping = ((e.target as HTMLSelectElement).value as any) || 'song';
  renderTasksWorkspace();
});

$('session-tasks-group-by')?.addEventListener('change', (e) => {
  currentTasksGrouping = ((e.target as HTMLSelectElement).value as any) || 'song';
  renderTasksWorkspace();
});

// Toggle Show/Hide Completed
$('btn-tasks-toggle-completed')?.addEventListener('click', () => {
  showCompletedTasks = !showCompletedTasks;
  renderTasksWorkspace();
});

$('session-btn-tasks-toggle-completed')?.addEventListener('click', () => {
  showCompletedTasks = !showCompletedTasks;
  renderTasksWorkspace();
});

// Click on empty window background to collapse open task
document.addEventListener('pointerdown', (e) => {
  const target = e.target as HTMLElement;
  if (!target) return;
  if (target.closest('.reminders-task-row, .reminders-inspector-popover, .task-context-menu, .song-customizer-popover, select, option, .task-action-pill')) {
    return;
  }
  if (currentSelectedTaskId !== null) {
    currentSelectedTaskId = null;
    document.querySelectorAll('.reminders-task-row.is-selected').forEach((r) => r.classList.remove('is-selected'));
  }
});

// Create Task Form Submit (Main Workspace)
$('form-create-task')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const titleInput = $<HTMLInputElement>('task-new-title');
  const songSelect = $<HTMLSelectElement>('task-new-song');
  const stageSelect = $<HTMLSelectElement>('task-new-stage');
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

  const songId = songSelect?.value || undefined;
  let songTitle: string | undefined;
  if (songId && activeProject?.workspace?.songs) {
    const matched = activeProject.workspace.songs.find((s) => s.id === songId);
    songTitle = matched?.title;
  }

  const stageVal = stageSelect?.value as ProjectTaskStage | 'general';
  const stage = stageVal && stageVal !== 'general' ? stageVal : undefined;
  const dueDate = dateInput?.value || undefined;

  createTask(title, aId, aName, dueDate, undefined, songId, songTitle, stage);
  titleInput.value = '';
  titleInput.focus();
});

// Create Task Form Submit (In-Session Drawer)
$('session-form-create-task')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const titleInput = $<HTMLInputElement>('session-task-new-title');
  const songSelect = $<HTMLSelectElement>('session-task-new-song');
  const stageSelect = $<HTMLSelectElement>('session-task-new-stage');
  const assigneeSelect = $<HTMLSelectElement>('session-task-new-assignee');
  const dateInput = $<HTMLInputElement>('session-task-new-duedate');
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

  const songId = songSelect?.value || undefined;
  let songTitle: string | undefined;
  if (songId && activeProject?.workspace?.songs) {
    const matched = activeProject.workspace.songs.find((s) => s.id === songId);
    songTitle = matched?.title;
  }

  const stageVal = stageSelect?.value as ProjectTaskStage | 'general';
  const stage = stageVal && stageVal !== 'general' ? stageVal : undefined;
  const dueDate = dateInput?.value || undefined;

  createTask(title, aId, aName, dueDate, undefined, songId, songTitle, stage);
  titleInput.value = '';
  titleInput.focus();
});

// View Switcher Handlers
$('btn-tasks-view-list')?.addEventListener('click', () => {
  currentTasksViewMode = 'list';
  renderTasksWorkspace();
});

$('session-btn-tasks-view-list')?.addEventListener('click', () => {
  currentTasksViewMode = 'list';
  renderTasksWorkspace();
});

$('btn-tasks-view-board')?.addEventListener('click', () => {
  currentTasksViewMode = 'board';
  renderTasksWorkspace();
});

$('session-btn-tasks-view-board')?.addEventListener('click', () => {
  currentTasksViewMode = 'board';
  renderTasksWorkspace();
});

// Filter Dropdown Handlers
$('tasks-filter-song')?.addEventListener('change', (e) => {
  currentTasksSongFilter = (e.target as HTMLSelectElement).value || 'all';
  renderTasksWorkspace();
});

$('session-tasks-filter-song')?.addEventListener('change', (e) => {
  currentTasksSongFilter = (e.target as HTMLSelectElement).value || 'all';
  renderTasksWorkspace();
});

$('tasks-filter-stage')?.addEventListener('change', (e) => {
  currentTasksStageFilter = (e.target as HTMLSelectElement).value || 'all';
  renderTasksWorkspace();
});

$('session-tasks-filter-stage')?.addEventListener('change', (e) => {
  currentTasksStageFilter = (e.target as HTMLSelectElement).value || 'all';
  renderTasksWorkspace();
});

// View All Tasks from Overview
$('btn-overview-view-tasks')?.addEventListener('click', () => {
  const taskTabBtn = document.querySelector<HTMLButtonElement>('.project-tab-btn[data-tab="tasks"]');
  taskTabBtn?.click();
});

// ========================================================
// SONG SWITCHER & MANAGEMENT DOM LISTENERS
// ========================================================
$('btn-active-song-trigger')?.addEventListener('click', (e) => {
  e.stopPropagation();
  $('project-songs-dropdown-menu')?.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  const menu = $('project-songs-dropdown-menu');
  if (menu && !menu.contains(e.target as Node) && e.target !== $('btn-active-song-trigger')) {
    menu.classList.add('hidden');
  }
});

const quickCreateNextSong = () => {
  if (!canUserEditProject()) return;
  const songs = activeProject?.workspace?.songs || [];
  const nextNum = songs.length + 1;
  currentSongsOverviewPage = Math.ceil(nextNum / SONGS_PER_PAGE);
  createNewSong(`Song ${nextNum}`);
  $('project-songs-dropdown-menu')?.classList.add('hidden');
};

const openNewSongModal = () => {
  if (!canUserEditProject()) return;
  quickCreateNextSong();
};

const closeNewSongModal = () => {
  $('new-song-modal')?.classList.add('hidden');
};

$('btn-songs-prev-page')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (currentSongsOverviewPage > 1) {
    currentSongsOverviewPage--;
    renderProjectOverviewSongsList();
  }
});

$('btn-songs-next-page')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const songs = activeProject?.workspace?.songs || [];
  const totalPages = Math.ceil(songs.length / SONGS_PER_PAGE) || 1;
  if (currentSongsOverviewPage < totalPages) {
    currentSongsOverviewPage++;
    renderProjectOverviewSongsList();
  }
});

$('btn-quick-new-song')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!canUserEditProject()) return;
  quickCreateNextSong();
});

$('btn-open-new-song-modal')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!canUserEditProject()) return;
  quickCreateNextSong();
});

$('btn-overview-new-song')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!canUserEditProject()) return;
  quickCreateNextSong();
});

$('btn-session-new-song')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!canUserEditProject()) return;
  quickCreateNextSong();
});

$('btn-back-to-project-overview')?.addEventListener('click', () => {
  closeSongStudio();
});

// Double-click to rename active song inside Song Studio Header
$('song-studio-active-title')?.parentElement?.addEventListener('dblclick', (e) => {
  e.stopPropagation();
  e.preventDefault();
  if (!canUserEditProject()) return;
  const titleEl = $('song-studio-active-title');
  if (!titleEl || titleEl.querySelector('input')) return;
  const activeSong = getActiveSong();
  const currentTitle = activeSong.title || 'Untitled Song';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'song-inline-rename-input';
  input.value = currentTitle;
  input.maxLength = 80;

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== currentTitle) {
      activeSong.title = newTitle;
      void saveSongsWorkspace();
    }
    renderProjectSongsSelector();
  };

  input.addEventListener('keydown', (ke) => {
    if (ke.key === 'Enter') {
      ke.preventDefault();
      commit();
    } else if (ke.key === 'Escape') {
      ke.preventDefault();
      committed = true;
      renderProjectSongsSelector();
    }
  });
  input.addEventListener('click', (ce) => ce.stopPropagation());
  input.addEventListener('dblclick', (de) => de.stopPropagation());
  input.addEventListener('blur', commit);

  titleEl.replaceChildren(input);
  input.focus();
  input.select();
});

// Song Studio Tab Buttons (Lyrics, Structure, Notes)
document.querySelectorAll<HTMLButtonElement>('.song-studio-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetSongTab = btn.dataset.songTab as 'lyrics' | 'structure' | 'notes';
    if (!targetSongTab) return;
    currentSongStudioTab = targetSongTab;
    document.querySelectorAll<HTMLButtonElement>('.song-studio-tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    $('project-panel-lyrics')?.classList.toggle('hidden', targetSongTab !== 'lyrics');
    $('project-panel-structure')?.classList.toggle('hidden', targetSongTab !== 'structure');
    $('project-panel-notes')?.classList.toggle('hidden', targetSongTab !== 'notes');
    if (targetSongTab === 'lyrics') {
      setTimeout(() => updateLyricsDocumentPagination(), 20);
    }
    applyWorkspacePermissions();
  });
});

// Quick Switch Song Dropdown inside Song Studio
$<HTMLSelectElement>('select-song-studio-quick-switch')?.addEventListener('change', (e) => {
  const targetId = (e.target as HTMLSelectElement).value;
  if (targetId) {
    switchActiveSong(targetId);
    openSongStudio(targetId, currentSongStudioTab);
  }
});

$('btn-close-new-song-modal')?.addEventListener('click', closeNewSongModal);
$('btn-cancel-new-song')?.addEventListener('click', closeNewSongModal);

$('btn-confirm-create-song')?.addEventListener('click', () => {
  const input = $<HTMLInputElement>('input-new-song-title');
  const title = input?.value.trim() || '';
  if (!title) {
    const err = $('new-song-error');
    if (err) {
      err.textContent = 'Please enter a song title.';
      err.classList.remove('hidden');
    }
    return;
  }
  createNewSong(title);
  closeNewSongModal();
});

$('input-new-song-title')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('btn-confirm-create-song')?.click();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeNewSongModal();
  }
});

// Song Title Preset Chips
document.querySelectorAll<HTMLButtonElement>('.btn-song-title-preset').forEach((btn) => {
  btn.addEventListener('click', () => {
    const title = btn.dataset.title;
    const input = $<HTMLInputElement>('input-new-song-title');
    if (input && title) {
      input.value = title;
      input.focus();
    }
  });
});

// Drawer Song Select Change
$<HTMLSelectElement>('session-workspace-song-select')?.addEventListener('change', (e) => {
  const targetId = (e.target as HTMLSelectElement).value;
  if (targetId) {
    switchActiveSong(targetId);
  }
});

// ========================================================
// ACTIVITY HISTORY & SESSION CHAT SUBSYSTEMS
// ========================================================
initActivityHistory(() => activeProject ?? null, () => auth.getUser());
initSessionChat({ getSessionCode: () => currentCode, signaling });

// ========================================================
// LOGIC PRO STYLE STUDIO MULTITRACK MIXER SUBSYSTEM
// ========================================================
interface StudioMixerChannel {
  id: string;
  name: string;
  icon: string;
  color: string;
  volume: number; // 0 to 1.5 (1.0 = 0 dB)
  pan: number; // -1 to 1 (0 = Center)
  muted: boolean;
  soloed: boolean;
  fx: string[];
  isMaster?: boolean;
  section?: 'local' | 'remote';
}

const STUDIO_ICONS: Record<string, { label: string; svg: string }> = {
  mic: {
    label: 'Studio Condenser Mic',
    svg: `<svg viewBox="0 0 24 36" width="20" height="32" fill="none">
      <path d="M7 14V8a5 5 0 0 1 10 0v6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="7" y1="14" x2="17" y2="14" stroke="currentColor" stroke-width="2.2"/>
      <path d="M7 14h10v12a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2V14Z" fill="currentColor"/>
      <path d="M10 28h4v3a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3Z" fill="currentColor"/>
    </svg>`
  },
  guitar: {
    label: 'Acoustic / Electric Guitar',
    svg: `<svg viewBox="0 0 36 36" width="30" height="30" fill="currentColor">
      <rect x="24" y="3" width="2.5" height="3.5" rx="0.8"/>
      <path d="M24.5 6.5l-8 8 1.8 1.8 8-8z"/>
      <path d="M16 15.5c-1-.5-2.2-.4-3.2.3-1.8 1.2-2.8 1.4-4.2.8-1.5-.7-3.2 0-3.9 1.5-.8 1.7-.3 3.6 1.2 4.6l.8.5c-.8 1.5-.5 3.4.8 4.6 1.4 1.3 3.5 1.5 5 .5l.5-.3c1.1 1.4 3 1.8 4.6 1 1.6-.8 2.3-2.6 1.5-4.2-.5-1.3-.2-2.3.8-3.9.7-.9.9-2.2.3-3.2l-4.2-2.2Z"/>
      <circle cx="12" cy="21.5" r="1.6" fill="#464649"/>
    </svg>`
  },
  waves: {
    label: 'Waveform Track',
    svg: `<svg viewBox="0 0 32 32" width="28" height="28" fill="currentColor">
      <rect x="3" y="10" width="3.6" height="12" rx="1.8"/>
      <rect x="9" y="6" width="3.6" height="20" rx="1.8"/>
      <rect x="15" y="2" width="3.6" height="28" rx="1.8"/>
      <rect x="21" y="6" width="3.6" height="20" rx="1.8"/>
      <rect x="27" y="10" width="3.6" height="12" rx="1.8"/>
    </svg>`
  },
  fader: {
    label: 'Track Channel Fader',
    svg: `<svg viewBox="0 0 32 32" width="28" height="28">
      <circle cx="16" cy="16" r="14" fill="currentColor"/>
      <line x1="16" x2="16" y1="7" y2="25" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
      <rect x="11.5" y="12" width="9" height="7" rx="1.8" fill="#ffffff"/>
      <line x1="12" x2="20" y1="15.5" x2="20" stroke="currentColor" stroke-width="1.5"/>
    </svg>`
  },
  headphones: {
    label: 'Headphones / Monitor',
    svg: `<svg viewBox="0 0 30 30" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 17v-4a11 11 0 0 1 22 0v4"/>
      <rect x="2" y="15" width="5.5" height="10" rx="2.5" fill="currentColor"/>
      <rect x="22.5" y="15" width="5.5" height="10" rx="2.5" fill="currentColor"/>
    </svg>`
  },
  speaker: {
    label: 'Speaker / Monitor Out',
    svg: `<svg viewBox="0 0 30 30" width="28" height="28" fill="currentColor">
      <path d="M13 5L6.5 10H2v10h4.5L13 25V5z"/>
      <path d="M18 10a7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M22 6a12.5 12.5 0 0 1 0 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
    </svg>`
  },
  piano: {
    label: 'Piano / Keys',
    svg: `<svg viewBox="0 0 30 26" width="30" height="26" fill="currentColor">
      <rect x="2" y="3" width="26" height="20" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
      <path d="M2 13h26" stroke="currentColor" stroke-width="1.8"/>
      <rect x="6.5" y="4" width="3.2" height="8" rx="0.8" fill="currentColor"/>
      <rect x="11.5" y="4" width="3.2" height="8" rx="0.8" fill="currentColor"/>
      <rect x="18.5" y="4" width="3.2" height="8" rx="0.8" fill="currentColor"/>
      <rect x="23.5" y="4" width="3.2" height="8" rx="0.8" fill="currentColor"/>
    </svg>`
  },
  drums: {
    label: 'Drums / Beat',
    svg: `<svg viewBox="0 0 30 30" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <ellipse cx="15" cy="9" rx="11" ry="5" fill="currentColor" fill-opacity="0.25"/>
      <path d="M4 9v11c0 2.8 5 5 11 5s11-2.2 11-5V9"/>
      <line x1="8" y1="12" x2="8" y2="23"/>
      <line x1="15" y1="14" x2="15" y2="25"/>
      <line x1="22" y1="12" x2="22" y2="23"/>
    </svg>`
  },
  synth: {
    label: 'Synth / Hardware',
    svg: `<svg viewBox="0 0 30 30" width="28" height="28" fill="currentColor">
      <rect x="3" y="4" width="24" height="22" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
      <line x1="8" y1="8" x2="8" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="15" y1="8" x2="15" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="22" y1="8" x2="22" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <rect x="5.5" y="11" width="5" height="3" rx="1.2" fill="currentColor"/>
      <rect x="12.5" y="16" width="5" height="3" rx="1.2" fill="currentColor"/>
      <rect x="19.5" y="9" width="5" height="3" rx="1.2" fill="currentColor"/>
    </svg>`
  },
  screen: {
    label: 'Screen / App Capture',
    svg: `<svg viewBox="0 0 30 30" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="24" height="17" rx="3" fill="currentColor" fill-opacity="0.25"/>
      <line x1="10" y1="26" x2="20" y2="26"/>
      <line x1="15" y1="21" x2="15" y2="26"/>
    </svg>`
  },
  crown: {
    label: 'Master / Bus',
    svg: `<svg viewBox="0 0 30 30" width="28" height="28" fill="currentColor">
      <path d="M3 7l5 13h14l5-13-7 5.5-5-8.5-5 8.5L3 7z"/>
      <rect x="5" y="22" width="20" height="3" rx="1.5"/>
    </svg>`
  },
  radio: {
    label: 'Broadcast Stream',
    svg: `<svg viewBox="0 0 30 30" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <circle cx="15" cy="15" r="3" fill="currentColor"/>
      <path d="M20.3 9.7a7.5 7.5 0 0 1 0 10.6m-10.6 0a7.5 7.5 0 0 1 0-10.6"/>
      <path d="M24.5 5.5a13.5 13.5 0 0 1 0 19m-19 0a13.5 13.5 0 0 1 0-19"/>
    </svg>`
  }
};

interface PersistentStudioMixerChannel {
  name?: string;
  icon?: string;
  color?: string;
  volume?: number;
  pan?: number;
  fx?: string[];
}

type PersistentStudioMixerMap = Record<string, PersistentStudioMixerChannel>;

const STUDIO_MIXER_STORAGE_KEY = 'jameet-studio-mixer-config';

function loadSavedStudioMixerConfig(): PersistentStudioMixerMap {
  try {
    const raw = localStorage.getItem(STUDIO_MIXER_STORAGE_KEY) ?? localStorage.getItem('musiczoom-studio-mixer-config');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as PersistentStudioMixerMap;
    }
  } catch (err) {
    logger.warn('mixer_storage', 'Failed to load persistent studio mixer configuration', {}, err);
  }
  return {};
}

let mixerSaveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function saveStudioMixerConfig(immediate = true): void {
  if (!immediate) {
    if (mixerSaveDebounceTimer) clearTimeout(mixerSaveDebounceTimer);
    mixerSaveDebounceTimer = setTimeout(() => {
      mixerSaveDebounceTimer = null;
      saveStudioMixerConfig(true);
    }, 300);
    return;
  }
  if (mixerSaveDebounceTimer) {
    clearTimeout(mixerSaveDebounceTimer);
    mixerSaveDebounceTimer = null;
  }
  try {
    const map = loadSavedStudioMixerConfig();
    const MASTER_GOLD = '#f59e0b';
    for (const ch of studioMixerChannels) {
      if (ch.id === 'master-out' || ch.isMaster) {
        map[ch.id] = {
          name: ch.name,
          icon: ch.icon,
          color: MASTER_GOLD,
          volume: typeof ch.volume === 'number' && !isNaN(ch.volume) ? ch.volume : 1.0
        };
      } else {
        map[ch.id] = {
          name: ch.name,
          icon: ch.icon,
          color: ch.color,
          volume: typeof ch.volume === 'number' && !isNaN(ch.volume) ? ch.volume : 1.0,
          pan: typeof ch.pan === 'number' && !isNaN(ch.pan) ? ch.pan : 0,
          fx: Array.isArray(ch.fx) ? [...ch.fx] : []
        };
      }
    }
    localStorage.setItem(STUDIO_MIXER_STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    logger.warn('mixer_storage', 'Failed to save persistent studio mixer configuration', {}, err);
  }
}

let studioMixerOpen = false;
let studioMixerChannels: StudioMixerChannel[] = [];

function syncMixerChannelsWithVoiceInputs(): void {
  const savedMap = loadSavedStudioMixerConfig();
  const enabledMics = (prefs.voiceInputs && prefs.voiceInputs.length > 0)
    ? prefs.voiceInputs.filter((v) => v.enabled)
    : [{ id: 1, name: 'Microphone 1', enabled: true, gain: 1, channelRoute: '1' }];

  // Preserve existing in-memory channel settings (during active session runtime)
  const existingMap = new Map<string, StudioMixerChannel>();
  studioMixerChannels.forEach((ch) => existingMap.set(ch.id, ch));

  const DEFAULT_APP_BLUE = '#3b82f6';
  const MASTER_GOLD = '#f59e0b';

  const newLocalMicChannels: StudioMixerChannel[] = enabledMics.map((mic) => {
    const chId = mic.id === 1 ? 'you-mic' : `you-mic-${mic.id}`;
    const existing = existingMap.get(chId) || (mic.id === 1 ? existingMap.get('you-mic-1') : undefined);
    const saved = savedMap[chId] || (mic.id === 1 ? savedMap['you-mic-1'] : undefined);

    const defaultName = mic.id === 1 ? 'Mic 1' : `Mic ${mic.id}`;
    const name = existing?.name ?? saved?.name ?? defaultName;
    const icon = existing?.icon ?? saved?.icon ?? 'mic';
    const rawColor = existing?.color ?? saved?.color ?? DEFAULT_APP_BLUE;
    const color = rawColor === MASTER_GOLD ? DEFAULT_APP_BLUE : rawColor;
    const volume = existing?.volume ?? saved?.volume ?? (mic.gain ?? 1.0);
    const pan = existing?.pan ?? saved?.pan ?? 0;
    const fx = existing?.fx ?? (saved?.fx ? [...saved.fx] : []);

    return {
      id: chId,
      name,
      icon,
      color,
      volume,
      pan,
      muted: existing?.muted ?? false,
      soloed: existing?.soloed ?? false,
      fx,
      section: 'local'
    };
  });

  // Local music stream
  const existingMusic = existingMap.get('music-stream');
  const savedMusic = savedMap['music-stream'];
  const musicCh: StudioMixerChannel = {
    id: 'music-stream',
    name: existingMusic?.name ?? savedMusic?.name ?? 'Music',
    icon: existingMusic?.icon ?? savedMusic?.icon ?? 'waves',
    color: (existingMusic?.color ?? savedMusic?.color) === '#a855f7' ? DEFAULT_APP_BLUE : (existingMusic?.color ?? savedMusic?.color ?? DEFAULT_APP_BLUE),
    volume: existingMusic?.volume ?? savedMusic?.volume ?? 1.0,
    pan: existingMusic?.pan ?? savedMusic?.pan ?? 0,
    muted: existingMusic?.muted ?? false,
    soloed: existingMusic?.soloed ?? false,
    fx: existingMusic?.fx ?? (savedMusic?.fx ? [...savedMusic.fx] : []),
    section: 'local'
  };

  // Remote Section
  const existingRemoteVoice = existingMap.get('remote-voice');
  const savedRemoteVoice = savedMap['remote-voice'];
  let remoteVoiceName = existingRemoteVoice?.name ?? savedRemoteVoice?.name ?? 'Vocal';
  if (remoteVoiceName === 'Mic 1') remoteVoiceName = 'Vocal';
  const remoteVoiceColor = (existingRemoteVoice?.color ?? savedRemoteVoice?.color) === '#22c55e'
    ? DEFAULT_APP_BLUE
    : (existingRemoteVoice?.color ?? savedRemoteVoice?.color ?? DEFAULT_APP_BLUE);

  const remoteVoiceCh: StudioMixerChannel = {
    id: 'remote-voice',
    name: remoteVoiceName,
    icon: existingRemoteVoice?.icon ?? savedRemoteVoice?.icon ?? 'mic',
    color: remoteVoiceColor,
    volume: existingRemoteVoice?.volume ?? savedRemoteVoice?.volume ?? 1.0,
    pan: existingRemoteVoice?.pan ?? savedRemoteVoice?.pan ?? 0,
    muted: existingRemoteVoice?.muted ?? false,
    soloed: existingRemoteVoice?.soloed ?? false,
    fx: existingRemoteVoice?.fx ?? (savedRemoteVoice?.fx ? [...savedRemoteVoice.fx] : []),
    section: 'remote'
  };

  const existingRemoteMusic = existingMap.get('remote-music');
  const savedRemoteMusic = savedMap['remote-music'];
  const remoteMusicColor = (existingRemoteMusic?.color ?? savedRemoteMusic?.color) === '#06b6d4'
    ? DEFAULT_APP_BLUE
    : (existingRemoteMusic?.color ?? savedRemoteMusic?.color ?? DEFAULT_APP_BLUE);

  const remoteMusicCh: StudioMixerChannel = {
    id: 'remote-music',
    name: existingRemoteMusic?.name ?? savedRemoteMusic?.name ?? 'Music',
    icon: existingRemoteMusic?.icon ?? savedRemoteMusic?.icon ?? 'waves',
    color: remoteMusicColor,
    volume: existingRemoteMusic?.volume ?? savedRemoteMusic?.volume ?? 1.0,
    pan: existingRemoteMusic?.pan ?? savedRemoteMusic?.pan ?? 0,
    muted: existingRemoteMusic?.muted ?? false,
    soloed: existingRemoteMusic?.soloed ?? false,
    fx: existingRemoteMusic?.fx ?? (savedRemoteMusic?.fx ? [...savedRemoteMusic.fx] : []),
    section: 'remote'
  };

  const existingMaster = existingMap.get('master-out');
  const savedMaster = savedMap['master-out'];
  let masterName = existingMaster?.name ?? savedMaster?.name ?? 'Monitor Master';
  if (masterName === 'Master') masterName = 'Monitor Master';

  const masterOutCh: StudioMixerChannel = {
    id: 'master-out',
    name: masterName,
    icon: existingMaster?.icon ?? savedMaster?.icon ?? 'crown',
    color: MASTER_GOLD,
    volume: existingMaster?.volume ?? savedMaster?.volume ?? 1.0,
    pan: 0,
    muted: existingMaster?.muted ?? false,
    soloed: false,
    fx: [],
    isMaster: true,
    section: 'remote'
  };

  studioMixerChannels = [
    ...newLocalMicChannels,
    musicCh,
    remoteVoiceCh,
    remoteMusicCh,
    masterOutCh
  ];

  if (studioMixerOpen) {
    renderStudioMixer();
    applyMixerAudioRouting();
  }
}

syncMixerChannelsWithVoiceInputs();
function faderTopPercentToDb(pct: number): number {
  if (pct >= 98.5) return -Infinity;
  if (pct <= 2.0) return 6.0;
  if (pct <= 16.0) {
    return 6.0 - ((pct - 2.0) / 14.0) * 6.0;
  } else if (pct <= 32.0) {
    return 0.0 - ((pct - 16.0) / 16.0) * 6.0;
  } else if (pct <= 48.0) {
    return -6.0 - ((pct - 32.0) / 16.0) * 6.0;
  } else if (pct <= 74.0) {
    return -12.0 - ((pct - 48.0) / 26.0) * 12.0;
  } else if (pct <= 92.0) {
    return -24.0 - ((pct - 74.0) / 18.0) * 16.0;
  } else {
    return -40.0 - ((pct - 92.0) / 6.5) * 25.0;
  }
}

function dbToFaderTopPercent(db: number): number {
  if (db === -Infinity || db <= -65) return 98.5;
  if (db >= 6.0) return 2.0;
  if (db >= 0.0) {
    return 2.0 + ((6.0 - db) / 6.0) * 14.0;
  } else if (db >= -6.0) {
    return 16.0 + ((-db) / 6.0) * 16.0;
  } else if (db >= -12.0) {
    return 32.0 + ((-db - 6.0) / 6.0) * 16.0;
  } else if (db >= -24.0) {
    return 48.0 + ((-db - 12.0) / 12.0) * 26.0;
  } else if (db >= -40.0) {
    return 74.0 + ((-db - 24.0) / 16.0) * 18.0;
  } else {
    return 92.0 + ((-db - 40.0) / 25.0) * 6.5;
  }
}

function dbToGain(db: number): number {
  if (db === -Infinity || db <= -65) return 0;
  return Math.pow(10, db / 20);
}

function formatDbText(db: number): string {
  if (db === -Infinity || db <= -65) return '-∞';
  if (Math.abs(db) < 0.05) return '0.0';
  return db > 0 ? `+${db.toFixed(1)}` : `${db.toFixed(1)}`;
}

function formatPeakDbText(db: number): string {
  if (db === -Infinity || db <= -55) return '';
  if (Math.abs(db) < 0.05) return '0.0';
  return db > 0 ? `+${db.toFixed(1)}` : `${db.toFixed(1)}`;
}

function volumeToDb(vol: number): string {
  if (vol <= 0.0001) return '-∞';
  const db = 20 * Math.log10(vol);
  return formatDbText(db);
}

function getPanBackground(pan: number): string {
  const panVal = Math.round(pan * 50); // -50 to +50
  if (panVal === 0) return '#232326';
  if (panVal > 0) {
    const deg = (panVal / 50) * 140;
    return `conic-gradient(from 0deg, #22c55e 0deg, #22c55e ${deg.toFixed(1)}deg, #232326 ${deg.toFixed(1)}deg, #232326 360deg)`;
  } else {
    const deg = (-panVal / 50) * 140;
    const startDeg = 360 - deg;
    return `conic-gradient(from 0deg, #232326 0deg, #232326 ${startDeg.toFixed(1)}deg, #22c55e ${startDeg.toFixed(1)}deg, #22c55e 360deg)`;
  }
}

function panToReadout(pan: number): string {
  const val = Math.round(pan * 50);
  if (val === 0) return '0';
  return val > 0 ? `+${val}` : `${val}`;
}

function panToLabel(pan: number): string {
  const val = Math.round(pan * 50);
  if (val === 0) return '0';
  return val > 0 ? `+${val}` : `${val}`;
}

let activeFxTarget: { channelId: string; slotIndex: number } | null = null;
let activeIconTarget: string | null = null;
let mixerVuAnimationId: number | null = null;

function toggleStudioMixer(forceOpen?: boolean): void {
  const modal = $('session-studio-mixer-modal');
  if (!modal) return;
  studioMixerOpen = forceOpen !== undefined ? forceOpen : !studioMixerOpen;
  modal.classList.toggle('hidden', !studioMixerOpen);
  $('toggle-session-mixer')?.classList.toggle('active', studioMixerOpen);

  if (studioMixerOpen) {
    try {
      syncMixerChannelsWithVoiceInputs();
      renderStudioMixer();
      startMixerVuAnimation();
    } catch (err) {
      console.error('Failed to render studio mixer:', err);
    }
  } else {
    stopMixerVuAnimation();
    $('mixer-fx-picker-popover')?.classList.add('hidden');
    $('mixer-icon-picker-popover')?.classList.add('hidden');
  }
}

const timeDomainBuffer = new Float32Array(256);

function measureTimeDomainLevel(analyser: AnalyserNode | undefined): { rmsDb: number; peakDb: number } {
  if (!analyser) return { rmsDb: -60, peakDb: -60 };
  try {
    analyser.getFloatTimeDomainData(timeDomainBuffer);
  } catch {
    return { rmsDb: -60, peakDb: -60 };
  }

  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < timeDomainBuffer.length; i++) {
    const s = timeDomainBuffer[i];
    const abs = Math.abs(s);
    if (abs > peak) peak = abs;
    sumSq += s * s;
  }

  const rms = Math.sqrt(sumSq / timeDomainBuffer.length);
  const rmsDb = rms > 0.001 ? Math.max(-60, 20 * Math.log10(rms)) : -60;
  const peakDb = peak > 0.001 ? Math.max(-60, 20 * Math.log10(peak)) : -60;

  return { rmsDb, peakDb };
}

function getStereoPanGains(pan: number): { left: number; right: number } {
  const clamped = Math.max(-1, Math.min(1, pan));
  const left = clamped <= 0 ? 1.0 : Math.max(0, 1.0 - clamped);
  const right = clamped >= 0 ? 1.0 : Math.max(0, 1.0 + clamped);
  return { left, right };
}

function startMixerVuAnimation(): void {
  if (mixerVuAnimationId) return;
  const updateVu = () => {
    if (!studioMixerOpen) {
      mixerVuAnimationId = null;
      return;
    }
    const hasLocalSolo = studioMixerChannels.some((c) => !c.isMaster && (c.section === 'local' || c.id === 'music-stream' || c.id.startsWith('you-mic')) && c.soloed);
    const hasRemoteSolo = studioMixerChannels.some((c) => !c.isMaster && c.section === 'remote' && c.id !== 'master-out' && c.soloed);

    // 1. Dynamic Local Microphone Channels Metering
    const activeMics = (prefs.voiceInputs && prefs.voiceInputs.length > 0)
      ? prefs.voiceInputs.filter((v) => v.enabled)
      : [{ id: 1, name: 'Mic 1', enabled: true, gain: 1, channelRoute: '1' }];

    const localMicChannelIds = new Set<string>(
      activeMics.map((mic) => (mic.id === 1 ? 'you-mic' : `you-mic-${mic.id}`))
    );

    activeMics.forEach((mic) => {
      const chId = mic.id === 1 ? 'you-mic' : `you-mic-${mic.id}`;
      const micCh = studioMixerChannels.find((c) => c.id === chId || (mic.id === 1 && c.id === 'you-mic'));
      if (!micCh) return;

      const stripEl = document.querySelector(`.mixer-strip[data-channel-id="${micCh.id}"]`);
      if (stripEl) {
        const vuLeft = stripEl.querySelector<HTMLElement>('.vu-fill-l');
        const vuRight = stripEl.querySelector<HTMLElement>('.vu-fill-r');
        const peakEl = stripEl.querySelector<HTMLElement>('.mixer-peak-val');
        if (vuLeft && vuRight) {
          const numMicId = Number(mic.id);
          const isAudible = !micCh.muted && (!hasLocalSolo || micCh.soloed);
          const { left: micAnalyserL, right: micAnalyserR } = audio.getVoiceMicAnalysers(numMicId);

          if (!isAudible || !micAnalyserL || !micAnalyserR) {
            vuLeft.style.height = '0%';
            vuRight.style.height = '0%';
            if (peakEl) {
              peakEl.textContent = '';
              peakEl.classList.remove('is-clipping');
            }
          } else {
            const leftMeas = measureTimeDomainLevel(micAnalyserL);
            const rightMeas = measureTimeDomainLevel(micAnalyserR);
            const maxRmsDb = Math.max(leftMeas.rmsDb, rightMeas.rmsDb);
            const maxPeakDb = Math.max(leftMeas.peakDb, rightMeas.peakDb);

            if (maxRmsDb <= -58) {
              vuLeft.style.height = '0%';
              vuRight.style.height = '0%';
            } else {
              const pctL = Math.max(0, Math.min(100, ((leftMeas.rmsDb + 60) / 60) * 100));
              const pctR = Math.max(0, Math.min(100, ((rightMeas.rmsDb + 60) / 60) * 100));
              vuLeft.style.height = `${pctL.toFixed(1)}%`;
              vuRight.style.height = `${pctR.toFixed(1)}%`;
            }

            if (peakEl) {
              if (maxPeakDb <= -55) {
                peakEl.textContent = '';
                peakEl.classList.remove('is-clipping');
              } else {
                peakEl.textContent = formatPeakDbText(maxPeakDb);
                peakEl.classList.toggle('is-clipping', maxPeakDb >= -0.5);
              }
            }
          }
        }
      }
    });

    // 2. Musician (Remote Voice) Channel Metering (Real Time-Domain Amplitude)
    const voiceCh = studioMixerChannels.find((c) => c.id === 'remote-voice');
    if (voiceCh) {
      const isAudible = !voiceCh.muted && (!hasRemoteSolo || voiceCh.soloed);
      const stripEl = document.querySelector(`.mixer-strip[data-channel-id="${voiceCh.id}"]`);
      if (stripEl) {
        const vuLeft = stripEl.querySelector<HTMLElement>('.vu-fill-l');
        const vuRight = stripEl.querySelector<HTMLElement>('.vu-fill-r');
        const peakEl = stripEl.querySelector<HTMLElement>('.mixer-peak-val');
        if (vuLeft && vuRight) {
          if (!isAudible || !remoteVoiceAnalyserL || !remoteVoiceAnalyserR) {
            vuLeft.style.height = '0%';
            vuRight.style.height = '0%';
            if (peakEl) {
              peakEl.textContent = '';
              peakEl.classList.remove('is-clipping');
            }
          } else {
            const leftMeas = measureTimeDomainLevel(remoteVoiceAnalyserL);
            const rightMeas = measureTimeDomainLevel(remoteVoiceAnalyserR);
            const maxRmsDb = Math.max(leftMeas.rmsDb, rightMeas.rmsDb);
            const maxPeakDb = Math.max(leftMeas.peakDb, rightMeas.peakDb);

            if (maxRmsDb <= -58) {
              vuLeft.style.height = '0%';
              vuRight.style.height = '0%';
            } else {
              const pctL = Math.max(0, Math.min(100, ((leftMeas.rmsDb + 60) / 60) * 100));
              const pctR = Math.max(0, Math.min(100, ((rightMeas.rmsDb + 60) / 60) * 100));
              vuLeft.style.height = `${pctL.toFixed(1)}%`;
              vuRight.style.height = `${pctR.toFixed(1)}%`;
            }

            if (peakEl) {
              if (maxPeakDb <= -55) {
                peakEl.textContent = '';
                peakEl.classList.remove('is-clipping');
              } else {
                peakEl.textContent = formatPeakDbText(maxPeakDb);
                peakEl.classList.toggle('is-clipping', maxPeakDb >= -0.5);
              }
            }
          }
        }
      }
    }

    // 3. Local Music Channel Metering (from local music level only)
    const localMusicCh = studioMixerChannels.find((c) => c.id === 'music-stream');
    if (localMusicCh) {
      const isAudible = !localMusicCh.muted && (!hasLocalSolo || localMusicCh.soloed);
      const stripEl = document.querySelector(`.mixer-strip[data-channel-id="${localMusicCh.id}"]`);
      if (stripEl) {
        const vuLeft = stripEl.querySelector<HTMLElement>('.vu-fill-l');
        const vuRight = stripEl.querySelector<HTMLElement>('.vu-fill-r');
        const peakEl = stripEl.querySelector<HTMLElement>('.mixer-peak-val');
        if (vuLeft && vuRight) {
          const { left: musicAnalyserL, right: musicAnalyserR } = audio.getMusicAnalysers();

          if (!isAudible || !musicAnalyserL || !musicAnalyserR) {
            vuLeft.style.height = '0%';
            vuRight.style.height = '0%';
            if (peakEl) {
              peakEl.textContent = '';
              peakEl.classList.remove('is-clipping');
            }
          } else {
            const leftMeas = measureTimeDomainLevel(musicAnalyserL);
            const rightMeas = measureTimeDomainLevel(musicAnalyserR);
            const maxRmsDb = Math.max(leftMeas.rmsDb, rightMeas.rmsDb);
            const maxPeakDb = Math.max(leftMeas.peakDb, rightMeas.peakDb);

            if (maxRmsDb <= -58) {
              vuLeft.style.height = '0%';
              vuRight.style.height = '0%';
            } else {
              const pctL = Math.max(0, Math.min(100, ((leftMeas.rmsDb + 60) / 60) * 100));
              const pctR = Math.max(0, Math.min(100, ((rightMeas.rmsDb + 60) / 60) * 100));
              vuLeft.style.height = `${pctL.toFixed(1)}%`;
              vuRight.style.height = `${pctR.toFixed(1)}%`;
            }

            if (peakEl) {
              if (maxPeakDb <= -55) {
                peakEl.textContent = '';
                peakEl.classList.remove('is-clipping');
              } else {
                peakEl.textContent = formatPeakDbText(maxPeakDb);
                peakEl.classList.toggle('is-clipping', maxPeakDb >= -0.5);
              }
            }
          }
        }
      }
    }

    // 4. Remote Music Channel Metering (Real Time-Domain Amplitude)
    const remoteMusicCh = studioMixerChannels.find((c) => c.id === 'remote-music');
    if (remoteMusicCh) {
      const isAudible = !remoteMusicCh.muted && (!hasRemoteSolo || remoteMusicCh.soloed);
      const stripEl = document.querySelector(`.mixer-strip[data-channel-id="${remoteMusicCh.id}"]`);
      if (stripEl) {
        const vuLeft = stripEl.querySelector<HTMLElement>('.vu-fill-l');
        const vuRight = stripEl.querySelector<HTMLElement>('.vu-fill-r');
        const peakEl = stripEl.querySelector<HTMLElement>('.mixer-peak-val');
        if (vuLeft && vuRight) {
          if (!isAudible || !remoteMusicAnalyserL || !remoteMusicAnalyserR) {
            vuLeft.style.height = '0%';
            vuRight.style.height = '0%';
            if (peakEl) {
              peakEl.textContent = '';
              peakEl.classList.remove('is-clipping');
            }
          } else {
            const leftMeas = measureTimeDomainLevel(remoteMusicAnalyserL);
            const rightMeas = measureTimeDomainLevel(remoteMusicAnalyserR);
            const maxRmsDb = Math.max(leftMeas.rmsDb, rightMeas.rmsDb);
            const maxPeakDb = Math.max(leftMeas.peakDb, rightMeas.peakDb);

            if (maxRmsDb <= -58) {
              vuLeft.style.height = '0%';
              vuRight.style.height = '0%';
            } else {
              const pctL = Math.max(0, Math.min(100, ((leftMeas.rmsDb + 60) / 60) * 100));
              const pctR = Math.max(0, Math.min(100, ((rightMeas.rmsDb + 60) / 60) * 100));
              vuLeft.style.height = `${pctL.toFixed(1)}%`;
              vuRight.style.height = `${pctR.toFixed(1)}%`;
            }

            if (peakEl) {
              if (maxPeakDb <= -55) {
                peakEl.textContent = '';
                peakEl.classList.remove('is-clipping');
              } else {
                peakEl.textContent = formatPeakDbText(maxPeakDb);
                peakEl.classList.toggle('is-clipping', maxPeakDb >= -0.5);
              }
            }
          }
        }
      }
    }

    // 5. Master Output Metering (Real Time-Domain Amplitude from Post-Limiter Analyser Taps)
    const masterCh = studioMixerChannels.find((c) => c.id === 'master-out');
    if (masterCh) {
      const isAudible = !masterCh.muted && !remoteMuted;
      const stripEl = document.querySelector(`.mixer-strip[data-channel-id="${masterCh.id}"]`);
      if (stripEl) {
        const vuLeft = stripEl.querySelector<HTMLElement>('.vu-fill-l');
        const vuRight = stripEl.querySelector<HTMLElement>('.vu-fill-r');
        const peakEl = stripEl.querySelector<HTMLElement>('.mixer-peak-val');
        if (vuLeft && vuRight) {
          if (!isAudible || !remoteMasterAnalyserL || !remoteMasterAnalyserR) {
            vuLeft.style.height = '0%';
            vuRight.style.height = '0%';
            if (peakEl) {
              peakEl.textContent = '';
              peakEl.classList.remove('is-clipping');
            }
          } else {
            const leftMeas = measureTimeDomainLevel(remoteMasterAnalyserL);
            const rightMeas = measureTimeDomainLevel(remoteMasterAnalyserR);
            const maxRmsDb = Math.max(leftMeas.rmsDb, rightMeas.rmsDb);
            const maxPeakDb = Math.max(leftMeas.peakDb, rightMeas.peakDb);

            if (maxRmsDb <= -58) {
              vuLeft.style.height = '0%';
              vuRight.style.height = '0%';
            } else {
              const pctL = Math.max(0, Math.min(100, ((leftMeas.rmsDb + 60) / 60) * 100));
              const pctR = Math.max(0, Math.min(100, ((rightMeas.rmsDb + 60) / 60) * 100));
              vuLeft.style.height = `${pctL.toFixed(1)}%`;
              vuRight.style.height = `${pctR.toFixed(1)}%`;
            }

            if (peakEl) {
              if (maxPeakDb <= -55) {
                peakEl.textContent = '';
                peakEl.classList.remove('is-clipping');
              } else {
                peakEl.textContent = formatPeakDbText(maxPeakDb);
                peakEl.classList.toggle('is-clipping', maxPeakDb >= -0.5);
              }
            }
          }
        }
      }
    }

    // 6. Aux & Other Channels (exclude all local mic channels, remote voice, remote music, music stream, and master)
    studioMixerChannels
      .filter((c) => !localMicChannelIds.has(c.id) && !c.id.startsWith('you-mic') && c.id !== 'remote-voice' && c.id !== 'remote-music' && c.id !== 'music-stream' && c.id !== 'master-out')
      .forEach((ch) => {
      const stripEl = document.querySelector(`.mixer-strip[data-channel-id="${ch.id}"]`);
      if (stripEl) {
        const vuLeft = stripEl.querySelector<HTMLElement>('.vu-fill-l');
        const vuRight = stripEl.querySelector<HTMLElement>('.vu-fill-r');
        const peakEl = stripEl.querySelector<HTMLElement>('.mixer-peak-val');
        if (vuLeft && vuRight) {
          vuLeft.style.height = '0%';
          vuRight.style.height = '0%';
          if (peakEl) {
            peakEl.textContent = '';
            peakEl.classList.remove('is-clipping');
          }
        }
      }
    });

    mixerVuAnimationId = requestAnimationFrame(updateVu);
  };
  mixerVuAnimationId = requestAnimationFrame(updateVu);
}

function stopMixerVuAnimation(): void {
  if (mixerVuAnimationId) {
    cancelAnimationFrame(mixerVuAnimationId);
    mixerVuAnimationId = null;
  }
}

function applyMixerAudioRouting(): void {
  const hasLocalSolo = studioMixerChannels.some((c) => !c.isMaster && (c.section === 'local' || c.id === 'music-stream' || c.id.startsWith('you-mic')) && c.soloed);
  const hasRemoteSolo = studioMixerChannels.some((c) => !c.isMaster && c.section === 'remote' && c.id !== 'master-out' && c.soloed);
  const masterCh = studioMixerChannels.find((c) => c.id === 'master-out') || { volume: 1.0, muted: false, pan: 0, fx: [] };
  const monitorTrim = prefs.outputVolume !== undefined ? prefs.outputVolume : 1.0;
  const masterVol = (remoteMuted || masterCh.muted) ? 0 : masterCh.volume * monitorTrim;

  // Dynamic Local Microphones Routing
  let anyLocalMicActive = false;
  const activeMics = (prefs.voiceInputs && prefs.voiceInputs.length > 0)
    ? prefs.voiceInputs.filter((v) => v.enabled)
    : [{ id: 1, name: 'Mic 1', enabled: true, gain: 1, channelRoute: '1' }];

  activeMics.forEach((mic) => {
    const chId = mic.id === 1 ? 'you-mic' : `you-mic-${mic.id}`;
    const micCh = studioMixerChannels.find((c) => c.id === chId || (mic.id === 1 && c.id === 'you-mic'));
    const isAudible = micCh ? (!micCh.muted && (!hasLocalSolo || micCh.soloed)) : true;
    const isMutedGlobally = muted;
    const baseVol = micCh ? micCh.volume : (mic.gain ?? 1);
    const effectiveVol = isAudible && !isMutedGlobally ? baseVol : 0;
    const pan = micCh ? (typeof micCh.pan === 'number' && !isNaN(micCh.pan) ? micCh.pan : 0) : 0;
    if (effectiveVol > 0) anyLocalMicActive = true;
    
    if (micCh) {
      mic.gain = micCh.volume;
      if (mic.id === 1) prefs.inputGain = micCh.volume;
      
      for (const prefix of ['', 'call-']) {
        const slider = document.querySelector<HTMLInputElement>(`#${prefix}gain-${mic.id}`);
        const valLabel = document.querySelector<HTMLElement>(`#${prefix}gain-val-${mic.id}`);
        if (slider) slider.value = String(micCh.volume);
        if (valLabel) valLabel.textContent = `${Math.round(micCh.volume * 100)}%`;
      }
      if (mic.id === 1) {
        for (const otherId of ['input-gain', 'call-input-gain']) {
          const el = document.querySelector<HTMLInputElement>(`#${otherId}`);
          if (el) el.value = String(micCh.volume);
        }
        for (const labelId of ['gain-value', 'call-gain-value']) {
          const el = document.getElementById(labelId);
          if (el) el.textContent = `${Math.round(micCh.volume * 100)}%`;
        }
      }
    }

    // Apply to audio engine
    const micFx = micCh?.fx || [];
    audio.setVoiceMicFx(mic.id, micFx);
    void audio.setVoiceMicGain(mic.id, effectiveVol);
    void audio.setVoiceMicPan(mic.id, pan);
  });

  audio.setEnabled('voice', !muted && anyLocalMicActive);

  const localMusicCh = studioMixerChannels.find((c) => c.id === 'music-stream');
  const remoteVoiceCh = studioMixerChannels.find((c) => c.id === 'remote-voice');
  const remoteMusicCh = studioMixerChannels.find((c) => c.id === 'remote-music');

  const localMusicAudible = localMusicCh ? (!localMusicCh.muted && (!hasLocalSolo || localMusicCh.soloed)) : true;
  const remoteVoiceAudible = remoteVoiceCh ? (!remoteVoiceCh.muted && (!hasRemoteSolo || remoteVoiceCh.soloed)) : true;
  const remoteMusicAudible = remoteMusicCh ? (!remoteMusicCh.muted && (!hasRemoteSolo || remoteMusicCh.soloed)) : true;

  const effectiveLocalMusicVol = localMusicAudible && localMusicCh ? localMusicCh.volume : 0;
  const localMusicPan = localMusicCh ? (typeof localMusicCh.pan === 'number' && !isNaN(localMusicCh.pan) ? localMusicCh.pan : 0) : 0;
  const effectiveRemoteVoiceVol = remoteVoiceAudible && remoteVoiceCh ? remoteVoiceCh.volume : 0;
  const effectiveRemoteMusicVol = remoteMusicAudible && remoteMusicCh ? remoteMusicCh.volume : 0;

  const musicFx = localMusicCh?.fx || [];
  audio.setMusicFx(musicFx);
  audio.setEnabled('music', effectiveLocalMusicVol > 0);
  void audio.applyMusicGain(effectiveLocalMusicVol);
  void audio.applyMusicPan(localMusicPan);

  // 2. Control Web Audio DSP Engine in real-time
  if (remoteAudioCtx && remoteAudioCtx.state !== 'closed') {
    const now = remoteAudioCtx.currentTime;

    // Real Gain Routing (0 to 1.5x)
    if (remoteVoiceGain) remoteVoiceGain.gain.setValueAtTime(effectiveRemoteVoiceVol, now);
    if (remoteMusicGain) remoteMusicGain.gain.setValueAtTime(effectiveRemoteMusicVol, now);
    if (remoteMasterGain) remoteMasterGain.gain.setValueAtTime(masterVol, now);

    // Real Stereo Panning (-1.0 Left to +1.0 Right)
    // Real Stereo Panning (Mono Voice) & Stereo Balance (Stereo Music)
    if (remoteVoicePanner && remoteVoiceCh) {
      const voicePan = typeof remoteVoiceCh.pan === 'number' && !isNaN(remoteVoiceCh.pan) ? remoteVoiceCh.pan : 0;
      remoteVoicePanner.pan.setValueAtTime(voicePan, now);
    }
    if (remoteMusicLeftGain && remoteMusicRightGain && remoteMusicCh) {
      const musicPan = typeof remoteMusicCh.pan === 'number' && !isNaN(remoteMusicCh.pan) ? remoteMusicCh.pan : 0;
      const { left, right } = getStereoBalanceGains(musicPan);
      remoteMusicLeftGain.gain.setValueAtTime(left, now);
      remoteMusicRightGain.gain.setValueAtTime(right, now);
    }

    // Dynamic Channel FX Routing: Remote Voice (rebuild topology only when fx array changes)
    if (remoteVoiceGain && remoteVoicePanner) {
      const voiceFx = (remoteVoiceCh?.fx || []).filter((f) => Boolean(f) && (f === 'Chan EQ' || f === 'Compressor'));
      const voiceFxKey = voiceFx.join('|');
      if (voiceFxKey !== lastConnectedVoiceFx) {
        try { remoteVoiceGain.disconnect(); } catch {}
        for (const node of remoteVoiceFxNodes) {
          try { node.disconnect(); } catch {}
        }
        remoteVoiceFxNodes = [];

        let currentVoiceSource: AudioNode = remoteVoiceGain;
        for (const fxName of voiceFx) {
          if (fxName === 'Chan EQ') {
            const eqHighpass = remoteAudioCtx.createBiquadFilter();
            eqHighpass.type = 'highpass';
            eqHighpass.frequency.setValueAtTime(80, now);
            eqHighpass.Q.setValueAtTime(0.7, now);

            const eqPeaking = remoteAudioCtx.createBiquadFilter();
            eqPeaking.type = 'peaking';
            eqPeaking.frequency.setValueAtTime(3200, now);
            eqPeaking.Q.setValueAtTime(1.0, now);
            eqPeaking.gain.setValueAtTime(3.0, now);

            currentVoiceSource.connect(eqHighpass);
            eqHighpass.connect(eqPeaking);
            currentVoiceSource = eqPeaking;
            remoteVoiceFxNodes.push(eqHighpass, eqPeaking);
          } else if (fxName === 'Compressor') {
            const compressorNode = remoteAudioCtx.createDynamicsCompressor();
            compressorNode.threshold.setValueAtTime(-18.0, now);
            compressorNode.knee.setValueAtTime(6.0, now);
            compressorNode.ratio.setValueAtTime(4.0, now);
            compressorNode.attack.setValueAtTime(0.005, now);
            compressorNode.release.setValueAtTime(0.08, now);

            currentVoiceSource.connect(compressorNode);
            currentVoiceSource = compressorNode;
            remoteVoiceFxNodes.push(compressorNode);
          }
        }
        currentVoiceSource.connect(remoteVoicePanner);
        lastConnectedVoiceFx = voiceFxKey;
      }
    }

    // Dynamic Channel FX Routing: Remote Music (rebuild topology only when fx array changes)
    if (remoteMusicGain && remoteMusicSplitter) {
      const musicFx = (remoteMusicCh?.fx || []).filter((f) => Boolean(f) && (f === 'Chan EQ' || f === 'Compressor'));
      const musicFxKey = musicFx.join('|');
      if (musicFxKey !== lastConnectedMusicFx) {
        try { remoteMusicGain.disconnect(); } catch {}
        for (const node of remoteMusicFxNodes) {
          try { node.disconnect(); } catch {}
        }
        remoteMusicFxNodes = [];

        let currentMusicSource: AudioNode = remoteMusicGain;
        for (const fxName of musicFx) {
          if (fxName === 'Chan EQ') {
            const eqPeaking = remoteAudioCtx.createBiquadFilter();
            eqPeaking.type = 'peaking';
            eqPeaking.frequency.setValueAtTime(2400, now);
            eqPeaking.Q.setValueAtTime(1.0, now);
            eqPeaking.gain.setValueAtTime(2.5, now);

            currentMusicSource.connect(eqPeaking);
            currentMusicSource = eqPeaking;
            remoteMusicFxNodes.push(eqPeaking);
          } else if (fxName === 'Compressor') {
            const compressorNode = remoteAudioCtx.createDynamicsCompressor();
            compressorNode.threshold.setValueAtTime(-12.0, now);
            compressorNode.knee.setValueAtTime(6.0, now);
            compressorNode.ratio.setValueAtTime(3.0, now);
            compressorNode.attack.setValueAtTime(0.01, now);
            compressorNode.release.setValueAtTime(0.1, now);

            currentMusicSource.connect(compressorNode);
            currentMusicSource = compressorNode;
            remoteMusicFxNodes.push(compressorNode);
          }
        }
        currentMusicSource.connect(remoteMusicSplitter);
        lastConnectedMusicFx = musicFxKey;
      }
    }
  }

  const voiceAudio = document.getElementById('remote-voice-audio') as HTMLAudioElement | null;
  const musicAudio = document.getElementById('remote-music-audio') as HTMLAudioElement | null;
  if (voiceAudio) voiceAudio.volume = Math.min(1.0, masterVol * effectiveRemoteVoiceVol);
  if (musicAudio) musicAudio.volume = Math.min(1.0, masterVol * effectiveRemoteMusicVol);
}

function renderStudioMixer(): void {
  const rack = $('mixer-channels-rack');
  if (!rack) return;
  rack.innerHTML = '';

  // 0. Left Parameters Ruler Column
  const labelsCol = document.createElement('div');
  labelsCol.className = 'mixer-labels-column';
  labelsCol.innerHTML = `
    <div class="mixer-label-item" style="height: 88px; margin-bottom: 12px;">Audio FX</div>
    <div class="mixer-label-item" style="height: 30px; margin-bottom: 12px;">Icon</div>
    <div class="mixer-label-item" style="height: 46px; margin-bottom: 12px;">Pan</div>
    <div class="mixer-label-item" style="height: 20px; margin-bottom: 8px;">dB</div>
    <div class="mixer-ruler-scale">
      <div class="ruler-num" style="top: 2%">6</div>
      <div class="ruler-num" style="top: 9%">3</div>
      <div class="ruler-num num-0" style="top: 16%">0</div>
      <div class="ruler-num" style="top: 24%">-3</div>
      <div class="ruler-num" style="top: 32%">-6</div>
      <div class="ruler-num" style="top: 48%">-12</div>
      <div class="ruler-num" style="top: 62%">-18</div>
      <div class="ruler-num" style="top: 74%">-24</div>
      <div class="ruler-num" style="top: 81%">-30</div>
      <div class="ruler-num" style="top: 92%">-40</div>
      <div class="ruler-num" style="top: 99%">-∞</div>
    </div>
    <div class="mixer-label-item" style="height: 22px; margin-bottom: 8px;"></div>
    <div class="mixer-label-item" style="height: 28px;"></div>
  `;
  rack.appendChild(labelsCol);

  const hasLocalSolo = studioMixerChannels.some((c) => !c.isMaster && (c.section === 'local' || c.id === 'music-stream' || c.id.startsWith('you-mic')) && c.soloed);
  const hasRemoteSolo = studioMixerChannels.some((c) => !c.isMaster && c.section === 'remote' && c.id !== 'master-out' && c.soloed);
  let renderedRemoteDivider = false;

  studioMixerChannels.forEach((channel) => {
    channel.volume = typeof channel.volume === 'number' && !isNaN(channel.volume) ? channel.volume : 1.0;
    channel.pan = typeof channel.pan === 'number' && !isNaN(channel.pan) ? channel.pan : 0;
    channel.muted = Boolean(channel.muted);
    channel.soloed = channel.isMaster ? false : Boolean(channel.soloed);
    channel.fx = Array.isArray(channel.fx) ? channel.fx : [];
    channel.color = channel.color || '#3b82f6';
    channel.icon = channel.icon || 'mic';
    channel.name = channel.name || 'Track';

    if (channel.section === 'remote' && !renderedRemoteDivider) {
      renderedRemoteDivider = true;
      const divider = document.createElement('div');
      divider.className = 'mixer-section-divider';
      divider.title = 'Remote Peer Monitor (מי שממול)';
      divider.innerHTML = `
        <div class="mixer-section-divider-line"></div>
        <span class="mixer-section-tag">REMOTE</span>
        <div class="mixer-section-divider-line"></div>
      `;
      rack.appendChild(divider);
    }

    const isLocal = channel.section === 'local' || channel.id.startsWith('you-mic') || channel.id === 'music-stream';
    const domainHasSolo = isLocal ? hasLocalSolo : hasRemoteSolo;
    const isDimmed = !channel.isMaster && domainHasSolo && !channel.soloed;
    const strip = document.createElement('div');
    strip.className = `mixer-strip ${channel.isMaster ? 'is-master' : ''} ${channel.section === 'remote' ? 'is-remote' : ''} ${isDimmed ? 'is-dimmed' : ''}`;
    strip.dataset.channelId = channel.id;

    // 1. Audio FX Plugin Rack (All channels except Master) vs Invisible Spacer (Master)
    if (channel.isMaster) {
      const topSpacer = document.createElement('div');
      topSpacer.className = 'mixer-remote-spacer-top';
      strip.appendChild(topSpacer);
    } else {
      const fxRack = document.createElement('div');
      fxRack.className = 'mixer-fx-rack';
      for (let i = 0; i < 4; i++) {
        const activeFx = channel.fx[i] || '';
        const fxSlot = document.createElement('button');
        fxSlot.type = 'button';
        fxSlot.className = `mixer-cell-btn ${activeFx ? 'btn-fx-active' : 'btn-fx-empty'}`;
        fxSlot.textContent = activeFx || '';
        fxSlot.title = activeFx ? `Plugin: ${activeFx} (Click to change/remove)` : `Slot ${i + 1}: Add Audio FX Plugin`;
        fxSlot.addEventListener('click', (e) => {
          e.stopPropagation();
          openFxPopover(channel.id, i, fxSlot);
        });
        fxRack.appendChild(fxSlot);
      }
      strip.appendChild(fxRack);
    }

    // 2. Track Icon (Logic Pro Instrument & Vocal Silhouettes)
    const iconBtn = document.createElement('button');
    iconBtn.type = 'button';
    iconBtn.className = 'mixer-icon-btn';
    iconBtn.style.color = channel.color;
    iconBtn.title = 'Change Channel Icon & Color';
    const iconKey = channel.icon || (channel.id === 'you-mic' ? 'mic' : channel.id === 'remote-voice' ? 'headphones' : channel.isMaster ? 'crown' : 'waves');
    const iconData = STUDIO_ICONS[iconKey] || STUDIO_ICONS.waves;
    iconBtn.innerHTML = iconData.svg;
    iconBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openIconPopover(channel.id, iconBtn);
    });
    strip.appendChild(iconBtn);

    // 3. Pan Knob (All channels except Master) vs Invisible Spacer (Master)
    if (channel.isMaster) {
      const panSpacer = document.createElement('div');
      panSpacer.className = 'mixer-remote-spacer-pan';
      strip.appendChild(panSpacer);
    } else {
      const panWrap = document.createElement('div');
      panWrap.className = 'mixer-pan-wrap';
      panWrap.innerHTML = `
        <div class="mixer-pan-outer-ring" style="background: ${getPanBackground(channel.pan)}" title="Pan / Balance (Drag up/down, double-click to center)">
          <div class="mixer-pan-cap">
            <div class="mixer-pan-cap-notch"></div>
            <span class="mixer-pan-cap-text">${panToReadout(channel.pan)}</span>
          </div>
        </div>
      `;
      const panRing = panWrap.querySelector<HTMLElement>('.mixer-pan-outer-ring')!;
      const panText = panWrap.querySelector<HTMLElement>('.mixer-pan-cap-text')!;
      const panNotch = panWrap.querySelector<HTMLElement>('.mixer-pan-cap-notch')!;

      const updatePanVisuals = (pan: number) => {
        panRing.style.background = getPanBackground(pan);
        panText.textContent = panToReadout(pan);
        const deg = Math.round(pan * 140);
        if (panNotch) {
          panNotch.style.transform = `translate(-50%, -50%) rotate(${deg}deg) translateY(-15px)`;
        }
      };

      updatePanVisuals(channel.pan);

      panRing.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        panRing.setPointerCapture(e.pointerId);
        const startClientY = e.clientY;
        const startPan = channel.pan;

        const onPanMove = (pe: PointerEvent) => {
          const delta = (startClientY - pe.clientY) / 75;
          channel.pan = Math.max(-1, Math.min(1, startPan + delta));
          updatePanVisuals(channel.pan);
          applyMixerAudioRouting();
        };

        const onPanUp = (pe: PointerEvent) => {
          try { panRing.releasePointerCapture(pe.pointerId); } catch {}
          panRing.removeEventListener('pointermove', onPanMove);
          panRing.removeEventListener('pointerup', onPanUp);
          panRing.removeEventListener('pointercancel', onPanUp);
          saveStudioMixerConfig(true);
        };

        panRing.addEventListener('pointermove', onPanMove);
        panRing.addEventListener('pointerup', onPanUp);
        panRing.addEventListener('pointercancel', onPanUp);
      });

      panRing.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        channel.pan = 0;
        updatePanVisuals(0);
        applyMixerAudioRouting();
        saveStudioMixerConfig(true);
      });

      panRing.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.04 : -0.04;
        channel.pan = Math.max(-1, Math.min(1, channel.pan + delta));
        updatePanVisuals(channel.pan);
        applyMixerAudioRouting();
        saveStudioMixerConfig(false);
      }, { passive: false });

      strip.appendChild(panWrap);
    }

    // 4. Digital Readout Boxes (Fader dB + Peak dB)
    const readoutRow = document.createElement('div');
    readoutRow.className = 'mixer-readout-row';
    const currentDb = channel.volume <= 0.0001 ? -Infinity : 20 * Math.log10(channel.volume);
    readoutRow.innerHTML = `
      <div class="mixer-fader-val" title="Double-click to reset to 0.0 dB">${formatDbText(currentDb)}</div>
      <div class="mixer-peak-val" title="Peak Meter Level"></div>
    `;
    const faderValEl = readoutRow.querySelector<HTMLElement>('.mixer-fader-val')!;
    faderValEl.addEventListener('dblclick', () => {
      channel.volume = 1.0;
      renderStudioMixer();
      applyMixerAudioRouting();
      saveStudioMixerConfig(true);
    });
    strip.appendChild(readoutRow);

    // 5. Vertical Fader, Logic Pro Scale & Live Dual VU Meter
    const faderArea = document.createElement('div');
    faderArea.className = 'mixer-fader-area';
    const topPct = dbToFaderTopPercent(currentDb);
    faderArea.innerHTML = `
      <div class="mixer-fader-column" data-channel-id="${channel.id}">
        <div class="fader-graduations">
          <div class="grad-line grad-0" style="top: 16%"></div>
          <div class="grad-line" style="top: 24%"></div>
          <div class="grad-line grad-major" style="top: 32%"></div>
          <div class="grad-line" style="top: 40%"></div>
          <div class="grad-line" style="top: 48%"></div>
          <div class="grad-line grad-major" style="top: 55%"></div>
          <div class="grad-line" style="top: 62%"></div>
          <div class="grad-line" style="top: 68%"></div>
          <div class="grad-line" style="top: 74%"></div>
          <div class="grad-line" style="top: 81%"></div>
          <div class="grad-line" style="top: 87%"></div>
          <div class="grad-line" style="top: 92%"></div>
          <div class="grad-line" style="top: 95%"></div>
          <div class="grad-line" style="top: 97.5%"></div>
          <div class="grad-line" style="top: 99%"></div>
        </div>
        <div class="logic-fader-groove">
          <div class="logic-fader-groove-line"></div>
          <div class="logic-fader-cap" style="top: ${topPct.toFixed(2)}%"></div>
        </div>
      </div>

      <div class="mixer-scale-column">
        <div class="scale-num num-0" style="top: 16%">0</div>
        <div class="scale-num" style="top: 24%">3</div>
        <div class="scale-num" style="top: 32%">6</div>
        <div class="scale-num" style="top: 40%">9</div>
        <div class="scale-num" style="top: 48%">12</div>
        <div class="scale-num" style="top: 55%">15</div>
        <div class="scale-num" style="top: 62%">18</div>
        <div class="scale-num" style="top: 68%">21</div>
        <div class="scale-num" style="top: 74%">24</div>
        <div class="scale-num" style="top: 81%">30</div>
        <div class="scale-num" style="top: 87%">35</div>
        <div class="scale-num" style="top: 92%">40</div>
        <div class="scale-num" style="top: 95%">45</div>
        <div class="scale-num" style="top: 97.5%">50</div>
        <div class="scale-num" style="top: 99%">60</div>
      </div>

      <div class="mixer-vu-meter">
        <div class="vu-bar"><div class="vu-fill vu-fill-l"></div></div>
        <div class="vu-bar"><div class="vu-fill vu-fill-r"></div></div>
      </div>
    `;

    const faderColumn = faderArea.querySelector<HTMLElement>('.mixer-fader-column')!;
    const faderCap = faderArea.querySelector<HTMLElement>('.logic-fader-cap')!;

    const setFaderByTopPercent = (pct: number) => {
      const clampedPct = Math.max(2.0, Math.min(98.5, pct));
      const db = faderTopPercentToDb(clampedPct);
      channel.volume = dbToGain(db);
      faderCap.style.top = `${clampedPct.toFixed(2)}%`;
      faderValEl.textContent = formatDbText(db);
      applyMixerAudioRouting();
    };

    faderCap.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      faderCap.classList.add('is-dragging');
      faderCap.setPointerCapture(e.pointerId);

      const startClientY = e.clientY;
      const startTopPct = parseFloat(faderCap.style.top) || 16;
      const rect = faderColumn.getBoundingClientRect();
      const trackHeight = rect.height || 180;

      const onPointerMove = (pe: PointerEvent) => {
        const deltaY = pe.clientY - startClientY;
        const deltaPct = (deltaY / trackHeight) * 100;
        setFaderByTopPercent(startTopPct + deltaPct);
      };

      const onPointerUp = (pe: PointerEvent) => {
        faderCap.classList.remove('is-dragging');
        try { faderCap.releasePointerCapture(pe.pointerId); } catch {}
        faderCap.removeEventListener('pointermove', onPointerMove);
        faderCap.removeEventListener('pointerup', onPointerUp);
        faderCap.removeEventListener('pointercancel', onPointerUp);
        saveStudioMixerConfig(true);
      };

      faderCap.addEventListener('pointermove', onPointerMove);
      faderCap.addEventListener('pointerup', onPointerUp);
      faderCap.addEventListener('pointercancel', onPointerUp);
    });

    faderColumn.addEventListener('pointerdown', (e) => {
      if (e.target === faderCap || faderCap.contains(e.target as Node)) return;
      e.preventDefault();
      faderColumn.setPointerCapture(e.pointerId);
      faderCap.classList.add('is-dragging');

      const rect = faderColumn.getBoundingClientRect();
      const trackHeight = rect.height || 180;
      const initialPct = ((e.clientY - rect.top) / trackHeight) * 100;
      setFaderByTopPercent(initialPct);

      const onTrackPointerMove = (pe: PointerEvent) => {
        const movePct = ((pe.clientY - rect.top) / trackHeight) * 100;
        setFaderByTopPercent(movePct);
      };

      const onTrackPointerUp = (pe: PointerEvent) => {
        faderCap.classList.remove('is-dragging');
        try { faderColumn.releasePointerCapture(pe.pointerId); } catch {}
        faderColumn.removeEventListener('pointermove', onTrackPointerMove);
        faderColumn.removeEventListener('pointerup', onTrackPointerUp);
        faderColumn.removeEventListener('pointercancel', onTrackPointerUp);
        saveStudioMixerConfig(true);
      };

      faderColumn.addEventListener('pointermove', onTrackPointerMove);
      faderColumn.addEventListener('pointerup', onTrackPointerUp);
      faderColumn.addEventListener('pointercancel', onTrackPointerUp);
    });

    faderCap.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      channel.volume = 1.0;
      faderCap.style.top = '16%';
      faderValEl.textContent = '0.0';
      applyMixerAudioRouting();
      saveStudioMixerConfig(true);
    });

    faderColumn.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      channel.volume = 1.0;
      faderCap.style.top = '16%';
      faderValEl.textContent = '0.0';
      applyMixerAudioRouting();
      saveStudioMixerConfig(true);
    });

    faderColumn.addEventListener('wheel', (e) => {
      e.preventDefault();
      const curDb = channel.volume <= 0.0001 ? -60 : 20 * Math.log10(channel.volume);
      const deltaDb = e.deltaY < 0 ? 0.3 : -0.3;
      const newDb = Math.max(-65, Math.min(6.0, curDb + deltaDb));
      channel.volume = dbToGain(newDb);
      faderCap.style.top = `${dbToFaderTopPercent(newDb).toFixed(2)}%`;
      faderValEl.textContent = formatDbText(newDb);
      applyMixerAudioRouting();
      saveStudioMixerConfig(false);
    }, { passive: false });

    strip.appendChild(faderArea);

    // 6. Mute & Solo DAW Buttons
    const msGroup = document.createElement('div');
    msGroup.className = 'mixer-ms-group';
    if (channel.isMaster) {
      msGroup.innerHTML = `
        <button type="button" class="btn-mixer-ms btn-m ${channel.muted ? 'active' : ''}" style="width: 100%;" title="Mute Monitor Master (Remote Mix)">M</button>
      `;
      msGroup.querySelector('.btn-m')?.addEventListener('click', () => {
        channel.muted = !channel.muted;
        renderStudioMixer();
        applyMixerAudioRouting();
      });
    } else {
      msGroup.innerHTML = `
        <button type="button" class="btn-mixer-ms btn-m ${channel.muted ? 'active' : ''}" title="Mute Track">M</button>
        <button type="button" class="btn-mixer-ms btn-s ${channel.soloed ? 'active' : ''}" title="Solo Track">S</button>
      `;
      msGroup.querySelector('.btn-m')?.addEventListener('click', () => {
        channel.muted = !channel.muted;
        renderStudioMixer();
        applyMixerAudioRouting();
      });
      msGroup.querySelector('.btn-s')?.addEventListener('click', () => {
        channel.soloed = !channel.soloed;
        renderStudioMixer();
        applyMixerAudioRouting();
      });
    }
    strip.appendChild(msGroup);

    // 8. Bottom Solid Track Color Banner (With rename on double-click)
    const bottomBanner = document.createElement('div');
    bottomBanner.className = 'mixer-strip-bottom-banner';
    bottomBanner.style.background = channel.color;
    bottomBanner.textContent = channel.name;
    bottomBanner.title = 'Double click to rename channel';
    bottomBanner.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'mixer-track-name-input';
      input.value = channel.name;
      input.maxLength = 18;
      
      let isCommitted = false;
      const commit = () => {
        if (isCommitted) return;
        isCommitted = true;
        const val = input.value.trim();
        if (val) {
          channel.name = val;
          saveStudioMixerConfig();
        }
        renderStudioMixer();
      };
      const cancel = () => {
        if (isCommitted) return;
        isCommitted = true;
        renderStudioMixer();
      };

      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') {
          ke.preventDefault();
          commit();
        } else if (ke.key === 'Escape') {
          ke.preventDefault();
          cancel();
        }
      });
      input.addEventListener('blur', commit);

      bottomBanner.replaceWith(input);
      input.focus();
      input.select();
    });
    strip.appendChild(bottomBanner);

    rack.appendChild(strip);
  });
}

function openFxPopover(channelId: string, slotIndex: number, anchorEl: HTMLElement): void {
  activeFxTarget = { channelId, slotIndex };
  const popover = $('mixer-fx-picker-popover');
  if (!popover) return;
  const rect = anchorEl.getBoundingClientRect();
  const top = rect.bottom + 6;
  const left = Math.max(12, Math.min(window.innerWidth - 232, rect.left - 70));
  popover.style.top = `${Math.min(window.innerHeight - 300, top)}px`;
  popover.style.left = `${left}px`;
  popover.classList.remove('hidden');
  $('mixer-icon-picker-popover')?.classList.add('hidden');
}

function openIconPopover(channelId: string, anchorEl: HTMLElement): void {
  activeIconTarget = channelId;
  const popover = $('mixer-icon-picker-popover');
  if (!popover) return;

  const channel = studioMixerChannels.find((c) => c.id === channelId);
  const grid = popover.querySelector('.mixer-icon-grid');
  if (grid) {
    grid.innerHTML = Object.entries(STUDIO_ICONS).map(([key, data]) => `
      <button type="button" class="icon-option ${channel?.icon === key ? 'active' : ''}" data-icon="${key}" title="${data.label}" style="color: ${channel?.color || '#38bdf8'}">
        ${data.svg}
      </button>
    `).join('');
  }

  const colorRow = popover.querySelector<HTMLElement>('.mixer-color-row');
  if (colorRow) {
    colorRow.style.display = (channel?.isMaster || channel?.id === 'master-out') ? 'none' : 'flex';
  }

  const rect = anchorEl.getBoundingClientRect();
  const top = rect.bottom + 6;
  const left = Math.max(12, Math.min(window.innerWidth - 232, rect.left - 70));
  popover.style.top = `${Math.min(window.innerHeight - 280, Math.max(10, top))}px`;
  popover.style.left = `${left}px`;
  popover.classList.remove('hidden');
  $('mixer-fx-picker-popover')?.classList.add('hidden');
}

// Wire Popovers Event Delegation for 100% Reliable Clicks
$('mixer-icon-picker-popover')?.addEventListener('click', (e) => {
  const target = e.target as HTMLElement | null;
  if (!target || !activeIconTarget) return;

  const iconBtn = target.closest<HTMLButtonElement>('.icon-option');
  if (iconBtn) {
    const selectedIcon = iconBtn.dataset.icon || iconBtn.getAttribute('data-icon');
    const channel = studioMixerChannels.find((c) => c.id === activeIconTarget);
    if (channel && selectedIcon) {
      channel.icon = selectedIcon;
      saveStudioMixerConfig();
      renderStudioMixer();
    }
    $('mixer-icon-picker-popover')?.classList.add('hidden');
    activeIconTarget = null;
    return;
  }

  const colorSwatch = target.closest<HTMLElement>('.mixer-color-swatch');
  if (colorSwatch) {
    const selectedColor = colorSwatch.dataset.color || colorSwatch.getAttribute('data-color');
    const channel = studioMixerChannels.find((c) => c.id === activeIconTarget);
    if (channel && selectedColor && !channel.isMaster && channel.id !== 'master-out') {
      channel.color = selectedColor;
      saveStudioMixerConfig();
      renderStudioMixer();
    }
    $('mixer-icon-picker-popover')?.classList.add('hidden');
    activeIconTarget = null;
    return;
  }
});

$('mixer-fx-picker-popover')?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement)?.closest<HTMLButtonElement>('.fx-option');
  if (!btn || !activeFxTarget) return;
  const { channelId, slotIndex } = activeFxTarget;
  const channel = studioMixerChannels.find((c) => c.id === channelId);
  if (channel) {
    const fx = btn.dataset.fx;
    if (fx === 'remove') {
      channel.fx.splice(slotIndex, 1);
    } else if (fx) {
      channel.fx[slotIndex] = fx;
    }
    saveStudioMixerConfig();
    renderStudioMixer();
    applyMixerAudioRouting();
  }
  $('mixer-fx-picker-popover')?.classList.add('hidden');
  activeFxTarget = null;
});

$('btn-close-fx-popover')?.addEventListener('click', () => {
  $('mixer-fx-picker-popover')?.classList.add('hidden');
  activeFxTarget = null;
});

$('btn-close-icon-popover')?.addEventListener('click', () => {
  $('mixer-icon-picker-popover')?.classList.add('hidden');
  activeIconTarget = null;
});

// Close popovers on click outside
window.addEventListener('click', (e) => {
  const target = e.target as HTMLElement | null;
  if (!target?.closest('#mixer-fx-picker-popover') && !target?.closest('.mixer-fx-slot')) {
    $('mixer-fx-picker-popover')?.classList.add('hidden');
    activeFxTarget = null;
  }
  if (!target?.closest('#mixer-icon-picker-popover') && !target?.closest('.mixer-icon-btn')) {
    $('mixer-icon-picker-popover')?.classList.add('hidden');
    activeIconTarget = null;
  }
});

// Studio Mixer Controls & Shortcuts
$('toggle-session-mixer')?.addEventListener('click', () => {
  toggleStudioMixer();
});

$('btn-close-studio-mixer')?.addEventListener('click', () => {
  toggleStudioMixer(false);
});

$('session-studio-mixer-modal')?.addEventListener('click', (e) => {
  if (e.target === $('session-studio-mixer-modal')) {
    toggleStudioMixer(false);
  }
});


