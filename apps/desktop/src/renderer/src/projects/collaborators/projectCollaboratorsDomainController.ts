import type { Project } from '@jameet/shared';
import {
  initProjectCollaboratorsController,
  handleAddCollaborator
} from './projectCollaboratorsController';
import {
  initProjectCollaboratorModalUi,
  setAddCollaboratorError,
  closeAddCollaboratorModal
} from './projectCollaboratorModalUi';

export interface ProjectCollaboratorsDomainControllerOptions {
  getAuthToken: () => string | null;
  getProject: () => Project | null | undefined;
  onProjectUpdated: (updatedProject: Project) => void;
  onRefreshProjectView: () => void;
  onRefreshCollaboratorsView: () => void;
}

export function initProjectCollaboratorsDomainController(
  options: ProjectCollaboratorsDomainControllerOptions
): void {
  initProjectCollaboratorsController({
    getAuthToken: () => options.getAuthToken(),
    getProject: () => options.getProject() ?? null,
    onProjectUpdated: (updatedProject) => {
      options.onProjectUpdated(updatedProject);
    },
    onRefreshProjectView: () => {
      options.onRefreshProjectView();
    },
    onRefreshCollaboratorsView: () => {
      options.onRefreshCollaboratorsView();
    }
  });

  initProjectCollaboratorModalUi({
    onAddCollaborator: async ({ usernameOrEmail, role }) => {
      await handleAddCollaborator(usernameOrEmail, role, {
        onBeforeRequest: () => {
          setAddCollaboratorError('');
        },
        onSuccess: () => {
          closeAddCollaboratorModal();
        },
        onError: (errorMessage) => {
          setAddCollaboratorError(errorMessage);
        }
      });
    }
  });
}
