/**
 * OAuth 2.1 authorization server for remote MCP clients (ChatGPT, Codex).
 * Authorization code + PKCE S256, public clients, refresh tokens, CIMD and DCR.
 */

import crypto from "crypto";
import { AuthError, getAuthConfig } from "../auth/config.js";
import { login, resolveSession } from "../auth/authService.js";
import { getClientIp, parseCookies } from "../auth/middleware.js";
import { MCP_SCOPES, resolvePublicOrigin } from "./config.js";
import {
  consumeAuthorizationCode,
  createAuthorizationCode,
  readAuthorizationCode,
  createOAuthTransaction,
  deleteOAuthTransaction,
  getOAuthClient,
  getOAuthTransaction,
  issueOAuthTokenPair,
  rotateRefreshToken,
  saveOAuthClient,
} from "./store.js";
import { renderConsentPage, renderLoginPage, renderMessagePage } from "./pages.js";
import { generateOpaqueToken } from "../auth/passwordService.js";

const TXN_COOKIE = "mcp_oauth_txn";
const CIMD_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
const cimdCache = new Map();
const rateBuckets = new Map();

function html(res, status, body) {
  res.status(status).type("html").set("Cache-Control", "no-store").send(body);
}

function oauthError(res, status, error, description) {
  res.status(status).set("Cache-Control", "no-store").json({
    error,
    error_description: description,
  });
}

function allowRate(key, limit) {
  const now = Date.now();
  const fresh = (rateBuckets.get(key) || []).filter((ts) => now - ts < 60_000);
  if (fresh.length >= limit) {
    rateBuckets.set(key, fresh);
    return false;
  }
  fresh.push(now);
  rateBuckets.set(key, fresh);
  return true;
}

function sessionCookie(res, sessionToken, expiresAt) {
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

function txnCookie(res, id) {
  const cfg = getAuthConfig();
  const parts = [`${TXN_COOKIE}=${encodeURIComponent(id)}`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=600"];
  if (cfg.cookieSecure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

function clearTxnCookie(res) {
  const cfg = getAuthConfig();
  const parts = [`${TXN_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (cfg.cookieSecure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

export function isAllowedRedirectUri(uri) {
  let url;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  const host = url.hostname.toLowerCase();
  const path = url.pathname || "/";
  if (url.protocol === "https:" && host === "chatgpt.com") {
    if (path === "/connector_platform_oauth_redirect") return true;
    if (path.startsWith("/connector/oauth/")) return true;
  }
  if (
    url.protocol === "https:" &&
    (host === "claude.ai" || host === "claude.com") &&
    path === "/api/mcp/auth_callback"
  ) {
    return true;
  }
  if (
    url.protocol === "http:" &&
    (host === "127.0.0.1" || host === "localhost" || host === "[::1]") &&
    path.startsWith("/callback")
  ) {
    return true;
  }
  const extra = String(process.env.MCP_OAUTH_REDIRECT_ALLOWLIST || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const exact = `${url.origin}${url.pathname}`;
  for (const item of extra) {
    if (item.endsWith("*") && exact.startsWith(item.slice(0, -1))) return true;
    if (item === exact || item === uri) return true;
  }
  return false;
}

function cimdHosts() {
  const hosts = new Set(CIMD_HOSTS);
  for (const host of String(process.env.MCP_OAUTH_CIMD_HOSTS || "").split(",")) {
    const clean = host.trim().toLowerCase();
    if (clean) hosts.add(clean);
  }
  return hosts;
}

export async function loadClientMetadataDocument(clientId) {
  let url;
  try {
    url = new URL(clientId);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  if (!cimdHosts().has(url.hostname.toLowerCase())) return null;
  if (!url.pathname.startsWith("/oauth/") || !url.pathname.endsWith(".json")) return null;
  const cached = cimdCache.get(clientId);
  if (cached && cached.expiresAt > Date.now()) return cached.doc;
  const response = await fetch(clientId, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
    headers: { accept: "application/json", "user-agent": "bitrix-crm-mcp" },
  });
  if (response.status >= 300 && response.status < 400) return null;
  if (!response.ok) return null;
  const text = await response.text();
  if (text.length > 65536) return null;
  const doc = JSON.parse(text);
  if (!doc || doc.client_id !== clientId || !Array.isArray(doc.redirect_uris)) return null;
  cimdCache.set(clientId, { doc, expiresAt: Date.now() + 10 * 60 * 1000 });
  return doc;
}

function parseScopes(raw) {
  if (raw == null || String(raw).trim() === "") return ["mcp", "offline_access"];
  const parts = [...new Set(String(raw).trim().split(/\s+/).filter(Boolean))];
  if (parts.some((scope) => !MCP_SCOPES.includes(scope))) return null;
  if (!parts.includes("mcp")) parts.unshift("mcp");
  return parts;
}

function sameResource(issuer, resource) {
  if (!resource) return true;
  const left = String(issuer).replace(/\/$/, "");
  const right = String(resource).replace(/\/$/, "");
  return right === left || right === `${left}/mcp`;
}

function redirectWithQuery(redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") url.searchParams.set(key, value);
  }
  return url.toString();
}

function currentUser(req) {
  const cfg = getAuthConfig();
  const token = parseCookies(req)[cfg.cookieName];
  if (!token) return null;
  try {
    return resolveSession(token);
  } catch {
    return null;
  }
}

function txnId(req) {
  return parseCookies(req)[TXN_COOKIE] || "";
}

export function protectedResourceMetadata(origin) {
  return {
    resource: origin,
    authorization_servers: [origin],
    scopes_supported: MCP_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Bitrix24 CRM Assistant",
  };
}

export function authorizationServerMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    scopes_supported: MCP_SCOPES,
  };
}

export function verifyPkce(verifier, challenge) {
  if (!verifier || !challenge) return false;
  const actual = crypto.createHash("sha256").update(String(verifier)).digest("base64url");
  const left = Buffer.from(actual);
  const right = Buffer.from(String(challenge));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function resolveClientRedirect(clientId, redirectUri) {
  if (!isAllowedRedirectUri(redirectUri)) return null;
  if (String(clientId).startsWith("https://")) {
    const doc = await loadClientMetadataDocument(clientId);
    if (!doc) return null;
    if (!doc.redirect_uris.includes(redirectUri)) return null;
    return { clientId, clientName: doc.client_name || "ChatGPT", redirectUri };
  }
  const client = getOAuthClient(clientId);
  if (!client) return null;
  if (!client.redirectUris.includes(redirectUri)) return null;
  return { clientId, clientName: client.clientName, redirectUri };
}

export function registerOAuthRoutes(router) {
  router.get("/.well-known/oauth-protected-resource", (req, res) => {
    res.set("Cache-Control", "no-store").json(protectedResourceMetadata(resolvePublicOrigin(req)));
  });
  router.get("/.well-known/oauth-protected-resource/mcp", (req, res) => {
    res.set("Cache-Control", "no-store").json(protectedResourceMetadata(resolvePublicOrigin(req)));
  });
  router.get("/.well-known/oauth-authorization-server", (req, res) => {
    res.set("Cache-Control", "no-store").json(authorizationServerMetadata(resolvePublicOrigin(req)));
  });

  router.post("/oauth/register", (req, res) => {
    if (!allowRate(`register:${getClientIp(req)}`, 30)) {
      return oauthError(res, 429, "temporarily_unavailable", "Слишком много запросов.");
    }
    const body = req.body || {};
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
    if (!redirectUris.length || redirectUris.length > 8) {
      return oauthError(res, 400, "invalid_client_metadata", "Нужен список redirect_uris.");
    }
    if (redirectUris.some((uri) => !isAllowedRedirectUri(uri))) {
      return oauthError(res, 400, "invalid_redirect_uri", "redirect_uri не разрешён.");
    }
    const method = body.token_endpoint_auth_method || "none";
    if (method !== "none") {
      return oauthError(res, 400, "invalid_client_metadata", "Поддерживается только token_endpoint_auth_method=none.");
    }
    const clientId = `mcp_client_${generateOpaqueToken(18)}`;
    const clientName = String(body.client_name || "MCP client").slice(0, 120);
    saveOAuthClient({ clientId, clientName, redirectUris });
    res.status(201).json({
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_id_issued_at: Math.floor(Date.now() / 1000),
    });
  });

  router.get("/oauth/authorize", async (req, res) => {
    if (!allowRate(`authorize:${getClientIp(req)}`, 60)) {
      return html(res, 429, renderMessagePage({ title: "Слишком много запросов", message: "Повторите подключение чуть позже." }));
    }
    const issuer = resolvePublicOrigin(req);
    const clientId = String(req.query.client_id || "");
    const redirectUri = String(req.query.redirect_uri || "");
    const state = String(req.query.state || "");
    const challenge = String(req.query.code_challenge || "");
    const method = String(req.query.code_challenge_method || "");
    const resource = String(req.query.resource || "");
    const scopes = parseScopes(req.query.scope);
    if (!clientId || !redirectUri || !isAllowedRedirectUri(redirectUri)) {
      return html(res, 400, renderMessagePage({
        title: "Нельзя продолжить",
        message: "Адрес возврата не разрешён. Подключение нужно начать из чата.",
      }));
    }
    const fail = (error, description) => {
      res.redirect(redirectWithQuery(redirectUri, { error, error_description: description, state, iss: issuer }));
    };
    if (req.query.response_type !== "code") return fail("unsupported_response_type", "Нужен response_type=code.");
    if (!state || state.length > 2048) return fail("invalid_request", "Нужен параметр state.");
    if (method !== "S256" || challenge.length < 43 || challenge.length > 128) {
      return fail("invalid_request", "Нужен PKCE S256.");
    }
    if (!scopes) return fail("invalid_scope", "Неизвестный scope.");
    if (!sameResource(issuer, resource)) return fail("invalid_target", "Параметр resource не совпадает с этим сервером.");
    let client;
    try {
      client = await resolveClientRedirect(clientId, redirectUri);
    } catch {
      return fail("invalid_client", "Не удалось проверить клиента.");
    }
    if (!client) return fail("invalid_client", "Клиент или redirect_uri не зарегистрированы.");
    const id = createOAuthTransaction({
      clientId,
      clientName: client.clientName,
      redirectUri,
      codeChallenge: challenge,
      resource: issuer,
      scopes,
      state,
    });
    txnCookie(res, id);
    const session = currentUser(req);
    if (!session?.principal) return res.redirect("/oauth/login");
    return res.redirect("/oauth/consent");
  });

  router.get("/oauth/login", (req, res) => {
    const txn = getOAuthTransaction(txnId(req));
    if (!txn) {
      return html(res, 400, renderMessagePage({
        title: "Подключение не найдено",
        message: "Начните подключение заново из чата.",
      }));
    }
    html(res, 200, renderLoginPage({}));
  });

  router.post("/oauth/login", async (req, res) => {
    const txn = getOAuthTransaction(txnId(req));
    if (!txn) {
      return html(res, 400, renderMessagePage({
        title: "Подключение не найдено",
        message: "Начните подключение заново из чата.",
      }));
    }
    try {
      const result = await login(req.body?.username, req.body?.password, {
        ip: getClientIp(req),
        userAgent: req.get("user-agent") || "",
      });
      if (result.principal?.mustChangePassword) {
        return html(res, 403, renderMessagePage({
          title: "Смените пароль",
          message: "Сначала смените пароль в приложении, затем повторите подключение.",
        }));
      }
      sessionCookie(res, result.session.sessionToken, result.session.expiresAt);
      res.redirect("/oauth/consent");
    } catch (error) {
      const message = error instanceof AuthError ? error.message : "Не удалось войти.";
      html(res, 401, renderLoginPage({ username: req.body?.username || "", error: message }));
    }
  });

  router.get("/oauth/consent", (req, res) => {
    const txn = getOAuthTransaction(txnId(req));
    if (!txn) {
      return html(res, 400, renderMessagePage({
        title: "Подключение не найдено",
        message: "Начните подключение заново из чата.",
      }));
    }
    const session = currentUser(req);
    if (!session?.principal) return res.redirect("/oauth/login");
    if (session.principal.mustChangePassword) {
      return html(res, 403, renderMessagePage({
        title: "Смените пароль",
        message: "Сначала смените пароль в приложении, затем повторите подключение.",
      }));
    }
    let host = txn.redirectUri;
    try {
      host = new URL(txn.redirectUri).host;
    } catch {
      host = txn.redirectUri;
    }
    html(res, 200, renderConsentPage({
      clientName: txn.clientName || "MCP client",
      displayName: session.principal.displayName || session.principal.username,
      redirectHost: host,
    }));
  });

  router.post("/oauth/consent", (req, res) => {
    const id = txnId(req);
    const txn = getOAuthTransaction(id);
    const issuer = resolvePublicOrigin(req);
    if (!txn) {
      return html(res, 400, renderMessagePage({
        title: "Подключение не найдено",
        message: "Начните подключение заново из чата.",
      }));
    }
    const session = currentUser(req);
    if (!session?.principal || session.principal.mustChangePassword) {
      return res.redirect("/oauth/login");
    }
    clearTxnCookie(res);
    deleteOAuthTransaction(id);
    if (req.body?.decision !== "approve") {
      return res.redirect(redirectWithQuery(txn.redirectUri, {
        error: "access_denied",
        state: txn.state,
        iss: issuer,
      }));
    }
    const code = createAuthorizationCode({
      userId: session.principal.userId,
      clientId: txn.clientId,
      redirectUri: txn.redirectUri,
      codeChallenge: txn.codeChallenge,
      resource: txn.resource || issuer,
      scopes: (txn.scopes || ["mcp"]).join(" "),
    });
    res.redirect(redirectWithQuery(txn.redirectUri, {
      code,
      state: txn.state,
      iss: issuer,
    }));
  });

  router.post("/oauth/token", (req, res) => {
    if (!allowRate(`token:${getClientIp(req)}`, 60)) {
      return oauthError(res, 429, "temporarily_unavailable", "Слишком много запросов.");
    }
    const body = req.body || {};
    const issuer = resolvePublicOrigin(req);
    const resource = body.resource ? String(body.resource) : "";
    if (resource && !sameResource(issuer, resource)) {
      return oauthError(res, 400, "invalid_target", "Параметр resource не совпадает с этим сервером.");
    }
    if (body.grant_type === "refresh_token") {
      const rotated = rotateRefreshToken(String(body.refresh_token || ""), {
        clientId: String(body.client_id || ""),
        resource: issuer,
      });
      if (rotated.error) return oauthError(res, 400, "invalid_grant", "Refresh token недействителен.");
      return res.json({
        access_token: rotated.accessToken,
        token_type: "Bearer",
        expires_in: rotated.expiresIn,
        refresh_token: rotated.refreshToken,
        scope: rotated.scope,
      });
    }
    if (body.grant_type !== "authorization_code") {
      return oauthError(res, 400, "unsupported_grant_type", "Поддерживаются authorization_code и refresh_token.");
    }
    const codeRow = readAuthorizationCode(String(body.code || ""));
    if (!codeRow) return oauthError(res, 400, "invalid_grant", "Код недействителен или уже использован.");
    if (String(body.client_id || "") !== codeRow.client_id) {
      return oauthError(res, 400, "invalid_grant", "client_id не совпадает.");
    }
    if (String(body.redirect_uri || "") !== codeRow.redirect_uri) {
      return oauthError(res, 400, "invalid_grant", "redirect_uri не совпадает.");
    }
    if (!verifyPkce(body.code_verifier, codeRow.code_challenge)) {
      return oauthError(res, 400, "invalid_grant", "PKCE не совпадает.");
    }
    if (!consumeAuthorizationCode(String(body.code || ""))) {
      return oauthError(res, 400, "invalid_grant", "Код недействителен или уже использован.");
    }
    const scopes = String(codeRow.scopes || "mcp").split(/\s+/).filter(Boolean);
    const tokens = issueOAuthTokenPair({
      userId: codeRow.user_id,
      clientId: codeRow.client_id,
      resource: codeRow.resource || issuer,
      scopes,
    });
    res.json({
      access_token: tokens.accessToken,
      token_type: "Bearer",
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken,
      scope: tokens.scope,
    });
  });
}
