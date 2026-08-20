import type { UserProfile } from '@jameet/shared';
import { $, setText } from '../core/dom';
import { icons } from '../core/icons';
import { safeAvatarColor } from '../core/htmlSecurity';
import {
  applyAvatarToElement,
  highlightActiveSwatch,
  setEditingAvatarColor,
  setEditingAvatarUrl,
  getEditingAvatarColor,
  getEditingAvatarUrl,
  switchProfileSubtab,
  updateProfileLivePreview
} from './profile/profileUi';

export interface AuthStateUiControllerOptions {
  onLoadScheduledSessions: () => Promise<void> | void;
  onLoadRecentSessions: () => Promise<void> | void;
  onLoadProjects: () => Promise<void> | void;
  onStopScheduledNotifications: () => void;
}

let controllerOptions: AuthStateUiControllerOptions | null = null;

export function initAuthStateUiController(options: AuthStateUiControllerOptions): void {
  controllerOptions = options;
}

export function updateAuthUi(user: UserProfile | null, guestName: string): void {
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
    if (controllerOptions) {
      void controllerOptions.onLoadScheduledSessions();
      void controllerOptions.onLoadRecentSessions();
      void controllerOptions.onLoadProjects();
    }
  } else {
    controllerOptions?.onStopScheduledNotifications();
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
    setEditingAvatarColor(safeAvatarColor(user.avatarColor, '#06b6d4'));
    setEditingAvatarUrl(user.avatarUrl);

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
    highlightActiveSwatch(getEditingAvatarColor());
    $('btn-remove-avatar-photo')?.classList.toggle('hidden', !Boolean(getEditingAvatarUrl()));
    $('profile-feedback-msg')?.classList.add('hidden');

    switchProfileSubtab('info');
    updateProfileLivePreview();
  } else {
    setText('auth-dialog-title', 'Sign In or Register');
  }
}
