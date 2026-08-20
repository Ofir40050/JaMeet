import type { ProjectTaskItem, ProjectTaskStage, ProjectTaskStatus } from '@jameet/shared';

export function mutateCreateTask(
  tasks: ProjectTaskItem[],
  title: string,
  newId: string,
  assigneeId?: string,
  assigneeName?: string,
  dueDate?: string,
  note?: string,
  songId?: string,
  songTitle?: string,
  stage?: ProjectTaskStage,
  now: number = Date.now()
): ProjectTaskItem | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const newTask: ProjectTaskItem = {
    id: newId,
    title: trimmed,
    status: 'todo',
    assigneeId: assigneeId || undefined,
    assigneeName: assigneeName || undefined,
    songId: songId || undefined,
    songTitle: songTitle || undefined,
    stage: stage || undefined,
    subtasks: [],
    dueDate: dueDate || undefined,
    note: note || undefined,
    createdAt: now,
    updatedAt: now
  };
  tasks.unshift(newTask);
  return newTask;
}

export function mutateQuickToggleTask(
  tasks: ProjectTaskItem[],
  id: string,
  now: number = Date.now()
): boolean {
  const task = tasks.find((t) => t.id === id);
  if (!task) return false;
  if (task.status === 'done') {
    task.status = 'todo';
    task.completedAt = undefined;
  } else {
    task.status = 'done';
    task.completedAt = now;
  }
  task.updatedAt = now;
  return true;
}

export function mutateUpdateTaskStatus(
  tasks: ProjectTaskItem[],
  id: string,
  status: ProjectTaskStatus,
  now: number = Date.now()
): boolean {
  const task = tasks.find((t) => t.id === id);
  if (!task) return false;
  task.status = status;
  if (status === 'done') {
    task.completedAt = now;
  } else {
    task.completedAt = undefined;
  }
  task.updatedAt = now;
  return true;
}

export function mutateDeleteTask(
  tasks: ProjectTaskItem[],
  id: string
): boolean {
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  tasks.splice(idx, 1);
  return true;
}
