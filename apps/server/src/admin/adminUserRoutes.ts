import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../core/config.js";
import { UserStore, type SessionAccessState } from "../auth/auth.js";
import { ALLOWED_SESSION_ACCESS_STATES } from "./admin-access.js";
import type { AdminRuntimeContext } from "./adminTypes.js";
import {
  isRequestAdminAuthenticated,
  validateSameOrigin
} from "./adminAuth.js";

export function registerAdminUserRoutes(
  app: FastifyInstance,
  userStore: UserStore,
  config: ServerConfig,
  runtimeContext?: AdminRuntimeContext
): void {
  // 4. GET /admin/api/users - User List with Presence and Telemetry
  app.get("/admin/api/users", async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: "Not Found" });
    }

    if (!isRequestAdminAuthenticated(request, config)) {
      return reply.code(401).send({ ok: false, message: "Unauthorized" });
    }

    const onlineIds = runtimeContext?.getOnlineUserIds ? runtimeContext.getOnlineUserIds() : undefined;
    const users = userStore.listAdminUsers(onlineIds);
    return reply.send({ ok: true, users });
  });

  // 5. GET /admin/api/users/:userId - Detailed User Information & Activity History
  app.get("/admin/api/users/:userId", async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: "Not Found" });
    }

    if (!isRequestAdminAuthenticated(request, config)) {
      return reply.code(401).send({ ok: false, message: "Unauthorized" });
    }

    const { userId } = request.params as { userId: string };
    const isOnline = Boolean(runtimeContext?.isUserOnline ? runtimeContext.isUserOnline(userId) : false);
    const userDetail = userStore.getAdminUserDetail(userId, isOnline);
    if (!userDetail) {
      return reply.code(404).send({ ok: false, message: `Account not found for identifier: "${userId}".` });
    }

    return reply.send({ ok: true, user: userDetail });
  });

  // 6. POST /admin/api/users/:userId/access - Modify User Session Access
  app.post("/admin/api/users/:userId/access", async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: "Not Found" });
    }

    if (!validateSameOrigin(request, config)) {
      return reply.code(403).send({ ok: false, message: "Forbidden: invalid origin or cross-site request." });
    }

    if (!isRequestAdminAuthenticated(request, config)) {
      return reply.code(401).send({ ok: false, message: "Unauthorized" });
    }

    const { userId } = request.params as { userId: string };
    const body = (request.body || {}) as any;
    const newAccess = typeof body === "object" && body ? body.access : undefined;
    const betaExpiresAt = typeof body === "object" && body && body.betaExpiresAt !== undefined ? body.betaExpiresAt : undefined;

    if (!newAccess || typeof newAccess !== "string") {
      return reply.code(400).send({ ok: false, message: "Missing target access state." });
    }

    const normalizedAccess = newAccess.trim().toLowerCase() as SessionAccessState;
    if (!ALLOWED_SESSION_ACCESS_STATES.includes(normalizedAccess)) {
      return reply.code(400).send({
        ok: false,
        message: `Invalid sessionAccess: "${newAccess}". Allowed values: ${ALLOWED_SESSION_ACCESS_STATES.join(", ")}.`
      });
    }

    const profile = userStore.getStoredUser(userId) || (userStore.findByUsernameOrEmail(userId) ? userStore.getStoredUser(userStore.findByUsernameOrEmail(userId)!.id) : null);
    if (!profile) {
      return reply.code(404).send({ ok: false, message: `Account not found for identifier: "${userId}".` });
    }

    const previousAccess = profile.sessionAccess ?? "blocked";
    userStore.setSessionAccess(profile.id, normalizedAccess, betaExpiresAt);
    const isOnline = Boolean(runtimeContext?.isUserOnline ? runtimeContext.isUserOnline(profile.id) : false);

    return reply.send({
      ok: true,
      user: {
        ...userStore.getAdminUserDetail(profile.id, isOnline),
        userId: profile.id,
        previousAccess,
        newAccess: normalizedAccess
      }
    });
  });

  // 7. POST /admin/api/users/:userId/beta-expiry - Configure Beta Expiration
  app.post("/admin/api/users/:userId/beta-expiry", async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: "Not Found" });
    }

    if (!validateSameOrigin(request, config)) {
      return reply.code(403).send({ ok: false, message: "Forbidden: invalid origin or cross-site request." });
    }

    if (!isRequestAdminAuthenticated(request, config)) {
      return reply.code(401).send({ ok: false, message: "Unauthorized" });
    }

    const { userId } = request.params as { userId: string };
    const body = (request.body || {}) as any;
    let betaExpiresAt = typeof body === "object" && body ? body.betaExpiresAt : undefined;

    if (betaExpiresAt !== null && typeof betaExpiresAt !== "number" && typeof betaExpiresAt !== "undefined") {
      return reply.code(400).send({ ok: false, message: "Invalid betaExpiresAt timestamp provided." });
    }

    const profile = userStore.getStoredUser(userId) || (userStore.findByUsernameOrEmail(userId) ? userStore.getStoredUser(userStore.findByUsernameOrEmail(userId)!.id) : null);
    if (!profile) {
      return reply.code(404).send({ ok: false, message: `Account not found for identifier: "${userId}".` });
    }

    userStore.setBetaExpiration(profile.id, betaExpiresAt ?? null);
    const isOnline = Boolean(runtimeContext?.isUserOnline ? runtimeContext.isUserOnline(profile.id) : false);

    return reply.send({
      ok: true,
      user: userStore.getAdminUserDetail(profile.id, isOnline)
    });
  });

  // 8. POST /admin/api/users/:userId/note - Configure Internal Admin Note
  app.post("/admin/api/users/:userId/note", async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: "Not Found" });
    }

    if (!validateSameOrigin(request, config)) {
      return reply.code(403).send({ ok: false, message: "Forbidden: invalid origin or cross-site request." });
    }

    if (!isRequestAdminAuthenticated(request, config)) {
      return reply.code(401).send({ ok: false, message: "Unauthorized" });
    }

    const { userId } = request.params as { userId: string };
    const body = (request.body || {}) as any;
    const note = typeof body === "object" && body ? body.note : undefined;

    if (typeof note === "string" && note.trim().length > 2000) {
      return reply.code(400).send({
        ok: false,
        message: "Admin note exceeds maximum length of 2000 characters."
      });
    }

    const profile = userStore.getStoredUser(userId) || (userStore.findByUsernameOrEmail(userId) ? userStore.getStoredUser(userStore.findByUsernameOrEmail(userId)!.id) : null);
    if (!profile) {
      return reply.code(404).send({ ok: false, message: `Account not found for identifier: "${userId}".` });
    }

    try {
      userStore.setAdminNote(profile.id, note);
    } catch (err: any) {
      return reply.code(400).send({
        ok: false,
        message: err.message || "Failed to set admin note."
      });
    }

    const isOnline = Boolean(runtimeContext?.isUserOnline ? runtimeContext.isUserOnline(profile.id) : false);

    return reply.send({
      ok: true,
      user: userStore.getAdminUserDetail(profile.id, isOnline)
    });
  });

  // 9. POST /admin/api/users/bulk-access - Modify Session Access for Multiple Users
  app.post("/admin/api/users/bulk-access", async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: "Not Found" });
    }

    if (!validateSameOrigin(request, config)) {
      return reply.code(403).send({ ok: false, message: "Forbidden: invalid origin or cross-site request." });
    }

    if (!isRequestAdminAuthenticated(request, config)) {
      return reply.code(401).send({ ok: false, message: "Unauthorized" });
    }

    const body = (request.body || {}) as any;
    const userIds = Array.isArray(body?.userIds) ? body.userIds : [];
    const newAccess = typeof body === "object" && body ? body.access : undefined;
    const betaExpiresAt = typeof body === "object" && body && body.betaExpiresAt !== undefined ? body.betaExpiresAt : undefined;

    if (!newAccess || typeof newAccess !== "string") {
      return reply.code(400).send({ ok: false, message: "Missing target access state." });
    }

    const normalizedAccess = newAccess.trim().toLowerCase() as SessionAccessState;
    if (!ALLOWED_SESSION_ACCESS_STATES.includes(normalizedAccess)) {
      return reply.code(400).send({
        ok: false,
        message: `Invalid sessionAccess: "${newAccess}". Allowed values: ${ALLOWED_SESSION_ACCESS_STATES.join(", ")}.`
      });
    }

    let updatedCount = 0;
    for (const id of userIds) {
      if (typeof id === "string" && id.trim()) {
        const stored = userStore.getStoredUser(id) || (userStore.findByUsernameOrEmail(id) ? userStore.getStoredUser(userStore.findByUsernameOrEmail(id)!.id) : null);
        if (stored) {
          userStore.setSessionAccess(stored.id, normalizedAccess, betaExpiresAt);
          updatedCount++;
        }
      }
    }

    return reply.send({ ok: true, updatedCount });
  });

  // 10. POST /admin/api/users/bulk-beta-expiry - Configure Beta Expiration for Multiple Users
  app.post("/admin/api/users/bulk-beta-expiry", async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: "Not Found" });
    }

    if (!validateSameOrigin(request, config)) {
      return reply.code(403).send({ ok: false, message: "Forbidden: invalid origin or cross-site request." });
    }

    if (!isRequestAdminAuthenticated(request, config)) {
      return reply.code(401).send({ ok: false, message: "Unauthorized" });
    }

    const body = (request.body || {}) as any;
    const userIds = Array.isArray(body?.userIds) ? body.userIds : [];
    let betaExpiresAt = typeof body === "object" && body ? body.betaExpiresAt : undefined;

    if (betaExpiresAt !== null && typeof betaExpiresAt !== "number" && typeof betaExpiresAt !== "undefined") {
      return reply.code(400).send({ ok: false, message: "Invalid betaExpiresAt timestamp provided." });
    }

    let updatedCount = 0;
    for (const id of userIds) {
      if (typeof id === "string" && id.trim()) {
        const stored = userStore.getStoredUser(id) || (userStore.findByUsernameOrEmail(id) ? userStore.getStoredUser(userStore.findByUsernameOrEmail(id)!.id) : null);
        if (stored) {
          userStore.setBetaExpiration(stored.id, betaExpiresAt ?? null);
          updatedCount++;
        }
      }
    }

    return reply.send({ ok: true, updatedCount });
  });
}
