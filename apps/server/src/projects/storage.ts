import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { projectSchema, type Project } from '@jameet/shared';
import type { ProjectDatabaseSchema } from './types.js';
import { normalizeLoadedProject } from './normalization.js';

export interface StorageContext {
  dataFilePath: string;
  projectsDir: string;
}

export function resolveProjectPath(context: StorageContext, projectId: string): string {
  const { dataFilePath, projectsDir } = context;
  if (
    dataFilePath &&
    path.basename(dataFilePath).endsWith('.json') &&
    path.basename(dataFilePath) !== 'jameet-projects.json' &&
    path.basename(dataFilePath) !== 'musiczoom-projects.json'
  ) {
    return dataFilePath;
  }
  const dir = dataFilePath ? path.join(path.dirname(dataFilePath), 'projects') : projectsDir;
  return path.join(dir, `${projectId}.json`);
}

export async function persistProjectToDisk(context: StorageContext, project: Project): Promise<void> {
  const projectPath = resolveProjectPath(context, project.id);
  const targetDir = path.dirname(projectPath);
  await fs.promises.mkdir(targetDir, { recursive: true });
  const tmpPath = `${projectPath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(tmpPath, JSON.stringify(project, null, 2), 'utf-8');
    await fs.promises.rename(tmpPath, projectPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) {
        await fs.promises.unlink(tmpPath);
      }
    } catch {
      // ignore tmp cleanup error
    }
    throw err;
  }
}

export async function deleteProjectFromDisk(context: StorageContext, projectId: string): Promise<void> {
  const projectPath = resolveProjectPath(context, projectId);
  const targetDir = path.dirname(projectPath);
  await fs.promises.stat(targetDir).catch((err) => {
    if (err.code !== 'ENOENT') throw err;
  });
  try {
    await fs.promises.unlink(projectPath);
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

export function loadProjectsFromDisk(context: {
  dataFilePath: string;
  projectsDir: string;
  projects: Map<string, Project>;
}): void {
  const { dataFilePath, projectsDir, projects } = context;
  const legacyFileExists = fs.existsSync(dataFilePath);
  const loadedLegacyProjects: Project[] = [];

  // 1. If consolidated datastore file exists, load and validate
  if (legacyFileExists) {
    try {
      const raw = fs.readFileSync(dataFilePath, 'utf-8');
      const data = JSON.parse(raw) as ProjectDatabaseSchema;
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error(`Invalid project database structure in ${dataFilePath}: root must be an object`);
      }
      if (!Array.isArray(data.projects)) {
        throw new Error(`Invalid project database structure in ${dataFilePath}: 'projects' field must be an array`);
      }
      for (const p of data.projects) {
        if (!p || typeof p !== 'object' || Array.isArray(p) || typeof p.id !== 'string' || !p.id.trim()) {
          throw new Error(`Invalid project structure in ${dataFilePath}: missing or invalid 'id' field`);
        }
        normalizeLoadedProject(p);
        const parsed = projectSchema.safeParse(p);
        if (!parsed.success) {
          const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
          throw new Error(`Invalid project structure in ${dataFilePath} for project '${p.id}': ${issues}`);
        }
        loadedLegacyProjects.push(parsed.data);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load project datastore from ${dataFilePath}: ${message}`);
    }
  }

  // 2. Ensure per-project directory exists
  if (!fs.existsSync(projectsDir)) {
    try {
      fs.mkdirSync(projectsDir, { recursive: true });
    } catch {
      // ignore on initial store construction; write operations will fail durably
    }
  }

  // 3. Load standalone authoritative per-project files from projectsDir if present
  const existingPerProjectIds = new Set<string>();
  if (fs.existsSync(projectsDir)) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(projectsDir);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read projects directory ${projectsDir}: ${message}`);
    }

    for (const file of files) {
      if (!file.endsWith('.json') || file.includes('.tmp')) continue;
      const filePath = path.join(projectsDir, file);
      let raw: string;
      try {
        raw = fs.readFileSync(filePath, 'utf-8');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to read project file ${filePath}: ${message}`);
      }

      let p: Project;
      try {
        p = JSON.parse(raw) as Project;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse project file ${filePath}: ${message}`);
      }

      if (!p || typeof p !== 'object' || Array.isArray(p) || typeof p.id !== 'string' || !p.id.trim()) {
        throw new Error(`Invalid project structure in ${filePath}: missing or invalid 'id' field`);
      }

      normalizeLoadedProject(p);
      const parsed = projectSchema.safeParse(p);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
        throw new Error(`Invalid project structure in ${filePath}: ${issues}`);
      }
      const validProject = parsed.data;
      projects.set(validProject.id, validProject);
      existingPerProjectIds.add(validProject.id);
    }
  }

  // 4. Safe fail-closed migration: migrate legacy projects that do NOT already have a valid per-project file
  if (legacyFileExists) {
    try {
      if (!fs.existsSync(projectsDir)) {
        fs.mkdirSync(projectsDir, { recursive: true });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to create projects directory during migration ${projectsDir}: ${message}`);
    }

    for (const p of loadedLegacyProjects) {
      // NEVER overwrite a valid existing per-project file with an older consolidated copy
      if (existingPerProjectIds.has(p.id)) {
        continue;
      }

      const projPath = path.join(projectsDir, `${p.id}.json`);
      const tmpPath = `${projPath}.${crypto.randomUUID()}.tmp`;
      try {
        fs.writeFileSync(tmpPath, JSON.stringify(p, null, 2), 'utf-8');
        fs.renameSync(tmpPath, projPath);
        projects.set(p.id, p);
        existingPerProjectIds.add(p.id);
      } catch (err: unknown) {
        try {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch {}
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to migrate project ${p.id} to per-project file: ${message}`);
      }
    }

    // Only archive the consolidated file after EVERY project has been successfully migrated or preserved
    try {
      fs.renameSync(dataFilePath, `${dataFilePath}.migrated.bak`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to archive migrated consolidated datastore ${dataFilePath}: ${message}`);
    }
  }
}

export function createProjectSnapshot(projects: Map<string, Project>, projectId?: string): string {
  if (projectId) {
    const project = projects.get(projectId);
    return JSON.stringify({
      version: 1,
      type: 'single',
      projectId,
      project: project ? JSON.parse(JSON.stringify(project)) : null
    });
  }
  return JSON.stringify({
    version: 1,
    type: 'global',
    projects: Array.from(projects.values()).map((p) => JSON.parse(JSON.stringify(p)))
  });
}

export async function restoreProjectSnapshot(
  context: {
    projects: Map<string, Project>;
    persistProject: (project: Project) => Promise<void>;
    deleteProjectFromDisk: (projectId: string) => Promise<void>;
    runProjectTransaction: <T>(projectId: string, task: () => Promise<T>) => Promise<T>;
  },
  snapshotJson: string
): Promise<void> {
  const { projects, persistProject, deleteProjectFromDisk: delProj, runProjectTransaction } = context;
  const data = JSON.parse(snapshotJson);
  if (data && data.type === 'single' && typeof data.projectId === 'string') {
    return runProjectTransaction(data.projectId, async () => {
      if (data.project) {
        projects.set(data.projectId, data.project);
        await persistProject(data.project);
      } else {
        projects.delete(data.projectId);
        await delProj(data.projectId);
      }
    });
  }

  // Global snapshot restoration: restore scoped snapshot projects without clobbering unrelated projects
  if (Array.isArray(data?.projects)) {
    for (const p of data.projects) {
      await runProjectTransaction(p.id, async () => {
        projects.set(p.id, p);
        await persistProject(p);
      });
    }
  }
}
