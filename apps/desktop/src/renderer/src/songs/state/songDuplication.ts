import type { Project, ProjectSongItem } from '@jameet/shared';

export interface DuplicateSongResult {
  copySong: ProjectSongItem;
  newId: string;
}

export function mutateDuplicateSong(
  project: Project,
  songId: string,
  newId: string,
  now: number = Date.now()
): DuplicateSongResult | null {
  if (!project.workspace?.songs) return null;
  const ws = project.workspace;
  const source = ws.songs.find((s) => s.id === songId);
  if (!source) return null;

  const copySong: ProjectSongItem = {
    id: newId,
    title: `${source.title} (Copy)`,
    order: ws.songs.length,
    lyrics: JSON.parse(JSON.stringify(source.lyrics)),
    notes: JSON.parse(JSON.stringify(source.notes)),
    structure: JSON.parse(JSON.stringify(source.structure)),
    createdAt: now,
    updatedAt: now
  };
  copySong.lyrics.revision = 1;
  copySong.notes.revision = 1;
  copySong.structure.revision = 1;

  ws.songs.push(copySong);
  ws.activeSongId = newId;
  ws.lyrics = copySong.lyrics;
  ws.notes = copySong.notes;
  ws.structure = copySong.structure;

  return { copySong, newId };
}
