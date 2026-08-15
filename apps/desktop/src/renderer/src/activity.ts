import type { Project, ProjectActivityItem, ProjectActivityType } from '@jameet/shared';
import { escapeHtml, safeAvatarColor } from './htmlSecurity';

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const diffMs = Math.max(0, now - timestamp);
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 45) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  const d = new Date(timestamp);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function filterActivities(activities: ProjectActivityItem[], query: string): ProjectActivityItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return activities;
  return activities.filter((a) =>
    a.summary.toLowerCase().includes(q) ||
    a.userDisplayName.toLowerCase().includes(q) ||
    a.type.toLowerCase().includes(q) ||
    (a.title && a.title.toLowerCase().includes(q))
  );
}

export function getActivityIconSvg(type: ProjectActivityType): string {
  switch (type) {
    case 'project_created':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
    case 'lyrics_doc_created':
    case 'lyrics_doc_renamed':
    case 'lyrics_edited':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`;
    case 'notes_edited':
    case 'notes_bpm_changed':
    case 'notes_key_changed':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h20M2 6h20M2 12h20"/></svg>`;
    case 'structure_changed':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M9 21V9"/></svg>`;
    case 'task_created':
    case 'task_assigned':
    case 'task_status_changed':
    case 'task_reopened':
    case 'task_deleted':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    case 'task_completed':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:#10b981;"><polyline points="20 6 9 17 4 12"/></svg>`;
    case 'collaborator_added':
    case 'collaborator_removed':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>`;
    case 'session_started':
    case 'session_completed':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    default:
      return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`;
  }
}

export function renderProjectActivities(activeProject: Project | null): void {
  if (!activeProject || typeof document === 'undefined') return;
  const activities = Array.isArray(activeProject.activities) ? activeProject.activities : [];
  const countEl = document.getElementById('overview-activity-count');
  if (countEl) countEl.textContent = activities.length.toString();

  const listEl = document.getElementById('overview-activity-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (activities.length === 0) {
    listEl.innerHTML = `
      <div class="projects-empty" style="padding: 16px;">
        <p style="margin: 0; font-size: 12.5px; color: #94a3b8;">No activity recorded yet. Edits to Lyrics, Notes, Structure, and Tasks will appear here.</p>
      </div>
    `;
    return;
  }

  // Show up to 6 most recent activity items in Overview
  activities.slice(0, 6).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'overview-activity-item';

    const avatarInitial = (item.userDisplayName || item.userUsername || 'U').charAt(0).toUpperCase();
    const avatarColor = safeAvatarColor(item.userAvatarColor, 'var(--accent-voice)');

    row.innerHTML = `
      <span class="activity-avatar-chip" style="background-color: ${avatarColor};" title="${escapeHtml(item.userDisplayName || item.userUsername)}">${avatarInitial}</span>
      <span class="activity-summary-text">${escapeHtml(item.summary)}</span>
      <span class="activity-time-text">${formatRelativeTime(item.createdAt)}</span>
    `;

    listEl.appendChild(row);
  });
}

export function openActivityDialog(activeProject: Project | null): void {
  if (!activeProject || typeof document === 'undefined') return;
  const dialog = document.getElementById('project-activity-dialog');
  if (!dialog) return;

  const subtitle = document.getElementById('activity-dialog-subtitle');
  if (subtitle) {
    subtitle.textContent = `Chronological creative history for "${activeProject.name}"`;
  }

  const searchInput = document.getElementById('activity-search-input') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.value = '';
  }

  renderActivityDialog(activeProject);
  dialog.classList.remove('hidden');
}

export function renderActivityDialog(activeProject: Project | null, query = ''): void {
  if (!activeProject || typeof document === 'undefined') return;
  const activities = Array.isArray(activeProject.activities) ? activeProject.activities : [];
  const listEl = document.getElementById('activity-dialog-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  const filtered = filterActivities(activities, query);

  const badge = document.getElementById('activity-dialog-count-badge');
  if (badge) badge.textContent = `${filtered.length} Event${filtered.length === 1 ? '' : 's'}`;

  if (filtered.length === 0) {
    const q = query.trim();
    listEl.innerHTML = `
      <div class="projects-empty" style="padding: 24px;">
        <p style="margin: 0; font-size: 13px; color: #94a3b8;">${q ? `No activity matching "${escapeHtml(q)}"` : 'No project activity recorded yet.'}</p>
      </div>
    `;
    return;
  }

  filtered.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'activity-history-item';
    const avatarInitial = (item.userDisplayName || item.userUsername || 'U').charAt(0).toUpperCase();
    const avatarColor = safeAvatarColor(item.userAvatarColor, 'var(--accent-voice)');

    const iconSvg = getActivityIconSvg(item.type);
    const dateFormatted = new Date(item.createdAt).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    el.innerHTML = `
      <div class="activity-history-icon">
        ${iconSvg}
      </div>
      <div class="activity-history-content">
        <div class="activity-history-summary">${escapeHtml(item.summary)}</div>
        <div class="activity-history-meta">
          <span class="activity-avatar-chip" style="width: 16px; height: 16px; font-size: 8.5px; background-color: ${avatarColor};">${avatarInitial}</span>
          <span>${escapeHtml(item.userDisplayName || item.userUsername)}</span>
          <span>•</span>
          <span>${formatRelativeTime(item.createdAt)}</span>
          <span style="opacity: 0.6;">(${dateFormatted})</span>
        </div>
      </div>
    `;

    listEl.appendChild(el);
  });
}

export function initActivityHistory(getActiveProject: () => Project | null): void {
  if (typeof document === 'undefined') return;

  document.getElementById('btn-overview-view-activity')?.addEventListener('click', () => {
    openActivityDialog(getActiveProject());
  });

  document.getElementById('btn-close-activity-dialog')?.addEventListener('click', () => {
    document.getElementById('project-activity-dialog')?.classList.add('hidden');
  });

  document.getElementById('activity-search-input')?.addEventListener('input', (e) => {
    const q = (e.target as HTMLInputElement).value;
    renderActivityDialog(getActiveProject(), q);
  });

  // Close activity dialog on backdrop click
  document.getElementById('project-activity-dialog')?.addEventListener('click', (e) => {
    const dialog = document.getElementById('project-activity-dialog');
    if (e.target === dialog) {
      dialog?.classList.add('hidden');
    }
  });
}
