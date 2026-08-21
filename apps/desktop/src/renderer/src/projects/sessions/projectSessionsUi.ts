import type { ProjectSessionItem } from '@jameet/shared';
import { formatRelativeTime, formatSessionDuration } from '../../core/dateTimeFormatters';
import { escapeHtml } from '../../core/htmlSecurity';
import { icons } from '../../core/icons';

export interface ProjectSessionsUiOptions {
  onOpenSummary?: (session: ProjectSessionItem) => void;
  onStartSession?: () => void | Promise<void>;
}

export function createOverviewSessionItem(session: ProjectSessionItem): HTMLElement {
  const item = document.createElement('div');
  item.className = 'project-session-item';
  const collabText = session.collaborator ? session.collaborator.displayName : 'Solo Studio Session';
  const timeText = formatRelativeTime(session.startedAt);
  const durationText =
    session.durationSeconds && session.durationSeconds > 0
      ? formatSessionDuration(session.durationSeconds)
      : '< 1m';

  item.innerHTML = `
    <div class="project-session-left">
      <div class="project-session-details">
        <div class="project-session-collab-row">
          <span class="project-session-collab">${escapeHtml(collabText)}</span>
        </div>
        <div class="project-session-sub-row">
          <span class="project-session-code">${escapeHtml(session.code)}</span>
          <span class="meta-dot">·</span>
          <span class="project-session-time">${escapeHtml(timeText)}</span>
        </div>
      </div>
    </div>
    <div class="project-session-right">
      <span class="project-session-duration"><span class="meta-icon">${icons.clock({ size: 11 })}</span> <span>${escapeHtml(durationText)}</span></span>
    </div>
  `;
  return item;
}

export function createProjectSessionCard(
  session: ProjectSessionItem,
  options?: ProjectSessionsUiOptions
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'project-session-seamless-row';
  const isCollab = Boolean(session.collaborator);
  const collabText = isCollab ? `Session with ${session.collaborator!.displayName}` : 'Solo Studio Session';
  const timeText = formatRelativeTime(session.startedAt);
  const durationText =
    session.durationSeconds && session.durationSeconds > 0
      ? formatSessionDuration(session.durationSeconds)
      : '< 1m';

  const avatarContent = isCollab
    ? session.collaborator!.displayName.charAt(0).toUpperCase()
    : `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></svg>`;

  card.innerHTML = `
    <div class="session-card-left">
      <div class="session-card-avatar ${isCollab ? 'is-collab' : ''}">
        ${avatarContent}
      </div>
      <div class="session-card-details">
        <div class="session-card-collab-row">
          <span class="session-card-title">${escapeHtml(collabText)}</span>
          <span class="session-card-role-badge">${session.role === 'host' ? 'Host' : 'Participant'}</span>
        </div>
        <div class="session-card-sub-row">
          <button type="button" class="session-code-pill" title="Click to copy session code">
            <span>${escapeHtml(session.code)}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          </button>
          <span class="meta-dot">·</span>
          <span class="session-card-time" title="${new Date(session.startedAt).toLocaleString()}">${escapeHtml(timeText)}</span>
        </div>
      </div>
    </div>
    <div class="session-card-right">
      <span class="session-card-duration">
        ${icons.clock({ size: 11 })}
        <span>${escapeHtml(durationText)}</span>
      </span>
      <div class="session-card-actions">
        <button type="button" class="session-card-btn btn-summary" title="View Session Summary & Activity">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span>Summary</span>
        </button>
        <button type="button" class="session-card-btn btn-start" title="Launch Project Session">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <span>Start</span>
        </button>
      </div>
    </div>
  `;

  // Copy Code on Click
  const codeBtn = card.querySelector<HTMLButtonElement>('.session-code-pill');
  codeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(session.code);
    codeBtn.innerHTML = `<span>Copied!</span> <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
    setTimeout(() => {
      codeBtn.innerHTML = `<span>${escapeHtml(session.code)}</span> <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
    }, 1500);
  });

  // Summary Click
  if (options?.onOpenSummary) {
    card.querySelector('.btn-summary')?.addEventListener('click', (e) => {
      e.stopPropagation();
      options.onOpenSummary!(session);
    });
  }

  // Start Click
  if (options?.onStartSession) {
    card.querySelector('.btn-start')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await options.onStartSession!();
    });
  }

  return card;
}
