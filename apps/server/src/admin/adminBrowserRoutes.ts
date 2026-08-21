import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../core/config.js";
import { getClientIp } from "../core/client-ip.js";
import {
  ADMIN_SESSION_MAX_AGE_SEC
} from "./adminConstants.js";
import {
  buildAdminCookie,
  buildClearAdminCookie,
  verifyAdminSecret,
  createAdminSessionToken,
  isRequestAdminAuthenticated,
  validateSameOrigin
} from "./adminAuth.js";
import {
  checkRateLimit,
  recordFailedLogin,
  clearFailedLogin
} from "./adminRateLimit.js";
import { renderLoginPage } from "./adminLoginTemplate.js";
import { renderAdminDashboard } from "./adminDashboardTemplate.js";

export function registerAdminBrowserRoutes(
  app: FastifyInstance,
  config: ServerConfig
): void {
  // 1. GET /admin - Main Web Interface
  app.get("/admin", async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: "Not Found" });
    }

    const isAuthenticated = isRequestAdminAuthenticated(request, config);
    if (!isAuthenticated) {
      const errorQuery = (request.query as any)?.error;
      let errorMsg: string | undefined;
      if (errorQuery === "invalid_secret") {
        errorMsg = "Incorrect admin secret provided. Please try again.";
      } else if (errorQuery === "rate_limited") {
        errorMsg = "Too many failed login attempts. Please wait 1 minute.";
      }
      return reply.type("text/html; charset=utf-8").send(renderLoginPage(errorMsg));
    }

    return reply.type("text/html; charset=utf-8").send(renderAdminDashboard());
  });

  // 2. POST /admin/login - Browser Form & JSON Login
  app.post("/admin/login", async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: "Not Found" });
    }

    if (!validateSameOrigin(request, config)) {
      return reply.code(403).send({ ok: false, message: "Forbidden: invalid origin or cross-site request." });
    }

    const ip = getClientIp(request);
    if (!checkRateLimit(ip)) {
      const isJson = request.headers.accept?.includes("application/json");
      if (isJson) {
        return reply.code(429).send({ ok: false, message: "Too many failed login attempts. Please wait 1 minute." });
      }
      return reply.code(303).redirect("/admin?error=rate_limited");
    }

    const body = request.body as any;
    const submittedSecret = typeof body === "object" && body ? (body.secret || "") : "";

    const isValid = verifyAdminSecret(submittedSecret, adminSecret);
    const isJson = request.headers.accept?.includes("application/json");
    const isHttps = request.headers["x-forwarded-proto"] === "https" || Boolean((request.raw.socket as any)?.encrypted);

    if (!isValid) {
      recordFailedLogin(ip);
      if (isJson) {
        return reply.code(401).send({ ok: false, message: "Invalid admin secret." });
      }
      return reply.code(303).redirect("/admin?error=invalid_secret");
    }

    clearFailedLogin(ip);
    const sessionToken = createAdminSessionToken(adminSecret);
    const cookieHeader = buildAdminCookie(sessionToken, ADMIN_SESSION_MAX_AGE_SEC, config.NODE_ENV === "production", Boolean(isHttps));
    reply.header("Set-Cookie", cookieHeader);

    if (isJson) {
      return reply.send({ ok: true });
    }
    return reply.code(303).redirect("/admin");
  });

  // 3. POST /admin/logout - Browser & API Logout (POST only)
  app.post("/admin/logout", async (request, reply) => {
    const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
    if (!adminSecret) {
      return reply.code(404).send({ ok: false, message: "Not Found" });
    }

    if (!validateSameOrigin(request, config)) {
      return reply.code(403).send({ ok: false, message: "Forbidden: invalid origin or cross-site request." });
    }

    const isHttps = request.headers["x-forwarded-proto"] === "https" || Boolean((request.raw.socket as any)?.encrypted);
    const clearCookie = buildClearAdminCookie(config.NODE_ENV === "production", Boolean(isHttps));
    reply.header("Set-Cookie", clearCookie);

    const isJson = request.headers.accept?.includes("application/json");
    if (isJson) {
      return reply.send({ ok: true });
    }
    return reply.code(303).redirect("/admin");
  });
}
