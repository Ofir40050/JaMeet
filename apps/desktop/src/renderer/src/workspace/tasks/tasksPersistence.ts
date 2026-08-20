import type { Project, ProjectTaskItem } from '@jameet/shared';
import * as projectsApi from '../../projects/core/projects';

export interface TasksPersistenceOptions {
  getProject: () => Project | null | undefined;
  getAuthToken: () => string | null;
  canEdit: () => boolean;
  getTasks: () => ProjectTaskItem[];
  getWorkspaceContextGen: () => number;
  getTasksEditGen: () => number;
  getTasksSaveGen: () => number;
  incrementTasksEditGen: () => number;
  incrementTasksSaveGen: () => number;
  setTasksStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  onUpdateSignaling: (
    projectId: string,
    payload: any,
    token: string
  ) => Promise<{ ok: boolean; conflict?: boolean; code?: string; workspace?: any; project?: any; currentRevision?: number } | null>;
  onApplyAuthoritativeWorkspace: (area: 'tasks', workspace: any) => void;
}

let persistenceOptions: TasksPersistenceOptions | null = null;
let tasksSaveTimeout: ReturnType<typeof setTimeout> | null = null;

export function initTasksPersistence(options: TasksPersistenceOptions): void {
  persistenceOptions = options;
}

export function hasTasksSaveTimeout(): boolean {
  return tasksSaveTimeout !== null;
}

export function clearTasksSaveTimeout(): void {
  if (tasksSaveTimeout) {
    clearTimeout(tasksSaveTimeout);
    tasksSaveTimeout = null;
  }
}

export function debounceSaveTasks(): void {
  if (!persistenceOptions) return;
  persistenceOptions.incrementTasksEditGen();
  persistenceOptions.setTasksStatus('saving');
  if (tasksSaveTimeout) clearTimeout(tasksSaveTimeout);
  tasksSaveTimeout = setTimeout(() => {
    tasksSaveTimeout = null;
    void saveTasksWorkspace();
  }, 350);
}

export async function saveTasksWorkspace(): Promise<void> {
  if (!persistenceOptions) return;
  const activeProject = persistenceOptions.getProject();
  if (!activeProject) return;

  const token = persistenceOptions.getAuthToken();
  if (!token) {
    persistenceOptions.setTasksStatus('unsaved');
    return;
  }

  const targetProjectId = activeProject.id;
  const targetContextGen = persistenceOptions.getWorkspaceContextGen();
  const targetEditGen = persistenceOptions.getTasksEditGen();
  const targetSaveGen = persistenceOptions.incrementTasksSaveGen();
  const baseRevision = activeProject.workspace?.tasks?.revision ?? 1;
  const tasks = persistenceOptions.getTasks().map((t) => ({
    id: t.id,
    title: t.title?.trim() || 'Untitled Task',
    status: t.status || 'todo',
    assigneeId: t.assigneeId || undefined,
    assigneeName: t.assigneeName || undefined,
    songId: t.songId || undefined,
    songTitle: t.songTitle || undefined,
    stage: t.stage || undefined,
    subtasks: Array.isArray(t.subtasks) && t.subtasks.length > 0 ? t.subtasks.map((st) => ({
      id: st.id,
      title: st.title.trim(),
      done: Boolean(st.done)
    })) : undefined,
    note: t.note && t.note.trim() ? t.note.trim() : undefined,
    dueDate: t.dueDate || undefined,
    createdAt: t.createdAt || Date.now(),
    completedAt: t.completedAt || undefined,
    updatedAt: t.updatedAt || Date.now()
  }));

  try {
    let res = await persistenceOptions.onUpdateSignaling(targetProjectId, {
      tasks: { baseRevision, tasks }
    }, token);

    if (!res?.ok && !res?.conflict && res?.code !== 'WORKSPACE_CONFLICT') {
      try {
        const httpRes = await projectsApi.updateProjectWorkspace(token, targetProjectId, {
          tasks: { baseRevision, tasks }
        });
        if (httpRes?.workspace) {
          res = { ok: true, workspace: httpRes.workspace, project: httpRes.project };
        }
      } catch (httpErr: any) {
        console.warn('HTTP workspace update fallback failed for tasks:', httpErr);
      }
    }

    // If the server responded with a newer revision, always record it to prevent 409 conflict loops
    if (res?.ok && res.workspace?.tasks?.revision && activeProject?.workspace?.tasks) {
      activeProject.workspace.tasks.revision = res.workspace.tasks.revision;
    }

    const currentProject = persistenceOptions.getProject();
    const isLatest =
      currentProject?.id === targetProjectId &&
      targetContextGen === persistenceOptions.getWorkspaceContextGen() &&
      targetSaveGen === persistenceOptions.getTasksSaveGen() &&
      targetEditGen === persistenceOptions.getTasksEditGen();

    if (!isLatest) return;

    if (res?.ok && res.workspace && currentProject) {
      persistenceOptions.onApplyAuthoritativeWorkspace('tasks', res.workspace);
      persistenceOptions.setTasksStatus('saved');
    } else if (res?.conflict || res?.code === 'WORKSPACE_CONFLICT') {
      if (res.workspace?.tasks?.revision && currentProject?.workspace?.tasks) {
        currentProject.workspace.tasks.revision = res.workspace.tasks.revision;
      } else if (res.currentRevision && currentProject?.workspace?.tasks) {
        currentProject.workspace.tasks.revision = res.currentRevision;
      }
      persistenceOptions.setTasksStatus('saving');
      debounceSaveTasks();
    } else {
      persistenceOptions.setTasksStatus('unsaved');
    }
  } catch (err) {
    console.error('Failed to save tasks workspace:', err);
    const currentProject = persistenceOptions.getProject();
    const isLatest =
      currentProject?.id === targetProjectId &&
      targetContextGen === persistenceOptions.getWorkspaceContextGen() &&
      targetSaveGen === persistenceOptions.getTasksSaveGen() &&
      targetEditGen === persistenceOptions.getTasksEditGen();

    if (isLatest) {
      persistenceOptions.setTasksStatus('unsaved');
    }
  }
}
