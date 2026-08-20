import type { Project, ProjectSongItem } from '@jameet/shared';
import * as projectsApi from '../../projects/core/projects';

export interface StructurePersistenceOptions {
  getProject: () => Project | null | undefined;
  getAuthToken: () => string | null;
  canEdit: () => boolean;
  getActiveSong: () => ProjectSongItem;
  getStructureSections: () => any[];
  getWorkspaceContextGen: () => number;
  getStructureEditGen: () => number;
  getStructureSaveGen: () => number;
  incrementStructureEditGen: () => number;
  incrementStructureSaveGen: () => number;
  setStructureStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  onUpdateSignaling: (
    projectId: string,
    payload: any,
    token: string
  ) => Promise<{ ok: boolean; conflict?: boolean; code?: string; workspace?: any; project?: any } | null>;
  onApplyAuthoritativeWorkspace: (area: 'structure', workspace: any) => void;
  onRenderProjectActivities: (project: Project) => void;
}

let persistenceOptions: StructurePersistenceOptions | null = null;
let structureSaveTimeout: ReturnType<typeof setTimeout> | null = null;

export function initStructurePersistence(options: StructurePersistenceOptions): void {
  persistenceOptions = options;
}

export function hasStructureSaveTimeout(): boolean {
  return structureSaveTimeout !== null;
}

export function clearStructureSaveTimeout(): void {
  if (structureSaveTimeout) {
    clearTimeout(structureSaveTimeout);
    structureSaveTimeout = null;
  }
}

export function debounceSaveStructure(): void {
  if (!persistenceOptions || !persistenceOptions.canEdit()) return;
  persistenceOptions.incrementStructureEditGen();
  persistenceOptions.setStructureStatus('saving');
  if (structureSaveTimeout) clearTimeout(structureSaveTimeout);
  structureSaveTimeout = setTimeout(() => {
    structureSaveTimeout = null;
    void saveStructureWorkspace();
  }, 350);
}

export async function saveStructureWorkspace(): Promise<void> {
  if (!persistenceOptions || !persistenceOptions.canEdit()) return;
  const activeProject = persistenceOptions.getProject();
  if (!activeProject) return;

  const token = persistenceOptions.getAuthToken();
  if (!token) {
    persistenceOptions.setStructureStatus('unsaved');
    return;
  }

  const activeSong = persistenceOptions.getActiveSong();
  const targetProjectId = activeProject.id;
  const targetContextGen = persistenceOptions.getWorkspaceContextGen();
  const targetEditGen = persistenceOptions.getStructureEditGen();
  const targetSaveGen = persistenceOptions.incrementStructureSaveGen();
  const baseRevision = activeSong.structure?.revision ?? 1;

  try {
    const sections = persistenceOptions.getStructureSections();
    if (activeSong.structure) {
      activeSong.structure.sections = sections;
      activeSong.updatedAt = Date.now();
    }
    if (activeProject.workspace?.structure) {
      activeProject.workspace.structure.sections = sections;
    }

    const payload = {
      activeSongId: activeSong.id,
      songId: activeSong.id,
      songs: activeProject.workspace?.songs,
      structure: { baseRevision, sections }
    };

    let res = await persistenceOptions.onUpdateSignaling(targetProjectId, payload, token);

    if (!res?.ok && !res?.conflict && res?.code !== 'WORKSPACE_CONFLICT') {
      try {
        const httpRes = await projectsApi.updateProjectWorkspace(token, targetProjectId, payload);
        if (httpRes?.workspace) {
          res = { ok: true, workspace: httpRes.workspace, project: httpRes.project };
        }
      } catch (httpErr: any) {
        console.warn('HTTP workspace update fallback failed for structure:', httpErr);
      }
    }

    const currentProject = persistenceOptions.getProject();
    const isLatest =
      currentProject?.id === targetProjectId &&
      targetContextGen === persistenceOptions.getWorkspaceContextGen() &&
      targetSaveGen === persistenceOptions.getStructureSaveGen() &&
      targetEditGen === persistenceOptions.getStructureEditGen();

    if (!isLatest) return;

    if (res?.ok && res.workspace && currentProject) {
      persistenceOptions.onApplyAuthoritativeWorkspace('structure', res.workspace);
      if (res.project?.activities) {
        currentProject.activities = res.project.activities;
        persistenceOptions.onRenderProjectActivities(currentProject);
      }
      persistenceOptions.setStructureStatus('saved');
    } else if (res?.conflict || res?.code === 'WORKSPACE_CONFLICT') {
      // Confirmed WORKSPACE_CONFLICT: preserve local edits exactly, keep unsaved, do not overwrite local content
      persistenceOptions.setStructureStatus('unsaved');
    } else {
      persistenceOptions.setStructureStatus('unsaved');
    }
  } catch (err) {
    console.error('Failed to save structure workspace:', err);
    const currentProject = persistenceOptions.getProject();
    const isLatest =
      currentProject?.id === targetProjectId &&
      targetContextGen === persistenceOptions.getWorkspaceContextGen() &&
      targetSaveGen === persistenceOptions.getStructureSaveGen() &&
      targetEditGen === persistenceOptions.getStructureEditGen();

    if (isLatest) {
      persistenceOptions.setStructureStatus('unsaved');
    }
  }
}
