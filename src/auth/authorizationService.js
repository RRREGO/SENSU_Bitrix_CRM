import crypto from "crypto";
import { getDatabase } from "../database/index.js";
import { ROLE_DEFINITIONS, ALL_PERMISSIONS } from "./permissions.js";
import { AuthError } from "./config.js";
import { redactObject } from "../safety/redact.js";

export function ensureSystemRoles() {
  const db = getDatabase();
  const now = new Date().toISOString();
  for (const [code, def] of Object.entries(ROLE_DEFINITIONS)) {
    let role = db.prepare("SELECT * FROM app_roles WHERE code = ?").get(code);
    if (!role) {
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO app_roles (id, code, name, description, is_system, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      ).run(id, code, def.name, def.description, now, now);
      role = { id, code };
    }
    for (const perm of def.permissions) {
      db.prepare(
        `INSERT OR IGNORE INTO role_permissions (role_id, permission, created_at) VALUES (?, ?, ?)`
      ).run(role.id, perm, now);
    }
  }
}

export function getRoleByCode(code) {
  return getDatabase().prepare("SELECT * FROM app_roles WHERE code = ?").get(code);
}

export function listRoles() {
  return getDatabase().prepare("SELECT * FROM app_roles ORDER BY code").all();
}

export function getRolePermissions(roleId) {
  return getDatabase()
    .prepare("SELECT permission FROM role_permissions WHERE role_id = ?")
    .all(roleId)
    .map((r) => r.permission);
}

export function setRolePermissions(roleId, permissions) {
  const role = getDatabase().prepare("SELECT * FROM app_roles WHERE id = ?").get(roleId);
  if (!role) throw new AuthError("PERMISSION_DENIED", "Роль не найдена.");
  if (role.code === "administrator") {
    // keep all perms at least — merge
  }
  const now = new Date().toISOString();
  const tx = getDatabase().transaction(() => {
    getDatabase().prepare("DELETE FROM role_permissions WHERE role_id = ?").run(roleId);
    for (const p of permissions) {
      if (!ALL_PERMISSIONS.includes(p)) continue;
      getDatabase()
        .prepare(
          `INSERT INTO role_permissions (role_id, permission, created_at) VALUES (?, ?, ?)`
        )
        .run(roleId, p, now);
    }
  });
  tx();
  return getRolePermissions(roleId);
}

export function loadUserPrincipal(userId) {
  const user = getDatabase().prepare("SELECT * FROM app_users WHERE id = ?").get(userId);
  if (!user) return null;
  const role = getDatabase().prepare("SELECT * FROM app_roles WHERE id = ?").get(user.role_id);
  const permissions = new Set(getRolePermissions(user.role_id));
  return {
    userId: user.id,
    username: user.username,
    displayName: user.display_name,
    roleId: user.role_id,
    role: role?.code || "unknown",
    bitrixUserId: user.bitrix_user_id,
    dataScope: user.data_scope || "own",
    isActive: Boolean(user.is_active),
    mustChangePassword: Boolean(user.must_change_password),
    permissions,
    principal: `user:${user.id}`,
  };
}

export function hasPermission(principal, permission) {
  if (!principal?.permissions) return false;
  return principal.permissions.has(permission);
}

export function requirePermission(principal, permission) {
  if (!hasPermission(principal, permission)) {
    throw new AuthError("PERMISSION_DENIED", "Недостаточно прав для выполнения действия.", {
      permission,
    });
  }
}

export function requireAnyPermission(principal, permissions = []) {
  if (!permissions.some((p) => hasPermission(principal, p))) {
    throw new AuthError("PERMISSION_DENIED", "Недостаточно прав для выполнения действия.", {
      permissions,
    });
  }
}

/**
 * CRM entity access for data_scope.
 */
export function assertCrmEntityAccess(principal, entity) {
  if (!principal) throw new AuthError("AUTHENTICATION_REQUIRED", "Требуется вход.");
  if (hasPermission(principal, "crm.read.all")) return true;
  if (!hasPermission(principal, "crm.read.own") && !hasPermission(principal, "crm.context.read")) {
    throw new AuthError("PERMISSION_DENIED", "Нет доступа к CRM.");
  }
  if (principal.dataScope === "all") return true;
  if (!principal.bitrixUserId) {
    throw new AuthError(
      "BITRIX_USER_MAPPING_REQUIRED",
      "Для доступа к своим CRM-данным нужна привязка Bitrix user."
    );
  }
  const assigned =
    entity?.assignedById ??
    entity?.ASSIGNED_BY_ID ??
    entity?.responsibleId ??
    entity?.responsible?.id;
  if (assigned == null) {
    throw new AuthError("RESOURCE_ACCESS_DENIED", "Не удалось проверить ответственного.");
  }
  if (String(assigned) !== String(principal.bitrixUserId)) {
    throw new AuthError("RESOURCE_ACCESS_DENIED", "Сущность вне вашего data scope.");
  }
  return true;
}

export function authorizeResourceAccess(user, resource) {
  if (!user) throw new AuthError("AUTHENTICATION_REQUIRED", "Требуется вход.");
  const type = resource?.type;
  if (type === "operation") {
    if (hasPermission(user, "operations.view.all")) return true;
    if (
      hasPermission(user, "operations.view.own") &&
      String(resource.initiatedByUserId) === String(user.userId)
    ) {
      return true;
    }
    throw new AuthError("RESOURCE_ACCESS_DENIED", "Нет доступа к операции.");
  }
  if (type === "draft" || type === "outbound") {
    if (hasPermission(user, "communications.view.all")) return true;
    if (
      hasPermission(user, "communications.view.own") &&
      String(resource.ownerUserId) === String(user.userId)
    ) {
      return true;
    }
    throw new AuthError("RESOURCE_ACCESS_DENIED", "Нет доступа к сообщению.");
  }
  if (type === "chat") {
    if (hasPermission(user, "chats.manage.all")) return true;
    if (
      hasPermission(user, "chats.manage.own") &&
      String(resource.ownerUserId) === String(user.userId)
    ) {
      return true;
    }
    throw new AuthError("RESOURCE_ACCESS_DENIED", "Нет доступа к чату.");
  }
  if (type === "project") {
    if (hasPermission(user, "projects.manage") || hasPermission(user, "projects.view")) {
      if (hasPermission(user, "projects.manage") && user.role === "administrator") return true;
      if (String(resource.ownerUserId) === String(user.userId)) return true;
      const member = getDatabase()
        .prepare(
          `SELECT access_level FROM project_members WHERE project_id = ? AND user_id = ?`
        )
        .get(resource.projectId || resource.id, user.userId);
      if (member) return member.access_level;
      if (user.role === "director" && hasPermission(user, "projects.view")) return "viewer";
    }
    throw new AuthError("RESOURCE_ACCESS_DENIED", "Нет доступа к проекту.");
  }
  throw new AuthError("RESOURCE_ACCESS_DENIED", "Ресурс недоступен.");
}

export function recordAuthEvent({
  userId = null,
  eventType,
  result,
  ipHash = null,
  userAgentHash = null,
  details = null,
}) {
  const safe = details ? redactObject(details) : null;
  getDatabase()
    .prepare(
      `INSERT INTO auth_events (
        id, user_id, event_type, result, ip_hash, user_agent_hash, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      crypto.randomUUID(),
      userId,
      eventType,
      result,
      ipHash,
      userAgentHash,
      safe ? JSON.stringify(safe) : null,
      new Date().toISOString()
    );
}
