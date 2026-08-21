import type { Project } from '@jameet/shared';
import { initProjectSessionsListUi } from './projectSessionsListUi';
import type { ProjectSessionItem } from './projectSessionsUi';

export interface ProjectSessionsControllerOptions {
  getProject: () => Project | null | undefined;
  onOpenSummary: (project: Project, session: ProjectSessionItem) => void;
  onFlushPendingSaves: () => Promise<void>;
  onSetActiveProjectId: (id: string) => void;
  onPrepareStudio: (action: { type: 'create' }) => Promise<void>;
}

export function initProjectSessionsController(
  options: ProjectSessionsControllerOptions
): void {
  initProjectSessionsListUi({
    getSessions: () => options.getProject()?.sessions || [],
    onOpenSummary: (session) => {
      const project = options.getProject();
      if (project) {
        options.onOpenSummary(project, session);
      }
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
