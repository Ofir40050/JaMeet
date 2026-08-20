import * as projectsApi from './projects';
import {
  closeNewProjectModal,
  setNewProjectError,
  setNewProjectBusy
} from './projectCreateUi';

export interface ProjectCreateControllerOptions {
  getAuthToken: () => string | null;
  onRefreshProjectsList: () => Promise<void> | void;
  onOpenProject: (projectId: string) => Promise<void> | void;
}

let controllerOptions: ProjectCreateControllerOptions | null = null;

export function initProjectCreateController(options: ProjectCreateControllerOptions): void {
  controllerOptions = options;
}

export async function handleCreateProject({
  name,
  description
}: {
  name: string;
  description?: string;
}): Promise<void> {
  if (!controllerOptions) return;
  const token = controllerOptions.getAuthToken();
  if (!token) {
    setNewProjectError('Please sign in to your JaMeet account to create projects.');
    return;
  }

  setNewProjectBusy(true);
  try {
    setNewProjectError('');
    const created = await projectsApi.createProject(token, {
      name,
      description: description || undefined
    });
    closeNewProjectModal();
    await controllerOptions.onRefreshProjectsList();
    if (created?.id) {
      await controllerOptions.onOpenProject(created.id);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not create project. Please try again.';
    setNewProjectError(msg);
  } finally {
    setNewProjectBusy(false);
  }
}
