import type { Project, UserProfile } from '@jameet/shared';
import { renderProjectHeader } from './projectHeaderUi';
import { renderProjectSessions, resetProjectSessionsPage } from './projectSessionsListUi';

export interface ProjectViewControllerOptions {
  getProject: () => Project | null | undefined;
  getUser: () => UserProfile | null | undefined;
  renderCollaborators: () => void;
  applyWorkspacePermissions: () => void;
}

let controllerOptions: ProjectViewControllerOptions | null = null;

export function initProjectViewController(options: ProjectViewControllerOptions): void {
  controllerOptions = options;
}

export function renderProjectView(): void {
  if (!controllerOptions) return;
  const project = controllerOptions.getProject();
  if (!project) return;
  const user = controllerOptions.getUser() || null;

  renderProjectHeader(project, user);

  // Collaborators
  controllerOptions.renderCollaborators();

  // Sessions
  resetProjectSessionsPage();
  renderProjectSessions();

  // Enforce workspace edit/view permissions across UI
  controllerOptions.applyWorkspacePermissions();
}
