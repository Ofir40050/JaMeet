import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerConfig } from './config.js';
import { UserStore, type SessionAccessState, type AdminUserSummary } from './auth.js';
import { ALLOWED_SESSION_ACCESS_STATES } from './admin-access.js';
import { getClientIp } from './client-ip.js';

export const ADMIN_SESSION_COOKIE_NAME = 'jameet_admin_session';
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const ADMIN_SESSION_MAX_AGE_SEC = 12 * 60 * 60; // 43200 seconds

// In-memory rate limiting for login attempts
const failedLoginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILED_ATTEMPTS = 5;
const FAILED_ATTEMPTS_WINDOW_MS = 60 * 1000; // 1 minute

export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) {
      cookies[key] = decodeURIComponent(val);
    }
  }
  return cookies;
}

export function buildAdminCookie(token: string, maxAgeSeconds: number, isProduction: boolean, isHttps: boolean): string {
  const parts = [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (isProduction || isHttps) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function buildClearAdminCookie(isProduction: boolean, isHttps: boolean): string {
  const parts = [
    `${ADMIN_SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (isProduction || isHttps) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function verifyAdminSecret(submitted: string, actualSecret: string): boolean {
  if (!submitted || !actualSecret) return false;
  const submittedBuf = Buffer.from(submitted.normalize('NFC'), 'utf-8');
  const actualBuf = Buffer.from(actualSecret.normalize('NFC'), 'utf-8');
  if (submittedBuf.length !== actualBuf.length) {
    // Avoid timing leak on length
    crypto.timingSafeEqual(submittedBuf, submittedBuf);
    return false;
  }
  return crypto.timingSafeEqual(submittedBuf, actualBuf);
}

export function createAdminSessionToken(adminSecret: string): string {
  const issuedAt = Date.now();
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${issuedAt}.${nonce}`;
  const hmac = crypto.createHmac('sha256', adminSecret).update(payload).digest('hex');
  return `${payload}.${hmac}`;
}

export function verifyAdminSessionToken(token: string | undefined, adminSecret: string | undefined): boolean {
  if (!token || !adminSecret || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [issuedAtStr, nonce, receivedHmac] = parts;
  if (!issuedAtStr || !nonce || !receivedHmac) return false;
  if (receivedHmac.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(receivedHmac)) return false;

  const issuedAt = parseInt(issuedAtStr, 10);
  if (isNaN(issuedAt)) return false;

  const now = Date.now();
  if (now - issuedAt > ADMIN_SESSION_TTL_MS || issuedAt > now + 60000) {
    return false; // Expired or invalid timestamp
  }

  const payload = `${issuedAtStr}.${nonce}`;
  const expectedHmac = crypto.createHmac('sha256', adminSecret).update(payload).digest('hex');

  const expBuf = Buffer.from(expectedHmac, 'hex');
  const recBuf = Buffer.from(receivedHmac, 'hex');
  if (expBuf.length !== recBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expBuf, recBuf);
}

export function isRequestAdminAuthenticated(request: FastifyRequest, config: ServerConfig): boolean {
  const secret = config.JAMEET_ADMIN_SECRET?.trim();
  if (!secret) return false;

  const cookies = parseCookies(request.headers.cookie);
  const sessionToken = cookies[ADMIN_SESSION_COOKIE_NAME];
  return verifyAdminSessionToken(sessionToken, secret);
}

export function validateSameOrigin(request: FastifyRequest, config: ServerConfig): boolean {
  const secFetchSite = request.headers['sec-fetch-site'];
  if (secFetchSite === 'cross-site') {
    return false;
  }

  const originHeader = request.headers.origin;
  const refererHeader = request.headers.referer;
  const hostHeader = request.headers.host;

  if (!originHeader && !refererHeader) {
    // If headers are omitted (e.g. some client environments or automated tests),
    // require custom JSON content-type or custom header to protect against simple browser form forgery
    const contentType = request.headers['content-type'] || '';
    const hasCustomHeader = request.headers['x-admin-action'] === '1';
    return hasCustomHeader || contentType.includes('application/json') || contentType.includes('application/x-www-form-urlencoded');
  }

  const targetOrigin = originHeader || (refererHeader ? new URL(refererHeader).origin : null);
  if (!targetOrigin) return false;

  try {
    const url = new URL(targetOrigin);
    if (hostHeader && (url.host === hostHeader || url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
      return true;
    }
    const allowed = config.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.includes(targetOrigin) || allowed.includes(url.origin)) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const attempt = failedLoginAttempts.get(ip);
  if (!attempt || now > attempt.resetAt) {
    return true;
  }
  return attempt.count < MAX_FAILED_ATTEMPTS;
}

function recordFailedLogin(ip: string): void {
  const now = Date.now();
  const attempt = failedLoginAttempts.get(ip);
  if (!attempt || now > attempt.resetAt) {
    failedLoginAttempts.set(ip, { count: 1, resetAt: now + FAILED_ATTEMPTS_WINDOW_MS });
  } else {
    attempt.count += 1;
  }
}

function clearFailedLogin(ip: string): void {
  failedLoginAttempts.delete(ip);
}

function renderLoginPage(errorMessage?: string): string {
  const safeError = errorMessage ? errorMessage.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>JaMeet Admin Authentication</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #131b2e;
      --border: #243049;
      --text: #f1f5f9;
      --text-muted: #8e9eb5;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --danger-bg: rgba(239, 68, 68, 0.15);
      --danger-text: #fca5a5;
      --danger-border: #7f1d1d;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem;
    }
    .login-container {
      width: 100%;
      max-width: 420px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 2.25rem 2rem;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
    }
    .logo-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.25);
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
      margin-bottom: 1.25rem;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin-bottom: 0.5rem;
    }
    p.subtitle {
      font-size: 0.875rem;
      color: var(--text-muted);
      margin-bottom: 1.75rem;
      line-height: 1.4;
    }
    .error-alert {
      background: var(--danger-bg);
      color: var(--danger-text);
      border: 1px solid var(--danger-border);
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-size: 0.875rem;
      margin-bottom: 1.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .form-group {
      margin-bottom: 1.5rem;
    }
    label {
      display: block;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
      letter-spacing: 0.02em;
    }
    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    input[type="password"], input[type="text"] {
      width: 100%;
      padding: 0.75rem 1rem;
      padding-right: 3rem;
      background: #0d1322;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    input[type="password"]:focus, input[type="text"]:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
    }
    .toggle-visibility {
      position: absolute;
      right: 0.75rem;
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 0.75rem;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }
    .toggle-visibility:hover {
      color: var(--text);
    }
    button[type="submit"] {
      width: 100%;
      padding: 0.85rem;
      background: var(--primary);
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    button[type="submit"]:hover {
      background: var(--primary-hover);
    }
    .footer-note {
      text-align: center;
      font-size: 0.75rem;
      color: #556987;
      margin-top: 1.5rem;
    }
  </style>
</head>
<body>
  <div class="login-container" id="admin-login-card">
    <div class="logo-badge">JaMeet Server Admin</div>
    <h1>Authentication Required</h1>
    <p class="subtitle">Enter the configured administrator secret to access the beta & access management panel.</p>

    ${safeError ? `<div class="error-alert" id="admin-login-error" role="alert"><span>⚠️</span><span>${safeError}</span></div>` : ''}

    <form method="POST" action="/admin/login" id="admin-login-form">
      <div class="form-group">
        <label for="admin-secret-input">Admin Secret (JAMEET_ADMIN_SECRET)</label>
        <div class="input-wrapper">
          <input type="password" id="admin-secret-input" name="secret" required placeholder="••••••••••••" autofocus autocomplete="current-password">
          <button type="button" class="toggle-visibility" id="toggle-secret-btn" aria-label="Toggle secret visibility">Show</button>
        </div>
      </div>
      <button type="submit" id="admin-login-submit">Authenticate</button>
    </form>

    <div class="footer-note">Server-side authenticated session • 12-hour expiration</div>
  </div>

  <script>
    const toggleBtn = document.getElementById('toggle-secret-btn');
    const secretInput = document.getElementById('admin-secret-input');
    if (toggleBtn && secretInput) {
      toggleBtn.addEventListener('click', () => {
        const isPassword = secretInput.type === 'password';
        secretInput.type = isPassword ? 'text' : 'password';
        toggleBtn.textContent = isPassword ? 'Hide' : 'Show';
      });
    }
  </script>
</body>
</html>`;
}

function renderAdminDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>JaMeet Admin • User & Beta Access</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-hover: #162032;
      --border: #1f2937;
      --border-subtle: #2d3748;
      --text: #f9fafb;
      --text-muted: #9ca3af;
      --text-dim: #6b7280;
      
      --badge-beta-bg: rgba(14, 165, 233, 0.15);
      --badge-beta-border: #0284c7;
      --badge-beta-text: #7dd3fc;
      
      --badge-paid-bg: rgba(16, 185, 129, 0.15);
      --badge-paid-border: #059669;
      --badge-paid-text: #6ee7b7;
      
      --badge-blocked-bg: rgba(244, 63, 94, 0.15);
      --badge-blocked-border: #e11d48;
      --badge-blocked-text: #fda4af;
      
      --btn-primary: #2563eb;
      --btn-primary-hover: #1d4ed8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: var(--card-bg);
      border-bottom: 1px solid var(--border);
      padding: 0.875rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .brand-section {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .brand-title {
      font-size: 1.125rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .brand-tag {
      font-size: 0.6875rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      background: rgba(37, 99, 235, 0.2);
      color: #60a5fa;
      border: 1px solid rgba(37, 99, 235, 0.35);
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .btn-secondary {
      background: #1f2937;
      color: var(--text);
      border: 1px solid var(--border-subtle);
      padding: 0.45rem 0.85rem;
      border-radius: 6px;
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .btn-secondary:hover {
      background: #283548;
      border-color: #4b5563;
    }
    .btn-logout {
      background: rgba(239, 68, 68, 0.1);
      color: #fca5a5;
      border: 1px solid rgba(239, 68, 68, 0.25);
    }
    .btn-logout:hover {
      background: rgba(239, 68, 68, 0.2);
      border-color: rgba(239, 68, 68, 0.4);
    }

    main {
      flex: 1;
      max-width: 1200px;
      width: 100%;
      margin: 0 auto;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    /* Stats Summary Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .stat-label {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .stat-value {
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: -0.03em;
    }

    /* Controls Bar */
    .controls-bar {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1rem 1.25rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .search-wrapper {
      flex: 1;
      min-width: 240px;
      max-width: 400px;
      position: relative;
    }
    .search-input {
      width: 100%;
      background: #0b0f19;
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 0.5rem 0.85rem 0.5rem 2.25rem;
      color: var(--text);
      font-size: 0.875rem;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .search-input:focus {
      border-color: #3b82f6;
    }
    .search-icon {
      position: absolute;
      left: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-dim);
      font-size: 0.875rem;
      pointer-events: none;
    }

    .filter-tabs {
      display: inline-flex;
      background: #0b0f19;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.2rem;
      gap: 0.2rem;
    }
    .filter-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.8125rem;
      font-weight: 500;
      padding: 0.35rem 0.75rem;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .filter-btn.active {
      background: #1f2937;
      color: var(--text);
      font-weight: 600;
    }

    /* Users Table Container */
    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.875rem;
    }
    thead th {
      background: #0e1422;
      color: var(--text-muted);
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 0.75rem 1.25rem;
      border-bottom: 1px solid var(--border);
    }
    tbody tr {
      border-bottom: 1px solid var(--border);
      transition: background 0.1s ease;
    }
    tbody tr:last-child {
      border-bottom: none;
    }
    tbody tr:hover {
      background: var(--card-hover);
    }
    td {
      padding: 1rem 1.25rem;
      vertical-align: middle;
    }

    .user-meta-cell {
      display: flex;
      align-items: center;
      gap: 0.875rem;
    }
    .user-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 0.875rem;
      color: #ffffff;
      flex-shrink: 0;
    }
    .user-info {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    .user-name {
      font-weight: 600;
      color: var(--text);
    }
    .user-username {
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .user-email {
      color: #93c5fd;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.8125rem;
    }
    .user-date {
      color: var(--text-muted);
      font-size: 0.8125rem;
      white-space: nowrap;
    }

    /* Access Badge */
    .access-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.2rem 0.55rem;
      border-radius: 9999px;
      text-transform: capitalize;
    }
    .access-badge.beta {
      background: var(--badge-beta-bg);
      color: var(--badge-beta-text);
      border: 1px solid var(--badge-beta-border);
    }
    .access-badge.paid {
      background: var(--badge-paid-bg);
      color: var(--badge-paid-text);
      border: 1px solid var(--badge-paid-border);
    }
    .access-badge.blocked {
      background: var(--badge-blocked-bg);
      color: var(--badge-blocked-text);
      border: 1px solid var(--badge-blocked-border);
    }

    /* Access Action Buttons */
    .access-actions-group {
      display: inline-flex;
      background: #0b0f19;
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 2px;
      gap: 2px;
    }
    .access-btn {
      border: none;
      background: none;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--text-muted);
      padding: 0.3rem 0.6rem;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .access-btn:hover:not(.active):not(:disabled) {
      color: var(--text);
      background: #1f2937;
    }
    .access-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .access-btn.active.blocked {
      background: #e11d48;
      color: #ffffff;
      font-weight: 600;
    }
    .access-btn.active.beta {
      background: #0284c7;
      color: #ffffff;
      font-weight: 600;
    }
    .access-btn.active.paid {
      background: #059669;
      color: #ffffff;
      font-weight: 600;
    }

    .empty-state {
      padding: 3rem 1.5rem;
      text-align: center;
      color: var(--text-muted);
    }

    /* Toast Notification */
    #toast-container {
      position: fixed;
      bottom: 1.5rem;
      right: 1.5rem;
      z-index: 100;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .toast {
      background: #1f2937;
      color: var(--text);
      border: 1px solid var(--border-subtle);
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-size: 0.875rem;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      animation: slideUp 0.2s ease-out;
    }
    .toast.success {
      border-color: #059669;
      background: #064e3b;
    }
    .toast.error {
      border-color: #e11d48;
      background: #881337;
    }
    @keyframes slideUp {
      from { transform: translateY(12px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    @media (max-width: 768px) {
      .controls-bar {
        flex-direction: column;
        align-items: stretch;
      }
      .search-wrapper {
        max-width: 100%;
      }
      .filter-tabs {
        width: 100%;
        justify-content: space-around;
      }
      table, thead, tbody, th, td, tr {
        display: block;
      }
      thead {
        display: none;
      }
      tbody tr {
        padding: 1rem;
        margin-bottom: 0.75rem;
        background: #131b2e;
        border-radius: 8px;
      }
      td {
        padding: 0.5rem 0;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand-section">
      <div class="brand-title">JaMeet <span class="brand-tag">Admin</span></div>
    </div>
    <div class="header-actions">
      <button class="btn-secondary" id="btn-refresh" title="Refresh user list">
        <span>↻</span> Refresh
      </button>
      <form method="POST" action="/admin/logout" style="display:inline;" id="admin-logout-form">
        <button type="submit" class="btn-secondary btn-logout" id="btn-logout" title="Sign out of admin panel">
          Sign Out
        </button>
      </form>
    </div>
  </header>

  <main>
    <!-- Stats Cards -->
    <div class="stats-grid">
      <div class="stat-card">
        <span class="stat-label">Total Accounts</span>
        <span class="stat-value" id="stat-total">0</span>
      </div>
      <div class="stat-card" style="border-left: 3px solid #0284c7;">
        <span class="stat-label" style="color: #7dd3fc;">Beta Access</span>
        <span class="stat-value" id="stat-beta" style="color: #38bdf8;">0</span>
      </div>
      <div class="stat-card" style="border-left: 3px solid #059669;">
        <span class="stat-label" style="color: #6ee7b7;">Paid Access</span>
        <span class="stat-value" id="stat-paid" style="color: #34d399;">0</span>
      </div>
      <div class="stat-card" style="border-left: 3px solid #e11d48;">
        <span class="stat-label" style="color: #fda4af;">Blocked</span>
        <span class="stat-value" id="stat-blocked" style="color: #f43f5e;">0</span>
      </div>
    </div>

    <!-- Controls Bar -->
    <div class="controls-bar">
      <div class="search-wrapper">
        <span class="search-icon">🔍</span>
        <input type="text" class="search-input" id="search-input" placeholder="Search by name, @username, or email...">
      </div>

      <div class="filter-tabs" role="tablist">
        <button class="filter-btn active" data-filter="all" id="filter-all">All</button>
        <button class="filter-btn" data-filter="beta" id="filter-beta">Beta</button>
        <button class="filter-btn" data-filter="paid" id="filter-paid">Paid</button>
        <button class="filter-btn" data-filter="blocked" id="filter-blocked">Blocked</button>
      </div>
    </div>

    <!-- Users Table -->
    <div class="table-container">
      <table id="users-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Email</th>
            <th>Registered</th>
            <th>Sessions</th>
            <th>Access State</th>
            <th style="text-align: right;">Manage Entitlement</th>
          </tr>
        </thead>
        <tbody id="users-tbody">
          <tr>
            <td colspan="6" class="empty-state">Loading registered accounts...</td>
          </tr>
        </tbody>
      </table>
    </div>
  </main>

  <div id="toast-container" aria-live="polite"></div>

  <script>
    let allUsers = [];
    let currentFilter = 'all';
    let searchQuery = '';

    function showToast(message, type = 'info') {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = \`toast \${type}\`;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }

    function formatDate(ts) {
      if (!ts) return 'Unknown';
      const d = new Date(ts);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' +
             d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    function updateStats() {
      const total = allUsers.length;
      let beta = 0, paid = 0, blocked = 0;
      for (const u of allUsers) {
        if (u.sessionAccess === 'beta') beta++;
        else if (u.sessionAccess === 'paid') paid++;
        else if (u.sessionAccess === 'blocked') blocked++;
      }
      document.getElementById('stat-total').textContent = total;
      document.getElementById('stat-beta').textContent = beta;
      document.getElementById('stat-paid').textContent = paid;
      document.getElementById('stat-blocked').textContent = blocked;
    }

    function renderTable() {
      const tbody = document.getElementById('users-tbody');
      tbody.innerHTML = '';

      const query = searchQuery.trim().toLowerCase();
      const filtered = allUsers.filter(u => {
        const matchesFilter = (currentFilter === 'all' || u.sessionAccess === currentFilter);
        if (!matchesFilter) return false;
        if (!query) return true;
        return (
          (u.displayName && u.displayName.toLowerCase().includes(query)) ||
          (u.username && u.username.toLowerCase().includes(query)) ||
          (u.email && u.email.toLowerCase().includes(query))
        );
      });

      if (filtered.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 6;
        td.className = 'empty-state';
        td.textContent = query ? 'No accounts matched your search criteria.' : 'No registered users found.';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      for (const user of filtered) {
        const tr = document.createElement('tr');
        tr.id = \`user-row-\${user.id}\`;

        // 1. User cell
        const tdUser = document.createElement('td');
        const userMeta = document.createElement('div');
        userMeta.className = 'user-meta-cell';

        const avatar = document.createElement('div');
        avatar.className = 'user-avatar';
        avatar.style.backgroundColor = user.avatarColor || '#3b82f6';
        avatar.textContent = (user.displayName || user.username || 'U').charAt(0).toUpperCase();

        const info = document.createElement('div');
        info.className = 'user-info';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'user-name';
        nameSpan.textContent = user.displayName || user.username;

        const usernameSpan = document.createElement('span');
        usernameSpan.className = 'user-username';
        usernameSpan.textContent = \`@\${user.username}\`;

        info.appendChild(nameSpan);
        info.appendChild(usernameSpan);
        userMeta.appendChild(avatar);
        userMeta.appendChild(info);
        tdUser.appendChild(userMeta);

        // 2. Email cell
        const tdEmail = document.createElement('td');
        const emailSpan = document.createElement('span');
        emailSpan.className = 'user-email';
        emailSpan.textContent = user.email;
        tdEmail.appendChild(emailSpan);

        // 3. Date cell
        const tdDate = document.createElement('td');
        tdDate.className = 'user-date';
        tdDate.textContent = formatDate(user.createdAt);

        // 4. Sessions cell
        const tdSessions = document.createElement('td');
        tdSessions.style.color = '#cbd5e1';
        tdSessions.textContent = user.sessionsHostedCount || 0;

        // 5. Current Access Badge
        const tdBadge = document.createElement('td');
        const badge = document.createElement('span');
        const access = user.sessionAccess || 'blocked';
        badge.className = \`access-badge \${access}\`;
        badge.id = \`badge-\${user.id}\`;
        badge.textContent = access;
        tdBadge.appendChild(badge);

        // 6. Action Buttons Group
        const tdActions = document.createElement('td');
        tdActions.style.textAlign = 'right';
        const actionsGroup = document.createElement('div');
        actionsGroup.className = 'access-actions-group';

        const states = ['blocked', 'beta', 'paid'];
        for (const state of states) {
          const btn = document.createElement('button');
          btn.className = \`access-btn \${state} \${access === state ? 'active' : ''}\`;
          btn.textContent = state.charAt(0).toUpperCase() + state.slice(1);
          btn.id = \`btn-\${user.id}-\${state}\`;

          btn.addEventListener('click', () => changeUserAccess(user.id, user.username, state, btn));
          actionsGroup.appendChild(btn);
        }

        tdActions.appendChild(actionsGroup);

        tr.appendChild(tdUser);
        tr.appendChild(tdEmail);
        tr.appendChild(tdDate);
        tr.appendChild(tdSessions);
        tr.appendChild(tdBadge);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
      }
    }

    async function fetchUsers() {
      try {
        const res = await fetch('/admin/api/users', {
          headers: { 'Accept': 'application/json', 'X-Admin-Action': '1' }
        });
        if (res.status === 401 || res.status === 403) {
          window.location.reload();
          return;
        }
        const data = await res.json();
        if (data.ok && Array.isArray(data.users)) {
          allUsers = data.users;
          updateStats();
          renderTable();
        } else {
          showToast(data.message || 'Failed to load users', 'error');
        }
      } catch (err) {
        showToast('Network error loading users', 'error');
      }
    }

    async function changeUserAccess(userId, username, newAccess, clickedBtn) {
      const row = document.getElementById(\`user-row-\${userId}\`);
      const buttons = row ? row.querySelectorAll('.access-btn') : [];
      buttons.forEach(b => b.disabled = true);

      try {
        const res = await fetch(\`/admin/api/users/\${encodeURIComponent(userId)}/access\`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Admin-Action': '1'
          },
          body: JSON.stringify({ access: newAccess })
        });

        const data = await res.json();
        if (res.ok && data.ok) {
          // Update local state
          const target = allUsers.find(u => u.id === userId);
          if (target) {
            target.sessionAccess = newAccess;
          }
          updateStats();
          renderTable();
          showToast(\`Updated @\${username} access to \${newAccess.toUpperCase()}\`, 'success');
        } else {
          showToast(data.message || 'Failed to update user access', 'error');
        }
      } catch (err) {
        showToast('Network error while updating access', 'error');
      } finally {
        buttons.forEach(b => b.disabled = false);
      }
    }

    // Search filter event listener
    document.getElementById('search-input').addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderTable();
    });

    // Tab filter event listeners
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        renderTable();
      });
    });

    // Refresh button
    document.getElementById('btn-refresh').addEventListener('click', () => {
      fetchUsers();
      showToast('Refreshed user list', 'info');
    });

    // Initial load
    fetchUsers();
  </script>
</body>
</html>`;
}

export function registerAdminPanel(app: FastifyInstance, userStore: UserStore, config: ServerConfig): void {
  // Ensure application/x-www-form-urlencoded parsing is supported for native form POSTs
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
      try {
        const parsed = Object.fromEntries(new URLSearchParams(body as string));
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    });
  }

  // 1. GET /admin - Main Web Interface
  app.get('/admin', async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: 'Not Found' });
    }

    const isAuthenticated = isRequestAdminAuthenticated(request, config);
    if (!isAuthenticated) {
      const errorQuery = (request.query as any)?.error;
      let errorMsg: string | undefined;
      if (errorQuery === 'invalid_secret') {
        errorMsg = 'Incorrect admin secret provided. Please try again.';
      } else if (errorQuery === 'rate_limited') {
        errorMsg = 'Too many failed login attempts. Please wait 1 minute.';
      }
      return reply.type('text/html; charset=utf-8').send(renderLoginPage(errorMsg));
    }

    return reply.type('text/html; charset=utf-8').send(renderAdminDashboard());
  });

  // 2. POST /admin/login - Browser Form & JSON Login
  app.post('/admin/login', async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: 'Not Found' });
    }

    if (!validateSameOrigin(request, config)) {
      return reply.code(403).send({ ok: false, message: 'Forbidden: invalid origin or cross-site request.' });
    }

    const ip = getClientIp(request);
    if (!checkRateLimit(ip)) {
      const isJson = request.headers.accept?.includes('application/json');
      if (isJson) {
        return reply.code(429).send({ ok: false, message: 'Too many failed login attempts. Please wait 1 minute.' });
      }
      return reply.code(303).redirect('/admin?error=rate_limited');
    }

    const body = request.body as any;
    const submittedSecret = typeof body === 'object' && body ? (body.secret || '') : '';

    const isValid = verifyAdminSecret(submittedSecret, adminSecret);
    const isJson = request.headers.accept?.includes('application/json');
    const isHttps = request.headers['x-forwarded-proto'] === 'https' || Boolean((request.raw.socket as any)?.encrypted);

    if (!isValid) {
      recordFailedLogin(ip);
      if (isJson) {
        return reply.code(401).send({ ok: false, message: 'Invalid admin secret.' });
      }
      return reply.code(303).redirect('/admin?error=invalid_secret');
    }

    clearFailedLogin(ip);
    const sessionToken = createAdminSessionToken(adminSecret);
    const cookieHeader = buildAdminCookie(sessionToken, ADMIN_SESSION_MAX_AGE_SEC, config.NODE_ENV === 'production', Boolean(isHttps));
    reply.header('Set-Cookie', cookieHeader);

    if (isJson) {
      return reply.send({ ok: true });
    }
    return reply.code(303).redirect('/admin');
  });

  // 3. POST /admin/logout - Browser & API Logout (POST only)
  app.post('/admin/logout', async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: 'Not Found' });
    }

    if (!validateSameOrigin(request, config)) {
      return reply.code(403).send({ ok: false, message: 'Forbidden: invalid origin or cross-site request.' });
    }

    const isHttps = request.headers['x-forwarded-proto'] === 'https' || Boolean((request.raw.socket as any)?.encrypted);
    const clearCookie = buildClearAdminCookie(config.NODE_ENV === 'production', Boolean(isHttps));
    reply.header('Set-Cookie', clearCookie);

    const isJson = request.headers.accept?.includes('application/json');
    if (isJson) {
      return reply.send({ ok: true });
    }
    return reply.code(303).redirect('/admin');
  });

  // 4. GET /admin/api/users - Sanitized User List
  app.get('/admin/api/users', async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: 'Not Found' });
    }

    if (!isRequestAdminAuthenticated(request, config)) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized' });
    }

    const users = userStore.listAdminUsers();
    return reply.send({ ok: true, users });
  });

  // 5. POST /admin/api/users/:userId/access - Modify User Session Access
  app.post('/admin/api/users/:userId/access', async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: 'Not Found' });
    }

    if (!validateSameOrigin(request, config)) {
      return reply.code(403).send({ ok: false, message: 'Forbidden: invalid origin or cross-site request.' });
    }

    if (!isRequestAdminAuthenticated(request, config)) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized' });
    }

    const { userId } = request.params as { userId: string };
    const body = (request.body || {}) as any;
    const newAccess = typeof body === 'object' && body ? body.access : undefined;

    if (!newAccess || typeof newAccess !== 'string') {
      return reply.code(400).send({ ok: false, message: 'Missing target access state.' });
    }

    const normalizedAccess = newAccess.trim().toLowerCase() as SessionAccessState;
    if (!ALLOWED_SESSION_ACCESS_STATES.includes(normalizedAccess)) {
      return reply.code(400).send({
        ok: false,
        message: `Invalid sessionAccess: "${newAccess}". Allowed values: ${ALLOWED_SESSION_ACCESS_STATES.join(', ')}.`
      });
    }

    const profile = userStore.getStoredUser(userId) || (userStore.findByUsernameOrEmail(userId) ? userStore.getStoredUser(userStore.findByUsernameOrEmail(userId)!.id) : null);
    if (!profile) {
      return reply.code(404).send({ ok: false, message: `Account not found for identifier: "${userId}".` });
    }

    const previousAccess = profile.sessionAccess ?? 'blocked';
    userStore.setSessionAccess(profile.id, normalizedAccess);

    return reply.send({
      ok: true,
      user: {
        userId: profile.id,
        username: profile.username,
        email: profile.email,
        previousAccess,
        newAccess: normalizedAccess
      }
    });
  });
}
