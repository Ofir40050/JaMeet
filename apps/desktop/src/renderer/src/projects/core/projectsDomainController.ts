import type { Project, UserProfile } from '@jameet/shared';
import { initProjectsListController } from './projectsListController';
import { initProjectsListUi } from './projectsListUi';
import { initProjectViewController } from './projectViewController';
import { openProjectView } from './projectOpenController';

export interface ProjectsDomainControllerOptions {
  getAuthToken: () => string | null;
  getUser: () => UserProfile | null;
  onProjectsLoaded: (projects: Project[]) => void;
  getProject: () => Project | null | undefined;
  renderCollaborators: () => void;
  applyWorkspacePermissions: () => void;
}

export function initProjectsDomainController(options: ProjectsDomainControllerOptions): void {
  initProjectsListController({
    getAuthToken: () => options.getAuthToken(),
    getUser: () => options.getUser(),
    onProjectsLoaded: (projects) => {
      options.onProjectsLoaded(projects);
    }
  });

  initProjectsListUi({
    onOpenProject: (projectId) => {
      void openProjectView(projectId);
    }
  });

  initProjectViewController({
    getProject: () => options.getProject(),
    getUser: () => options.getUser(),
    renderCollaborators: () => {
      options.renderCollaborators();
    },
    applyWorkspacePermissions: () => {
      options.applyWorkspacePermissions();
    }
  });
}
