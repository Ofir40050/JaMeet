import type { AudioMode, MediaMetadata, ParticipantIdentity, Project, ProjectSongItem } from '@jameet/shared';
import { getNotesStatus, setNotesStatus, syncNotesControls } from './workspace/notes/notesUi';
import { getLyricsStatus, setLyricsStatus, renderLyricsDocTabs, updateLyricsStatsFromHtml } from './workspace/lyrics/lyricsUi';
import { getStructureStatus } from './workspace/structure/structureUi';
import { getTasksStatus } from './workspace/tasks/tasksUi';
import { hasTasksSaveTimeout } from './workspace/tasks/tasksPersistence';
import { debounceSaveNotesRetry } from './workspace/notes/notesPersistence';
import { initSessionViewSelectorUi } from './sessions/call/view/sessionViewSelectorUi';
import { initInviteLinkController } from './sessions/call/moderation/inviteLinkController';
import { isShortcutsModalOpen, closeShortcutsModal } from './sessions/call/controls/callShortcutsUi';
import { isSessionWorkspaceOpen, setSessionWorkspaceOpen } from './sessions/call/workspace/workspaceDrawerUi';
import { resetChatUi } from './sessions/call/chat/chat';
import * as projectsApi from './projects/core/projects';
import { setScheduledApiBase } from './sessions/scheduled/scheduledApi';
import {
  loadScheduledSessions
} from './sessions/scheduled/scheduledSessions';
import {
  loadRecentSessions
} from './sessions/recent/recentSessions';
import {
  closeAccountMenu
} from './auth/profile/profileUi';
import {
  renderWaitingBanner
} from './sessions/call/waiting/waitingRoomUi';
import {
  loadProjects
} from './projects/core/projectsListController';
import {
  renderProjectCollaboratorsView,
  initProjectCollaboratorsViewController
} from './projects/collaborators/projectCollaboratorsViewController';
import {
  renderSessionSummaryModal,
  initProjectSessionSummaryUi
} from './projects/sessions/projectSessionSummaryUi';
import {
  renderProjectView
} from './projects/core/projectViewController';
import {
  openProjectView
} from './projects/core/projectOpenController';
import { initDialogUi } from './core/dialogUi';
import {
  canUserEditProject,
  applyWorkspacePermissions
} from './workspace/core/workspacePermissionsController';
import { initScheduledSessionsController } from './sessions/scheduled/scheduledSessionsController';
import { initRecentSessionsController } from './sessions/recent/recentSessionsController';
import { initWorkspaceDrawerController } from './sessions/call/workspace/workspaceDrawerController';
import { initLyricsDomainController } from './workspace/lyrics/lyricsDomainController';
import { initNotesDomainController } from './workspace/notes/notesDomainController';
import { initStructureDomainController } from './workspace/structure/structureDomainController';
import { initProjectsDomainController } from './projects/core/projectsDomainController';
import { initProjectOpenDomainController } from './projects/core/projectOpenDomainController';
import { initProjectCollaboratorsDomainController } from './projects/collaborators/projectCollaboratorsDomainController';
import { initProjectManagementController } from './projects/core/projectManagementController';
import { initSessionStats } from './sessions/call/view/sessionStatsUi';
import { initWaitingRoomUi } from './sessions/call/waiting/waitingRoomUi';
import { initDeepLinkDomainController } from './sessions/join/deepLinkDomainController';
import { initCallShortcutsUi } from './sessions/call/controls/callShortcutsUi';
import { initGuestJoinController } from './auth/guest/guestJoinController';
import { initProjectNavigationDomainController } from './projects/navigation/projectNavigationDomainController';
import { initProjectSongDeleteDomainController } from './songs/delete/projectSongDeleteDomainController';
import { initSongsDomainController } from './songs/state/songsDomainController';
import { initTasksDomainController } from './workspace/tasks/tasksDomainController';
import { initStructurePersistence } from './workspace/structure/structurePersistence';
import { initWorkspaceCoreController } from './workspace/core/workspaceCoreController';
import { initWorkspacePersistenceController } from './workspace/core/workspacePersistenceController';
import { initWorkspaceRealtimeDomainController } from './workspace/realtime/workspaceRealtimeDomainController';
import { updateLocalPreviews as updateLocalPreviewsHelper } from './media/video/localPreviewUi';
import { buildSessionMetadata, buildCurrentStream } from './sessions/call/view/sessionMetadata';
import { checkActiveSpeaker as checkActiveSpeakerImpl } from './sessions/call/view/activeSpeakerController';
import { deviceError } from './media/devices/deviceError';
import { initInCallAudioModalController } from './sessions/call/controls/inCallAudioModalController';
import { initCallToolbarController } from './sessions/call/controls/callToolbarController';
import { initSessionUtilityBindingsController } from './sessions/call/view/sessionUtilityBindingsController';
import { getCachedRunningApps } from './media/audio/sources/runningApplications';
import { populateMusicAppSelectOptions, updateMusicAppIconByPid } from './media/audio/ui/musicAppSelectUi';
import { type HardwareAudioDeviceInfo } from './media/devices/hardwareAudioDeviceUtils';
import { getMeterInterval, getEffectiveMusicBitrate } from './media/devices/mediaPreferenceCalculations';
import { bindDeviceSelect } from './media/devices/deviceChangeController';
import { initAuthDomainController } from './auth/login/authDomainController';
import { buildFeedbackUrl } from './core/feedbackHelper';
import { checkAppVersion } from './core/versionCheckController';
import { createScreenSharingController } from './sessions/call/controls/screenSharingController';
import { createVoiceInputsUi } from './media/audio/ui/voiceInputsUi';
import { createLocalAudioCaptureController } from './media/audio/sources/localAudioCaptureController';
import { createLocalVideoController } from './media/video/localVideoController';
import { createStudioPreparationController } from './sessions/setup/studioPreparationController';
import { createAudioOutputRoutingController } from './media/devices/audioOutputRoutingController';
import { createMediaActiveStateController } from './media/devices/mediaActiveSync';
import { createMediaStreamControlsController } from './sessions/call/controls/mediaStreamControlsController';
import { updateCameraButtonUi } from './sessions/call/controls/cameraUi';
import { initMediaSettingsBindings } from './media/devices/mediaSettingsBindingsController';
import {
  getWorkspaceContextGen,
  isWorkspaceContextGenCurrent,
  resetWorkspaceGenerations,
  getLyricsEditGen,
  getLyricsSaveGen,
  incrementLyricsEditGen,
  incrementLyricsSaveGen,
  getNotesEditGen,
  getNotesSaveGen,
  incrementNotesEditGen,
  incrementNotesSaveGen,
  getStructureEditGen,
  getStructureSaveGen,
  incrementStructureEditGen,
  incrementStructureSaveGen,
  getTasksEditGen,
  getTasksSaveGen,
  incrementTasksEditGen,
  incrementTasksSaveGen
} from './workspace/core/workspaceGenerationState';
import {
  initAuthNavigation,
  openAuthView,
  openSettings,
  getLastActiveViewBeforeSettings
} from './auth/login/authNavigationController';
import {
  initParticipantIdentityUi,
  updateParticipantIdentityUi
} from './sessions/call/moderation/participantIdentityUi';
import {
  initWaitingRoomController
} from './sessions/call/waiting/waitingRoomController';
import {
  initSessionModeration,
  getIsSessionLocked,
  setIsSessionLocked
} from './sessions/call/moderation/sessionModerationController';
import {
  initCallNavigation
} from './sessions/call/lifecycle/callNavigationController';
import {
  initSessionTimer,
  startSessionTimer,
  stopSessionTimer
} from './sessions/call/lifecycle/sessionTimer';
import {
  setCallStatus
} from './sessions/call/view/sessionStatusUi';
import {
  initSessionKeyboard
} from './sessions/call/controls/sessionKeyboardController';
import {
  startRendererApp
} from './core/appBootstrap';
import {
  initDesktopLifecycle
} from './core/desktopLifecycleController';
import {
  handleScheduledSessionNotificationClick
} from './sessions/scheduled/scheduledNotificationUi';
import {
  hasLyricsSaveTimeout,
  clearLyricsSaveTimeout
} from './workspace/lyrics/lyricsController';
import {
  getStructureSections
} from './workspace/structure/structureController';
import {
  debounceSaveStructure,
  saveStructureWorkspace,
  hasStructureSaveTimeout,
  clearStructureSaveTimeout
} from './workspace/structure/structurePersistence';
import {
  getActiveSongState
} from './songs/state/songState';
import {
  saveSongsWorkspace
} from './songs/state/songsPersistence';
import {
  saveLyricsWorkspace
} from './workspace/lyrics/lyricsPersistence';
import {
  saveNotesWorkspace,
  hasNotesSaveTimeout,
  clearNotesSaveTimeout
} from './workspace/notes/notesPersistence';
import {
  initAuthStateUiController,
  updateAuthUi
} from './auth/login/authStateUiController';
import {
  getPendingJoinCode,
  setPendingJoinCode,
  clearPendingJoinCode
} from './auth/guest/guestJoinController';
import {
  views,
  showView,
  setBusy,
  initViewController
} from './core/viewController';
import {
  initHomeSessionController
} from './sessions/home/homeSessionController';
import {
  initStudioSetupController
} from './sessions/setup/studioSetupController';
import {
  type PendingAction
} from './sessions/setup/studioPreparation';
import {
  initCallModeUi,
  setModeRadios,
  updateMusicWarning,
  updateCallMode
} from './sessions/call/controls/callModeUi';
import {
  parseSessionError
} from './sessions/setup/sessionErrorParser';
import {
  showSessionErrorModal
} from './sessions/setup/sessionErrorUi';
import {
  createActiveCallController
} from './sessions/call/lifecycle/activeCallController';
import {
  createCallTerminationController
} from './sessions/call/lifecycle/callTerminationController';
import {
  initProfileUiController
} from './auth/profile/profileUiController';
import {
  initProjectSessionsController
} from './projects/sessions/projectSessionsController';
import {
  setIsSongStudioVisible
} from './songs/studio/songStudioUi';
import {
  switchActiveSong
} from './songs/state/songSwitchController';
import {
  updateSongCustomization
} from './songs/state/songsController';
import {
  initLyricsDocumentsController,
  getActiveLyricsDoc
} from './workspace/lyrics/lyricsDocumentsController';
import {
  getProjectTasks
} from './workspace/tasks/tasksController';
import {
  debounceSaveTasks,
  saveTasksWorkspace,
  clearTasksSaveTimeout
} from './workspace/tasks/tasksPersistence';
import {
  syncWorkspaceInputsFromProject
} from './workspace/core/workspaceSyncController';
import {
  applyAuthoritativeWorkspaceUpdate
} from './workspace/core/authoritativeWorkspaceController';
import {
  flushAllWorkspacePendingSaves
} from './workspace/core/workspaceFlushController';
import {
  handleDeepLink
} from './sessions/join/deepLinkController';
import {
  switchProjectTab,
  resetProjectTabsUi,
  initProjectTabsUi
} from './projects/navigation/projectTabsUi';
import {
  toggleShortcutsModal
} from './sessions/call/controls/callShortcutsUi';
import {
  updateLyricsDocumentPagination
} from './workspace/lyrics/lyricsUi';
import {
  renderStructureWorkspace,
  setStructureStatus,
  focusStructureSection
} from './workspace/structure/structureUi';
import {
  getNotesFieldValues
} from './workspace/notes/notesUi';
import {
  renderTasksWorkspace,
  setTasksStatus
} from './workspace/tasks/tasksUi';
import {
  renderProjectOverviewSongsList,
  renderProjectSongsSelector,
  renderSongStudioHeader
} from './songs/studio/songSelectorUi';
import { ScheduledNotificationManager } from './sessions/scheduled/scheduledNotifications';
import { LocalAudioSourceManager } from './media/audio/sources/audioSources';
import { LevelMeter } from './media/audio/meter/levelMeter';
import { SignalingClient } from './media/remote/signaling';
import { AuthManager } from './auth/login/auth';
import { WebRtcSession } from './media/remote/webrtc';
import { presenter } from './media/video/presenter';
import { escapeHtml, sanitizeLyricsHtml, safeAvatarColor } from './core/htmlSecurity';
import { initActivityHistory, renderProjectActivities } from './sessions/call/activity/activity';
import { initSessionChat, setSessionChatOpen, setOnChatOpenCallback } from './sessions/call/chat/chat';
import { stopRemoteVoiceBridge } from './media/remote/remoteVoiceBridge';
import { logger } from './core/logger';
import { type StudioMixerChannel } from './media/mixer/studioMixerLogic';
import { hydrateStudioMixerEqPersistence } from './media/mixer/studioMixerStorage';
import { initStudioMixerPopoversAndControls } from './media/mixer/studioMixerUi';
import { createStudioMixerController } from './media/mixer/studioMixerController';
import { initPresenterCoordinationController } from './sessions/call/controls/presenterCoordinationController';
import { initMediaHardwareControlsController } from './media/devices/mediaHardwareControlsController';
import { initCallSignalingListenersController } from './sessions/call/lifecycle/callSignalingListenersController';
import {
  createRemoteAudioGraphController
} from './media/remote/remoteAudioGraphController';
import {
  readPreferences,
  savePreferences as persistPreferences,
  type Preferences,
  type VoiceInputConfig
} from './core/preferences';
import { signalingUrl, participantId } from './core/runtime';
import { $, setText, setMessage } from './core/dom';
import {
  type ParticipantViewMode,
  type ScreenViewMode,
  type ParticipantTarget,
  setSessionViewStateProvider,
  getCameraViewMode,
  getActiveSpeaker,
  setActiveSpeaker
} from './sessions/call/view/sessionViewState';
import {
  applyParticipantViewLayout,
  updateSessionStage,
  toggleSessionViewMenu,
  closeSessionViewMenu,
  toggleSessionLayout,
  updateSessionViewButton,
  renderSessionViewMenu
} from './sessions/call/view/sessionViewUi';
import './styles/index.css';

export { escapeHtml, sanitizeLyricsHtml, safeAvatarColor };

const scheduledNotifications = new ScheduledNotificationManager();
scheduledNotifications.onSessionClick((sessionId) => {
  handleScheduledSessionNotificationClick(sessionId, {
    onNavigateHome: () => showView('home-view')
  });
});

logger.initGlobalErrorHandling();
logger.info('renderer_startup', 'JaMeet renderer application initialized', { participantId });

projectsApi.setApiBase(signalingUrl);
setScheduledApiBase(signalingUrl);

const auth = new AuthManager(signalingUrl);
const signaling = new SignalingClient(signalingUrl);
initWorkspaceCoreController({
  getProject: () => activeProject,
  getUser: () => auth.getUser(),
  getActiveSong: () => getActiveSong(),
  getActiveLyricsDoc: () => getActiveLyricsDoc(),
  onRenderProjectSongsSelector: () => {
    renderProjectSongsSelector();
  },
  onRenderLyricsDocTabs: (doc) => {
    renderLyricsDocTabs(doc);
  },
  onUpdateLyricsStats: (html) => {
    updateLyricsStatsFromHtml(html);
  },
  onSyncNotesControls: (values, force) => {
    syncNotesControls(values, force);
  },
  onRenderStructureWorkspace: () => {
    renderStructureWorkspace();
  },
  onRenderTasksWorkspace: () => {
    renderTasksWorkspace();
  },
  onRenderProjectActivities: (project, user) => {
    renderProjectActivities(project, user);
  },
  getLyricsStatus: () => getLyricsStatus(),
  setLyricsStatus: (status) => {
    setLyricsStatus(status);
  },
  hasLyricsSaveTimeout: () => hasLyricsSaveTimeout(),
  clearLyricsSaveTimeout: () => {
    clearLyricsSaveTimeout();
  },
  onSaveLyricsWorkspace: (content, id, title) => {
    return saveLyricsWorkspace(content, id, title);
  },
  getNotesStatus: () => getNotesStatus(),
  setNotesStatus: (status) => {
    setNotesStatus(status);
  },
  hasNotesSaveTimeout: () => hasNotesSaveTimeout(),
  clearNotesSaveTimeout: () => {
    clearNotesSaveTimeout();
  },
  getNotesFieldValues: () => getNotesFieldValues(),
  onSaveNotesWorkspace: (content, bpm, key) => {
    return saveNotesWorkspace(content ?? '', bpm, key);
  },
  getStructureStatus: () => getStructureStatus(),
  setStructureStatus: (status) => {
    setStructureStatus(status);
  },
  hasStructureSaveTimeout: () => hasStructureSaveTimeout(),
  clearStructureSaveTimeout: () => {
    clearStructureSaveTimeout();
  },
  getStructureSections: () => getStructureSections(),
  onSaveStructureWorkspace: () => {
    return saveStructureWorkspace();
  },
  getTasksStatus: () => getTasksStatus(),
  setTasksStatus: (status) => {
    setTasksStatus(status);
  },
  hasTasksSaveTimeout: () => hasTasksSaveTimeout(),
  clearTasksSaveTimeout: () => {
    clearTasksSaveTimeout();
  },
  onSaveTasksWorkspace: () => {
    return saveTasksWorkspace();
  },
  onSaveSongsWorkspace: () => {
    return saveSongsWorkspace();
  },
  onApplyWorkspacePermissions: () => {
    applyWorkspacePermissions();
  }
});
initProjectCollaboratorsViewController({
  getProject: () => activeProject,
  getUser: () => auth.getUser()
});
initWorkspacePersistenceController({
  getProject: () => activeProject,
  getAuthToken: () => auth.getToken(),
  getUser: () => auth.getUser(),
  canUserEditProject: () => canUserEditProject(),
  getActiveSong: () => getActiveSong(),
  getActiveLyricsDoc: () => getActiveLyricsDoc(),
  getWorkspaceContextGen: () => getWorkspaceContextGen(),
  getLyricsEditGen: () => getLyricsEditGen(),
  getLyricsSaveGen: () => getLyricsSaveGen(),
  incrementLyricsSaveGen: () => incrementLyricsSaveGen(),
  setLyricsStatus: (status) => {
    setLyricsStatus(status);
  },
  getNotesEditGen: () => getNotesEditGen(),
  getNotesSaveGen: () => getNotesSaveGen(),
  incrementNotesSaveGen: () => incrementNotesSaveGen(),
  setNotesStatus: (status) => {
    setNotesStatus(status);
  },
  onSyncNotesControls: (values, force) => {
    syncNotesControls(values, force);
  },
  isSignalingConnected: () => signaling.isConnected(),
  onSignalingUpdateProjectWorkspace: async (projectId, payload, token) => {
    return signaling.updateProjectWorkspace(projectId, payload, token);
  },
  onApplyAuthoritativeWorkspace: (area, workspace) => {
    applyAuthoritativeWorkspaceUpdate(area as 'lyrics' | 'notes' | 'structure' | 'tasks', workspace);
  },
  onRenderProjectActivities: (project, user) => {
    renderProjectActivities(project, user);
  }
});
initWorkspaceRealtimeDomainController({
  signaling,
  getActiveProject: () => activeProject,
  getSessionProjectId: () => sessionProjectId,
  getUser: () => auth.getUser(),
  onRenderProjectActivities: (project, user) => {
    renderProjectActivities(project, user);
  },
  getActiveLyricsDoc: () => getActiveLyricsDoc(),
  onRenderLyricsDocTabs: (doc) => {
    renderLyricsDocTabs(doc);
  },
  onUpdateLyricsStats: (html) => {
    updateLyricsStatsFromHtml(html);
  },
  getLyricsStatus: () => getLyricsStatus(),
  setLyricsStatus: (status) => {
    setLyricsStatus(status);
  },
  hasLyricsSaveTimeout: () => hasLyricsSaveTimeout(),
  getNotesStatus: () => getNotesStatus(),
  setNotesStatus: (status) => {
    setNotesStatus(status);
  },
  hasNotesSaveTimeout: () => hasNotesSaveTimeout(),
  onSyncNotesControls: (values) => {
    syncNotesControls(values);
  },
  onScheduleNotesSaveRetry: (content, bpm, key) => {
    debounceSaveNotesRetry(content ?? '', bpm, key);
  },
  getStructureStatus: () => getStructureStatus(),
  setStructureStatus: (status) => {
    setStructureStatus(status);
  },
  hasStructureSaveTimeout: () => hasStructureSaveTimeout(),
  onRenderStructureWorkspace: () => {
    renderStructureWorkspace();
  },
  getTasksStatus: () => getTasksStatus(),
  setTasksStatus: (status) => {
    setTasksStatus(status);
  },
  hasTasksSaveTimeout: () => hasTasksSaveTimeout(),
  onRenderTasksWorkspace: () => {
    renderTasksWorkspace();
  }
});
initAuthStateUiController({
  onLoadScheduledSessions: () => loadScheduledSessions(),
  onLoadRecentSessions: () => loadRecentSessions(),
  onLoadProjects: () => loadProjects(),
  onStopScheduledNotifications: () => {
    scheduledNotifications.stop();
  }
});
initAuthNavigation({
  showView: (view) => showView(view as any),
  getViews: () => views,
  getUser: () => auth.getUser(),
  getGuestName: () => auth.getGuestName(),
  onCloseAccountMenu: () => closeAccountMenu(),
  onUpdateAuthUi: (user, guestName) => updateAuthUi(user, guestName),
  onEnumerateAndPopulate: () => enumerateAndPopulate()
});
initParticipantIdentityUi({
  getUser: () => auth.getUser(),
  getGuestName: () => auth.getGuestName(),
  getMyIdentity: () => myIdentity || undefined,
  getPeerIdentity: () => peerIdentity || undefined,
  getCurrentRole: () => currentRole,
  getPeerParticipantId: () => peerParticipantId || undefined,
  onUpdateSessionViewButton: () => updateSessionViewButton(),
  onRenderSessionViewMenu: () => renderSessionViewMenu()
});
initSessionViewSelectorUi({
  onToggleSessionViewMenu: (e) => toggleSessionViewMenu(e),
  onCloseSessionViewMenu: () => closeSessionViewMenu()
});
initWaitingRoomController({
  signaling,
  participantId,
  getAuthToken: () => auth.getToken(),
  getGuestName: () => auth.getGuestName(),
  getMetadata: () => metadata(),
  onRenderWaitingBanner: (waitingList) => renderWaitingBanner(waitingList),
  onInitializeActiveCall: async (ack) => {
    await initializeActiveCall(ack);
  }
});
initSessionModeration({
  signaling,
  getCurrentRole: () => currentRole,
  getCurrentCode: () => currentCode,
  getPeerParticipantId: () => peerParticipantId || undefined,
  getPeerIdentity: () => peerIdentity || undefined,
  onUpdateLockUi: () => updateLockUi(),
  onSetStatusMessage: (id, text, isError) => setMessage(id, text, isError)
});
initInviteLinkController({
  getCurrentCode: () => currentCode
});
initCallNavigation({
  onLeaveSession: (message) => leaveSession(message),
  onShowHomeView: () => showView('home-view')
});
initSessionTimer({
  isInCall: () => inCall,
  onSetCallStatus: (status) => setCallStatus(status)
});
initSessionKeyboard({
  isInCall: () => inCall,
  isShortcutsModalOpen: () => isShortcutsModalOpen(),
  closeShortcutsModal: () => closeShortcutsModal(),
  toggleShortcutsModal: () => toggleShortcutsModal(),
  isMuted: () => muted,
  toggleMute: () => toggleMute(),
  toggleCamera: () => toggleCamera(),
  getAudioMode: () => prefs.mode,
  switchAudioMode: (mode) => switchAudioMode(mode),
  hasActiveProject: () => Boolean(activeProject),
  isSessionWorkspaceOpen: () => isSessionWorkspaceOpen(),
  setSessionWorkspaceOpen: (open) => setSessionWorkspaceOpen(open),
  toggleStudioMixer: () => toggleStudioMixer()
});
initViewController({
  onUpdateLocalPreviews: () => updateLocalPreviews(),
  onUpdateAuthUi: () => updateAuthUi(auth.getUser(), auth.getGuestName()),
  onUpdateParticipantIdentityUi: () => updateParticipantIdentityUi()
});
initCallModeUi({
  onSwitchAudioMode: (mode) => switchAudioMode(mode),
  onUpdateHeadphoneWarning: () => updateHeadphoneWarning(),
  onUpdateLocalPreviews: () => updateLocalPreviews()
});
initHomeSessionController({
  getUser: () => auth.getUser(),
  onOpenAuthView: (tab) => openAuthView(tab),
  onPrepareStudio: (action) => prepareStudio(action),
  onEnumerateAndPopulate: () => enumerateAndPopulate(),
  onOpenSettings: (section) => openSettings(section),
  onSetPendingJoinCode: (code) => setPendingJoinCode(code),
  getDeviceErrorMessage: (error) => deviceError(error)
});
initStudioSetupController({
  onCancelCleanup: async () => {
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
  },
  getActiveProjectId: () => activeProjectId,
  getSessionProjectId: () => sessionProjectId,
  isAuthenticated: () => Boolean(auth.getUser() && auth.getToken()),
  onOpenProjectView: (projectId) => openProjectView(projectId),
  onShowHomeView: () => showView('home-view'),
  onEnumerateAndPopulate: () => enumerateAndPopulate(),
  onOpenSettings: (section) => openSettings(section),
  onShowSessionError: (error) => showSessionErrorModal(parseSessionError(error)),
  onEnterSession: () => enterSession()
});
initLyricsDocumentsController({
  getProject: () => activeProject,
  getActiveSong: () => getActiveSong(),
  onRenderLyricsDocTabs: (doc) => {
    renderLyricsDocTabs(doc);
  },
  onUpdateLyricsStats: (html) => {
    updateLyricsStatsFromHtml(html);
  },
  onIncrementLyricsEditGen: () => {
    incrementLyricsEditGen();
  },
  onSetLyricsStatus: (status) => {
    setLyricsStatus(status);
  },
  onSaveLyricsWorkspace: (content, id, title) => {
    void saveLyricsWorkspace(content, id, title);
  }
});
initStructureDomainController({
  getProject: () => activeProject,
  getActiveSong: () => getActiveSong(),
  canEdit: () => canUserEditProject(),
  onRenderStructureWorkspace: () => {
    renderStructureWorkspace();
  },
  onFocusStructureSection: (id) => {
    focusStructureSection(id);
  },
  onDebounceSaveStructure: () => {
    debounceSaveStructure();
  }
});
initStructurePersistence({
  getProject: () => activeProject,
  getAuthToken: () => auth.getToken(),
  canEdit: () => canUserEditProject(),
  getActiveSong: () => getActiveSong(),
  getStructureSections: () => getStructureSections(),
  getWorkspaceContextGen: () => getWorkspaceContextGen(),
  getStructureEditGen: () => getStructureEditGen(),
  getStructureSaveGen: () => getStructureSaveGen(),
  incrementStructureEditGen: () => incrementStructureEditGen(),
  incrementStructureSaveGen: () => incrementStructureSaveGen(),
  setStructureStatus: (status) => {
    setStructureStatus(status);
  },
  onUpdateSignaling: async (projectId, payload, token) => {
    return signaling.updateProjectWorkspace(projectId, payload, token);
  },
  onApplyAuthoritativeWorkspace: (area, workspace) => {
    applyAuthoritativeWorkspaceUpdate(area, workspace);
  },
  onRenderProjectActivities: (project) => {
    renderProjectActivities(project, auth.getUser());
  }
});
initTasksDomainController({
  getProject: () => activeProject,
  getAuthToken: () => auth.getToken(),
  canUserEditProject: () => canUserEditProject(),
  onRenderTasksWorkspace: () => {
    renderTasksWorkspace();
  },
  onDebounceSaveTasks: () => {
    debounceSaveTasks();
  },
  onClearTasksSaveTimeout: () => {
    clearTasksSaveTimeout();
  },
  onSaveTasksWorkspace: () => {
    return saveTasksWorkspace();
  },
  getTasks: () => getProjectTasks(),
  getWorkspaceContextGen: () => getWorkspaceContextGen(),
  getTasksEditGen: () => getTasksEditGen(),
  getTasksSaveGen: () => getTasksSaveGen(),
  incrementTasksEditGen: () => incrementTasksEditGen(),
  incrementTasksSaveGen: () => incrementTasksSaveGen(),
  setTasksStatus: (status) => {
    setTasksStatus(status);
  },
  onUpdateSignaling: async (projectId, payload, token) => {
    return signaling.updateProjectWorkspace(projectId, payload as any, token);
  },
  onApplyAuthoritativeWorkspace: (area, workspace) => {
    applyAuthoritativeWorkspaceUpdate(area as 'lyrics' | 'notes' | 'structure' | 'tasks', workspace);
  },
  onUpdateSongCustomization: (songId, changes) => {
    updateSongCustomization(songId, changes);
  }
});
initSongsDomainController({
  getProject: () => activeProject,
  canUserEditProject: () => canUserEditProject(),
  onRenderSongStudioHeader: () => {
    renderSongStudioHeader();
  },
  onApplyWorkspacePermissions: () => {
    applyWorkspacePermissions();
  },
  onSwitchProjectTab: (tab) => {
    switchProjectTab(tab);
  },
  onRenderProjectOverviewSongsList: () => {
    renderProjectOverviewSongsList();
  },
  hasLyricsSaveTimeout: () => hasLyricsSaveTimeout(),
  clearLyricsSaveTimeout: () => {
    clearLyricsSaveTimeout();
  },
  getActiveLyricsDoc: () => getActiveLyricsDoc(),
  onSaveLyricsWorkspace: (content, id, title) => {
    void saveLyricsWorkspace(content, id, title);
  },
  hasNotesSaveTimeout: () => hasNotesSaveTimeout(),
  clearNotesSaveTimeout: () => {
    clearNotesSaveTimeout();
  },
  getNotesFieldValues: () => getNotesFieldValues(),
  onSaveNotesWorkspace: (content, bpm, key) => {
    void saveNotesWorkspace(content ?? '', bpm, key);
  },
  hasStructureSaveTimeout: () => hasStructureSaveTimeout(),
  clearStructureSaveTimeout: () => {
    clearStructureSaveTimeout();
  },
  onSaveStructureWorkspace: () => {
    void saveStructureWorkspace();
  },
  onSyncWorkspaceInputs: (forceAll) => {
    syncWorkspaceInputsFromProject(forceAll);
  },
  onSaveSongsWorkspace: () => {
    return saveSongsWorkspace();
  },
  onRenderTasksWorkspace: () => {
    renderTasksWorkspace();
  }
});
initWorkspaceDrawerController({
  getProjectName: () => activeProject?.name,
  hasActiveProject: () => Boolean(activeProject),
  onSyncWorkspaceInputs: () => {
    syncWorkspaceInputsFromProject();
  },
  onRenderTasksWorkspace: () => {
    renderTasksWorkspace();
  },
  onRenderStructureWorkspace: () => {
    renderStructureWorkspace();
  },
  onUpdateLyricsPagination: () => {
    updateLyricsDocumentPagination();
  },
  setSessionChatOpen: (open) => {
    setSessionChatOpen(open);
  },
  setOnChatOpenCallback: (cb) => {
    setOnChatOpenCallback(cb);
  }
});
initDeepLinkDomainController({
  isInCall: () => inCall,
  getUser: () => auth.getUser(),
  onSetPendingJoinCode: (code) => {
    setPendingJoinCode(code);
  },
  onOpenAuthView: (mode) => {
    openAuthView(mode);
  },
  onPrepareStudio: async (options) => {
    await prepareStudio(options);
  }
});
initScheduledSessionsController({
  getAuthToken: () => auth.getToken(),
  notificationManager: scheduledNotifications,
  onPrepareStudio: (action) => {
    void prepareStudio(action);
  }
});
initRecentSessionsController({
  getUser: () => auth.getUser(),
  getRecentSessions: () => auth.getRecentSessions(),
  onPrepareStudio: (action) => {
    void prepareStudio(action);
  },
  onNavigateToAllSessions: () => {
    showView('all-sessions-view');
  },
  onNavigateToHome: () => {
    showView('home-view');
  }
});
const handleOpenFeedback = async (): Promise<void> => {
  const api = (window as any).jameet || (window as any).musiczoom;
  let appVer = '0.1.0';
  let appPlatform = 'darwin';
  let appArch = 'arm64';
  try {
    const info = await api?.getAppInfo?.();
    if (info?.version) appVer = info.version;
    if (info?.platform) appPlatform = info.platform;
    if (info?.arch) appArch = info.arch;
  } catch {}
  const feedbackUrl = buildFeedbackUrl({
    appVersion: appVer,
    platform: appPlatform,
    arch: appArch
  });
  if (api?.openExternalUrl) {
    void api.openExternalUrl(feedbackUrl);
  } else {
    window.open(feedbackUrl, '_blank');
  }
};

initAuthDomainController({
  auth,
  onOpenSettings: (section) => openSettings(section as any),
  onOpenAuthView: (mode) => openAuthView(mode),
  onShowHomeView: () => showView('home-view'),
  getLastActiveViewBeforeSettings: () => getLastActiveViewBeforeSettings(),
  onShowView: (view) => showView(view as any),
  getPendingJoinCode: () => getPendingJoinCode(),
  onClearPendingJoinCode: () => {
    clearPendingJoinCode();
  },
  onPrepareStudio: (action) => {
    void prepareStudio(action);
  },
  onSendFeedback: handleOpenFeedback
});
initLyricsDomainController({
  getActiveProject: () => activeProject,
  getActiveLyricsDoc: () => getActiveLyricsDoc(),
  onIncrementLyricsEditGen: () => {
    incrementLyricsEditGen();
  },
  onSaveLyricsWorkspace: async (content, docId, title) => {
    await saveLyricsWorkspace(content, docId, title);
  },
  isInCall: () => inCall,
  canEdit: () => canUserEditProject()
});
initNotesDomainController({
  canUserEditProject: () => canUserEditProject(),
  getActiveProject: () => activeProject,
  getActiveSong: () => getActiveSong(),
  onIncrementNotesEditGen: () => {
    incrementNotesEditGen();
  },
  onSaveNotesWorkspace: async (content, bpm, key) => {
    await saveNotesWorkspace(content ?? '', bpm, key);
  }
});
initProjectsDomainController({
  getAuthToken: () => auth.getToken(),
  getUser: () => auth.getUser(),
  onProjectsLoaded: (projects) => {
    projectsList = projects;
  },
  getProject: () => activeProject,
  renderCollaborators: () => {
    renderProjectCollaboratorsView();
  },
  applyWorkspacePermissions: () => {
    applyWorkspacePermissions();
  }
});
initProjectOpenDomainController({
  getAuthToken: () => auth.getToken(),
  onUnauthenticated: () => {
    showView('auth-view');
  },
  onResetWorkspaceGenerations: () => resetWorkspaceGenerations(),
  isContextGenCurrent: (gen) => isWorkspaceContextGenCurrent(gen),
  onProjectLoaded: (project, projectId) => {
    activeProject = project;
    activeProjectId = projectId;
  },
  onNavigateToProjectView: () => {
    showView('project-view');
  },
  onResetProjectTabs: () => {
    resetProjectTabs();
  },
  onRenderProjectView: () => {
    renderProjectView();
  },
  onSyncWorkspaceInputs: (forceAll) => {
    syncWorkspaceInputsFromProject(forceAll);
  },
  onJoinSignalingRoom: (projectId, token) => {
    return signaling.joinProjectWorkspace(projectId, token);
  }
});
initProjectSessionSummaryUi();
initProjectTabsUi({
  onSelectOverview: () => {
    renderProjectOverviewSongsList();
  }
});
initProjectSessionsController({
  getProject: () => activeProject,
  onOpenSummary: (project, session) => renderSessionSummaryModal(project, session),
  onFlushPendingSaves: () => flushAllWorkspacePendingSaves(),
  onSetActiveProjectId: (id) => {
    activeProjectId = id;
  },
  onPrepareStudio: (action) => prepareStudio(action)
});
initProjectCollaboratorsDomainController({
  getAuthToken: () => auth.getToken(),
  getProject: () => activeProject,
  onProjectUpdated: (updatedProject) => {
    activeProject = updatedProject;
  },
  onRefreshProjectView: () => {
    renderProjectView();
  },
  onRefreshCollaboratorsView: () => {
    renderProjectCollaboratorsView();
  }
});
initDialogUi();
initProjectManagementController({
  getAuthToken: () => auth.getToken(),
  getProject: () => activeProject,
  onProjectUpdated: (updated) => {
    activeProject = updated;
  },
  onRefreshProjectView: () => {
    renderProjectView();
  },
  onRefreshProjectsList: () => {
    void loadProjects();
  },
  onProjectDeleted: () => {
    activeProject = undefined;
    activeProjectId = undefined;
  },
  onNavigateHome: () => {
    showView('home-view');
  }
});
initProjectSongDeleteDomainController({
  getProject: () => activeProject,
  canUserEditProject: () => canUserEditProject(),
  onSwitchActiveSong: (songId) => switchActiveSong(songId),
  onRenderProjectSongsSelector: () => renderProjectSongsSelector(),
  onRenderProjectOverviewSongsList: () => renderProjectOverviewSongsList(),
  onApplyWorkspacePermissions: () => applyWorkspacePermissions(),
  onSaveSongsWorkspace: () => saveSongsWorkspace()
});
initCallShortcutsUi();
initGuestJoinController({
  onOpenSignIn: () => {
    openAuthView('login');
  },
  onSetGuestName: (name) => {
    auth.setGuestName(name);
  },
  onPrepareStudio: (action) => {
    void prepareStudio(action);
  }
});
initProjectNavigationDomainController({
  getProject: () => activeProject,
  onClearActiveProject: () => {
    activeProjectId = undefined;
    activeProject = undefined;
  },
  onFlushPendingSaves: () => flushAllWorkspacePendingSaves(),
  onShowHomeView: () => showView('home-view'),
  onLoadProjects: () => loadProjects(),
  onPrepareStudio: (action) => prepareStudio(action),
  onSetActiveProjectId: (id) => {
    activeProjectId = id;
  }
});
let myIdentity: ParticipantIdentity | null = null;
let peerIdentity: ParticipantIdentity | null = null;
let hostIdentity: ParticipantIdentity | null = null;
let peerParticipantId: string | null = null;

export type { VoiceInputConfig };

let prefs: Preferences = readPreferences();
const initialDesktopApi = (window as any).jameet || (window as any).musiczoom;
initialDesktopApi?.logger?.setSendCrashReports?.(prefs.sendCrashReports !== false);
let pending: PendingAction | undefined;
let currentCode = '';
let currentRole: 'host' | 'guest' = 'guest';
let currentIceServers: RTCIceServer[] = [];
let videoTrack: MediaStreamTrack | undefined;
let screenTrack: MediaStreamTrack | undefined;
let currentSharingSourceTitle = '';
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
const rtc = new WebRtcSession(
  signaling,
  audio,
  (stream) => setRemoteStream(stream),
  (id, purpose, track) => setRemoteAudio(id, purpose, track),
  (media) => handleRemoteMedia(media),
  (status) => setCallStatus(status),
  (isStereo) => {
    remoteVoiceIsStereo = isStereo;
    applyMixerAudioRouting();
  }
);

setSessionViewStateProvider(() => ({
  screenTrack,
  remoteMedia,
  remoteVideoStream,
  peerIdentity,
  myIdentity,
  sharingSourceTitle: currentSharingSourceTitle
}));

initSessionStats({
  getStatsReport: () => rtc.getStatsReport(),
  isInCall: () => inCall,
  getPreferences: () => prefs,
  getEffectiveSampleRate: () => audio.primary?.effective.sampleRate,
  getVideoState: () => ({
    screenTrack,
    videoTrack,
    cameraEnabled,
    remoteVideoStream
  })
});

initWaitingRoomUi({
  onAdmit: async (participantId) => signaling.admitParticipant(currentCode, participantId)
});
let remoteVoiceMeter: LevelMeter | undefined = undefined;
let lastLocalVoiceDb = -60;
let lastRemoteVoiceDb = -60;
let lastLocalMusicDb = -60;
let lastLocalMusicPeakDb = -60;
function savePreferences(): void {
  persistPreferences(prefs);
}

function metadata(): MediaMetadata {
  return buildSessionMetadata({
    getAudioSources: () => audio.metadata(),
    isCameraEnabled: () => cameraEnabled,
    getCameraQuality: () => prefs.cameraQuality,
    getReceiveQuality: () => prefs.receiveQuality,
    hasScreenTrack: () => Boolean(screenTrack),
    isAudioOnly: () => audioOnly,
    getPerformanceMode: () => prefs.performanceMode
  });
}

function currentStream(): MediaStream {
  return buildCurrentStream(screenTrack, cameraEnabled, videoTrack);
}

function checkActiveSpeaker(): void {
  checkActiveSpeakerImpl({
    isLocalMuted: () => muted,
    isRemoteMuted: () => remoteMuted,
    getLastLocalVoiceDb: () => lastLocalVoiceDb,
    getLastRemoteVoiceDb: () => lastRemoteVoiceDb,
    getActiveSpeaker: () => getActiveSpeaker(),
    onSetActiveSpeaker: (speaker) => setActiveSpeaker(speaker),
    getCameraViewMode: () => getCameraViewMode(),
    onApplyParticipantViewLayout: () => applyParticipantViewLayout()
  });
}

function updateLocalPreviews(): void {
  updateLocalPreviewsHelper({
    getScreenTrack: () => screenTrack,
    getVideoTrack: () => videoTrack,
    isCameraEnabled: () => cameraEnabled,
    getPreferences: () => prefs,
    onUpdateSessionStage: () => updateSessionStage()
  });
}

const {
  acquireVideo,
  replaceCamera
} = createLocalVideoController({
  getPreferences: () => prefs,
  onSavePreferences: () => savePreferences(),
  isCameraEnabled: () => cameraEnabled,
  getScreenTrack: () => screenTrack,
  getVideoTrack: () => videoTrack,
  setVideoTrack: (track) => { videoTrack = track; },
  isInCall: () => inCall,
  onReplaceRtcVideoTrack: (track) => rtc.replaceVideoTrack(track),
  onSetRtcVideoTrack: (track) => rtc.setVideoTrack(track),
  onUpdateCameraButtonState: () => updateCameraButtonState(),
  onUpdateLocalPreviews: () => updateLocalPreviews()
});

let cachedHardwareDevices: HardwareAudioDeviceInfo[] = [];

function meterInterval(): number { return getMeterInterval(prefs.performanceMode); }
function effectiveMusicBitrate(): number { return getEffectiveMusicBitrate(prefs); }

const {
  getOrCreateVoiceMeter,
  updateVoiceInIndicator,
  renderVoiceLevel,
  renderMusicLevel,
  renderVoiceInputControls
} = createVoiceInputsUi({
  getPreferences: () => prefs,
  onSavePreferences: () => savePreferences(),
  getVoiceMeters: () => voiceMeters,
  getActiveMicLevels: () => activeMicLevels,
  getActiveMicPeaks: () => activeMicPeaks,
  isMuted: () => muted,
  onSetLastLocalVoiceDb: (db) => { lastLocalVoiceDb = db; },
  onSetLastLocalMusicDb: (db) => { lastLocalMusicDb = db; },
  onSetLastLocalMusicPeakDb: (db) => { lastLocalMusicPeakDb = db; },
  onCheckActiveSpeaker: () => checkActiveSpeaker(),
  getAudio: () => audio,
  getCachedHardwareDevices: () => cachedHardwareDevices,
  onSyncAllVoiceMics: () => syncAllVoiceMics(),
  onEnumerateAndPopulate: () => enumerateAndPopulate(),
  getStudioMixerChannels: () => studioMixerChannels,
  isStudioMixerOpen: () => studioMixerOpen,
  onSaveStudioMixerConfig: (immediate) => saveStudioMixerConfig(immediate),
  onRenderStudioMixer: () => renderStudioMixer(),
  onApplyMixerAudioRouting: () => applyMixerAudioRouting(),
  isInCall: () => inCall,
  onSetMessage: (id, text, isError) => setMessage(id, text, isError)
});

const {
  syncAllVoiceMics,
  replaceAudioInput,
  refreshRunningApps,
  replaceMusicInput
} = createLocalAudioCaptureController({
  getPreferences: () => prefs,
  onSavePreferences: () => savePreferences(),
  onSetModeRadios: (mode) => setModeRadios(mode),
  getVoiceMeters: () => voiceMeters,
  getActiveMicLevels: () => activeMicLevels,
  getActiveMicPeaks: () => activeMicPeaks,
  getAudio: () => audio,
  getMusicMeter: () => musicMeter,
  getMeterInterval: () => meterInterval(),
  getOrCreateVoiceMeter: (id) => getOrCreateVoiceMeter(id),
  onRenderVoiceLevel: (micId, reading) => renderVoiceLevel(micId, reading),
  onRenderMusicLevel: (reading) => renderMusicLevel(reading),
  onSetLastLocalMusicDb: (db) => { lastLocalMusicDb = db; },
  onSetLastLocalMusicPeakDb: (db) => { lastLocalMusicPeakDb = db; },
  getCachedHardwareDevices: () => cachedHardwareDevices,
  onSyncMixerChannelsWithVoiceInputs: () => syncMixerChannelsWithVoiceInputs(),
  onApplyMixerAudioRouting: () => applyMixerAudioRouting(),
  onRenderAudioLimitations: () => renderAudioLimitations(),
  onUpdateLocalPreviews: () => updateLocalPreviews(),
  onUpdateCallMode: () => updateCallMode(prefs.mode),
  onPopulateMusicAppSelectOptions: (apps, p) => populateMusicAppSelectOptions(apps, p),
  isInCall: () => inCall,
  getCurrentCode: () => currentCode,
  getMetadata: () => metadata(),
  onSignalingUpdateMedia: (code, meta) => signaling.updateMedia(code, meta),
  onRtcAudioChanged: (mode) => rtc.audioChanged(mode),
  onRtcAudioSourceChanged: (source) => rtc.audioSourceChanged(source)
});

const {
  enumerateAndPopulate,
  prepareStudio,
  renderAudioLimitations
} = createStudioPreparationController({
  getPreferences: () => prefs,
  onSavePreferences: () => savePreferences(),
  getCachedHardwareDevices: () => cachedHardwareDevices,
  setCachedHardwareDevices: (devices) => {
    cachedHardwareDevices = devices;
  },
  onRefreshRunningApps: () => refreshRunningApps(),
  onRenderVoiceInputControls: (audioInputs) => renderVoiceInputControls(audioInputs),
  onSetMessage: (id, text, isError) => setMessage(id, text, isError),
  isInCall: () => inCall,
  isAudioOnly: () => audioOnly,
  onSetModeRadios: (mode) => setModeRadios(mode),
  setPendingAction: (act) => {
    pending = act;
  },
  getCurrentCode: () => currentCode,
  setCurrentCode: (code) => {
    currentCode = code;
  },
  onShowView: (view) => showView(view as any),
  setBusy: (busy) => setBusy(busy),
  onUpdateMusicWarning: () => updateMusicWarning(),
  onUpdateCameraButtonState: () => updateCameraButtonState(),
  onUpdateLocalPreviews: () => updateLocalPreviews(),
  onSyncAllVoiceMics: (mode) => syncAllVoiceMics(mode),
  onReplaceCamera: (camId) => replaceCamera(camId),
  onReplaceMusicInput: () => replaceMusicInput(),
  getPrimaryAudioSource: () => audio.primary
});

const {
  startScreenShare,
  stopScreenShare,
  setScreenSharingUi,
  showScreenPicker
} = createScreenSharingController({
  isInCall: () => inCall,
  getScreenTrack: () => screenTrack,
  setScreenTrack: (track) => { screenTrack = track; },
  getVideoTrack: () => videoTrack,
  setVideoTrack: (track) => { videoTrack = track; },
  isCameraEnabled: () => cameraEnabled,
  isMuted: () => muted,
  getPreferences: () => prefs,
  getCurrentSharingSourceTitle: () => currentSharingSourceTitle,
  setCurrentSharingSourceTitle: (title) => { currentSharingSourceTitle = title; },
  getCurrentCode: () => currentCode,
  getMetadata: () => metadata(),
  getLastRemoteVoiceDb: () => lastRemoteVoiceDb,
  getLastLocalVoiceDb: () => lastLocalVoiceDb,
  getUserName: () => auth.getUser()?.displayName || auth.getGuestName() || 'You',
  onReplaceRtcVideoTrack: (track) => rtc.replaceVideoTrack(track),
  onSetRtcVideoTrack: (track) => rtc.setVideoTrack(track),
  onRemoveRtcVideoTrack: () => rtc.removeVideoTrack(),
  onAddAudioExternal: (id, purpose, track) => audio.addExternal(id, purpose, track),
  onRemoveAudioExternal: (id) => audio.remove(id),
  onRtcAudioSourceChanged: (id) => rtc.audioSourceChanged(id),
  onSignalingUpdateMedia: (code, meta) => signaling.updateMedia(code, meta),
  onAcquireVideo: (cameraId) => acquireVideo(cameraId),
  onUpdateLocalPreviews: () => updateLocalPreviews(),
  onSetCallStatus: (status) => setCallStatus(status),
  onSetMessage: (id, text, isError) => setMessage(id, text, isError),
  onSetText: (id, text) => setText(id, text)
});

const {
  setOutputDevice,
  testSpeakers,
  testMicrophone,
  getMicrophonePlayback
} = createAudioOutputRoutingController({
  getPreferences: () => prefs,
  onSavePreferences: () => savePreferences(),
  getRemoteAudioCtx: () => remoteAudioCtx,
  getPrimaryTrack: () => audio.primary?.track,
  onUpdateHeadphoneWarning: () => updateHeadphoneWarning(),
  onSetMessage: (id, text, isError) => setMessage(id, text, isError)
});

const {
  setRemoteStream,
  handleRemoteMedia,
  updateLockUi,
  initializeActiveCall,
  enterSession
} = createActiveCallController({
  getPreferences: () => prefs,
  getVideoTrack: () => videoTrack,
  onSetVideoTrackOnRtc: (track) => rtc.setVideoTrack(track),
  getEffectiveMusicBitrate: () => effectiveMusicBitrate(),
  onConfigureRtc: (code, role, iceServers, mode, quality, bitrate, peerMedia) => {
    rtc.configure(code, role, iceServers, mode, quality, bitrate, peerMedia);
  },
  getCurrentCode: () => currentCode,
  setCurrentCode: (code) => { currentCode = code; },
  getCurrentRole: () => currentRole,
  setCurrentRole: (role) => { currentRole = role; },
  setCurrentIceServers: (servers) => { currentIceServers = servers; },
  setMyIdentity: (identity) => { myIdentity = identity; },
  setHostIdentity: (identity) => { hostIdentity = identity; },
  setPeerIdentity: (identity) => { peerIdentity = identity; },
  setPeerParticipantId: (id) => { peerParticipantId = id; },
  isInCall: () => inCall,
  setInCall: (inCallState) => { inCall = inCallState; },
  onUpdateCallMode: () => updateCallMode(prefs.mode),
  onUpdateCameraButtonState: () => updateCameraButtonState(),
  onUpdateLocalPreviews: () => updateLocalPreviews(),
  onUpdateParticipantIdentityUi: () => updateParticipantIdentityUi(),
  setRemoteMuted: (muted) => { remoteMuted = muted; },
  onResetStudioMixerChannels: () => {
    studioMixerChannels.forEach((ch) => {
      ch.muted = false;
      ch.soloed = false;
    });
  },
  isStudioMixerOpen: () => studioMixerOpen,
  onRenderStudioMixer: () => renderStudioMixer(),
  onApplyMixerAudioRouting: () => applyMixerAudioRouting(),
  getAuthToken: () => auth.getToken(),
  getGuestName: () => auth.getGuestName(),
  getParticipantId: () => participantId,
  getMetadata: () => metadata(),
  getActiveProjectId: () => activeProjectId,
  setSessionProjectId: (id) => { sessionProjectId = id; },
  onResetWorkspaceGenerations: () => resetWorkspaceGenerations(),
  getWorkspaceContextGen: () => getWorkspaceContextGen(),
  getActiveProject: () => activeProject,
  setActiveProject: (p) => { activeProject = p; },
  setActiveProjectId: (id) => { activeProjectId = id; },
  onSyncWorkspaceInputsFromProject: (force) => syncWorkspaceInputsFromProject(force),
  onJoinProjectWorkspace: (projectId, token) => signaling.joinProjectWorkspace(projectId, token),
  onResetChatUi: () => resetChatUi(),
  getIsSessionLocked: () => getIsSessionLocked(),
  onSetIsSessionLocked: (locked) => setIsSessionLocked(locked),
  onShowView: (view) => showView(view as any),
  onStartSessionTimer: () => startSessionTimer(),
  getPendingPeerMedia: () => pendingPeerMedia,
  clearPendingPeerMedia: () => { pendingPeerMedia = undefined; },
  onPeerReady: (media) => rtc.peerReady(media),
  getPendingAction: () => pending || null,
  hasPrimaryAudio: () => audio.hasActiveVoiceTrack(),
  isAudioOnly: () => audioOnly,
  setBusy: (busy) => setBusy(busy),
  onSignalingCreate: (pId, meta, token, guestName, projId, waitingRoom) =>
    signaling.create(pId, meta, token || undefined, guestName || undefined, projId, waitingRoom),
  onSignalingJoin: (code, pId, meta, token, guestName) =>
    signaling.join(code, pId, meta, token || undefined, guestName || undefined),
  onSignalingLeave: () => signaling.leave(),
  onOpenAuthView: (tab) => openAuthView(tab === 'signup' || tab === 'register' ? 'register' : 'login'),
  getRemoteMedia: () => remoteMedia,
  setRemoteMedia: (media) => { remoteMedia = media; },
  getRemoteVideoStream: () => remoteVideoStream,
  setRemoteVideoStream: (stream) => { remoteVideoStream = stream; },
  onSetOutputDevice: (deviceId) => setOutputDevice(deviceId),
  onSetCallStatus: (status) => setCallStatus(status),
  onUpdateSessionStage: () => updateSessionStage(),
  onSetText: (id, text) => setText(id, text)
});

let remoteAudioCtx: AudioContext | undefined;
let remoteVoiceGain: GainNode | undefined;
let remoteMusicGain: GainNode | undefined;
let remoteMasterGain: GainNode | undefined;
let remoteVoiceIsStereo = false;
let remoteVoicePanner: StereoPannerNode | undefined;
let remoteVoiceMeterSplitter: ChannelSplitterNode | undefined;
let remoteVoiceSplitter: ChannelSplitterNode | undefined;
let remoteVoiceLeftGain: GainNode | undefined;
let remoteVoiceRightGain: GainNode | undefined;
let remoteVoiceMerger: ChannelMergerNode | undefined;
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
const remoteMusicSourceNodes = new Map<string, { track: MediaStreamTrack; sourceNode: MediaStreamAudioSourceNode }>();

const {
  getOrCreateRemoteAudioContext,
  setRemoteAudio,
  refreshRemoteAudio,
  cleanupRemoteAudioGraph
} = createRemoteAudioGraphController({
  getRemoteAudioCtx: () => remoteAudioCtx,
  setRemoteAudioCtx: (ctx) => { remoteAudioCtx = ctx; },
  getRemoteVoiceGain: () => remoteVoiceGain,
  setRemoteVoiceGain: (node) => { remoteVoiceGain = node; },
  getRemoteMusicGain: () => remoteMusicGain,
  setRemoteMusicGain: (node) => { remoteMusicGain = node; },
  getRemoteMasterGain: () => remoteMasterGain,
  setRemoteMasterGain: (node) => { remoteMasterGain = node; },
  isRemoteVoiceStereo: () => remoteVoiceIsStereo,
  setRemoteVoiceStereo: (val) => { remoteVoiceIsStereo = val; },
  getRemoteVoicePanner: () => remoteVoicePanner,
  setRemoteVoicePanner: (node) => { remoteVoicePanner = node; },
  getRemoteVoiceMeterSplitter: () => remoteVoiceMeterSplitter,
  setRemoteVoiceMeterSplitter: (node) => { remoteVoiceMeterSplitter = node; },
  getRemoteVoiceSplitter: () => remoteVoiceSplitter,
  setRemoteVoiceSplitter: (node) => { remoteVoiceSplitter = node; },
  getRemoteVoiceLeftGain: () => remoteVoiceLeftGain,
  setRemoteVoiceLeftGain: (node) => { remoteVoiceLeftGain = node; },
  getRemoteVoiceRightGain: () => remoteVoiceRightGain,
  setRemoteVoiceRightGain: (node) => { remoteVoiceRightGain = node; },
  getRemoteVoiceMerger: () => remoteVoiceMerger,
  setRemoteVoiceMerger: (node) => { remoteVoiceMerger = node; },
  getRemoteMusicSplitter: () => remoteMusicSplitter,
  setRemoteMusicSplitter: (node) => { remoteMusicSplitter = node; },
  getRemoteMusicLeftGain: () => remoteMusicLeftGain,
  setRemoteMusicLeftGain: (node) => { remoteMusicLeftGain = node; },
  getRemoteMusicRightGain: () => remoteMusicRightGain,
  setRemoteMusicRightGain: (node) => { remoteMusicRightGain = node; },
  getRemoteMusicMerger: () => remoteMusicMerger,
  setRemoteMusicMerger: (node) => { remoteMusicMerger = node; },
  getRemoteVoiceAnalyserL: () => remoteVoiceAnalyserL,
  setRemoteVoiceAnalyserL: (node) => { remoteVoiceAnalyserL = node; },
  getRemoteVoiceAnalyserR: () => remoteVoiceAnalyserR,
  setRemoteVoiceAnalyserR: (node) => { remoteVoiceAnalyserR = node; },
  getRemoteMusicAnalyserL: () => remoteMusicAnalyserL,
  setRemoteMusicAnalyserL: (node) => { remoteMusicAnalyserL = node; },
  getRemoteMusicAnalyserR: () => remoteMusicAnalyserR,
  setRemoteMusicAnalyserR: (node) => { remoteMusicAnalyserR = node; },
  getRemoteMasterAnalyserL: () => remoteMasterAnalyserL,
  setRemoteMasterAnalyserL: (node) => { remoteMasterAnalyserL = node; },
  getRemoteMasterAnalyserR: () => remoteMasterAnalyserR,
  setRemoteMasterAnalyserR: (node) => { remoteMasterAnalyserR = node; },
  getRemoteVoiceFxNodes: () => remoteVoiceFxNodes,
  setRemoteVoiceFxNodes: (nodes) => { remoteVoiceFxNodes = nodes; },
  getRemoteMusicFxNodes: () => remoteMusicFxNodes,
  setRemoteMusicFxNodes: (nodes) => { remoteMusicFxNodes = nodes; },
  getRemoteLimiter: () => remoteLimiter,
  setRemoteLimiter: (node) => { remoteLimiter = node; },
  getLastConnectedVoiceFx: () => lastConnectedVoiceFx,
  setLastConnectedVoiceFx: (val) => { lastConnectedVoiceFx = val; },
  getLastConnectedMusicFx: () => lastConnectedMusicFx,
  setLastConnectedMusicFx: (val) => { lastConnectedMusicFx = val; },
  getRemoteVoiceSourceNode: () => remoteVoiceSourceNode,
  setRemoteVoiceSourceNode: (node) => { remoteVoiceSourceNode = node; },
  getRemoteMusicSourceNodes: () => remoteMusicSourceNodes,
  getRemoteAudioTracks: () => remoteAudioTracks,
  isInCall: () => inCall,
  getPreferences: () => prefs,
  onApplyMixerAudioRouting: () => applyMixerAudioRouting(),
  onSetOutputDevice: (deviceId) => setOutputDevice(deviceId),
  onSetCallStatus: (status) => setCallStatus(status),
  isRtcVoiceStereo: () => rtc.isVoiceStereo(),
  getRemoteVoiceMeter: () => remoteVoiceMeter,
  setRemoteVoiceMeter: (meter) => { remoteVoiceMeter = meter; },
  isRemoteMuted: () => remoteMuted,
  onSetLastRemoteVoiceDb: (db) => { lastRemoteVoiceDb = db; },
  onCheckActiveSpeaker: () => checkActiveSpeaker()
});


const { leaveSession } = createCallTerminationController({
  onStopSessionTimer: () => stopSessionTimer(),
  getCurrentCode: () => currentCode,
  setCurrentCode: (code) => { currentCode = code; },
  isInCall: () => inCall,
  setInCall: (inCallState) => { inCall = inCallState; },
  onSignalingLeave: () => signaling.leave(),
  onRtcDispose: () => rtc.dispose(),
  getVoiceMeters: () => voiceMeters,
  getActiveMicLevels: () => activeMicLevels,
  getActiveMicPeaks: () => activeMicPeaks,
  getAudio: () => audio,
  getScreenTrack: () => screenTrack,
  setScreenTrack: (track) => { screenTrack = track; },
  getVideoTrack: () => videoTrack,
  setVideoTrack: (track) => { videoTrack = track; },
  getMusicMeter: () => musicMeter,
  onCleanupRemoteAudioGraph: () => cleanupRemoteAudioGraph(),
  onSetLastLocalVoiceDb: (db) => { lastLocalVoiceDb = db; },
  onSetLastRemoteVoiceDb: (db) => { lastRemoteVoiceDb = db; },
  onSetLastLocalMusicDb: (db) => { lastLocalMusicDb = db; },
  onSetLastLocalMusicPeakDb: (db) => { lastLocalMusicPeakDb = db; },
  onCheckActiveSpeaker: () => checkActiveSpeaker(),
  setRemoteMedia: (media) => { remoteMedia = media; },
  setRemoteMuted: (muted) => { remoteMuted = muted; },
  getStudioMixerChannels: () => studioMixerChannels,
  isStudioMixerOpen: () => studioMixerOpen,
  onRenderStudioMixer: () => renderStudioMixer(),
  getSessionProjectId: () => sessionProjectId,
  setSessionProjectId: (id) => { sessionProjectId = id; },
  getActiveProjectId: () => activeProjectId,
  setActiveProjectId: (id) => { activeProjectId = id; },
  setActiveProject: (p) => { activeProject = p; },
  setPeerIdentity: (identity) => { peerIdentity = identity; },
  setPeerParticipantId: (id) => { peerParticipantId = id; },
  onSetIsSessionLocked: (locked) => setIsSessionLocked(locked),
  onUpdateLockUi: () => updateLockUi(),
  getAuthUser: () => auth.getUser(),
  getAuthToken: () => auth.getToken(),
  onOpenProjectView: (projectId) => openProjectView(projectId),
  onShowView: (view) => showView(view as any),
  onLoadProjects: () => loadProjects(),
  isAudioOnly: () => audioOnly,
  getCameraId: () => prefs.cameraId,
  onReplaceCamera: (cameraId) => replaceCamera(cameraId),
  onSyncAllVoiceMics: () => syncAllVoiceMics()
});

function bindSelect(id: string, handler: (value: string) => Promise<void>): void {
  bindDeviceSelect(id, handler, {
    getPreferences: () => prefs,
    isInCall: () => inCall,
    onEnumerateAndPopulate: () => enumerateAndPopulate(),
    onSetMessage: (statusId, text, isError) => setMessage(statusId, text, isError)
  });
}

const {
  changeCameraQuality,
  changeReceiveQuality,
  changePerformanceMode,
  setAudioOnly,
  updateCameraButtonState,
  toggleCamera,
  applyAdvancedAudioSettings,
  updateHeadphoneWarning,
  fullscreenRemote,
  switchAudioMode,
  toggleMute
} = createMediaStreamControlsController({
  getPreferences: () => prefs,
  onSavePreferences: () => savePreferences(),
  isInCall: () => inCall,
  isAudioOnly: () => audioOnly,
  setAudioOnlyState: (enabled) => { audioOnly = enabled; },
  isCameraEnabled: () => cameraEnabled,
  setCameraEnabledState: (enabled) => { cameraEnabled = enabled; },
  isMuted: () => muted,
  setMutedState: (val) => { muted = val; },
  getVideoTrack: () => videoTrack,
  setVideoTrack: (track) => { videoTrack = track; },
  getScreenTrack: () => screenTrack,
  getRemoteMedia: () => remoteMedia,
  getCurrentCode: () => currentCode,
  getMetadata: () => metadata(),
  onReplaceCamera: (cameraId) => replaceCamera(cameraId),
  onAcquireVideo: (cameraId) => acquireVideo(cameraId),
  onSyncAllVoiceMics: (mode) => syncAllVoiceMics(mode),
  onReplaceMusicInput: () => replaceMusicInput(),
  onEnumerateAndPopulate: () => enumerateAndPopulate(),
  onUpdateLocalPreviews: () => updateLocalPreviews(),
  onApplyMixerAudioRouting: () => applyMixerAudioRouting(),
  onSyncMediaActiveState: () => syncMediaActiveState(),
  onSetMessage: (id, text, isError) => setMessage(id, text, isError),
  onVideoQualityChanged: (quality) => rtc.videoQualityChanged(quality),
  onMusicQualityChanged: (bitrate) => rtc.musicQualityChanged(bitrate),
  onRemoveRtcVideoTrack: () => rtc.removeVideoTrack(),
  onSignalingUpdateMedia: (code, meta) => signaling.updateMedia(code, meta),
  onSetModeRadios: (mode) => setModeRadios(mode),
  onUpdateCallMode: () => updateCallMode(prefs.mode),
  onUpdateMusicWarning: () => updateMusicWarning(),
  onShowSessionError: (error) => showSessionErrorModal(parseSessionError(error))
});

bindSelect('camera-select', (value) => replaceCamera(value || undefined));
bindSelect('call-camera-select', (value) => replaceCamera(value || undefined));
bindSelect('music-input-select', async (value) => { prefs.musicInputId = value || undefined; await replaceMusicInput(); await enumerateAndPopulate(); });
bindSelect('call-music-input-select', async (value) => { prefs.musicInputId = value || undefined; await replaceMusicInput(); await enumerateAndPopulate(); });
bindSelect('audio-output-select', async (value) => { await setOutputDevice(value || undefined); await enumerateAndPopulate(); });
bindSelect('call-audio-output-select', async (value) => { await setOutputDevice(value || undefined); await enumerateAndPopulate(); });

initMediaSettingsBindings({
  getPreferences: () => prefs,
  isInCall: () => inCall,
  bindSelect,
  onChangeCameraQuality: (quality) => changeCameraQuality(quality),
  onChangeReceiveQuality: (quality) => changeReceiveQuality(quality),
  onChangePerformanceMode: (mode) => changePerformanceMode(mode),
  onReplaceMusicInput: () => replaceMusicInput(),
  onRefreshRunningApps: () => refreshRunningApps(),
  onUpdateAppIconBadge: (pid) => updateMusicAppIconByPid(pid, getCachedRunningApps()),
  onTestSpeakers: () => testSpeakers(),
  onTestMicrophone: () => testMicrophone(),
  onSyncAllVoiceMics: () => syncAllVoiceMics(),
  onEnumerateAndPopulate: () => enumerateAndPopulate(),
  onSavePreferences: () => savePreferences(),
  onUpdateLocalPreviews: () => updateLocalPreviews(),
  onSetMessage: (id, text, isError) => setMessage(id, text, isError),
  onShowSessionError: (error) => showSessionErrorModal(parseSessionError(error))
});

const { syncMediaActiveState } = createMediaActiveStateController({
  isMuted: () => muted,
  hasActiveAudioSources: () => audio.hasActiveSources(),
  isCameraEnabled: () => cameraEnabled,
  getVideoTrack: () => videoTrack,
  getScreenTrack: () => screenTrack
});


initCallToolbarController({
  onToggleMute: () => toggleMute(),
  onToggleCamera: () => toggleCamera(),
  onShowScreenPicker: () => showScreenPicker(),
  hasScreenTrack: () => Boolean(screenTrack),
  getAudioMode: () => prefs.mode,
  onSwitchAudioMode: (mode) => switchAudioMode(mode),
  isAudioOnly: () => audioOnly,
  onSetAudioOnly: (only) => setAudioOnly(only),
  onSetCallStatus: (status) => setCallStatus(status)
});

const { openInCallAudioModal, closeInCallAudioModal } = initInCallAudioModalController({
  getAudioMode: () => prefs.mode,
  setModeRadios: (mode) => setModeRadios(mode),
  onEnumerateAndPopulate: () => enumerateAndPopulate(),
  onUpdateMusicWarning: () => updateMusicWarning(),
  onOpenSettings: (section) => openSettings(section),
  isInCall: () => inCall,
  isCallViewVisible: () => !$('call-view')?.classList.contains('hidden')
});


initPresenterCoordinationController({
  isMuted: () => muted,
  onToggleMute: () => toggleMute(),
  isCameraEnabled: () => cameraEnabled,
  onToggleCamera: () => toggleCamera(),
  getPreferences: () => prefs,
  onReplaceAudioInput: (deviceId, mode) => replaceAudioInput(deviceId, mode),
  isStudioMixerOpen: () => studioMixerOpen,
  onToggleStudioMixer: (forceOpen) => toggleStudioMixer(forceOpen),
  getScreenTrack: () => screenTrack,
  getCurrentSharingSourceTitle: () => currentSharingSourceTitle,
  getRemoteMedia: () => remoteMedia,
  getRemoteVideoStream: () => remoteVideoStream,
  onShowScreenPicker: () => showScreenPicker(),
  onEnumerateAndPopulate: () => enumerateAndPopulate(),
  onOpenSettings: (section) => openSettings(section),
  onCloseInCallAudioModal: () => closeInCallAudioModal(),
  onShowView: (view) => showView(view as any),
  getLastActiveViewBeforeSettings: () => getLastActiveViewBeforeSettings(),
  onStopScreenShare: () => stopScreenShare(),
  onSetCallStatus: (status) => setCallStatus(status)
});


initMediaHardwareControlsController({
  getPreferences: () => prefs,
  onSavePreferences: () => savePreferences(),
  isInCall: () => inCall,
  onReplaceAudioInput: (deviceId) => replaceAudioInput(deviceId),
  onReplaceMusicInput: () => replaceMusicInput(),
  onSetOutputDevice: (deviceId) => setOutputDevice(deviceId),
  onApplyAdvancedAudioSettings: () => applyAdvancedAudioSettings(),
  getPrimaryAudioChannels: () => audio.primary?.track.getSettings().channelCount ?? audio.primary?.effective.channelCount ?? (prefs.stereoMusic ? 2 : 1),
  onMusicQualityChanged: (bitrate) => {
    void rtc.musicQualityChanged(bitrate);
  },
  getEffectiveMusicBitrate: () => effectiveMusicBitrate(),
  onEnumerateAndPopulate: () => {
    void enumerateAndPopulate();
  },
  getStudioMixerChannels: () => studioMixerChannels,
  isStudioMixerOpen: () => studioMixerOpen,
  onSaveStudioMixerConfig: (immediate) => saveStudioMixerConfig(immediate),
  onRenderStudioMixer: () => renderStudioMixer(),
  onApplyMixerAudioRouting: () => applyMixerAudioRouting()
});
initSessionUtilityBindingsController({
  isRemoteMuted: () => remoteMuted,
  onToggleRemoteMuted: () => {
    remoteMuted = !remoteMuted;
  },
  onApplyMixerAudioRouting: () => applyMixerAudioRouting(),
  onFullscreenRemote: (isScreen) => fullscreenRemote(isScreen),
  onStopScreenShare: () => stopScreenShare(),
  onTestSpeakers: (pan) => testSpeakers(pan)
});



for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="settings-default-mode"]')) {
  radio.addEventListener('change', () => {
    prefs.mode = radio.value as AudioMode;
    savePreferences();
    void syncAllVoiceMics(prefs.mode);
  });
}

const crashReportingToggle = document.getElementById('setting-send-crash-reports') as HTMLInputElement | null;
if (crashReportingToggle) {
  crashReportingToggle.checked = prefs.sendCrashReports !== false;
  crashReportingToggle.addEventListener('change', () => {
    prefs.sendCrashReports = crashReportingToggle.checked;
    savePreferences();
    const api = (window as any).jameet || (window as any).musiczoom;
    api?.logger?.setSendCrashReports?.(prefs.sendCrashReports);
  });
}

$('btn-settings-feedback')?.addEventListener('click', () => {
  void handleOpenFeedback();
});

auth.onStateChange((user, guestName) => updateAuthUi(user, guestName || ''));

initCallSignalingListenersController({
  signaling,
  rtc,
  audio,
  auth,
  isInCall: () => inCall,
  setIsInCall: (val) => {
    inCall = val;
  },
  setCurrentCode: (code) => {
    currentCode = code;
  },
  clearPendingAction: () => {
    pending = undefined;
  },
  getVoiceMeters: () => voiceMeters,
  getActiveMicLevels: () => activeMicLevels,
  getActiveMicPeaks: () => activeMicPeaks,
  getVideoTrack: () => videoTrack,
  setVideoTrack: (track) => {
    videoTrack = track;
  },
  getMusicMeter: () => musicMeter,
  onResetMusicLevels: () => {
    lastLocalMusicDb = -60;
    lastLocalMusicPeakDb = -60;
  },
  getActiveProjectId: () => activeProjectId,
  getSessionProjectId: () => sessionProjectId,
  onOpenProjectView: (projectId) => {
    void openProjectView(projectId);
  },
  onShowHomeView: () => showView('home-view'),
  onSetCallStatus: (status) => setCallStatus(status),
  onSetPeerParticipantId: (id) => {
    peerParticipantId = id;
  },
  onSetPeerIdentity: (identity) => {
    peerIdentity = identity;
  },
  onUpdateParticipantIdentityUi: () => updateParticipantIdentityUi(),
  onSetPendingPeerMedia: (media) => {
    pendingPeerMedia = media;
  },
  onSetRemoteVoiceIsStereo: (isStereo) => {
    remoteVoiceIsStereo = isStereo;
  },
  getRemoteAudioTracks: () => remoteAudioTracks,
  getRemoteMusicSourceNodes: () => remoteMusicSourceNodes,
  onRefreshRemoteAudio: () => refreshRemoteAudio(),
  onLeaveSession: (message) => leaveSession(message)
});

initDesktopLifecycle({
  onDeviceChange: () => {
    void enumerateAndPopulate();
  },
  onBeforeUnload: () => {
    signaling.leave();
    signaling.disconnect();
    rtc.dispose();
    audio.dispose();
    const sharing = screenTrack;
    screenTrack = undefined;
    if (sharing) {
      sharing.onended = null;
      sharing.stop();
    }
    void presenter.stopNativeCapture();
    void presenter.exitPresenterMode();
    videoTrack?.stop();
    stopRemoteVoiceBridge();
    for (const m of voiceMeters.values()) void m.stop();
    void musicMeter.stop();
  },
  onHandleDeepLink: (url) => {
    void handleDeepLink(url);
  }
});

// Initial startup view and background device pre-warming
startRendererApp({
  onShowHomeView: () => showView('home-view'),
  onInitAuth: async () => {
    await auth.init();
  },
  onEnumerateAndPopulate: async () => {
    await enumerateAndPopulate();
  },
  isAudioOnly: () => audioOnly,
  getCameraId: () => prefs.cameraId,
  getAudioMode: () => prefs.mode,
  onReplaceCamera: async (camId) => {
    await replaceCamera(camId);
  },
  onSyncAllVoiceMics: async (mode) => {
    await syncAllVoiceMics(mode);
  }
});

// ======= PROJECTS SYSTEM =======

function resetProjectTabs(): void {
  setIsSongStudioVisible(false);
  resetProjectTabsUi();
}

function getActiveSong(): ProjectSongItem {
  return getActiveSongState(activeProject);
}



// ========================================================
// ACTIVITY HISTORY & SESSION CHAT SUBSYSTEMS
// ========================================================
initActivityHistory(() => activeProject ?? null, () => auth.getUser());
initSessionChat({ getSessionCode: () => currentCode, signaling });

// ========================================================
// LOGIC PRO STYLE STUDIO MULTITRACK MIXER SUBSYSTEM
// ========================================================
let studioMixerOpen = false;
let studioMixerChannels: StudioMixerChannel[] = [];

const {
  syncMixerChannelsWithVoiceInputs,
  toggleStudioMixer,
  applyMixerAudioRouting,
  saveStudioMixerConfig,
  renderStudioMixer,
  startMixerVuAnimation,
  stopMixerVuAnimation
} = createStudioMixerController({
  getChannels: () => studioMixerChannels,
  setChannels: (channels) => { studioMixerChannels = channels; },
  isStudioMixerOpen: () => studioMixerOpen,
  setStudioMixerOpen: (open) => { studioMixerOpen = open; },
  getPreferences: () => prefs,
  isMuted: () => muted,
  isRemoteMuted: () => remoteMuted,
  isInCall: () => inCall,
  isVoiceStereo: () => rtc.isVoiceStereo(),
  getAudio: () => audio,
  getRemoteAudioCtx: () => remoteAudioCtx,
  getRemoteVoiceGain: () => remoteVoiceGain,
  getRemoteMusicGain: () => remoteMusicGain,
  getRemoteMasterGain: () => remoteMasterGain,
  isRemoteVoiceStereo: () => remoteVoiceIsStereo,
  setRemoteVoiceStereo: (val) => { remoteVoiceIsStereo = val; },
  getRemoteVoicePanner: () => remoteVoicePanner,
  getRemoteVoiceMeterSplitter: () => remoteVoiceMeterSplitter,
  getRemoteVoiceSplitter: () => remoteVoiceSplitter,
  getRemoteVoiceLeftGain: () => remoteVoiceLeftGain,
  getRemoteVoiceRightGain: () => remoteVoiceRightGain,
  getRemoteVoiceMerger: () => remoteVoiceMerger,
  getRemoteMusicSplitter: () => remoteMusicSplitter,
  getRemoteMusicLeftGain: () => remoteMusicLeftGain,
  getRemoteMusicRightGain: () => remoteMusicRightGain,
  getRemoteMusicMerger: () => remoteMusicMerger,
  getRemoteVoiceAnalyserL: () => remoteVoiceAnalyserL,
  getRemoteVoiceAnalyserR: () => remoteVoiceAnalyserR,
  getRemoteMusicAnalyserL: () => remoteMusicAnalyserL,
  getRemoteMusicAnalyserR: () => remoteMusicAnalyserR,
  getRemoteMasterAnalyserL: () => remoteMasterAnalyserL,
  getRemoteMasterAnalyserR: () => remoteMasterAnalyserR,
  getRemoteVoiceFxNodes: () => remoteVoiceFxNodes,
  setRemoteVoiceFxNodes: (nodes) => { remoteVoiceFxNodes = nodes; },
  getRemoteMusicFxNodes: () => remoteMusicFxNodes,
  setRemoteMusicFxNodes: (nodes) => { remoteMusicFxNodes = nodes; },
  getLastConnectedVoiceFx: () => lastConnectedVoiceFx,
  setLastConnectedVoiceFx: (val) => { lastConnectedVoiceFx = val; },
  getLastConnectedMusicFx: () => lastConnectedMusicFx,
  setLastConnectedMusicFx: (val) => { lastConnectedMusicFx = val; },
  onSavePreferences: () => savePreferences()
});

hydrateStudioMixerEqPersistence();
syncMixerChannelsWithVoiceInputs();

initStudioMixerPopoversAndControls({
  getChannels: () => studioMixerChannels,
  getVoiceInputs: () => prefs.voiceInputs,
  onApplyMixerAudioRouting: () => applyMixerAudioRouting(),
  onSavePreferences: () => savePreferences(),
  onSetInputGain: (val) => {
    prefs.inputGain = val;
  },
  getVoiceMicEqDsp: (micIdx, slotIdx) => audio.getVoiceMicEqDsp(micIdx, slotIdx),
  getMusicEqDsp: (slotIdx) => audio.getMusicEqDsp(slotIdx),
  onToggleStudioMixer: (forceOpen) => toggleStudioMixer(forceOpen)
});

void (async () => {
  try {
    const api = (window as any).jameet || (window as any).musiczoom;
    let appVer = '0.1.0';
    try {
      const info = await api?.getAppInfo?.();
      if (info?.version) appVer = info.version;
    } catch {}
    await checkAppVersion({
      serverUrl: signalingUrl,
      currentVersion: appVer,
      onOpenExternal: (url) => {
        if (api?.openExternalUrl) void api.openExternalUrl(url);
        else window.open(url, '_blank');
      }
    });
  } catch (err) {
    console.warn('[VersionCheck] Background version check failed:', err);
  }
})();

