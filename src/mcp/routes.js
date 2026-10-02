/**
 * HTTP routes: MCP protocol, OAuth and token management for the settings screen.
 */

import { Router } from "express";
import { isMcpEnabled, isMcpProtocolPath, describeMcpConnection } from "./config.js";
import { registerOAuthRoutes } from "./oauth.js";
import { handleMcpHttp } from "./http.js";
import {
  createPersonalAccessToken,
  listPersonalAccessTokens,
  revokeOAuthGrants,
  revokePersonalAccessToken,
} from "./store.js";

function apiError(res, status, code, message) {
  res.status(status).json({ success: false, error: { code, message } });
}

export function createMcpRouter() {
  const router = Router();

  router.use((req, res, next) => {
    if (!isMcpProtocolPath(req.path)) return next();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Protocol-Version, Accept, Last-Event-ID, X-API-Key"
    );
    res.setHeader(
      "Access-Control-Expose-Headers",
      "WWW-Authenticate, MCP-Protocol-Version, Mcp-Protocol-Version, Mcp-Session-Id"
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return res.status(204).end();
    if (!isMcpEnabled()) return res.status(404).json({ error: "mcp_disabled" });
    next();
  });

  registerOAuthRoutes(router);
  router.post("/mcp", (req, res, next) => {
    handleMcpHttp(req, res).catch(next);
  });
  router.get("/mcp", (req, res, next) => {
    handleMcpHttp(req, res).catch(next);
  });
  router.delete("/mcp", (req, res, next) => {
    handleMcpHttp(req, res).catch(next);
  });

  router.get("/mcp/connection", (req, res) => {
    res.json({ success: true, connection: describeMcpConnection(req) });
  });

  router.get("/mcp/tokens", (req, res) => {
    if (!req.user?.userId || req.user.isLocalOnlySynthetic) {
      return apiError(res, 400, "MCP_USER_REQUIRED", "Войдите под пользователем приложения.");
    }
    res.json({ success: true, tokens: listPersonalAccessTokens(req.user.userId) });
  });

  router.post("/mcp/tokens", (req, res) => {
    if (!isMcpEnabled()) {
      return apiError(res, 404, "MCP_DISABLED", "MCP выключен. Установите MCP_ENABLED=true и перезапустите сервер.");
    }
    try {
      const created = createPersonalAccessToken({
        userId: req.user?.userId,
        name: req.body?.name,
      });
      res.status(201).json({ success: true, token: created.token, tokenMeta: created });
    } catch (error) {
      apiError(res, error.code === "MCP_TOKEN_LIMIT" ? 409 : 400, error.code || "MCP_TOKEN_FAILED", error.message);
    }
  });

  router.post("/mcp/tokens/:id/revoke", (req, res) => {
    if (!req.user?.userId) return apiError(res, 401, "AUTHENTICATION_REQUIRED", "Требуется вход.");
    const ok = revokePersonalAccessToken(req.user.userId, req.params.id);
    if (!ok) return apiError(res, 404, "MCP_TOKEN_NOT_FOUND", "Токен не найден.");
    res.json({ success: true });
  });

  router.post("/mcp/oauth/revoke", (req, res) => {
    if (!req.user?.userId) return apiError(res, 401, "AUTHENTICATION_REQUIRED", "Требуется вход.");
    const revoked = revokeOAuthGrants(req.user.userId);
    res.json({ success: true, revoked });
  });

  return router;
}
