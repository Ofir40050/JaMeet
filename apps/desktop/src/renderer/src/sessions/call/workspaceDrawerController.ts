import { initWorkspaceDrawerUi } from './workspaceDrawerUi';

export interface WorkspaceDrawerControllerOptions {
  getProjectName: () => string | undefined;
  hasActiveProject: () => boolean;
  onSyncWorkspaceInputs: () => void;
  onRenderTasksWorkspace: () => void;
  onRenderStructureWorkspace: () => void;
  onUpdateLyricsPagination: () => void;
  setSessionChatOpen: (open: boolean) => void;
  setOnChatOpenCallback: (cb: () => void) => void;
}

export function initWorkspaceDrawerController(options: WorkspaceDrawerControllerOptions): void {
  initWorkspaceDrawerUi({
    getProjectName: () => options.getProjectName(),
    hasActiveProject: () => options.hasActiveProject(),
    onSyncWorkspaceInputs: () => {
      options.onSyncWorkspaceInputs();
    },
    onRenderTasksWorkspace: () => {
      options.onRenderTasksWorkspace();
    },
    onRenderStructureWorkspace: () => {
      options.onRenderStructureWorkspace();
    },
    onUpdateLyricsPagination: () => {
      options.onUpdateLyricsPagination();
    },
    setSessionChatOpen: (open) => {
      options.setSessionChatOpen(open);
    },
    setOnChatOpenCallback: (cb) => {
      options.setOnChatOpenCallback(cb);
    }
  });
}
