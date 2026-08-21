import type { UserProfile } from '@jameet/shared';
import { initProfileUi, type ProfileFormValues } from './profileUi';

export interface ProfileUiControllerOptions {
  getUser: () => UserProfile | null | undefined;
  onOpenAccountSettings: () => void;
  onOpenGeneralSettings: () => void;
  onOpenAuthView: (mode: 'login' | 'register') => void;
  onLogout: () => Promise<void>;
  onShowHomeView: () => void;
  onSaveProfile: (formValues: ProfileFormValues) => void;
}

export function initProfileUiController(options: ProfileUiControllerOptions): void {
  initProfileUi({
    getUser: () => options.getUser() ?? null,
    onOpenProfile: () => options.onOpenAccountSettings(),
    onOpenSettings: () => options.onOpenGeneralSettings(),
    onOpenGuestSettings: () => options.onOpenGeneralSettings(),
    onOpenSignIn: () => options.onOpenAuthView('login'),
    onOpenRegister: () => options.onOpenAuthView('register'),
    onLogout: async () => {
      await options.onLogout();
      options.onShowHomeView();
    },
    onSaveProfile: (formValues) => {
      options.onSaveProfile(formValues);
    }
  });
}
