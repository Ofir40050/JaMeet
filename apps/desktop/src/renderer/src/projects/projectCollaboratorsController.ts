import * as projectsApi from './projects';
import type { ProjectItem, ProjectRole } from './projects';

export interface ProjectCollaboratorsControllerOptions {
  getAuthToken: () => string | null;
  getProject: () => ProjectItem | null;
  onProjectUpdated: (updatedProject: ProjectItem) => void;
  onRefreshProjectView: () => void;
  onRefreshCollaboratorsView: () => void;
}

let controllerOptions: ProjectCollaboratorsControllerOptions | null = null;

export function initProjectCollaboratorsController(options: ProjectCollaboratorsControllerOptions): void {
  controllerOptions = options;
}

export async function handleAddCollaborator(
  usernameOrEmail: string,
  role: ProjectRole,
  callbacks?: {
    onBeforeRequest?: () => void;
    onSuccess?: () => void;
    onError?: (errorMessage: string) => void;
  }
): Promise<void> {
  if (!controllerOptions) return;
  const token = controllerOptions.getAuthToken();
  const project = controllerOptions.getProject();
  if (!token || !project) return;

  try {
    callbacks?.onBeforeRequest?.();
    const updated = await projectsApi.addCollaborator(token, project.id, usernameOrEmail, role);
    controllerOptions.onProjectUpdated(updated);
    controllerOptions.onRefreshProjectView();
    callbacks?.onSuccess?.();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add collaborator.';
    callbacks?.onError?.(message);
  }
}

export async function handleUpdateCollaboratorRole(userId: string, targetRole: ProjectRole): Promise<void> {
  if (!controllerOptions) return;
  const token = controllerOptions.getAuthToken();
  const project = controllerOptions.getProject();
  if (!token || !project) return;

  try {
    const updated = await projectsApi.updateCollaboratorRole(token, project.id, userId, targetRole);
    controllerOptions.onProjectUpdated(updated);
    controllerOptions.onRefreshProjectView();
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to update member permission.');
    controllerOptions.onRefreshCollaboratorsView();
  }
}

export async function handleRemoveCollaborator(targetUserId: string): Promise<void> {
  if (!controllerOptions) return;
  const token = controllerOptions.getAuthToken();
  const project = controllerOptions.getProject();
  if (!token || !project) return;

  try {
    const updated = await projectsApi.removeCollaborator(token, project.id, targetUserId);
    controllerOptions.onProjectUpdated(updated);
    controllerOptions.onRefreshCollaboratorsView();
  } catch (err) {
    console.error('Failed to remove collaborator:', err);
  }
}
