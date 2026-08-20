import type { ProjectTaskStatus, ProjectTaskStage } from '@jameet/shared';
import { $, setText } from '../../core/dom';
import { escapeHtml } from '../../core/htmlSecurity';

// ========================================================
// TYPES & READONLY PRESENTATION INTERFACES
// ========================================================

export type ReadonlySubtaskItem = Readonly<{
  id: string;
  title: string;
  done?: boolean;
}>;

export type ReadonlyTaskItem = Readonly<{
  id: string;
  title: string;
  status?: ProjectTaskStatus;
  assigneeId?: string;
  assigneeName?: string;
  songId?: string;
  songTitle?: string;
  stage?: ProjectTaskStage;
  subtasks?: readonly ReadonlySubtaskItem[];
  note?: string;
  dueDate?: string;
  priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent';
  createdAt?: number;
  completedAt?: number;
  updatedAt?: number;
}>;

export type ReadonlySongItem = Readonly<{
  id: string;
  title: string;
  icon?: string;
  color?: string;
  archived?: boolean;
  order?: number;
  updatedAt?: number;
}>;

export interface TaskCollaboratorOption {
  userId: string;
  displayName?: string;
  username?: string;
  isOwner?: boolean;
}

export interface CreateTaskData {
  title: string;
  assigneeId?: string;
  assigneeName?: string;
  dueDate?: string;
  note?: string;
  songId?: string;
  songTitle?: string;
  stage?: ProjectTaskStage;
}

export interface TaskFieldUpdate {
  title?: string;
  note?: string | null;
  dueDate?: string | null;
  stage?: ProjectTaskStage | null;
  songId?: string | null;
  songTitle?: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent';
}

export interface TasksUiOptions {
  getTasks: () => readonly ReadonlyTaskItem[];
  getSongs: () => readonly ReadonlySongItem[];
  getCollaborators: () => readonly TaskCollaboratorOption[];
  canEdit: () => boolean;

  onCreateTask: (data: CreateTaskData) => void;
  onLiveUpdateTaskField: (taskId: string, changes: TaskFieldUpdate) => void;
  onCommitTaskField: (
    taskId: string,
    changes: TaskFieldUpdate,
    options?: { immediateFlush?: boolean; rerender?: boolean }
  ) => void;

  onToggleTaskStatus: (taskId: string) => void;
  onUpdateTaskStatus: (taskId: string, status: ProjectTaskStatus) => void;
  onDeleteTask: (taskId: string) => void;
  onDuplicateTask: (taskId: string) => void;

  onReorderTasks: (
    draggedTaskId: string,
    targetTaskId: string,
    insertAfter: boolean,
    inheritedChanges?: {
      songId?: string | null;
      songTitle?: string | null;
      stage?: ProjectTaskStage | null;
      status?: ProjectTaskStatus;
    }
  ) => void;

  onMoveTaskToGroup: (
    draggedTaskId: string,
    groupChanges: {
      songId?: string | null;
      songTitle?: string | null;
      stage?: ProjectTaskStage | null;
    }
  ) => void;

  onAddSubtask: (taskId: string, title: string) => void;
  onToggleSubtask: (taskId: string, subtaskId: string) => void;
  onDeleteSubtask: (taskId: string, subtaskId: string) => void;
  onLiveUpdateSubtask: (taskId: string, subtaskId: string, title: string) => void;

  onUpdateSongCustomization: (songId: string, changes: { icon?: string; color?: string }) => void;
  onNavigateToTasksTab?: () => void;
}

// ========================================================
// PRESENTATION CONSTANTS
// ========================================================

export const SONG_ICONS: Record<string, { label: string; svg: string }> = {
  music: {
    label: 'Music',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
  },
  mic: {
    label: 'Vocals',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>'
  },
  piano: {
    label: 'Keys',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 4v8"/><path d="M10 4v8"/><path d="M14 4v8"/><path d="M18 4v8"/></svg>'
  },
  guitar: {
    label: 'Guitar',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="m19 5-3 3"/><path d="m2 22 5.5-1.5L19 9a2.5 2.5 0 0 0-3.5-3.5L4 16.5Z"/><circle cx="14" cy="10" r="1"/></svg>'
  },
  drums: {
    label: 'Drums',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><ellipse cx="12" cy="8" rx="8" ry="4"/><path d="M4 8v8c0 2.2 3.6 4 8 4s8-1.8 8-4V8"/><path d="m7 12 5 5 5-5"/></svg>'
  },
  headphones: {
    label: 'Audio',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></svg>'
  },
  disc: {
    label: 'Vinyl',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>'
  },
  bolt: {
    label: 'Idea',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'
  },
  folder: {
    label: 'Album',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>'
  },
  tag: {
    label: 'Tag',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><circle cx="7" cy="7" r=".5" fill="currentColor"/></svg>'
  }
};

export const SONG_COLORS = [
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Cyan', hex: '#06b6d4' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Purple', hex: '#8b5cf6' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Slate', hex: '#94a3b8' }
];

export const STAGE_CONFIG: Record<ProjectTaskStage, { label: string; iconSvg: string }> = {
  writing: {
    label: 'Writing',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>'
  },
  recording: {
    label: 'Recording',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>'
  },
  arrangement: {
    label: 'Arrangement',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 4v8"/><path d="M10 4v8"/><path d="M14 4v8"/><path d="M18 4v8"/></svg>'
  },
  mix: {
    label: 'Mix',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="1" x2="7" y1="14" y2="14"/><line x1="9" x2="15" y1="8" y2="8"/><line x1="17" x2="23" y1="16" y2="16"/></svg>'
  },
  mastering: {
    label: 'Mastering',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>'
  },
  revisions: {
    label: 'Revisions',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>'
  },
  general: {
    label: 'General',
    iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><circle cx="7" cy="7" r=".5" fill="currentColor"/></svg>'
  }
};

// ========================================================
// UI STATE (OWNED EXCLUSIVELY BY TASKS UI MODULE)
// ========================================================

let currentTaskFilter: 'all' | 'todo' | 'in_progress' | 'done' = 'all';
let currentTasksViewMode: 'list' | 'board' = 'list';
let currentTasksSongFilter: string = 'all';
let currentTasksStageFilter: string = 'all';
let currentTasksGrouping: 'song' | 'stage' | 'status' | 'none' = 'song';
let currentTasksSearchQuery: string = '';
let showCompletedTasks: boolean = true;
const tasksCollapsedGroups: Set<string> = new Set();
let draggedTaskId: string | null = null;
let currentSelectedTaskId: string | null = null;
let currentTasksStatus: 'saving' | 'saved' | 'unsaved' = 'saved';

let tasksUiOptions: TasksUiOptions | null = null;
let listenersBound = false;

// ========================================================
// STATUS BADGES & HELPERS
// ========================================================

export function setTasksStatus(status: 'saving' | 'saved' | 'unsaved'): void {
  currentTasksStatus = status;
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed';
  const badge = $('project-tasks-status');
  if (badge) {
    badge.className = `workspace-status-badge ${status}`;
    badge.innerHTML = `<span class="status-dot"></span> ${label}`;
  }
  const sessionStatus = $('session-workspace-status');
  if (sessionStatus) {
    sessionStatus.className = `workspace-status-badge ${status}`;
    sessionStatus.innerHTML = `<span class="status-dot"></span> ${label}`;
  }
}

export function getTasksStatus(): 'saving' | 'saved' | 'unsaved' {
  return currentTasksStatus;
}

function formatShortDate(d: string): string {
  try {
    const parts = d.split('-');
    if (parts.length === 3) {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[parseInt(parts[1], 10) - 1] || parts[1];
      const day = parseInt(parts[2], 10);
      return `${month} ${day}`;
    }
  } catch {
    // ignore
  }
  return d;
}

// ========================================================
// PERMISSIONS
// ========================================================

export function applyTasksPermissions(canEdit: boolean): void {
  const taskInput = $<HTMLInputElement>('new-task-input');
  const taskAddBtn = $<HTMLButtonElement>('btn-add-task');
  const taskNewRow = document.querySelector<HTMLElement>('.reminders-new-task-row') || taskInput?.closest<HTMLElement>('.reminders-new-task-bar');
  if (taskNewRow) {
    taskNewRow.style.display = canEdit ? '' : 'none';
  }
  if (taskInput) {
    taskInput.disabled = !canEdit;
    taskInput.placeholder = canEdit ? 'Add a task or production reminder…' : 'View only mode';
  }
  if (taskAddBtn) taskAddBtn.disabled = !canEdit;

  const sessionTaskInput = $<HTMLInputElement>('session-new-task-input');
  const sessionTaskAddBtn = $<HTMLButtonElement>('session-btn-add-task');
  const sessionTaskNewRow = sessionTaskInput?.closest<HTMLElement>('.session-tasks-creation-bar');
  if (sessionTaskNewRow) {
    sessionTaskNewRow.style.display = canEdit ? '' : 'none';
  }
  if (sessionTaskInput) {
    sessionTaskInput.disabled = !canEdit;
    sessionTaskInput.placeholder = canEdit ? 'Add a task…' : 'View only';
  }
  if (sessionTaskAddBtn) sessionTaskAddBtn.disabled = !canEdit;

  document.querySelectorAll<HTMLElement>('.reminders-task-row, .drawer-task-card').forEach((row) => {
    if (!canEdit) {
      row.removeAttribute('draggable');
      row.querySelectorAll<HTMLButtonElement>('.reminders-check-btn, .task-subtask-check').forEach((b) => {
        b.disabled = true;
        b.style.cursor = 'default';
        b.title = 'View only mode';
      });
      row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((el) => {
        el.disabled = true;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.readOnly = true;
      });
      row.querySelectorAll<HTMLElement>('.btn-del, .task-subtasks-add-row, .task-subtask-del').forEach((el) => {
        el.style.display = 'none';
      });
    }
  });
}

// ========================================================
// CONTEXT MENU & INSPECTOR POPOVERS
// ========================================================

function showTaskContextMenu(e: MouseEvent, task: ReadonlyTaskItem): void {
  if (!tasksUiOptions) return;
  e.preventDefault();
  e.stopPropagation();
  if (!tasksUiOptions.canEdit()) return;

  document.querySelectorAll('.task-context-menu').forEach((m) => m.remove());

  const menu = document.createElement('div');
  menu.className = 'task-context-menu';

  const isDone = task.status === 'done';

  menu.innerHTML = `
    <div class="task-context-item" data-action="toggle-status">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        <span>${isDone ? 'Mark as To Do' : 'Mark as Done'}</span>
      </div>
    </div>
    <div class="task-context-item" data-action="duplicate">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
        <span>Duplicate Task</span>
      </div>
    </div>
    <div class="task-context-item" data-action="copy">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/></svg>
        <span>Copy Title</span>
      </div>
    </div>
    <div class="task-context-divider"></div>
    <div class="task-context-item" data-action="add-subtask">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
        <span>Add Subtask</span>
      </div>
    </div>
    <div class="task-context-item" data-action="add-note">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        <span>${task.note && task.note.trim() ? 'Edit Note' : 'Add Note'}</span>
      </div>
    </div>
    <div class="task-context-divider"></div>
    <div class="task-context-item" data-action="due-today">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
        <span>Due Today</span>
      </div>
    </div>
    <div class="task-context-item" data-action="due-tomorrow">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
        <span>Due Tomorrow</span>
      </div>
    </div>
    ${task.dueDate ? `
      <div class="task-context-item" data-action="clear-due">
        <div class="task-context-item-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>
          <span>Remove Due Date</span>
        </div>
      </div>
    ` : ''}
    <div class="task-context-divider"></div>
    <div class="task-context-item danger" data-action="delete">
      <div class="task-context-item-left">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        <span>Delete Task</span>
      </div>
    </div>
  `;

  document.body.appendChild(menu);

  const menuWidth = 180;
  const menuHeight = menu.offsetHeight || 260;
  let posX = e.clientX;
  let posY = e.clientY;

  if (posX + menuWidth > window.innerWidth - 10) {
    posX = window.innerWidth - menuWidth - 10;
  }
  if (posY + menuHeight > window.innerHeight - 10) {
    posY = window.innerHeight - menuHeight - 10;
  }

  menu.style.left = `${posX}px`;
  menu.style.top = `${posY}px`;

  menu.addEventListener('click', (ev) => {
    if (!tasksUiOptions) return;
    ev.stopPropagation();
    const item = (ev.target as HTMLElement).closest<HTMLElement>('.task-context-item');
    if (!item) return;
    const action = item.dataset.action;
    menu.remove();

    if (action === 'toggle-status') {
      tasksUiOptions.onToggleTaskStatus(task.id);
    } else if (action === 'duplicate') {
      tasksUiOptions.onDuplicateTask(task.id);
    } else if (action === 'copy') {
      navigator.clipboard.writeText(task.title || '').catch(() => {});
    } else if (action === 'add-subtask') {
      currentSelectedTaskId = task.id;
      tasksUiOptions.onAddSubtask(task.id, 'New subtask');
      setTimeout(() => {
        const taskRow = document.querySelector(`.reminders-task-row[data-task-id="${task.id}"]`);
        const addInput = taskRow?.querySelector<HTMLInputElement>('.task-subtask-add-input');
        if (addInput) addInput.focus();
      }, 10);
    } else if (action === 'add-note') {
      const initialNote = task.note || 'Note...';
      tasksUiOptions.onCommitTaskField(task.id, { note: initialNote }, { rerender: true });
    } else if (action === 'due-today') {
      const today = new Date().toISOString().split('T')[0];
      tasksUiOptions.onCommitTaskField(task.id, { dueDate: today }, { rerender: true });
    } else if (action === 'due-tomorrow') {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      tasksUiOptions.onCommitTaskField(task.id, { dueDate: tomorrow }, { rerender: true });
    } else if (action === 'clear-due') {
      tasksUiOptions.onCommitTaskField(task.id, { dueDate: null }, { rerender: true });
    } else if (action === 'delete') {
      tasksUiOptions.onDeleteTask(task.id);
    }
  });

  const closeHandler = (docEv: MouseEvent) => {
    if (!menu.contains(docEv.target as Node)) {
      menu.remove();
      document.removeEventListener('click', closeHandler);
      document.removeEventListener('contextmenu', closeHandler);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
    document.addEventListener('contextmenu', closeHandler);
  }, 0);
}

function openTaskInspector(task: ReadonlyTaskItem, anchorEl: HTMLElement): void {
  if (!tasksUiOptions) return;
  document.querySelectorAll('.reminders-inspector-popover').forEach((p) => p.remove());
  document.querySelectorAll('.task-context-menu').forEach((m) => m.remove());

  const popover = document.createElement('div');
  popover.className = 'reminders-inspector-popover';

  const songs = tasksUiOptions.getSongs();
  const hasDate = Boolean(task.dueDate);
  const stageKey = task.stage || 'general';

  const songOptionsHtml = `
    <option value="">No Track</option>
    ${songs
      .map(
        (s) => `
      <option value="${s.id}|${escapeHtml(s.title)}" ${s.id === task.songId ? 'selected' : ''}>${escapeHtml(s.title)}</option>
    `
      )
      .join('')}
  `;

  popover.innerHTML = `
    <!-- Header: Title & Notes -->
    <div class="inspector-card">
      <input type="text" class="inspector-title-input" value="${escapeHtml(task.title)}" placeholder="Task title" maxlength="150" />
      <textarea class="inspector-notes-textarea" placeholder="Notes" rows="2">${escapeHtml(task.note || '')}</textarea>
    </div>

    <!-- Date & Time -->
    <div class="inspector-section-title">Date & Time</div>
    <div class="inspector-card">
      <div class="inspector-row">
        <div class="inspector-row-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
          <span>Date</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <input type="date" class="inspector-date-input ${hasDate ? '' : 'hidden'}" value="${escapeHtml(task.dueDate || '')}" />
          <label class="inspector-switch">
            <input type="checkbox" class="inspector-date-toggle" ${hasDate ? 'checked' : ''} />
            <span class="inspector-slider"></span>
          </label>
        </div>
      </div>
      <div class="inspector-row">
        <div class="inspector-row-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>
          <span>Priority</span>
        </div>
        <select class="inspector-select inspector-priority-select">
          <option value="none" ${task.priority === 'none' || !task.priority ? 'selected' : ''}>None</option>
          <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Low</option>
          <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="high" ${task.priority === 'high' ? 'selected' : ''}>High</option>
          <option value="urgent" ${task.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
        </select>
      </div>
    </div>

    <!-- Organization -->
    <div class="inspector-section-title">Organization</div>
    <div class="inspector-card">
      <div class="inspector-row">
        <div class="inspector-row-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          <span>Track</span>
        </div>
        <select class="inspector-select inspector-song-select">
          ${songOptionsHtml}
        </select>
      </div>
      <div class="inspector-row">
        <div class="inspector-row-left">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
          <span>Stage</span>
        </div>
        <select class="inspector-select inspector-stage-select">
          <option value="general" ${stageKey === 'general' ? 'selected' : ''}>General</option>
          <option value="writing" ${stageKey === 'writing' ? 'selected' : ''}>Writing</option>
          <option value="recording" ${stageKey === 'recording' ? 'selected' : ''}>Recording</option>
          <option value="arrangement" ${stageKey === 'arrangement' ? 'selected' : ''}>Arrangement</option>
          <option value="mix" ${stageKey === 'mix' ? 'selected' : ''}>Mix</option>
          <option value="mastering" ${stageKey === 'mastering' ? 'selected' : ''}>Mastering</option>
          <option value="revisions" ${stageKey === 'revisions' ? 'selected' : ''}>Revisions</option>
        </select>
      </div>
    </div>
  `;

  document.body.appendChild(popover);

  const canEdit = tasksUiOptions.canEdit();
  if (!canEdit) {
    popover.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((el) => {
      el.disabled = true;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.readOnly = true;
      }
    });
    const slider = popover.querySelector<HTMLElement>('.inspector-slider');
    if (slider) slider.style.pointerEvents = 'none';
  }

  const rect = anchorEl.getBoundingClientRect();
  const popoverWidth = 320;
  const popoverHeight = popover.offsetHeight || 380;
  let posX = rect.right + 10;
  let posY = rect.top - 20;

  if (posX + popoverWidth > window.innerWidth - 16) {
    posX = rect.left - popoverWidth - 10;
  }
  if (posX < 10) posX = 10;

  if (posY + popoverHeight > window.innerHeight - 16) {
    posY = window.innerHeight - popoverHeight - 16;
  }
  if (posY < 10) posY = 10;

  popover.style.left = `${posX}px`;
  popover.style.top = `${posY}px`;

  if (canEdit && tasksUiOptions) {
    const titleInput = popover.querySelector<HTMLInputElement>('.inspector-title-input');
    titleInput?.addEventListener('input', () => {
      tasksUiOptions?.onCommitTaskField(task.id, { title: titleInput.value }, { rerender: true });
    });

    const notesTextarea = popover.querySelector<HTMLTextAreaElement>('.inspector-notes-textarea');
    notesTextarea?.addEventListener('input', () => {
      tasksUiOptions?.onCommitTaskField(task.id, { note: notesTextarea.value }, { rerender: true });
    });

    const dateToggle = popover.querySelector<HTMLInputElement>('.inspector-date-toggle');
    const dateInput = popover.querySelector<HTMLInputElement>('.inspector-date-input');

    dateToggle?.addEventListener('change', () => {
      if (!tasksUiOptions) return;
      if (dateToggle.checked) {
        dateInput?.classList.remove('hidden');
        const today = new Date().toISOString().split('T')[0];
        const newDue = dateInput?.value || today;
        if (dateInput) dateInput.value = newDue;
        tasksUiOptions.onCommitTaskField(task.id, { dueDate: newDue }, { rerender: true });
      } else {
        dateInput?.classList.add('hidden');
        tasksUiOptions.onCommitTaskField(task.id, { dueDate: null }, { rerender: true });
      }
    });

    dateInput?.addEventListener('change', () => {
      tasksUiOptions?.onCommitTaskField(task.id, { dueDate: dateInput.value || null }, { rerender: true });
    });

    const prioritySelect = popover.querySelector<HTMLSelectElement>('.inspector-priority-select');
    prioritySelect?.addEventListener('change', () => {
      tasksUiOptions?.onCommitTaskField(task.id, { priority: prioritySelect.value as any }, { rerender: true });
    });

    const songSelect = popover.querySelector<HTMLSelectElement>('.inspector-song-select');
    songSelect?.addEventListener('change', () => {
      if (!tasksUiOptions) return;
      const val = songSelect.value;
      if (!val) {
        tasksUiOptions.onCommitTaskField(task.id, { songId: null, songTitle: null }, { rerender: true });
      } else {
        const [sId, sTitle] = val.split('|');
        tasksUiOptions.onCommitTaskField(task.id, { songId: sId, songTitle: sTitle }, { rerender: true });
      }
    });

    const stageSelect = popover.querySelector<HTMLSelectElement>('.inspector-stage-select');
    stageSelect?.addEventListener('change', () => {
      if (!tasksUiOptions) return;
      const val = stageSelect.value as ProjectTaskStage;
      const stage = val === 'general' ? null : val;
      tasksUiOptions.onCommitTaskField(task.id, { stage }, { rerender: true });
    });
  }

  popover.addEventListener('click', (ev) => ev.stopPropagation());

  const closeHandler = (docEv: MouseEvent) => {
    if (!popover.contains(docEv.target as Node) && !anchorEl.contains(docEv.target as Node)) {
      popover.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
  }, 0);
}

// ========================================================
// MAIN TASKS WORKSPACE RENDERING
// ========================================================

export function renderTasksWorkspace(): void {
  if (!tasksUiOptions) return;
  const tasks = tasksUiOptions.getTasks();
  const songs = tasksUiOptions.getSongs();
  const collaborators = tasksUiOptions.getCollaborators();
  const canEdit = tasksUiOptions.canEdit();

  const totalCount = tasks.length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length;
  const todoCount = tasks.filter((t) => t.status === 'todo').length;
  const remainingCount = totalCount - doneCount;

  // 1. Update Apple Reminders Hero Title & Stats
  setText('tasks-hero-counter', remainingCount.toString());
  setText('session-tasks-hero-counter', remainingCount.toString());
  setText('tasks-completed-summary', `${doneCount} Completed`);
  setText('session-tasks-completed-summary', `${doneCount} Completed`);
  setText('tab-tasks-count', remainingCount.toString());
  setText('session-tasks-summary', `${remainingCount} Remaining · ${doneCount} Done`);

  const toggleDoneBtn = $('btn-tasks-toggle-completed');
  if (toggleDoneBtn) {
    toggleDoneBtn.textContent = showCompletedTasks ? 'Hide' : 'Show';
  }
  const sessionToggleDoneBtn = $('session-btn-tasks-toggle-completed');
  if (sessionToggleDoneBtn) {
    sessionToggleDoneBtn.textContent = showCompletedTasks ? 'Hide' : 'Show';
  }

  // 2. Populate assignee selector on creation bar
  const createAssigneeSelect = $<HTMLSelectElement>('task-new-assignee');
  const sessionAssigneeSelect = $<HTMLSelectElement>('session-task-new-assignee');
  let opts = '<option value="">Unassigned</option>';
  for (const c of collaborators) {
    const cName = c.displayName || c.username || 'Collaborator';
    const label = c.isOwner ? `${cName} (Owner)` : cName;
    opts += `<option value="${c.userId}|${escapeHtml(cName)}">${escapeHtml(label)}</option>`;
  }
  if (createAssigneeSelect) {
    const currentVal = createAssigneeSelect.value;
    createAssigneeSelect.innerHTML = opts;
    if (currentVal) createAssigneeSelect.value = currentVal;
  }
  if (sessionAssigneeSelect) {
    const currentSessionVal = sessionAssigneeSelect.value;
    sessionAssigneeSelect.innerHTML = opts;
    if (currentSessionVal) sessionAssigneeSelect.value = currentSessionVal;
  }

  // 3. Populate song selector on creation bar
  const createSongSelect = $<HTMLSelectElement>('task-new-song');
  const sessionSongSelect = $<HTMLSelectElement>('session-task-new-song');
  let songOpts = '<option value="">All Tracks</option>';
  songs.forEach((s, i) => {
    songOpts += `<option value="${s.id}">${escapeHtml(s.title || `Song ${i + 1}`)}</option>`;
  });
  if (createSongSelect) {
    const curSongVal = createSongSelect.value;
    createSongSelect.innerHTML = songOpts;
    if (curSongVal && songs.some((s) => s.id === curSongVal)) createSongSelect.value = curSongVal;
  }
  if (sessionSongSelect) {
    const curSongVal = sessionSongSelect.value;
    sessionSongSelect.innerHTML = songOpts;
    if (curSongVal && songs.some((s) => s.id === curSongVal)) sessionSongSelect.value = curSongVal;
  }

  // 4. Update track filter dropdown on header bar
  const filterSongSelect = $<HTMLSelectElement>('tasks-filter-song');
  const sessionFilterSongSelect = $<HTMLSelectElement>('session-tasks-filter-song');
  let filterSongOpts = '<option value="all">All Tracks</option>';
  songs.forEach((s, i) => {
    filterSongOpts += `<option value="${s.id}" ${currentTasksSongFilter === s.id ? 'selected' : ''}>${escapeHtml(s.title || `Song ${i + 1}`)}</option>`;
  });
  if (filterSongSelect) filterSongSelect.innerHTML = filterSongOpts;
  if (sessionFilterSongSelect) sessionFilterSongSelect.innerHTML = filterSongOpts;

  // 5. Update stage & group by filter dropdowns
  const filterStageSelect = $<HTMLSelectElement>('tasks-filter-stage');
  const sessionFilterStageSelect = $<HTMLSelectElement>('session-tasks-filter-stage');
  if (filterStageSelect) filterStageSelect.value = currentTasksStageFilter;
  if (sessionFilterStageSelect) sessionFilterStageSelect.value = currentTasksStageFilter;

  const groupBySelect = $<HTMLSelectElement>('tasks-group-by');
  const sessionGroupBySelect = $<HTMLSelectElement>('session-tasks-group-by');
  if (groupBySelect) groupBySelect.value = currentTasksGrouping;
  if (sessionGroupBySelect) sessionGroupBySelect.value = currentTasksGrouping;

  // 6. Update view switcher buttons
  const btnList = $('btn-tasks-view-list');
  const btnBoard = $('btn-tasks-view-board');
  if (btnList && btnBoard) {
    btnList.classList.toggle('active', currentTasksViewMode === 'list');
    btnBoard.classList.toggle('active', currentTasksViewMode === 'board');
  }
  const sessionBtnList = $('session-btn-tasks-view-list');
  const sessionBtnBoard = $('session-btn-tasks-view-board');
  if (sessionBtnList && sessionBtnBoard) {
    sessionBtnList.classList.toggle('active', currentTasksViewMode === 'list');
    sessionBtnBoard.classList.toggle('active', currentTasksViewMode === 'board');
  }

  // 7. Filter tasks
  const filteredTasks = tasks.filter((t) => {
    if (!showCompletedTasks && t.status === 'done') return false;
    if (currentTaskFilter !== 'all' && t.status !== currentTaskFilter) return false;
    if (currentTasksSongFilter !== 'all' && t.songId !== currentTasksSongFilter) return false;
    if (currentTasksStageFilter !== 'all' && (t.stage || 'general') !== currentTasksStageFilter) return false;
    if (currentTasksSearchQuery) {
      const q = currentTasksSearchQuery.toLowerCase();
      const titleMatch = t.title.toLowerCase().includes(q);
      const noteMatch = t.note?.toLowerCase().includes(q);
      const assigneeMatch = t.assigneeName?.toLowerCase().includes(q);
      const songMatch = t.songTitle?.toLowerCase().includes(q);
      if (!titleMatch && !noteMatch && !assigneeMatch && !songMatch) return false;
    }
    return true;
  });

  const listContainer = $('project-tasks-list');
  const boardContainer = $('project-tasks-board');
  const emptyEl = $('project-tasks-empty');
  const sessionListContainer = $('session-tasks-list');
  const sessionBoardContainer = $('session-tasks-board');
  const sessionEmptyEl = $('session-tasks-empty');

  if (emptyEl) {
    emptyEl.classList.toggle('hidden', filteredTasks.length > 0);
  }
  if (sessionEmptyEl) {
    sessionEmptyEl.classList.toggle('hidden', filteredTasks.length > 0);
  }

  if (listContainer && boardContainer) {
    listContainer.classList.toggle('hidden', currentTasksViewMode !== 'list');
    boardContainer.classList.toggle('hidden', currentTasksViewMode !== 'board');
  }
  if (sessionListContainer && sessionBoardContainer) {
    sessionListContainer.classList.toggle('hidden', currentTasksViewMode !== 'list');
    sessionBoardContainer.classList.toggle('hidden', currentTasksViewMode !== 'board');
  }

  // 8. Helper: Render an Apple Reminders Task Row
  const renderListCard = (task: ReadonlyTaskItem): HTMLElement => {
    const isSelected = currentSelectedTaskId === task.id;
    const row = document.createElement('div');
    row.className = `reminders-task-row status-${task.status || 'todo'}${isSelected ? ' is-selected' : ''}`;
    row.dataset.taskId = task.id;
    row.setAttribute('draggable', 'true');

    let toggleIcon = '';
    if (task.status === 'done') {
      toggleIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    }

    // Unified Assignee Dropdown Pill
    let assigneeOpts = '<option value="">Unassigned</option>';
    for (const c of collaborators) {
      const cName = c.displayName || c.username || 'Collaborator';
      const isSelectedAssignee = task.assigneeId === c.userId;
      assigneeOpts += `<option value="${c.userId}|${escapeHtml(cName)}" ${isSelectedAssignee ? 'selected' : ''}>${escapeHtml(cName)}</option>`;
    }
    const assigneeHtml = `
      <select class="task-action-pill task-assignee-select" title="Assignee">
        ${assigneeOpts}
      </select>
    `;

    // Unified Due Date Pill
    const dueHtml = `
      <input type="date" class="task-action-pill task-due-input" value="${escapeHtml(task.dueDate || '')}" title="Due Date" />
    `;

    // Unified Stage Dropdown Pill
    const stageKey = task.stage || 'general';
    const stageBadgeHtml = `
      <select class="task-action-pill task-stage-select" title="Stage">
        <option value="general" ${stageKey === 'general' ? 'selected' : ''}>Stage: General</option>
        <option value="writing" ${stageKey === 'writing' ? 'selected' : ''}>Stage: Writing</option>
        <option value="recording" ${stageKey === 'recording' ? 'selected' : ''}>Stage: Recording</option>
        <option value="arrangement" ${stageKey === 'arrangement' ? 'selected' : ''}>Stage: Arrangement</option>
        <option value="mix" ${stageKey === 'mix' ? 'selected' : ''}>Stage: Mix</option>
        <option value="mastering" ${stageKey === 'mastering' ? 'selected' : ''}>Stage: Mastering</option>
        <option value="revisions" ${stageKey === 'revisions' ? 'selected' : ''}>Stage: Revisions</option>
      </select>
    `;

    // Unified Track Dropdown Pill
    let songPillHtml = '';
    if (songs.length > 0) {
      let sOpts = `<option value="">Track: None</option>`;
      songs.forEach((s, i) => {
        const isSongSelected = task.songId === s.id;
        sOpts += `<option value="${s.id}|${escapeHtml(s.title || `Song ${i + 1}`)}" ${isSongSelected ? 'selected' : ''}>${escapeHtml(s.title || `Song ${i + 1}`)}</option>`;
      });
      songPillHtml = `
        <select class="task-action-pill task-song-select" title="Linked Track">
          ${sOpts}
        </select>
      `;
    }

    // Subtasks checklist HTML
    const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
    const doneSubs = subtasks.filter((s) => s.done).length;

    row.innerHTML = `
      <div class="reminders-task-main">
        <button type="button" class="reminders-check-btn" title="${task.status === 'done' ? 'Reopen task' : 'Mark as Done'}">
          ${toggleIcon}
        </button>
        <input type="text" class="reminders-task-title-input" value="${escapeHtml(task.title)}" placeholder="Task" maxlength="150" />
        <div class="reminders-task-right">
          ${task.dueDate ? `<span class="task-meta-badge due-badge">${escapeHtml(formatShortDate(task.dueDate))}</span>` : ''}
          <button type="button" class="reminders-info-btn" title="Task Details">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          </button>
        </div>
      </div>

      <div class="task-subtasks-block">
        ${subtasks.length > 0 ? `
          <div class="task-subtasks-list">
            ${subtasks.map((st) => `
              <div class="task-subtask-item ${st.done ? 'done' : ''}" data-subtask-id="${st.id}">
                <button type="button" class="task-subtask-check ${st.done ? 'done' : ''}" title="${st.done ? 'Mark undone' : 'Mark done'}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
                <input type="text" class="task-subtask-text-input" value="${escapeHtml(st.title)}" maxlength="120" />
                <button type="button" class="task-subtask-del" title="Delete subtask">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
            `).join('')}
          </div>
        ` : ''}
        <div class="task-subtasks-add-row">
          <span class="subtask-add-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          </span>
          <input type="text" class="task-subtask-add-input" placeholder="Add subtask..." maxlength="120" />
          ${subtasks.length > 0 ? `
            <span class="task-subtasks-counter-pill"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><polyline points="20 6 9 17 4 12"/></svg><span>${doneSubs}/${subtasks.length}</span></span>
          ` : ''}
        </div>
      </div>

      <div class="reminders-task-details">
        <div class="task-note-inner">
          <textarea class="task-note-textarea" placeholder="Notes" rows="1">${escapeHtml(task.note || '')}</textarea>
        </div>
        <div class="reminders-task-meta-actions">
          ${stageBadgeHtml}
          ${songPillHtml}
          ${assigneeHtml}
          ${dueHtml}
        </div>
      </div>
    `;

    // Wiring Row Events
    row.querySelector('.reminders-check-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      tasksUiOptions?.onToggleTaskStatus(task.id);
    });

    // Stage Change
    row.querySelector<HTMLSelectElement>('.task-stage-select')?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value as ProjectTaskStage;
      const stage = val === 'general' ? null : val;
      if (currentTasksGrouping === 'stage') {
        currentSelectedTaskId = task.id;
      }
      tasksUiOptions?.onCommitTaskField(task.id, { stage }, { rerender: currentTasksGrouping === 'stage' });
    });

    // Track Change
    row.querySelector<HTMLSelectElement>('.task-song-select')?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value;
      let sId: string | null = null;
      let sTitle: string | null = null;
      if (val) {
        const parts = val.split('|');
        sId = parts[0];
        sTitle = parts[1];
      }
      if (currentTasksGrouping === 'song') {
        currentSelectedTaskId = task.id;
      }
      tasksUiOptions?.onCommitTaskField(task.id, { songId: sId, songTitle: sTitle }, { rerender: currentTasksGrouping === 'song' });
    });

    // Assignee Change
    row.querySelector<HTMLSelectElement>('.task-assignee-select')?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value;
      let aId: string | null = null;
      let aName: string | null = null;
      if (val) {
        const parts = val.split('|');
        aId = parts[0];
        aName = parts[1];
      }
      tasksUiOptions?.onCommitTaskField(task.id, { assigneeId: aId, assigneeName: aName });
    });

    // Due Date Change
    row.querySelector<HTMLInputElement>('.task-due-input')?.addEventListener('change', (e) => {
      const due = (e.target as HTMLInputElement).value || null;
      const rightArea = row.querySelector('.reminders-task-right');
      if (rightArea) {
        let badge = rightArea.querySelector('.due-badge');
        if (due) {
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'task-meta-badge due-badge';
            rightArea.insertBefore(badge, rightArea.querySelector('.reminders-info-btn'));
          }
          badge.textContent = formatShortDate(due);
        } else if (badge) {
          badge.remove();
        }
      }
      tasksUiOptions?.onCommitTaskField(task.id, { dueDate: due });
    });

    const titleInput = row.querySelector<HTMLInputElement>('.reminders-task-title-input');
    titleInput?.addEventListener('focus', () => {
      currentSelectedTaskId = task.id;
    });
    titleInput?.addEventListener('input', (e) => {
      tasksUiOptions?.onLiveUpdateTaskField(task.id, { title: (e.target as HTMLInputElement).value });
    });
    titleInput?.addEventListener('blur', () => {
      const trimmed = titleInput.value.trim() || 'Untitled Task';
      tasksUiOptions?.onCommitTaskField(task.id, { title: trimmed }, { immediateFlush: true });
    });

    // Subtask events
    row.querySelectorAll<HTMLElement>('.task-subtask-item').forEach((stItem) => {
      const sId = stItem.dataset.subtaskId;
      if (!sId) return;
      stItem.querySelector('.task-subtask-check')?.addEventListener('click', (e) => {
        e.stopPropagation();
        currentSelectedTaskId = task.id;
        tasksUiOptions?.onToggleSubtask(task.id, sId);
      });
      stItem.querySelector('.task-subtask-del')?.addEventListener('click', (e) => {
        e.stopPropagation();
        currentSelectedTaskId = task.id;
        tasksUiOptions?.onDeleteSubtask(task.id, sId);
      });

      const subInput = stItem.querySelector<HTMLInputElement>('.task-subtask-text-input');
      subInput?.addEventListener('focus', () => {
        currentSelectedTaskId = task.id;
      });
      subInput?.addEventListener('input', (e) => {
        tasksUiOptions?.onLiveUpdateSubtask(task.id, sId, (e.target as HTMLInputElement).value);
      });
      subInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const addInput = row.querySelector<HTMLInputElement>('.task-subtask-add-input');
          if (addInput) {
            addInput.focus();
          }
        }
      });
    });

    const subtaskAddInput = row.querySelector<HTMLInputElement>('.task-subtask-add-input');
    subtaskAddInput?.addEventListener('focus', () => {
      currentSelectedTaskId = task.id;
    });
    subtaskAddInput?.addEventListener('keydown', (ke) => {
      if (ke.key === 'Enter') {
        ke.preventDefault();
        const text = subtaskAddInput.value.trim();
        if (text) {
          currentSelectedTaskId = task.id;
          tasksUiOptions?.onAddSubtask(task.id, text);
          subtaskAddInput.value = '';
          setTimeout(() => {
            const taskRow = document.querySelector(`.reminders-task-row[data-task-id="${task.id}"]`);
            const addInput = taskRow?.querySelector<HTMLInputElement>('.task-subtask-add-input');
            if (addInput) addInput.focus();
          }, 10);
        }
      }
    });

    // Note textarea
    const noteTextarea = row.querySelector<HTMLTextAreaElement>('.task-note-textarea');
    if (noteTextarea) {
      const resizeNote = () => {
        noteTextarea.style.height = 'auto';
        noteTextarea.style.height = `${Math.max(20, noteTextarea.scrollHeight)}px`;
      };
      setTimeout(resizeNote, 0);

      noteTextarea.addEventListener('focus', () => {
        currentSelectedTaskId = task.id;
      });

      noteTextarea.addEventListener('input', () => {
        resizeNote();
        tasksUiOptions?.onLiveUpdateTaskField(task.id, { note: noteTextarea.value });
      });

      noteTextarea.addEventListener('blur', () => {
        const trimmed = noteTextarea.value.trim() || null;
        tasksUiOptions?.onCommitTaskField(task.id, { note: trimmed }, { immediateFlush: true });
      });
    }

    // Expand on Click / Selection
    row.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.reminders-check-btn, .reminders-info-btn, .task-subtask-check, .task-subtask-del')) {
        currentSelectedTaskId = task.id;
        document.querySelectorAll('.reminders-task-row.is-selected').forEach((r) => {
          if (r !== row) r.classList.remove('is-selected');
        });
        row.classList.add('is-selected');
      }
    });

    // Info Button (Apple Reminders Inspector)
    const infoBtn = row.querySelector<HTMLButtonElement>('.reminders-info-btn');
    infoBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      openTaskInspector(task, infoBtn);
    });

    // Right-Click Context Menu
    row.addEventListener('contextmenu', (e) => {
      showTaskContextMenu(e, task);
    });

    // Drag and Drop
    row.addEventListener('dragstart', (e) => {
      draggedTaskId = task.id;
      row.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }
    });

    row.addEventListener('dragend', () => {
      draggedTaskId = null;
      row.classList.remove('dragging');
      document.querySelectorAll('.reminders-task-row').forEach((r) => r.classList.remove('drag-over-top', 'drag-over-bottom'));
      document.querySelectorAll('.reminders-group-section').forEach((s) => s.classList.remove('drag-over'));
    });

    row.addEventListener('dragover', (e) => {
      if (!draggedTaskId || draggedTaskId === task.id) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

      const rect = row.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        row.classList.add('drag-over-top');
        row.classList.remove('drag-over-bottom');
      } else {
        row.classList.add('drag-over-bottom');
        row.classList.remove('drag-over-top');
      }
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    row.addEventListener('drop', (e) => {
      if (!draggedTaskId || draggedTaskId === task.id || !tasksUiOptions) return;
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove('drag-over-top', 'drag-over-bottom');

      const rect = row.getBoundingClientRect();
      const insertAfter = e.clientY >= rect.top + rect.height / 2;

      let inheritedChanges: { songId?: string | null; songTitle?: string | null; stage?: ProjectTaskStage | null; status?: ProjectTaskStatus } | undefined;
      if (currentTasksGrouping === 'song') {
        inheritedChanges = { songId: task.songId || null, songTitle: task.songTitle || null };
      } else if (currentTasksGrouping === 'stage') {
        inheritedChanges = { stage: task.stage || null };
      } else if (currentTasksGrouping === 'status') {
        inheritedChanges = { status: task.status || 'todo' };
      }

      currentSelectedTaskId = draggedTaskId;
      tasksUiOptions.onReorderTasks(draggedTaskId, task.id, insertAfter, inheritedChanges);
    });

    if (!canEdit) {
      row.removeAttribute('draggable');
      const checkBtn = row.querySelector<HTMLButtonElement>('.reminders-check-btn');
      if (checkBtn) {
        checkBtn.disabled = true;
        checkBtn.style.cursor = 'default';
        checkBtn.title = 'View only mode';
      }
      row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select').forEach((el) => {
        el.disabled = true;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.readOnly = true;
      });
      row.querySelectorAll<HTMLElement>('.btn-del, .task-subtasks-add-row, .task-subtask-del').forEach((el) => {
        el.style.display = 'none';
      });
      row.querySelectorAll<HTMLButtonElement>('.task-subtask-check').forEach((el) => {
        el.disabled = true;
      });
    }

    return row;
  };

  // 9. Helper: Render Group Section
  const renderGroupSection = (group: {
    id: string;
    title: string;
    iconKey?: string;
    colorHex?: string;
    iconSvg?: string;
    tasks: readonly ReadonlyTaskItem[];
    songRef?: ReadonlySongItem;
    defaultSongId?: string;
    defaultStage?: ProjectTaskStage;
  }): HTMLElement => {
    const section = document.createElement('div');
    section.className = `reminders-group-section ${tasksCollapsedGroups.has(group.id) ? 'collapsed' : ''}`;
    section.dataset.groupId = group.id;

    const iconKey = group.songRef?.icon || group.iconKey || 'music';
    const colorHex = group.songRef?.color || group.colorHex || '#f43f5e';
    const iconSvg = SONG_ICONS[iconKey]?.svg || group.iconSvg || SONG_ICONS.music.svg;

    const header = document.createElement('div');
    header.className = 'reminders-group-header';
    header.innerHTML = `
      <div class="reminders-group-title-wrap">
        <span class="reminders-group-icon" style="color: ${colorHex};">
          ${iconSvg}
        </span>
        <h3 class="reminders-group-title">${escapeHtml(group.title)}</h3>
        <span class="reminders-group-count">${group.tasks.length}</span>
      </div>
      <div class="reminders-group-actions-right">
        <span class="reminders-group-chevron">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </span>
      </div>
    `;

    // Icon button click: open Customizer Popover
    const iconBtn = header.querySelector<HTMLButtonElement>('.reminders-group-icon-btn');
    if (iconBtn && group.songRef) {
      iconBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.song-customizer-popover').forEach((p) => p.remove());

        const popover = document.createElement('div');
        popover.className = 'song-customizer-popover';
        popover.innerHTML = `
          <div class="song-customizer-section-title">Track Icon</div>
          <div class="song-customizer-icons-grid">
            ${Object.entries(SONG_ICONS)
              .map(
                ([k, ic]) => `
              <button type="button" class="song-customizer-icon-item ${k === iconKey ? 'active' : ''}" data-icon-key="${k}" title="${escapeHtml(ic.label)}">
                ${ic.svg}
              </button>
            `
              )
              .join('')}
          </div>
          <div class="song-customizer-section-title" style="margin-top: 4px;">Track Color</div>
          <div class="song-customizer-colors-grid">
            ${SONG_COLORS.map(
              (c) => `
              <button type="button" class="song-customizer-color-dot ${c.hex === colorHex ? 'active' : ''}" data-color-hex="${c.hex}" title="${escapeHtml(c.name)}" style="background: ${c.hex};">
              </button>
            `
            ).join('')}
          </div>
        `;

        popover.addEventListener('click', (pe) => pe.stopPropagation());

        popover.querySelectorAll<HTMLButtonElement>('.song-customizer-icon-item').forEach((iBtn) => {
          iBtn.addEventListener('click', () => {
            const chosenKey = iBtn.dataset.iconKey;
            if (chosenKey && group.songRef && tasksUiOptions) {
              tasksUiOptions.onUpdateSongCustomization(group.songRef.id, { icon: chosenKey });
            }
          });
        });

        popover.querySelectorAll<HTMLButtonElement>('.song-customizer-color-dot').forEach((cBtn) => {
          cBtn.addEventListener('click', () => {
            const chosenHex = cBtn.dataset.colorHex;
            if (chosenHex && group.songRef && tasksUiOptions) {
              tasksUiOptions.onUpdateSongCustomization(group.songRef.id, { color: chosenHex });
            }
          });
        });

        section.appendChild(popover);

        const closeHandler = (docEv: MouseEvent) => {
          if (!popover.contains(docEv.target as Node) && docEv.target !== iconBtn) {
            popover.remove();
            document.removeEventListener('click', closeHandler);
          }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
      });
    }

    header.addEventListener('click', () => {
      if (tasksCollapsedGroups.has(group.id)) {
        tasksCollapsedGroups.delete(group.id);
        section.classList.remove('collapsed');
      } else {
        tasksCollapsedGroups.add(group.id);
        section.classList.add('collapsed');
      }
    });

    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'reminders-group-items';
    group.tasks.forEach((t) => itemsContainer.appendChild(renderListCard(t)));

    // Inline Quick Add Row at bottom of section
    const quickAddRow = document.createElement('div');
    quickAddRow.className = 'reminders-quick-add-row';
    quickAddRow.innerHTML = `
      <span class="reminders-dashed-circle"></span>
      <input type="text" class="reminders-quick-add-input" placeholder="" maxlength="150" />
    `;

    const quickInput = quickAddRow.querySelector<HTMLInputElement>('.reminders-quick-add-input');
    quickInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = quickInput.value.trim();
        if (val && tasksUiOptions) {
          let songTitle: string | undefined;
          if (group.defaultSongId && songs) {
            const s = songs.find((x) => x.id === group.defaultSongId);
            songTitle = s?.title;
          }
          tasksUiOptions.onCreateTask({
            title: val,
            songId: group.defaultSongId,
            songTitle,
            stage: group.defaultStage
          });
          quickInput.value = '';
        }
      }
    });

    // Section-level Drag & Drop Target
    section.addEventListener('dragover', (e) => {
      if (!draggedTaskId) return;
      e.preventDefault();
      section.classList.add('drag-over');
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });

    section.addEventListener('dragleave', (e) => {
      if (!section.contains(e.relatedTarget as Node)) {
        section.classList.remove('drag-over');
      }
    });

    section.addEventListener('drop', (e) => {
      if (!draggedTaskId || !tasksUiOptions) return;
      e.preventDefault();
      section.classList.remove('drag-over');

      let songId: string | null | undefined;
      let songTitle: string | null | undefined;
      if (group.defaultSongId !== undefined) {
        if (group.defaultSongId === '') {
          songId = null;
          songTitle = null;
        } else {
          songId = group.defaultSongId;
          const s = songs.find((x) => x.id === group.defaultSongId);
          songTitle = s?.title;
        }
      }

      let stage: ProjectTaskStage | null | undefined;
      if (group.defaultStage !== undefined) {
        stage = group.defaultStage === 'general' ? null : group.defaultStage;
      }

      currentSelectedTaskId = draggedTaskId;
      tasksUiOptions.onMoveTaskToGroup(draggedTaskId, { songId, songTitle, stage });
    });

    section.appendChild(header);
    section.appendChild(itemsContainer);
    section.appendChild(quickAddRow);
    return section;
  };

  // 10. Helper: Render Kanban Board
  const renderBoard = () => {
    const renderBoardCard = (task: ReadonlyTaskItem): HTMLElement => {
      const card = document.createElement('div');
      card.className = `board-task-card status-${task.status || 'todo'}`;
      card.dataset.taskId = task.id;
      card.setAttribute('draggable', 'true');

      const stageKey = task.stage || 'general';
      const stageCfg = STAGE_CONFIG[stageKey] || STAGE_CONFIG.general;
      const stageBadgeHtml = `<span class="task-stage-badge stage-${stageKey}">${stageCfg.iconSvg}<span>${escapeHtml(stageCfg.label)}</span></span>`;

      const linkedSong = songs.find((s) => s.id === task.songId);
      const songPillHtml = linkedSong
        ? `<span class="task-track-badge"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><span>${escapeHtml(linkedSong.title || 'Song')}</span></span>`
        : '';

      const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
      let subtasksPillHtml = '';
      if (subtasks.length > 0) {
        const doneSubs = subtasks.filter((s) => s.done).length;
        subtasksPillHtml = `<span class="task-subtasks-counter-pill"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><polyline points="20 6 9 17 4 12"/></svg><span>${doneSubs}/${subtasks.length}</span></span>`;
      }

      const assigneeInitial = task.assigneeName ? task.assigneeName.charAt(0).toUpperCase() : '';
      const assigneeHtml = task.assigneeName
        ? `<span class="board-card-assignee"><span class="task-meta-avatar">${escapeHtml(assigneeInitial)}</span><span>${escapeHtml(task.assigneeName)}</span></span>`
        : `<span class="board-card-assignee unassigned"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg><span>Unassigned</span></span>`;

      const dueHtml = task.dueDate
        ? `<span class="board-card-due" title="Due date"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-icon"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg><span>${escapeHtml(formatShortDate(task.dueDate))}</span></span>`
        : '';

      card.innerHTML = `
        <div class="board-card-top-row">
          <span class="board-card-title">${escapeHtml(task.title)}</span>
        </div>
        <div class="board-card-meta-row">
          ${stageBadgeHtml}
          ${songPillHtml}
          ${assigneeHtml}
          ${dueHtml}
          ${subtasksPillHtml}
        </div>
      `;

      card.addEventListener('dragstart', (e) => {
        draggedTaskId = task.id;
        card.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', task.id);
        }
      });

      card.addEventListener('dragend', () => {
        draggedTaskId = null;
        card.classList.remove('dragging');
        document.querySelectorAll('.board-column').forEach((col) => col.classList.remove('drag-over'));
      });

      // Right-click Context Menu
      card.addEventListener('contextmenu', (e) => {
        showTaskContextMenu(e, task);
      });

      return card;
    };

    const populateBoardInto = (
      todoEl: HTMLElement | null,
      inProgEl: HTMLElement | null,
      doneEl: HTMLElement | null,
      todoCountId: string,
      inProgCountId: string,
      doneCountId: string
    ) => {
      if (!todoEl || !inProgEl || !doneEl) return;
      todoEl.innerHTML = '';
      inProgEl.innerHTML = '';
      doneEl.innerHTML = '';

      const boardTasks = filteredTasks;
      const todoTasks = boardTasks.filter((t) => t.status === 'todo');
      const inProgTasks = boardTasks.filter((t) => t.status === 'in_progress');
      const doneTasks = boardTasks.filter((t) => t.status === 'done');

      setText(todoCountId, todoTasks.length.toString());
      setText(inProgCountId, inProgTasks.length.toString());
      setText(doneCountId, doneTasks.length.toString());

      todoTasks.forEach((t) => todoEl.appendChild(renderBoardCard(t)));
      inProgTasks.forEach((t) => inProgEl.appendChild(renderBoardCard(t)));
      doneTasks.forEach((t) => doneEl.appendChild(renderBoardCard(t)));
    };

    populateBoardInto(
      $('board-cards-todo'),
      $('board-cards-in_progress'),
      $('board-cards-done'),
      'board-count-todo',
      'board-count-in_progress',
      'board-count-done'
    );

    populateBoardInto(
      $('session-board-cards-todo'),
      $('session-board-cards-in_progress'),
      $('session-board-cards-done'),
      'session-board-count-todo',
      'session-board-count-in_progress',
      'session-board-count-done'
    );

    document.querySelectorAll<HTMLElement>('.board-column').forEach((col) => {
      const status = col.dataset.status as ProjectTaskStatus;
      if (!status) return;

      col.ondragover = (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        col.classList.add('drag-over');
      };

      col.ondragleave = () => {
        col.classList.remove('drag-over');
      };

      col.ondrop = (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const taskId = draggedTaskId || e.dataTransfer?.getData('text/plain');
        if (taskId && tasksUiOptions) {
          tasksUiOptions.onUpdateTaskStatus(taskId, status);
        }
      };
    });
  };

  // 11. Render Grouped Sections or Flat List into Target Containers
  const renderTasksIntoList = (container: HTMLElement) => {
    container.innerHTML = '';

    if (currentTasksGrouping === 'song') {
      // Group by track
      const defaultTrackPalette = ['#f43f5e', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ec4899', '#f97316'];
      const trackGroups: {
        id: string;
        title: string;
        iconKey?: string;
        colorHex?: string;
        iconSvg?: string;
        tasks: readonly ReadonlyTaskItem[];
        songRef?: ReadonlySongItem;
        defaultSongId?: string;
      }[] = [];

      songs.forEach((s, idx) => {
        const sTasks = filteredTasks.filter((t) => t.songId === s.id);
        const color = s.color || defaultTrackPalette[idx % defaultTrackPalette.length];
        const iconKey = s.icon || 'music';
        trackGroups.push({
          id: `song_${s.id}`,
          title: s.title || `Song ${idx + 1}`,
          songRef: s,
          iconKey,
          colorHex: color,
          iconSvg: SONG_ICONS[iconKey]?.svg || SONG_ICONS.music.svg,
          tasks: sTasks,
          defaultSongId: s.id
        });
      });

      const unassignedTasks = filteredTasks.filter((t) => !t.songId || !songs.some((s) => s.id === t.songId));
      trackGroups.push({
        id: 'song_general',
        title: 'General Tasks',
        iconKey: 'tag',
        colorHex: '#94a3b8',
        iconSvg: SONG_ICONS.tag.svg,
        tasks: unassignedTasks,
        defaultSongId: ''
      });

      trackGroups.forEach((grp) => {
        container.appendChild(renderGroupSection(grp));
      });
    } else if (currentTasksGrouping === 'stage') {
      const stageKeys: ProjectTaskStage[] = ['writing', 'recording', 'arrangement', 'mix', 'mastering', 'revisions', 'general'];
      const stageColors: Record<ProjectTaskStage, string> = {
        writing: '#8b5cf6',
        recording: '#f43f5e',
        arrangement: '#06b6d4',
        mix: '#f59e0b',
        mastering: '#10b981',
        revisions: '#ec4899',
        general: '#94a3b8'
      };
      stageKeys.forEach((stg) => {
        const stgTasks = filteredTasks.filter((t) => (t.stage || 'general') === stg);
        const cfg = STAGE_CONFIG[stg] || STAGE_CONFIG.general;
        container.appendChild(
          renderGroupSection({
            id: `stage_${stg}`,
            title: cfg.label,
            colorHex: stageColors[stg] || '#94a3b8',
            iconSvg: cfg.iconSvg,
            tasks: stgTasks,
            defaultStage: stg === 'general' ? undefined : stg
          })
        );
      });
    } else if (currentTasksGrouping === 'status') {
      const statusGroups: { id: string; title: string; status: ProjectTaskStatus; colorHex: string; iconSvg: string }[] = [
        {
          id: 'status_todo',
          title: 'To Do',
          status: 'todo',
          colorHex: '#94a3b8',
          iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>'
        },
        {
          id: 'status_in_progress',
          title: 'In Progress',
          status: 'in_progress',
          colorHex: '#f59e0b',
          iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>'
        },
        {
          id: 'status_done',
          title: 'Done',
          status: 'done',
          colorHex: '#10b981',
          iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
        }
      ];
      statusGroups.forEach((grp) => {
        const sTasks = filteredTasks.filter((t) => t.status === grp.status);
        container.appendChild(
          renderGroupSection({
            id: grp.id,
            title: grp.title,
            colorHex: grp.colorHex,
            iconSvg: grp.iconSvg,
            tasks: sTasks
          })
        );
      });
    } else {
      // Flat list
      filteredTasks.forEach((t) => container.appendChild(renderListCard(t)));
    }
  };

  if (listContainer) renderTasksIntoList(listContainer);
  if (sessionListContainer) renderTasksIntoList(sessionListContainer);

  if (boardContainer || sessionBoardContainer) {
    renderBoard();
  }

  // 12. Render Overview Tasks Preview Card
  const overviewListEl = $('overview-tasks-list');
  if (overviewListEl) {
    overviewListEl.innerHTML = '';
    const pendingTasks = tasks.filter((t) => t.status !== 'done');
    setText('overview-tasks-count', pendingTasks.length.toString());

    if (pendingTasks.length === 0) {
      overviewListEl.innerHTML = `
        <div class="projects-empty" style="padding: 16px;">
          <p style="margin: 0; font-size: 12.5px; color: #94a3b8;">${tasks.length > 0 ? 'All production tasks are completed! 🎉' : 'No tasks added yet. Click All Tasks to start tracking your to-dos.'}</p>
        </div>
      `;
    } else {
      pendingTasks.slice(0, 5).forEach((task) => {
        const item = document.createElement('div');
        item.className = `overview-task-item status-${task.status || 'todo'}`;
        const assigneeBadge = task.assigneeName ? `<span class="overview-task-assignee">${escapeHtml(task.assigneeName)}</span>` : '';
        const dueBadge = task.dueDate ? `<span class="overview-task-due">Due ${escapeHtml(task.dueDate)}</span>` : '';
        item.innerHTML = `
          <button type="button" class="reminders-check-btn" title="Mark as Done">
            ${task.status === 'done' ? '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
          </button>
          <span class="overview-task-title">${escapeHtml(task.title)}</span>
          ${assigneeBadge}
          ${dueBadge}
        `;
        item.querySelector('.reminders-check-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          tasksUiOptions?.onToggleTaskStatus(task.id);
        });
        overviewListEl.appendChild(item);
      });
    }
  }
}

// ========================================================
// INITIALIZATION & EVENT LISTENERS
// ========================================================

export function initTasksUi(options: TasksUiOptions): void {
  tasksUiOptions = options;

  if (listenersBound) return;
  listenersBound = true;

  // Search Input Live Filter
  $('tasks-search-input')?.addEventListener('input', (e) => {
    currentTasksSearchQuery = (e.target as HTMLInputElement).value.trim();
    const sessionSearch = $<HTMLInputElement>('session-tasks-search-input');
    if (sessionSearch && sessionSearch.value !== currentTasksSearchQuery) sessionSearch.value = currentTasksSearchQuery;
    renderTasksWorkspace();
  });

  $('session-tasks-search-input')?.addEventListener('input', (e) => {
    currentTasksSearchQuery = (e.target as HTMLInputElement).value.trim();
    const mainSearch = $<HTMLInputElement>('tasks-search-input');
    if (mainSearch && mainSearch.value !== currentTasksSearchQuery) mainSearch.value = currentTasksSearchQuery;
    renderTasksWorkspace();
  });

  // Group By Select
  $('tasks-group-by')?.addEventListener('change', (e) => {
    currentTasksGrouping = ((e.target as HTMLSelectElement).value as any) || 'song';
    renderTasksWorkspace();
  });

  $('session-tasks-group-by')?.addEventListener('change', (e) => {
    currentTasksGrouping = ((e.target as HTMLSelectElement).value as any) || 'song';
    renderTasksWorkspace();
  });

  // Toggle Show/Hide Completed
  $('btn-tasks-toggle-completed')?.addEventListener('click', () => {
    showCompletedTasks = !showCompletedTasks;
    renderTasksWorkspace();
  });

  $('session-btn-tasks-toggle-completed')?.addEventListener('click', () => {
    showCompletedTasks = !showCompletedTasks;
    renderTasksWorkspace();
  });

  // Click on empty window background to collapse open task
  document.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    if (!target) return;
    if (target.closest('.reminders-task-row, .reminders-inspector-popover, .task-context-menu, .song-customizer-popover, select, option, .task-action-pill')) {
      return;
    }
    if (currentSelectedTaskId !== null) {
      currentSelectedTaskId = null;
      document.querySelectorAll('.reminders-task-row.is-selected').forEach((r) => r.classList.remove('is-selected'));
    }
  });

  // Create Task Form Submit (Main Workspace)
  $('form-create-task')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!tasksUiOptions) return;
    const titleInput = $<HTMLInputElement>('task-new-title');
    const songSelect = $<HTMLSelectElement>('task-new-song');
    const stageSelect = $<HTMLSelectElement>('task-new-stage');
    const assigneeSelect = $<HTMLSelectElement>('task-new-assignee');
    const dateInput = $<HTMLInputElement>('task-new-duedate');
    if (!titleInput) return;

    const title = titleInput.value.trim();
    if (!title) return;

    let aId: string | undefined;
    let aName: string | undefined;
    if (assigneeSelect && assigneeSelect.value) {
      const parts = assigneeSelect.value.split('|');
      aId = parts[0];
      aName = parts[1];
    }

    const songId = songSelect?.value || undefined;
    let songTitle: string | undefined;
    if (songId) {
      const songs = tasksUiOptions.getSongs();
      const matched = songs.find((s) => s.id === songId);
      songTitle = matched?.title;
    }

    const stageVal = stageSelect?.value as ProjectTaskStage | 'general';
    const stage = stageVal && stageVal !== 'general' ? stageVal : undefined;
    const dueDate = dateInput?.value || undefined;

    tasksUiOptions.onCreateTask({
      title,
      assigneeId: aId,
      assigneeName: aName,
      dueDate,
      songId,
      songTitle,
      stage
    });
    titleInput.value = '';
    titleInput.focus();
  });

  // Create Task Form Submit (In-Session Drawer)
  $('session-form-create-task')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!tasksUiOptions) return;
    const titleInput = $<HTMLInputElement>('session-task-new-title');
    const songSelect = $<HTMLSelectElement>('session-task-new-song');
    const stageSelect = $<HTMLSelectElement>('session-task-new-stage');
    const assigneeSelect = $<HTMLSelectElement>('session-task-new-assignee');
    const dateInput = $<HTMLInputElement>('session-task-new-duedate');
    if (!titleInput) return;

    const title = titleInput.value.trim();
    if (!title) return;

    let aId: string | undefined;
    let aName: string | undefined;
    if (assigneeSelect && assigneeSelect.value) {
      const parts = assigneeSelect.value.split('|');
      aId = parts[0];
      aName = parts[1];
    }

    const songId = songSelect?.value || undefined;
    let songTitle: string | undefined;
    if (songId) {
      const songs = tasksUiOptions.getSongs();
      const matched = songs.find((s) => s.id === songId);
      songTitle = matched?.title;
    }

    const stageVal = stageSelect?.value as ProjectTaskStage | 'general';
    const stage = stageVal && stageVal !== 'general' ? stageVal : undefined;
    const dueDate = dateInput?.value || undefined;

    tasksUiOptions.onCreateTask({
      title,
      assigneeId: aId,
      assigneeName: aName,
      dueDate,
      songId,
      songTitle,
      stage
    });
    titleInput.value = '';
    titleInput.focus();
  });

  // View Switcher Handlers
  $('btn-tasks-view-list')?.addEventListener('click', () => {
    currentTasksViewMode = 'list';
    renderTasksWorkspace();
  });

  $('session-btn-tasks-view-list')?.addEventListener('click', () => {
    currentTasksViewMode = 'list';
    renderTasksWorkspace();
  });

  $('btn-tasks-view-board')?.addEventListener('click', () => {
    currentTasksViewMode = 'board';
    renderTasksWorkspace();
  });

  $('session-btn-tasks-view-board')?.addEventListener('click', () => {
    currentTasksViewMode = 'board';
    renderTasksWorkspace();
  });

  // Filter Dropdown Handlers
  $('tasks-filter-song')?.addEventListener('change', (e) => {
    currentTasksSongFilter = (e.target as HTMLSelectElement).value || 'all';
    renderTasksWorkspace();
  });

  $('session-tasks-filter-song')?.addEventListener('change', (e) => {
    currentTasksSongFilter = (e.target as HTMLSelectElement).value || 'all';
    renderTasksWorkspace();
  });

  $('tasks-filter-stage')?.addEventListener('change', (e) => {
    currentTasksStageFilter = (e.target as HTMLSelectElement).value || 'all';
    renderTasksWorkspace();
  });

  $('session-tasks-filter-stage')?.addEventListener('change', (e) => {
    currentTasksStageFilter = (e.target as HTMLSelectElement).value || 'all';
    renderTasksWorkspace();
  });

  // View All Tasks from Overview
  $('btn-overview-view-tasks')?.addEventListener('click', () => {
    if (tasksUiOptions?.onNavigateToTasksTab) {
      tasksUiOptions.onNavigateToTasksTab();
    } else {
      const taskTabBtn = document.querySelector<HTMLButtonElement>('.project-tab-btn[data-tab="tasks"]');
      taskTabBtn?.click();
    }
  });
}
