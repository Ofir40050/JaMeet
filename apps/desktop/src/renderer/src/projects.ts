import type { Project, CreateProjectRequest, UpdateProjectRequest, UpdateProjectWorkspaceRequest, ProjectWorkspace } from '@jameet/shared';

const DEFAULT_PROD_SERVER_URL = 'https://jameet-jwi8.onrender.com';
const DEFAULT_DEV_SERVER_URL = 'http://localhost:3000';

let configuredBaseUrl: string | null = null;

export function setApiBase(url: string): void {
  if (url) configuredBaseUrl = url.replace(/\/$/, '');
}

export function getApiBase(): string {
  if (configuredBaseUrl) return configuredBaseUrl;
  if (typeof window !== 'undefined') {
    const globalBase =
      (window as unknown as { __JAMEET_API_BASE__?: string }).__JAMEET_API_BASE__ ||
      (window as unknown as { __MUSICZOOM_API_BASE__?: string }).__MUSICZOOM_API_BASE__;
    if (globalBase) return globalBase.replace(/\/$/, '');
  }
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SIGNALING_URL) {
    return import.meta.env.VITE_SIGNALING_URL.replace(/\/$/, '');
  }
  if (typeof import.meta !== 'undefined' && import.meta.env?.PROD) {
    return DEFAULT_PROD_SERVER_URL;
  }
  return DEFAULT_DEV_SERVER_URL;
}

function authHeaders(token?: string, hasBody = true): HeadersInit {
  const headers: Record<string, string> = {};
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function parseResponse<T>(res: Response, fallbackError: string): Promise<T> {
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // not JSON
    }
  }

  if (!res.ok) {
    const errorMsg =
      data?.message ||
      (res.status === 404
        ? 'Resource not found.'
        : res.status === 401
        ? 'Please sign in to continue.'
        : res.status === 403
        ? 'You do not have permission to perform this action.'
        : `${fallbackError} (HTTP ${res.status})`);
    throw new Error(errorMsg);
  }

  if (!data) {
    throw new Error(fallbackError);
  }

  if (data.ok === false) {
    throw new Error(data.message || fallbackError);
  }

  return data as T;
}

export async function fetchProjects(token: string, includeArchived = false): Promise<Project[]> {
  const url = `${getApiBase()}/api/projects${includeArchived ? '?archived=true' : ''}`;
  const res = await fetch(url, { headers: authHeaders(token, false) });
  const data = await parseResponse<{ ok: boolean; projects: Project[] }>(res, 'Failed to load projects.');
  return (data.projects || []) as Project[];
}

export async function fetchProject(token: string, projectId: string): Promise<Project> {
  const res = await fetch(`${getApiBase()}/api/projects/${projectId}`, { headers: authHeaders(token, false) });
  const data = await parseResponse<{ ok: boolean; project: Project }>(res, 'Project not found.');
  return data.project;
}

export async function createProject(token: string, req: CreateProjectRequest): Promise<Project> {
  const res = await fetch(`${getApiBase()}/api/projects`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify(req)
  });
  const data = await parseResponse<{ ok: boolean; project: Project }>(res, 'Failed to create project.');
  return data.project;
}

export async function updateProject(token: string, projectId: string, req: UpdateProjectRequest): Promise<Project> {
  const res = await fetch(`${getApiBase()}/api/projects/${projectId}`, {
    method: 'PATCH',
    headers: authHeaders(token, true),
    body: JSON.stringify(req)
  });
  const data = await parseResponse<{ ok: boolean; project: Project }>(res, 'Failed to update project.');
  return data.project;
}

export async function updateProjectWorkspace(
  token: string,
  projectId: string,
  req: UpdateProjectWorkspaceRequest
): Promise<{ project: Project; workspace: ProjectWorkspace }> {
  const res = await fetch(`${getApiBase()}/api/projects/${projectId}/workspace`, {
    method: 'PUT',
    headers: authHeaders(token, true),
    body: JSON.stringify(req)
  });
  return parseResponse<{ ok: boolean; project: Project; workspace: ProjectWorkspace }>(res, 'Failed to update workspace.');
}

export async function archiveProject(token: string, projectId: string): Promise<Project> {
  return updateProject(token, projectId, { archived: true });
}

export async function unarchiveProject(token: string, projectId: string): Promise<Project> {
  return updateProject(token, projectId, { archived: false });
}

export async function deleteProject(token: string, projectId: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/api/projects/${projectId}`, {
    method: 'DELETE',
    headers: authHeaders(token, false)
  });
  await parseResponse<{ ok: boolean }>(res, 'Failed to delete project.');
}

export async function addCollaborator(token: string, projectId: string, usernameOrEmail: string, role = 'collaborator'): Promise<Project> {
  const res = await fetch(`${getApiBase()}/api/projects/${projectId}/collaborators`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({ usernameOrEmail, role })
  });
  const data = await parseResponse<{ ok: boolean; project: Project }>(res, 'Failed to add collaborator.');
  return data.project;
}

export async function removeCollaborator(token: string, projectId: string, userId: string): Promise<Project> {
  const res = await fetch(`${getApiBase()}/api/projects/${projectId}/collaborators/${userId}`, {
    method: 'DELETE',
    headers: authHeaders(token, false)
  });
  const data = await parseResponse<{ ok: boolean; project: Project }>(res, 'Failed to remove collaborator.');
  return data.project;
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatSessionDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '< 1m';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remainM = m % 60;
  return remainM > 0 ? `${h}h ${remainM}m` : `${h}h`;
}
