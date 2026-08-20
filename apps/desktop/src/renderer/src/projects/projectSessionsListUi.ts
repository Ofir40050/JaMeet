import { $, setText } from '../core/dom';
import {
  createOverviewSessionItem,
  createProjectSessionCard,
  type ProjectSessionItem
} from './projectSessionsUi';

export interface ProjectSessionsPaginationInfo {
  totalFiltered: number;
  pageSize: number;
  currentPage: number;
  totalPages: number;
  startIndex: number;
}

export interface ProjectSessionsListUiOptions {
  getSessions?: () => readonly ProjectSessionItem[];
  formatRelativeTime?: (timestamp: number) => string;
  onOpenSummary?: (session: ProjectSessionItem) => void;
  onStartSession?: () => Promise<void> | void;
}

let listOptions: ProjectSessionsListUiOptions = {};
let isInitialized = false;

let currentProjectSessionsSearch = '';
let currentProjectSessionsFilter: 'all' | 'solo' | 'collab' = 'all';
const SESSIONS_PER_PAGE = 10;
let currentProjectSessionsPage = 1;

export function resetProjectSessionsPage(): void {
  currentProjectSessionsPage = 1;
}

export function formatTotalStudioTime(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds < 60) return '< 1m';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${m}m`;
}

export function updateProjectSessionsCounter(filteredCount: number): void {
  setText('project-sessions-counter-badge', String(filteredCount));
}

export function renderProjectSessionsEmptyState(
  container: HTMLElement | null,
  hasAnySessions: boolean
): void {
  const paginationEl = $('project-sessions-pagination');
  if (paginationEl) paginationEl.classList.add('hidden');
  if (!container) return;

  container.innerHTML = `
    <div class="projects-empty" style="padding: 24px 0; text-align: center;">
      <p style="margin: 0 0 4px; font-size: 12.5px; color: #cbd5e1; font-weight: 500;">
        ${!hasAnySessions ? 'No session history in this project yet.' : 'No sessions matching your filter.'}
      </p>
      <p style="margin: 0; font-size: 11px; color: #64748b;">
        ${!hasAnySessions ? 'Click Start Session to launch your first studio session.' : 'Try adjusting your search query or filter.'}
      </p>
    </div>
  `;
}

export function renderProjectSessionsPagination(info: ProjectSessionsPaginationInfo): void {
  const paginationEl = $('project-sessions-pagination');
  const paginationInfoEl = $('project-sessions-pagination-info');
  const pageBadgeEl = $('project-sessions-page-badge');
  const btnPrev = $<HTMLButtonElement>('btn-sessions-prev-page');
  const btnNext = $<HTMLButtonElement>('btn-sessions-next-page');

  if (!paginationEl) return;

  if (info.totalFiltered <= info.pageSize) {
    paginationEl.classList.add('hidden');
    return;
  }

  paginationEl.classList.remove('hidden');
  const startNum = info.startIndex + 1;
  const endNum = Math.min(info.startIndex + info.pageSize, info.totalFiltered);

  if (paginationInfoEl) {
    paginationInfoEl.textContent = `Showing ${startNum}–${endNum} of ${info.totalFiltered}`;
  }
  if (pageBadgeEl) {
    pageBadgeEl.textContent = `Page ${info.currentPage} of ${info.totalPages}`;
  }
  if (btnPrev) {
    btnPrev.disabled = info.currentPage <= 1;
  }
  if (btnNext) {
    btnNext.disabled = info.currentPage >= info.totalPages;
  }
}

export function renderProjectSessions(): void {
  const listOverview = $('project-sessions-list');
  const listFull = $('project-sessions-full-list');
  const emptyEl = $('project-sessions-empty');

  const sessions = listOptions.getSessions?.() || [];

  // 1. Calculate & Render Stats
  const totalSec = sessions.reduce((acc, s) => acc + (s.durationSeconds || 0), 0);
  const lastActiveText = sessions.length > 0 && listOptions.formatRelativeTime
    ? listOptions.formatRelativeTime(sessions[0].startedAt)
    : '—';

  setText('project-stat-sessions-time', `${formatTotalStudioTime(totalSec)} studio time`);
  setText('project-stat-sessions-last', `Last active: ${lastActiveText}`);

  // 2. Render mini list in Overview tab (top 5)
  if (listOverview) {
    if (!sessions.length) {
      listOverview.replaceChildren();
      if (emptyEl) { emptyEl.classList.remove('hidden'); listOverview.appendChild(emptyEl); }
    } else {
      if (emptyEl) emptyEl.classList.add('hidden');
      listOverview.replaceChildren();
      for (const session of sessions.slice(0, 5)) {
        listOverview.appendChild(createOverviewSessionItem(session));
      }
    }
  }

  // 3. Filter sessions for Full Sessions Tab
  if (listFull) {
    let filtered = [...sessions];

    // Filter by type
    if (currentProjectSessionsFilter === 'solo') {
      filtered = filtered.filter((s) => !s.collaborator);
    } else if (currentProjectSessionsFilter === 'collab') {
      filtered = filtered.filter((s) => Boolean(s.collaborator));
    }

    // Filter by search query
    if (currentProjectSessionsSearch.trim()) {
      const q = currentProjectSessionsSearch.trim().toLowerCase();
      filtered = filtered.filter((s) => {
        const codeMatch = s.code?.toLowerCase().includes(q);
        const nameMatch = s.collaborator?.displayName?.toLowerCase().includes(q);
        const userMatch = s.collaborator?.username?.toLowerCase().includes(q);
        return codeMatch || nameMatch || userMatch;
      });
    }

    // Update counter badge
    updateProjectSessionsCounter(filtered.length);

    const totalFiltered = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / SESSIONS_PER_PAGE));
    if (currentProjectSessionsPage > totalPages) currentProjectSessionsPage = totalPages;
    if (currentProjectSessionsPage < 1) currentProjectSessionsPage = 1;

    const startIndex = (currentProjectSessionsPage - 1) * SESSIONS_PER_PAGE;
    const paginated = filtered.slice(startIndex, startIndex + SESSIONS_PER_PAGE);

    if (!filtered.length) {
      renderProjectSessionsEmptyState(listFull, sessions.length > 0);
    } else {
      listFull.replaceChildren();
      for (const session of paginated) {
        listFull.appendChild(
          createProjectSessionCard(session, {
            onOpenSummary: (s) => listOptions.onOpenSummary?.(s),
            onStartSession: () => listOptions.onStartSession?.()
          })
        );
      }

      // Update Pagination UI
      renderProjectSessionsPagination({
        totalFiltered,
        pageSize: SESSIONS_PER_PAGE,
        currentPage: currentProjectSessionsPage,
        totalPages,
        startIndex
      });
    }
  }
}

export function initProjectSessionsListUi(options: ProjectSessionsListUiOptions = {}): void {
  listOptions = options;
  if (isInitialized) return;
  isInitialized = true;

  $('project-sessions-search-input')?.addEventListener('input', (e) => {
    currentProjectSessionsSearch = (e.target as HTMLInputElement).value;
    currentProjectSessionsPage = 1;
    renderProjectSessions();
  });

  document.querySelectorAll<HTMLButtonElement>('.sessions-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentProjectSessionsFilter = (btn.dataset.filter as 'all' | 'solo' | 'collab') || 'all';
      currentProjectSessionsPage = 1;
      document.querySelectorAll('.sessions-filter-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderProjectSessions();
    });
  });

  $('btn-sessions-prev-page')?.addEventListener('click', () => {
    if (currentProjectSessionsPage > 1) {
      currentProjectSessionsPage--;
      renderProjectSessions();
    }
  });

  $('btn-sessions-next-page')?.addEventListener('click', () => {
    const sessions = listOptions.getSessions?.() || [];
    let filteredCount = sessions.length;
    if (currentProjectSessionsFilter === 'solo') {
      filteredCount = sessions.filter((s) => !s.collaborator).length;
    } else if (currentProjectSessionsFilter === 'collab') {
      filteredCount = sessions.filter((s) => Boolean(s.collaborator)).length;
    }
    const totalPages = Math.max(1, Math.ceil(filteredCount / SESSIONS_PER_PAGE));
    if (currentProjectSessionsPage < totalPages) {
      currentProjectSessionsPage++;
      renderProjectSessions();
    }
  });
}
