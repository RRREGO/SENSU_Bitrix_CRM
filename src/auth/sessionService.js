import crypto from "crypto";
import { getDatabase } from "../database/index.js";
import { getAuthConfig } from "./config.js";
import { generateOpaqueToken, hashOpaqueToken, sha256Hex } from "./passwordService.js";

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000).toISOString();
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 3600_000).toISOString();
}

export function createSession(userId, { ip = "", userAgent = "" } = {}) {
  const cfg = getAuthConfig();
  const db = getDatabase();
  // Enforce concurrent session limit: revoke oldest active sessions beyond max-1
  const active = db
    .prepare(
      `SELECT id FROM user_sessions
       WHERE user_id = ? AND revoked_at IS NULL
         AND expires_at > ? AND idle_expires_at > ?
       ORDER BY created_at ASC`
    )
    .all(userId, nowIso(), nowIso());
  const max = cfg.maxActiveSessionsPerUser || 5;
  const overflow = active.length - (max - 1);
  if (overflow > 0) {
    for (let i = 0; i < overflow; i++) {
      revokeSession(active[i].id);
    }
  }

  const id = crypto.randomUUID();
  const sessionToken = generateOpaqueToken(32);
  const csrfToken = generateOpaqueToken(24);
  const created = new Date();
  const row = {
    id,
    user_id: userId,
    session_token_hash: hashOpaqueToken(sessionToken),
    csrf_token_hash: hashOpaqueToken(csrfToken),
    created_at: created.toISOString(),
    last_seen_at: created.toISOString(),
    expires_at: addHours(created, cfg.sessionTtlHours),
    idle_expires_at: addMinutes(created, cfg.sessionIdleMinutes),
    revoked_at: null,
    ip_hash: sha256Hex(ip).slice(0, 32),
    user_agent_hash: sha256Hex(userAgent).slice(0, 32),
  };
  db.prepare(
    `INSERT INTO user_sessions (
      id, user_id, session_token_hash, csrf_token_hash, created_at, last_seen_at,
      expires_at, idle_expires_at, revoked_at, ip_hash, user_agent_hash
    ) VALUES (
      @id, @user_id, @session_token_hash, @csrf_token_hash, @created_at, @last_seen_at,
      @expires_at, @idle_expires_at, @revoked_at, @ip_hash, @user_agent_hash
    )`
  ).run(row);

  return {
    sessionId: id,
    sessionToken,
    csrfToken,
    expiresAt: row.expires_at,
    idleExpiresAt: row.idle_expires_at,
  };
}

export function findSessionByToken(sessionToken) {
  if (!sessionToken) return null;
  const hash = hashOpaqueToken(sessionToken);
  return getDatabase()
    .prepare("SELECT * FROM user_sessions WHERE session_token_hash = ?")
    .get(hash);
}

export function touchSession(sessionId) {
  const cfg = getAuthConfig();
  const now = new Date();
  const row = getDatabase().prepare("SELECT last_seen_at FROM user_sessions WHERE id = ?").get(sessionId);
  if (row?.last_seen_at) {
    const elapsed = now.getTime() - new Date(row.last_seen_at).getTime();
    if (elapsed < (cfg.lastSeenMinIntervalSeconds || 60) * 1000) {
      // refresh idle expiry without rewriting last_seen every request
      getDatabase()
        .prepare(
          `UPDATE user_sessions SET idle_expires_at = ? WHERE id = ? AND revoked_at IS NULL`
        )
        .run(addMinutes(now, cfg.sessionIdleMinutes), sessionId);
      return;
    }
  }
  getDatabase()
    .prepare(
      `UPDATE user_sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ? AND revoked_at IS NULL`
    )
    .run(now.toISOString(), addMinutes(now, cfg.sessionIdleMinutes), sessionId);
}

export function isSessionActive(row) {
  if (!row || row.revoked_at) return false;
  const now = Date.now();
  if (new Date(row.expires_at).getTime() < now) return false;
  if (new Date(row.idle_expires_at).getTime() < now) return false;
  return true;
}

export function revokeSession(sessionId) {
  getDatabase()
    .prepare(`UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
    .run(nowIso(), sessionId);
}

export function revokeAllUserSessions(userId, { exceptSessionId = null } = {}) {
  if (exceptSessionId) {
    getDatabase()
      .prepare(
        `UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id != ?`
      )
      .run(nowIso(), userId, exceptSessionId);
  } else {
    getDatabase()
      .prepare(`UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
      .run(nowIso(), userId);
  }
}

export function listUserSessions(userId) {
  return getDatabase()
    .prepare(
      `SELECT id, user_id, created_at, last_seen_at, expires_at, idle_expires_at, revoked_at, ip_hash
       FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC`
    )
    .all(userId);
}

export function rotateCsrf(sessionId) {
  const csrfToken = generateOpaqueToken(24);
  getDatabase()
    .prepare(`UPDATE user_sessions SET csrf_token_hash = ? WHERE id = ? AND revoked_at IS NULL`)
    .run(hashOpaqueToken(csrfToken), sessionId);
  return csrfToken;
}

export function verifyCsrf(sessionRow, csrfToken) {
  if (!sessionRow || !csrfToken) return false;
  const hash = hashOpaqueToken(csrfToken);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(String(sessionRow.csrf_token_hash))
    );
  } catch {
    return hash === sessionRow.csrf_token_hash;
  }
}
