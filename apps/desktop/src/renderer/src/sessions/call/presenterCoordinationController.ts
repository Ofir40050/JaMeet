import { $ } from '../../core/dom';
import { presenter } from '../../media/video/presenter';
import { deviceError } from '../../media/devices/deviceError';
import type { AudioMode, MediaMetadata } from '@jameet/shared';
import type { Preferences } from '../../core/preferences';
import type { SettingsSection } from '../../auth/settings/settingsUi';
import { isSessionWorkspaceOpen, setSessionWorkspaceOpen } from './workspaceDrawerUi';
import { isSessionChatOpen, setSessionChatOpen } from './chat';
import { toggleSessionLayout } from './sessionView';

export interface PresenterCoordinationContext {
  isMuted: () => boolean;
  onToggleMute: () => void;
  isCameraEnabled: () => boolean;
  onToggleCamera: () => Promise<void>;
  getPreferences: () => Preferences;
  onReplaceAudioInput: (deviceId: string | undefined, mode: AudioMode) => Promise<void>;
  isStudioMixerOpen: () => boolean;
  onToggleStudioMixer: (forceOpen?: boolean) => void;
  getScreenTrack: () => MediaStreamTrack | undefined;
  getCurrentSharingSourceTitle: () => string;
  getRemoteMedia: () => MediaMetadata | undefined;
  getRemoteVideoStream: () => MediaStream | undefined;
  onShowScreenPicker: () => Promise<void>;
  onEnumerateAndPopulate: () => Promise<void>;
  onOpenSettings: (section?: SettingsSection) => void;
  onCloseInCallAudioModal: () => void;
  onShowView: (view: string) => void;
  getLastActiveViewBeforeSettings: () => string | null;
  onStopScreenShare: () => Promise<void>;
  onSetCallStatus: (status: string) => void;
}

export function initPresenterCoordinationController(ctx: PresenterCoordinationContext): void {
  presenter.setActionHandler(async (action) => {
    switch (action) {
      case 'toggle-mic':
        ctx.onToggleMute();
        presenter.updateState({ micMuted: ctx.isMuted() });
        break;
      case 'toggle-cam':
        void ctx.onToggleCamera().then(() => {
          presenter.updateState({ camEnabled: ctx.isCameraEnabled() });
        }).catch((e) => ctx.onSetCallStatus(deviceError(e)));
        break;
      case 'toggle-mode': {
        const prefs = ctx.getPreferences();
        const next: AudioMode = prefs.mode === 'music' ? 'talk' : 'music';
        void ctx.onReplaceAudioInput(prefs.audioInputId, next).then(() => {
          presenter.updateState({ mode: prefs.mode });
        }).catch((e) => ctx.onSetCallStatus(deviceError(e)));
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
        if (!ctx.isStudioMixerOpen()) {
          await presenter.showMainWindow();
          $('session-presenter-banner')?.classList.remove('hidden');
        }
        ctx.onToggleStudioMixer();
        break;
      case 'toggle-pause': {
        const screenTrack = ctx.getScreenTrack();
        if (screenTrack) {
          screenTrack.enabled = !screenTrack.enabled;
          presenter.updateState({ paused: !screenTrack.enabled });
          ctx.onSetCallStatus(screenTrack.enabled ? `Sharing: ${ctx.getCurrentSharingSourceTitle() || 'Screen'}` : 'Screen Share Paused');
        }
        break;
      }
      case 'toggle-layout': {
        const screenTrack = ctx.getScreenTrack();
        const remoteMedia = ctx.getRemoteMedia();
        const remoteVideoStream = ctx.getRemoteVideoStream();
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
        void ctx.onShowScreenPicker();
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
          void ctx.onEnumerateAndPopulate();
          ctx.onOpenSettings('audio');
        } else {
          if (!$('in-call-audio-modal')?.classList.contains('hidden')) {
            ctx.onCloseInCallAudioModal();
          }
          if (!$('settings-view')?.classList.contains('hidden')) {
            ctx.onShowView(ctx.getLastActiveViewBeforeSettings() || 'call-view');
          }
        }
        break;
      }
      case 'toggle-floating-video':
        await presenter.toggleRemoteVideoPiP();
        break;
      case 'stop-share':
        await ctx.onStopScreenShare();
        break;
    }
  });

  $('btn-return-presenter')?.addEventListener('click', () => {
    $('session-presenter-banner')?.classList.add('hidden');
    const prefs = ctx.getPreferences();
    const screenTrack = ctx.getScreenTrack();
    void presenter.enterPresenterMode({
      micMuted: ctx.isMuted(),
      camEnabled: ctx.isCameraEnabled(),
      mode: prefs.mode,
      paused: screenTrack ? !screenTrack.enabled : false,
      pipVisible: true
    });
  });
}
