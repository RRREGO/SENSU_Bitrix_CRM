/**
 * Personal access tokens and OAuth grants for the MCP endpoint.
 * Tokens are stored as SHA-256 hashes. Plaintext is returned only at creation.
 */

import crypto from "crypto";
import { getDatabase } from "../database/index.js";
import { generateOpaqueToken, sha256Hex } from "../auth/passwordService.js";
import { loadUserPrincipal } from "../auth/authorizationService.js";
import { accessTokenTtlSeconds, personalTokenTtlMs, refreshTokenTtlMs } from "./config.js";

function nowIso() {
  return new Date().toISOString();
}

function addMs(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function requireActiveUser(userId) {
  const user = getDatabase()
    .prepare("SELECT id, is_active, disabled_at FROM app_users WHERE id = ?")
    .get(userId);
  if (!user || !user.is_active || user.disabled_at) {
    const error = new Error("Токен можно выпустить только для активного пользователя. Войдите в приложение.");
    error.code = "MCP_USER_REQUIRED";
    throw error;
  }
  return user;
}

function insertCredential(db, row) {
  db.prepare(
    `INSERT INTO mcp_credentials (
      id, token_hash, token_prefix, user_id, kind, client_id, resource, scopes,
      name, family_id, created_at, expires_at, last_used_at, revoked_at, replaced_by_id
    ) VALUES (
      @id, @token_hash, @token_prefix, @user_id, @kind, @client_id, @resource, @scopes,
      @name, @family_id, @created_at, @expires_at, NULL, NULL, NULL
    )`
  ).run(row);
}

function mintCredential(db, { userId, kind, clientId, resource, scopes, name, familyId, expiresAt }) {
  const token = `mcp_${generateOpaqueToken(32)}`;
  const id = crypto.randomUUID();
  insertCredential(db, {
    id,
    token_hash: sha256Hex(token),
    token_prefix: token.slice(0, 12),
    user_id: userId,
    kind,
    client_id: clientId || null,
    resource: resource || null,
    scopes: scopes || null,
    name: name || null,
    family_id: familyId || null,
    created_at: nowIso(),
    expires_at: expiresAt,
  });
  return { id, token, expiresAt };
}

export function createPersonalAccessToken({ userId, name }) {
  requireActiveUser(userId);
  const db = getDatabase();
  const now = nowIso();
  const cleanName = String(name || "MCP")
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, 80) || "MCP";
  const expiresAt = addMs(personalTokenTtlMs());
  const created = db.transaction(() => {
    const active = db
      .prepare(
        `SELECT COUNT(*) AS c FROM mcp_credentials
         WHERE user_id = ? AND kind = 'pat' AND revoked_at IS NULL AND expires_at > ?`
      )
      .get(userId, now).c;
    if (active >= 10) {
      const error = new Error("Не больше 10 активных токенов. Отзовите неиспользуемые.");
      error.code = "MCP_TOKEN_LIMIT";
      throw error;
    }
    return mintCredential(db, {
      userId,
      kind: "pat",
      name: cleanName,
      expiresAt,
      scopes: "mcp",
    });
  })();
  return {
    id: created.id,
    token: created.token,
    prefix: created.token.slice(0, 12),
    name: cleanName,
    expiresAt: created.expiresAt,
  };
}

export function listPersonalAccessTokens(userId) {
  const now = nowIso();
  return getDatabase()
    .prepare(
      `SELECT id, name, token_prefix, created_at, expires_at, last_used_at
       FROM mcp_credentials
       WHERE user_id = ? AND kind = 'pat' AND revoked_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC`
    )
    .all(userId, now)
    .map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.token_prefix,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
    }));
}

export function revokePersonalAccessToken(userId, tokenId) {
  const info = getDatabase()
    .prepare(
      `UPDATE mcp_credentials
       SET revoked_at = ?
       WHERE id = ? AND user_id = ? AND kind = 'pat' AND revoked_at IS NULL`
    )
    .run(nowIso(), tokenId, userId);
  return info.changes > 0;
}

export function revokeOAuthGrants(userId) {
  const info = getDatabase()
    .prepare(
      `UPDATE mcp_credentials
       SET revoked_at = COALESCE(revoked_at, ?)
       WHERE user_id = ? AND kind IN ('access', 'refresh') AND revoked_at IS NULL`
    )
    .run(nowIso(), userId);
  return info.changes;
}

export function resolveBearerToken(rawToken) {
  if (!rawToken || typeof rawToken !== "string") return null;
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM mcp_credentials WHERE token_hash = ?").get(sha256Hex(rawToken));
  if (!row) return null;
  if (row.kind !== "pat" && row.kind !== "access") return null;
  if (row.revoked_at) return null;
  const now = nowIso();
  if (row.expires_at && row.expires_at <= now) return null;
  const user = loadUserPrincipal(row.user_id);
  if (!user?.isActive) return null;
  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 60_000) {
    db.prepare("UPDATE mcp_credentials SET last_used_at = ? WHERE id = ?").run(now, row.id);
  }
  return {
    user,
    credential: {
      id: row.id,
      kind: row.kind,
      resource: row.resource,
      scopes: row.scopes,
      clientId: row.client_id,
    },
  };
}

export function saveOAuthClient({ clientId, clientName, redirectUris }) {
  getDatabase()
    .prepare(
      `INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris_json, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(clientId, clientName || null, JSON.stringify(redirectUris), nowIso());
}

export function getOAuthClient(clientId) {
  const row = getDatabase().prepare("SELECT * FROM mcp_oauth_clients WHERE client_id = ?").get(clientId);
  if (!row) return null;
  let redirectUris = [];
  try {
    redirectUris = JSON.parse(row.redirect_uris_json);
  } catch {
    redirectUris = [];
  }
  return {
    clientId: row.client_id,
    clientName: row.client_name || "MCP client",
    redirectUris: Array.isArray(redirectUris) ? redirectUris : [],
  };
}

export function createOAuthTransaction(payload) {
  const db = getDatabase();
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare("DELETE FROM mcp_oauth_transactions WHERE expires_at < ?").run(now);
  db.prepare(
    `INSERT INTO mcp_oauth_transactions (id, payload_json, expires_at, created_at) VALUES (?, ?, ?, ?)`
  ).run(id, JSON.stringify(payload), addMs(10 * 60 * 1000), now);
  return id;
}

export function getOAuthTransaction(id) {
  if (!id) return null;
  const row = getDatabase().prepare("SELECT * FROM mcp_oauth_transactions WHERE id = ?").get(id);
  if (!row) return null;
  if (row.expires_at <= nowIso()) return null;
  try {
    return { id: row.id, ...JSON.parse(row.payload_json) };
  } catch {
    return null;
  }
}

export function deleteOAuthTransaction(id) {
  if (!id) return;
  getDatabase().prepare("DELETE FROM mcp_oauth_transactions WHERE id = ?").run(id);
}

export function createAuthorizationCode({
  userId,
  clientId,
  redirectUri,
  codeChallenge,
  resource,
  scopes,
}) {
  const code = generateOpaqueToken(32);
  const now = nowIso();
  const db = getDatabase();
  db.prepare("DELETE FROM mcp_oauth_codes WHERE expires_at < ?").run(now);
  db.prepare(
    `INSERT INTO mcp_oauth_codes (
      code_hash, client_id, user_id, redirect_uri, code_challenge, resource, scopes, expires_at, used_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  ).run(
    sha256Hex(code),
    clientId,
    userId,
    redirectUri,
    codeChallenge,
    resource || null,
    scopes,
    addMs(5 * 60 * 1000),
    now
  );
  return code;
}

export function readAuthorizationCode(rawCode) {
  const row = getDatabase()
    .prepare("SELECT * FROM mcp_oauth_codes WHERE code_hash = ?")
    .get(sha256Hex(rawCode || ""));
  if (!row || row.used_at || row.expires_at <= nowIso()) return null;
  return row;
}

export function consumeAuthorizationCode(rawCode) {
  const db = getDatabase();
  const hash = sha256Hex(rawCode || "");
  const now = nowIso();
  return db.transaction(() => {
    const row = db.prepare("SELECT * FROM mcp_oauth_codes WHERE code_hash = ?").get(hash);
    if (!row || row.used_at || row.expires_at <= now) return null;
    const info = db
      .prepare("UPDATE mcp_oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL")
      .run(now, hash);
    if (info.changes !== 1) return null;
    return row;
  })();
}

export function issueOAuthTokenPair({ userId, clientId, resource, scopes, familyId = null }) {
  const db = getDatabase();
  const family = familyId || crypto.randomUUID();
  const scopeText = Array.isArray(scopes) ? scopes.join(" ") : String(scopes || "mcp");
  const pair = db.transaction(() => {
    const access = mintCredential(db, {
      userId,
      kind: "access",
      clientId,
      resource,
      scopes: scopeText,
      familyId: family,
      expiresAt: addMs(accessTokenTtlSeconds() * 1000),
    });
    const refresh = scopeText.split(/\s+/).includes("offline_access")
      ? mintCredential(db, {
          userId,
          kind: "refresh",
          clientId,
          resource,
          scopes: scopeText,
          familyId: family,
          expiresAt: addMs(refreshTokenTtlMs()),
        })
      : null;
    return { access, refresh, family };
  })();
  return {
    accessToken: pair.access.token,
    refreshToken: pair.refresh?.token || null,
    expiresIn: accessTokenTtlSeconds(),
    scope: scopeText,
  };
}

export function rotateRefreshToken(rawRefresh, { clientId, resource }) {
  const db = getDatabase();
  const hash = sha256Hex(rawRefresh || "");
  const now = nowIso();
  const rotated = db.transaction(() => {
    const row = db.prepare("SELECT * FROM mcp_credentials WHERE token_hash = ?").get(hash);
    if (!row || row.kind !== "refresh") return { error: "invalid_grant" };
    if (row.revoked_at) {
      if (row.family_id) {
        db.prepare(
          "UPDATE mcp_credentials SET revoked_at = COALESCE(revoked_at, ?) WHERE family_id = ?"
        ).run(now, row.family_id);
      }
      return { error: "invalid_grant" };
    }
    if (row.expires_at && row.expires_at <= now) return { error: "invalid_grant" };
    if (clientId && row.client_id && row.client_id !== clientId) return { error: "invalid_grant" };
    if (resource && row.resource && row.resource !== resource) return { error: "invalid_grant" };
    const user = loadUserPrincipal(row.user_id);
    if (!user?.isActive) return { error: "invalid_grant" };
    const scopes = String(row.scopes || "mcp")
      .split(/\s+/)
      .filter(Boolean);
    const access = mintCredential(db, {
      userId: row.user_id,
      kind: "access",
      clientId: row.client_id,
      resource: row.resource,
      scopes: scopes.join(" "),
      familyId: row.family_id,
      expiresAt: addMs(accessTokenTtlSeconds() * 1000),
    });
    const refresh = mintCredential(db, {
      userId: row.user_id,
      kind: "refresh",
      clientId: row.client_id,
      resource: row.resource,
      scopes: scopes.join(" "),
      familyId: row.family_id,
      expiresAt: addMs(refreshTokenTtlMs()),
    });
    db.prepare("UPDATE mcp_credentials SET revoked_at = ?, replaced_by_id = ? WHERE id = ?").run(
      now,
      refresh.id,
      row.id
    );
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresIn: accessTokenTtlSeconds(),
      scope: scopes.join(" "),
    };
  })();
  return rotated;
}
