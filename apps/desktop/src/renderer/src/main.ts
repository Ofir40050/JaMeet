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
import { handleRemoteMediaUi } from './sessions/call/remoteMediaUiController';
import { prepareStudioDomain } from './sessions/setup/studioPreparationDomainController';
import { getMeterInterval, getEffectiveMusicBitrate } from './media/mediaPreferenceController';
import { bindDeviceSelect } from './media/deviceChangeController';
import { initAuthDomainController } from './auth/authDomainController';
import { showScreenPickerUi } from './sessions/call/screenPickerController';
import { updateScreenSharingUi } from './sessions/call/screenSharingUi';
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
  enterSession as enterSessionController
} from './sessions/setup/sessionEntryController';
import {
  type SessionErrorModalOptions,
  parseSessionError
} from './sessions/setup/sessionErrorParser';
import {
  showSessionErrorModal
} from './sessions/setup/sessionErrorUi';
import {
  initializeActiveCall as initializeActiveCallController
} from './sessions/call/activeCallController';
import {
  handleSessionProjectWorkspace
} from './sessions/call/sessionProjectWorkspaceController';
import {
  transitionToActiveCallUi
} from './sessions/call/activeCallUiController';
import {
  updateLockUi as updateLockUiHelper
} from './sessions/call/sessionLockUi';
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
import {
  type StudioMixerChannel,
  type PersistentStudioMixerChannel,
  type PersistentStudioMixerMap,
  getLocalMicChannelId,
  parseLocalMicId,
  serializeStudioMixerConfig,
  computeMixerRouting
} from './media/studioMixerLogic';
import {
  loadSavedStudioMixerConfig,
  hydrateStudioMixerEqPersistence,
  saveStudioMixerConfig as saveStudioMixerConfigStorage
} from './media/studioMixerStorage';
import {
  faderTopPercentToDb,
  dbToFaderTopPercent,
  dbToGain,
  formatDbText,
  formatPeakDbText,
  volumeToDb,
  getPanBackground,
  panToReadout,
  panToLabel,
  getStereoPanGains
} from './media/studioMixerFaderMath';
import {
  startMixerVuAnimation as startMixerVuAnimationHelper,
  stopMixerVuAnimation as stopMixerVuAnimationHelper
} from './media/studioMixerVuMeter';
import {
  renderStudioMixer as renderStudioMixerHelper,
  initStudioMixerPopoversAndControls
} from './media/studioMixerUi';
import { initPresenterCoordinationController } from './sessions/call/presenterCoordinationController';
import { initMediaHardwareControlsController } from './media/mediaHardwareControlsController';
import { initCallSignalingListenersController } from './sessions/call/callSignalingListenersController';
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
  setRemoteStream,
  setRemoteAudio,
  handleRemoteMedia,
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
function meterInterval(): number { return getMeterInterval(prefs.performanceMode); }
function effectiveMusicBitrate(): number { return getEffectiveMusicBitrate(prefs); }

async function refreshRunningApps(): Promise<void> {
  await refreshRunningAppsHelper({
    getPreferences: () => prefs
  });
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

let cachedHardwareDevices: HardwareAudioDeviceInfo[] = [];

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

    const hw = findHardwareDevice(mic.deviceId, audioInputs, cachedHardwareDevices);
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
        if (isPrimary) {
          for (const otherId of ['input-gain', 'call-input-gain']) {
            const el = document.querySelector<HTMLInputElement>(`#${otherId}`);
            if (el) el.value = String(val);
          }
          for (const labelId of ['gain-value', 'call-gain-value']) {
            const el = document.getElementById(labelId);
            if (el) el.textContent = `${Math.round(val * 100)}%`;
          }
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
  updateScreenSharingUi(active, {
    getCurrentSharingSourceTitle: () => currentSharingSourceTitle
  });
}

async function showScreenPicker(): Promise<void> {
  await showScreenPickerUi({
    hasScreenTrack: () => Boolean(screenTrack),
    onStopScreenShare: () => stopScreenShare(),
    onStartScreenShare: (sourceId, preset) => startScreenShare(sourceId, preset),
    onSetCurrentSharingSourceTitle: (title) => {
      currentSharingSourceTitle = title;
    },
    onSetMessage: (id, text, isError) => setMessage(id, text, isError),
    onSetText: (id, text) => setText(id, text),
    onSetCallStatus: (status) => setCallStatus(status)
  });
}

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

async function initializeActiveCall(ack: MeetingAck): Promise<void> {
  await initializeActiveCallController(ack, {
    getVideoTrack: () => videoTrack,
    onSetVideoTrackOnRtc: (track) => rtc.setVideoTrack(track),
    getAudioMode: () => prefs.mode,
    getCameraQuality: () => prefs.cameraQuality,
    getEffectiveVideoQuality: (q) => effectiveVideoQuality(q),
    getEffectiveMusicBitrate: () => effectiveMusicBitrate(),
    onConfigureRtc: (code, role, iceServers, mode, quality, bitrate, peerMedia) => {
      rtc.configure(code, role, iceServers, mode, quality, bitrate, peerMedia);
    },
    onSetCurrentCode: (code) => {
      currentCode = code;
    },
    onSetCurrentRole: (role) => {
      currentRole = role;
    },
    onSetCurrentIceServers: (servers) => {
      currentIceServers = servers;
    },
    onSetMyIdentity: (identity) => {
      myIdentity = identity;
    },
    onSetHostIdentity: (identity) => {
      hostIdentity = identity;
    },
    onSetPeerIdentity: (identity) => {
      peerIdentity = identity;
    },
    onSetPeerParticipantId: (id) => {
      peerParticipantId = id;
    },
    onSetInCall: (inCallState) => {
      inCall = inCallState;
    },
    onUpdateCallMode: () => updateCallMode(),
    onUpdateCameraButtonState: () => updateCameraButtonState(),
    onUpdateLocalPreviews: () => updateLocalPreviews(),
    onUpdateParticipantIdentityUi: () => updateParticipantIdentityUi(),
    onSetRemoteMuted: (muted) => {
      remoteMuted = muted;
    },
    onResetStudioMixerChannels: () => {
      studioMixerChannels.forEach((ch) => {
        ch.muted = false;
        ch.soloed = false;
      });
    },
    isStudioMixerOpen: () => studioMixerOpen,
    onRenderStudioMixer: () => renderStudioMixer(),
    onApplyMixerAudioRouting: () => applyMixerAudioRouting(),
    onHandleSessionProjectWorkspace: (meetingAck) => {
      handleSessionProjectWorkspace(meetingAck, {
        getAuthToken: () => auth.getToken(),
        onSetSessionProjectId: (id) => {
          sessionProjectId = id;
        },
        onResetWorkspaceGenerations: () => resetWorkspaceGenerations(),
        getWorkspaceContextGen: () => getWorkspaceContextGen(),
        onFetchProject: (token, projectId) => projectsApi.fetchProject(token, projectId),
        getActiveProject: () => activeProject,
        onSetActiveProject: (p) => {
          activeProject = p;
        },
        onSetActiveProjectId: (id) => {
          activeProjectId = id;
        },
        onSyncWorkspaceInputsFromProject: (force) => syncWorkspaceInputsFromProject(force),
        onJoinProjectWorkspace: (projectId, token) => signaling.joinProjectWorkspace(projectId, token)
      });
    },
    onTransitionToActiveCallUi: async (meetingAck) => {
      await transitionToActiveCallUi(meetingAck, {
        onResetChatUi: () => resetChatUi(),
        onSetIsSessionLocked: (locked) => setIsSessionLocked(locked),
        onUpdateLockUi: () => updateLockUi(),
        onShowCallView: () => showView('call-view'),
        onStartSessionTimer: () => startSessionTimer(),
        getPendingPeerMedia: () => pendingPeerMedia,
        onClearPendingPeerMedia: () => {
          pendingPeerMedia = undefined;
        },
        onPeerReady: (media) => rtc.peerReady(media)
      });
    }
  });
}

function updateLockUi(): void {
  updateLockUiHelper({
    getRole: () => currentRole,
    getIsLocked: () => getIsSessionLocked()
  });
}

async function enterSession(): Promise<void> {
  await enterSessionController({
    getPendingAction: () => pending,
    hasPrimaryAudio: () => Boolean(audio.primary),
    isAudioOnly: () => audioOnly,
    hasVideoTrack: () => Boolean(videoTrack),
    setBusy: (busy) => setBusy(busy),
    getAuthToken: () => auth.getToken(),
    getGuestName: () => auth.getGuestName(),
    getParticipantId: () => participantId,
    getMetadata: () => metadata(),
    getActiveProjectId: () => activeProjectId,
    onSignalingCreate: (pId, meta, token, guestName, projId, waitingRoom) =>
      signaling.create(pId, meta, token, guestName, projId, waitingRoom),
    onSignalingJoin: (code, pId, meta, token, guestName) =>
      signaling.join(code, pId, meta, token, guestName),
    onSignalingLeave: () => signaling.leave(),
    onOpenAuthView: (tab) => openAuthView(tab),
    onSetCurrentCode: (code) => {
      currentCode = code;
    },
    onSetLoggerSessionContext: (code) => logger.setSessionContext(code),
    onSetHostIdentity: (identity) => {
      hostIdentity = identity;
    },
    onSetMyIdentity: (identity) => {
      myIdentity = identity;
    },
    onShowWaitingView: () => showView('waiting-view'),
    onInitializeActiveCall: (ack) => initializeActiveCall(ack)
  });
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
    // Remote Voice:
    // Mono: Constant Power Mono-to-Stereo Panner + Meter Splitter
    remoteVoicePanner = remoteAudioCtx.createStereoPanner();
    remoteVoiceMeterSplitter = remoteAudioCtx.createChannelSplitter(2);

    // Stereo: True Stereo Balance (discrete L/R attenuation without crossfeed)
    remoteVoiceSplitter = remoteAudioCtx.createChannelSplitter(2);
    remoteVoiceLeftGain = remoteAudioCtx.createGain();
    remoteVoiceRightGain = remoteAudioCtx.createGain();
    remoteVoiceMerger = remoteAudioCtx.createChannelMerger(2);

    // Remote Music: True Stereo Balance (discrete L/R attenuation without crossfeed)
    remoteMusicSplitter = remoteAudioCtx.createChannelSplitter(2);
    remoteMusicLeftGain = remoteAudioCtx.createGain();
    remoteMusicRightGain = remoteAudioCtx.createGain();
    remoteMusicMerger = remoteAudioCtx.createChannelMerger(2);

    remoteMusicSplitter.connect(remoteMusicLeftGain, 0, 0);
    remoteMusicSplitter.connect(remoteMusicRightGain, 1, 0);
    remoteMusicLeftGain.connect(remoteMusicMerger, 0, 0);
    remoteMusicRightGain.connect(remoteMusicMerger, 0, 1);

    // Live Analysers for Real Level Metering (Stereo Measurement Taps)
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

    // Audio Graph Static Routing for Music:
    remoteMusicGain.connect(remoteMusicSplitter);
    remoteMusicMerger.connect(remoteMasterGain);
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
    if (existing.track !== track) {
      try { existing.track.stop(); } catch {}
      const existingSource = remoteMusicSourceNodes.get(id);
      if (existingSource && existingSource.track === existing.track) {
        try { existingSource.sourceNode.disconnect(); } catch {}
        remoteMusicSourceNodes.delete(id);
      }
    }
  }
  remoteAudioTracks.set(id, { purpose, track });
  track.onended = () => {
    const current = remoteAudioTracks.get(id);
    if (current && current.track === track) {
      remoteAudioTracks.delete(id);
      const existingSource = remoteMusicSourceNodes.get(id);
      if (existingSource && existingSource.track === track) {
        try { existingSource.sourceNode.disconnect(); } catch {}
        remoteMusicSourceNodes.delete(id);
      }
      if (!inCall) return;
      void refreshRemoteAudio();
    }
  };
  if (inCall) {
    void refreshRemoteAudio();
  }
}

let remoteAudioRefreshSeq = 0;

async function refreshRemoteAudio(): Promise<void> {
  const seq = ++remoteAudioRefreshSeq;

  if (!inCall) {
    stopRemoteVoiceBridge();
    try { remoteVoiceSourceNode?.disconnect(); } catch {}
    remoteVoiceSourceNode = undefined;
    if (remoteVoiceMeter) {
      void remoteVoiceMeter.stop();
      remoteVoiceMeter = undefined;
    }
    for (const [, entry] of remoteMusicSourceNodes) {
      try { entry.sourceNode.disconnect(); } catch {}
    }
    remoteMusicSourceNodes.clear();
    return;
  }

  const initialHasTracks = [...remoteAudioTracks.values()].some((item) => item.track.readyState !== 'ended');
  if (!initialHasTracks) {
    stopRemoteVoiceBridge();
    try { remoteVoiceSourceNode?.disconnect(); } catch {}
    remoteVoiceSourceNode = undefined;
    if (remoteVoiceMeter) {
      void remoteVoiceMeter.stop();
      remoteVoiceMeter = undefined;
    }
    lastRemoteVoiceDb = -60;
    checkActiveSpeaker();

    for (const [, entry] of remoteMusicSourceNodes) {
      try { entry.sourceNode.disconnect(); } catch {}
    }
    remoteMusicSourceNodes.clear();

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

  const ctx = await getOrCreateRemoteAudioContext();

  // If a newer refresh was triggered while awaiting the AudioContext, yield to the latest call
  if (seq !== remoteAudioRefreshSeq || !inCall) return;

  // Always query latest tracks state AFTER the async AudioContext operation completes
  const latestVoiceTracks = [...remoteAudioTracks.values()]
    .filter((item) => item.purpose === 'voice' && item.track.readyState !== 'ended')
    .map((item) => item.track);
  const latestMusicEntries = [...remoteAudioTracks.entries()]
    .filter(([, item]) => item.purpose === 'music' && item.track.readyState !== 'ended');

  // Reconcile Remote Voice
  if (latestVoiceTracks.length > 0) {
    const voiceTrack = latestVoiceTracks[0];
    remoteVoiceIsStereo = rtc.isVoiceStereo();

    if (!remoteVoiceSourceNode || remoteVoiceSourceNode.mediaStream.getAudioTracks()[0] !== voiceTrack) {
      try { remoteVoiceSourceNode?.disconnect(); } catch {}
      const voiceStream = new MediaStream([voiceTrack]);
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
    }
  } else {
    remoteVoiceIsStereo = false;
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

  // Reconcile Remote Music & Screen Audio sources
  if (latestMusicEntries.length > 0) {
    // Clean up any existing sources that are no longer active, ended, or replaced
    for (const [id, entry] of remoteMusicSourceNodes) {
      const stillActive = latestMusicEntries.some(([trackId, item]) => trackId === id && item.track === entry.track && item.track.readyState !== 'ended');
      if (!stillActive) {
        try { entry.sourceNode.disconnect(); } catch {}
        remoteMusicSourceNodes.delete(id);
      }
    }

    // Create or connect source nodes for all active remote music tracks
    for (const [id, item] of latestMusicEntries) {
      if (item.track.readyState === 'ended') continue;
      const existing = remoteMusicSourceNodes.get(id);
      if (!existing || existing.track !== item.track) {
        if (existing) {
          try { existing.sourceNode.disconnect(); } catch {}
          remoteMusicSourceNodes.delete(id);
        }
        const stream = new MediaStream([item.track]);
        const sourceNode = ctx.createMediaStreamSource(stream);
        if (remoteMusicGain) {
          sourceNode.connect(remoteMusicGain);
        }
        remoteMusicSourceNodes.set(id, { track: item.track, sourceNode });
      }
    }
  } else {
    for (const [, entry] of remoteMusicSourceNodes) {
      try { entry.sourceNode.disconnect(); } catch {}
    }
    remoteMusicSourceNodes.clear();
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
  handleRemoteMediaUi(media, {
    onSetRemoteMedia: (m) => {
      remoteMedia = m;
    },
    getRemoteVideoStream: () => remoteVideoStream,
    onUpdateSessionStage: () => updateSessionStage(),
    isInCall: () => inCall,
    onApplyMixerAudioRouting: () => applyMixerAudioRouting(),
    onSetText: (id, text) => setText(id, text)
  });
}

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

  for (const [, entry] of remoteMusicSourceNodes) {
    try { entry.sourceNode.disconnect(); } catch {}
  }
  remoteMusicSourceNodes.clear();

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
  remoteVoiceIsStereo = false;
  try { remoteVoicePanner?.disconnect(); } catch {}
  remoteVoicePanner = undefined;
  try { remoteVoiceMeterSplitter?.disconnect(); } catch {}
  remoteVoiceMeterSplitter = undefined;
  try { remoteVoiceSplitter?.disconnect(); } catch {}
  remoteVoiceSplitter = undefined;
  try { remoteVoiceLeftGain?.disconnect(); } catch {}
  remoteVoiceLeftGain = undefined;
  try { remoteVoiceRightGain?.disconnect(); } catch {}
  remoteVoiceRightGain = undefined;
  try { remoteVoiceMerger?.disconnect(); } catch {}
  remoteVoiceMerger = undefined;
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

  // Reset Remote Mute state
  remoteMuted = false;
  setText('remote-mute-button', 'Mute Remote');

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
  hideWaitingBanner();
  setSessionWorkspaceOpen(false);
  resetChatUi();
  setIsSessionLocked(false);
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
  bindDeviceSelect(id, handler, {
    getPreferences: () => prefs,
    isInCall: () => inCall,
    onEnumerateAndPopulate: () => enumerateAndPopulate(),
    onSetMessage: (statusId, text, isError) => setMessage(statusId, text, isError)
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
  updateCameraButtonUi(cameraEnabled);
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
function saveStudioMixerConfig(immediate = true): void {
  saveStudioMixerConfigStorage(studioMixerChannels, immediate);
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
    const volume = mic.gain ?? 1.0;
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

hydrateStudioMixerEqPersistence();
syncMixerChannelsWithVoiceInputs();

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

function startMixerVuAnimation(): void {
  startMixerVuAnimationHelper({
    isMixerOpen: () => studioMixerOpen,
    getChannels: () => studioMixerChannels,
    getVoiceInputs: () => prefs.voiceInputs,
    getVoiceMicAnalysers: (id) => audio.getVoiceMicAnalysers(id),
    getMusicAnalysers: () => audio.getMusicAnalysers(),
    getRemoteVoiceAnalysers: () => ({ left: remoteVoiceAnalyserL, right: remoteVoiceAnalyserR }),
    getRemoteMusicAnalysers: () => ({ left: remoteMusicAnalyserL, right: remoteMusicAnalyserR }),
    getRemoteMasterAnalysers: () => ({ left: remoteMasterAnalyserL, right: remoteMasterAnalyserR }),
    isRemoteMuted: () => remoteMuted
  });
}

function stopMixerVuAnimation(): void {
  stopMixerVuAnimationHelper();
}

function applyMixerAudioRouting(): void {
  const routing = computeMixerRouting({
    channels: studioMixerChannels,
    voiceInputs: prefs.voiceInputs,
    outputVolume: prefs.outputVolume,
    globalMuted: muted,
    remoteMuted
  });
  const masterVol = routing.masterVol;

  routing.localMics.forEach((micResult, micId) => {
    const micCh = studioMixerChannels.find((c) => c.id === micResult.channelId || (micId === 1 && c.id === 'you-mic'));
    if (micCh) {
      micCh.volume = micResult.gainVal;
    }

    for (const prefix of ['', 'call-']) {
      const slider = document.querySelector<HTMLInputElement>(`#${prefix}gain-${micId}`);
      const valLabel = document.querySelector<HTMLElement>(`#${prefix}gain-val-${micId}`);
      if (slider) slider.value = String(micResult.gainVal);
      if (valLabel) valLabel.textContent = `${Math.round(micResult.gainVal * 100)}%`;
    }
    if (micId === 1) {
      for (const otherId of ['input-gain', 'call-input-gain']) {
        const el = document.querySelector<HTMLInputElement>(`#${otherId}`);
        if (el) el.value = String(micResult.gainVal);
      }
      for (const labelId of ['gain-value', 'call-gain-value']) {
        const el = document.getElementById(labelId);
        if (el) el.textContent = `${Math.round(micResult.gainVal * 100)}%`;
      }
    }

    // Apply to audio engine
    audio.setVoiceMicFx(micId, micResult.fx);
    void audio.setVoiceMicGain(micId, micResult.effectiveVol);
    void audio.setVoiceMicPan(micId, micResult.pan);
  });

  audio.setEnabled('voice', routing.voiceSenderEnabled);

  const localMusicCh = studioMixerChannels.find((c) => c.id === 'music-stream');
  const remoteVoiceCh = studioMixerChannels.find((c) => c.id === 'remote-voice');
  const remoteMusicCh = studioMixerChannels.find((c) => c.id === 'remote-music');

  const effectiveLocalMusicVol = routing.effectiveLocalMusicVol;
  const localMusicPan = routing.localMusicPan;
  const effectiveRemoteVoiceVol = routing.effectiveRemoteVoiceVol;
  const effectiveRemoteMusicVol = routing.effectiveRemoteMusicVol;

  audio.setMusicFx(routing.localMusicFx);
  audio.setEnabled('music', effectiveLocalMusicVol > 0);
  void audio.applyMusicGain(effectiveLocalMusicVol);
  void audio.applyMusicPan(localMusicPan);

  // 2. Control Web Audio DSP Engine in real-time
  if (remoteAudioCtx && remoteAudioCtx.state !== 'closed') {
    const now = remoteAudioCtx.currentTime;
    if (inCall) {
      remoteVoiceIsStereo = rtc.isVoiceStereo();
    }

    // Real Gain Routing (0 to 1.5x)
    if (remoteVoiceGain) remoteVoiceGain.gain.setValueAtTime(effectiveRemoteVoiceVol, now);
    if (remoteMusicGain) remoteMusicGain.gain.setValueAtTime(effectiveRemoteMusicVol, now);
    if (remoteMasterGain) remoteMasterGain.gain.setValueAtTime(masterVol, now);

    // Real Stereo Panning (Mono Voice) & Stereo Balance (Stereo Voice & Stereo Music)
    const voicePan = typeof remoteVoiceCh?.pan === 'number' && !isNaN(remoteVoiceCh.pan) ? remoteVoiceCh.pan : 0;
    if (remoteVoiceIsStereo) {
      if (remoteVoiceLeftGain && remoteVoiceRightGain) {
        const { left, right } = getStereoBalanceGains(voicePan);
        remoteVoiceLeftGain.gain.setValueAtTime(left, now);
        remoteVoiceRightGain.gain.setValueAtTime(right, now);
      }
    } else {
      if (remoteVoicePanner) {
        remoteVoicePanner.pan.setValueAtTime(voicePan, now);
      }
    }

    if (remoteMusicLeftGain && remoteMusicRightGain && remoteMusicCh) {
      const musicPan = typeof remoteMusicCh.pan === 'number' && !isNaN(remoteMusicCh.pan) ? remoteMusicCh.pan : 0;
      const { left, right } = getStereoBalanceGains(musicPan);
      remoteMusicLeftGain.gain.setValueAtTime(left, now);
      remoteMusicRightGain.gain.setValueAtTime(right, now);
    }

    // Dynamic Channel FX Routing: Remote Voice (rebuild topology when fx array or mono/stereo mode changes)
    if (remoteVoiceGain && (remoteVoicePanner || (remoteVoiceSplitter && remoteVoiceMerger))) {
      const voiceSlots = Array.isArray(remoteVoiceCh?.fx) ? remoteVoiceCh.fx.slice(0, 4) : [];
      const voiceFxKey = `${remoteVoiceIsStereo ? 'stereo' : 'mono'}|${voiceSlots.map((f, i) => `${i}:${f || ''}`).join('|')}`;
      if (voiceFxKey !== lastConnectedVoiceFx) {
        try { remoteVoiceGain.disconnect(); } catch {}
        for (const node of remoteVoiceFxNodes) {
          try { node.disconnect(); } catch {}
        }
        remoteVoiceFxNodes = [];

        try { remoteVoicePanner?.disconnect(); } catch {}
        try { remoteVoiceMeterSplitter?.disconnect(); } catch {}
        try { remoteVoiceMerger?.disconnect(); } catch {}
        try { remoteVoiceSplitter?.disconnect(); } catch {}
        try { remoteVoiceLeftGain?.disconnect(); } catch {}
        try { remoteVoiceRightGain?.disconnect(); } catch {}

        let currentVoiceSource: AudioNode = remoteVoiceGain;
        for (let i = 0; i < 4; i++) {
          const fxName = voiceSlots[i];
          if (fxName === 'Chan EQ') {
            const eqDsp = channelEqDspRegistry.getOrCreate('remote-voice', i, remoteAudioCtx);
            currentVoiceSource.connect(eqDsp.inputNode);
            currentVoiceSource = eqDsp.outputNode;
            remoteVoiceFxNodes.push(eqDsp.outputNode);
          } else if (fxName === 'Compressor') {
            channelEqDspRegistry.remove('remote-voice', i);
            const compressorNode = remoteAudioCtx.createDynamicsCompressor();
            compressorNode.threshold.setValueAtTime(-18.0, now);
            compressorNode.knee.setValueAtTime(6.0, now);
            compressorNode.ratio.setValueAtTime(4.0, now);
            compressorNode.attack.setValueAtTime(0.005, now);
            compressorNode.release.setValueAtTime(0.08, now);

            currentVoiceSource.connect(compressorNode);
            currentVoiceSource = compressorNode;
            remoteVoiceFxNodes.push(compressorNode);
          } else {
            channelEqDspRegistry.remove('remote-voice', i);
          }
        }

        if (remoteVoiceIsStereo && remoteVoiceSplitter && remoteVoiceLeftGain && remoteVoiceRightGain && remoteVoiceMerger && remoteVoiceAnalyserL && remoteVoiceAnalyserR && remoteMasterGain) {
          currentVoiceSource.connect(remoteVoiceSplitter);
          remoteVoiceSplitter.connect(remoteVoiceLeftGain, 0, 0);
          remoteVoiceSplitter.connect(remoteVoiceRightGain, 1, 0);
          remoteVoiceLeftGain.connect(remoteVoiceMerger, 0, 0);
          remoteVoiceRightGain.connect(remoteVoiceMerger, 0, 1);
          remoteVoiceMerger.connect(remoteMasterGain);
          remoteVoiceLeftGain.connect(remoteVoiceAnalyserL);
          remoteVoiceRightGain.connect(remoteVoiceAnalyserR);
        } else if (remoteVoicePanner && remoteVoiceMeterSplitter && remoteVoiceAnalyserL && remoteVoiceAnalyserR && remoteMasterGain) {
          currentVoiceSource.connect(remoteVoicePanner);
          remoteVoicePanner.connect(remoteMasterGain);
          remoteVoicePanner.connect(remoteVoiceMeterSplitter);
          remoteVoiceMeterSplitter.connect(remoteVoiceAnalyserL, 0);
          remoteVoiceMeterSplitter.connect(remoteVoiceAnalyserR, 1);
        }

        lastConnectedVoiceFx = voiceFxKey;
      }
    }

    // Dynamic Channel FX Routing: Remote Music (rebuild topology only when fx array changes)
    if (remoteMusicGain && remoteMusicSplitter) {
      const musicSlots = Array.isArray(remoteMusicCh?.fx) ? remoteMusicCh.fx.slice(0, 4) : [];
      const musicFxKey = musicSlots.map((f, i) => `${i}:${f || ''}`).join('|');
      if (musicFxKey !== lastConnectedMusicFx) {
        try { remoteMusicGain.disconnect(); } catch {}
        for (const node of remoteMusicFxNodes) {
          try { node.disconnect(); } catch {}
        }
        remoteMusicFxNodes = [];

        let currentMusicSource: AudioNode = remoteMusicGain;
        for (let i = 0; i < 4; i++) {
          const fxName = musicSlots[i];
          if (fxName === 'Chan EQ') {
            const eqDsp = channelEqDspRegistry.getOrCreate('remote-music', i, remoteAudioCtx);
            currentMusicSource.connect(eqDsp.inputNode);
            currentMusicSource = eqDsp.outputNode;
            remoteMusicFxNodes.push(eqDsp.outputNode);
          } else if (fxName === 'Compressor') {
            channelEqDspRegistry.remove('remote-music', i);
            const compressorNode = remoteAudioCtx.createDynamicsCompressor();
            compressorNode.threshold.setValueAtTime(-12.0, now);
            compressorNode.knee.setValueAtTime(6.0, now);
            compressorNode.ratio.setValueAtTime(3.0, now);
            compressorNode.attack.setValueAtTime(0.01, now);
            compressorNode.release.setValueAtTime(0.1, now);

            currentMusicSource.connect(compressorNode);
            currentMusicSource = compressorNode;
            remoteMusicFxNodes.push(compressorNode);
          } else {
            channelEqDspRegistry.remove('remote-music', i);
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
  renderStudioMixerHelper({
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
}

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
