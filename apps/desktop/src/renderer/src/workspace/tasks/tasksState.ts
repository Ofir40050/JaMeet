import type { Project, ProjectTaskItem } from '@jameet/shared';

export function normalizeProjectTasks(
  project: Project | null | undefined,
  now: number = 0
): ProjectTaskItem[] {
  if (!project) return [];
  if (!project.workspace) {
    project.workspace = {
      lyrics: { activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main Lyrics', content: '', updatedAt: now }], content: '', updatedAt: now },
      notes: { content: '', updatedAt: now },
      structure: { sections: [], updatedAt: now },
      tasks: { tasks: [], updatedAt: now }
    };
  }
  if (!project.workspace.tasks) {
    project.workspace.tasks = { tasks: [], updatedAt: now };
  }
  if (!Array.isArray(project.workspace.tasks.tasks)) {
    project.workspace.tasks.tasks = [];
  }
  return project.workspace.tasks.tasks;
}
