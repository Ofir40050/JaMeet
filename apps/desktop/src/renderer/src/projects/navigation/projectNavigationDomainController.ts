import type { Project } from '@jameet/shared';
import { initProjectNavigationController } from './projectNavigationController';

export interface ProjectNavigationDomainControllerOptions {
  getProject: () => Project | null | undefined;
  onClearActiveProject: () => void;
  onFlushPendingSaves: () => Promise<void>;
  onShowHomeView: () => void;
  onLoadProjects: () => Promise<void>;
  onPrepareStudio: (action: { type: 'create' }) => Promise<void>;
  onSetActiveProjectId: (id: string) => void;
}

export function initProjectNavigationDomainController(
  options: ProjectNavigationDomainControllerOptions
): void {
  initProjectNavigationController({
    getProject: () => options.getProject(),
    onClearActiveProject: () => {
      options.onClearActiveProject();
    },
    onFlushPendingSaves: () => options.onFlushPendingSaves(),
    onShowHomeView: () => {
      options.onShowHomeView();
    },
    onLoadProjects: () => options.onLoadProjects(),
    onPrepareStudio: (action) => options.onPrepareStudio(action),
    onSetActiveProjectId: (id) => {
      options.onSetActiveProjectId(id);
    }
  });
}
