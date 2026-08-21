import { $, setText } from '../../core/dom';

export function switchAuthViewTab(tab: 'login' | 'register'): void {
  const isLogin = tab === 'login';
  $('view-tab-login')?.classList.toggle('active', isLogin);
  $('view-tab-register')?.classList.toggle('active', !isLogin);
  $('view-panel-login')?.classList.toggle('hidden', !isLogin);
  $('view-panel-register')?.classList.toggle('hidden', isLogin);
  setText('auth-view-crumb', isLogin ? 'Sign In' : 'Create Account');
  $('view-login-error')?.classList.add('hidden');
  $('view-reg-error')?.classList.add('hidden');
  if (isLogin) {
    setTimeout(() => $<HTMLInputElement>('view-login-identifier')?.focus(), 50);
  } else {
    setTimeout(() => $<HTMLInputElement>('view-reg-display-name')?.focus(), 50);
  }
}

export function setAuthInputError(inputId: string, isError: boolean): void {
  const el = $<HTMLInputElement>(inputId);
  if (el) {
    el.classList.toggle('input-error', isError);
  }
}

export function showAuthFormError(errElId: string, message: string, invalidInputIds: string[] = []): void {
  const errEl = $(errElId);
  if (errEl) {
    errEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg><span>${message}</span>`;
    errEl.classList.remove('hidden');
  }
  invalidInputIds.forEach((id) => setAuthInputError(id, true));
}

export function clearAuthFormError(errElId: string, inputIds: string[] = []): void {
  const errEl = $(errElId);
  if (errEl) errEl.classList.add('hidden');
  inputIds.forEach((id) => setAuthInputError(id, false));
}

export function updatePasswordStrength(password: string): void {
  const wrap = $('password-strength-wrap');
  const statusEl = $('strength-text');
  if (!wrap || !statusEl) return;

  if (!password) {
    wrap.classList.add('hidden');
    return;
  }

  wrap.classList.remove('hidden');

  let score = 0;
  if (password.length >= 8) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password) || password.length >= 12) score++;

  wrap.classList.remove('strength-weak', 'strength-fair', 'strength-good', 'strength-strong');

  if (score <= 1) {
    wrap.classList.add('strength-weak');
    statusEl.textContent = 'Weak (Needs 8+ chars)';
  } else if (score === 2) {
    wrap.classList.add('strength-fair');
    statusEl.textContent = 'Fair';
  } else if (score === 3) {
    wrap.classList.add('strength-good');
    statusEl.textContent = 'Good';
  } else {
    wrap.classList.add('strength-strong');
    statusEl.textContent = 'Strong 🔒';
  }
}

export function validateRegisterInputsLive(): boolean {
  const displayName = $<HTMLInputElement>('view-reg-display-name')?.value.trim() || '';
  const username = $<HTMLInputElement>('view-reg-username')?.value.trim() || '';
  const email = $<HTMLInputElement>('view-reg-email')?.value.trim() || '';
  const emailConfirm = $<HTMLInputElement>('view-reg-email-confirm')?.value.trim() || '';
  const password = $<HTMLInputElement>('view-reg-password')?.value || '';
  const passwordConfirm = $<HTMLInputElement>('view-reg-password-confirm')?.value || '';

  updatePasswordStrength(password);

  // Check Display Name (English characters only)
  if (displayName.length > 0 && !/^[a-zA-Z0-9 .'-]+$/.test(displayName)) {
    showAuthFormError('view-reg-error', 'Display Name must contain only English letters and numbers.', ['view-reg-display-name']);
    return false;
  } else {
    setAuthInputError('view-reg-display-name', false);
  }

  // Check Username (English characters only)
  if (username.length > 0 && !/^[a-zA-Z0-9_]+$/.test(username)) {
    showAuthFormError('view-reg-error', 'Username must contain only English letters, numbers, and underscores.', ['view-reg-username']);
    return false;
  } else {
    setAuthInputError('view-reg-username', false);
  }

  // Check email confirmation
  if (emailConfirm.length > 0 && email.length > 0 && email.toLowerCase() !== emailConfirm.toLowerCase()) {
    showAuthFormError('view-reg-error', 'Email addresses do not match.', ['view-reg-email-confirm']);
    return false;
  } else {
    setAuthInputError('view-reg-email-confirm', false);
  }

  // Check password confirmation
  if (passwordConfirm.length > 0 && password.length > 0 && password !== passwordConfirm) {
    showAuthFormError('view-reg-error', 'Passwords do not match.', ['view-reg-password-confirm']);
    return false;
  } else {
    setAuthInputError('view-reg-password-confirm', false);
  }

  // Check password length
  if (password.length > 0 && password.length < 8) {
    showAuthFormError('view-reg-error', 'Password must be at least 8 characters long.', ['view-reg-password']);
    return false;
  } else {
    setAuthInputError('view-reg-password', false);
  }

  clearAuthFormError('view-reg-error', ['view-reg-display-name', 'view-reg-username', 'view-reg-email', 'view-reg-email-confirm', 'view-reg-password', 'view-reg-password-confirm']);
  return true;
}

export interface RegisterFormValues {
  displayName: string;
  username: string;
  email: string;
  password: string;
  phoneNumber?: string;
}

export interface AuthUiOptions {
  onOpenSignIn?: () => void;
  onOpenRegister?: () => void;
  onNavigateHome?: () => void;
  onLogout?: () => Promise<void> | void;
  onLogin?: (credentials: { identifier: string; password: string }) => Promise<void> | void;
  onRegister?: (values: RegisterFormValues) => Promise<void> | void;
}

let listenersBound = false;
let authOptions: AuthUiOptions = {};

export function initAuthUi(options: AuthUiOptions = {}): void {
  authOptions = options;
  if (listenersBound) return;
  listenersBound = true;

  $('nav-btn-signin')?.addEventListener('click', () => {
    authOptions.onOpenSignIn?.();
  });
  $('nav-btn-register')?.addEventListener('click', () => {
    authOptions.onOpenRegister?.();
  });
  $('hero-btn-signin')?.addEventListener('click', () => {
    authOptions.onOpenSignIn?.();
  });
  $('hero-btn-register')?.addEventListener('click', () => {
    authOptions.onOpenRegister?.();
  });

  $('btn-auth-view-back')?.addEventListener('click', () => {
    authOptions.onNavigateHome?.();
  });
  $('btn-view-login-as-guest')?.addEventListener('click', () => {
    authOptions.onNavigateHome?.();
  });
  $('btn-view-reg-as-guest')?.addEventListener('click', () => {
    authOptions.onNavigateHome?.();
  });

  $('btn-auth-logout')?.addEventListener('click', async () => {
    await authOptions.onLogout?.();
    $<HTMLDialogElement>('auth-dialog')?.close();
    authOptions.onNavigateHome?.();
  });

  $('btn-view-submit-login')?.addEventListener('click', async () => {
    const submitBtn = $<HTMLButtonElement>('btn-view-submit-login');
    const identifier = $<HTMLInputElement>('view-login-identifier')?.value.trim();
    const password = $<HTMLInputElement>('view-login-password')?.value;

    const missing: string[] = [];
    if (!identifier) missing.push('view-login-identifier');
    if (!password) missing.push('view-login-password');

    const firstMissing = missing[0];
    if (firstMissing) {
      showAuthFormError('view-login-error', 'Please enter your username/email and password.', missing);
      $<HTMLInputElement>(firstMissing)?.focus();
      return;
    }

    clearAuthFormError('view-login-error', ['view-login-identifier', 'view-login-password']);
    const originalHtml = submitBtn ? submitBtn.innerHTML : '<span>Sign In</span>';
    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Signing In…</span>';
      }
      await authOptions.onLogin?.({ identifier: identifier!, password: password! });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid credentials. Please try again.';
      showAuthFormError('view-login-error', msg, ['view-login-identifier', 'view-login-password']);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
      }
    }
  });

  $('btn-view-submit-register')?.addEventListener('click', async () => {
    const submitBtn = $<HTMLButtonElement>('btn-view-submit-register');
    const displayName = $<HTMLInputElement>('view-reg-display-name')?.value.trim();
    const username = $<HTMLInputElement>('view-reg-username')?.value.trim();
    const phoneCode = $<HTMLSelectElement>('view-reg-phone-code')?.value?.replace('-ca', '') || '+1';
    const rawPhone = $<HTMLInputElement>('view-reg-phone-number')?.value.trim();
    const phoneNumber = rawPhone ? `${phoneCode} ${rawPhone}` : undefined;
    const email = $<HTMLInputElement>('view-reg-email')?.value.trim();
    const emailConfirm = $<HTMLInputElement>('view-reg-email-confirm')?.value.trim();
    const password = $<HTMLInputElement>('view-reg-password')?.value;
    const passwordConfirm = $<HTMLInputElement>('view-reg-password-confirm')?.value;

    const missing: string[] = [];
    if (!displayName) missing.push('view-reg-display-name');
    if (!username) missing.push('view-reg-username');
    if (!email) missing.push('view-reg-email');
    if (!emailConfirm) missing.push('view-reg-email-confirm');
    if (!password) missing.push('view-reg-password');
    if (!passwordConfirm) missing.push('view-reg-password-confirm');

    const firstRegMissing = missing[0];
    if (firstRegMissing) {
      showAuthFormError('view-reg-error', 'Please fill out all registration fields.', missing);
      $<HTMLInputElement>(firstRegMissing)?.focus();
      return;
    }
    if (!/^[a-zA-Z0-9 .'-]+$/.test(displayName!)) {
      showAuthFormError('view-reg-error', 'Display Name must contain only English letters and numbers.', ['view-reg-display-name']);
      $<HTMLInputElement>('view-reg-display-name')?.focus();
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username!)) {
      showAuthFormError('view-reg-error', 'Username must contain only English letters, numbers, and underscores.', ['view-reg-username']);
      $<HTMLInputElement>('view-reg-username')?.focus();
      return;
    }
    if (username!.length < 3) {
      showAuthFormError('view-reg-error', 'Username must be at least 3 characters long.', ['view-reg-username']);
      $<HTMLInputElement>('view-reg-username')?.focus();
      return;
    }
    if (email && !email.includes('@')) {
      showAuthFormError('view-reg-error', 'Please enter a valid email address.', ['view-reg-email']);
      $<HTMLInputElement>('view-reg-email')?.focus();
      return;
    }
    if (email!.toLowerCase() !== emailConfirm!.toLowerCase()) {
      showAuthFormError('view-reg-error', 'Email addresses do not match.', ['view-reg-email-confirm']);
      $<HTMLInputElement>('view-reg-email-confirm')?.focus();
      return;
    }
    if (password !== passwordConfirm) {
      showAuthFormError('view-reg-error', 'Passwords do not match.', ['view-reg-password-confirm']);
      $<HTMLInputElement>('view-reg-password-confirm')?.focus();
      return;
    }
    if (password!.length < 8) {
      showAuthFormError('view-reg-error', 'Password must be at least 8 characters long.', ['view-reg-password']);
      $<HTMLInputElement>('view-reg-password')?.focus();
      return;
    }

    clearAuthFormError('view-reg-error', ['view-reg-display-name', 'view-reg-username', 'view-reg-email', 'view-reg-email-confirm', 'view-reg-password', 'view-reg-password-confirm']);

    const originalHtml = submitBtn ? submitBtn.innerHTML : '<span>Create Account</span>';
    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Creating Account…</span>';
      }
      await authOptions.onRegister?.({
        displayName: displayName!,
        username: username!,
        email: email!,
        password: password!,
        phoneNumber
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed.';
      const invalidIds: string[] = [];
      if (msg.toLowerCase().includes('username')) invalidIds.push('view-reg-username');
      if (msg.toLowerCase().includes('email')) invalidIds.push('view-reg-email');
      showAuthFormError('view-reg-error', msg, invalidIds);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
      }
    }
  });

  $('view-tab-login')?.addEventListener('click', () => switchAuthViewTab('login'));
  $('view-tab-register')?.addEventListener('click', () => switchAuthViewTab('register'));
  $('view-link-to-register')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchAuthViewTab('register');
  });
  $('view-link-to-login')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchAuthViewTab('login');
  });

  // Real-time live validations for registration form
  ['view-reg-display-name', 'view-reg-username', 'view-reg-email', 'view-reg-email-confirm', 'view-reg-password', 'view-reg-password-confirm'].forEach((id) => {
    $<HTMLInputElement>(id)?.addEventListener('input', () => {
      validateRegisterInputsLive();
    });
  });

  // Auto-format American phone numbers
  $<HTMLInputElement>('view-reg-phone-number')?.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    const code = $<HTMLSelectElement>('view-reg-phone-code')?.value;
    if (code === '+1' || code === '+1-ca') {
      const digits = input.value.replace(/\D/g, '').substring(0, 10);
      if (digits.length > 6) {
        input.value = `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}`;
      } else if (digits.length > 3) {
        input.value = `(${digits.substring(0, 3)}) ${digits.substring(3)}`;
      } else if (digits.length > 0) {
        input.value = `(${digits}`;
      }
    }
  });

  // Bind Enter key submissions on all inputs
  ['view-login-identifier', 'view-login-password'].forEach((id) => {
    $<HTMLInputElement>(id)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('btn-view-submit-login')?.click();
      }
    });
  });

  ['view-reg-display-name', 'view-reg-username', 'view-reg-phone-number', 'view-reg-email', 'view-reg-email-confirm', 'view-reg-password', 'view-reg-password-confirm'].forEach((id) => {
    $<HTMLInputElement>(id)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('btn-view-submit-register')?.click();
      }
    });
  });
}
