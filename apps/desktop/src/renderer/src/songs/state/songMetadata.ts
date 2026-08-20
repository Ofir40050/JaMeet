import type { Project } from '@jameet/shared';

export function mutateRenameSong(project: Project, songId: string, newTitle: string): boolean {
  if (!project.workspace?.songs) return false;
  const song = project.workspace.songs.find((s) => s.id === songId);
  if (!song) return false;
  song.title = newTitle;
  return true;
}

export function mutateToggleArchiveSong(project: Project, songId: string, isArchived: boolean): boolean {
  if (!project.workspace?.songs) return false;
  const song = project.workspace.songs.find((s) => s.id === songId);
  if (!song) return false;
  song.archived = isArchived;
  return true;
}

export function mutateSongCustomization(
  project: Project,
  songId: string,
  changes: { icon?: string; color?: string },
  now: number = Date.now()
): boolean {
  if (!project.workspace?.songs) return false;
  const song = project.workspace.songs.find((s) => s.id === songId);
  if (!song) return false;

  if (changes.icon) song.icon = changes.icon;
  if (changes.color) song.color = changes.color;
  song.updatedAt = now;
  return true;
}
