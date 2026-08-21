import type { MeetingAck, Project, WorkspaceSyncResponse } from '@jameet/shared';
import { $, setText } from '../../../core/dom';

export interface SessionProjectWorkspaceControllerOptions {
  getAuthToken: () => string | null | undefined;
  onSetSessionProjectId: (id: string | undefined) => void;
  onResetWorkspaceGenerations: () => number;
  getWorkspaceContextGen: () => number;
  onFetchProject: (token: string, projectId: string) => Promise<Project>;
  getActiveProject: () => Project | null | undefined;
  onSetActiveProject: (project: Project) => void;
  onSetActiveProjectId: (id: string) => void;
  onSyncWorkspaceInputsFromProject: (force: boolean) => void;
  onJoinProjectWorkspace: (
    projectId: string,
    token: string
  ) => Promise<WorkspaceSyncResponse | undefined>;
}

export function handleSessionProjectWorkspace(
  ack: MeetingAck,
  options: SessionProjectWorkspaceControllerOptions
): void {
  if (ack.projectId) {
    options.onSetSessionProjectId(ack.projectId);
    const t = options.getAuthToken();
    if (t) {
      const loadContextGen = options.onResetWorkspaceGenerations();
      void options
        .onFetchProject(t, ack.projectId)
        .then((p) => {
          if (loadContextGen !== options.getWorkspaceContextGen()) return;
          options.onSetActiveProject(p);
          options.onSetActiveProjectId(p.id);
          setText('session-workspace-project-name', p.name);
          options.onSyncWorkspaceInputsFromProject(true);
          void options.onJoinProjectWorkspace(p.id, t).then((joinRes) => {
            const activeProject = options.getActiveProject();
            if (
              joinRes?.ok &&
              joinRes.workspace &&
              activeProject &&
              activeProject.id === p.id &&
              loadContextGen === options.getWorkspaceContextGen()
            ) {
              activeProject.workspace = joinRes.workspace;
              options.onSyncWorkspaceInputsFromProject(true);
            }
          });
          $('toggle-session-workspace')?.classList.remove('hidden');
        })
        .catch(() => {
          if (loadContextGen !== options.getWorkspaceContextGen()) return;
          $('toggle-session-workspace')?.classList.add('hidden');
        });
    } else {
      $('toggle-session-workspace')?.classList.add('hidden');
    }
  } else {
    options.onSetSessionProjectId(undefined);
    $('toggle-session-workspace')?.classList.add('hidden');
  }
}
