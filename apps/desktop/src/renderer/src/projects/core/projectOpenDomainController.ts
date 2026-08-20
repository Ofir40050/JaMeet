import type { Project } from '@jameet/shared';
import { initProjectOpenController } from './projectOpenController';

export interface ProjectOpenDomainControllerOptions {
  getAuthToken: () => string | null;
  onUnauthenticated: () => void;
  onResetWorkspaceGenerations: () => number;
  isContextGenCurrent: (gen: number) => boolean;
  onProjectLoaded: (project: Project, projectId: string) => void;
  onNavigateToProjectView: () => void;
  onResetProjectTabs: () => void;
  onRenderProjectView: () => void;
  onSyncWorkspaceInputs: (forceAll: boolean) => void;
  onJoinSignalingRoom: (projectId: string, token: string) => Promise<any> | void;
}

export function initProjectOpenDomainController(options: ProjectOpenDomainControllerOptions): void {
  initProjectOpenController({
    getAuthToken: () => options.getAuthToken(),
    onUnauthenticated: () => {
      options.onUnauthenticated();
    },
    onResetWorkspaceGenerations: () => options.onResetWorkspaceGenerations(),
    isContextGenCurrent: (gen) => options.isContextGenCurrent(gen),
    onProjectLoaded: (project, projectId) => {
      options.onProjectLoaded(project, projectId);
    },
    onNavigateToProjectView: () => {
      options.onNavigateToProjectView();
    },
    onResetProjectTabs: () => {
      options.onResetProjectTabs();
    },
    onRenderProjectView: () => {
      options.onRenderProjectView();
    },
    onSyncWorkspaceInputs: (forceAll) => {
      options.onSyncWorkspaceInputs(forceAll);
    },
    onJoinSignalingRoom: (projectId, token) => {
      void Promise.resolve(options.onJoinSignalingRoom(projectId, token)).catch((e) =>
        console.warn('[Signaling] Failed to join project workspace socket room:', e)
      );
    }
  });
}
