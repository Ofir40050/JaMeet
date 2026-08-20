import type {
  Project,
  ProjectTaskItem,
  ProjectTaskStage,
  ProjectTaskStatus
} from '@jameet/shared';
import type { TaskFieldUpdate } from './tasksUi';
import { normalizeProjectTasks } from './tasksState';
import {
  mutateCreateTask,
  mutateQuickToggleTask,
  mutateUpdateTaskStatus,
  mutateDeleteTask
} from './taskMutations';
import { mutateDuplicateTask } from './taskDuplication';

export interface TasksControllerOptions {
  getProject: () => Project | null | undefined;
  canEdit: () => boolean;
  onRenderTasksWorkspace: () => void;
  onDebounceSaveTasks: () => void;
  onFlushSaveTasks: () => void;
}

let controllerOptions: TasksControllerOptions | null = null;

export function initTasksController(options: TasksControllerOptions): void {
  controllerOptions = options;
}

export function getProjectTasks(): ProjectTaskItem[] {
  if (!controllerOptions) return [];
  const project = controllerOptions.getProject();
  return normalizeProjectTasks(project);
}

export function createTask(
  title: string,
  assigneeId?: string,
  assigneeName?: string,
  dueDate?: string,
  note?: string,
  songId?: string,
  songTitle?: string,
  stage?: ProjectTaskStage
): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const tasks = getProjectTasks();
  const newId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const created = mutateCreateTask(
    tasks,
    title,
    newId,
    assigneeId,
    assigneeName,
    dueDate,
    note,
    songId,
    songTitle,
    stage
  );
  if (!created) return;
  controllerOptions.onRenderTasksWorkspace();
  controllerOptions.onDebounceSaveTasks();
}

export function quickToggleTask(id: string): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const tasks = getProjectTasks();
  const changed = mutateQuickToggleTask(tasks, id);
  if (!changed) return;
  controllerOptions.onRenderTasksWorkspace();
  controllerOptions.onDebounceSaveTasks();
}

export function updateTaskStatus(id: string, status: ProjectTaskStatus): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const tasks = getProjectTasks();
  const changed = mutateUpdateTaskStatus(tasks, id, status);
  if (!changed) return;
  controllerOptions.onRenderTasksWorkspace();
  controllerOptions.onDebounceSaveTasks();
}

export function deleteTask(id: string): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const tasks = getProjectTasks();
  const changed = mutateDeleteTask(tasks, id);
  if (!changed) return;
  controllerOptions.onRenderTasksWorkspace();
  controllerOptions.onDebounceSaveTasks();
}

export function duplicateTask(taskId: string): void {
  if (!controllerOptions) return;
  const tasks = getProjectTasks();
  const now = Date.now();
  const newTaskId = `task_${now}_${Math.random().toString(36).substring(2, 7)}`;
  const copy = mutateDuplicateTask(
    tasks,
    taskId,
    newTaskId,
    () => `sub_${now}_${Math.random().toString(36).substring(2, 6)}`,
    now
  );
  if (!copy) return;
  controllerOptions.onRenderTasksWorkspace();
  controllerOptions.onDebounceSaveTasks();
}

export function updateTaskField(
  taskId: string,
  changes: TaskFieldUpdate,
  options?: { immediateFlush?: boolean; rerender?: boolean }
): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const tasks = getProjectTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  if (changes.title !== undefined) task.title = changes.title;
  if (changes.note !== undefined) task.note = changes.note || undefined;
  if (changes.dueDate !== undefined) task.dueDate = changes.dueDate || undefined;
  if (changes.stage !== undefined) task.stage = changes.stage || undefined;
  if (changes.songId !== undefined) task.songId = changes.songId || undefined;
  if (changes.songTitle !== undefined) task.songTitle = changes.songTitle || undefined;
  if (changes.assigneeId !== undefined) task.assigneeId = changes.assigneeId || undefined;
  if (changes.assigneeName !== undefined) task.assigneeName = changes.assigneeName || undefined;
  if (changes.priority !== undefined) task.priority = changes.priority;

  task.updatedAt = Date.now();

  if (options?.rerender) {
    controllerOptions.onRenderTasksWorkspace();
  }

  if (options?.immediateFlush) {
    controllerOptions.onFlushSaveTasks();
  } else {
    controllerOptions.onDebounceSaveTasks();
  }
}

export function reorderTasks(
  draggedTaskId: string,
  targetTaskId: string,
  insertAfter: boolean,
  inheritedChanges?: {
    songId?: string | null;
    songTitle?: string | null;
    stage?: ProjectTaskStage | null;
    status?: ProjectTaskStatus;
  }
): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const tasks = getProjectTasks();
  const draggedIndex = tasks.findIndex((t) => t.id === draggedTaskId);
  const targetIndex = tasks.findIndex((t) => t.id === targetTaskId);
  if (draggedIndex === -1 || targetIndex === -1) return;

  const [draggedItem] = tasks.splice(draggedIndex, 1);

  if (inheritedChanges) {
    if (inheritedChanges.songId !== undefined) {
      draggedItem.songId = inheritedChanges.songId || undefined;
      draggedItem.songTitle = inheritedChanges.songTitle || undefined;
    }
    if (inheritedChanges.stage !== undefined) {
      draggedItem.stage = inheritedChanges.stage || undefined;
    }
    if (inheritedChanges.status !== undefined) {
      draggedItem.status = inheritedChanges.status;
    }
  }

  const newTargetIndex = tasks.findIndex((t) => t.id === targetTaskId);
  const insertIndex = insertAfter ? newTargetIndex + 1 : newTargetIndex;
  tasks.splice(insertIndex, 0, draggedItem);

  draggedItem.updatedAt = Date.now();
  controllerOptions.onRenderTasksWorkspace();
  controllerOptions.onDebounceSaveTasks();
}

export function moveTaskToGroup(
  draggedTaskId: string,
  groupChanges: {
    songId?: string | null;
    songTitle?: string | null;
    stage?: ProjectTaskStage | null;
  }
): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const tasks = getProjectTasks();
  const draggedTask = tasks.find((t) => t.id === draggedTaskId);
  if (!draggedTask) return;

  if (groupChanges.songId !== undefined) {
    draggedTask.songId = groupChanges.songId || undefined;
    draggedTask.songTitle = groupChanges.songTitle || undefined;
  }
  if (groupChanges.stage !== undefined) {
    draggedTask.stage = groupChanges.stage || undefined;
  }

  draggedTask.updatedAt = Date.now();
  controllerOptions.onRenderTasksWorkspace();
  controllerOptions.onDebounceSaveTasks();
}

export function addSubtask(taskId: string, title: string): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const trimmed = title.trim();
  if (!trimmed) return;
  const tasks = getProjectTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (!Array.isArray(task.subtasks)) task.subtasks = [];
  task.subtasks.push({
    id: `sub_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    title: trimmed,
    done: false
  });
  task.updatedAt = Date.now();
  controllerOptions.onRenderTasksWorkspace();
  controllerOptions.onDebounceSaveTasks();
}

export function toggleSubtask(taskId: string, subtaskId: string): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const tasks = getProjectTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task || !Array.isArray(task.subtasks)) return;
  const sub = task.subtasks.find((s) => s.id === subtaskId);
  if (!sub) return;
  sub.done = !sub.done;
  task.updatedAt = Date.now();
  controllerOptions.onRenderTasksWorkspace();
  controllerOptions.onDebounceSaveTasks();
}

export function deleteSubtask(taskId: string, subtaskId: string): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const tasks = getProjectTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task || !Array.isArray(task.subtasks)) return;
  task.subtasks = task.subtasks.filter((s) => s.id !== subtaskId);
  task.updatedAt = Date.now();
  controllerOptions.onRenderTasksWorkspace();
  controllerOptions.onDebounceSaveTasks();
}

export function updateSubtaskTitle(taskId: string, subtaskId: string, title: string): void {
  if (!controllerOptions || !controllerOptions.canEdit()) return;
  const tasks = getProjectTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task || !Array.isArray(task.subtasks)) return;
  const sub = task.subtasks.find((s) => s.id === subtaskId);
  if (!sub) return;
  sub.title = title;
  task.updatedAt = Date.now();
  controllerOptions.onRenderTasksWorkspace();
  controllerOptions.onDebounceSaveTasks();
}
