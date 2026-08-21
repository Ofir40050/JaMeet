import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../core/config.js";
import { UserStore } from "../auth/auth.js";
import type { AdminRuntimeContext } from "./adminTypes.js";
import { isRequestAdminAuthenticated } from "./adminAuth.js";

export function registerAdminStatsRoutes(
  app: FastifyInstance,
  userStore: UserStore,
  config: ServerConfig,
  runtimeContext?: AdminRuntimeContext
): void {
  // 11. GET /admin/api/stats - Server Health & Telemetry Metrics
  app.get("/admin/api/stats", async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: "Not Found" });
    }

    if (!isRequestAdminAuthenticated(request, config)) {
      return reply.code(401).send({ ok: false, message: "Unauthorized" });
    }

    const onlineIds = runtimeContext?.getOnlineUserIds ? runtimeContext.getOnlineUserIds() : undefined;
    const users = userStore.listAdminUsers(onlineIds);
    const totalUsers = users.length;
    const betaUsers = users.filter((u) => u.sessionAccess === "beta").length;
    const paidUsers = users.filter((u) => u.sessionAccess === "paid").length;
    const blockedUsers = users.filter((u) => u.sessionAccess === "blocked").length;
    const onlineUsers = onlineIds ? onlineIds.size : users.filter((u) => u.isOnline).length;
    const activeSessions = runtimeContext?.getActiveRoomsCount ? runtimeContext.getActiveRoomsCount() : 0;
    const uptimeSeconds = runtimeContext?.getUptimeSeconds ? runtimeContext.getUptimeSeconds() : Math.floor(process.uptime());

    return reply.send({
      ok: true,
      stats: {
        totalUsers,
        betaUsers,
        paidUsers,
        blockedUsers,
        onlineUsers,
        activeSessions,
        uptimeSeconds,
        isOperational: true
      }
    });
  });
}
