import * as projectsApi from '../core/projects';
import type { Project } from '@jameet/shared';
import { closeProjectMenu } from '../navigation/projectMenuUi';

export interface ProjectArchiveControllerOptions {
  getAuthToken: () => string | null;
  getProject: () => Project | null | undefined;
  onProjectUpdated: (updatedProject: Project) => void;
  onRefreshProjectView: () => void;
  onRefreshProjectsList: () => Promise<void> | void;
}

let controllerOptions: ProjectArchiveControllerOptions | null = null;

export function initProjectArchiveController(options: ProjectArchiveControllerOptions): void {
  controllerOptions = options;
}

export async function handleArchiveProject(): Promise<void> {
  if (!controllerOptions) return;
  const project = controllerOptions.getProject();
  if (!project) return;

  closeProjectMenu();
  const token = controllerOptions.getAuthToken();
  if (!token) return;

  try {
    let updated: Project;
    if (project.archived) {
      updated = await projectsApi.unarchiveProject(token, project.id);
    } else {
      updated = await projectsApi.archiveProject(token, project.id);
    }
    controllerOptions.onProjectUpdated(updated);
    controllerOptions.onRefreshProjectView();
    void controllerOptions.onRefreshProjectsList();
  } catch (err) {
    console.error('Failed to archive/unarchive project:', err);
  }
}
