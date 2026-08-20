import type {
  Project,
  ProjectSessionItem,
  ParticipantIdentity,
  ProjectActivityType,
  ProjectActivityItem
} from '@jameet/shared';

export async function recordProjectSessionItem(context: {
  project: Project;
  session: ProjectSessionItem;
  collaboratorIdentity?: ParticipantIdentity | null;
  recordActivity: (
    projectId: string,
    user: { id?: string; displayName?: string; username?: string; avatarColor?: string; avatarUrl?: string },
    type: ProjectActivityType,
    summary: string,
    title?: string,
    metadata?: Record<string, unknown>,
    persist?: boolean
  ) => Promise<ProjectActivityItem | null>;
}): Promise<void> {
  const { project, session, collaboratorIdentity, recordActivity } = context;
  const now = Date.now();
  project.lastActivityAt = now;
  project.updatedAt = now;

  // Check if session already exists
  const existingIndex = project.sessions.findIndex((s) => s.code === session.code || s.id === session.id);
  if (existingIndex >= 0) {
    project.sessions[existingIndex] = {
      ...project.sessions[existingIndex],
      ...session,
      endedAt: session.endedAt ?? project.sessions[existingIndex]!.endedAt,
      durationSeconds: session.durationSeconds ?? project.sessions[existingIndex]!.durationSeconds,
      collaborator: session.collaborator || project.sessions[existingIndex]!.collaborator,
      summary: session.summary || project.sessions[existingIndex]!.summary
    };
  } else {
    project.sessions.unshift(session);
    project.sessionCount = project.sessions.length;
    if (session.collaborator?.displayName) {
      await recordActivity(
        project.id,
        collaboratorIdentity || { id: session.collaborator.id, displayName: session.collaborator.displayName },
        'session_completed',
        `Session completed with ${session.collaborator.displayName}`,
        session.code,
        undefined,
        false
      );
    }
  }
}
