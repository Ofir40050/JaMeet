import type { MeetingAck, Project, UpdateProjectWorkspaceResponse } from '@jameet/shared';
import { $, setText } from '../../../core/dom';

export interface SessionProjectWorkspaceControllerOptions {
  getAuthToken: () => string | null | undefined;
  onSetSessionProjectId: (id: string | undefined) => void;
  onResetWorkspaceGenerations: () => void | number;
  getWorkspaceContextGen: () => number;
  onFetchProject: (token: string, projectId: string) => Promise<Project>;
  getActiveProject: () => Project | null | undefined;
  onSetActiveProject: (project: Project) => void;
  onSetActiveProjectId: (id: string) => void;
  onSyncWorkspaceInputsFromProject: (force: boolean) => void;
  onJoinProjectWorkspace: (
    projectId: string,
    token: string
  ) => Promise<UpdateProjectWorkspaceResponse | undefined>;
}

export function handleSessionProjectWorkspace(
  ack: Extract<MeetingAck, { ok: true }>,
  options: SessionProjectWorkspaceControllerOptions
): void {
  if (ack.projectId) {
    options.onSetSessionProjectId(ack.projectId);
    const t = options.getAuthToken();
    if (t) {
      options.onResetWorkspaceGenerations();
      const loadContextGen = options.getWorkspaceContextGen();
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
