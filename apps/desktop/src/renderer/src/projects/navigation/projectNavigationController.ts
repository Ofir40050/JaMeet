import type { Project } from '@jameet/shared';
import { initProjectNavigationUi } from './projectNavigationUi';

export interface ProjectNavigationControllerOptions {
  getProject: () => Project | null | undefined;
  onClearActiveProject: () => void;
  onFlushPendingSaves: () => Promise<void>;
  onShowHomeView: () => void;
  onLoadProjects: () => Promise<void> | void;
  onPrepareStudio: (action: { type: 'create' }) => Promise<void>;
  onSetActiveProjectId: (id: string) => void;
}

export function initProjectNavigationController(
  options: ProjectNavigationControllerOptions
): void {
  initProjectNavigationUi({
    onRefreshProjects: () => {
      void options.onLoadProjects();
    },
    onExitProject: async () => {
      const project = options.getProject();
      if (project?.workspace) {
        await options.onFlushPendingSaves();
      }
      options.onClearActiveProject();
      options.onShowHomeView();
      void options.onLoadProjects();
    },
    onStartSession: async () => {
      const project = options.getProject();
      if (!project) return;
      await options.onFlushPendingSaves();
      options.onSetActiveProjectId(project.id);
      await options.onPrepareStudio({ type: 'create' });
    }
  });
}
