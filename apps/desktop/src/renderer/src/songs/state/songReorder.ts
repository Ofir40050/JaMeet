import type { Project } from '@jameet/shared';

export function mutateReorderSongs(project: Project, sourceId: string, targetId: string): boolean {
  if (!project.workspace?.songs) return false;
  const songs = project.workspace.songs;
  const fromIdx = songs.findIndex((s) => s && s.id === sourceId);
  const toIdx = songs.findIndex((s) => s && s.id === targetId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return false;

  const [moved] = songs.splice(fromIdx, 1);
  songs.splice(toIdx, 0, moved);
  songs.forEach((s, i) => { s.order = i; });
  return true;
}
