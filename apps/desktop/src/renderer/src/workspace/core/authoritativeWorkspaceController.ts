import type { Project, ProjectSongItem } from '@jameet/shared';

export interface AuthoritativeWorkspaceControllerOptions {
  getProject: () => Project | null | undefined;
  getActiveSong: () => ProjectSongItem;
  onRenderProjectSongsSelector: () => void;
}

let controllerOptions: AuthoritativeWorkspaceControllerOptions | null = null;

export function initAuthoritativeWorkspaceController(
  options: AuthoritativeWorkspaceControllerOptions
): void {
  controllerOptions = options;
}

export function applyAuthoritativeWorkspaceUpdate(
  savedArea: 'lyrics' | 'notes' | 'structure' | 'tasks',
  serverWorkspace: any
): void {
  if (!controllerOptions) return;
  const activeProject = controllerOptions.getProject();
  if (!activeProject || !serverWorkspace) return;

  if (!activeProject.workspace) {
    activeProject.workspace = {
      activeSongId: 'song-1',
      songs: [],
      lyrics: {
        revision: 1,
        activeDocumentId: 'doc-main',
        documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: Date.now() }],
        content: '',
        updatedAt: Date.now()
      },
      notes: { revision: 1, content: '', updatedAt: Date.now() },
      structure: { revision: 1, sections: [], updatedAt: Date.now() },
      tasks: { revision: 1, tasks: [], updatedAt: Date.now() }
    };
  }

  const activeSong = controllerOptions.getActiveSong();

  // Only apply authoritative state to the specific saved area
  if (savedArea === 'lyrics' && serverWorkspace.lyrics) {
    activeProject.workspace.lyrics = serverWorkspace.lyrics;
    activeSong.lyrics = serverWorkspace.lyrics;
    activeSong.updatedAt = Date.now();
  } else if (savedArea === 'notes' && serverWorkspace.notes) {
    activeProject.workspace.notes = serverWorkspace.notes;
    activeSong.notes = serverWorkspace.notes;
    activeSong.updatedAt = Date.now();
  } else if (savedArea === 'structure' && serverWorkspace.structure) {
    activeProject.workspace.structure = serverWorkspace.structure;
    activeSong.structure = serverWorkspace.structure;
    activeSong.updatedAt = Date.now();
  } else if (savedArea === 'tasks' && serverWorkspace.tasks) {
    activeProject.workspace.tasks = serverWorkspace.tasks;
  }

  if (serverWorkspace.songs && Array.isArray(serverWorkspace.songs)) {
    activeProject.workspace.songs = serverWorkspace.songs;
    if (serverWorkspace.activeSongId) {
      activeProject.workspace.activeSongId = serverWorkspace.activeSongId;
    }
    controllerOptions.onRenderProjectSongsSelector();
  }
}
