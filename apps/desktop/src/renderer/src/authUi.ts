import { $, setText } from './dom';

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
    errEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon" style="flex-shrink:0;"><circle cx="12" cy="10" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg><span>${message}</span>`;
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

let listenersBound = false;

export function initAuthUi(): void {
  if (listenersBound) return;
  listenersBound = true;

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
