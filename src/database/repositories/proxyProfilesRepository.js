import crypto from "crypto";
import { getDatabase } from "../index.js";
import { WorkspaceError } from "../../workspace/config.js";
import { encryptSecret, decryptSecret, maskSecret, secretMeta } from "../../connections/secretsService.js";
import { validateProxyHostPort } from "../../connections/proxyResolver.js";
import { ConnectionError, CONNECTION_ERROR_CODES } from "../../connections/errors.js";

function uid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function mapRow(row, { includeSecrets = false } = {}) {
  if (!row) return null;
  let scope = [];
  try {
    scope = JSON.parse(row.scope_json || "[]");
  } catch {
    scope = [];
  }
  const hasUser = Boolean(row.username_encrypted);
  const hasPass = Boolean(row.password_encrypted);
  const out = {
    id: row.id,
    ownerUserId: row.owner_user_id || null,
    name: row.name,
    proxyType: row.proxy_type,
    host: row.host,
    port: row.port,
    username: hasUser && includeSecrets ? decryptSecret(row.username_encrypted) : hasUser ? maskSecret("user", 0) && "••••" : null,
    usernameMeta: secretMeta(hasUser),
    passwordMeta: secretMeta(hasPass),
    noProxy: row.no_proxy || "",
    connectTimeoutMs: row.connect_timeout_ms,
    isActive: Boolean(row.is_active),
    scope,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  // Never return password plaintext
  return out;
}

export function getProxyProfileById(id) {
  const row = getDatabase().prepare("SELECT * FROM proxy_profiles WHERE id = ?").get(id);
  if (!row) return null;
  return {
    id: row.id,
    ownerUserId: row.owner_user_id || null,
    name: row.name,
    proxyType: row.proxy_type,
    host: row.host,
    port: row.port,
    username: row.username_encrypted ? decryptSecret(row.username_encrypted) : null,
    passwordEncrypted: row.password_encrypted,
    noProxy: row.no_proxy || "",
    connectTimeoutMs: row.connect_timeout_ms,
    isActive: Boolean(row.is_active),
    updatedAt: row.updated_at,
  };
}

export function listProxyProfiles({ ownerUserId } = {}) {
  const db = getDatabase();
  const rows = ownerUserId
    ? db
        .prepare(
          `SELECT * FROM proxy_profiles
           WHERE owner_user_id IS NULL OR owner_user_id = ?
           ORDER BY is_active DESC, updated_at DESC`
        )
        .all(ownerUserId)
    : db.prepare("SELECT * FROM proxy_profiles ORDER BY is_active DESC, updated_at DESC").all();
  return rows.map((r) => mapRow(r));
}

export function createProxyProfile(data = {}, actorUserId = null) {
  const { host, port } = validateProxyHostPort(data.host, data.port);
  const type = String(data.proxyType || "http").toLowerCase();
  if (!["none", "http", "https", "socks5"].includes(type)) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      "Тип прокси: none, http, https или socks5."
    );
  }
  const id = uid();
  const ts = now();
  const scope = Array.isArray(data.scope) ? data.scope : [];
  try {
    getDatabase()
      .prepare(
        `INSERT INTO proxy_profiles (
          id, owner_user_id, name, proxy_type, host, port,
          username_encrypted, password_encrypted, no_proxy, connect_timeout_ms,
          is_active, scope_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        data.ownerUserId || actorUserId || null,
        String(data.name || "Прокси").slice(0, 120),
        type,
        host,
        port,
        data.username ? encryptSecret(data.username) : null,
        data.password ? encryptSecret(data.password) : null,
        data.noProxy || "",
        Number(data.connectTimeoutMs) > 0 ? Math.floor(Number(data.connectTimeoutMs)) : 10000,
        data.isActive === false ? 0 : 1,
        JSON.stringify(scope),
        ts,
        ts
      );
  } catch (error) {
    if (error instanceof ConnectionError) throw error;
    throw new WorkspaceError("DATABASE_WRITE_FAILED", error.message);
  }
  return mapRow(getDatabase().prepare("SELECT * FROM proxy_profiles WHERE id = ?").get(id));
}

export function updateProxyProfile(id, patch = {}) {
  const current = getDatabase().prepare("SELECT * FROM proxy_profiles WHERE id = ?").get(id);
  if (!current) return null;

  let host = current.host;
  let port = current.port;
  if (patch.host != null || patch.port != null) {
    const v = validateProxyHostPort(patch.host ?? current.host, patch.port ?? current.port);
    host = v.host;
    port = v.port;
  }

  let usernameEnc = current.username_encrypted;
  if (patch.username === "" || patch.username === null) usernameEnc = null;
  else if (patch.username) usernameEnc = encryptSecret(patch.username);

  let passwordEnc = current.password_encrypted;
  if (patch.password === "" || patch.clearPassword === true) passwordEnc = null;
  else if (patch.password) passwordEnc = encryptSecret(patch.password);

  const type = patch.proxyType != null ? String(patch.proxyType).toLowerCase() : current.proxy_type;
  const scope = patch.scope != null ? patch.scope : JSON.parse(current.scope_json || "[]");

  getDatabase()
    .prepare(
      `UPDATE proxy_profiles SET
        name = ?, proxy_type = ?, host = ?, port = ?,
        username_encrypted = ?, password_encrypted = ?, no_proxy = ?,
        connect_timeout_ms = ?, is_active = ?, scope_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.name != null ? String(patch.name).slice(0, 120) : current.name,
      type,
      host,
      port,
      usernameEnc,
      passwordEnc,
      patch.noProxy != null ? patch.noProxy : current.no_proxy,
      patch.connectTimeoutMs != null
        ? Math.floor(Number(patch.connectTimeoutMs))
        : current.connect_timeout_ms,
      patch.isActive === false ? 0 : patch.isActive === true ? 1 : current.is_active,
      JSON.stringify(scope),
      now(),
      id
    );

  return mapRow(getDatabase().prepare("SELECT * FROM proxy_profiles WHERE id = ?").get(id));
}

export function deleteProxyProfile(id) {
  const r = getDatabase().prepare("DELETE FROM proxy_profiles WHERE id = ?").run(id);
  return r.changes > 0;
}
