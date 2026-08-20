import type {
  Project,
  ProjectSongItem,
  UpdateProjectWorkspaceRequest,
  UserProfile
} from '@jameet/shared';
import * as projectsApi from '../../projects/core/projects';
import type { LyricsDocItem } from './lyricsDocumentState';
import { setLastSyncedLyrics } from '../core/workspaceSyncState';

export interface LyricsPersistenceOptions {
  getProject: () => Project | null | undefined;
  getAuthToken: () => string | null;
  getUser: () => UserProfile | null | undefined;
  canEdit: () => boolean;
  getActiveSong: () => ProjectSongItem;
  getActiveLyricsDoc: () => LyricsDocItem;
  getWorkspaceContextGen: () => number;
  getLyricsEditGen: () => number;
  getLyricsSaveGen: () => number;
  incrementLyricsSaveGen: () => number;
  setLyricsStatus: (status: 'saved' | 'saving' | 'unsaved') => void;
  onSignalingUpdate: (
    projectId: string,
    payload: any,
    token: string
  ) => Promise<{ ok: boolean; conflict?: boolean; code?: string; workspace?: any; project?: any } | null>;
  onApplyAuthoritativeWorkspace: (area: 'lyrics', workspace: any) => void;
  onRenderProjectActivities: (project: Project, user?: UserProfile | null) => void;
}

let persistenceOptions: LyricsPersistenceOptions | null = null;

export function initLyricsPersistence(options: LyricsPersistenceOptions): void {
  persistenceOptions = options;
}

export async function saveLyricsWorkspace(
  content: string,
  documentId?: string,
  title?: string
): Promise<void> {
  if (!persistenceOptions || !persistenceOptions.canEdit()) return;
  const activeProject = persistenceOptions.getProject();
  if (!activeProject) return;

  const token = persistenceOptions.getAuthToken();
  if (!token) {
    persistenceOptions.setLyricsStatus('unsaved');
    return;
  }

  const activeSong = persistenceOptions.getActiveSong();
  const targetProjectId = activeProject.id;
  const targetContextGen = persistenceOptions.getWorkspaceContextGen();
  const targetEditGen = persistenceOptions.getLyricsEditGen();
  const targetSaveGen = persistenceOptions.incrementLyricsSaveGen();
  const baseRevision = activeSong.lyrics?.revision ?? 1;

  try {
    const activeDoc = persistenceOptions.getActiveLyricsDoc();
    const docId = documentId || activeDoc.id;
    const docTitle = title || activeDoc.title;

    activeDoc.content = content;
    activeDoc.title = docTitle;
    activeDoc.updatedAt = Date.now();
    if (activeSong.lyrics) {
      activeSong.lyrics.content = content;
      activeSong.lyrics.updatedAt = Date.now();
    }
    if (activeProject.workspace?.lyrics) {
      activeProject.workspace.lyrics.content = content;
    }

    const payload: UpdateProjectWorkspaceRequest = {
      activeSongId: activeSong.id,
      songId: activeSong.id,
      songs: activeProject.workspace?.songs,
      lyrics: {
        baseRevision,
        activeDocumentId: activeSong.lyrics?.activeDocumentId,
        documents: activeSong.lyrics?.documents,
        content,
        documentId: docId,
        title: docTitle
      }
    };

    let res = await persistenceOptions.onSignalingUpdate(targetProjectId, payload, token);

    if (!res?.ok && !res?.conflict && res?.code !== 'WORKSPACE_CONFLICT') {
      try {
        const httpRes = await projectsApi.updateProjectWorkspace(token, targetProjectId, payload);
        if (httpRes?.workspace) {
          res = { ok: true, workspace: httpRes.workspace, project: httpRes.project };
        }
      } catch (httpErr: any) {
        console.warn('HTTP workspace update fallback failed:', httpErr);
      }
    }

    const currentProject = persistenceOptions.getProject();
    const isLatest =
      currentProject?.id === targetProjectId &&
      targetContextGen === persistenceOptions.getWorkspaceContextGen() &&
      targetSaveGen === persistenceOptions.getLyricsSaveGen() &&
      targetEditGen === persistenceOptions.getLyricsEditGen();

    if (res?.ok && res.workspace && currentProject) {
      persistenceOptions.onApplyAuthoritativeWorkspace('lyrics', res.workspace);
      if (res.project?.activities) {
        currentProject.activities = res.project.activities;
        persistenceOptions.onRenderProjectActivities(currentProject, persistenceOptions.getUser());
      }
      const syncedDoc = persistenceOptions.getActiveLyricsDoc();
      setLastSyncedLyrics(syncedDoc.content ?? content);
      persistenceOptions.setLyricsStatus('saved');
    } else if (res?.conflict || res?.code === 'WORKSPACE_CONFLICT') {
      // Confirmed WORKSPACE_CONFLICT: preserve local edits exactly, keep unsaved, do not overwrite local content
      persistenceOptions.setLyricsStatus('unsaved');
    } else {
      persistenceOptions.setLyricsStatus('unsaved');
    }
  } catch (err) {
    console.error('Failed to save lyrics document:', err);
    const currentProject = persistenceOptions.getProject();
    const isLatest =
      currentProject?.id === targetProjectId &&
      targetContextGen === persistenceOptions.getWorkspaceContextGen() &&
      targetSaveGen === persistenceOptions.getLyricsSaveGen() &&
      targetEditGen === persistenceOptions.getLyricsEditGen();

    if (isLatest) {
      persistenceOptions.setLyricsStatus('unsaved');
    }
  }
}
