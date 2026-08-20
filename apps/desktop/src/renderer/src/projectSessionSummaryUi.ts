import type { Project, ProjectSessionItem } from '@jameet/shared';
import { formatSessionDuration, formatRelativeTime } from './projects';
import { escapeHtml } from './htmlSecurity';
import { $, setText } from './dom';

export function renderSessionSummaryModal(project: Project, session: ProjectSessionItem): void {
  const modal = $('project-session-summary-modal');
  if (!modal) return;

  const isCollab = Boolean(session.collaborator);
  const titleText = isCollab ? `Session with ${session.collaborator!.displayName}` : 'Solo Studio Session';
  const durationText =
    session.durationSeconds && session.durationSeconds > 0
      ? formatSessionDuration(session.durationSeconds)
      : '< 1m';

  setText('session-summary-title', titleText);
  setText('session-summary-code', session.code);
  setText(
    'session-summary-time',
    new Date(session.startedAt).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  );
  setText('session-summary-duration', durationText);

  // Participants list
  const pList = $('session-summary-participants');
  if (pList) {
    pList.innerHTML = '';
    const ownerName = project.ownerDisplayName || project.ownerUsername || 'Owner';
    let text = `${ownerName} (Host)`;
    if (isCollab && session.collaborator) {
      text += `, ${session.collaborator.displayName}`;
    }
    const span = document.createElement('span');
    span.className = 'modal-participants-text';
    span.textContent = text;
    pList.appendChild(span);
  }

  // Activities list - only items that were actually modified during this session
  const actList = $('session-summary-activities');
  if (actList) {
    actList.innerHTML = '';

    // 1. Check for recorded factual session events
    const summaryEvents = session.summary?.events || [];

    // 2. Fallback to project activities strictly within session timestamps (excluding session_completed meta events)
    const sessionStart = session.startedAt;
    const sessionEnd = session.endedAt || session.startedAt + (session.durationSeconds || 1) * 1000;

    const fallbackActs = (project.activities || []).filter((a) => {
      const isWithinSession = a.createdAt >= sessionStart && a.createdAt <= sessionEnd + 1000;
      const isWorkspaceChange =
        a.type !== 'session_completed' && a.type !== 'collaborator_added' && a.type !== 'collaborator_removed';
      return isWithinSession && isWorkspaceChange;
    });

    const hasSummaryEvents = summaryEvents.length > 0;
    const hasFallbackActs = fallbackActs.length > 0;

    if (!hasSummaryEvents && !hasFallbackActs) {
      actList.innerHTML = `<div class="modal-empty-act">No workspace changes or task edits occurred during this session.</div>`;
    } else if (hasSummaryEvents) {
      for (const ev of summaryEvents) {
        const item = document.createElement('div');
        item.className = 'modal-act-item';
        let iconSvg = '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/>';
        if (ev.category === 'task') {
          iconSvg =
            '<path d="M12 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="m9 15 2 2 4-4"/>';
        } else if (ev.category === 'lyrics') {
          iconSvg =
            '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>';
        } else if (ev.category === 'note') {
          iconSvg =
            '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>';
        } else if (ev.category === 'structure') {
          iconSvg =
            '<path d="M21 15V6"/><path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/>';
        }
        item.innerHTML = `
          <span class="modal-act-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon">${iconSvg}</svg>
          </span>
          <span class="modal-act-desc">${escapeHtml(ev.description)}</span>
          <span class="modal-act-time">${formatRelativeTime(ev.timestamp)}</span>
        `;
        actList.appendChild(item);
      }
    } else {
      for (const act of fallbackActs.slice(0, 15)) {
        const item = document.createElement('div');
        item.className = 'modal-act-item';
        const desc = act.summary || act.title || 'Workspace updated';
        item.innerHTML = `
          <span class="modal-act-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>
          </span>
          <span class="modal-act-desc">${escapeHtml(desc)}</span>
          <span class="modal-act-time">${formatRelativeTime(act.createdAt)}</span>
        `;
        actList.appendChild(item);
      }
    }
  }

  modal.classList.remove('hidden');
}
