import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerConfig } from './config.js';
import { UserStore, type SessionAccessState, type AdminUserSummary, type AdminUserDetail } from './auth.js';
import { ALLOWED_SESSION_ACCESS_STATES } from './admin-access.js';
import { getClientIp } from './client-ip.js';

export const ADMIN_SESSION_COOKIE_NAME = 'jameet_admin_session';
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const ADMIN_SESSION_MAX_AGE_SEC = 12 * 60 * 60; // 43200 seconds

// In-memory rate limiting for login attempts
const failedLoginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILED_ATTEMPTS = 5;
const FAILED_ATTEMPTS_WINDOW_MS = 60 * 1000; // 1 minute

export interface AdminRuntimeContext {
  getOnlineUserIds?: () => Set<string>;
  isUserOnline?: (userId: string) => boolean;
  getActiveRoomsCount?: () => number;
  getUptimeSeconds?: () => number;
}

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
  if (expBuf.length !== recBuf.length) return false;

  return crypto.timingSafeEqual(expBuf, recBuf);
}

export function isRequestAdminAuthenticated(request: FastifyRequest, config: ServerConfig): boolean {
  const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
  if (!adminSecret) return false;
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[ADMIN_SESSION_COOKIE_NAME];
  return verifyAdminSessionToken(token, adminSecret);
}

export function validateSameOrigin(request: FastifyRequest, config: ServerConfig): boolean {
  const secFetchSite = request.headers['sec-fetch-site'];
  if (secFetchSite === 'cross-site') {
    return false;
  }

  const origin = request.headers.origin;
  const referer = request.headers.referer;
  const host = request.headers.host;

  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      if (host && (parsedOrigin.host === host || parsedOrigin.hostname === host.split(':')[0])) {
        return true;
      }
      if (parsedOrigin.hostname === 'localhost' || parsedOrigin.hostname === '127.0.0.1') {
        return true;
      }
      if (config.ALLOWED_ORIGINS) {
        const allowed = config.ALLOWED_ORIGINS.split(',').map((v) => v.trim()).filter(Boolean);
        if (allowed.includes(origin) || allowed.includes('*')) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  if (referer) {
    try {
      const parsedReferer = new URL(referer);
      if (host && (parsedReferer.host === host || parsedReferer.hostname === host.split(':')[0])) {
        return true;
      }
      if (parsedReferer.hostname === 'localhost' || parsedReferer.hostname === '127.0.0.1') {
        return true;
      }
      if (config.ALLOWED_ORIGINS) {
        const allowed = config.ALLOWED_ORIGINS.split(',').map((v) => v.trim()).filter(Boolean);
        if (allowed.includes(parsedReferer.origin) || allowed.includes('*')) {
          return true;
        }
      }
    } catch {
      return false;
    }
  }

  return true;
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const attempt = failedLoginAttempts.get(ip);
  if (!attempt) return true;
  if (now > attempt.resetAt) {
    failedLoginAttempts.delete(ip);
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
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --border: #e2e8f0;
      --text: #0f172a;
      --text-muted: #64748b;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --danger-bg: #fef2f2;
      --danger-text: #b91c1c;
      --danger-border: #fecaca;
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
      max-width: 380px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 2rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .logo-header {
      font-size: 0.8125rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--primary);
      margin-bottom: 0.5rem;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.01em;
      margin-bottom: 0.35rem;
    }
    p.subtitle {
      font-size: 0.8125rem;
      color: var(--text-muted);
      margin-bottom: 1.5rem;
      line-height: 1.4;
    }
    .error-alert {
      background: var(--danger-bg);
      color: var(--danger-text);
      border: 1px solid var(--danger-border);
      padding: 0.625rem 0.875rem;
      border-radius: 4px;
      font-size: 0.8125rem;
      margin-bottom: 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .form-group {
      margin-bottom: 1.25rem;
    }
    label {
      display: block;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--text);
      margin-bottom: 0.35rem;
    }
    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    input[type="password"],
    input[type="text"] {
      width: 100%;
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      font-size: 0.875rem;
      padding: 0.5rem 0.75rem;
      padding-right: 3.5rem;
      outline: none;
    }
    input[type="password"]:focus,
    input[type="text"]:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 1px var(--primary);
    }
    .toggle-visibility {
      position: absolute;
      right: 0.5rem;
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.75rem;
      cursor: pointer;
      padding: 0.2rem 0.4rem;
    }
    button[type="submit"] {
      width: 100%;
      background: var(--primary);
      color: #ffffff;
      border: none;
      border-radius: 4px;
      padding: 0.55rem 0.75rem;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
    }
    button[type="submit"]:hover {
      background: var(--primary-hover);
    }
    .footer-note {
      text-align: center;
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 1.25rem;
    }
  </style>
</head>
<body>
  <div class="login-container" id="admin-login-card">
    <div class="logo-header">JaMeet Server Admin</div>
    <h1>Authentication Required</h1>
    <p class="subtitle">Enter administrator secret to access user management.</p>

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

    <div class="footer-note">Server authenticated session • 12-hour expiration</div>
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
  <title>JaMeet Admin</title>
  <style>
    :root {
      --bg: #ffffff;
      --text: #111827;
      --text-muted: #4b5563;
      --text-subtle: #6b7280;
      --border: #e5e7eb;
      --border-dark: #d1d5db;
      --hover-bg: #f9fafb;
      --selected-bg: #eff6ff;
      --selected-border: #bfdbfe;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --btn-bg: #ffffff;
      --btn-border: #d1d5db;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      font-size: 13px;
      line-height: 1.4;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    
    /* Top Header */
    header {
      border-bottom: 1px solid var(--border);
      padding: 0.5rem 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      background: #ffffff;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .app-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--text);
      letter-spacing: -0.01em;
    }
    .summary-counts {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      color: var(--text-muted);
      font-size: 12px;
    }
    .summary-item strong {
      color: var(--text);
      font-weight: 600;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    /* Common Buttons & Inputs */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--btn-bg);
      border: 1px solid var(--btn-border);
      color: var(--text);
      padding: 0.3rem 0.6rem;
      font-size: 12px;
      font-weight: 500;
      border-radius: 3px;
      cursor: pointer;
      text-decoration: none;
      white-space: nowrap;
      user-select: none;
    }
    .btn:hover {
      background: #f3f4f6;
      border-color: #9ca3af;
    }
    .btn:active {
      background: #e5e7eb;
    }
    .btn-primary {
      background: var(--primary);
      border-color: var(--primary);
      color: #ffffff;
    }
    .btn-primary:hover {
      background: var(--primary-hover);
      border-color: var(--primary-hover);
    }
    .btn-subtle {
      background: transparent;
      border-color: transparent;
      color: var(--text-muted);
    }
    .btn-subtle:hover {
      background: #f3f4f6;
      border-color: var(--border);
      color: var(--text);
    }

    /* Controls & Filter Bar */
    .toolbar {
      padding: 0.5rem 1rem;
      border-bottom: 1px solid var(--border);
      background: #fafafa;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .toolbar-left {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex: 1;
      max-width: 600px;
    }
    .toolbar-right {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .search-input {
      width: 100%;
      max-width: 280px;
      padding: 0.3rem 0.5rem;
      font-size: 12px;
      border: 1px solid var(--btn-border);
      border-radius: 3px;
      background: #ffffff;
      outline: none;
    }
    .search-input:focus {
      border-color: var(--primary);
    }
    .select-filter {
      padding: 0.3rem 0.4rem;
      font-size: 12px;
      border: 1px solid var(--btn-border);
      border-radius: 3px;
      background: #ffffff;
      color: var(--text);
      outline: none;
    }
    .select-filter:focus {
      border-color: var(--primary);
    }

    /* Bulk Actions Bar */
    .bulk-bar {
      display: none;
      align-items: center;
      justify-content: space-between;
      padding: 0.4rem 1rem;
      background: #f0f7ff;
      border-bottom: 1px solid #bfdbfe;
      font-size: 12px;
      gap: 0.75rem;
    }
    .bulk-bar.active {
      display: flex;
    }
    .bulk-count {
      font-weight: 600;
      color: #1e40af;
    }
    .bulk-actions {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    /* Spreadsheet Table */
    .table-container {
      flex: 1;
      overflow: auto;
      background: #ffffff;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 12px;
    }
    th {
      background: #f8fafc;
      color: var(--text-muted);
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      border-bottom: 1px solid var(--border-dark);
      border-right: 1px solid var(--border);
      padding: 0.4rem 0.6rem;
      position: sticky;
      top: 0;
      z-index: 10;
      user-select: none;
    }
    th:last-child {
      border-right: none;
    }
    td {
      border-bottom: 1px solid var(--border);
      border-right: 1px solid var(--border);
      padding: 0.35rem 0.6rem;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    td:last-child {
      border-right: none;
    }
    tr:hover td {
      background: var(--hover-bg);
    }
    tr.selected td {
      background: var(--selected-bg);
      border-bottom-color: var(--selected-border);
    }
    .col-checkbox {
      width: 32px;
      text-align: center;
      padding: 0.35rem 0.25rem;
    }
    .col-checkbox input {
      cursor: pointer;
    }
    .cell-clickable {
      cursor: pointer;
      font-weight: 500;
      color: var(--primary);
    }
    .cell-clickable:hover {
      text-decoration: underline;
    }
    .text-mono {
      font-family: var(--font-mono);
      font-size: 11.5px;
    }
    .status-online {
      color: #16a34a;
      font-weight: 500;
    }
    .status-offline {
      color: var(--text-subtle);
    }
    .access-tag {
      font-weight: 500;
      text-transform: capitalize;
    }
    .access-tag.blocked { color: #dc2626; }
    .access-tag.beta { color: #0284c7; }
    .access-tag.paid { color: #16a34a; }
    .expiry-note {
      color: var(--text-subtle);
      font-size: 11px;
      margin-left: 0.3rem;
    }
    .empty-state {
      padding: 3rem 1rem;
      text-align: center;
      color: var(--text-muted);
    }

    /* Modal / Inspector Dialog */
    .modal-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: 100;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .modal-backdrop.open {
      display: flex;
    }
    .modal-card {
      background: #ffffff;
      border: 1px solid var(--border-dark);
      border-radius: 4px;
      width: 100%;
      max-width: 640px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    .modal-header {
      padding: 0.6rem 1rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #fafafa;
    }
    .modal-title {
      font-size: 13px;
      font-weight: 600;
    }
    .modal-body {
      padding: 1rem;
      overflow-y: auto;
      font-size: 12px;
    }
    .prop-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1.25rem;
    }
    .prop-table td {
      padding: 0.4rem 0.5rem;
      border: 1px solid var(--border);
      white-space: normal;
    }
    .prop-label {
      width: 140px;
      background: #f8fafc;
      font-weight: 500;
      color: var(--text-muted);
    }
    .activity-section-title {
      font-weight: 600;
      font-size: 12px;
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--text-muted);
    }
    .activity-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11.5px;
    }
    .activity-table th,
    .activity-table td {
      border: 1px solid var(--border);
      padding: 0.3rem 0.4rem;
    }
    .activity-table th {
      background: #f8fafc;
      color: var(--text-muted);
    }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 1rem;
      right: 1rem;
      background: #1f2937;
      color: #ffffff;
      font-size: 12px;
      padding: 0.5rem 0.75rem;
      border-radius: 3px;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.2s ease;
      z-index: 200;
      pointer-events: none;
    }
    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }
    .toast.success { background: #15803d; }
    .toast.error { background: #b91c1c; }
  </style>
</head>
<body>
  <!-- Header -->
  <header>
    <div class="header-left">
      <div class="app-title">JaMeet Admin</div>
      <div class="summary-counts">
        <span class="summary-item">Total: <strong id="sum-total">0</strong></span>
        <span>•</span>
        <span class="summary-item">Beta: <strong id="sum-beta">0</strong></span>
        <span>•</span>
        <span class="summary-item">Paid: <strong id="sum-paid">0</strong></span>
        <span>•</span>
        <span class="summary-item">Blocked: <strong id="sum-blocked">0</strong></span>
        <span>•</span>
        <span class="summary-item">Online: <strong id="sum-online">0</strong></span>
      </div>
    </div>
    <div class="header-right">
      <form method="POST" action="/admin/logout" style="margin:0;">
        <button type="submit" class="btn btn-subtle" id="btn-logout">Log out</button>
      </form>
    </div>
  </header>

  <!-- Toolbar -->
  <div class="toolbar">
    <div class="toolbar-left">
      <input type="text" id="search-input" class="search-input" placeholder="Search name, username, email..." autocomplete="off" />
      <select id="access-filter" class="select-filter">
        <option value="all">All Access</option>
        <option value="beta">Beta</option>
        <option value="paid">Paid</option>
        <option value="blocked">Blocked</option>
      </select>
      <select id="status-filter" class="select-filter">
        <option value="all">All Status</option>
        <option value="online">Online</option>
        <option value="offline">Offline</option>
      </select>
    </div>
    <div class="toolbar-right">
      <button type="button" class="btn" id="btn-export-csv">Export CSV</button>
      <button type="button" class="btn" id="btn-refresh">Refresh</button>
    </div>
  </div>

  <!-- Bulk Action Bar -->
  <div class="bulk-bar" id="bulk-bar">
    <div class="bulk-count" id="bulk-count">0 users selected</div>
    <div class="bulk-actions">
      <button type="button" class="btn btn-sm" id="bulk-set-beta">Set Beta</button>
      <button type="button" class="btn btn-sm" id="bulk-set-paid">Set Paid</button>
      <button type="button" class="btn btn-sm" id="bulk-set-blocked">Set Blocked</button>
      <button type="button" class="btn btn-sm" id="bulk-set-expiry">Set Beta Expiration</button>
      <button type="button" class="btn btn-sm btn-subtle" id="bulk-clear">Clear</button>
    </div>
  </div>

  <!-- Primary User Table -->
  <div class="table-container">
    <table id="users-table">
      <thead>
        <tr>
          <th class="col-checkbox"><input type="checkbox" id="select-all-checkbox" aria-label="Select all visible users" /></th>
          <th>Name</th>
          <th>Email</th>
          <th>Username</th>
          <th>Access</th>
          <th>Joined</th>
          <th>Last Active</th>
          <th>Platform</th>
          <th>Version</th>
          <th style="text-align:right;">Sessions</th>
        </tr>
      </thead>
      <tbody id="users-tbody">
        <tr><td colspan="10" class="empty-state">Loading users...</td></tr>
      </tbody>
    </table>
  </div>

  <!-- User Detail Modal -->
  <div class="modal-backdrop" id="user-detail-modal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title" id="modal-title">User Details</div>
        <button type="button" class="btn btn-subtle" id="modal-close-btn">✕</button>
      </div>
      <div class="modal-body">
        <table class="prop-table">
          <tr>
            <td class="prop-label">User ID</td>
            <td class="text-mono" id="modal-id">-</td>
          </tr>
          <tr>
            <td class="prop-label">Display Name</td>
            <td id="modal-display-name">-</td>
          </tr>
          <tr>
            <td class="prop-label">Username</td>
            <td class="text-mono" id="modal-username">-</td>
          </tr>
          <tr>
            <td class="prop-label">Email</td>
            <td id="modal-email">-</td>
          </tr>
          <tr>
            <td class="prop-label">Access State</td>
            <td>
              <div style="display:flex; align-items:center; gap:0.5rem;">
                <select id="modal-access-select" class="select-filter">
                  <option value="blocked">Blocked</option>
                  <option value="beta">Beta</option>
                  <option value="paid">Paid</option>
                </select>
                <button type="button" class="btn" id="modal-update-access-btn">Save Access</button>
              </div>
            </td>
          </tr>
          <tr>
            <td class="prop-label">Beta Expiration</td>
            <td>
              <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
                <input type="date" id="modal-expiry-input" class="search-input" style="max-width:140px;" />
                <button type="button" class="btn" id="modal-set-expiry-btn">Set Date</button>
                <button type="button" class="btn btn-subtle" id="modal-clear-expiry-btn">Clear Expiration</button>
                <span id="modal-expiry-status" style="font-size:11.5px; color:var(--text-subtle);"></span>
              </div>
            </td>
          </tr>
          <tr>
            <td class="prop-label">Presence</td>
            <td id="modal-presence">-</td>
          </tr>
          <tr>
            <td class="prop-label">Client Info</td>
            <td id="modal-client">-</td>
          </tr>
          <tr>
            <td class="prop-label">Last Active</td>
            <td id="modal-last-active">-</td>
          </tr>
          <tr>
            <td class="prop-label">Last Login</td>
            <td id="modal-last-login">-</td>
          </tr>
          <tr>
            <td class="prop-label">Sessions Hosted</td>
            <td id="modal-hosted-count">-</td>
          </tr>
          <tr>
            <td class="prop-label">Joined</td>
            <td id="modal-created-at">-</td>
          </tr>
        </table>

        <div class="activity-section-title">Operational Activity History</div>
        <table class="activity-table">
          <thead>
            <tr>
              <th style="width:130px;">Time</th>
              <th style="width:90px;">Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody id="modal-activity-tbody">
            <tr><td colspan="3" style="text-align:center; color:var(--text-muted);">No activity recorded</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    let allUsers = [];
    let selectedUserIds = new Set();
    let lastClickedIndex = -1;
    let selectedUserId = null;

    function showToast(msg, type = 'info') {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'toast show ' + type;
      setTimeout(() => { el.className = 'toast'; }, 2500);
    }

    function getFilteredUsers() {
      const q = (document.getElementById('search-input').value || '').trim().toLowerCase();
      const access = document.getElementById('access-filter').value;
      const status = document.getElementById('status-filter').value;

      return allUsers.filter(u => {
        if (access !== 'all' && u.sessionAccess !== access) return false;
        if (status === 'online' && !u.isOnline) return false;
        if (status === 'offline' && u.isOnline) return false;
        if (!q) return true;
        const name = (u.displayName || '').toLowerCase();
        const username = (u.username || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        return name.includes(q) || username.includes(q) || email.includes(q);
      });
    }

    function updateSummaryCounts() {
      const total = allUsers.length;
      const beta = allUsers.filter(u => u.sessionAccess === 'beta').length;
      const paid = allUsers.filter(u => u.sessionAccess === 'paid').length;
      const blocked = allUsers.filter(u => u.sessionAccess === 'blocked').length;
      const online = allUsers.filter(u => u.isOnline).length;

      document.getElementById('sum-total').textContent = total;
      document.getElementById('sum-beta').textContent = beta;
      document.getElementById('sum-paid').textContent = paid;
      document.getElementById('sum-blocked').textContent = blocked;
      document.getElementById('sum-online').textContent = online;
    }

    function updateBulkActionBar() {
      const bar = document.getElementById('bulk-bar');
      const countEl = document.getElementById('bulk-count');
      const count = selectedUserIds.size;
      if (count > 0) {
        bar.classList.add('active');
        countEl.textContent = count + (count === 1 ? ' user selected' : ' users selected');
      } else {
        bar.classList.remove('active');
      }
    }

    function updateSelectAllCheckbox() {
      const selectAll = document.getElementById('select-all-checkbox');
      const visible = getFilteredUsers();
      if (visible.length === 0) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
        return;
      }
      const selectedCount = visible.filter(u => selectedUserIds.has(u.id)).length;
      if (selectedCount === 0) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      } else if (selectedCount === visible.length) {
        selectAll.checked = true;
        selectAll.indeterminate = false;
      } else {
        selectAll.checked = false;
        selectAll.indeterminate = true;
      }
    }

    function renderTable() {
      const tbody = document.getElementById('users-tbody');
      const visible = getFilteredUsers();

      if (visible.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No matching users found</td></tr>';
        updateSelectAllCheckbox();
        return;
      }

      tbody.innerHTML = '';
      visible.forEach((u, index) => {
        const tr = document.createElement('tr');
        const isSelected = selectedUserIds.has(u.id);
        if (isSelected) tr.classList.add('selected');

        // 1. Checkbox
        const tdCheck = document.createElement('td');
        tdCheck.className = 'col-checkbox';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isSelected;
        checkbox.setAttribute('aria-label', 'Select user ' + (u.displayName || u.username));
        checkbox.addEventListener('click', (e) => {
          e.stopPropagation();
          handleCheckboxClick(e, index, u.id);
        });
        tdCheck.appendChild(checkbox);

        // 2. Name
        const tdName = document.createElement('td');
        tdName.className = 'cell-clickable';
        tdName.textContent = u.displayName || u.username || '-';
        tdName.addEventListener('click', () => openUserDetail(u.id));

        // 3. Email
        const tdEmail = document.createElement('td');
        tdEmail.textContent = u.email || '-';

        // 4. Username
        const tdUsername = document.createElement('td');
        tdUsername.className = 'text-mono';
        tdUsername.textContent = u.username ? '@' + u.username : '-';

        // 5. Access
        const tdAccess = document.createElement('td');
        const accessSpan = document.createElement('span');
        accessSpan.className = 'access-tag ' + (u.sessionAccess || 'blocked');
        accessSpan.textContent = u.sessionAccess || 'blocked';
        tdAccess.appendChild(accessSpan);

        if (u.sessionAccess === 'beta' && u.betaExpiresAt) {
          const expSpan = document.createElement('span');
          expSpan.className = 'expiry-note';
          const isExpired = Date.now() >= u.betaExpiresAt;
          expSpan.textContent = isExpired ? '(Expired)' : '(' + new Date(u.betaExpiresAt).toLocaleDateString() + ')';
          tdAccess.appendChild(expSpan);
        }

        // 6. Joined
        const tdJoined = document.createElement('td');
        tdJoined.textContent = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '-';

        // 7. Last Active
        const tdActive = document.createElement('td');
        if (u.isOnline) {
          const onlineSpan = document.createElement('span');
          onlineSpan.className = 'status-online';
          onlineSpan.textContent = 'Online';
          tdActive.appendChild(onlineSpan);
        } else if (u.lastActiveAt) {
          const offlineSpan = document.createElement('span');
          offlineSpan.className = 'status-offline';
          offlineSpan.textContent = new Date(u.lastActiveAt).toLocaleDateString();
          tdActive.appendChild(offlineSpan);
        } else {
          tdActive.textContent = 'Never';
        }

        // 8. Platform
        const tdPlatform = document.createElement('td');
        tdPlatform.textContent = u.clientPlatform || 'Unknown';

        // 9. Version
        const tdVersion = document.createElement('td');
        tdVersion.textContent = (u.clientVersion && u.clientVersion !== 'Unknown') ? u.clientVersion : 'Unknown';

        // 10. Sessions
        const tdSessions = document.createElement('td');
        tdSessions.style.textAlign = 'right';
        tdSessions.textContent = (u.sessionsHostedCount || 0);

        tr.appendChild(tdCheck);
        tr.appendChild(tdName);
        tr.appendChild(tdEmail);
        tr.appendChild(tdUsername);
        tr.appendChild(tdAccess);
        tr.appendChild(tdJoined);
        tr.appendChild(tdActive);
        tr.appendChild(tdPlatform);
        tr.appendChild(tdVersion);
        tr.appendChild(tdSessions);

        tr.addEventListener('click', (e) => {
          if (e.target.tagName !== 'INPUT') {
            openUserDetail(u.id);
          }
        });

        tbody.appendChild(tr);
      });

      updateSelectAllCheckbox();
    }

    function handleCheckboxClick(e, index, userId) {
      const visible = getFilteredUsers();
      if (e.shiftKey && lastClickedIndex !== -1 && lastClickedIndex !== index) {
        const start = Math.min(lastClickedIndex, index);
        const end = Math.max(lastClickedIndex, index);
        const targetChecked = e.target.checked;

        for (let i = start; i <= end; i++) {
          const user = visible[i];
          if (user) {
            if (targetChecked) {
              selectedUserIds.add(user.id);
            } else {
              selectedUserIds.delete(user.id);
            }
          }
        }
        renderTable();
      } else {
        if (e.target.checked) {
          selectedUserIds.add(userId);
        } else {
          selectedUserIds.delete(userId);
        }
        lastClickedIndex = index;
        renderTable();
      }
      updateBulkActionBar();
    }

    // Select All Checkbox
    document.getElementById('select-all-checkbox').addEventListener('click', (e) => {
      const visible = getFilteredUsers();
      const targetChecked = e.target.checked;
      visible.forEach(u => {
        if (targetChecked) {
          selectedUserIds.add(u.id);
        } else {
          selectedUserIds.delete(u.id);
        }
      });
      renderTable();
      updateBulkActionBar();
    });

    // Clear Selection
    document.getElementById('bulk-clear').addEventListener('click', () => {
      selectedUserIds.clear();
      lastClickedIndex = -1;
      renderTable();
      updateBulkActionBar();
    });

    // Bulk Access Operations
    async function bulkSetAccess(access) {
      if (selectedUserIds.size === 0) return;
      const userIds = Array.from(selectedUserIds);
      try {
        const res = await fetch('/admin/api/users/bulk-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds, access })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || 'Bulk update failed');
        
        showToast('Updated ' + (data.updatedCount || userIds.length) + ' users to ' + access, 'success');
        await fetchUsers();
      } catch (err) {
        showToast(err.message || 'Bulk update failed', 'error');
      }
    }

    document.getElementById('bulk-set-beta').addEventListener('click', () => bulkSetAccess('beta'));
    document.getElementById('bulk-set-paid').addEventListener('click', () => bulkSetAccess('paid'));
    document.getElementById('bulk-set-blocked').addEventListener('click', () => bulkSetAccess('blocked'));

    document.getElementById('bulk-set-expiry').addEventListener('click', async () => {
      if (selectedUserIds.size === 0) return;
      const input = prompt('Enter Beta Expiration Date (YYYY-MM-DD) or leave blank to clear expiration:');
      if (input === null) return;

      let timestamp = null;
      if (input.trim()) {
        const parsed = new Date(input.trim());
        if (isNaN(parsed.getTime())) {
          showToast('Invalid date format. Use YYYY-MM-DD.', 'error');
          return;
        }
        parsed.setHours(23, 59, 59, 999);
        timestamp = parsed.getTime();
      }

      const userIds = Array.from(selectedUserIds);
      try {
        const res = await fetch('/admin/api/users/bulk-beta-expiry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds, betaExpiresAt: timestamp })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || 'Bulk expiration update failed');

        showToast('Updated beta expiration for ' + (data.updatedCount || userIds.length) + ' users', 'success');
        await fetchUsers();
      } catch (err) {
        showToast(err.message || 'Bulk expiration update failed', 'error');
      }
    });

    // CSV Export
    document.getElementById('btn-export-csv').addEventListener('click', () => {
      const visible = getFilteredUsers();
      if (visible.length === 0) {
        showToast('No users to export', 'error');
        return;
      }

      const escapeCSV = (val) => {
        if (val === null || val === undefined) return '""';
        const str = String(val);
        return '"' + str.replace(/"/g, '""') + '"';
      };

      const headers = [
        'Name',
        'Email',
        'Username',
        'Access',
        'Beta Expiration',
        'Joined',
        'Last Active',
        'Platform',
        'Version',
        'Sessions'
      ];

      const rows = visible.map(u => [
        escapeCSV(u.displayName || u.username || ''),
        escapeCSV(u.email || ''),
        escapeCSV(u.username || ''),
        escapeCSV(u.sessionAccess || 'blocked'),
        escapeCSV(u.betaExpiresAt ? new Date(u.betaExpiresAt).toISOString() : ''),
        escapeCSV(u.createdAt ? new Date(u.createdAt).toISOString() : ''),
        escapeCSV(u.isOnline ? 'Online' : (u.lastActiveAt ? new Date(u.lastActiveAt).toISOString() : 'Never')),
        escapeCSV(u.clientPlatform || 'Unknown'),
        escapeCSV(u.clientVersion || 'Unknown'),
        escapeCSV(u.sessionsHostedCount || 0)
      ]);

      const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\\r\\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      const dateStr = new Date().toISOString().split('T')[0];
      link.setAttribute('download', 'jameet-users-' + dateStr + '.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast('Exported ' + visible.length + ' users to CSV', 'success');
    });

    // Fetch User List
    async function fetchUsers() {
      try {
        const res = await fetch('/admin/api/users');
        if (res.status === 401) {
          window.location.reload();
          return;
        }
        const data = await res.json();
        if (data.ok && Array.isArray(data.users)) {
          allUsers = data.users;
          updateSummaryCounts();
          renderTable();
        }
      } catch (err) {
        showToast('Failed to load user list', 'error');
      }
    }

    // User Detail Inspector
    async function openUserDetail(userId) {
      selectedUserId = userId;
      const modal = document.getElementById('user-detail-modal');
      modal.classList.add('open');

      try {
        const res = await fetch('/admin/api/users/' + encodeURIComponent(userId));
        if (!res.ok) throw new Error('Failed to load user detail');
        const data = await res.json();
        if (data.ok && data.user) {
          populateModal(data.user);
        }
      } catch (err) {
        showToast('Failed to load user detail', 'error');
      }
    }

    function populateModal(u) {
      document.getElementById('modal-title').textContent = (u.displayName || u.username) + ' (@' + u.username + ')';
      document.getElementById('modal-id').textContent = u.id;
      document.getElementById('modal-display-name').textContent = u.displayName || u.username;
      document.getElementById('modal-username').textContent = '@' + u.username;
      document.getElementById('modal-email').textContent = u.email || '-';
      document.getElementById('modal-access-select').value = u.sessionAccess || 'blocked';
      document.getElementById('modal-presence').textContent = u.isOnline ? 'Online' : (u.lastActiveAt ? 'Offline (Last active ' + new Date(u.lastActiveAt).toLocaleString() + ')' : 'Offline');
      
      const clientStr = (u.clientPlatform || 'Unknown') + ' • JaMeet ' + (u.clientVersion || 'Unknown');
      document.getElementById('modal-client').textContent = clientStr;
      document.getElementById('modal-last-active').textContent = u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleString() : 'Never';
      document.getElementById('modal-last-login').textContent = u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never';
      document.getElementById('modal-hosted-count').textContent = (u.sessionsHostedCount || 0) + ' sessions';
      document.getElementById('modal-created-at').textContent = u.createdAt ? new Date(u.createdAt).toLocaleString() : '-';

      const expiryInput = document.getElementById('modal-expiry-input');
      const expiryStatus = document.getElementById('modal-expiry-status');
      if (u.betaExpiresAt) {
        const d = new Date(u.betaExpiresAt);
        expiryInput.value = d.toISOString().split('T')[0];
        const isPassed = Date.now() >= u.betaExpiresAt;
        expiryStatus.textContent = isPassed ? '(Expired)' : '(Expires ' + d.toLocaleDateString() + ')';
      } else {
        expiryInput.value = '';
        expiryStatus.textContent = '(No expiration set)';
      }

      // Activity Table
      const actTbody = document.getElementById('modal-activity-tbody');
      if (Array.isArray(u.activityHistory) && u.activityHistory.length > 0) {
        actTbody.innerHTML = '';
        u.activityHistory.forEach(act => {
          const tr = document.createElement('tr');
          const tdTime = document.createElement('td');
          tdTime.textContent = act.timestamp ? new Date(act.timestamp).toLocaleString() : '-';
          const tdType = document.createElement('td');
          tdType.className = 'text-mono';
          tdType.textContent = act.type || 'activity';
          const tdDesc = document.createElement('td');
          tdDesc.textContent = act.description || '-';
          tr.appendChild(tdTime);
          tr.appendChild(tdType);
          tr.appendChild(tdDesc);
          actTbody.appendChild(tr);
        });
      } else {
        actTbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">No activity recorded</td></tr>';
      }
    }

    // Modal Action Handlers
    document.getElementById('modal-close-btn').addEventListener('click', () => {
      document.getElementById('user-detail-modal').classList.remove('open');
      selectedUserId = null;
    });

    document.getElementById('user-detail-modal').addEventListener('click', (e) => {
      if (e.target.id === 'user-detail-modal') {
        document.getElementById('user-detail-modal').classList.remove('open');
        selectedUserId = null;
      }
    });

    document.getElementById('modal-update-access-btn').addEventListener('click', async () => {
      if (!selectedUserId) return;
      const newAccess = document.getElementById('modal-access-select').value;
      try {
        const res = await fetch('/admin/api/users/' + encodeURIComponent(selectedUserId) + '/access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access: newAccess })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || 'Access update failed');
        showToast('Updated access to ' + newAccess, 'success');
        await fetchUsers();
        if (selectedUserId) openUserDetail(selectedUserId);
      } catch (err) {
        showToast(err.message || 'Update failed', 'error');
      }
    });

    document.getElementById('modal-set-expiry-btn').addEventListener('click', async () => {
      if (!selectedUserId) return;
      const val = document.getElementById('modal-expiry-input').value;
      if (!val) {
        showToast('Please select a date first', 'error');
        return;
      }
      const d = new Date(val);
      d.setHours(23, 59, 59, 999);
      try {
        const res = await fetch('/admin/api/users/' + encodeURIComponent(selectedUserId) + '/beta-expiry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ betaExpiresAt: d.getTime() })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || 'Expiry update failed');
        showToast('Beta expiration updated', 'success');
        await fetchUsers();
        if (selectedUserId) openUserDetail(selectedUserId);
      } catch (err) {
        showToast(err.message || 'Update failed', 'error');
      }
    });

    document.getElementById('modal-clear-expiry-btn').addEventListener('click', async () => {
      if (!selectedUserId) return;
      try {
        const res = await fetch('/admin/api/users/' + encodeURIComponent(selectedUserId) + '/beta-expiry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ betaExpiresAt: null })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || 'Expiry clear failed');
        showToast('Beta expiration cleared', 'success');
        await fetchUsers();
        if (selectedUserId) openUserDetail(selectedUserId);
      } catch (err) {
        showToast(err.message || 'Update failed', 'error');
      }
    });

    // Event Listeners for Filters & Search
    document.getElementById('search-input').addEventListener('input', () => renderTable());
    document.getElementById('access-filter').addEventListener('change', () => renderTable());
    document.getElementById('status-filter').addEventListener('change', () => renderTable());
    document.getElementById('btn-refresh').addEventListener('click', () => {
      fetchUsers();
      showToast('Refreshed user list', 'info');
    });

    // Auto-refresh every 20 seconds
    setInterval(() => {
      fetchUsers();
    }, 20000);

    // Initial load
    fetchUsers();
  </script>
</body>
</html>`;
}

export function registerAdminPanel(
  app: FastifyInstance,
  userStore: UserStore,
  config: ServerConfig,
  runtimeContext?: AdminRuntimeContext
): void {
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

  // 4. GET /admin/api/users - User List with Presence and Telemetry
  app.get('/admin/api/users', async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: 'Not Found' });
    }

    if (!isRequestAdminAuthenticated(request, config)) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized' });
    }

    const onlineIds = runtimeContext?.getOnlineUserIds ? runtimeContext.getOnlineUserIds() : undefined;
    const users = userStore.listAdminUsers(onlineIds);
    return reply.send({ ok: true, users });
  });

  // 5. GET /admin/api/users/:userId - Detailed User Information & Activity History
  app.get('/admin/api/users/:userId', async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: 'Not Found' });
    }

    if (!isRequestAdminAuthenticated(request, config)) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized' });
    }

    const { userId } = request.params as { userId: string };
    const isOnline = Boolean(runtimeContext?.isUserOnline ? runtimeContext.isUserOnline(userId) : false);
    const userDetail = userStore.getAdminUserDetail(userId, isOnline);
    if (!userDetail) {
      return reply.code(404).send({ ok: false, message: `Account not found for identifier: "${userId}".` });
    }

    return reply.send({ ok: true, user: userDetail });
  });

  // 6. POST /admin/api/users/:userId/access - Modify User Session Access
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
    const betaExpiresAt = typeof body === 'object' && body && body.betaExpiresAt !== undefined ? body.betaExpiresAt : undefined;

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
    userStore.setSessionAccess(profile.id, normalizedAccess, betaExpiresAt);
    const isOnline = Boolean(runtimeContext?.isUserOnline ? runtimeContext.isUserOnline(profile.id) : false);

    return reply.send({
      ok: true,
      user: {
        ...userStore.getAdminUserDetail(profile.id, isOnline),
        userId: profile.id,
        previousAccess,
        newAccess: normalizedAccess
      }
    });
  });

  // 7. POST /admin/api/users/:userId/beta-expiry - Configure Beta Expiration
  app.post('/admin/api/users/:userId/beta-expiry', async (request, reply) => {
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
    let betaExpiresAt = typeof body === 'object' && body ? body.betaExpiresAt : undefined;

    if (betaExpiresAt !== null && typeof betaExpiresAt !== 'number' && typeof betaExpiresAt !== 'undefined') {
      return reply.code(400).send({ ok: false, message: 'Invalid betaExpiresAt timestamp provided.' });
    }

    const profile = userStore.getStoredUser(userId) || (userStore.findByUsernameOrEmail(userId) ? userStore.getStoredUser(userStore.findByUsernameOrEmail(userId)!.id) : null);
    if (!profile) {
      return reply.code(404).send({ ok: false, message: `Account not found for identifier: "${userId}".` });
    }

    userStore.setBetaExpiration(profile.id, betaExpiresAt ?? null);
    const isOnline = Boolean(runtimeContext?.isUserOnline ? runtimeContext.isUserOnline(profile.id) : false);

    return reply.send({
      ok: true,
      user: userStore.getAdminUserDetail(profile.id, isOnline)
    });
  });

  // 8. POST /admin/api/users/bulk-access - Modify Session Access for Multiple Users
  app.post('/admin/api/users/bulk-access', async (request, reply) => {
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

    const body = (request.body || {}) as any;
    const userIds = Array.isArray(body?.userIds) ? body.userIds : [];
    const newAccess = typeof body === 'object' && body ? body.access : undefined;
    const betaExpiresAt = typeof body === 'object' && body && body.betaExpiresAt !== undefined ? body.betaExpiresAt : undefined;

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

    let updatedCount = 0;
    for (const id of userIds) {
      if (typeof id === 'string' && id.trim()) {
        const stored = userStore.getStoredUser(id) || (userStore.findByUsernameOrEmail(id) ? userStore.getStoredUser(userStore.findByUsernameOrEmail(id)!.id) : null);
        if (stored) {
          userStore.setSessionAccess(stored.id, normalizedAccess, betaExpiresAt);
          updatedCount++;
        }
      }
    }

    return reply.send({ ok: true, updatedCount });
  });

  // 9. POST /admin/api/users/bulk-beta-expiry - Configure Beta Expiration for Multiple Users
  app.post('/admin/api/users/bulk-beta-expiry', async (request, reply) => {
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

    const body = (request.body || {}) as any;
    const userIds = Array.isArray(body?.userIds) ? body.userIds : [];
    let betaExpiresAt = typeof body === 'object' && body ? body.betaExpiresAt : undefined;

    if (betaExpiresAt !== null && typeof betaExpiresAt !== 'number' && typeof betaExpiresAt !== 'undefined') {
      return reply.code(400).send({ ok: false, message: 'Invalid betaExpiresAt timestamp provided.' });
    }

    let updatedCount = 0;
    for (const id of userIds) {
      if (typeof id === 'string' && id.trim()) {
        const stored = userStore.getStoredUser(id) || (userStore.findByUsernameOrEmail(id) ? userStore.getStoredUser(userStore.findByUsernameOrEmail(id)!.id) : null);
        if (stored) {
          userStore.setBetaExpiration(stored.id, betaExpiresAt ?? null);
          updatedCount++;
        }
      }
    }

    return reply.send({ ok: true, updatedCount });
  });

  // 10. GET /admin/api/stats - Server Health & Telemetry Metrics
  app.get('/admin/api/stats', async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: 'Not Found' });
    }

    if (!isRequestAdminAuthenticated(request, config)) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized' });
    }

    const onlineIds = runtimeContext?.getOnlineUserIds ? runtimeContext.getOnlineUserIds() : undefined;
    const users = userStore.listAdminUsers(onlineIds);
    const totalUsers = users.length;
    const betaUsers = users.filter((u) => u.sessionAccess === 'beta').length;
    const paidUsers = users.filter((u) => u.sessionAccess === 'paid').length;
    const blockedUsers = users.filter((u) => u.sessionAccess === 'blocked').length;
    const onlineUsers = onlineIds ? onlineIds.size : users.filter((u) => u.isOnline).length;
    const activeSessions = runtimeContext?.getActiveRoomsCount ? runtimeContext.getActiveRoomsCount() : 0;
    const uptimeSeconds = runtimeContext?.getUptimeSeconds ? runtimeContext.getUptimeSeconds() : Math.floor(process.uptime());

    return reply.send({
      ok: true,
      stats: {
        totalUsers,
        betaUsers,
        paidUsers,
        blockedUsers,
        onlineUsers,
        activeSessions,
        uptimeSeconds,
        isOperational: true
      }
    });
  });
}
