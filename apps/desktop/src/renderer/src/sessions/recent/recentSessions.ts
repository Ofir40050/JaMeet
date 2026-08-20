import type { SessionHistoryItem, UserProfile } from '@jameet/shared';
import { icons } from '../../core/icons';
import { escapeHtml, safeAvatarColor } from '../../core/htmlSecurity';
import { $, setText } from '../../core/dom';

export interface RecentSessionsOptions {
  getUser: () => UserProfile | null;
  getRecentSessions: () => Promise<SessionHistoryItem[]>;
  onStartSession?: () => void;
  onNavigateToAllSessions?: () => void;
  onNavigateToHome?: () => void;
}

let options: RecentSessionsOptions | null = null;
let listenersBound = false;

export function initRecentSessions(opts: RecentSessionsOptions): void {
  options = opts;

  if (listenersBound) return;
  listenersBound = true;

  $('btn-refresh-sessions')?.addEventListener('click', () => void loadRecentSessions());
  $('btn-refresh-all-sessions')?.addEventListener('click', () => void loadRecentSessions());
  $('btn-view-all-sessions')?.addEventListener('click', () => openAllSessionsView());
  $('btn-view-all-sessions-header')?.addEventListener('click', () => openAllSessionsView());
  $('btn-sessions-back')?.addEventListener('click', () => {
    if (options?.onNavigateToHome) {
      options.onNavigateToHome();
    }
  });
  $('btn-start-session-from-history')?.addEventListener('click', () => {
    if (options?.onStartSession) {
      options.onStartSession();
    }
  });
  $('btn-close-summary-dialog')?.addEventListener('click', () => {
    $<HTMLDialogElement>('session-summary-dialog')?.close();
  });
  $('btn-done-summary-dialog')?.addEventListener('click', () => {
    $<HTMLDialogElement>('session-summary-dialog')?.close();
  });
}

export function formatSessionDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today at ${timeStr}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
}

export function formatDuration(sec?: number): string {
  if (!sec) return '';
  if (sec < 60) return `${sec}s`;
  const mins = Math.round(sec / 60);
  return `${mins} min`;
}

export function openSessionSummaryDialog(session: SessionHistoryItem): void {
  const dialog = $<HTMLDialogElement>('session-summary-dialog');
  if (!dialog) return;

  setText('summary-room-code', session.code || '--------');
  setText('summary-duration', formatDuration(session.durationSeconds || session.summary?.durationSeconds) || '0 min');
  setText('summary-time-range', formatSessionDate(session.startedAt));

  const projectPill = $('summary-project-pill');
  if (session.summary?.projectName) {
    projectPill?.classList.remove('hidden');
    setText('summary-project-name', session.summary.projectName);
  } else {
    projectPill?.classList.add('hidden');
  }

  // Participants
  const participantsListEl = $('summary-participants-list');
  if (participantsListEl) {
    participantsListEl.innerHTML = '';
    const user = options?.getUser();
    const participants = session.summary?.participants && session.summary.participants.length > 0
      ? session.summary.participants
      : [
          {
            displayName: session.role === 'host' ? (user?.displayName || 'Host') : (session.collaborator?.displayName || 'Host'),
            username: session.role === 'host' ? user?.username : session.collaborator?.username,
            role: 'Host',
            isHost: session.role === 'host',
            isGuest: false,
            avatarColor: session.role === 'host' ? safeAvatarColor(user?.avatarColor, '#38bdf8') : safeAvatarColor(session.collaborator?.avatarColor, '#38bdf8')
          },
          ...(session.collaborator ? [{
            displayName: session.collaborator.displayName,
            username: session.collaborator.username,
            role: 'Collaborator',
            isHost: false,
            isGuest: session.collaborator.isGuest,
            avatarColor: safeAvatarColor(session.collaborator.avatarColor, '#38bdf8')
          }] : [])
        ];

    for (const p of participants) {
      const row = document.createElement('div');
      row.className = 'summary-participant-row';
      const initials = (p.displayName || 'MZ').split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
      const handle = p.username ? `@${p.username}` : p.isGuest ? 'Guest' : '';
      const roleTagClass = p.isHost ? 'role-host' : 'role-participant';
      const roleText = p.isHost ? 'Host' : 'Collaborator';
      const safeBg = safeAvatarColor(p.avatarColor, '#38bdf8');

      row.innerHTML = `
        <div class="summary-participant-info">
          <div class="summary-participant-avatar" style="background-color: ${safeBg}">${escapeHtml(initials)}</div>
          <div>
            <span class="summary-participant-name">${escapeHtml(p.displayName)}</span>
            ${handle ? `<span class="summary-participant-handle"> (${escapeHtml(handle)})</span>` : ''}
          </div>
        </div>
        <span class="session-history-role-tag ${roleTagClass}">${roleText}</span>
      `;
      participantsListEl.appendChild(row);
    }
  }

  // Chat count
  const chatCount = session.summary?.chatMessagesCount ?? 0;
  setText('summary-chat-count-badge', `${chatCount} chat ${chatCount === 1 ? 'message' : 'messages'}`);

  // Events Timeline
  const eventsTimelineEl = $('summary-events-timeline');
  const emptyStateEl = $('summary-empty-state');
  if (eventsTimelineEl && emptyStateEl) {
    eventsTimelineEl.innerHTML = '';
    const events = session.summary?.events || [];
    if (events.length === 0) {
      emptyStateEl.classList.remove('hidden');
    } else {
      emptyStateEl.classList.add('hidden');
      for (const ev of events) {
        const item = document.createElement('div');
        item.className = 'summary-event-item';
        const timeStr = new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const catClass = `cat-${ev.category}`;
        const catLabel = ev.category.toUpperCase();

        item.innerHTML = `
          <span class="summary-event-pill ${catClass}">${catLabel}</span>
          <div class="summary-event-body">
            <span class="summary-event-desc">${escapeHtml(ev.description)}</span>
            <span class="summary-event-time">${timeStr}</span>
          </div>
        `;
        eventsTimelineEl.appendChild(item);
      }
    }
  }

  dialog.showModal();
}

export function createRecentSessionElement(session: SessionHistoryItem): HTMLElement {
  const item = document.createElement('div');
  item.className = 'session-history-item';

  const collabName = session.collaborator?.displayName || 'Solo Studio Session';
  const collabHandle = session.collaborator?.username ? `@${session.collaborator.username}` : session.collaborator?.isGuest ? 'Guest' : '';
  const avatarColor = safeAvatarColor(session.collaborator?.avatarColor, '#38bdf8');
  const initials = session.collaborator
    ? session.collaborator.displayName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'MZ';
  const roleIcon = session.role === 'host' ? icons.crown({ size: 12 }) : icons.mic({ size: 12 });
  const roleLabel = `${roleIcon} <span>${session.role === 'host' ? 'Host' : 'Collaborator'}</span>`;
  const roleClass = session.role === 'host' ? 'role-host' : 'role-participant';
  const durationText = formatDuration(session.durationSeconds);
  const timeText = `${formatSessionDate(session.startedAt)} · Room ${session.code}${durationText ? ` · ${durationText}` : ''}`;

  item.innerHTML = `
    <div class="session-history-left">
      <div class="session-history-avatar" style="background-color: ${avatarColor}">${escapeHtml(initials)}</div>
      <div class="session-history-meta">
        <div class="session-history-collab-row">
          <span class="session-history-collaborator">${escapeHtml(collabName)}</span>
          ${collabHandle ? `<span class="user-hero-sub" style="font-size: 11.5px;">(${escapeHtml(collabHandle)})</span>` : ''}
          <span class="session-history-role-tag ${roleClass}">${roleLabel}</span>
        </div>
        <span class="session-history-time">${escapeHtml(timeText)}</span>
      </div>
    </div>
    <div class="session-history-right">
      <button type="button" class="btn-view-summary" title="View verified session summary">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>Summary</span>
      </button>
      <button type="button" class="btn-start-with-collab" title="Start a fresh new studio session">
        <span class="btn-icon-inner">${icons.zap({ size: 13 })}</span>
        <span>Start New Session</span>
      </button>
    </div>
  `;

  item.querySelector('.btn-view-summary')?.addEventListener('click', () => {
    openSessionSummaryDialog(session);
  });

  const btnStart = item.querySelector<HTMLButtonElement>('.btn-start-with-collab');
  btnStart?.addEventListener('click', () => {
    if (options?.onStartSession) {
      options.onStartSession();
    }
  });

  return item;
}

export async function loadRecentSessions(): Promise<void> {
  const listEl = $('recent-sessions-list');
  const emptyEl = $('recent-sessions-empty');
  const countBadge = $('recent-sessions-count');
  const footerEl = $('recent-sessions-footer');
  const footerText = $('recent-sessions-footer-text');
  const headerViewAllBtn = $('btn-view-all-sessions-header');

  const allListEl = $('all-sessions-list');
  const allEmptyEl = $('all-sessions-empty');
  const allTotalBadge = $('all-sessions-total-badge');
  const allPanelCount = $('all-sessions-panel-count');

  if (!options?.getUser()) return;

  const sessions = (await options?.getRecentSessions()) ?? [];
  const totalCount = sessions.length;

  if (countBadge) countBadge.textContent = String(totalCount);
  if (allTotalBadge) allTotalBadge.textContent = `${totalCount} ${totalCount === 1 ? 'session' : 'sessions'}`;
  if (allPanelCount) allPanelCount.textContent = String(totalCount);

  // 1. Render Home Recent Sessions (Limited to 5)
  if (listEl) {
    if (!totalCount) {
      listEl.replaceChildren();
      emptyEl?.classList.remove('hidden');
      footerEl?.classList.add('hidden');
      headerViewAllBtn?.classList.add('hidden');
    } else {
      emptyEl?.classList.add('hidden');
      listEl.replaceChildren();

      const top5 = sessions.slice(0, 5);
      for (const session of top5) {
        listEl.appendChild(createRecentSessionElement(session));
      }

      // Show "View All" header button whenever sessions exist
      headerViewAllBtn?.classList.remove('hidden');

      // Show bottom footer All Sessions button if there are more than 5 sessions
      if (totalCount > 5) {
        footerEl?.classList.remove('hidden');
        if (footerText) footerText.textContent = `All ${totalCount} Sessions`;
      } else {
        footerEl?.classList.add('hidden');
      }
    }
  }

  // 2. Render Full Dedicated Sessions History View
  if (allListEl) {
    if (!totalCount) {
      allListEl.replaceChildren();
      allEmptyEl?.classList.remove('hidden');
    } else {
      allEmptyEl?.classList.add('hidden');
      allListEl.replaceChildren();
      for (const session of sessions) {
        allListEl.appendChild(createRecentSessionElement(session));
      }
    }
  }
}

export function openAllSessionsView(): void {
  if (options?.onNavigateToAllSessions) {
    options.onNavigateToAllSessions();
  }
  void loadRecentSessions();
}
