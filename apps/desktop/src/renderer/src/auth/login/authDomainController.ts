import type { AuthManager } from './auth';
import type { UpdateProfileRequest } from '@jameet/shared';
import {
  initProfileController,
  handleSaveProfile
} from '../profile/profileController';
import { initProfileUiController } from '../profile/profileUiController';
import { initSettingsUi } from '../settings/settingsUi';
import {
  initAuthController,
  handleLogin,
  handleRegister,
  handleLogout
} from './authController';
import { initAuthUi } from './authUi';

export interface AuthDomainControllerOptions {
  auth: AuthManager;
  onOpenSettings: (section: string) => void;
  onOpenAuthView: (mode: 'login' | 'register') => void;
  onShowHomeView: () => void;
  getLastActiveViewBeforeSettings: () => string | null;
  onShowView: (view: string) => void;
  getPendingJoinCode: () => string | undefined;
  onClearPendingJoinCode: () => void;
  onPrepareStudio: (action: { type: 'join'; code: string }) => void;
  onSendFeedback?: () => void;
}

export function initAuthDomainController(options: AuthDomainControllerOptions): void {
  initProfileController({
    onUpdateProfile: async (payload: UpdateProfileRequest) => {
      await options.auth.updateProfile(payload);
    }
  });

  initProfileUiController({
    getUser: () => options.auth.getUser(),
    onOpenAccountSettings: () => options.onOpenSettings('account'),
    onOpenGeneralSettings: () => options.onOpenSettings('general'),
    onOpenAuthView: (mode) => options.onOpenAuthView(mode),
    onSendFeedback: () => options.onSendFeedback?.(),
    onLogout: async () => {
      await handleLogout();
    },
    onShowHomeView: () => options.onShowHomeView(),
    onSaveProfile: (formValues) => {
      void handleSaveProfile(formValues);
    }
  });

  initSettingsUi({
    onCloseSettings: () => options.onShowView(options.getLastActiveViewBeforeSettings() || 'home-view')
  });

  initAuthController({
    onLoginAuth: async (credentials) => {
      await options.auth.login(credentials);
    },
    onRegisterAuth: async (values) => {
      await options.auth.register(values);
    },
    onLogoutAuth: async () => {
      await options.auth.logout();
    },
    getPendingJoinCode: () => options.getPendingJoinCode(),
    clearPendingJoinCode: () => {
      options.onClearPendingJoinCode();
    },
    onJoinStudio: (code) => {
      void options.onPrepareStudio({ type: 'join', code });
    },
    onNavigateHome: () => {
      options.onShowHomeView();
    }
  });

  initAuthUi({
    onOpenSignIn: () => options.onOpenAuthView('login'),
    onOpenRegister: () => options.onOpenAuthView('register'),
    onNavigateHome: () => options.onShowHomeView(),
    onLogout: () => {
      void handleLogout();
    },
    onLogin: (credentials) => handleLogin(credentials),
    onRegister: (values) => handleRegister(values)
  });
}
