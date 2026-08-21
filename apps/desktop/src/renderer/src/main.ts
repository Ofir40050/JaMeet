import type { AudioMode, MediaMetadata, MeetingAck, PerformanceMode, VideoQuality, ParticipantIdentity, UserProfile, UpdateProfileRequest, Project, ProjectSessionItem, SessionHistoryItem, ProjectTaskItem, ProjectTaskStatus, ProjectTaskStage, ProjectTaskSubtask, ProjectActivityItem, ProjectActivityType, SessionChatMessage, WaitingParticipantItem, ScheduledSession } from '@jameet/shared';
import * as projectsApi from './projects/core/projects';
import {
  loadScheduledSessions
} from './sessions/scheduled/scheduledSessions';
import {
  loadRecentSessions
} from './sessions/recent/recentSessions';
import {
  applyAvatarToElement,
  highlightActiveSwatch,
  updateProfileLivePreview,
  switchProfileSubtab,
  showProfileFeedback,
  closeAccountMenu,
  getEditingAvatarColor,
  setEditingAvatarColor,
  getEditingAvatarUrl,
  setEditingAvatarUrl,
  clearProfilePasswordInputs
} from './auth/profile/profileUi';
import {
  switchSettingsSection,
  type SettingsSection
} from './auth/settings/settingsUi';
import {
  switchAuthViewTab,
  showAuthFormError,
  clearAuthFormError
} from './auth/authUi';
import {
  renderWaitingBanner,
  hideWaitingBanner
} from './sessions/call/waitingRoomUi';
import {
  loadProjects
} from './projects/core/projectsListController';
import {
  renderProjectsGrid
} from './projects/core/projectsListUi';
import { renderProjectHeader } from './projects/header/projectHeaderUi';
import {
  initProjectCollaboratorsViewController,
  renderProjectCollaboratorsView
} from './projects/collaborators/projectCollaboratorsViewController';
import {
  createOverviewSessionItem,
  createProjectSessionCard
} from './projects/sessions/projectSessionsUi';
import {
  renderSessionSummaryModal,
  initProjectSessionSummaryUi
} from './projects/sessions/projectSessionSummaryUi';
import {
  renderProjectSessions,
  resetProjectSessionsPage
} from './projects/sessions/projectSessionsListUi';
import {
  renderProjectView
} from './projects/core/projectViewController';
import {
  openProjectView
} from './projects/core/projectOpenController';
import { initDialogUi } from './core/dialogUi';
import {
  canUserEditProject,
  isProjectOwner,
  applyWorkspacePermissions
} from './workspace/core/workspacePermissionsController';
import { initScheduledSessionsController } from './sessions/scheduled/scheduledSessionsController';
import { initRecentSessionsController } from './sessions/recent/recentSessionsController';
import { initWorkspaceDrawerController } from './sessions/call/workspaceDrawerController';
import { initLyricsDomainController } from './workspace/lyrics/lyricsDomainController';
import { initNotesDomainController } from './workspace/notes/notesDomainController';
import { initStructureDomainController } from './workspace/structure/structureDomainController';
import { initProjectsDomainController } from './projects/core/projectsDomainController';
import { initProjectOpenDomainController } from './projects/core/projectOpenDomainController';
import { initProjectCollaboratorsDomainController } from './projects/collaborators/projectCollaboratorsDomainController';
import { initProjectManagementController } from './projects/core/projectManagementController';
import { initSessionStatsController } from './sessions/call/sessionStatsController';
import { initWaitingRoomUiController } from './sessions/call/waitingRoomUiController';
import { initSessionViewStateController } from './sessions/call/sessionViewStateController';
import { initDeepLinkDomainController } from './sessions/join/deepLinkDomainController';
import { initSessionUtilityUiController } from './sessions/call/sessionUtilityUiController';
import { initProjectNavigationDomainController } from './projects/navigation/projectNavigationDomainController';
import { initProjectSongDeleteDomainController } from './songs/delete/projectSongDeleteDomainController';
import { initSongsDomainController } from './songs/songsDomainController';
import { initTasksDomainController } from './workspace/tasks/tasksDomainController';
import { initStructurePersistenceController } from './workspace/structure/structurePersistenceController';
import { initWorkspaceCoreController } from './workspace/core/workspaceCoreController';
import { initWorkspacePersistenceController } from './workspace/core/workspacePersistenceController';
import { initWorkspaceRealtimeDomainController } from './workspace/core/workspaceRealtimeDomainController';
import { updateLocalPreviews as updateLocalPreviewsHelper } from './sessions/call/localPreviewUi';
import { createDownscaledVideoTrack } from './sessions/call/videoTrackScaling';
import { createSessionMetadata, createCurrentStream, performCheckActiveSpeaker } from './sessions/call/sessionMediaStateController';
import { deviceError } from './media/deviceError';
import { initInCallAudioModalController } from './sessions/call/inCallAudioModalController';
import { initCallToolbarController } from './sessions/call/callToolbarController';
import { initSessionUtilityBindingsController } from './sessions/call/sessionUtilityBindingsController';
import { refreshRunningApps as refreshRunningAppsHelper, updateAppIconBadge, getCachedRunningApps } from './media/runningApplicationsController';
import {
  type HardwareAudioDeviceInfo,
  findHardwareDevice,
  formatDeviceDisplayName,
  formatOutputChannelName,
  generateInputChannelOptions,
  generateOutputChannelOptions,
  type ChannelDropdownOption
} from './media/hardwareDeviceUtils';
import { fillSelects, populateChannelDropdowns } from './media/deviceSelectUi';
import { enumerateAndPopulateDevices } from './media/deviceEnumerationController';
import { renderAudioLimitations as renderAudioLimitationsUi } from './media/audioLimitationsUi';
import { prepareStudioDomain } from './sessions/setup/studioPreparationDomainController';
import { getMeterInterval, getEffectiveMusicBitrate } from './media/mediaPreferenceController';
import { bindDeviceSelect } from './media/deviceChangeController';
import { initAuthDomainController } from './auth/authDomainController';
import { createScreenSharingController } from './sessions/call/screenSharingController';
import { createVoiceInputsUiController } from './media/voiceInputsUiController';
import { createLocalAudioCaptureController } from './media/localAudioCaptureController';
import { createMediaStreamControlsController } from './media/mediaStreamControlsController';
import { updateCameraButtonUi } from './sessions/call/cameraUi';
import { testSpeakers as testSpeakersController, testMicrophone as testMicrophoneController, getMicrophonePlayback } from './media/deviceTestController';
import { initMediaSettingsBindings } from './media/mediaSettingsBindingsController';
import {
  getWorkspaceContextGen,
  isWorkspaceContextGenCurrent,
  resetWorkspaceGenerations,
  getLyricsEditGen,
  getLyricsSaveGen,
  incrementLyricsEditGen,
  incrementLyricsSaveGen,
  setLyricsSaveGen,
  getNotesEditGen,
  getNotesSaveGen,
  incrementNotesEditGen,
  incrementNotesSaveGen,
  setNotesSaveGen,
  getStructureEditGen,
  getStructureSaveGen,
  incrementStructureEditGen,
  incrementStructureSaveGen,
  setStructureSaveGen,
  getTasksEditGen,
  getTasksSaveGen,
  incrementTasksEditGen,
  incrementTasksSaveGen,
  setTasksSaveGen
} from './workspace/core/workspaceGenerationState';
import {
  initAuthNavigation,
  openAuthView,
  openSettings,
  openAuthDialog,
  getLastActiveViewBeforeSettings
} from './auth/authNavigationController';
import {
  initParticipantIdentityUi,
  updateParticipantIdentityUi
} from './sessions/call/participantIdentityUi';
import {
  initSessionViewSelectorUi
} from './sessions/call/sessionViewSelectorUi';
import {
  initSessionConnection
} from './sessions/call/sessionConnectionController';
import {
  initWaitingRoomController
} from './sessions/call/waitingRoomController';
import {
  initSessionModeration,
  getIsSessionLocked,
  setIsSessionLocked
} from './sessions/call/sessionModerationController';
import {
  initInviteLinkController
} from './sessions/call/inviteLinkController';
import {
  initCallNavigation
} from './sessions/call/callNavigationController';
import {
  initSessionTimer,
  startSessionTimer,
  stopSessionTimer
} from './sessions/call/sessionTimer';
import {
  setCallStatus
} from './sessions/call/sessionStatusUi';
import {
  initSessionKeyboard
} from './sessions/call/sessionKeyboardController';
import {
  startRendererApp
} from './core/startupController';
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
  debounceSaveNotesRetry,
  hasNotesSaveTimeout,
  clearNotesSaveTimeout
} from './workspace/notes/notesPersistence';
import {
  initAuthStateUiController,
  updateAuthUi
} from './auth/authStateUiController';
import {
  getPendingJoinCode,
  setPendingJoinCode,
  clearPendingJoinCode
} from './auth/guestJoinController';
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
} from './sessions/setup/studioPreparationController';
import {
  initCallModeUi,
  setModeRadios,
  updateMusicWarning,
  updateCallMode
} from './sessions/call/callModeUiController';
import {
  effectiveVideoQuality
} from './sessions/call/sessionMetadataController';
import {
  type SessionErrorModalOptions,
  parseSessionError
} from './sessions/setup/sessionErrorParser';
import {
  showSessionErrorModal
} from './sessions/setup/sessionErrorUi';
import {
  createActiveCallController
} from './sessions/call/activeCallController';
import {
  createCallTerminationController
} from './sessions/call/callTerminationController';
import {
  initProfileUiController
} from './auth/profile/profileUiController';
import {
  initAuthUiController
} from './auth/authUiController';
import {
  initProjectSessionsController
} from './projects/sessions/projectSessionsController';
import {
  closeSongStudio,
  isSongStudioVisible,
  setIsSongStudioVisible,
  getCurrentSongStudioTab,
  type SongStudioTab
} from './songs/studio/songStudioUi';
import {
  switchActiveSong
} from './songs/state/songSwitchController';
import {
  openSongStudio,
  createNewSong,
  duplicateSong,
  deleteSong,
  reorderSongs,
  renameSong,
  toggleArchiveSong,
  updateSongCustomization
} from './songs/songsController';
import {
  initLyricsDocumentsController,
  getActiveLyricsDoc,
  duplicateLyricsDoc,
  deleteLyricsDoc,
  switchActiveLyricsDoc
} from './workspace/lyrics/lyricsDocumentsController';
import {
  getProjectTasks,
  createTask,
  quickToggleTask,
  updateTaskStatus,
  deleteTask,
  duplicateTask,
  updateTaskField,
  reorderTasks,
  moveTaskToGroup,
  addSubtask,
  toggleSubtask,
  deleteSubtask,
  updateSubtaskTitle
} from './workspace/tasks/tasksController';
import {
  debounceSaveTasks,
  saveTasksWorkspace,
  hasTasksSaveTimeout,
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
  isSessionWorkspaceOpen,
  setSessionWorkspaceOpen
} from './sessions/call/workspaceDrawerUi';
import {
  openDeleteSongModal,
  getSongPendingDeletion,
  clearSongPendingDeletion
} from './songs/delete/songDeleteController';
import {
  handleDeepLink
} from './sessions/join/deepLinkController';
import {
  reconcileNotesWorkspace,
  type NotesStateValues,
  type NotesReconciliationResult
} from './workspace/notes/notesReconciliation';
import {
  switchProjectTab,
  resetProjectTabsUi,
  initProjectTabsUi
} from './projects/navigation/projectTabsUi';
import {
  initProjectSongDeleteUi,
  renderDeleteSongModal,
  closeDeleteSongModal
} from './songs/projectSongDeleteUi';
import {
  computeSongDeletion
} from './songs/songDeletion';
import {
  initCallShortcutsUi,
  toggleShortcutsModal,
  closeShortcutsModal,
  isShortcutsModalOpen
} from './sessions/call/callShortcutsUi';
import {
  initGuestJoinUi,
  closeGuestJoinDialog
} from './auth/guestJoinUi';
import { initProjectNavigationUi } from './projects/navigation/projectNavigationUi';
import {
  getLyricsStatus,
  setLyricsStatus,
  renderLyricsDocTabs,
  updateLyricsDocumentPagination,
  updateLyricsStatsFromHtml
} from './workspace/lyrics/lyricsUi';
import {
  renderStructureWorkspace,
  getStructureStatus,
  setStructureStatus,
  focusStructureSection
} from './workspace/structure/structureUi';
import {
  getNotesStatus,
  setNotesStatus,
  syncNotesControls,
  getNotesFieldValues
} from './workspace/notes/notesUi';
import {
  initTasksUi,
  renderTasksWorkspace,
  getTasksStatus,
  setTasksStatus,
  type TaskCollaboratorOption,
  type TaskFieldUpdate
} from './workspace/tasks/tasksUi';
import {
  initSongsUi,
  renderProjectOverviewSongsList,
  renderProjectSongsSelector,
  renderSongStudioHeader,
  showSongContextMenu,
  type ReadonlySongItem
} from './songs/songsUi';
import { ScheduledNotificationManager } from './sessions/scheduled/scheduledNotifications';
import { meetingCodeSchema, normalizeMeetingCode } from '@jameet/shared';
import { audioLimitations } from './media/audioProfiles';
import { LocalAudioSourceManager } from './media/audioSources';
import { LevelMeter, type LevelReading } from './media/levelMeter';
import { SignalingClient } from './media/signaling';
import { AuthManager } from './auth/auth';
import { WebRtcSession } from './media/webrtc';
import { cameraConstraints, performanceVideoQuality } from './media/videoQuality';
import { icons } from './core/icons';
import { presenter } from './media/presenter';
import { escapeHtml, sanitizeLyricsHtml, safeAvatarColor, findSectionCard, findTimelineBlocks, findTimelineBlock } from './core/htmlSecurity';
import { initActivityHistory, renderProjectActivities } from './sessions/call/activity';
import { initSessionChat, resetChatUi, setSessionChatOpen, isSessionChatOpen, setOnChatOpenCallback } from './sessions/call/chat';
import { startRemoteVoiceBridge, stopRemoteVoiceBridge } from './media/remoteVoiceBridge';
import { logger } from './core/logger';
import {
  type ChannelEqConfig,
  channelEqDspRegistry,
  openChannelEqPlugin,
  getChannelEqConfig,
  setChannelEqConfig,
  removeChannelEqConfig
} from './media/channelEq';
import { type StudioMixerChannel } from './media/studioMixerLogic';
import { hydrateStudioMixerEqPersistence } from './media/studioMixerStorage';
import { initStudioMixerPopoversAndControls } from './media/studioMixerUi';
import { createStudioMixerController } from './media/studioMixerController';
import { initPresenterCoordinationController } from './sessions/call/presenterCoordinationController';
import { initMediaHardwareControlsController } from './media/mediaHardwareControlsController';
import { initCallSignalingListenersController } from './sessions/call/callSignalingListenersController';
import {
  getStereoBalanceGains,
  createRemoteAudioGraphController
} from './media/remoteAudioGraphController';
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
  applyParticipantViewLayout,
  updateSessionStage,
  toggleSessionViewMenu,
  closeSessionViewMenu,
  setSessionViewStateProvider,
  getCameraViewMode,
  getActiveSpeaker,
  setActiveSpeaker,
  toggleSessionLayout,
  updateSessionViewButton,
  renderSessionViewMenu
} from './sessions/call/sessionView';
import './style.css';

export { escapeHtml, sanitizeLyricsHtml, safeAvatarColor };

const scheduledNotifications = new ScheduledNotificationManager();
scheduledNotifications.onSessionClick((sessionId) => {
  handleScheduledSessionNotificationClick(sessionId, {
    onNavigateHome: () => showView('home-view')
  });
});

logger.initGlobalErrorHandling();
logger.info('renderer_startup', 'JaMeet renderer application initialized', { participantId });

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
    return saveNotesWorkspace(content, bpm, key);
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
    applyAuthoritativeWorkspaceUpdate(area, workspace);
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
    debounceSaveNotesRetry(content, bpm, key);
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
  getMyIdentity: () => myIdentity,
  getPeerIdentity: () => peerIdentity,
  getCurrentRole: () => currentRole,
  getPeerParticipantId: () => peerParticipantId,
  onUpdateSessionViewButton: () => updateSessionViewButton(),
  onRenderSessionViewMenu: () => renderSessionViewMenu()
});
initSessionViewSelectorUi({
  onToggleSessionViewMenu: (e) => toggleSessionViewMenu(e),
  onCloseSessionViewMenu: () => closeSessionViewMenu()
});
initSessionConnection({
  signaling,
  isInCall: () => inCall,
  onSetCallStatus: (status) => setCallStatus(status)
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
initStructurePersistenceController({
  getProject: () => activeProject,
  getAuthToken: () => auth.getToken(),
  getUser: () => auth.getUser(),
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
  onRenderProjectActivities: (project, user) => {
    renderProjectActivities(project, user);
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
    return signaling.updateProjectWorkspace(projectId, payload, token);
  },
  onApplyAuthoritativeWorkspace: (area, workspace) => {
    applyAuthoritativeWorkspaceUpdate(area, workspace);
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
    void saveNotesWorkspace(content, bpm, key);
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
  }
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
    await saveNotesWorkspace(content, bpm, key);
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
  formatRelativeTime: (t) => projectsApi.formatRelativeTime(t),
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
initSessionUtilityUiController({
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
type PendingAction = { type: 'create' } | { type: 'join'; code: string };

let prefs: Preferences = readPreferences();
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

initSessionViewStateController({
  getScreenTrack: () => screenTrack,
  getRemoteMedia: () => remoteMedia,
  getRemoteVideoStream: () => remoteVideoStream,
  getPeerIdentity: () => peerIdentity,
  getMyIdentity: () => myIdentity,
  getSharingSourceTitle: () => currentSharingSourceTitle
});

initSessionStatsController({
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

initWaitingRoomUiController({
  onAdmitParticipant: async (participantId) => signaling.admitParticipant(currentCode, participantId)
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
  return createSessionMetadata({
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
  return createCurrentStream(screenTrack, cameraEnabled, videoTrack);
}

function checkActiveSpeaker(): void {
  performCheckActiveSpeaker({
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

let cachedHardwareDevices: HardwareAudioDeviceInfo[] = [];

function meterInterval(): number { return getMeterInterval(prefs.performanceMode); }
function effectiveMusicBitrate(): number { return getEffectiveMusicBitrate(prefs); }

const {
  getOrCreateVoiceMeter,
  updateVoiceInIndicator,
  renderVoiceLevel,
  renderMusicLevel,
  renderVoiceInputControls
} = createVoiceInputsUiController({
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
  onUpdateCallMode: () => updateCallMode(),
  isInCall: () => inCall,
  getCurrentCode: () => currentCode,
  getMetadata: () => metadata(),
  onSignalingUpdateMedia: (code, meta) => signaling.updateMedia(code, meta),
  onRtcAudioChanged: (mode) => rtc.audioChanged(mode),
  onRtcAudioSourceChanged: (source) => rtc.audioSourceChanged(source)
});

async function enumerateAndPopulate(): Promise<void> {
  await enumerateAndPopulateDevices({
    getPreferences: () => prefs,
    onSavePreferences: () => savePreferences(),
    getCachedHardwareDevices: () => cachedHardwareDevices,
    onSetCachedHardwareDevices: (devices) => {
      cachedHardwareDevices = devices;
    },
    onRefreshRunningApps: () => refreshRunningApps(),
    onRenderVoiceInputControls: (audioInputs) => renderVoiceInputControls(audioInputs),
    onSetMessage: (id, text) => setMessage(id, text),
    isInCall: () => inCall,
    isAudioOnly: () => audioOnly,
    onSetModeRadios: (mode) => setModeRadios(mode)
  });
}

async function prepareStudio(action: PendingAction): Promise<void> {
  await prepareStudioDomain(action, {
    onSetPendingAction: (act) => {
      pending = act;
    },
    getCurrentCode: () => currentCode,
    onSetCurrentCode: (code) => {
      currentCode = code;
    },
    onShowSetupView: () => showView('setup-view'),
    onSetBusy: (busy) => setBusy(busy),
    getAudioMode: () => prefs.mode,
    getCameraId: () => prefs.cameraId,
    isAudioOnly: () => audioOnly,
    onSetModeRadios: (mode) => setModeRadios(mode),
    onUpdateMusicWarning: () => updateMusicWarning(),
    onUpdateCameraButtonState: () => updateCameraButtonState(),
    onUpdateLocalPreviews: () => updateLocalPreviews(),
    onEnumerateAndPopulate: () => enumerateAndPopulate(),
    onSyncAllVoiceMics: (mode) => syncAllVoiceMics(mode),
    onReplaceCamera: (camId) => replaceCamera(camId),
    onReplaceMusicInput: () => replaceMusicInput()
  });
}

function renderAudioLimitations(): void {
  renderAudioLimitationsUi({
    getPrimaryAudioSource: () => audio.primary,
    getPreferences: () => prefs,
    onSetMessage: (id, text, isError) => setMessage(id, text, isError)
  });
}

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
  getUserName: () => auth.getUser()?.name || auth.getGuestName() || 'You',
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

async function setOutputDevice(deviceId?: string): Promise<void> {
  if (remoteAudioCtx && remoteAudioCtx.state !== 'closed') {
    if (typeof (remoteAudioCtx as any).setSinkId === 'function') {
      await (remoteAudioCtx as any).setSinkId(deviceId ?? '');
    } else if (deviceId) {
      throw new Error('Audio output selection is not supported on this system.');
    }
  }

  const media = [$<HTMLAudioElement>('remote-voice-audio'), $<HTMLAudioElement>('remote-music-audio'), getMicrophonePlayback()].filter(Boolean) as HTMLMediaElement[];
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
  await testSpeakersController(pan, {
    getAudioOutputId: () => prefs.audioOutputId,
    getOutputVolume: () => prefs.outputVolume
  });
}

async function testMicrophone(): Promise<void> {
  await testMicrophoneController({
    getPrimaryTrack: () => audio.primary?.track,
    getAudioOutputId: () => prefs.audioOutputId,
    getOutputVolume: () => prefs.outputVolume,
    onSetMessage: (id, text, isError) => setMessage(id, text, isError)
  });
}

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
  onUpdateCallMode: () => updateCallMode(),
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
  getPendingAction: () => pending,
  hasPrimaryAudio: () => Boolean(audio.primary),
  isAudioOnly: () => audioOnly,
  setBusy: (busy) => setBusy(busy),
  onSignalingCreate: (pId, meta, token, guestName, projId, waitingRoom) =>
    signaling.create(pId, meta, token, guestName, projId, waitingRoom),
  onSignalingJoin: (code, pId, meta, token, guestName) =>
    signaling.join(code, pId, meta, token, guestName),
  onSignalingLeave: () => signaling.leave(),
  onOpenAuthView: (tab) => openAuthView(tab),
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
  onUpdateCallMode: () => updateCallMode(),
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
  onUpdateAppIconBadge: (pid) => updateAppIconBadge(pid),
  onTestSpeakers: () => testSpeakers(),
  onTestMicrophone: () => testMicrophone(),
  onSyncAllVoiceMics: () => syncAllVoiceMics(),
  onEnumerateAndPopulate: () => enumerateAndPopulate(),
  onSavePreferences: () => savePreferences(),
  onUpdateLocalPreviews: () => updateLocalPreviews(),
  onSetMessage: (id, text, isError) => setMessage(id, text, isError),
  onShowSessionError: (error) => showSessionErrorModal(parseSessionError(error))
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
