/**
 * SQLite lease locks для планировщика.
 */

import { getDatabase } from "../database/index.js";
import { getSchedulerConfig } from "./config.js";

function nowIso() {
  return new Date().toISOString();
}

export function acquireLock(lockKey, ownerId, ttlSeconds) {
  const cfg = getSchedulerConfig();
  const ttl = ttlSeconds || cfg.lockTtlSeconds;
  const db = getDatabase();
  const now = Date.now();
  const expiresAt = new Date(now + ttl * 1000).toISOString();
  const acquiredAt = nowIso();

  const existing = db.prepare(`SELECT * FROM scheduler_locks WHERE lock_key = ?`).get(lockKey);
  if (existing) {
    if (new Date(existing.expires_at).getTime() > now && existing.owner_id !== ownerId) {
      return { acquired: false, lock: existing };
    }
    db.prepare(
      `UPDATE scheduler_locks SET owner_id = ?, acquired_at = ?, expires_at = ? WHERE lock_key = ?`
    ).run(ownerId, acquiredAt, expiresAt, lockKey);
    return { acquired: true, lock: { lockKey, ownerId, acquiredAt, expiresAt } };
  }

  try {
    db.prepare(
      `INSERT INTO scheduler_locks (lock_key, owner_id, acquired_at, expires_at) VALUES (?, ?, ?, ?)`
    ).run(lockKey, ownerId, acquiredAt, expiresAt);
    return { acquired: true, lock: { lockKey, ownerId, acquiredAt, expiresAt } };
  } catch {
    return { acquired: false, lock: null };
  }
}

export function releaseLock(lockKey, ownerId) {
  const db = getDatabase();
  const info = db
    .prepare(`DELETE FROM scheduler_locks WHERE lock_key = ? AND owner_id = ?`)
    .run(lockKey, ownerId);
  return info.changes > 0;
}

export function getLock(lockKey) {
  const row = getDatabase().prepare(`SELECT * FROM scheduler_locks WHERE lock_key = ?`).get(lockKey);
  if (!row) return null;
  return {
    lockKey: row.lock_key,
    ownerId: row.owner_id,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
  };
}

export function isLockExpired(lock) {
  if (!lock) return true;
  return new Date(lock.expiresAt || lock.expires_at).getTime() <= Date.now();
}
