import * as projectsApi from '../core/projects';
import type { ProjectItem } from '../core/projects';
import {
  openDeleteProjectModal,
  closeDeleteProjectModal,
  setDeleteProjectError,
  setDeleteProjectBusy
} from './projectDeleteUi';
import { closeProjectMenu } from '../navigation/projectMenuUi';

export interface ProjectDeleteControllerOptions {
  getAuthToken: () => string | null;
  getProject: () => ProjectItem | null | undefined;
  onProjectDeleted: () => void;
  onNavigateHome: () => void;
  onRefreshProjectsList: () => Promise<void> | void;
}

let controllerOptions: ProjectDeleteControllerOptions | null = null;

export function initProjectDeleteController(options: ProjectDeleteControllerOptions): void {
  controllerOptions = options;
}

export function handleTriggerDelete(): void {
  if (!controllerOptions) return;
  const project = controllerOptions.getProject();
  if (!project) return;
  closeProjectMenu();
  openDeleteProjectModal(project.name);
}

export async function handleConfirmDelete(): Promise<void> {
  if (!controllerOptions) return;
  const project = controllerOptions.getProject();
  if (!project) return;

  const token = controllerOptions.getAuthToken();
  if (!token) {
    setDeleteProjectError('You must be signed in to delete a project.');
    return;
  }

  setDeleteProjectBusy(true);
  setDeleteProjectError('');
  try {
    await projectsApi.deleteProject(token, project.id);
    closeDeleteProjectModal();
    controllerOptions.onProjectDeleted();
    controllerOptions.onNavigateHome();
    await controllerOptions.onRefreshProjectsList();
  } catch (err: any) {
    console.error('Failed to delete project:', err);
    setDeleteProjectError(
      err?.message || 'Failed to delete project. Make sure you are the project owner.'
    );
  } finally {
    setDeleteProjectBusy(false);
  }
}
