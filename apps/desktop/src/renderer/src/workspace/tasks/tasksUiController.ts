import type { Project } from '@jameet/shared';
import {
  initTasksUi,
  type TaskCollaboratorOption,
  type TaskFieldUpdate
} from './tasksUi';
import {
  getProjectTasks,
  createTask,
  quickToggleTask,
  updateTaskStatus,
  deleteTask,
  duplicateTask,
  updateTaskField,
  reorderTasks,
  moveTaskToGroup,
  addSubtask,
  toggleSubtask,
  deleteSubtask,
  updateSubtaskTitle
} from './tasksController';

export interface TasksUiControllerOptions {
  getProject: () => Project | null | undefined;
  canEdit: () => boolean;
  onUpdateSongCustomization: (songId: string, changes: { icon?: string; color?: string }) => void;
}

export function initTasksUiController(options: TasksUiControllerOptions): void {
  initTasksUi({
    getTasks: () => getProjectTasks(),
    getSongs: () => options.getProject()?.workspace?.songs || [],
    getCollaborators: () => {
      const list: TaskCollaboratorOption[] = [];
      const project = options.getProject();
      if (project?.ownerId) {
        list.push({
          userId: project.ownerId,
          displayName: project.ownerDisplayName || project.ownerUsername || 'Owner',
          username: project.ownerUsername,
          isOwner: true
        });
      }
      if (Array.isArray(project?.collaborators)) {
        for (const c of project.collaborators) {
          if (c.userId !== project?.ownerId) {
            list.push({
              userId: c.userId,
              displayName: c.displayName,
              username: c.username,
              isOwner: false
            });
          }
        }
      }
      return list;
    },
    canEdit: () => options.canEdit(),
    onCreateTask: (data) => {
      createTask(
        data.title,
        data.assigneeId,
        data.assigneeName,
        data.dueDate,
        data.note,
        data.songId,
        data.songTitle,
        data.stage
      );
    },
    onLiveUpdateTaskField: (taskId, changes) => {
      updateTaskField(taskId, changes, { rerender: false });
    },
    onCommitTaskField: (taskId, changes, optionsParam) => {
      updateTaskField(taskId, changes, optionsParam);
    },
    onToggleTaskStatus: (taskId) => {
      quickToggleTask(taskId);
    },
    onUpdateTaskStatus: (taskId, status) => {
      updateTaskStatus(taskId, status);
    },
    onDeleteTask: (taskId) => {
      deleteTask(taskId);
    },
    onDuplicateTask: (taskId) => {
      duplicateTask(taskId);
    },
    onReorderTasks: (draggedTaskId, targetTaskId, insertAfter, inheritedChanges) => {
      reorderTasks(draggedTaskId, targetTaskId, insertAfter, inheritedChanges);
    },
    onMoveTaskToGroup: (draggedTaskId, groupChanges) => {
      moveTaskToGroup(draggedTaskId, groupChanges);
    },
    onAddSubtask: (taskId, title) => {
      addSubtask(taskId, title);
    },
    onToggleSubtask: (taskId, subtaskId) => {
      toggleSubtask(taskId, subtaskId);
    },
    onDeleteSubtask: (taskId, subtaskId) => {
      deleteSubtask(taskId, subtaskId);
    },
    onLiveUpdateSubtask: (taskId, subtaskId, title) => {
      updateSubtaskTitle(taskId, subtaskId, title);
    },
    onUpdateSongCustomization: (songId, changes) => {
      options.onUpdateSongCustomization(songId, changes);
    }
  });
}
