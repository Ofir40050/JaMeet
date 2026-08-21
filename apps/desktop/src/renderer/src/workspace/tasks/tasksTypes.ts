import type { ProjectTaskStatus, ProjectTaskStage } from "@jameet/shared";

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
