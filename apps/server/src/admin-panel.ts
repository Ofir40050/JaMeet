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
      if (config.CORS_ORIGIN) {
        const allowed = Array.isArray(config.CORS_ORIGIN) ? config.CORS_ORIGIN : [config.CORS_ORIGIN];
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
      --bg: #090d16;
      --card-bg: #111827;
      --border: #1f2937;
      --text: #f9fafb;
      --text-muted: #9ca3af;
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
    }
    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    input[type="password"],
    input[type="text"] {
      width: 100%;
      background: #0d1322;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 0.9375rem;
      padding: 0.75rem 1rem;
      padding-right: 4rem;
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    input[type="password"]:focus,
    input[type="text"]:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.25);
    }
    .toggle-visibility {
      position: absolute;
      right: 0.75rem;
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }
    .toggle-visibility:hover {
      color: var(--text);
    }
    button[type="submit"] {
      width: 100%;
      background: var(--primary);
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 0.75rem 1rem;
      font-size: 0.9375rem;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 0.15s ease, transform 0.05s ease;
    }
    button[type="submit"]:hover {
      background: var(--primary-hover);
    }
    button[type="submit"]:active {
      transform: scale(0.99);
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
    <p class="subtitle">Enter the administrator secret to access the beta operations dashboard.</p>

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
  <title>JaMeet Beta Operations Dashboard</title>
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

      --badge-online-bg: rgba(34, 197, 94, 0.15);
      --badge-online-border: #16a34a;
      --badge-online-text: #4ade80;
      
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
    .server-health-pills {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      flex-wrap: wrap;
    }
    .health-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
      border: 1px solid var(--border-subtle);
      background: #0d1322;
      color: var(--text-muted);
    }
    .health-pill.operational {
      border-color: rgba(34, 197, 94, 0.3);
      color: #4ade80;
      background: rgba(34, 197, 94, 0.08);
    }
    .pulse-beacon {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 6px #22c55e;
      display: inline-block;
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
      border-radius: 6px;
      padding: 0.45rem 0.875rem;
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      transition: background-color 0.15s ease;
    }
    .btn-secondary:hover {
      background: #374151;
    }
    main {
      flex: 1;
      max-width: 1300px;
      width: 100%;
      margin: 0 auto;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1.125rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }
    .stat-label {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .stat-value {
      font-size: 1.625rem;
      font-weight: 700;
      color: var(--text);
      letter-spacing: -0.02em;
    }
    .controls-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .search-box {
      position: relative;
      flex: 1;
      min-width: 260px;
      max-width: 440px;
    }
    .search-box input {
      width: 100%;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 0.875rem;
      padding: 0.6rem 1rem 0.6rem 2.25rem;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .search-box input:focus {
      border-color: var(--btn-primary);
    }
    .search-icon {
      position: absolute;
      left: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-dim);
      font-size: 0.875rem;
    }
    .filter-tabs {
      display: inline-flex;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.25rem;
      gap: 0.25rem;
    }
    .filter-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 0.8125rem;
      font-weight: 500;
      padding: 0.375rem 0.75rem;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .filter-btn.active {
      background: #1f2937;
      color: #ffffff;
      font-weight: 600;
    }
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
    th {
      background: #0f172a;
      color: var(--text-muted);
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
    }
    td {
      padding: 0.875rem 1rem;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }
    tr:last-child td {
      border-bottom: none;
    }
    tr:hover td {
      background-color: var(--card-hover);
    }
    .user-cell {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 0.8125rem;
      color: #ffffff;
      flex-shrink: 0;
    }
    .user-info {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    .display-name {
      font-weight: 600;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .username-sub {
      font-size: 0.75rem;
      color: var(--text-dim);
    }
    .presence-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.6875rem;
      font-weight: 600;
      padding: 0.1rem 0.45rem;
      border-radius: 9999px;
      line-height: 1.2;
    }
    .presence-badge.online {
      background: var(--badge-online-bg);
      border: 1px solid var(--badge-online-border);
      color: var(--badge-online-text);
    }
    .presence-badge.offline {
      background: rgba(107, 114, 128, 0.15);
      border: 1px solid rgba(107, 114, 128, 0.3);
      color: #9ca3af;
    }
    .presence-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }
    .client-tag {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.75rem;
      color: var(--text-muted);
      background: #0d1322;
      border: 1px solid var(--border-subtle);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.6875rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 0.2rem 0.55rem;
      border-radius: 6px;
    }
    .badge-beta {
      background: var(--badge-beta-bg);
      border: 1px solid var(--badge-beta-border);
      color: var(--badge-beta-text);
    }
    .badge-paid {
      background: var(--badge-paid-bg);
      border: 1px solid var(--badge-paid-border);
      color: var(--badge-paid-text);
    }
    .badge-blocked {
      background: var(--badge-blocked-bg);
      border: 1px solid var(--badge-blocked-border);
      color: var(--badge-blocked-text);
    }
    .expiry-note {
      display: block;
      font-size: 0.6875rem;
      color: #f59e0b;
      margin-top: 0.25rem;
      font-weight: 500;
    }
    .action-group {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .segmented-control {
      display: inline-flex;
      background: #0d1322;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 2px;
    }
    .segment-btn {
      background: transparent;
      border: none;
      color: var(--text-dim);
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.3rem 0.6rem;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .segment-btn:hover {
      color: var(--text);
    }
    .segment-btn.active.blocked {
      background: #e11d48;
      color: #ffffff;
    }
    .segment-btn.active.beta {
      background: #0284c7;
      color: #ffffff;
    }
    .segment-btn.active.paid {
      background: #059669;
      color: #ffffff;
    }
    .btn-inspect {
      background: #1e293b;
      color: #94a3b8;
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 0.3rem 0.65rem;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-inspect:hover {
      background: #334155;
      color: #ffffff;
    }
    .empty-state {
      padding: 3rem 1.5rem;
      text-align: center;
      color: var(--text-muted);
    }
    
    /* User Detail Modal */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 100;
      padding: 1.5rem;
    }
    .modal-backdrop.open {
      display: flex;
    }
    .modal-card {
      width: 100%;
      max-width: 680px;
      max-height: 90vh;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .modal-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #0d1322;
    }
    .modal-header-left {
      display: flex;
      align-items: center;
      gap: 0.875rem;
    }
    .modal-close-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 1.25rem;
      cursor: pointer;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }
    .modal-close-btn:hover {
      color: var(--text);
      background: #1f2937;
    }
    .modal-body {
      padding: 1.5rem;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .modal-section-title {
      font-size: 0.8125rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.75rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 0.875rem;
    }
    .info-item {
      background: #0d1322;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.75rem 1rem;
    }
    .info-item-label {
      font-size: 0.6875rem;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.25rem;
    }
    .info-item-value {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text);
      word-break: break-all;
    }
    
    /* Beta Expiry Box */
    .expiry-config-box {
      background: #0d1322;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.875rem;
    }
    .expiry-current-status {
      font-size: 0.875rem;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .expiry-presets {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .preset-btn {
      background: #1e293b;
      border: 1px solid var(--border-subtle);
      color: var(--text);
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.35rem 0.65rem;
      border-radius: 6px;
      cursor: pointer;
    }
    .preset-btn:hover {
      background: #334155;
    }
    .expiry-custom-row {
      display: flex;
      align-items: center;
      gap: 0.625rem;
    }
    .expiry-custom-row input[type="date"] {
      background: #111827;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.45rem 0.75rem;
      border-radius: 6px;
      font-size: 0.8125rem;
      outline: none;
    }
    .btn-apply-expiry {
      background: var(--btn-primary);
      border: none;
      color: #ffffff;
      padding: 0.45rem 0.875rem;
      border-radius: 6px;
      font-size: 0.8125rem;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-apply-expiry:hover {
      background: var(--btn-primary-hover);
    }
    
    /* Activity Timeline */
    .timeline {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      position: relative;
      padding-left: 1.25rem;
    }
    .timeline::before {
      content: "";
      position: absolute;
      left: 5px;
      top: 6px;
      bottom: 6px;
      width: 2px;
      background: var(--border);
    }
    .timeline-item {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .timeline-dot {
      position: absolute;
      left: -1.25rem;
      top: 4px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #38bdf8;
      border: 2px solid var(--card-bg);
    }
    .timeline-desc {
      font-size: 0.8125rem;
      color: var(--text);
      font-weight: 500;
    }
    .timeline-time {
      font-size: 0.6875rem;
      color: var(--text-dim);
    }
    
    /* Toast Alert */
    #toast-container {
      position: fixed;
      bottom: 1.5rem;
      right: 1.5rem;
      z-index: 200;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .toast {
      background: #1e293b;
      color: #ffffff;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      font-size: 0.875rem;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
      animation: slideIn 0.2s ease-out;
    }
    .toast.success { border-color: #059669; }
    .toast.error { border-color: #e11d48; }
    @keyframes slideIn {
      from { transform: translateY(10px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand-section">
      <div class="brand-title">
        <span>JaMeet Admin</span>
        <span class="brand-tag">Beta Ops</span>
      </div>
      <div class="server-health-pills" id="server-health-bar">
        <span class="health-pill operational"><span class="pulse-beacon"></span> Operational</span>
        <span class="health-pill" id="health-uptime">⏱️ Uptime: ...</span>
        <span class="health-pill" id="health-online">🟢 0 Online</span>
        <span class="health-pill" id="health-active-sessions">🎙️ 0 Active Calls</span>
      </div>
    </div>
    <div class="header-actions">
      <button type="button" class="btn-secondary" id="btn-refresh">↻ Refresh</button>
      <form method="POST" action="/admin/logout" style="margin: 0;">
        <button type="submit" class="btn-secondary" id="btn-logout">Log Out</button>
      </form>
    </div>
  </header>

  <main>
    <div class="summary-grid">
      <div class="stat-card">
        <div class="stat-label">Total Registered</div>
        <div class="stat-value" id="stat-total">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Currently Online <span class="pulse-beacon"></span></div>
        <div class="stat-value" id="stat-online">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active Sessions</div>
        <div class="stat-value" id="stat-active-sessions">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Beta Access</div>
        <div class="stat-value" id="stat-beta">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Paid Subscribers</div>
        <div class="stat-value" id="stat-paid">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Blocked Accounts</div>
        <div class="stat-value" id="stat-blocked">-</div>
      </div>
    </div>

    <div class="controls-row">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" id="user-search" placeholder="Search by name, @username, or email...">
      </div>
      <div class="filter-tabs">
        <button type="button" class="filter-btn active" data-filter="all">All</button>
        <button type="button" class="filter-btn" data-filter="online">Online</button>
        <button type="button" class="filter-btn" data-filter="beta">Beta</button>
        <button type="button" class="filter-btn" data-filter="paid">Paid</button>
        <button type="button" class="filter-btn" data-filter="blocked">Blocked</button>
      </div>
    </div>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Musician & Presence</th>
            <th>Email</th>
            <th>Client Platform</th>
            <th>Registered</th>
            <th>Sessions</th>
            <th>Access State</th>
            <th style="text-align: right;">Actions</th>
          </tr>
        </thead>
        <tbody id="users-table-body">
          <tr>
            <td colspan="7" class="empty-state">Loading user registry...</td>
          </tr>
        </tbody>
      </table>
    </div>
  </main>

  <!-- User Detail Modal -->
  <div class="modal-backdrop" id="user-detail-modal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-header-left">
          <div class="avatar" id="modal-avatar">?</div>
          <div>
            <div class="display-name" id="modal-display-name">User Name</div>
            <div class="username-sub" id="modal-username">@username</div>
          </div>
        </div>
        <button type="button" class="modal-close-btn" id="modal-close-btn" aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <div>
          <div class="modal-section-title">Operational Information</div>
          <div class="info-grid">
            <div class="info-item">
              <div class="info-item-label">Account ID</div>
              <div class="info-item-value" id="modal-id" style="font-family: monospace; font-size: 0.75rem;">-</div>
            </div>
            <div class="info-item">
              <div class="info-item-label">Presence Status</div>
              <div class="info-item-value" id="modal-presence">-</div>
            </div>
            <div class="info-item">
              <div class="info-item-label">Client Platform & App</div>
              <div class="info-item-value" id="modal-client">-</div>
            </div>
            <div class="info-item">
              <div class="info-item-label">Last Active</div>
              <div class="info-item-value" id="modal-last-active">-</div>
            </div>
            <div class="info-item">
              <div class="info-item-label">Last Login</div>
              <div class="info-item-value" id="modal-last-login">-</div>
            </div>
            <div class="info-item">
              <div class="info-item-label">Hosted Sessions</div>
              <div class="info-item-value" id="modal-hosted-count">-</div>
            </div>
            <div class="info-item">
              <div class="info-item-label">Created At</div>
              <div class="info-item-value" id="modal-created-at">-</div>
            </div>
            <div class="info-item">
              <div class="info-item-label">Access State Updated</div>
              <div class="info-item-value" id="modal-access-updated">-</div>
            </div>
          </div>
        </div>

        <div>
          <div class="modal-section-title">Beta Access & Expiration Management</div>
          <div class="expiry-config-box">
            <div class="expiry-current-status" id="modal-expiry-status">Status: No expiration configured.</div>
            <div class="expiry-presets">
              <button type="button" class="preset-btn" data-days="7">+7 Days</button>
              <button type="button" class="preset-btn" data-days="14">+14 Days</button>
              <button type="button" class="preset-btn" data-days="30">+30 Days</button>
              <button type="button" class="preset-btn" data-days="90">+90 Days</button>
              <button type="button" class="preset-btn" id="btn-modal-clear-expiry" style="color: #fca5a5;">Clear Expiration</button>
            </div>
            <div class="expiry-custom-row">
              <label for="modal-expiry-date" style="font-size: 0.75rem; color: var(--text-muted); margin: 0;">Set Date:</label>
              <input type="date" id="modal-expiry-date">
              <button type="button" class="btn-apply-expiry" id="btn-modal-apply-expiry">Save Expiry</button>
            </div>
          </div>
        </div>

        <div>
          <div class="modal-section-title">Operational Activity History</div>
          <div class="timeline" id="modal-timeline">
            <div style="font-size: 0.8125rem; color: var(--text-muted);">No recorded activity events.</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div id="toast-container"></div>

  <script>
    let allUsers = [];
    let currentFilter = 'all';
    let searchQuery = '';
    let selectedUserId = null;

    function showToast(message, type = 'info') {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 200);
      }, 3000);
    }

    function formatRelativeTime(timestamp) {
      if (!timestamp) return 'Never';
      const diffSec = Math.floor((Date.now() - timestamp) / 1000);
      if (diffSec < 60) return 'Just now';
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return diffMin + 'm ago';
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return diffHour + 'h ago';
      const diffDays = Math.floor(diffHour / 24);
      if (diffDays < 30) return diffDays + 'd ago';
      return new Date(timestamp).toLocaleDateString();
    }

    function formatUptime(seconds) {
      if (!seconds || seconds < 0) return '0s';
      const d = Math.floor(seconds / 86400);
      const h = Math.floor((seconds % 86400) / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      if (d > 0) return d + 'd ' + h + 'h';
      if (h > 0) return h + 'h ' + m + 'm';
      return m + 'm';
    }

    async function fetchStats() {
      try {
        const res = await fetch('/admin/api/stats');
        if (res.ok) {
          const data = await res.json();
          if (data.ok && data.stats) {
            const s = data.stats;
            document.getElementById('health-uptime').textContent = '⏱️ Uptime: ' + formatUptime(s.uptimeSeconds);
            document.getElementById('health-online').textContent = '🟢 ' + s.onlineUsers + ' Online';
            document.getElementById('health-active-sessions').textContent = '🎙️ ' + s.activeSessions + ' Active Calls';
            document.getElementById('stat-online').textContent = s.onlineUsers;
            document.getElementById('stat-active-sessions').textContent = s.activeSessions;
          }
        }
      } catch (err) {
        console.warn('Failed to fetch stats:', err);
      }
    }

    async function fetchUsers() {
      try {
        const res = await fetch('/admin/api/users');
        if (!res.ok) {
          if (res.status === 401) {
            window.location.href = '/admin';
            return;
          }
          throw new Error('HTTP ' + res.status);
        }
        const data = await res.json();
        if (data.ok && Array.isArray(data.users)) {
          allUsers = data.users;
          updateSummaryMetrics();
          renderTable();
        }
      } catch (err) {
        showToast('Failed to load user list', 'error');
      }
    }

    function updateSummaryMetrics() {
      document.getElementById('stat-total').textContent = allUsers.length;
      document.getElementById('stat-online').textContent = allUsers.filter(u => u.isOnline).length;
      document.getElementById('stat-beta').textContent = allUsers.filter(u => u.sessionAccess === 'beta').length;
      document.getElementById('stat-paid').textContent = allUsers.filter(u => u.sessionAccess === 'paid').length;
      document.getElementById('stat-blocked').textContent = allUsers.filter(u => u.sessionAccess === 'blocked').length;
    }

    function renderTable() {
      const tbody = document.getElementById('users-table-body');
      tbody.innerHTML = '';

      const filtered = allUsers.filter(u => {
        if (currentFilter === 'online' && !u.isOnline) return false;
        if (currentFilter !== 'all' && currentFilter !== 'online' && u.sessionAccess !== currentFilter) return false;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          const matchName = u.displayName && u.displayName.toLowerCase().includes(q);
          const matchUser = u.username && u.username.toLowerCase().includes(q);
          const matchEmail = u.email && u.email.toLowerCase().includes(q);
          return matchName || matchUser || matchEmail;
        }
        return true;
      });

      if (filtered.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 7;
        td.className = 'empty-state';
        td.textContent = 'No matching musicians found.';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }

      filtered.forEach(u => {
        const tr = document.createElement('tr');

        // Musician & Presence
        const tdUser = document.createElement('td');
        const userCell = document.createElement('div');
        userCell.className = 'user-cell';

        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.style.backgroundColor = u.avatarColor || '#3b82f6';
        avatar.textContent = (u.displayName || u.username || '?').charAt(0).toUpperCase();

        const userInfo = document.createElement('div');
        userInfo.className = 'user-info';

        const displayNameRow = document.createElement('div');
        displayNameRow.className = 'display-name';
        displayNameRow.textContent = u.displayName || u.username;

        const presenceBadge = document.createElement('span');
        presenceBadge.className = 'presence-badge ' + (u.isOnline ? 'online' : 'offline');
        presenceBadge.innerHTML = '<span class="presence-dot"></span>' + (u.isOnline ? 'Online' : (u.lastActiveAt ? formatRelativeTime(u.lastActiveAt) : 'Offline'));
        displayNameRow.appendChild(presenceBadge);

        const usernameSub = document.createElement('div');
        usernameSub.className = 'username-sub';
        usernameSub.textContent = '@' + u.username;

        userInfo.appendChild(displayNameRow);
        userInfo.appendChild(usernameSub);
        userCell.appendChild(avatar);
        userCell.appendChild(userInfo);
        tdUser.appendChild(userCell);

        // Email
        const tdEmail = document.createElement('td');
        tdEmail.textContent = u.email || '-';

        // Client Platform
        const tdClient = document.createElement('td');
        const clientTag = document.createElement('span');
        clientTag.className = 'client-tag';
        const platformStr = u.clientPlatform || 'Desktop';
        const verStr = u.clientVersion ? ' • v' + u.clientVersion : '';
        clientTag.textContent = platformStr + verStr;
        tdClient.appendChild(clientTag);

        // Registered
        const tdCreated = document.createElement('td');
        tdCreated.textContent = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '-';

        // Hosted Sessions
        const tdHosted = document.createElement('td');
        tdHosted.textContent = (u.sessionsHostedCount || 0) + ' hosted';

        // Access State
        const tdAccess = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = 'badge badge-' + (u.sessionAccess || 'blocked');
        badge.textContent = u.sessionAccess || 'blocked';
        tdAccess.appendChild(badge);

        if (u.sessionAccess === 'beta' && u.betaExpiresAt) {
          const expNote = document.createElement('span');
          expNote.className = 'expiry-note';
          const isExpired = Date.now() >= u.betaExpiresAt;
          expNote.textContent = isExpired ? '⚠️ Expired' : 'Expires ' + new Date(u.betaExpiresAt).toLocaleDateString();
          tdAccess.appendChild(expNote);
        }

        // Actions
        const tdActions = document.createElement('td');
        tdActions.style.textAlign = 'right';

        const actionGroup = document.createElement('div');
        actionGroup.className = 'action-group';
        actionGroup.style.justifyContent = 'flex-end';

        const seg = document.createElement('div');
        seg.className = 'segmented-control';

        ['blocked', 'beta', 'paid'].forEach(state => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'segment-btn ' + state + (u.sessionAccess === state ? ' active' : '');
          btn.textContent = state.charAt(0).toUpperCase() + state.slice(1);
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (u.sessionAccess !== state) {
              updateUserAccess(u.id, state);
            }
          });
          seg.appendChild(btn);
        });

        const inspectBtn = document.createElement('button');
        inspectBtn.type = 'button';
        inspectBtn.className = 'btn-inspect';
        inspectBtn.textContent = 'Details';
        inspectBtn.addEventListener('click', () => openUserDetail(u.id));

        actionGroup.appendChild(seg);
        actionGroup.appendChild(inspectBtn);
        tdActions.appendChild(actionGroup);

        tr.appendChild(tdUser);
        tr.appendChild(tdEmail);
        tr.appendChild(tdClient);
        tr.appendChild(tdCreated);
        tr.appendChild(tdHosted);
        tr.appendChild(tdAccess);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
      });
    }

    async function updateUserAccess(userId, newAccess) {
      try {
        const res = await fetch('/admin/api/users/' + encodeURIComponent(userId) + '/access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access: newAccess })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.message || 'Failed to update access');
        }
        showToast('Updated access to ' + newAccess, 'success');
        const user = allUsers.find(u => u.id === userId);
        if (user) {
          user.sessionAccess = newAccess;
          updateSummaryMetrics();
          renderTable();
          if (selectedUserId === userId) {
            openUserDetail(userId);
          }
        }
      } catch (err) {
        showToast(err.message || 'Update failed', 'error');
      }
    }

    async function openUserDetail(userId) {
      selectedUserId = userId;
      const modal = document.getElementById('user-detail-modal');
      modal.classList.add('open');

      try {
        const res = await fetch('/admin/api/users/' + encodeURIComponent(userId));
        if (!res.ok) throw new Error('Failed to load user details');
        const data = await res.json();
        if (data.ok && data.user) {
          populateModal(data.user);
        }
      } catch (err) {
        showToast('Failed to load details', 'error');
      }
    }

    function populateModal(u) {
      document.getElementById('modal-avatar').style.backgroundColor = u.avatarColor || '#3b82f6';
      document.getElementById('modal-avatar').textContent = (u.displayName || u.username || '?').charAt(0).toUpperCase();
      document.getElementById('modal-display-name').textContent = u.displayName || u.username;
      document.getElementById('modal-username').textContent = '@' + u.username + ' • ' + u.email;

      document.getElementById('modal-id').textContent = u.id;
      document.getElementById('modal-presence').textContent = u.isOnline ? '🟢 Online Now' : (u.lastActiveAt ? '⚪ Active ' + formatRelativeTime(u.lastActiveAt) : '⚪ Offline');
      document.getElementById('modal-client').textContent = (u.clientPlatform || 'Desktop') + (u.clientVersion ? ' • v' + u.clientVersion : '');
      document.getElementById('modal-last-active').textContent = u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleString() : 'Never';
      document.getElementById('modal-last-login').textContent = u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never';
      document.getElementById('modal-hosted-count').textContent = (u.sessionsHostedCount || 0) + ' sessions';
      document.getElementById('modal-created-at').textContent = u.createdAt ? new Date(u.createdAt).toLocaleString() : '-';
      document.getElementById('modal-access-updated').textContent = u.accessUpdatedAt ? new Date(u.accessUpdatedAt).toLocaleString() : '-';

      // Beta Expiry Box
      const statusEl = document.getElementById('modal-expiry-status');
      if (u.betaExpiresAt) {
        const expDate = new Date(u.betaExpiresAt);
        const isPassed = Date.now() >= u.betaExpiresAt;
        statusEl.textContent = isPassed
          ? '⚠️ Expired on ' + expDate.toLocaleDateString()
          : '⏳ Active until ' + expDate.toLocaleDateString() + ' (' + formatRelativeTime(u.betaExpiresAt).replace('ago', 'left') + ')';
        document.getElementById('modal-expiry-date').value = expDate.toISOString().slice(0, 10);
      } else {
        statusEl.textContent = 'Status: No expiration configured (Standard Beta).';
        document.getElementById('modal-expiry-date').value = '';
      }

      // Timeline
      const timeline = document.getElementById('modal-timeline');
      timeline.innerHTML = '';
      if (Array.isArray(u.activityHistory) && u.activityHistory.length > 0) {
        u.activityHistory.forEach(ev => {
          const item = document.createElement('div');
          item.className = 'timeline-item';

          const dot = document.createElement('div');
          dot.className = 'timeline-dot';

          const desc = document.createElement('div');
          desc.className = 'timeline-desc';
          desc.textContent = ev.description || ev.type;

          const time = document.createElement('div');
          time.className = 'timeline-time';
          time.textContent = ev.timestamp ? new Date(ev.timestamp).toLocaleString() + ' (' + formatRelativeTime(ev.timestamp) + ')' : '';

          item.appendChild(dot);
          item.appendChild(desc);
          item.appendChild(time);
          timeline.appendChild(item);
        });
      } else {
        timeline.innerHTML = '<div style="font-size: 0.8125rem; color: var(--text-muted);">No recorded operational activity.</div>';
      }
    }

    async function setBetaExpiry(userId, betaExpiresAt) {
      try {
        const res = await fetch('/admin/api/users/' + encodeURIComponent(userId) + '/beta-expiry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ betaExpiresAt })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || 'Failed to update expiry');
        showToast('Beta expiration updated', 'success');
        fetchUsers();
        if (selectedUserId === userId && data.user) {
          populateModal(data.user);
        }
      } catch (err) {
        showToast(err.message || 'Failed to set expiration', 'error');
      }
    }

    // Modal listeners
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

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.getElementById('user-detail-modal').classList.remove('open');
        selectedUserId = null;
      }
    });

    // Preset buttons
    document.querySelectorAll('.preset-btn[data-days]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!selectedUserId) return;
        const days = parseInt(btn.dataset.days, 10);
        const expiryMs = Date.now() + (days * 24 * 60 * 60 * 1000);
        setBetaExpiry(selectedUserId, expiryMs);
      });
    });

    document.getElementById('btn-modal-clear-expiry').addEventListener('click', () => {
      if (!selectedUserId) return;
      setBetaExpiry(selectedUserId, null);
    });

    document.getElementById('btn-modal-apply-expiry').addEventListener('click', () => {
      if (!selectedUserId) return;
      const dateVal = document.getElementById('modal-expiry-date').value;
      if (!dateVal) {
        showToast('Please select a valid date', 'error');
        return;
      }
      const expiryMs = new Date(dateVal + 'T23:59:59Z').getTime();
      setBetaExpiry(selectedUserId, expiryMs);
    });

    // Search filter
    document.getElementById('user-search').addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      renderTable();
    });

    // Tab filter buttons
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
      fetchStats();
      showToast('Refreshed registry & telemetry', 'info');
    });

    // Auto-refresh every 20 seconds
    setInterval(() => {
      fetchUsers();
      fetchStats();
    }, 20000);

    // Initial load
    fetchUsers();
    fetchStats();
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

  // 8. GET /admin/api/stats - Server Health & Telemetry Metrics
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
