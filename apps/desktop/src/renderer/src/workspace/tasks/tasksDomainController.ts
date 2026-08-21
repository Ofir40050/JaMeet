import type { Project, ProjectTaskItem } from '@jameet/shared';
import { initTasksController } from './tasksController';
import { initTasksPersistence } from './tasksPersistence';
import { initTasksUiController } from './tasksUiController';

export interface TasksDomainControllerOptions {
  getProject: () => Project | null | undefined;
  getAuthToken: () => string | null;
  canUserEditProject: () => boolean;
  onRenderTasksWorkspace: () => void;
  onDebounceSaveTasks: () => void;
  onClearTasksSaveTimeout: () => void;
  onSaveTasksWorkspace: () => Promise<void>;
  getTasks: () => ProjectTaskItem[];
  getWorkspaceContextGen: () => number;
  getTasksEditGen: () => number;
  getTasksSaveGen: () => number;
  incrementTasksEditGen: () => number;
  incrementTasksSaveGen: () => number;
  setTasksStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  onUpdateSignaling: (projectId: string, payload: { area: string; tasks?: ProjectTaskItem[]; workspace?: any }, token?: string) => Promise<any>;
  onApplyAuthoritativeWorkspace: (area: string, workspace: any) => void;
  onUpdateSongCustomization: (songId: string, changes: { icon?: string; color?: string }) => void;
}

export function initTasksDomainController(options: TasksDomainControllerOptions): void {
  initTasksController({
    getProject: () => options.getProject(),
    canEdit: () => options.canUserEditProject(),
    onRenderTasksWorkspace: () => {
      options.onRenderTasksWorkspace();
    },
    onDebounceSaveTasks: () => {
      options.onDebounceSaveTasks();
    },
    onFlushSaveTasks: () => {
      options.onClearTasksSaveTimeout();
      void options.onSaveTasksWorkspace();
    }
  });

  initTasksPersistence({
    getProject: () => options.getProject(),
    getAuthToken: () => options.getAuthToken(),
    canEdit: () => options.canUserEditProject(),
    getTasks: () => options.getTasks(),
    getWorkspaceContextGen: () => options.getWorkspaceContextGen(),
    getTasksEditGen: () => options.getTasksEditGen(),
    getTasksSaveGen: () => options.getTasksSaveGen(),
    incrementTasksEditGen: () => options.incrementTasksEditGen(),
    incrementTasksSaveGen: () => options.incrementTasksSaveGen(),
    setTasksStatus: (status) => {
      options.setTasksStatus(status);
    },
    onUpdateSignaling: async (projectId, payload, token) => {
      return options.onUpdateSignaling(projectId, payload, token);
    },
    onApplyAuthoritativeWorkspace: (area, workspace) => {
      options.onApplyAuthoritativeWorkspace(area, workspace);
    }
  });

  initTasksUiController({
    getProject: () => options.getProject(),
    canEdit: () => options.canUserEditProject(),
    onUpdateSongCustomization: (songId, changes) => {
      options.onUpdateSongCustomization(songId, changes);
    }
  });
}
