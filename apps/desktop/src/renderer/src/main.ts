import type { AudioMode, MediaMetadata, MeetingAck, PerformanceMode, VideoQuality, ParticipantIdentity, UserProfile, UpdateProfileRequest, Project, ProjectSessionItem, SessionHistoryItem, ProjectTaskItem, ProjectTaskStatus, ProjectTaskStage, ProjectTaskSubtask, ProjectActivityItem, ProjectActivityType, SessionChatMessage, WaitingParticipantItem, ScheduledSession } from '@jameet/shared';
import * as projectsApi from './projects/core/projects';
import {
  initScheduledSessions,
  loadScheduledSessions
} from './sessions/scheduled/scheduledSessions';
import {
  initRecentSessions,
  loadRecentSessions
} from './sessions/recent/recentSessions';
import { initSessionStats } from './sessions/call/sessionStats';
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
  initSettingsUi,
  switchSettingsSection,
  type SettingsSection
} from './auth/settings/settingsUi';
import {
  switchAuthViewTab,
  showAuthFormError,
  clearAuthFormError
} from './auth/authUi';
import {
  initWaitingRoomUi,
  renderWaitingBanner,
  hideWaitingBanner
} from './sessions/call/waitingRoomUi';
import {
  initProjectsListController,
  loadProjects
} from './projects/core/projectsListController';
import {
  initProjectsListUi,
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
  initProjectCollaboratorsController,
  handleAddCollaborator,
  handleUpdateCollaboratorRole,
  handleRemoveCollaborator
} from './projects/collaborators/projectCollaboratorsController';
import {
  initProjectViewController,
  renderProjectView
} from './projects/core/projectViewController';
import {
  initProjectOpenController,
  openProjectView
} from './projects/core/projectOpenController';
import { initDialogUi } from './core/dialogUi';
import {
  initWorkspacePermissionsController,
  canUserEditProject,
  isProjectOwner,
  applyWorkspacePermissions
} from './workspace/core/workspacePermissionsController';
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
  initProfileController,
  handleSaveProfile
} from './auth/profile/profileController';
import {
  initAuthController,
  handleLogin,
  handleRegister,
  handleLogout
} from './auth/authController';
import {
  handleScheduledSessionNotificationClick
} from './sessions/scheduled/scheduledNotificationUi';
import {
  initLyricsController,
  handleLyricsInput,
  handleLyricsDocTitleChange,
  hasLyricsSaveTimeout,
  clearLyricsSaveTimeout
} from './workspace/lyrics/lyricsController';
import {
  initNotesController,
  handleNotesChange
} from './workspace/notes/notesController';
import {
  initStructureController,
  getStructureSections,
  reorderStructureSectionToPosition,
  addStructureSection,
  moveStructureSection,
  duplicateStructureSection,
  deleteStructureSection,
  handleStructureSectionChange
} from './workspace/structure/structureController';
import {
  initStructurePersistence,
  debounceSaveStructure,
  saveStructureWorkspace,
  hasStructureSaveTimeout,
  clearStructureSaveTimeout
} from './workspace/structure/structurePersistence';
import {
  getActiveSongState
} from './songs/state/songState';
import {
  initSongsPersistence,
  saveSongsWorkspace
} from './songs/state/songsPersistence';
import {
  initLyricsPersistence,
  saveLyricsWorkspace
} from './workspace/lyrics/lyricsPersistence';
import {
  initNotesPersistence,
  saveNotesWorkspace,
  debounceSaveNotesRetry,
  hasNotesSaveTimeout,
  clearNotesSaveTimeout
} from './workspace/notes/notesPersistence';
import {
  initWorkspaceRealtimeSync
} from './workspace/core/workspaceRealtimeSyncController';
import {
  initProjectActivitySync
} from './projects/core/projectActivitySyncController';
import {
  initAuthStateUiController,
  updateAuthUi
} from './auth/authStateUiController';
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
  initProjectNavigationController
} from './projects/navigation/projectNavigationController';
import {
  initProjectSongDeleteController
} from './songs/delete/projectSongDeleteController';
import {
  initGuestJoinController,
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
  prepareStudio as prepareStudioController,
  type PendingAction
} from './sessions/setup/studioPreparationController';
import {
  initCallModeUi,
  setModeRadios,
  updateMusicWarning,
  updateCallMode
} from './sessions/call/callModeUiController';
import {
  checkActiveSpeaker as checkActiveSpeakerImpl
} from './sessions/call/activeSpeakerController';
import {
  buildSessionMetadata,
  effectiveVideoQuality,
  buildCurrentStream
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
  initSongStudioUi,
  closeSongStudio,
  isSongStudioVisible,
  setIsSongStudioVisible,
  getCurrentSongStudioTab,
  type SongStudioTab
} from './songs/studio/songStudioUi';
import {
  initSongSwitchController,
  switchActiveSong
} from './songs/state/songSwitchController';
import {
  initSongsController,
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
  initTasksController,
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
  initTasksUiController
} from './workspace/tasks/tasksUiController';
import {
  initTasksPersistence,
  debounceSaveTasks,
  saveTasksWorkspace,
  hasTasksSaveTimeout,
  clearTasksSaveTimeout
} from './workspace/tasks/tasksPersistence';
import {
  initWorkspaceSyncController,
  syncWorkspaceInputsFromProject
} from './workspace/core/workspaceSyncController';
import {
  initAuthoritativeWorkspaceController,
  applyAuthoritativeWorkspaceUpdate
} from './workspace/core/authoritativeWorkspaceController';
import {
  initWorkspaceFlushController,
  flushAllWorkspacePendingSaves
} from './workspace/core/workspaceFlushController';
import {
  initWorkspaceDrawerUi,
  isSessionWorkspaceOpen,
  setSessionWorkspaceOpen
} from './sessions/call/workspaceDrawerUi';
import {
  initSongDeleteController,
  openDeleteSongModal,
  getSongPendingDeletion,
  clearSongPendingDeletion
} from './songs/delete/songDeleteController';
import {
  initDeepLinkController,
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
  initProjectMenuUi
} from './projects/navigation/projectMenuUi';
import {
  initProjectRenameController,
  handleTriggerRename,
  handleSaveRename
} from './projects/rename/projectRenameController';
import {
  initProjectRenameUi
} from './projects/rename/projectRenameUi';
import {
  initProjectCollaboratorModalUi,
  closeAddCollaboratorModal,
  setAddCollaboratorError
} from './projects/collaborators/projectCollaboratorModalUi';
import {
  initProjectDeleteController,
  handleTriggerDelete,
  handleConfirmDelete
} from './projects/delete/projectDeleteController';
import {
  initProjectDeleteUi
} from './projects/delete/projectDeleteUi';
import {
  initProjectSongDeleteUi,
  renderDeleteSongModal,
  closeDeleteSongModal
} from './songs/projectSongDeleteUi';
import {
  computeSongDeletion
} from './songs/songDeletion';
import {
  initProjectArchiveController,
  handleArchiveProject
} from './projects/archive/projectArchiveController';
import {
  initProjectCreateController,
  handleCreateProject
} from './projects/create/projectCreateController';
import {
  initProjectCreateUi
} from './projects/create/projectCreateUi';
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
  initLyricsUi,
  getLyricsStatus,
  setLyricsStatus,
  renderLyricsDocTabs,
  updateLyricsDocumentPagination,
  updateLyricsStatsFromHtml
} from './workspace/lyrics/lyricsUi';
import {
  initStructureUi,
  renderStructureWorkspace,
  getStructureStatus,
  setStructureStatus,
  focusStructureSection
} from './workspace/structure/structureUi';
import {
  initNotesUi,
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
  toggleSessionLayout
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
initWorkspacePermissionsController({
  getProject: () => activeProject,
  getUser: () => auth.getUser()
});
initProjectCollaboratorsViewController({
  getProject: () => activeProject,
  getUser: () => auth.getUser()
});
initAuthoritativeWorkspaceController({
  getProject: () => activeProject,
  getActiveSong: () => getActiveSong(),
  onRenderProjectSongsSelector: () => {
    renderProjectSongsSelector();
  }
});
initSongsPersistence({
  getProject: () => activeProject,
  getAuthToken: () => auth.getToken(),
  isSignalingConnected: () => signaling.isConnected(),
  onSignalingUpdateProjectWorkspace: async (projectId, payload, token) => {
    return signaling.updateProjectWorkspace(projectId, payload, token);
  }
});
initLyricsPersistence({
  getProject: () => activeProject,
  getAuthToken: () => auth.getToken(),
  getUser: () => auth.getUser(),
  canEdit: () => canUserEditProject(),
  getActiveSong: () => getActiveSong(),
  getActiveLyricsDoc: () => getActiveLyricsDoc(),
  getWorkspaceContextGen: () => getWorkspaceContextGen(),
  getLyricsEditGen: () => getLyricsEditGen(),
  getLyricsSaveGen: () => getLyricsSaveGen(),
  incrementLyricsSaveGen: () => incrementLyricsSaveGen(),
  setLyricsStatus: (status) => {
    setLyricsStatus(status);
  },
  onSignalingUpdate: async (projectId, payload, token) => {
    return signaling.updateProjectWorkspace(projectId, payload, token);
  },
  onApplyAuthoritativeWorkspace: (area, workspace) => {
    applyAuthoritativeWorkspaceUpdate(area, workspace);
  },
  onRenderProjectActivities: (project, user) => {
    renderProjectActivities(project, user);
  }
});
initNotesPersistence({
  getProject: () => activeProject,
  getAuthToken: () => auth.getToken(),
  getUser: () => auth.getUser(),
  canEdit: () => canUserEditProject(),
  getActiveSong: () => getActiveSong(),
  getWorkspaceContextGen: () => getWorkspaceContextGen(),
  getNotesEditGen: () => getNotesEditGen(),
  getNotesSaveGen: () => getNotesSaveGen(),
  incrementNotesSaveGen: () => incrementNotesSaveGen(),
  setNotesStatus: (status) => {
    setNotesStatus(status);
  },
  onSyncNotesControls: (values, force) => {
    syncNotesControls(values, force);
  },
  onSignalingUpdate: async (projectId, payload, token) => {
    return signaling.updateProjectWorkspace(projectId, payload, token);
  },
  onApplyAuthoritativeWorkspace: (area, workspace) => {
    applyAuthoritativeWorkspaceUpdate(area, workspace);
  },
  onRenderProjectActivities: (project, user) => {
    renderProjectActivities(project, user);
  }
});
initWorkspaceRealtimeSync({
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
initProjectActivitySync({
  signaling,
  getActiveProject: () => activeProject,
  getUser: () => auth.getUser(),
  onRenderProjectActivities: (project, user) => {
    renderProjectActivities(project, user);
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
initStructureController({
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
initTasksController({
  getProject: () => activeProject,
  canEdit: () => canUserEditProject(),
  onRenderTasksWorkspace: () => {
    renderTasksWorkspace();
  },
  onDebounceSaveTasks: () => {
    debounceSaveTasks();
  },
  onFlushSaveTasks: () => {
    clearTasksSaveTimeout();
    void saveTasksWorkspace();
  }
});
initTasksPersistence({
  getProject: () => activeProject,
  getAuthToken: () => auth.getToken(),
  canEdit: () => canUserEditProject(),
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
  }
});
initTasksUiController({
  getProject: () => activeProject,
  canEdit: () => canUserEditProject(),
  onUpdateSongCustomization: (songId, changes) => {
    updateSongCustomization(songId, changes);
  }
});
initSongDeleteController({
  canEdit: () => canUserEditProject(),
  hasActiveProject: () => Boolean(activeProject)
});
initSongStudioUi({
  getProjectName: () => activeProject?.name,
  onRenderHeader: () => {
    renderSongStudioHeader();
  },
  onApplyPermissions: () => {
    applyWorkspacePermissions();
  },
  onSwitchTabToOverview: () => {
    switchProjectTab('overview');
  },
  onRenderOverviewSongsList: () => {
    renderProjectOverviewSongsList();
  }
});
initSongSwitchController({
  getProject: () => activeProject,
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
  onSaveStructureWorkspace: (sections) => {
    void saveStructureWorkspace();
  },
  onSyncWorkspaceInputs: (forceAll) => {
    syncWorkspaceInputsFromProject(forceAll);
  },
  onSaveSongsWorkspace: () => {
    return saveSongsWorkspace();
  }
});
initSongsController({
  getProject: () => activeProject,
  canEdit: () => canUserEditProject(),
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
initWorkspaceSyncController({
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
  getNotesStatus: () => getNotesStatus(),
  setNotesStatus: (status) => {
    setNotesStatus(status);
  },
  hasNotesSaveTimeout: () => hasNotesSaveTimeout(),
  getStructureStatus: () => getStructureStatus(),
  setStructureStatus: (status) => {
    setStructureStatus(status);
  },
  hasStructureSaveTimeout: () => hasStructureSaveTimeout(),
  getTasksStatus: () => getTasksStatus(),
  setTasksStatus: (status) => {
    setTasksStatus(status);
  },
  hasTasksSaveTimeout: () => hasTasksSaveTimeout(),
  onApplyWorkspacePermissions: () => {
    applyWorkspacePermissions();
  }
});
initWorkspaceFlushController({
  getProject: () => activeProject,
  hasLyricsSaveTimeout: () => hasLyricsSaveTimeout(),
  clearLyricsSaveTimeout: () => {
    clearLyricsSaveTimeout();
  },
  getActiveLyricsDoc: () => getActiveLyricsDoc(),
  onSaveLyricsWorkspace: (content, id, title) => {
    return saveLyricsWorkspace(content, id, title);
  },
  hasNotesSaveTimeout: () => hasNotesSaveTimeout(),
  clearNotesSaveTimeout: () => {
    clearNotesSaveTimeout();
  },
  getNotesFieldValues: () => getNotesFieldValues(),
  onSaveNotesWorkspace: (content, bpm, key) => {
    return saveNotesWorkspace(content, bpm, key);
  },
  hasStructureSaveTimeout: () => hasStructureSaveTimeout(),
  clearStructureSaveTimeout: () => {
    clearStructureSaveTimeout();
  },
  getStructureSections: () => getStructureSections(),
  onSaveStructureWorkspace: (sections) => {
    return saveStructureWorkspace();
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
  }
});
initWorkspaceDrawerUi({
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
initDeepLinkController({
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
initScheduledSessions({
  getToken: () => auth.getToken(),
  notificationManager: scheduledNotifications,
  onStartSession: () => {
    void prepareStudio({ type: 'create' });
  }
});
initRecentSessions({
  getUser: () => auth.getUser(),
  getRecentSessions: () => auth.getRecentSessions(),
  onStartSession: () => {
    void prepareStudio({ type: 'create' });
  },
  onNavigateToAllSessions: () => {
    showView('all-sessions-view');
  },
  onNavigateToHome: () => {
    showView('home-view');
  }
});
initProfileController({
  onUpdateProfile: async (payload) => {
    await auth.updateProfile(payload);
  }
});
initProfileUiController({
  getUser: () => auth.getUser(),
  onOpenAccountSettings: () => openSettings('account'),
  onOpenGeneralSettings: () => openSettings('general'),
  onOpenAuthView: (mode) => openAuthView(mode),
  onLogout: async () => {
    await handleLogout();
  },
  onShowHomeView: () => showView('home-view'),
  onSaveProfile: (formValues) => {
    void handleSaveProfile(formValues);
  }
});
initSettingsUi({
  onCloseSettings: () => showView(getLastActiveViewBeforeSettings() || 'home-view')
});
initAuthController({
  onLoginAuth: async (credentials) => {
    await auth.login(credentials);
  },
  onRegisterAuth: async (values) => {
    await auth.register(values);
  },
  onLogoutAuth: async () => {
    await auth.logout();
  },
  getPendingJoinCode: () => getPendingJoinCode(),
  clearPendingJoinCode: () => {
    clearPendingJoinCode();
  },
  onJoinStudio: (code) => {
    void prepareStudio({ type: 'join', code });
  },
  onNavigateHome: () => {
    showView('home-view');
  }
});
initAuthUiController({
  onOpenSignIn: () => openAuthView('login'),
  onOpenRegister: () => openAuthView('register'),
  onNavigateHome: () => showView('home-view'),
  onLogout: () => {
    void handleLogout();
  },
  onLogin: (credentials) => handleLogin(credentials),
  onRegister: (values) => handleRegister(values)
});
initLyricsController({
  getActiveProject: () => activeProject,
  getActiveLyricsDoc: () => getActiveLyricsDoc(),
  onIncrementLyricsEditGen: () => {
    incrementLyricsEditGen();
  },
  onSaveLyricsWorkspace: async (content, docId, title) => {
    await saveLyricsWorkspace(content, docId, title);
  }
});
initLyricsUi({
  isInCall: () => inCall,
  canEdit: () => canUserEditProject(),
  getActiveLyricsDoc: () => getActiveLyricsDoc(),
  onLyricsInput: (newHtml) => {
    handleLyricsInput(newHtml);
  },
  onDocTitleChange: (docId, newTitle) => {
    handleLyricsDocTitleChange(docId, newTitle);
  },
  onSwitchDoc: (docId) => {
    switchActiveLyricsDoc(docId);
  },
  onDuplicateDoc: (docId) => {
    duplicateLyricsDoc(docId);
  },
  onDeleteDoc: (docId) => {
    deleteLyricsDoc(docId);
  }
});
initStructureController({
  getSections: () => getStructureSections(),
  onDebounceSaveStructure: () => {
    debounceSaveStructure();
  }
});
initStructureUi({
  getSections: () => getStructureSections(),
  canEdit: () => canUserEditProject(),
  onAddSection: (type) => {
    addStructureSection(type);
  },
  onReorderSection: (sourceId, targetId, position) => {
    reorderStructureSectionToPosition(sourceId, targetId, position);
  },
  onDuplicateSection: (sectionId) => {
    duplicateStructureSection(sectionId);
  },
  onDeleteSection: (sectionId) => {
    deleteStructureSection(sectionId);
  },
  onSectionChange: (sectionId, changes) => {
    handleStructureSectionChange(sectionId, changes);
  }
});
initNotesController({
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
initNotesUi({
  canEdit: () => canUserEditProject(),
  onNotesChange: (values) => {
    handleNotesChange(values);
  }
});
initProjectsListController({
  getAuthToken: () => auth.getToken(),
  getUser: () => auth.getUser(),
  onProjectsLoaded: (projects) => {
    projectsList = projects;
  }
});
initProjectsListUi({
  onOpenProject: (projectId) => {
    void openProjectView(projectId);
  }
});
initProjectViewController({
  getProject: () => activeProject,
  getUser: () => auth.getUser(),
  renderCollaborators: () => {
    renderProjectCollaboratorsView();
  },
  applyWorkspacePermissions: () => {
    applyWorkspacePermissions();
  }
});
initProjectOpenController({
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
    void signaling
      .joinProjectWorkspace(projectId, token)
      .catch((e) => console.warn('[Signaling] Failed to join project workspace socket room:', e));
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
initProjectCollaboratorsController({
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
initProjectArchiveController({
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
  }
});
initProjectMenuUi({
  onArchiveProject: () => {
    void handleArchiveProject();
  }
});

initProjectRenameController({
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
  }
});
initProjectRenameUi({
  onTriggerRename: () => {
    handleTriggerRename();
  },
  onSave: (data) => {
    void handleSaveRename(data);
  }
});

initProjectCollaboratorModalUi({
  onAddCollaborator: async ({ usernameOrEmail, role }) => {
    await handleAddCollaborator(usernameOrEmail, role, {
      onBeforeRequest: () => {
        setAddCollaboratorError('');
      },
      onSuccess: () => {
        closeAddCollaboratorModal();
      },
      onError: (errorMessage) => {
        setAddCollaboratorError(errorMessage);
      }
    });
  }
});

initProjectDeleteController({
  getAuthToken: () => auth.getToken(),
  getProject: () => activeProject,
  onProjectDeleted: () => {
    activeProject = undefined;
    activeProjectId = undefined;
  },
  onNavigateHome: () => {
    showView('home-view');
  },
  onRefreshProjectsList: async () => {
    await loadProjects();
  }
});
initProjectDeleteUi({
  onTriggerDelete: () => {
    handleTriggerDelete();
  },
  getProjectName: () => activeProject?.name,
  onConfirmDelete: () => {
    void handleConfirmDelete();
  }
});

initProjectSongDeleteController({
  getProject: () => activeProject,
  canUserEditProject: () => canUserEditProject(),
  onSwitchActiveSong: (songId) => switchActiveSong(songId),
  onRenderProjectSongsSelector: () => renderProjectSongsSelector(),
  onRenderProjectOverviewSongsList: () => renderProjectOverviewSongsList(),
  onApplyWorkspacePermissions: () => applyWorkspacePermissions(),
  onSaveSongsWorkspace: () => saveSongsWorkspace()
});

initProjectCreateController({
  getAuthToken: () => auth.getToken(),
  onRefreshProjectsList: async () => {
    await loadProjects();
  },
  onOpenProject: async (projectId) => {
    await openProjectView(projectId);
  }
});
initProjectCreateUi({
  onCreateProject: (data) => {
    void handleCreateProject(data);
  }
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
initProjectNavigationController({
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
  await prepareStudioController(action, {
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
    onReplaceMusicInput: () => replaceMusicInput(),
    onShowSessionError: (error) => showSessionErrorModal(parseSessionError(error))
  });
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
  remoteMedia = media;
  const shouldRender = Boolean(remoteVideoStream && (!media.audioOnly || media.sharingScreen));
  const video = $<HTMLVideoElement>('remote-video');
  if (video) video.srcObject = shouldRender ? remoteVideoStream! : null;
  $('remote-placeholder')?.classList.toggle('hidden', shouldRender);
  const fullShareBtn = $<HTMLButtonElement>('fullscreen-share-button');
  if (fullShareBtn) fullShareBtn.disabled = !media.sharingScreen;
  setText('remote-placeholder', media.sharingScreen ? 'Loading shared screen…' : media.audioOnly || !media.cameraEnabled ? 'Musician is in Audio Only' : 'Waiting for Musician');
  updateSessionStage();
  if (inCall) {
    applyMixerAudioRouting();
  }
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
    case 'open-workspace':
      if (!isSessionWorkspaceOpen()) {
        await presenter.showMainWindow();
        $('session-presenter-banner')?.classList.remove('hidden');
        setSessionWorkspaceOpen(true);
      } else {
        setSessionWorkspaceOpen(false);
      }
      break;
    case 'toggle-chat':
    case 'open-chat':
      if (!isSessionChatOpen()) {
        await presenter.showMainWindow();
        $('session-presenter-banner')?.classList.remove('hidden');
        setSessionChatOpen(true);
      } else {
        setSessionChatOpen(false);
      }
      break;
    case 'toggle-mixer':
    case 'open-mixer':
      if (!studioMixerOpen) {
        await presenter.showMainWindow();
        $('session-presenter-banner')?.classList.remove('hidden');
      }
      toggleStudioMixer();
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
      toggleSessionLayout(isAnySharing);
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
    case 'toggle-settings':
    case 'toggle-audio-settings':
    case 'open-audio-settings': {
      const isSettingsOpen = !$('settings-view')?.classList.contains('hidden') || !$('in-call-audio-modal')?.classList.contains('hidden');
      if (!isSettingsOpen) {
        await presenter.showMainWindow();
        $('session-presenter-banner')?.classList.remove('hidden');
        void enumerateAndPopulate();
        openSettings('audio');
      } else {
        if (!$('in-call-audio-modal')?.classList.contains('hidden')) {
          closeInCallAudioModal();
        }
        if (!$('settings-view')?.classList.contains('hidden')) {
          showView(getLastActiveViewBeforeSettings() || 'call-view');
        }
      }
      break;
    }
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



for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="settings-default-mode"]')) {
  radio.addEventListener('change', () => {
    prefs.mode = radio.value as AudioMode;
    savePreferences();
    void syncAllVoiceMics(prefs.mode);
  });
}

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
  remoteVoiceIsStereo = false;
  rtc.resetPeer();
  for (const [, item] of remoteAudioTracks) {
    item.track.onended = null;
    try { item.track.stop(); } catch {}
  }
  remoteAudioTracks.clear();
  for (const [, entry] of remoteMusicSourceNodes) {
    try { entry.sourceNode.disconnect(); } catch {}
  }
  remoteMusicSourceNodes.clear();
  void refreshRemoteAudio();
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
  eq?: Record<string, ChannelEqConfig>;
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

function hydrateStudioMixerEqPersistence(): void {
  const map = loadSavedStudioMixerConfig();
  for (const [channelId, chData] of Object.entries(map)) {
    if (chData && chData.eq && typeof chData.eq === 'object') {
      for (const [slotStr, eqConf] of Object.entries(chData.eq)) {
        const slotIdx = parseInt(slotStr, 10);
        if (!isNaN(slotIdx) && eqConf && Array.isArray(eqConf.bands)) {
          setChannelEqConfig(channelId, slotIdx, eqConf);
        }
      }
    }
  }
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
        const eqData: Record<string, ChannelEqConfig> = {};
        if (Array.isArray(ch.fx)) {
          for (let i = 0; i < ch.fx.length; i++) {
            if (ch.fx[i] === 'Chan EQ') {
              eqData[i] = getChannelEqConfig(ch.id, i);
            }
          }
        }
        map[ch.id] = {
          name: ch.name,
          icon: ch.icon,
          color: ch.color,
          volume: typeof ch.volume === 'number' && !isNaN(ch.volume) ? ch.volume : 1.0,
          pan: typeof ch.pan === 'number' && !isNaN(ch.pan) ? ch.pan : 0,
          fx: Array.isArray(ch.fx) ? [...ch.fx] : [],
          eq: Object.keys(eqData).length > 0 ? eqData : undefined
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

hydrateStudioMixerEqPersistence();
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
    const s = timeDomainBuffer[i] ?? 0;
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
        fxSlot.title = activeFx === 'Chan EQ'
          ? `Channel EQ: Click to open EQ plugin window (Right-click to change/clear)`
          : activeFx
          ? `Plugin: ${activeFx} (Click to change/remove)`
          : `Slot ${i + 1}: Add Audio FX Plugin`;

        fxSlot.addEventListener('click', (e) => {
          e.stopPropagation();
          if (activeFx === 'Chan EQ') {
            openChannelEqPlugin(
              channel.id,
              i,
              channel.name,
              channel.color,
              () => {
                if (channel.id.startsWith('you-mic')) {
                  const micIdx = channel.id === 'you-mic' ? 1 : parseInt(channel.id.replace('you-mic-', ''), 10) || 1;
                  return audio.getVoiceMicEqDsp(micIdx, i);
                } else if (channel.id === 'music-stream') {
                  return audio.getMusicEqDsp(i);
                } else {
                  return channelEqDspRegistry.get(channel.id, i);
                }
              },
              () => saveStudioMixerConfig(false)
            );
          } else {
            openFxPopover(channel.id, i, fxSlot);
          }
        });

        fxSlot.addEventListener('contextmenu', (e) => {
          e.preventDefault();
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
    const iconData = STUDIO_ICONS[iconKey] || STUDIO_ICONS.waves || { label: 'Track', svg: '' };
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
      channel.fx[slotIndex] = '';
      channelEqDspRegistry.remove(channelId, slotIndex);
      removeChannelEqConfig(channelId, slotIndex);
    } else if (fx) {
      channel.fx[slotIndex] = fx;
      if (fx !== 'Chan EQ') {
        channelEqDspRegistry.remove(channelId, slotIndex);
        removeChannelEqConfig(channelId, slotIndex);
      }
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


