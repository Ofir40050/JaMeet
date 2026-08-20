export interface ProjectAccessCollaborator {
  userId: string;
  username?: string;
  role: string;
}

export interface ProjectAccessTarget {
  ownerId?: string;
  ownerUsername?: string;
  collaborators?: ProjectAccessCollaborator[];
}

export interface UserAccessTarget {
  id?: string;
  username?: string;
}

export function isProjectOwner(
  project: ProjectAccessTarget | null | undefined,
  user: UserAccessTarget | null | undefined
): boolean {
  if (!project || !user) return false;
  if (user.id && project.ownerId && user.id === project.ownerId) return true;
  if (
    user.username &&
    project.ownerUsername &&
    user.username.toLowerCase() === project.ownerUsername.toLowerCase()
  ) {
    return true;
  }
  return false;
}

export function canUserEditProject(
  project: ProjectAccessTarget | null | undefined,
  user: UserAccessTarget | null | undefined
): boolean {
  if (!project || !user) return false;
  if (isProjectOwner(project, user)) return true;

  const collab = project.collaborators?.find((c) =>
    (user.id && c.userId === user.id) ||
    (user.username && c.username && c.username.toLowerCase() === user.username.toLowerCase())
  );
  if (!collab) return false;
  return collab.role === 'editor' || collab.role === 'collaborator' || (collab.role as string) === 'owner';
}
