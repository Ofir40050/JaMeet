import type { Project, UserProfile } from '@jameet/shared';
import { canUserEditProject as checkCanUserEditProject, isProjectOwner as checkIsProjectOwner } from '../../projects/core/projectAccess';
import { applyWorkspacePermissionsPresentation } from './workspacePermissionsUi';

export interface WorkspacePermissionsControllerOptions {
  getProject: () => Project | null | undefined;
  getUser: () => UserProfile | null | undefined;
}

let controllerOptions: WorkspacePermissionsControllerOptions | null = null;

export function initWorkspacePermissionsController(
  options: WorkspacePermissionsControllerOptions
): void {
  controllerOptions = options;
}

export function canUserEditProject(): boolean {
  if (!controllerOptions) return false;
  return checkCanUserEditProject(controllerOptions.getProject(), controllerOptions.getUser());
}

export function isProjectOwner(): boolean {
  if (!controllerOptions) return false;
  return checkIsProjectOwner(controllerOptions.getProject(), controllerOptions.getUser());
}

export function applyWorkspacePermissions(): void {
  if (!controllerOptions) return;
  const project = controllerOptions.getProject();
  const user = controllerOptions.getUser();
  const canEdit = checkCanUserEditProject(project, user);
  const isOwner = checkIsProjectOwner(project, user);
  applyWorkspacePermissionsPresentation({ canEdit, isOwner });
}
