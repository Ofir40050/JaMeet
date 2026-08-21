import type { Project, ProjectTaskItem } from '@jameet/shared';

export function normalizeProjectTasks(
  project: Project | null | undefined,
  now: number = 0
): ProjectTaskItem[] {
  if (!project) return [];
  if (!project.workspace) {
    project.workspace = {
      songs: [],
      lyrics: {
        revision: 0,
        activeDocumentId: 'doc-main',
        documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now }],
        content: '',
        updatedAt: now
      },
      notes: { revision: 0, content: '', updatedAt: now },
      structure: { revision: 0, sections: [], updatedAt: now },
      tasks: { revision: 0, tasks: [], updatedAt: now }
    };
  }
  if (!project.workspace.tasks) {
    project.workspace.tasks = { revision: 0, tasks: [], updatedAt: now };
  }
  if (!Array.isArray(project.workspace.tasks.tasks)) {
    project.workspace.tasks.tasks = [];
  }
  return project.workspace.tasks.tasks;
}
