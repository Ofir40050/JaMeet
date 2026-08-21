import type { Project, ProjectActivityItem, ProjectActivityType } from '@jameet/shared';
import { escapeHtml, safeAvatarColor } from '../../../core/htmlSecurity';
import { formatRelativeTime } from '../../../core/dateTimeFormatters';
import { applyAvatarToElement } from '../../../auth/profile/profileUi';

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
      return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>`;
    case 'lyrics_doc_created':
    case 'lyrics_doc_renamed':
    case 'lyrics_doc_deleted':
    case 'lyrics_edited':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`;
    case 'notes_edited':
    case 'notes_bpm_changed':
    case 'notes_key_changed':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h20M2 6h20M2 12h20"/></svg>`;
    case 'structure_changed':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M9 21V9"/></svg>`;
    case 'task_created':
    case 'task_assigned':
    case 'task_unassigned':
    case 'task_status_changed':
    case 'task_updated':
    case 'task_reopened':
    case 'task_deleted':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    case 'task_completed':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    case 'collaborator_added':
    case 'collaborator_removed':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#f472b6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>`;
    case 'session_started':
    case 'session_completed':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    default:
      return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5"><circle cx="12" cy="12" r="10"/></svg>`;
  }
}


export function resolveUserAvatar(
  activeProject: Project | null,
  userId: string,
  explicitUrl?: string,
  explicitColor?: string,
  username?: string,
  currentUser?: { id?: string; username?: string; avatarUrl?: string; avatarColor?: string } | null
): { avatarUrl?: string; avatarColor: string } {
  if (explicitUrl) {
    return { avatarUrl: explicitUrl, avatarColor: safeAvatarColor(explicitColor, '#06b6d4') };
  }
  if (currentUser) {
    const isCurrent = currentUser.id === userId || (username && currentUser.username?.toLowerCase() === username.toLowerCase());
    if (isCurrent && currentUser.avatarUrl) {
      return { avatarUrl: currentUser.avatarUrl, avatarColor: safeAvatarColor(currentUser.avatarColor || explicitColor, '#06b6d4') };
    }
  }
  if (activeProject) {
    const isOwner = activeProject.ownerId === userId || (username && activeProject.ownerUsername?.toLowerCase() === username.toLowerCase());
    if (isOwner && (activeProject as any).ownerAvatarUrl) {
      return { avatarUrl: (activeProject as any).ownerAvatarUrl, avatarColor: safeAvatarColor(activeProject.ownerAvatarColor, '#f59e0b') };
    }
    const foundCollab = activeProject.collaborators.find((c) => c.userId === userId || (username && c.username?.toLowerCase() === username.toLowerCase()));
    if (foundCollab && (foundCollab as any).avatarUrl) {
      return { avatarUrl: (foundCollab as any).avatarUrl, avatarColor: safeAvatarColor(foundCollab.avatarColor, '#06b6d4') };
    }
  }
  return { avatarUrl: undefined, avatarColor: safeAvatarColor(explicitColor, '#06b6d4') };
}

export function renderProjectActivities(
  activeProject: Project | null,
  currentUser?: { id?: string; username?: string; avatarUrl?: string; avatarColor?: string } | null
): void {
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

  // Show up to 5 most recent activity items in Overview
  activities.slice(0, 5).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'overview-activity-item';

    const { avatarUrl, avatarColor } = resolveUserAvatar(
      activeProject,
      item.userId,
      (item as any).userAvatarUrl,
      item.userAvatarColor,
      item.userUsername,
      currentUser
    );

    row.innerHTML = `
      <span class="activity-avatar-chip" title="${escapeHtml(item.userDisplayName || item.userUsername)}"></span>
      <span class="activity-summary-text">${escapeHtml(item.summary)}</span>
      <span class="activity-time-text">${formatRelativeTime(item.createdAt)}</span>
    `;

    const avatarChip = row.querySelector<HTMLElement>('.activity-avatar-chip');
    applyAvatarToElement(avatarChip, item.userDisplayName || item.userUsername, avatarColor, avatarUrl);

    listEl.appendChild(row);
  });
}

let activityCurrentPage = 1;
let activityCurrentQuery = '';
const ACTIVITY_PAGE_SIZE = 10;

export function openActivityDialog(
  activeProject: Project | null,
  currentUser?: { id?: string; username?: string; avatarUrl?: string; avatarColor?: string } | null
): void {
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

  activityCurrentPage = 1;
  activityCurrentQuery = '';
  renderActivityDialog(activeProject, '', currentUser, 1);
  dialog.classList.remove('hidden');
}

export function renderActivityDialog(
  activeProject: Project | null,
  query = '',
  currentUser?: { id?: string; username?: string; avatarUrl?: string; avatarColor?: string } | null,
  page = activityCurrentPage
): void {
  if (!activeProject || typeof document === 'undefined') return;
  const activities = Array.isArray(activeProject.activities) ? activeProject.activities : [];
  const listEl = document.getElementById('activity-dialog-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  activityCurrentQuery = query;
  const filtered = filterActivities(activities, query);
  const totalPages = Math.max(1, Math.ceil(filtered.length / ACTIVITY_PAGE_SIZE));
  activityCurrentPage = Math.min(Math.max(1, page), totalPages);

  const badge = document.getElementById('activity-dialog-count-badge');
  if (badge) badge.textContent = `${filtered.length} Event${filtered.length === 1 ? '' : 's'}`;

  const paginationEl = document.getElementById('activity-dialog-pagination');
  const pageInfoEl = document.getElementById('activity-pagination-info');
  const pageNumEl = document.getElementById('activity-page-number');
  const prevBtn = document.getElementById('btn-activity-prev-page') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('btn-activity-next-page') as HTMLButtonElement | null;

  if (paginationEl) {
    if (filtered.length === 0) {
      paginationEl.classList.add('hidden');
    } else {
      paginationEl.classList.remove('hidden');
      const startIdx = (activityCurrentPage - 1) * ACTIVITY_PAGE_SIZE + 1;
      const endIdx = Math.min(activityCurrentPage * ACTIVITY_PAGE_SIZE, filtered.length);
      if (pageInfoEl) pageInfoEl.textContent = `Showing ${startIdx}–${endIdx} of ${filtered.length}`;
      if (pageNumEl) pageNumEl.textContent = `${activityCurrentPage} / ${totalPages}`;
      if (prevBtn) prevBtn.disabled = activityCurrentPage <= 1;
      if (nextBtn) nextBtn.disabled = activityCurrentPage >= totalPages;
    }
  }

  if (filtered.length === 0) {
    const q = query.trim();
    listEl.innerHTML = `
      <div class="projects-empty" style="padding: 24px;">
        <p style="margin: 0; font-size: 13px; color: #94a3b8;">${q ? `No activity matching "${escapeHtml(q)}"` : 'No project activity recorded yet.'}</p>
      </div>
    `;
    return;
  }

  const start = (activityCurrentPage - 1) * ACTIVITY_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + ACTIVITY_PAGE_SIZE);

  pageItems.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'activity-history-item';

    const iconSvg = getActivityIconSvg(item.type);
    const dateFormatted = new Date(item.createdAt).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    el.innerHTML = `
      <span class="activity-history-icon-badge">${iconSvg}</span>
      <span class="activity-history-summary" title="${escapeHtml(item.summary)}">${escapeHtml(item.summary)}</span>
      <span class="activity-history-time-meta">
        <span class="activity-rel-time">${formatRelativeTime(item.createdAt)}</span>
        <span class="activity-full-time">(${dateFormatted})</span>
      </span>
    `;

    listEl.appendChild(el);
  });
}

export function initActivityHistory(
  getActiveProject: () => Project | null,
  getCurrentUser?: () => { id?: string; username?: string; avatarUrl?: string; avatarColor?: string } | null
): void {
  if (typeof document === 'undefined') return;

  document.getElementById('btn-overview-view-activity')?.addEventListener('click', () => {
    openActivityDialog(getActiveProject(), getCurrentUser?.());
  });

  document.getElementById('btn-close-activity-dialog')?.addEventListener('click', () => {
    document.getElementById('project-activity-dialog')?.classList.add('hidden');
  });

  document.getElementById('activity-search-input')?.addEventListener('input', (e) => {
    const q = (e.target as HTMLInputElement).value;
    activityCurrentPage = 1;
    renderActivityDialog(getActiveProject(), q, getCurrentUser?.(), 1);
  });

  document.getElementById('btn-activity-prev-page')?.addEventListener('click', () => {
    if (activityCurrentPage > 1) {
      renderActivityDialog(getActiveProject(), activityCurrentQuery, getCurrentUser?.(), activityCurrentPage - 1);
    }
  });

  document.getElementById('btn-activity-next-page')?.addEventListener('click', () => {
    renderActivityDialog(getActiveProject(), activityCurrentQuery, getCurrentUser?.(), activityCurrentPage + 1);
  });

  // Close activity dialog on backdrop click
  document.getElementById('project-activity-dialog')?.addEventListener('click', (e) => {
    const dialog = document.getElementById('project-activity-dialog');
    if (e.target === dialog) {
      dialog?.classList.add('hidden');
    }
  });
}
