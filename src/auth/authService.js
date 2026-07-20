/**
 * Логин / пользователи / смена пароля.
 */

import crypto from "crypto";
import { getDatabase } from "../database/index.js";
import { AuthError, getAuthConfig } from "./config.js";
import { hashPassword, verifyPassword, sha256Hex } from "./passwordService.js";
import {
  createSession,
  findSessionByToken,
  isSessionActive,
  revokeSession,
  revokeAllUserSessions,
  touchSession,
  listUserSessions,
  rotateCsrf,
} from "./sessionService.js";
import {
  ensureSystemRoles,
  getRoleByCode,
  loadUserPrincipal,
  recordAuthEvent,
  requirePermission,
  hasPermission,
} from "./authorizationService.js";
import { assertLoginRateLimit } from "./rateLimitService.js";

function mapUserPublic(row) {
  if (!row) return null;
  const role = getDatabase().prepare("SELECT code, name FROM app_roles WHERE id = ?").get(row.role_id);
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    roleId: row.role_id,
    role: role?.code,
    roleName: role?.name,
    bitrixUserId: row.bitrix_user_id,
    dataScope: row.data_scope,
    isActive: Boolean(row.is_active),
    mustChangePassword: Boolean(row.must_change_password),
    lastLoginAt: row.last_login_at,
    passwordChangedAt: row.password_changed_at,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
  };
}

export function countUsers() {
  return getDatabase().prepare("SELECT COUNT(*) AS c FROM app_users").get().c;
}

export function countActiveAdmins() {
  const admin = getRoleByCode("administrator");
  if (!admin) return 0;
  return getDatabase()
    .prepare(
      `SELECT COUNT(*) AS c FROM app_users WHERE role_id = ? AND is_active = 1 AND disabled_at IS NULL`
    )
    .get(admin.id).c;
}

export async function createUser({
  username,
  password,
  displayName,
  roleCode = "manager",
  bitrixUserId = null,
  dataScope = "own",
  mustChangePassword = true,
  actor = null,
}) {
  ensureSystemRoles();
  const role = getRoleByCode(roleCode);
  if (!role) throw new AuthError("PERMISSION_DENIED", "Неизвестная роль.");
  const existing = getDatabase()
    .prepare("SELECT id FROM app_users WHERE username = ? COLLATE NOCASE")
    .get(String(username).trim());
  if (existing) throw new AuthError("PASSWORD_POLICY_VIOLATION", "Не удалось создать пользователя.");

  const passwordHash = await hashPassword(password);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO app_users (
        id, username, display_name, password_hash, role_id, bitrix_user_id, data_scope,
        is_active, must_change_password, last_login_at, password_changed_at, created_at, updated_at, disabled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?, ?, NULL)`
    )
    .run(
      id,
      String(username).trim().toLowerCase(),
      displayName || username,
      passwordHash,
      role.id,
      bitrixUserId != null ? String(bitrixUserId) : null,
      dataScope === "all" ? "all" : "own",
      mustChangePassword ? 1 : 0,
      now,
      now,
      now
    );
  recordAuthEvent({
    userId: actor?.userId || id,
    eventType: "user_created",
    result: "success",
    details: { createdUserId: id, role: roleCode },
  });
  return mapUserPublic(getDatabase().prepare("SELECT * FROM app_users WHERE id = ?").get(id));
}

export async function login(username, password, meta = {}) {
  const ipHash = sha256Hex(meta.ip || "").slice(0, 32);
  const uaHash = sha256Hex(meta.userAgent || "").slice(0, 32);
  assertLoginRateLimit(ipHash);

  const user = getDatabase()
    .prepare("SELECT * FROM app_users WHERE username = ? COLLATE NOCASE")
    .get(String(username || "").trim());

  const fail = () => {
    recordAuthEvent({
      userId: user?.id || null,
      eventType: "login_failed",
      result: "failure",
      ipHash,
      userAgentHash: uaHash,
    });
    throw new AuthError("INVALID_CREDENTIALS", "Неверный логин или пароль.");
  };

  if (!user || !user.is_active || user.disabled_at) {
    // same message — no enumeration
    await new Promise((r) => setTimeout(r, 30));
    fail();
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) fail();

  const session = createSession(user.id, { ip: meta.ip, userAgent: meta.userAgent });
  getDatabase()
    .prepare(`UPDATE app_users SET last_login_at = ?, updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), new Date().toISOString(), user.id);
  recordAuthEvent({
    userId: user.id,
    eventType: "login_success",
    result: "success",
    ipHash,
    userAgentHash: uaHash,
  });

  const principal = loadUserPrincipal(user.id);
  return { user: mapUserPublic(user), principal, session };
}

export function logout(sessionToken, meta = {}) {
  const row = findSessionByToken(sessionToken);
  if (row) {
    revokeSession(row.id);
    recordAuthEvent({
      userId: row.user_id,
      eventType: "logout",
      result: "success",
      ipHash: sha256Hex(meta.ip || "").slice(0, 32),
    });
  }
  return { success: true };
}

export function resolveSession(sessionToken) {
  const row = findSessionByToken(sessionToken);
  if (!row) return null;
  if (!isSessionActive(row)) {
    if (!row.revoked_at) {
      revokeSession(row.id);
      recordAuthEvent({
        userId: row.user_id,
        eventType: "session_expired",
        result: "failure",
      });
    }
    return null;
  }
  touchSession(row.id);
  const principal = loadUserPrincipal(row.user_id);
  if (!principal?.isActive) {
    revokeSession(row.id);
    throw new AuthError("USER_DISABLED", "Пользователь отключён.");
  }
  return { session: row, principal, user: mapUserPublic(getDatabase().prepare("SELECT * FROM app_users WHERE id = ?").get(row.user_id)) };
}

export async function changePassword(userId, currentPassword, newPassword, { sessionId = null } = {}) {
  const user = getDatabase().prepare("SELECT * FROM app_users WHERE id = ?").get(userId);
  if (!user) throw new AuthError("AUTHENTICATION_REQUIRED", "Пользователь не найден.");
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw new AuthError("INVALID_CREDENTIALS", "Неверный логин или пароль.");
  }
  const passwordHash = await hashPassword(newPassword);
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE app_users SET password_hash = ?, must_change_password = 0, password_changed_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(passwordHash, now, now, userId);
  revokeAllUserSessions(userId, { exceptSessionId: sessionId });
  recordAuthEvent({ userId, eventType: "password_changed", result: "success" });
  return { success: true };
}

export async function adminResetPassword(actor, userId, newPassword) {
  requirePermission(actor, "users.manage");
  const passwordHash = await hashPassword(newPassword);
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE app_users SET password_hash = ?, must_change_password = 1, password_changed_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(passwordHash, now, now, userId);
  revokeAllUserSessions(userId);
  recordAuthEvent({
    userId: actor.userId,
    eventType: "password_changed",
    result: "success",
    details: { targetUserId: userId, resetByAdmin: true },
  });
  return { success: true };
}

export function listUsers(actor) {
  requirePermission(actor, "users.manage");
  return getDatabase().prepare("SELECT * FROM app_users ORDER BY username").all().map(mapUserPublic);
}

export function getUser(actor, id) {
  requirePermission(actor, "users.manage");
  return mapUserPublic(getDatabase().prepare("SELECT * FROM app_users WHERE id = ?").get(id));
}

export function updateUser(actor, id, patch = {}) {
  requirePermission(actor, "users.manage");
  const user = getDatabase().prepare("SELECT * FROM app_users WHERE id = ?").get(id);
  if (!user) throw new AuthError("PERMISSION_DENIED", "Пользователь не найден.");
  let roleId = user.role_id;
  if (patch.roleCode) {
    const role = getRoleByCode(patch.roleCode);
    if (!role) throw new AuthError("PERMISSION_DENIED", "Неизвестная роль.");
    roleId = role.id;
    recordAuthEvent({
      userId: actor.userId,
      eventType: "role_changed",
      result: "success",
      details: { targetUserId: id, role: patch.roleCode },
    });
  }
  getDatabase()
    .prepare(
      `UPDATE app_users SET
        display_name = ?, role_id = ?, bitrix_user_id = ?, data_scope = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.displayName ?? user.display_name,
      roleId,
      patch.bitrixUserId !== undefined
        ? patch.bitrixUserId != null
          ? String(patch.bitrixUserId)
          : null
        : user.bitrix_user_id,
      patch.dataScope === "all" || patch.dataScope === "own" ? patch.dataScope : user.data_scope,
      new Date().toISOString(),
      id
    );
  return getUser(actor, id);
}

export function disableUser(actor, id) {
  requirePermission(actor, "users.manage");
  const user = getDatabase().prepare("SELECT * FROM app_users WHERE id = ?").get(id);
  if (!user) throw new AuthError("PERMISSION_DENIED", "Пользователь не найден.");
  const adminRole = getRoleByCode("administrator");
  if (adminRole && user.role_id === adminRole.id && countActiveAdmins() <= 1) {
    throw new AuthError("LAST_ADMIN_PROTECTION", "Нельзя отключить последнего администратора.");
  }
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE app_users SET is_active = 0, disabled_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(now, now, id);
  revokeAllUserSessions(id);
  recordAuthEvent({
    userId: actor.userId,
    eventType: "user_disabled",
    result: "success",
    details: { targetUserId: id },
  });
  return getUser(actor, id);
}

export function enableUser(actor, id) {
  requirePermission(actor, "users.manage");
  getDatabase()
    .prepare(
      `UPDATE app_users SET is_active = 1, disabled_at = NULL, updated_at = ? WHERE id = ?`
    )
    .run(new Date().toISOString(), id);
  return getUser(actor, id);
}

export function revokeUserSessions(actor, id) {
  requirePermission(actor, "users.manage");
  revokeAllUserSessions(id);
  recordAuthEvent({
    userId: actor.userId,
    eventType: "session_revoked",
    result: "success",
    details: { targetUserId: id },
  });
  return { success: true };
}

export { listUserSessions, mapUserPublic, hasPermission, rotateCsrf };
