import type {
  Project,
  UserProfile,
  ProjectCollaboratorRole,
  ProjectActivityType,
  ProjectActivityItem
} from '@jameet/shared';
import { ProjectLimitError } from './errors.js';
import { PROJECT_LIMITS } from './limits.js';

export interface CollaboratorContext {
  projects: Map<string, Project>;
  persistProject: (project: Project) => Promise<void>;
  recordActivity: (
    projectId: string,
    user: { id?: string; displayName?: string; username?: string; avatarColor?: string; avatarUrl?: string },
    type: ProjectActivityType,
    summary: string,
    title?: string,
    metadata?: Record<string, unknown>,
    persist?: boolean
  ) => Promise<ProjectActivityItem | null>;
  isOwner: (projectId: string, userId: string) => boolean;
}

export async function addProjectCollaborator(
  context: CollaboratorContext,
  projectId: string,
  userId: string,
  collaborator: UserProfile,
  role: ProjectCollaboratorRole = 'collaborator'
): Promise<Project | null> {
  const { projects, persistProject, recordActivity, isOwner } = context;
  const project = projects.get(projectId);
  if (!project) return null;

  // Only the project owner can add collaborators, assign roles, or grant owner authority
  if (!isOwner(projectId, userId)) {
    return null;
  }

  // Do not allow assigning the owner role to collaborators
  if ((role as string) === 'owner') {
    return null;
  }

  if (collaborator.id === project.ownerId) {
    return project;
  }

  const snapshot = JSON.parse(JSON.stringify(project)) as Project;
  const existingIdx = project.collaborators.findIndex((c) => c.userId === collaborator.id);
  const now = Date.now();

  if (existingIdx >= 0) {
    project.collaborators[existingIdx]!.role = role;
  } else {
    if (project.collaborators.length >= PROJECT_LIMITS.MAX_COLLABORATORS_PER_PROJECT) {
      throw new ProjectLimitError(
        `Maximum collaborator limit reached (${PROJECT_LIMITS.MAX_COLLABORATORS_PER_PROJECT} collaborators per project).`
      );
    }
    project.collaborators.push({
      userId: collaborator.id,
      displayName: collaborator.displayName,
      username: collaborator.username,
      avatarColor: collaborator.avatarColor || '#06b6d4',
      avatarUrl: collaborator.avatarUrl,
      role,
      addedAt: now
    });
    await recordActivity(
      projectId,
      { id: userId, displayName: project.ownerDisplayName },
      'collaborator_added',
      `${project.ownerDisplayName} added ${collaborator.displayName} to the project`,
      collaborator.displayName,
      undefined,
      false
    );
  }

  project.updatedAt = now;
  projects.set(projectId, project);
  try {
    await persistProject(project);
  } catch (err) {
    projects.set(projectId, snapshot);
    throw err;
  }
  return JSON.parse(JSON.stringify(project)) as Project;
}

export async function updateProjectCollaboratorRole(
  context: CollaboratorContext,
  projectId: string,
  userId: string,
  targetUserId: string,
  role: ProjectCollaboratorRole
): Promise<Project | null> {
  const { projects, persistProject, isOwner } = context;
  const project = projects.get(projectId);
  if (!project) return null;

  if (!isOwner(projectId, userId)) {
    return null;
  }

  if ((role as string) === 'owner') {
    return null;
  }

  const snapshot = JSON.parse(JSON.stringify(project)) as Project;
  const target = project.collaborators.find((c) => c.userId === targetUserId);
  if (!target) return null;

  target.role = role;
  project.updatedAt = Date.now();
  projects.set(projectId, project);
  try {
    await persistProject(project);
  } catch (err) {
    projects.set(projectId, snapshot);
    throw err;
  }
  return JSON.parse(JSON.stringify(project)) as Project;
}

export async function removeProjectCollaborator(
  context: CollaboratorContext,
  projectId: string,
  userId: string,
  targetUserId: string
): Promise<Project | null> {
  const { projects, persistProject, recordActivity, isOwner } = context;
  const project = projects.get(projectId);
  if (!project) return null;

  // Only owner or the collaborator themselves can remove
  const isOwnerUser = isOwner(projectId, userId);
  if (!isOwnerUser && userId !== targetUserId) {
    return null;
  }

  const snapshot = JSON.parse(JSON.stringify(project)) as Project;
  const target = project.collaborators.find((c) => c.userId === targetUserId);
  project.collaborators = project.collaborators.filter((c) => c.userId !== targetUserId);
  project.updatedAt = Date.now();
  if (target) {
    await recordActivity(
      projectId,
      { id: userId, displayName: isOwnerUser ? project.ownerDisplayName : target.displayName },
      'collaborator_removed',
      isOwnerUser
        ? `${project.ownerDisplayName} removed ${target.displayName} from the project`
        : `${target.displayName} left the project`,
      target.displayName,
      undefined,
      false
    );
  }
  projects.set(projectId, project);
  try {
    await persistProject(project);
  } catch (err) {
    projects.set(projectId, snapshot);
    throw err;
  }
  return JSON.parse(JSON.stringify(project)) as Project;
}
