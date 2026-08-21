import type { Project, ProjectCollaboratorRole, UserProfile } from '@jameet/shared';
import { renderProjectCollaborators } from './projectCollaboratorsUi';
import { handleUpdateCollaboratorRole, handleRemoveCollaborator } from './projectCollaboratorsController';

export interface ProjectCollaboratorsViewControllerOptions {
  getProject: () => Project | null | undefined;
  getUser: () => UserProfile | null | undefined;
}

let controllerOptions: ProjectCollaboratorsViewControllerOptions | null = null;

export function initProjectCollaboratorsViewController(
  options: ProjectCollaboratorsViewControllerOptions
): void {
  controllerOptions = options;
}

export function renderProjectCollaboratorsView(): void {
  if (!controllerOptions) return;
  const project = controllerOptions.getProject() ?? null;
  const user = controllerOptions.getUser() ?? null;

  renderProjectCollaborators(project, user, {
    onUpdateRole: (userId: string, targetRole: ProjectCollaboratorRole) => {
      void handleUpdateCollaboratorRole(userId, targetRole);
    },
    onRemoveCollaborator: (userId: string) => {
      void handleRemoveCollaborator(userId);
    }
  });
}
