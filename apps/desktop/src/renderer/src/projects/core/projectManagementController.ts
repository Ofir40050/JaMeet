import type { ProjectItem } from './projects';
import {
  initProjectArchiveController,
  handleArchiveProject
} from '../archive/projectArchiveController';
import { initProjectMenuUi } from '../navigation/projectMenuUi';
import {
  initProjectRenameController,
  handleTriggerRename,
  handleSaveRename
} from '../rename/projectRenameController';
import { initProjectRenameUi } from '../rename/projectRenameUi';
import {
  initProjectDeleteController,
  handleTriggerDelete,
  handleConfirmDelete
} from '../delete/projectDeleteController';
import { initProjectDeleteUi } from '../delete/projectDeleteUi';
import {
  initProjectCreateController,
  handleCreateProject
} from '../create/projectCreateController';
import { initProjectCreateUi } from '../create/projectCreateUi';
import { openProjectView } from './projectOpenController';

export interface ProjectManagementControllerOptions {
  getAuthToken: () => string | null;
  getProject: () => ProjectItem | null | undefined;
  onProjectUpdated: (updated: ProjectItem) => void;
  onRefreshProjectView: () => void;
  onRefreshProjectsList: () => Promise<void> | void;
  onProjectDeleted: () => void;
  onNavigateHome: () => void;
}

export function initProjectManagementController(
  options: ProjectManagementControllerOptions
): void {
  initProjectArchiveController({
    getAuthToken: () => options.getAuthToken(),
    getProject: () => options.getProject(),
    onProjectUpdated: (updated) => {
      options.onProjectUpdated(updated);
    },
    onRefreshProjectView: () => {
      options.onRefreshProjectView();
    },
    onRefreshProjectsList: () => {
      void options.onRefreshProjectsList();
    }
  });

  initProjectMenuUi({
    onArchiveProject: () => {
      void handleArchiveProject();
    }
  });

  initProjectRenameController({
    getAuthToken: () => options.getAuthToken(),
    getProject: () => options.getProject(),
    onProjectUpdated: (updated) => {
      options.onProjectUpdated(updated);
    },
    onRefreshProjectView: () => {
      options.onRefreshProjectView();
    },
    onRefreshProjectsList: () => {
      void options.onRefreshProjectsList();
    }
  });

  initProjectRenameUi({
    onTriggerRename: () => {
      handleTriggerRename();
    },
    onSave: (data) => {
      void handleSaveRename(data);
    }
  });

  initProjectDeleteController({
    getAuthToken: () => options.getAuthToken(),
    getProject: () => options.getProject(),
    onProjectDeleted: () => {
      options.onProjectDeleted();
    },
    onNavigateHome: () => {
      options.onNavigateHome();
    },
    onRefreshProjectsList: async () => {
      await options.onRefreshProjectsList();
    }
  });

  initProjectDeleteUi({
    onTriggerDelete: () => {
      handleTriggerDelete();
    },
    getProjectName: () => options.getProject()?.name,
    onConfirmDelete: () => {
      void handleConfirmDelete();
    }
  });

  initProjectCreateController({
    getAuthToken: () => options.getAuthToken(),
    onRefreshProjectsList: async () => {
      await options.onRefreshProjectsList();
    },
    onOpenProject: async (projectId) => {
      await openProjectView(projectId);
    }
  });

  initProjectCreateUi({
    onCreateProject: (data) => {
      void handleCreateProject(data);
    }
  });
}
