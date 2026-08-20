import * as projectsApi from './projects';
import type { ProjectItem } from './projects';
import {
  openRenameProjectModal,
  closeRenameProjectModal,
  setRenameProjectError,
  setRenameProjectBusy
} from './projectRenameUi';
import { closeProjectMenu } from './projectMenuUi';

export interface ProjectRenameControllerOptions {
  getAuthToken: () => string | null;
  getProject: () => ProjectItem | null | undefined;
  onProjectUpdated: (updatedProject: ProjectItem) => void;
  onRefreshProjectView: () => void;
  onRefreshProjectsList: () => Promise<void> | void;
}

let controllerOptions: ProjectRenameControllerOptions | null = null;

export function initProjectRenameController(options: ProjectRenameControllerOptions): void {
  controllerOptions = options;
}

export function handleTriggerRename(): void {
  if (!controllerOptions) return;
  const project = controllerOptions.getProject();
  if (!project) return;
  closeProjectMenu();
  openRenameProjectModal(project.name, project.description || '');
}

export async function handleSaveRename({
  name,
  description
}: {
  name: string;
  description: string;
}): Promise<void> {
  if (!controllerOptions) return;
  const project = controllerOptions.getProject();
  if (!project) return;

  if (!name) {
    setRenameProjectError('Project name cannot be empty.');
    return;
  }

  const token = controllerOptions.getAuthToken();
  if (!token) {
    setRenameProjectError('You must be signed in to edit projects.');
    return;
  }

  setRenameProjectBusy(true);
  try {
    setRenameProjectError('');
    const updated = await projectsApi.updateProject(token, project.id, { name, description });
    controllerOptions.onProjectUpdated(updated);
    controllerOptions.onRefreshProjectView();
    void controllerOptions.onRefreshProjectsList();
    closeRenameProjectModal();
  } catch (err) {
    setRenameProjectError(err instanceof Error ? err.message : 'Failed to update project.');
  } finally {
    setRenameProjectBusy(false);
  }
}
