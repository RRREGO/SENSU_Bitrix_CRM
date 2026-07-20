import { Router } from "express";
import { AuthError, getAuthConfig } from "./config.js";
import {
  login,
  logout,
  changePassword,
  listUsers,
  getUser,
  createUser,
  updateUser,
  disableUser,
  enableUser,
  adminResetPassword,
  revokeUserSessions,
  listUserSessions,
} from "./authService.js";
import { listRoles, getRolePermissions, setRolePermissions } from "./authorizationService.js";
import {
  requireAuthentication,
  requirePermissionMiddleware,
  getClientIp,
  parseCookies,
} from "./middleware.js";
import { generateOpaqueToken } from "./passwordService.js";

function setSessionCookie(res, sessionToken, expiresAt) {
  const cfg = getAuthConfig();
  const parts = [
    `${cfg.cookieName}=${encodeURIComponent(sessionToken)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (cfg.cookieSecure) parts.push("Secure");
  if (expiresAt) parts.push(`Expires=${new Date(expiresAt).toUTCString()}`);
  res.append("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  const cfg = getAuthConfig();
  const parts = [
    `${cfg.cookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if (cfg.cookieSecure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

function sendAuthError(res, error) {
  if (error instanceof AuthError) {
    const status =
      error.code === "INVALID_CREDENTIALS" || error.code === "AUTHENTICATION_REQUIRED"
        ? 401
        : error.code === "LOGIN_RATE_LIMITED"
          ? 429
          : 403;
    return res.status(status).json(error.toJSON());
  }
  return res.status(500).json({
    success: false,
    error: { code: "INTERNAL", message: error.message },
  });
}

export function createAuthRouter() {
  const router = Router();

  router.post("/auth/login", async (req, res) => {
    try {
      const result = await login(req.body?.username, req.body?.password, {
        ip: getClientIp(req),
        userAgent: req.get("user-agent") || "",
      });
      setSessionCookie(res, result.session.sessionToken, result.session.expiresAt);
      res.json({
        success: true,
        user: {
          id: result.user.id,
          displayName: result.user.displayName,
          role: result.user.role,
          mustChangePassword: result.user.mustChangePassword,
          dataScope: result.user.dataScope,
        },
        csrfToken: result.session.csrfToken,
        expiresAt: result.session.expiresAt,
        permissions: [...result.principal.permissions],
      });
    } catch (error) {
      sendAuthError(res, error);
    }
  });

  router.post("/auth/logout", requireAuthentication(), (req, res) => {
    try {
      const cfg = getAuthConfig();
      const token = parseCookies(req)[cfg.cookieName];
      logout(token, { ip: getClientIp(req) });
      clearSessionCookie(res);
      res.json({ success: true });
    } catch (error) {
      sendAuthError(res, error);
    }
  });

  router.get("/auth/me", requireAuthentication(), (req, res) => {
    if (req.user?.isLocalOnlySynthetic) {
      return res.json({
        success: true,
        mode: "local_only",
        user: {
          displayName: req.user.displayName,
          role: req.user.role,
          mustChangePassword: false,
        },
        permissions: [...req.user.permissions],
      });
    }
    res.json({
      success: true,
      user: req.auth?.user,
      permissions: [...(req.user?.permissions || [])],
      csrfTokenAvailable: Boolean(req.sessionRow),
    });
  });

  router.get("/auth/csrf", requireAuthentication(), (req, res) => {
    if (req.user?.isLocalOnlySynthetic) {
      return res.json({ success: true, csrfToken: generateOpaqueToken(24), localOnly: true });
    }
    if (!req.sessionRow) {
      return res.status(401).json({
        success: false,
        error: { code: "AUTHENTICATION_REQUIRED", message: "Требуется вход в систему." },
      });
    }
    const csrfToken = rotateCsrf(req.sessionRow.id);
    req.sessionRow.csrf_token_hash = undefined; // force re-read next request
    res.json({ success: true, csrfToken });
  });

  router.post("/auth/change-password", requireAuthentication(), async (req, res) => {
    try {
      if (req.user?.isLocalOnlySynthetic) {
        throw new AuthError("PERMISSION_DENIED", "В local_only смените bootstrap через UI после login.");
      }
      await changePassword(req.user.userId, req.body?.currentPassword, req.body?.newPassword, {
        sessionId: req.sessionRow?.id,
      });
      res.json({ success: true });
    } catch (error) {
      sendAuthError(res, error);
    }
  });

  router.get("/auth/sessions", requireAuthentication(), (req, res) => {
    if (req.user?.isLocalOnlySynthetic) return res.json({ success: true, sessions: [] });
    res.json({ success: true, sessions: listUserSessions(req.user.userId) });
  });

  router.post("/auth/sessions/:id/revoke", requireAuthentication(), async (req, res) => {
    try {
      const { revokeSession } = await import("./sessionService.js");
      const sessions = listUserSessions(req.user.userId);
      const own = sessions.find((s) => s.id === req.params.id);
      if (!own && !req.user.permissions?.has("users.manage")) {
        throw new AuthError("PERMISSION_DENIED", "Сессия не найдена.");
      }
      revokeSession(req.params.id);
      res.json({ success: true });
    } catch (error) {
      sendAuthError(res, error);
    }
  });

  // Users
  router.get(
    "/users",
    requireAuthentication(),
    requirePermissionMiddleware("users.manage"),
    (req, res) => {
      res.json({ success: true, users: listUsers(req.user) });
    }
  );

  router.post(
    "/users",
    requireAuthentication(),
    requirePermissionMiddleware("users.manage"),
    async (req, res) => {
      try {
        const user = await createUser({ ...req.body, actor: req.user });
        res.json({ success: true, user });
      } catch (error) {
        sendAuthError(res, error);
      }
    }
  );

  router.get(
    "/users/:id",
    requireAuthentication(),
    requirePermissionMiddleware("users.manage"),
    (req, res) => {
      const user = getUser(req.user, req.params.id);
      if (!user) return res.status(404).json({ success: false, error: { code: "PERMISSION_DENIED", message: "Не найден" } });
      res.json({ success: true, user });
    }
  );

  router.patch(
    "/users/:id",
    requireAuthentication(),
    requirePermissionMiddleware("users.manage"),
    (req, res) => {
      try {
        res.json({ success: true, user: updateUser(req.user, req.params.id, req.body || {}) });
      } catch (error) {
        sendAuthError(res, error);
      }
    }
  );

  router.post(
    "/users/:id/disable",
    requireAuthentication(),
    requirePermissionMiddleware("users.manage"),
    (req, res) => {
      try {
        res.json({ success: true, user: disableUser(req.user, req.params.id) });
      } catch (error) {
        sendAuthError(res, error);
      }
    }
  );

  router.post(
    "/users/:id/enable",
    requireAuthentication(),
    requirePermissionMiddleware("users.manage"),
    (req, res) => {
      try {
        res.json({ success: true, user: enableUser(req.user, req.params.id) });
      } catch (error) {
        sendAuthError(res, error);
      }
    }
  );

  router.post(
    "/users/:id/reset-password",
    requireAuthentication(),
    requirePermissionMiddleware("users.manage"),
    async (req, res) => {
      try {
        await adminResetPassword(req.user, req.params.id, req.body?.password);
        res.json({ success: true });
      } catch (error) {
        sendAuthError(res, error);
      }
    }
  );

  router.post(
    "/users/:id/revoke-sessions",
    requireAuthentication(),
    requirePermissionMiddleware("users.manage"),
    (req, res) => {
      try {
        res.json(revokeUserSessions(req.user, req.params.id));
      } catch (error) {
        sendAuthError(res, error);
      }
    }
  );

  router.get(
    "/roles",
    requireAuthentication(),
    requirePermissionMiddleware("roles.manage"),
    (_req, res) => {
      const roles = listRoles().map((r) => ({
        ...r,
        permissions: getRolePermissions(r.id),
      }));
      res.json({ success: true, roles });
    }
  );

  router.get(
    "/roles/:id",
    requireAuthentication(),
    requirePermissionMiddleware("roles.manage"),
    (req, res) => {
      const role = listRoles().find((r) => r.id === req.params.id || r.code === req.params.id);
      if (!role) return res.status(404).json({ success: false });
      res.json({
        success: true,
        role: { ...role, permissions: getRolePermissions(role.id) },
      });
    }
  );

  router.patch(
    "/roles/:id/permissions",
    requireAuthentication(),
    requirePermissionMiddleware("roles.manage"),
    (req, res) => {
      try {
        const role = listRoles().find((r) => r.id === req.params.id);
        if (!role) throw new AuthError("PERMISSION_DENIED", "Роль не найдена.");
        if (role.code === "administrator") {
          throw new AuthError("PERMISSION_DENIED", "Системную роль administrator нельзя удалить/очистить.");
        }
        const permissions = setRolePermissions(role.id, req.body?.permissions || []);
        res.json({ success: true, permissions });
      } catch (error) {
        sendAuthError(res, error);
      }
    }
  );

  return router;
}
