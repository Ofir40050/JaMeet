import type { FastifyInstance } from 'fastify';
import type { UserStore } from '../auth/auth.js';
import { updateAccountSessionAccess } from '../admin/admin-access.js';

export function registerInternalAdminRoutes(
  app: FastifyInstance,
  userStore: UserStore,
  runtimeAdminToken: string
): void {
  // Internal Loopback-Only Administration Endpoint
  app.post('/api/internal/admin/session-access', async (request, reply) => {
    const remoteIp = request.socket.remoteAddress || request.ip;
    const isLoopback = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
    if (!isLoopback) {
      return reply.code(403).send({ ok: false, message: 'Forbidden: administration is only available via local loopback.' });
    }

    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token || token !== runtimeAdminToken) {
      return reply.code(401).send({ ok: false, message: 'Unauthorized: invalid or missing administration token.' });
    }

    const body = request.body as any;
    if (!body || typeof body !== 'object' || !body.identifier || !body.access) {
      return reply.code(400).send({ ok: false, message: 'Missing required identifier or access state.' });
    }

    try {
      const result = updateAccountSessionAccess(userStore, body.identifier, body.access);
      return reply.send({ ok: true, ...result });
    } catch (err: any) {
      const isNotFound = err.message?.includes('Account not found');
      const isInvalid = err.message?.includes('Invalid sessionAccess') || err.message?.includes('identifier is required');
      return reply.code(isNotFound ? 404 : (isInvalid ? 400 : 500)).send({ ok: false, message: err.message || 'Failed to update session access.' });
    }
  });
}
