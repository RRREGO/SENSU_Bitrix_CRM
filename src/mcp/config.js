/**
 * Remote MCP (ChatGPT, Cursor, Claude) over Streamable HTTP.
 * On by default. Set MCP_ENABLED=false to turn it off.
 */

import { getAuthConfig } from "../auth/config.js";

export const MCP_SCOPES = ["mcp", "offline_access"];

/** Уже опубликованное приложение. ChatGPT подключается сюда, а не к localhost. */
export const PUBLISHED_ORIGIN = "https://agent.goerp.pro";

export function isMcpEnabled() {
  const raw = process.env.MCP_ENABLED;
  if (raw == null || String(raw).trim() === "") return true;
  return /^(1|true|yes|on)$/i.test(String(raw));
}

/** Paths that authenticate with a bearer token or the OAuth dance, not the browser session. */
export function isMcpProtocolPath(path) {
  const p = String(path || "").split("?")[0];
  if (p === "/mcp") return true;
  if (p === "/.well-known/oauth-protected-resource") return true;
  if (p === "/.well-known/oauth-protected-resource/mcp") return true;
  if (p === "/.well-known/oauth-authorization-server") return true;
  if (p.startsWith("/oauth/")) return true;
  return false;
}

export function resolvePublicOrigin(req) {
  const configured = String(getAuthConfig().publicOrigin || "").replace(/\/$/, "");
  if (configured) return configured;
  const host = req.get("host") || "127.0.0.1";
  const proto = req.protocol || "http";
  return `${proto}://${host}`.replace(/\/$/, "");
}

export function describeMcpConnection(req) {
  const origin = resolvePublicOrigin(req);
  const configured = String(getAuthConfig().publicOrigin || "").replace(/\/$/, "");
  const chatgptOrigin = configured.startsWith("https://") ? configured : PUBLISHED_ORIGIN;
  return {
    enabled: isMcpEnabled(),
    origin,
    mcpUrl: `${origin}/mcp`,
    chatgptUrl: `${chatgptOrigin}/mcp`,
    protectedResourceMetadata: `${chatgptOrigin}/.well-known/oauth-protected-resource`,
    authorizationServerMetadata: `${chatgptOrigin}/.well-known/oauth-authorization-server`,
    https: chatgptOrigin.startsWith("https://"),
    publicOriginConfigured: Boolean(configured),
  };
}

export function accessTokenTtlSeconds() {
  const n = Number(process.env.MCP_ACCESS_TOKEN_TTL_MINUTES);
  const minutes = Number.isFinite(n) && n > 0 ? Math.floor(n) : 60;
  return minutes * 60;
}

export function refreshTokenTtlMs() {
  const n = Number(process.env.MCP_REFRESH_TOKEN_TTL_DAYS);
  const days = Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
  return days * 24 * 60 * 60 * 1000;
}

export function personalTokenTtlMs() {
  const n = Number(process.env.MCP_PAT_TTL_DAYS);
  const days = Number.isFinite(n) && n > 0 ? Math.floor(n) : 90;
  return days * 24 * 60 * 60 * 1000;
}
