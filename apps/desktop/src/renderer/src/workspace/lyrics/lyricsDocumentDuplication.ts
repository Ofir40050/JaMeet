import type { Project, ProjectSongItem } from '@jameet/shared';
import { getActiveLyricsDocState } from './lyricsDocumentState';

export interface DuplicateLyricsDocResult {
  newId: string;
  newTitle: string;
}

export function mutateDuplicateLyricsDoc(
  project: Project,
  activeSong: ProjectSongItem,
  docId: string,
  newId: string,
  now: number = Date.now()
): DuplicateLyricsDocResult | null {
  if (!project.workspace?.lyrics?.documents) return null;
  const docs = project.workspace.lyrics.documents;
  const source = docs.find((d) => d && d.id === docId) || getActiveLyricsDocState(activeSong, now);
  const newTitle = `${source.title} (Copy)`;

  docs.push({
    id: newId,
    title: newTitle,
    content: source.content || '',
    updatedAt: now
  });
  project.workspace.lyrics.activeDocumentId = newId;

  return { newId, newTitle };
}
