import type { Project, ProjectActivityItem, ProjectActivityType } from '@jameet/shared';

export async function recordProjectActivity(
  context: {
    projects: Map<string, Project>;
    persistProject: (project: Project) => Promise<void>;
  },
  projectId: string,
  user: { id?: string; displayName?: string; username?: string; avatarColor?: string; avatarUrl?: string },
  type: ProjectActivityType,
  summary: string,
  title?: string,
  metadata?: Record<string, unknown>,
  persist = true
): Promise<ProjectActivityItem | null> {
  const { projects, persistProject } = context;
  const project = projects.get(projectId);
  if (!project) return null;
  if (!Array.isArray(project.activities)) {
    project.activities = [];
  }

  const snapshot = persist ? (JSON.parse(JSON.stringify(project)) as Project) : null;
  const now = Date.now();
  const userId = user.id || 'usr_unknown';
  const userDisplayName = user.displayName || user.username || 'Collaborator';
  const userUsername = user.username || 'collaborator';
  const userAvatarColor = user.avatarColor;
  const userAvatarUrl = user.avatarUrl;

  // Intelligent consolidation for continuous edits (e.g. typing lyrics, typing notes)
  if (type === 'lyrics_edited' || type === 'notes_edited') {
    const top = project.activities[0];
    if (top && top.type === type && top.userId === userId && (now - top.createdAt < 10 * 60 * 1000)) {
      top.createdAt = now;
      top.summary = summary;
      if (title) top.title = title;
      if (metadata) top.metadata = { ...(top.metadata || {}), ...metadata };
      if (userAvatarUrl) top.userAvatarUrl = userAvatarUrl;
      project.updatedAt = now;
      project.lastActivityAt = now;
      if (persist) {
        try {
          await persistProject(project);
        } catch (err) {
          if (snapshot) projects.set(projectId, snapshot);
          throw err;
        }
      }
      return top;
    }
  }

  const item: ProjectActivityItem = {
    id: `act_${now}_${Math.random().toString(36).substring(2, 7)}`,
    projectId,
    type,
    userId,
    userDisplayName,
    userUsername,
    userAvatarColor,
    userAvatarUrl,
    title: title || '',
    summary,
    metadata,
    createdAt: now
  };

  project.activities.unshift(item);
  if (project.activities.length > 300) {
    project.activities = project.activities.slice(0, 300);
  }
  project.updatedAt = now;
  project.lastActivityAt = now;
  if (persist) {
    try {
      await persistProject(project);
    } catch (err) {
      if (snapshot) projects.set(projectId, snapshot);
      throw err;
    }
  }
  return item;
}
