import type { Project, ProjectSongItem } from '@jameet/shared';

export function normalizeStructureSections(
  project: Project | null | undefined,
  activeSong: ProjectSongItem,
  now: number = Date.now()
): any[] {
  if (!project) return [];
  if (!activeSong.structure) {
    activeSong.structure = { revision: 1, sections: [], updatedAt: now };
  }
  if (!Array.isArray(activeSong.structure.sections)) {
    activeSong.structure.sections = [];
  }
  if (project.workspace) {
    project.workspace.structure = activeSong.structure;
  }
  return activeSong.structure.sections;
}
