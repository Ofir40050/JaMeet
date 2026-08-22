import type { UserProfile } from '@jameet/shared';
import { icons } from '../../core/icons';
import { safeAvatarColor } from '../../core/htmlSecurity';
import { $, setText } from '../../core/dom';

export interface ProfileFormValues {
  displayName: string;
  role?: string;
  location?: string;
  primaryDaw?: string;
  genres?: string[];
  bio?: string;
  socialHandle?: string;
  currentPassword?: string;
  newPassword?: string;
}

export interface ProfileUiOptions {
  getUser: () => UserProfile | null;
  onOpenProfile?: () => void;
  onOpenSettings?: () => void;
  onOpenGuestSettings?: () => void;
  onOpenSignIn?: () => void;
  onOpenRegister?: () => void;
  onSendFeedback?: () => void;
  onLogout?: () => Promise<void> | void;
  onSaveProfile?: (values: ProfileFormValues) => Promise<void> | void;
}

let options: ProfileUiOptions | null = null;
let editingAvatarColor = '#06b6d4';
let editingAvatarUrl: string | undefined = undefined;
let listenersBound = false;

export function getEditingAvatarColor(): string {
  return editingAvatarColor;
}

export function setEditingAvatarColor(color: string): void {
  editingAvatarColor = color;
}

export function getEditingAvatarUrl(): string | undefined {
  return editingAvatarUrl;
}

export function setEditingAvatarUrl(url: string | undefined): void {
  editingAvatarUrl = url;
}

export function applyAvatarToElement(
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

export function highlightActiveSwatch(color: string): void {
  const swatches = document.querySelectorAll<HTMLButtonElement>('.color-swatch-btn');
  swatches.forEach((swatch) => {
    const swatchColor = swatch.dataset.color?.toLowerCase();
    swatch.classList.toggle('active', swatchColor === color.toLowerCase());
  });
}

export function updateProfileLivePreview(): void {
  const nameInput = $<HTMLInputElement>('profile-edit-display-name')?.value.trim();
  const roleInput = $<HTMLInputElement>('profile-edit-role')?.value.trim();
  const locInput = $<HTMLInputElement>('profile-edit-location')?.value.trim();
  const dawInput = $<HTMLSelectElement>('profile-edit-daw')?.value.trim();

  const user = options?.getUser() ?? null;
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

export function switchProfileSubtab(tabName: 'info' | 'avatar' | 'security'): void {
  const tabs = ['info', 'avatar', 'security'] as const;
  for (const t of tabs) {
    const isCur = t === tabName;
    $(`profile-subtab-${t}`)?.classList.toggle('active', isCur);
    $(`profile-panel-${t}`)?.classList.toggle('hidden', !isCur);
  }
}

export function showProfileFeedback(msg: string, type: 'error' | 'success' | 'info'): void {
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

export function setProfileSaveBusy(isBusy: boolean): void {
  const saveBtn = $<HTMLButtonElement>('btn-profile-save');
  if (saveBtn) {
    saveBtn.disabled = isBusy;
    if (isBusy) {
      saveBtn.innerHTML = `<span>Saving Changes…</span>`;
    } else {
      saveBtn.innerHTML = `
        <span class="btn-icon-inner">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><polyline points="20 6 9 17 4 12"/></svg>
        </span>
        <span>Save Profile Changes</span>
      `;
    }
  }
}

export function clearProfilePasswordInputs(): void {
  const curPassEl = $<HTMLInputElement>('profile-input-cur-password');
  const newPassEl = $<HTMLInputElement>('profile-input-new-password');
  const confPassEl = $<HTMLInputElement>('profile-input-confirm-password');
  if (curPassEl) curPassEl.value = '';
  if (newPassEl) newPassEl.value = '';
  if (confPassEl) confPassEl.value = '';
}

export function toggleAccountMenu(triggerEl?: HTMLElement | null): void {
  const menu = $('account-menu');
  if (!menu) return;
  const isHidden = menu.classList.contains('hidden');
  if (!isHidden) {
    closeAccountMenu();
    return;
  }
  const user = options?.getUser() ?? null;
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

export function closeAccountMenu(): void {
  $('account-menu')?.classList.add('hidden');
}

export function initProfileUi(opts: ProfileUiOptions): void {
  options = opts;

  if (listenersBound) return;
  listenersBound = true;

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

  // Account Menu Triggers (4 entry points)
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

  // Home view profile button
  $('home-view-profile-btn')?.addEventListener('click', () => {
    options?.onOpenProfile?.();
  });

  // Account Menu action buttons
  $('account-menu-profile-btn')?.addEventListener('click', () => {
    options?.onOpenProfile?.();
  });
  $('account-menu-settings-btn')?.addEventListener('click', () => {
    options?.onOpenSettings?.();
  });
  $('account-menu-feedback-btn')?.addEventListener('click', () => {
    closeAccountMenu();
    options?.onSendFeedback?.();
  });
  $('account-menu-guest-settings-btn')?.addEventListener('click', () => {
    options?.onOpenGuestSettings?.();
  });
  $('account-menu-guest-feedback-btn')?.addEventListener('click', () => {
    closeAccountMenu();
    options?.onSendFeedback?.();
  });
  $('account-menu-signin-btn')?.addEventListener('click', () => {
    closeAccountMenu();
    options?.onOpenSignIn?.();
  });
  $('account-menu-register-btn')?.addEventListener('click', () => {
    closeAccountMenu();
    options?.onOpenRegister?.();
  });
  $('account-menu-logout-btn')?.addEventListener('click', () => {
    closeAccountMenu();
    void options?.onLogout?.();
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

    const formValues: ProfileFormValues = {
      displayName,
      role: role || undefined,
      location: location || undefined,
      primaryDaw: primaryDaw || undefined,
      genres: genres.length > 0 ? genres : undefined,
      bio: bio || undefined,
      socialHandle: social || undefined,
      currentPassword: newPass && curPass ? curPass : undefined,
      newPassword: newPass && curPass ? newPass : undefined
    };

    setProfileSaveBusy(true);
    try {
      await options?.onSaveProfile?.(formValues);
    } finally {
      setProfileSaveBusy(false);
    }
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
}
