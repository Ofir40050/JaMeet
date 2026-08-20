import type { Project, ProjectActivityItem, UserProfile } from '@jameet/shared';
import type { SignalingClient } from '@jameet/signaling-client';

export interface ProjectActivitySyncOptions {
  signaling: SignalingClient;
  getActiveProject: () => Project | null | undefined;
  getUser: () => UserProfile | null | undefined;
  onRenderProjectActivities: (project: Project | null, user?: UserProfile | null) => void;
}

export function initProjectActivitySync(options: ProjectActivitySyncOptions): void {
  options.signaling.on(
    'project:activity:new',
    (data: { projectId: string; activities: ProjectActivityItem[] }) => {
      const activeProject = options.getActiveProject();
      if (activeProject && activeProject.id === data.projectId) {
        activeProject.activities = data.activities;
        options.onRenderProjectActivities(activeProject, options.getUser());
      }
    }
  );
}
