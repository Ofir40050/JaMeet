import type { Project } from '@jameet/shared';

export interface ProjectDatabaseSchema {
  version: number;
  projects: Project[];
}
