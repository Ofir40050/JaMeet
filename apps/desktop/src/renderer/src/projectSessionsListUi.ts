import { $, setText } from './dom';

export interface ProjectSessionsPaginationInfo {
  totalFiltered: number;
  pageSize: number;
  currentPage: number;
  totalPages: number;
  startIndex: number;
}

export interface ProjectSessionsListUiOptions {
  onSearchChange?: (query: string) => void;
  onFilterChange?: (filter: string) => void;
  onPrevPage?: () => void;
  onNextPage?: () => void;
}

let listOptions: ProjectSessionsListUiOptions = {};
let isInitialized = false;

export function initProjectSessionsListUi(options: ProjectSessionsListUiOptions = {}): void {
  listOptions = options;
  if (isInitialized) return;
  isInitialized = true;

  $('project-sessions-search-input')?.addEventListener('input', (e) => {
    const query = (e.target as HTMLInputElement).value;
    listOptions.onSearchChange?.(query);
  });

  document.querySelectorAll<HTMLButtonElement>('.sessions-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter || 'all';
      document.querySelectorAll('.sessions-filter-btn').forEach((b) => b.classList.toggle('active', b === btn));
      listOptions.onFilterChange?.(filter);
    });
  });

  $('btn-sessions-prev-page')?.addEventListener('click', () => {
    listOptions.onPrevPage?.();
  });

  $('btn-sessions-next-page')?.addEventListener('click', () => {
    listOptions.onNextPage?.();
  });
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
