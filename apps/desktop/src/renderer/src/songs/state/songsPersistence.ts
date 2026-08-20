import type {
  Project,
  UpdateProjectWorkspaceRequest,
  UpdateProjectWorkspaceResponse
} from '@jameet/shared';
import * as projectsApi from '../../projects/core/projects';

export interface SongsPersistenceOptions {
  getProject: () => Project | null | undefined;
  getAuthToken: () => string | null;
  isSignalingConnected: () => boolean;
  onSignalingUpdateProjectWorkspace: (
    projectId: string,
    payload: UpdateProjectWorkspaceRequest,
    token: string
  ) => Promise<UpdateProjectWorkspaceResponse | null>;
}

let persistenceOptions: SongsPersistenceOptions | null = null;

export function initSongsPersistence(options: SongsPersistenceOptions): void {
  persistenceOptions = options;
}

export async function saveSongsWorkspace(): Promise<boolean> {
  if (!persistenceOptions) return false;
  const activeProject = persistenceOptions.getProject();
  if (!activeProject?.workspace) return false;

  const token = persistenceOptions.getAuthToken();
  if (!token) return false;

  const targetProjectId = activeProject.id;
  const payload: UpdateProjectWorkspaceRequest = {
    activeSongId: activeProject.workspace.activeSongId,
    songs: JSON.parse(JSON.stringify(activeProject.workspace.songs || []))
  };

  try {
    let res: UpdateProjectWorkspaceResponse | null = null;
    if (persistenceOptions.isSignalingConnected()) {
      try {
        res = await persistenceOptions.onSignalingUpdateProjectWorkspace(
          targetProjectId,
          payload,
          token
        );
      } catch {
        res = null;
      }
    }
    if (!res || !res.ok) {
      const httpRes = await projectsApi.updateProjectWorkspace(token, targetProjectId, payload);
      res = { ok: true, project: httpRes.project, workspace: httpRes.workspace };
    }
    const currentProject = persistenceOptions.getProject();
    if (res?.project && currentProject && currentProject.id === res.project.id) {
      currentProject.workspace = res.project.workspace;
      currentProject.updatedAt = res.project.updatedAt;
    }
    return true;
  } catch (err) {
    console.error('Failed to save songs workspace:', err);
    return false;
  }
}
