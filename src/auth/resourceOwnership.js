/**
 * Workspace ownership helpers for chats / projects.
 */

import { getDatabase } from "../database/index.js";
import { hasPermission } from "./authorizationService.js";
import { AuthError } from "./config.js";

export function canSeeAllChats(user) {
  // Authenticated users always see only their own chats, including administrator
  // and director. chats.manage.all does not leak another person's dialogs.
  return !user || Boolean(user.isLocalOnlySynthetic);
}

export function canManageAllProjects(user) {
  return !user || user.isLocalOnlySynthetic || hasPermission(user, "projects.manage");
}

export function getProjectMembership(userId, projectId) {
  if (!userId || !projectId) return null;
  return (
    getDatabase()
      .prepare(`SELECT access_level FROM project_members WHERE project_id = ? AND user_id = ?`)
      .get(projectId, userId) || null
  );
}

export function authorizeChatAccess(user, chat, { write = false } = {}) {
  if (canSeeAllChats(user)) return { ok: true, level: "all" };
  if (!user?.userId || !chat) {
    throw new AuthError("RESOURCE_ACCESS_DENIED", "Нет доступа к чату.");
  }
  if (chat.ownerUserId === user.userId || chat.createdByUserId === user.userId) {
    return { ok: true, level: "owner" };
  }
  if (chat.projectId) {
    const m = getProjectMembership(user.userId, chat.projectId);
    if (m) {
      if (write && m.access_level === "viewer") {
        throw new AuthError("RESOURCE_ACCESS_DENIED", "Viewer не может изменять чат.");
      }
      return { ok: true, level: m.access_level };
    }
  }
  throw new AuthError("RESOURCE_ACCESS_DENIED", "Нет доступа к чату.");
}

export function authorizeProjectAccess(user, project, { write = false, manage = false } = {}) {
  if (canManageAllProjects(user)) return { ok: true, level: "admin" };
  if (!user?.userId || !project) {
    throw new AuthError("RESOURCE_ACCESS_DENIED", "Нет доступа к проекту.");
  }
  if (project.ownerUserId === user.userId || project.createdByUserId === user.userId) {
    return { ok: true, level: "owner" };
  }
  const m = getProjectMembership(user.userId, project.id);
  if (!m) {
    throw new AuthError("RESOURCE_ACCESS_DENIED", "Нет доступа к проекту.");
  }
  if (manage && m.access_level !== "owner") {
    throw new AuthError("RESOURCE_ACCESS_DENIED", "Только owner может управлять участниками.");
  }
  if (write && m.access_level === "viewer") {
    throw new AuthError("RESOURCE_ACCESS_DENIED", "Viewer только читает проект.");
  }
  return { ok: true, level: m.access_level };
}

export function filterChatsForUser(chats, user) {
  if (canSeeAllChats(user)) return chats;
  const userId = user?.userId;
  if (!userId) return [];
  return (chats || []).filter(
    (c) => c.ownerUserId === userId || c.createdByUserId === userId
  );
}

export function filterProjectsForUser(projects, user) {
  if (canManageAllProjects(user) || hasPermission(user, "projects.view")) {
    if (canManageAllProjects(user)) return projects;
  }
  return (projects || []).filter((p) => {
    try {
      authorizeProjectAccess(user, p);
      return true;
    } catch {
      return false;
    }
  });
}
