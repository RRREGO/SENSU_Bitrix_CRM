/**
 * Express middleware: access mode, session, CSRF, permissions.
 */

import { AuthError, getAuthConfig } from "./config.js";
import { resolveSession } from "./authService.js";
import { assertCsrf, isStateChanging } from "./csrfService.js";
import { assertApiRateLimit } from "./rateLimitService.js";
import {
  hasPermission,
  requirePermission,
  requireAnyPermission,
  authorizeResourceAccess,
  recordAuthEvent,
} from "./authorizationService.js";
import { sha256Hex } from "./passwordService.js";

export function assertOrigin(req) {
  if (!isStateChanging(req.method)) return;
  const cfg = getAuthConfig();
  const origin = req.get("origin");
  if (!origin) return; // same-origin navigations may omit
  const allowed = cfg.allowedOrigins || [];
  if (cfg.publicOrigin && !allowed.includes(cfg.publicOrigin)) {
    allowed.push(cfg.publicOrigin);
  }
  if (!allowed.includes(origin)) {
    throw new AuthError("APP_ACCESS_RESTRICTED", "Origin не разрешён.");
  }
}

export function getClientIp(req) {
  const cfg = getAuthConfig();
  if (cfg.trustProxy) {
    // Only trust X-Forwarded-For when proxy CIDRs configured (validated at boot)
    const xf = req.get("x-forwarded-for");
    if (xf && cfg.trustedProxyCidrs?.length) {
      return String(xf).split(",")[0].trim();
    }
  }
  return req.socket?.remoteAddress || req.ip || "";
}

export function parseCookies(req) {
  const header = req.get("cookie") || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    out[k] = v;
  }
  return out;
}

function normalizeIp(ip) {
  let s = String(ip || "");
  if (s.startsWith("::ffff:")) s = s.slice(7);
  if (s === "::1") return "127.0.0.1";
  return s;
}

export function assertLocalOnlyAccess(req) {
  const cfg = getAuthConfig();
  if (cfg.accessMode !== "local_only") return;
  if (cfg.isProduction) {
    throw new AuthError(
      "UNSAFE_PRODUCTION_ACCESS_CONFIGURATION",
      "local_only / synthetic principal запрещены в production."
    );
  }
  const ip = normalizeIp(getClientIp(req));
  const allowed = cfg.allowedIps.map(normalizeIp);
  if (!allowed.includes(ip) && ip !== "127.0.0.1" && ip !== "::1") {
    throw new AuthError("APP_ACCESS_RESTRICTED", "Доступ к приложению ограничен.");
  }
}

export function accessGateMiddleware(req, res, next) {
  try {
    assertLocalOnlyAccess(req);
    next();
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(403).json(error.toJSON());
    }
    next(error);
  }
}

export function securityHeadersMiddleware(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(self), camera=()");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
  );
  const cfg = getAuthConfig();
  if (cfg.isProduction && cfg.cookieSecure) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

export async function optionalAuthMiddleware(req, _res, next) {
  try {
    const cfg = getAuthConfig();
    const cookies = parseCookies(req);
    const token = cookies[cfg.cookieName] || null;
    if (token) {
      const resolved = resolveSession(token);
      if (resolved) {
        req.auth = resolved;
        req.user = resolved.principal;
        req.sessionRow = resolved.session;
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuthentication() {
  return (req, res, next) => {
    try {
      const cfg = getAuthConfig();
      if (cfg.accessMode === "local_only" && !req.user) {
        if (cfg.isProduction) {
          throw new AuthError(
            "UNSAFE_PRODUCTION_ACCESS_CONFIGURATION",
            "synthetic principal запрещён в production."
          );
        }
        // local_only synthetic principal — development only
        req.user = {
          userId: "local-dev",
          username: "local",
          displayName: "Local Developer",
          role: "administrator",
          bitrixUserId: null,
          dataScope: "all",
          isActive: true,
          mustChangePassword: false,
          permissions: new Set(
            // lazy import avoided — grant all for local_only anonymous until login exists
            [
              "crm.read.all",
              "crm.read.own",
              "crm.context.read",
              "analytics.run",
              "reports.view",
              "reports.run",
              "schedules.view",
              "schedules.manage",
              "notifications.view",
              "chats.manage.own",
              "chats.manage.all",
              "projects.view",
              "projects.manage",
              "profiles.view",
              "profiles.manage",
              "operations.view.own",
              "operations.view.all",
              "operations.prepare",
              "operations.confirm.own",
              "operations.confirm.any",
              "operations.rollback",
              "communications.draft",
              "communications.send",
              "communications.view.own",
              "communications.view.all",
              "settings.view",
              "settings.manage",
              "users.manage",
              "roles.manage",
              "audit.view",
              "manage_ai_providers",
              "use_ai_provider",
              "manage_ai_models",
              "select_chat_model",
              "manage_prompt_profiles",
              "assign_prompt_profiles",
              "manage_proxy_profiles",
              "use_proxy_profiles",
              "use_voice_input",
              "manage_communication_accounts",
              "send_wazzup_messages",
              "send_email_messages",
              "view_communication_audit",
              "approve_external_send",
            ]
          ),
          principal: "system:local_only",
          isLocalOnlySynthetic: true,
        };
        return next();
      }
      if (!req.user) {
        throw new AuthError("AUTHENTICATION_REQUIRED", "Требуется вход в систему.");
      }
      if (req.user.mustChangePassword && !String(req.path || "").includes("/auth/change-password")) {
        if (isStateChanging(req.method) && !String(req.path).includes("/auth/")) {
          throw new AuthError(
            "PASSWORD_CHANGE_REQUIRED",
            "Необходимо сменить пароль перед продолжением работы."
          );
        }
      }
      assertOrigin(req);
      if (isStateChanging(req.method) && req.sessionRow && !req.user.isLocalOnlySynthetic) {
        assertCsrf(req, req.sessionRow);
      }
      assertApiRateLimit({
        userId: req.user.userId,
        sessionId: req.sessionRow?.id,
        ipHash: sha256Hex(getClientIp(req)).slice(0, 32),
      });
      next();
    } catch (error) {
      if (error instanceof AuthError) {
        if (error.code === "PERMISSION_DENIED" || error.code === "CSRF_VALIDATION_FAILED") {
          recordAuthEvent({
            userId: req.user?.userId || null,
            eventType: error.code === "CSRF_VALIDATION_FAILED" ? "csrf_rejected" : "permission_denied",
            result: "failure",
          });
        }
        const status =
          error.code === "AUTHENTICATION_REQUIRED" || error.code === "SESSION_EXPIRED"
            ? 401
            : error.code === "CSRF_VALIDATION_FAILED"
              ? 403
              : 403;
        return res.status(status).json(error.toJSON());
      }
      next(error);
    }
  };
}

export function requirePermissionMiddleware(permission) {
  return (req, res, next) => {
    try {
      requirePermission(req.user, permission);
      next();
    } catch (error) {
      if (error instanceof AuthError) return res.status(403).json(error.toJSON());
      next(error);
    }
  };
}

export function requireAnyPermissionMiddleware(permissions) {
  return (req, res, next) => {
    try {
      requireAnyPermission(req.user, permissions);
      next();
    } catch (error) {
      if (error instanceof AuthError) return res.status(403).json(error.toJSON());
      next(error);
    }
  };
}

export {
  requirePermission,
  requireAnyPermission,
  authorizeResourceAccess,
  hasPermission,
};
