import type { Project } from '@jameet/shared';
import * as projectsApi from './projects';

export interface ProjectOpenControllerOptions {
  getAuthToken: () => string | null;
  onUnauthenticated: () => void;
  onResetWorkspaceGenerations: () => number;
  isContextGenCurrent: (loadContextGen: number) => boolean;
  onProjectLoaded: (project: Project, projectId: string) => void;
  onNavigateToProjectView: () => void;
  onResetProjectTabs: () => void;
  onRenderProjectView: () => void;
  onSyncWorkspaceInputs: (forceAll: boolean) => void;
  onJoinSignalingRoom: (projectId: string, token: string) => void;
}

let controllerOptions: ProjectOpenControllerOptions | null = null;

export function initProjectOpenController(options: ProjectOpenControllerOptions): void {
  controllerOptions = options;
}

export async function openProjectView(projectId: string): Promise<void> {
  if (!controllerOptions) return;
  const token = controllerOptions.getAuthToken();
  if (!token) {
    controllerOptions.onUnauthenticated();
    return;
  }

  const loadContextGen = controllerOptions.onResetWorkspaceGenerations();
  try {
    const project = await projectsApi.fetchProject(token, projectId);
    if (!controllerOptions.isContextGenCurrent(loadContextGen)) return;

    controllerOptions.onProjectLoaded(project, projectId);
    controllerOptions.onNavigateToProjectView();
    controllerOptions.onResetProjectTabs();
    controllerOptions.onRenderProjectView();
    controllerOptions.onSyncWorkspaceInputs(true);
    controllerOptions.onJoinSignalingRoom(projectId, token);
  } catch (err) {
    if (!controllerOptions.isContextGenCurrent(loadContextGen)) return;
    console.error('Failed to open project:', err);
    alert(`Could not open project: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}
