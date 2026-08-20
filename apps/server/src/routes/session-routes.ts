import type { FastifyInstance } from 'fastify';
import {
  createScheduledSessionSchema,
  updateScheduledSessionSchema
} from '@jameet/shared';
import type { UserStore } from '../auth.js';

export function registerSessionRoutes(app: FastifyInstance, userStore: UserStore): void {
  app.get('/api/sessions/history', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized or session expired.' });
    }
    const sessions = userStore.getSessionHistory(user.id);
    return reply.send({ ok: true, sessions });
  });

  app.get<{ Params: { id: string } }>('/api/sessions/history/:id/summary', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized or session expired.' });
    }
    const history = userStore.getSessionHistory(user.id);
    const item = history.find((s) => s.id === request.params.id || s.sessionId === request.params.id || s.code === request.params.id);
    if (!item || !item.summary) {
      return reply.code(404).send({ ok: false, message: 'Session summary not found.' });
    }
    return reply.send({ ok: true, summary: item.summary });
  });

  // REST Scheduled Sessions Endpoints
  app.get('/api/sessions/scheduled', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized or session expired.' });
    }
    const sessions = userStore.listScheduledSessions(user.id);
    return reply.send({ ok: true, sessions });
  });

  app.post('/api/sessions/scheduled', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized or session expired.' });
    }
    const parsed = createScheduledSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, message: 'Invalid scheduled session data.' });
    }
    try {
      const session = userStore.createScheduledSession(user.id, parsed.data.title, parsed.data.scheduledAt);
      return reply.code(201).send({ ok: true, session });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create scheduled session.';
      return reply.code(500).send({ ok: false, message: msg });
    }
  });

  app.patch<{ Params: { id: string } }>('/api/sessions/scheduled/:id', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized or session expired.' });
    }
    const parsed = updateScheduledSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, message: 'Invalid update data.' });
    }
    try {
      const session = userStore.updateScheduledSession(user.id, request.params.id, parsed.data);
      if (!session) {
        return reply.code(404).send({ ok: false, message: 'Scheduled session not found.' });
      }
      return reply.send({ ok: true, session });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update scheduled session.';
      return reply.code(500).send({ ok: false, message: msg });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/sessions/scheduled/:id', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const user = userStore.verifyToken(token);
    if (!user) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized or session expired.' });
    }
    try {
      const deleted = userStore.deleteScheduledSession(user.id, request.params.id);
      if (!deleted) {
        return reply.code(404).send({ ok: false, message: 'Scheduled session not found.' });
      }
      return reply.send({ ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete scheduled session.';
      return reply.code(500).send({ ok: false, message: msg });
    }
  });
}
