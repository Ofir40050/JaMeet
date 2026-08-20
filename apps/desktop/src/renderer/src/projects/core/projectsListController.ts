import type { Project, UserProfile } from '@jameet/shared';
import * as projectsApi from './projects';
import { renderProjectsGrid } from './projectsListUi';

export interface ProjectsListControllerOptions {
  getAuthToken: () => string | null;
  getUser: () => UserProfile | null;
  onProjectsLoaded: (projects: Project[]) => void;
}

let controllerOptions: ProjectsListControllerOptions | null = null;

export function initProjectsListController(options: ProjectsListControllerOptions): void {
  controllerOptions = options;
}

export async function loadProjects(): Promise<void> {
  if (!controllerOptions) return;
  const token = controllerOptions.getAuthToken();
  const user = controllerOptions.getUser();

  if (!token) {
    controllerOptions.onProjectsLoaded([]);
    renderProjectsGrid([], user);
    return;
  }

  let projects: Project[] = [];
  try {
    projects = await projectsApi.fetchProjects(token);
  } catch (err) {
    console.warn('[Projects] Failed to load projects:', err);
    projects = [];
  } finally {
    controllerOptions.onProjectsLoaded(projects);
    renderProjectsGrid(projects, user);
  }
}
