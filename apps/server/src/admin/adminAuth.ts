import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { ServerConfig } from "../core/config.js";
import {
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_TTL_MS
} from "./adminConstants.js";

export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) {
      cookies[key] = decodeURIComponent(val);
    }
  }
  return cookies;
}

export function buildAdminCookie(token: string, maxAgeSeconds: number, isProduction: boolean, isHttps: boolean): string {
  const parts = [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`
  ];
  if (isProduction || isHttps) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function buildClearAdminCookie(isProduction: boolean, isHttps: boolean): string {
  const parts = [
    `${ADMIN_SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (isProduction || isHttps) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function verifyAdminSecret(submitted: string, actualSecret: string): boolean {
  if (!submitted || !actualSecret) return false;
  const submittedBuf = Buffer.from(submitted.normalize("NFC"), "utf-8");
  const actualBuf = Buffer.from(actualSecret.normalize("NFC"), "utf-8");
  if (submittedBuf.length !== actualBuf.length) {
    crypto.timingSafeEqual(submittedBuf, submittedBuf);
    return false;
  }
  return crypto.timingSafeEqual(submittedBuf, actualBuf);
}

export function createAdminSessionToken(adminSecret: string): string {
  const issuedAt = Date.now();
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = `${issuedAt}.${nonce}`;
  const hmac = crypto.createHmac("sha256", adminSecret).update(payload).digest("hex");
  return `${payload}.${hmac}`;
}

export function verifyAdminSessionToken(token: string | undefined, adminSecret: string | undefined): boolean {
  if (!token || !adminSecret || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [issuedAtStr, nonce, receivedHmac] = parts;
  if (!issuedAtStr || !nonce || !receivedHmac) return false;
  if (receivedHmac.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(receivedHmac)) return false;

  const issuedAt = parseInt(issuedAtStr, 10);
  if (isNaN(issuedAt)) return false;

  const now = Date.now();
  if (now - issuedAt > ADMIN_SESSION_TTL_MS || issuedAt > now + 60000) {
    return false; // Expired or invalid timestamp
  }

  const payload = `${issuedAtStr}.${nonce}`;
  const expectedHmac = crypto.createHmac("sha256", adminSecret).update(payload).digest("hex");

  const expBuf = Buffer.from(expectedHmac, "hex");
  const recBuf = Buffer.from(receivedHmac, "hex");
  if (expBuf.length !== recBuf.length) return false;

  return crypto.timingSafeEqual(expBuf, recBuf);
}

export function isRequestAdminAuthenticated(request: FastifyRequest, config: ServerConfig): boolean {
  const adminSecret = config.JAMEET_ADMIN_SECRET?.trim();
  if (!adminSecret) return false;
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[ADMIN_SESSION_COOKIE_NAME];
  return verifyAdminSessionToken(token, adminSecret);
}

export function validateSameOrigin(request: FastifyRequest, config: ServerConfig): boolean {
  const secFetchSite = request.headers["sec-fetch-site"];
  if (secFetchSite === "cross-site") {
    return false;
  }

  const origin = request.headers.origin;
  const referer = request.headers.referer;
  const host = request.headers.host;

  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      if (host && (parsedOrigin.host === host || parsedOrigin.hostname === host.split(":")[0])) {
        return true;
      }
      if (parsedOrigin.hostname === "localhost" || parsedOrigin.hostname === "127.0.0.1") {
        return true;
      }
      if (config.ALLOWED_ORIGINS) {
        const allowed = config.ALLOWED_ORIGINS.split(",").map((v) => v.trim()).filter(Boolean);
        if (allowed.includes(origin) || allowed.includes("*")) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  if (referer) {
    try {
      const parsedReferer = new URL(referer);
      if (host && (parsedReferer.host === host || parsedReferer.hostname === host.split(":")[0])) {
        return true;
      }
      if (parsedReferer.hostname === "localhost" || parsedReferer.hostname === "127.0.0.1") {
        return true;
      }
      if (config.ALLOWED_ORIGINS) {
        const allowed = config.ALLOWED_ORIGINS.split(",").map((v) => v.trim()).filter(Boolean);
        if (allowed.includes(parsedReferer.origin) || allowed.includes("*")) {
          return true;
        }
      }
    } catch {
      return false;
    }
  }

  return true;
}
