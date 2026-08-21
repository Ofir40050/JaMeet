import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../core/config.js";
import { UserStore } from "../auth/auth.js";
import type { AdminRuntimeContext } from "./adminTypes.js";
import { registerAdminBrowserRoutes } from "./adminBrowserRoutes.js";
import { registerAdminUserRoutes } from "./adminUserRoutes.js";
import { registerAdminStatsRoutes } from "./adminStatsRoutes.js";

export function registerAdminPanel(
  app: FastifyInstance,
  userStore: UserStore,
  config: ServerConfig,
  runtimeContext?: AdminRuntimeContext
): void {
  // Ensure application/x-www-form-urlencoded parsing is supported for native form POSTs
  if (!app.hasContentTypeParser("application/x-www-form-urlencoded")) {
    app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (req, body, done) => {
      try {
        const parsed = Object.fromEntries(new URLSearchParams(body as string));
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    });
  }

  // Register route groups
  registerAdminBrowserRoutes(app, config);
  registerAdminUserRoutes(app, userStore, config, runtimeContext);
  registerAdminStatsRoutes(app, userStore, config, runtimeContext);
}
