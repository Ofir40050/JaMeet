import type { UserProfile } from '@jameet/shared';
import { $ } from '../../core/dom';
import { switchAuthViewTab } from './authUi';
import { switchSettingsSection, type SettingsSection } from '../settings/settingsUi';

export interface AuthNavigationOptions {
  showView: (view: string) => void;
  getViews: () => readonly string[];
  getUser: () => UserProfile | null | undefined;
  getGuestName: () => string;
  onCloseAccountMenu: () => void;
  onUpdateAuthUi: (user: UserProfile | null, guestName: string) => void;
  onEnumerateAndPopulate: () => Promise<void> | void;
}

let navigationOptions: AuthNavigationOptions | null = null;
let lastActiveViewBeforeSettings = 'home-view';

export function initAuthNavigation(options: AuthNavigationOptions): void {
  navigationOptions = options;
}

export function getLastActiveViewBeforeSettings(): string {
  return lastActiveViewBeforeSettings;
}

export function setLastActiveViewBeforeSettings(view: string): void {
  lastActiveViewBeforeSettings = view;
}

export function openAuthView(tab: 'login' | 'register' = 'login'): void {
  if (!navigationOptions) return;
  navigationOptions.showView('auth-view');
  switchAuthViewTab(tab);
}

export function openSettings(section: SettingsSection = 'account'): void {
  if (!navigationOptions) return;
  navigationOptions.onCloseAccountMenu();
  const views = navigationOptions.getViews();
  const currentActive = views.find(
    (v) => !$(v)?.classList.contains('hidden') && v !== 'settings-view'
  );
  if (currentActive) {
    lastActiveViewBeforeSettings = currentActive;
  }

  const user = navigationOptions.getUser();
  if (user) {
    navigationOptions.onUpdateAuthUi(user, navigationOptions.getGuestName());
  }
  void navigationOptions.onEnumerateAndPopulate();

  switchSettingsSection(section);
  navigationOptions.showView('settings-view');
}

export function openAuthDialog(tab: 'login' | 'register' = 'login'): void {
  if (!navigationOptions) return;
  const user = navigationOptions.getUser();
  if (user) {
    openSettings('account');
  } else {
    openAuthView(tab);
  }
}
