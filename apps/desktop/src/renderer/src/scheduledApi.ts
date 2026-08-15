import type {
  ScheduledSession,
  CreateScheduledSessionRequest,
  UpdateScheduledSessionRequest
} from '@musiczoom/shared';

let apiBase = 'http://localhost:3000';

export function setScheduledApiBase(url: string): void {
  apiBase = url.replace(/\/+$/, '');
}

export async function fetchScheduledSessions(token: string): Promise<ScheduledSession[]> {
  const res = await fetch(`${apiBase}/api/sessions/scheduled`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Failed to fetch scheduled sessions');
  }
  const data = (await res.json()) as { ok: boolean; sessions: ScheduledSession[] };
  return data.sessions || [];
}

export async function createScheduledSession(
  token: string,
  req: CreateScheduledSessionRequest
): Promise<ScheduledSession> {
  const res = await fetch(`${apiBase}/api/sessions/scheduled`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(req)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Failed to create scheduled session');
  }
  const data = (await res.json()) as { ok: boolean; session: ScheduledSession };
  return data.session;
}

export async function updateScheduledSession(
  token: string,
  id: string,
  req: UpdateScheduledSessionRequest
): Promise<ScheduledSession> {
  const res = await fetch(`${apiBase}/api/sessions/scheduled/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(req)
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Failed to update scheduled session');
  }
  const data = (await res.json()) as { ok: boolean; session: ScheduledSession };
  return data.session;
}

export async function deleteScheduledSession(token: string, id: string): Promise<void> {
  const res = await fetch(`${apiBase}/api/sessions/scheduled/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Failed to delete scheduled session');
  }
}
