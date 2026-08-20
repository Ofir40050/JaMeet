import type { Project, ProjectSongItem, UserProfile } from '@jameet/shared';
import type { StructureSection } from './structureUi';
import { initStructurePersistence } from './structurePersistence';

export interface StructurePersistenceControllerOptions {
  getProject: () => Project | null | undefined;
  getAuthToken: () => string | null;
  getUser: () => UserProfile | null;
  canEdit: () => boolean;
  getActiveSong: () => ProjectSongItem;
  getStructureSections: () => StructureSection[];
  getWorkspaceContextGen: () => number;
  getStructureEditGen: () => number;
  getStructureSaveGen: () => number;
  incrementStructureEditGen: () => number;
  incrementStructureSaveGen: () => number;
  setStructureStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  onUpdateSignaling: (projectId: string, payload: any, token?: string) => Promise<any>;
  onApplyAuthoritativeWorkspace: (area: string, workspace: any) => void;
  onRenderProjectActivities: (project: Project | null, user: UserProfile | null) => void;
}

export function initStructurePersistenceController(
  options: StructurePersistenceControllerOptions
): void {
  initStructurePersistence({
    getProject: () => options.getProject(),
    getAuthToken: () => options.getAuthToken(),
    canEdit: () => options.canEdit(),
    getActiveSong: () => options.getActiveSong(),
    getStructureSections: () => options.getStructureSections(),
    getWorkspaceContextGen: () => options.getWorkspaceContextGen(),
    getStructureEditGen: () => options.getStructureEditGen(),
    getStructureSaveGen: () => options.getStructureSaveGen(),
    incrementStructureEditGen: () => options.incrementStructureEditGen(),
    incrementStructureSaveGen: () => options.incrementStructureSaveGen(),
    setStructureStatus: (status) => {
      options.setStructureStatus(status);
    },
    onUpdateSignaling: async (projectId, payload, token) => {
      return options.onUpdateSignaling(projectId, payload, token);
    },
    onApplyAuthoritativeWorkspace: (area, workspace) => {
      options.onApplyAuthoritativeWorkspace(area, workspace);
    },
    onRenderProjectActivities: (project) => {
      options.onRenderProjectActivities(project, options.getUser());
    }
  });
}
