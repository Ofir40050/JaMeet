export function renderAdminDashboard(): string {
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
    th.sortable {
      cursor: pointer;
    }
    th.sortable:hover {
      background: #f1f5f9;
      color: var(--text);
    }
    .sort-ind {
      font-size: 10px;
      margin-left: 0.25rem;
      color: var(--primary);
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
    tr {
      cursor: pointer;
      user-select: none;
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
      font-weight: 600;
    }
    .status-offline {
      color: var(--text-subtle);
    }
    .access-tag {
      font-weight: 500;
      text-transform: capitalize;
    }
    .access-tag.blocked { color: #dc2626; }
    .access-tag.beta { color: #2563eb; }
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

    /* Modal / User Details */
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
      max-width: 580px;
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
    .modal-title-row {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
    }
    .modal-title {
      font-size: 14px;
      font-weight: 600;
    }
    .modal-subtitle {
      font-size: 12px;
      color: var(--text-muted);
      font-family: var(--font-mono);
    }
    .modal-body {
      padding: 1rem;
      overflow-y: auto;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .detail-row {
      display: flex;
      align-items: flex-start;
      gap: 1rem;
      font-size: 12px;
      padding: 0.25rem 0;
      border-bottom: 1px solid #f3f4f6;
    }
    .detail-label {
      width: 120px;
      flex-shrink: 0;
      color: var(--text-muted);
      font-weight: 500;
    }
    .detail-value {
      flex: 1;
      color: var(--text);
      word-break: break-word;
    }
    .notes-input {
      width: 100%;
      font-size: 12px;
      padding: 0.35rem 0.5rem;
      border: 1px solid var(--btn-border);
      border-radius: 3px;
      background: #ffffff;
      outline: none;
      resize: vertical;
      min-height: 48px;
    }
    .notes-input:focus {
      border-color: var(--primary);
    }
    .activity-section-title {
      font-weight: 600;
      font-size: 11px;
      margin-top: 0.5rem;
      margin-bottom: 0.35rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--text-muted);
    }
    .activity-list {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      max-height: 140px;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: 3px;
      padding: 0.5rem;
      background: #fafafa;
    }
    .activity-item {
      font-size: 11.5px;
      display: flex;
      gap: 0.5rem;
    }
    .activity-time {
      color: var(--text-subtle);
      white-space: nowrap;
      font-size: 11px;
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
        <option value="all">Access: All</option>
        <option value="blocked">Blocked</option>
        <option value="beta">Beta</option>
        <option value="paid">Paid</option>
      </select>
      <select id="status-filter" class="select-filter">
        <option value="all">Presence: All</option>
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
    <div class="bulk-count" id="bulk-count">0 selected</div>
    <div class="bulk-actions">
      <button type="button" class="btn btn-sm" id="bulk-set-beta">Beta</button>
      <button type="button" class="btn btn-sm" id="bulk-set-paid">Paid</button>
      <button type="button" class="btn btn-sm" id="bulk-set-blocked">Block</button>
      <button type="button" class="btn btn-sm" id="bulk-set-expiry">Beta Expiration</button>
      <button type="button" class="btn btn-sm" id="bulk-copy-emails">Copy Emails</button>
      <button type="button" class="btn btn-sm btn-subtle" id="bulk-clear">Clear</button>
    </div>
  </div>

  <!-- Primary User Table -->
  <div class="table-container">
    <table id="users-table">
      <thead>
        <tr>
          <th class="col-checkbox"><input type="checkbox" id="select-all-checkbox" aria-label="Select all visible users" /></th>
          <th class="sortable" data-col="displayName">Name <span class="sort-ind" id="sort-displayName"></span></th>
          <th class="sortable" data-col="email">Email <span class="sort-ind" id="sort-email"></span></th>
          <th class="sortable" data-col="username">Username <span class="sort-ind" id="sort-username"></span></th>
          <th class="sortable" data-col="sessionAccess">Access <span class="sort-ind" id="sort-sessionAccess"></span></th>
          <th class="sortable" data-col="createdAt">Joined <span class="sort-ind" id="sort-createdAt"></span></th>
          <th class="sortable" data-col="lastActiveAt">Last Active <span class="sort-ind" id="sort-lastActiveAt"></span></th>
          <th class="sortable" data-col="clientPlatform">Platform <span class="sort-ind" id="sort-clientPlatform"></span></th>
          <th class="sortable" data-col="clientVersion">Version <span class="sort-ind" id="sort-clientVersion"></span></th>
          <th class="sortable" data-col="sessionsHostedCount" style="text-align:right;">Sessions <span class="sort-ind" id="sort-sessionsHostedCount"></span></th>
          <th class="sortable" data-col="adminNote" id="th-notes" style="display:none;">Notes <span class="sort-ind" id="sort-adminNote"></span></th>
        </tr>
      </thead>
      <tbody id="users-tbody">
        <tr><td colspan="11" class="empty-state">Loading users...</td></tr>
      </tbody>
    </table>
  </div>

  <!-- User Detail Modal -->
  <div class="modal-backdrop" id="user-detail-modal">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title-row">
          <div class="modal-title" id="modal-display-name">User Details</div>
          <div class="modal-subtitle" id="modal-username">@username</div>
        </div>
        <button type="button" class="btn btn-subtle" id="modal-close-btn">✕</button>
      </div>
      <div class="modal-body">
        <div class="detail-row">
          <div class="detail-label">Email</div>
          <div class="detail-value" id="modal-email">-</div>
        </div>

        <div class="detail-row">
          <div class="detail-label">Access</div>
          <div class="detail-value" style="display:flex; align-items:center; gap:0.5rem;">
            <select id="modal-access-select" class="select-filter">
              <option value="blocked">Blocked</option>
              <option value="beta">Beta</option>
              <option value="paid">Paid</option>
            </select>
            <button type="button" class="btn" id="modal-update-access-btn">Save</button>
          </div>
        </div>

        <div class="detail-row">
          <div class="detail-label">Beta Expiration</div>
          <div class="detail-value" style="display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;">
            <input type="date" id="modal-expiry-input" class="search-input" style="max-width:130px;" />
            <button type="button" class="btn" id="modal-set-expiry-btn">Set</button>
            <button type="button" class="btn btn-subtle" id="modal-clear-expiry-btn">Clear</button>
            <span id="modal-expiry-status" style="color:var(--text-subtle); font-size:11px;"></span>
          </div>
        </div>

        <div class="detail-row">
          <div class="detail-label">Joined</div>
          <div class="detail-value" id="modal-created-at">-</div>
        </div>

        <div class="detail-row">
          <div class="detail-label">Last Active</div>
          <div class="detail-value" id="modal-last-active">-</div>
        </div>

        <div class="detail-row">
          <div class="detail-label">Last Login</div>
          <div class="detail-value" id="modal-last-login">-</div>
        </div>

        <div class="detail-row">
          <div class="detail-label">Platform</div>
          <div class="detail-value" id="modal-platform">-</div>
        </div>

        <div class="detail-row">
          <div class="detail-label">JaMeet Version</div>
          <div class="detail-value" id="modal-version">-</div>
        </div>

        <div class="detail-row">
          <div class="detail-label">Sessions Hosted</div>
          <div class="detail-value" id="modal-hosted-count">-</div>
        </div>

        <div class="detail-row">
          <div class="detail-label">Admin Note</div>
          <div class="detail-value" style="display:flex; flex-direction:column; gap:0.35rem; width:100%;">
            <textarea id="modal-note-input" class="notes-input" placeholder="Add internal admin note..."></textarea>
            <div style="display:flex; justify-content:flex-end;">
              <button type="button" class="btn" id="modal-save-note-btn">Save Note</button>
            </div>
          </div>
        </div>

        <div class="detail-row" style="border-bottom:none;">
          <div class="detail-label">User ID</div>
          <div class="detail-value">
            <button type="button" class="btn btn-subtle" id="modal-copy-id-btn" style="padding:0.2rem 0.5rem; font-size:11.5px;">Copy User ID</button>
          </div>
        </div>

        <div>
          <div class="activity-section-title">Activity</div>
          <div class="activity-list" id="modal-activity-list">
            <div style="color:var(--text-subtle);">No activity recorded</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    let allUsers = [];
    let selectedUserIds = new Set();
    let lastClickedIndex = -1;
    let selectedUserId = null;
    let currentSort = { column: 'createdAt', direction: 'desc' };

    function showToast(msg, type = 'info') {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'toast show ' + type;
      setTimeout(() => { el.className = 'toast'; }, 2500);
    }

    function formatRelativeTime(timestamp, isOnline) {
      if (isOnline) return 'Online';
      if (!timestamp) return 'Never';
      const now = Date.now();
      const diffMs = now - timestamp;
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHour = Math.floor(diffMin / 60);
      const diffDay = Math.floor(diffHour / 24);

      if (diffSec < 60) return 'Just now';
      if (diffMin < 60) return diffMin + 'm ago';
      if (diffHour < 24) return diffHour + 'h ago';
      if (diffDay === 1) return 'Yesterday';
      if (diffDay < 7) return diffDay + 'd ago';

      const d = new Date(timestamp);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function compareVersions(a, b) {
      const isUnknownA = !a || a === 'Unknown';
      const isUnknownB = !b || b === 'Unknown';
      if (isUnknownA && isUnknownB) return 0;
      if (isUnknownA) return -1;
      if (isUnknownB) return 1;

      const cleanA = String(a).trim().replace(/^[vV]/, '');
      const cleanB = String(b).trim().replace(/^[vV]/, '');

      const partsA = cleanA.split('.').map(p => {
        const num = parseInt(p, 10);
        return isNaN(num) ? p : num;
      });
      const partsB = cleanB.split('.').map(p => {
        const num = parseInt(p, 10);
        return isNaN(num) ? p : num;
      });

      const maxLen = Math.max(partsA.length, partsB.length);
      for (let i = 0; i < maxLen; i++) {
        const pA = partsA[i] !== undefined ? partsA[i] : 0;
        const pB = partsB[i] !== undefined ? partsB[i] : 0;
        if (typeof pA === 'number' && typeof pB === 'number') {
          if (pA !== pB) return pA - pB;
        } else {
          const strComp = String(pA).localeCompare(String(pB), undefined, { numeric: true });
          if (strComp !== 0) return strComp;
        }
      }
      return 0;
    }

    function getFilteredUsers() {
      const q = (document.getElementById('search-input').value || '').trim().toLowerCase();
      const access = document.getElementById('access-filter').value;
      const status = document.getElementById('status-filter').value;

      const filtered = allUsers.filter(u => {
        if (access !== 'all' && u.sessionAccess !== access) return false;
        if (status === 'online' && !u.isOnline) return false;
        if (status === 'offline' && u.isOnline) return false;
        if (!q) return true;
        const name = (u.displayName || '').toLowerCase();
        const username = (u.username || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        const note = (u.adminNote || '').toLowerCase();
        return name.includes(q) || username.includes(q) || email.includes(q) || note.includes(q);
      });

      // Sort
      const col = currentSort.column;
      const dir = currentSort.direction === 'asc' ? 1 : -1;

      filtered.sort((a, b) => {
        let valA, valB;
        if (col === 'displayName') {
          valA = (a.displayName || a.username || '').toLowerCase();
          valB = (b.displayName || b.username || '').toLowerCase();
          return valA.localeCompare(valB) * dir;
        } else if (col === 'email') {
          valA = (a.email || '').toLowerCase();
          valB = (b.email || '').toLowerCase();
          return valA.localeCompare(valB) * dir;
        } else if (col === 'username') {
          valA = (a.username || '').toLowerCase();
          valB = (b.username || '').toLowerCase();
          return valA.localeCompare(valB) * dir;
        } else if (col === 'sessionAccess') {
          valA = a.sessionAccess || 'blocked';
          valB = b.sessionAccess || 'blocked';
          return valA.localeCompare(valB) * dir;
        } else if (col === 'createdAt') {
          valA = a.createdAt || 0;
          valB = b.createdAt || 0;
          return (valA - valB) * dir;
        } else if (col === 'lastActiveAt') {
          if (a.isOnline && !b.isOnline) return -1 * dir;
          if (!a.isOnline && b.isOnline) return 1 * dir;
          valA = a.lastActiveAt || 0;
          valB = b.lastActiveAt || 0;
          return (valA - valB) * dir;
        } else if (col === 'clientPlatform') {
          valA = (a.clientPlatform || 'Unknown').toLowerCase();
          valB = (b.clientPlatform || 'Unknown').toLowerCase();
          return valA.localeCompare(valB) * dir;
        } else if (col === 'clientVersion') {
          return compareVersions(a.clientVersion, b.clientVersion) * dir;
        } else if (col === 'sessionsHostedCount') {
          valA = a.sessionsHostedCount || 0;
          valB = b.sessionsHostedCount || 0;
          return (valA - valB) * dir;
        } else if (col === 'adminNote') {
          valA = (a.adminNote || '').toLowerCase();
          valB = (b.adminNote || '').toLowerCase();
          return valA.localeCompare(valB) * dir;
        }
        return 0;
      });

      return filtered;
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
      const exportBtn = document.getElementById('btn-export-csv');

      if (count > 0) {
        bar.classList.add('active');
        countEl.textContent = count + ' selected';
        exportBtn.textContent = 'Export Selected';
      } else {
        bar.classList.remove('active');
        exportBtn.textContent = 'Export CSV';
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

    function updateSortIndicators() {
      document.querySelectorAll('.sort-ind').forEach(el => el.textContent = '');
      const indEl = document.getElementById('sort-' + currentSort.column);
      if (indEl) {
        indEl.textContent = currentSort.direction === 'asc' ? '↑' : '↓';
      }
    }

    function renderTable() {
      const tbody = document.getElementById('users-tbody');
      const visible = getFilteredUsers();
      const hasAnyNotes = allUsers.some(u => Boolean(u.adminNote && u.adminNote.trim()));

      const thNotes = document.getElementById('th-notes');
      if (thNotes) {
        thNotes.style.display = hasAnyNotes ? '' : 'none';
      }

      updateSortIndicators();

      if (visible.length === 0) {
        const cols = hasAnyNotes ? 11 : 10;
        tbody.innerHTML = '<tr><td colspan="' + cols + '" class="empty-state">No matching users found</td></tr>';
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

        // 2. Name & Details Link
        const tdName = document.createElement('td');
        const nameLink = document.createElement('span');
        nameLink.className = 'cell-clickable';
        nameLink.textContent = u.displayName || u.username || '-';
        nameLink.title = 'Click to open details';
        nameLink.addEventListener('click', (e) => {
          e.stopPropagation();
          openUserDetail(u.id);
        });
        tdName.appendChild(nameLink);

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

        // 7. Last Active (relative)
        const tdActive = document.createElement('td');
        const relTime = formatRelativeTime(u.lastActiveAt, u.isOnline);
        if (u.isOnline) {
          const onlineSpan = document.createElement('span');
          onlineSpan.className = 'status-online';
          onlineSpan.textContent = 'Online';
          tdActive.appendChild(onlineSpan);
        } else {
          const timeSpan = document.createElement('span');
          timeSpan.className = u.lastActiveAt ? 'status-offline' : '';
          timeSpan.textContent = relTime;
          tdActive.appendChild(timeSpan);
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

        // 11. Notes (if present)
        if (hasAnyNotes) {
          const tdNotes = document.createElement('td');
          const noteText = (u.adminNote || '').trim();
          tdNotes.textContent = noteText ? (noteText.length > 25 ? noteText.slice(0, 25) + '...' : noteText) : '-';
          tdNotes.style.color = noteText ? 'var(--text)' : 'var(--text-subtle)';
          if (noteText) tdNotes.title = noteText;
          tr.appendChild(tdNotes);
        }

        tr.addEventListener('click', (e) => {
          if (e.target.tagName === 'INPUT' || e.target.closest('.cell-clickable') || e.target.closest('.col-checkbox')) {
            return;
          }
          selectRowOrRange(index, u.id, e.shiftKey, null);
        });

        tbody.appendChild(tr);
      });

      updateSelectAllCheckbox();
    }

    function selectRowOrRange(index, userId, isShift, forceCheckedState = null) {
      const visible = getFilteredUsers();
      if (isShift && lastClickedIndex !== -1 && lastClickedIndex !== index) {
        const start = Math.min(lastClickedIndex, index);
        const end = Math.max(lastClickedIndex, index);
        const targetState = forceCheckedState !== null ? forceCheckedState : true;

        for (let i = start; i <= end; i++) {
          const user = visible[i];
          if (user) {
            if (targetState) {
              selectedUserIds.add(user.id);
            } else {
              selectedUserIds.delete(user.id);
            }
          }
        }
      } else {
        if (forceCheckedState !== null) {
          if (forceCheckedState) {
            selectedUserIds.add(userId);
          } else {
            selectedUserIds.delete(userId);
          }
        } else {
          // Toggle row selection on normal click
          if (selectedUserIds.has(userId)) {
            selectedUserIds.delete(userId);
          } else {
            selectedUserIds.add(userId);
          }
        }
        lastClickedIndex = index;
      }
      renderTable();
      updateBulkActionBar();
    }

    function handleCheckboxClick(e, index, userId) {
      selectRowOrRange(index, userId, e.shiftKey, e.target.checked);
    }

    // Header Sorting
    document.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (!col) return;
        if (currentSort.column === col) {
          currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
          currentSort.column = col;
          currentSort.direction = col === 'createdAt' || col === 'lastActiveAt' || col === 'sessionsHostedCount' ? 'desc' : 'asc';
        }
        renderTable();
      });
    });

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

    // Copy Emails
    document.getElementById('bulk-copy-emails').addEventListener('click', async () => {
      if (selectedUserIds.size === 0) return;
      const visible = getFilteredUsers();
      const selectedUsers = visible.filter(u => selectedUserIds.has(u.id));
      const emails = selectedUsers.map(u => (u.email || '').trim()).filter(Boolean);

      if (emails.length === 0) {
        showToast('No email addresses found for selection', 'error');
        return;
      }

      const text = emails.join(', ');
      try {
        await navigator.clipboard.writeText(text);
        showToast('Copied ' + emails.length + ' email' + (emails.length === 1 ? '' : 's') + ' to clipboard', 'success');
      } catch {
        // Fallback prompt
        prompt('Copy emails below:', text);
      }
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

    // CSV Export with formula injection protection
    document.getElementById('btn-export-csv').addEventListener('click', () => {
      const visible = getFilteredUsers();
      const usersToExport = selectedUserIds.size > 0
        ? visible.filter(u => selectedUserIds.has(u.id))
        : visible;

      if (usersToExport.length === 0) {
        showToast('No users to export', 'error');
        return;
      }

      // Formula injection defense + quote escaping
      const escapeCSV = (val) => {
        if (val === null || val === undefined) return '""';
        let str = String(val);
        // Formula injection protection: prepend apostrophe if starting with formula triggers
        if (/^[=+\\-@\\t\\r]/.test(str)) {
          str = "'" + str;
        }
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
        'Last Login',
        'Platform',
        'Version',
        'Sessions',
        'Admin Note'
      ];

      const rows = usersToExport.map(u => [
        escapeCSV(u.displayName || u.username || ''),
        escapeCSV(u.email || ''),
        escapeCSV(u.username || ''),
        escapeCSV(u.sessionAccess || 'blocked'),
        escapeCSV(u.betaExpiresAt ? new Date(u.betaExpiresAt).toISOString() : ''),
        escapeCSV(u.createdAt ? new Date(u.createdAt).toISOString() : ''),
        escapeCSV(u.isOnline ? 'Online' : (u.lastActiveAt ? new Date(u.lastActiveAt).toISOString() : 'Never')),
        escapeCSV(u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : 'Never'),
        escapeCSV(u.clientPlatform || 'Unknown'),
        escapeCSV(u.clientVersion || 'Unknown'),
        escapeCSV(u.sessionsHostedCount || 0),
        escapeCSV(u.adminNote || '')
      ]);

      const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\\r\\n');
      const blob = new Blob(['\\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      const dateStr = new Date().toISOString().split('T')[0];
      link.setAttribute('download', 'jameet-users-' + dateStr + '.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast('Exported ' + usersToExport.length + ' user' + (usersToExport.length === 1 ? '' : 's') + ' to CSV', 'success');
    });

    // Fetch User List (preserves search, filters, sorting, and prunes selection to visible users)
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
          pruneSelectionToVisible();
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

    function formatActivityTime(timestamp) {
      if (!timestamp) return '-';
      const date = new Date(timestamp);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      if (isToday) {
        return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      }
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }

    function populateModal(u) {
      document.getElementById('modal-display-name').textContent = u.displayName || u.username;
      document.getElementById('modal-username').textContent = '@' + u.username;
      document.getElementById('modal-email').textContent = u.email || '-';
      document.getElementById('modal-access-select').value = u.sessionAccess || 'blocked';
      document.getElementById('modal-created-at').textContent = u.createdAt ? new Date(u.createdAt).toLocaleString() : '-';
      document.getElementById('modal-last-active').textContent = u.isOnline ? 'Online now' : (u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleString() : 'Never');
      document.getElementById('modal-last-login').textContent = u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never';
      document.getElementById('modal-platform').textContent = u.clientPlatform || 'Unknown';
      document.getElementById('modal-version').textContent = (u.clientVersion && u.clientVersion !== 'Unknown') ? u.clientVersion : 'Unknown';
      document.getElementById('modal-hosted-count').textContent = (u.sessionsHostedCount || 0) + ' sessions';
      document.getElementById('modal-note-input').value = u.adminNote || '';

      const expiryInput = document.getElementById('modal-expiry-input');
      const expiryStatus = document.getElementById('modal-expiry-status');
      if (u.betaExpiresAt) {
        const d = new Date(u.betaExpiresAt);
        expiryInput.value = d.toISOString().split('T')[0];
        const isPassed = Date.now() >= u.betaExpiresAt;
        expiryStatus.textContent = isPassed ? '(Expired)' : '(Expires ' + d.toLocaleDateString() + ')';
      } else {
        expiryInput.value = '';
        expiryStatus.textContent = 'No expiration';
      }

      // Activity List
      const actContainer = document.getElementById('modal-activity-list');
      if (Array.isArray(u.activityHistory) && u.activityHistory.length > 0) {
        actContainer.innerHTML = '';
        u.activityHistory.forEach(act => {
          const item = document.createElement('div');
          item.className = 'activity-item';
          const time = document.createElement('div');
          time.className = 'activity-time';
          time.textContent = formatActivityTime(act.timestamp);
          const desc = document.createElement('div');
          desc.textContent = act.description || act.type || '-';
          item.appendChild(time);
          item.appendChild(desc);
          actContainer.appendChild(item);
        });
      } else {
        actContainer.innerHTML = '<div style="color:var(--text-subtle);">No activity recorded</div>';
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

    document.getElementById('modal-copy-id-btn').addEventListener('click', async () => {
      if (!selectedUserId) return;
      try {
        await navigator.clipboard.writeText(selectedUserId);
        showToast('Copied User ID', 'success');
      } catch {
        prompt('Copy User ID:', selectedUserId);
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

    document.getElementById('modal-save-note-btn').addEventListener('click', async () => {
      if (!selectedUserId) return;
      const noteVal = document.getElementById('modal-note-input').value;
      if (noteVal && noteVal.trim().length > 2000) {
        showToast('Admin note exceeds maximum length of 2000 characters', 'error');
        return;
      }
      try {
        const res = await fetch('/admin/api/users/' + encodeURIComponent(selectedUserId) + '/note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: noteVal })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || 'Note update failed');
        showToast('Admin note saved', 'success');
        await fetchUsers();
        if (selectedUserId) openUserDetail(selectedUserId);
      } catch (err) {
        showToast(err.message || 'Save note failed', 'error');
      }
    });

    function pruneSelectionToVisible() {
      const visible = getFilteredUsers();
      const visibleIds = new Set(visible.map(u => u.id));
      let changed = false;
      selectedUserIds.forEach(id => {
        if (!visibleIds.has(id)) {
          selectedUserIds.delete(id);
          changed = true;
        }
      });
      lastClickedIndex = -1;
      renderTable();
      updateBulkActionBar();
    }

    // Event Listeners for Filters & Search (prune selection to only visible users)
    document.getElementById('search-input').addEventListener('input', () => pruneSelectionToVisible());
    document.getElementById('access-filter').addEventListener('change', () => pruneSelectionToVisible());
    document.getElementById('status-filter').addEventListener('change', () => pruneSelectionToVisible());
    document.getElementById('btn-refresh').addEventListener('click', () => {
      fetchUsers();
      showToast('Refreshed user list', 'info');
    });

    // Auto-refresh every 20 seconds (prunes selection against newly visible set)
    setInterval(() => {
      fetchUsers();
    }, 20000);

    // Initial load
    fetchUsers();
  </script>
</body>
</html>`;
}

