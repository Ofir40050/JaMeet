import type { ScheduledSession } from '@jameet/shared';
import {
  fetchScheduledSessions,
  createScheduledSession,
  updateScheduledSession,
  deleteScheduledSession
} from './scheduledApi';
import type { ScheduledNotificationManager } from './scheduledNotifications';
import { $ } from '../../core/dom';

export interface ScheduledSessionsOptions {
  getToken: () => string | null;
  notificationManager?: ScheduledNotificationManager;
  onStartSession?: (session: ScheduledSession) => void;
}

let options: ScheduledSessionsOptions | null = null;
let listenersBound = false;

export function initScheduledSessions(opts: ScheduledSessionsOptions): void {
  options = opts;

  if (listenersBound) return;
  listenersBound = true;

  $('btn-new-scheduled-session')?.addEventListener('click', () => openScheduledDialog());
  $('btn-refresh-scheduled-sessions')?.addEventListener('click', () => void loadScheduledSessions());
  $('btn-close-scheduled-dialog')?.addEventListener('click', () => $<HTMLDialogElement>('scheduled-session-dialog')?.close());
  $('btn-cancel-scheduled-dialog')?.addEventListener('click', () => $<HTMLDialogElement>('scheduled-session-dialog')?.close());

  $('scheduled-session-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = options?.getToken() ?? null;
    if (!token) return;

    const titleInput = $<HTMLInputElement>('scheduled-session-title-input');
    const datetimeInput = $<HTMLInputElement>('scheduled-session-datetime-input');
    const editIdInput = $<HTMLInputElement>('scheduled-session-edit-id');
    const submitBtn = $<HTMLButtonElement>('btn-submit-scheduled-dialog');
    const statusEl = $('scheduled-dialog-status');

    if (!titleInput || !datetimeInput) return;

    const title = titleInput.value.trim();
    const localDateTimeStr = datetimeInput.value;
    if (!title || !localDateTimeStr) return;

    // Convert user's local selected datetime to UTC ISO string
    const utcIso = new Date(localDateTimeStr).toISOString();

    if (submitBtn) submitBtn.disabled = true;
    statusEl?.classList.add('hidden');

    try {
      const editId = editIdInput?.value;
      if (editId) {
        await updateScheduledSession(token, editId, { title, scheduledAt: utcIso });
      } else {
        await createScheduledSession(token, { title, scheduledAt: utcIso });
      }
      $<HTMLDialogElement>('scheduled-session-dialog')?.close();
      await loadScheduledSessions();
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = err instanceof Error ? err.message : 'Failed to save scheduled session';
        statusEl.classList.remove('hidden');
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

export async function loadScheduledSessions(): Promise<void> {
  const listEl = $('scheduled-sessions-list');
  const emptyEl = $('scheduled-sessions-empty');
  const countBadge = $('scheduled-sessions-count');

  const token = options?.getToken() ?? null;
  if (!token) return;

  try {
    const sessions = await fetchScheduledSessions(token);
    if (options?.notificationManager) {
      options.notificationManager.syncSessions(sessions);
      options.notificationManager.start();
    }
    const totalCount = sessions.length;
    if (countBadge) countBadge.textContent = String(totalCount);

    if (!listEl) return;
    listEl.replaceChildren();

    if (!totalCount) {
      emptyEl?.classList.remove('hidden');
    } else {
      emptyEl?.classList.add('hidden');
      for (const session of sessions) {
        listEl.appendChild(createScheduledSessionElement(session));
      }
    }
  } catch (err) {
    console.error('Failed to load scheduled sessions:', err);
  }
}

export function createScheduledSessionElement(session: ScheduledSession): HTMLElement {
  const item = document.createElement('div');
  const dateObj = new Date(session.scheduledAt);
  const isPast = dateObj.getTime() < Date.now();
  item.className = `scheduled-session-item ${isPast ? 'is-past' : ''}`;
  item.dataset.sessionId = session.id;

  const left = document.createElement('div');
  left.className = 'scheduled-session-left';

  const iconWrap = document.createElement('div');
  iconWrap.className = 'scheduled-session-icon-wrap';
  iconWrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>`;

  const meta = document.createElement('div');
  meta.className = 'scheduled-session-meta';

  const titleRow = document.createElement('div');
  titleRow.className = 'scheduled-session-title-row';

  const title = document.createElement('span');
  title.className = 'scheduled-session-title';
  title.textContent = session.title;
  titleRow.appendChild(title);

  const badge = document.createElement('span');
  badge.className = `scheduled-session-badge ${isPast ? 'past' : ''}`;
  badge.textContent = isPast ? 'Past' : 'Upcoming';
  titleRow.appendChild(badge);

  const time = document.createElement('span');
  time.className = 'scheduled-session-time';
  time.textContent = dateObj.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });

  meta.appendChild(titleRow);
  meta.appendChild(time);
  left.appendChild(iconWrap);
  left.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'scheduled-session-actions';

  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'btn-scheduled-start';
  startBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><polygon points="6 3 20 12 6 21 6 3"/></svg><span>Start</span>`;
  startBtn.addEventListener('click', () => {
    if (options?.onStartSession) {
      options.onStartSession(session);
    }
  });

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn-scheduled-edit';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => {
    openScheduledDialog(session);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-scheduled-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', async () => {
    const confirmed = window.confirm(`Cancel scheduled session "${session.title}"?`);
    if (!confirmed) return;
    const token = options?.getToken() ?? null;
    if (!token) return;
    cancelBtn.disabled = true;
    try {
      await deleteScheduledSession(token, session.id);
      await loadScheduledSessions();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to cancel scheduled session');
      cancelBtn.disabled = false;
    }
  });

  actions.appendChild(startBtn);
  actions.appendChild(editBtn);
  actions.appendChild(cancelBtn);

  item.appendChild(left);
  item.appendChild(actions);

  return item;
}

export function openScheduledDialog(existingSession?: ScheduledSession): void {
  const dialog = $<HTMLDialogElement>('scheduled-session-dialog');
  const titleInput = $<HTMLInputElement>('scheduled-session-title-input');
  const datetimeInput = $<HTMLInputElement>('scheduled-session-datetime-input');
  const editIdInput = $<HTMLInputElement>('scheduled-session-edit-id');
  const dialogTitle = $('scheduled-dialog-title');
  const statusEl = $('scheduled-dialog-status');

  if (!dialog || !titleInput || !datetimeInput || !editIdInput) return;

  statusEl?.classList.add('hidden');

  if (existingSession) {
    if (dialogTitle) dialogTitle.textContent = 'Edit Scheduled Session';
    editIdInput.value = existingSession.id;
    titleInput.value = existingSession.title;
    // Convert existing UTC ISO to local datetime-local format YYYY-MM-DDTHH:mm
    const d = new Date(existingSession.scheduledAt);
    const localIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    datetimeInput.value = localIso;
  } else {
    if (dialogTitle) dialogTitle.textContent = 'Schedule a Session';
    editIdInput.value = '';
    titleInput.value = '';
    // Default to 1 hour in the future in local time
    const nextHour = new Date(Date.now() + 3600000);
    nextHour.setMinutes(0, 0, 0);
    const localIso = new Date(nextHour.getTime() - nextHour.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    datetimeInput.value = localIso;
  }

  dialog.showModal();
}
