import { getDatabase, getSearchMode } from "../database/index.js";
import { WorkspaceError } from "./config.js";
import { hasPermission } from "../auth/authorizationService.js";

/**
 * Search chats / messages / projects with ownership filter before snippets leak.
 */
export function searchWorkspace(query, { limit = 30, user = null } = {}) {
  const q = String(query || "").trim();
  if (!q) return [];

  const lim = Math.min(Number(limit) || 30, 100);
  const mode = getSearchMode();

  try {
    let rows;
    if (mode === "fts5") {
      rows = searchFts(q, lim * 3);
    } else {
      rows = searchLike(q, lim * 3);
    }
    return filterSearchResults(rows, user).slice(0, lim);
  } catch (error) {
    console.warn("[Workspace] search failed:", error.message);
    throw new WorkspaceError("SEARCH_UNAVAILABLE", "Поиск временно недоступен.", {
      reason: error.message,
    });
  }
}

function userSeesAllWorkspace(user) {
  if (!user || user.isLocalOnlySynthetic) return true;
  return (
    hasPermission(user, "chats.manage.all") ||
    hasPermission(user, "projects.manage") ||
    user.role === "administrator"
  );
}

function accessibleChatIds(user) {
  if (!user?.userId) return new Set();
  const db = getDatabase();
  const own = db
    .prepare(
      `SELECT id FROM chats WHERE owner_user_id = ? OR created_by_user_id = ?`
    )
    .all(user.userId, user.userId)
    .map((r) => r.id);
  const member = db
    .prepare(
      `SELECT c.id FROM chats c
       JOIN project_members pm ON pm.project_id = c.project_id
       WHERE pm.user_id = ?`
    )
    .all(user.userId)
    .map((r) => r.id);
  return new Set([...own, ...member]);
}

function accessibleProjectIds(user) {
  if (!user?.userId) return new Set();
  const db = getDatabase();
  const own = db
    .prepare(`SELECT id FROM projects WHERE owner_user_id = ? OR created_by_user_id = ?`)
    .all(user.userId, user.userId)
    .map((r) => r.id);
  const member = db
    .prepare(`SELECT project_id AS id FROM project_members WHERE user_id = ?`)
    .all(user.userId)
    .map((r) => r.id);
  return new Set([...own, ...member]);
}

function filterSearchResults(rows, user) {
  if (userSeesAllWorkspace(user)) return rows;
  const chats = accessibleChatIds(user);
  const projects = accessibleProjectIds(user);
  const db = getDatabase();
  return rows.filter((row) => {
    if (row.entityType === "project") {
      return projects.has(row.entityId);
    }
    if (row.entityType === "chat") {
      return chats.has(row.entityId);
    }
    if (row.entityType === "message") {
      const chat = db
        .prepare("SELECT chat_id FROM messages WHERE id = ?")
        .get(row.entityId);
      // message entityId may be message id; also try content join via title chat
      if (chat?.chat_id) return chats.has(chat.chat_id);
      // fallback: if result includes project linkage only from FTS without chat id, deny
      const byTitle = db
        .prepare("SELECT id FROM chats WHERE title = ? LIMIT 1")
        .get(row.title);
      return byTitle ? chats.has(byTitle.id) : false;
    }
    // CRM entity hits from FTS: hide IDs outside explicit chat/project context for managers
    if (row.crmEntityId && !row.entityType) return false;
    return false;
  });
}

function searchFts(query, limit) {
  const db = getDatabase();
  const terms = query
    .replace(/["']/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w.replace(/"/g, "")}"*`);
  const matchQuery = terms.join(" OR ");
  if (!matchQuery) return [];

  try {
    const rows = db
      .prepare(
        `SELECT entity_type, entity_id, title,
                snippet(workspace_search, 3, '', '', '…', 16) AS snippet,
                project_name, crm_entity_type, crm_entity_id
         FROM workspace_search
         WHERE workspace_search MATCH ?
         LIMIT ?`
      )
      .all(matchQuery, limit);

    return rows.map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      title: row.title,
      snippet: row.snippet || "",
      projectName: row.project_name || null,
      crmEntityType: row.crm_entity_type || null,
      crmEntityId: row.crm_entity_id || null,
    }));
  } catch (error) {
    console.warn("[Workspace] FTS match failed, falling back to LIKE:", error.message);
    return searchLike(query, limit);
  }
}

function searchLike(query, limit) {
  const db = getDatabase();
  const like = `%${query}%`;

  const chats = db
    .prepare(
      `SELECT c.id, c.title, c.crm_entity_type, c.crm_entity_id, p.name AS project_name,
              (SELECT SUBSTR(m.content, 1, 120) FROM messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS snippet
       FROM chats c
       LEFT JOIN projects p ON p.id = c.project_id
       WHERE c.title LIKE ?
          OR IFNULL(c.crm_entity_id, '') LIKE ?
          OR IFNULL(c.crm_entity_type, '') LIKE ?
          OR IFNULL(p.name, '') LIKE ?
       ORDER BY c.updated_at DESC
       LIMIT ?`
    )
    .all(like, like, like, like, limit)
    .map((row) => ({
      entityType: "chat",
      entityId: row.id,
      title: row.title,
      snippet: row.snippet || "",
      projectName: row.project_name,
      crmEntityType: row.crm_entity_type,
      crmEntityId: row.crm_entity_id,
    }));

  const messages = db
    .prepare(
      `SELECT m.id, m.content, c.title, c.crm_entity_type, c.crm_entity_id, p.name AS project_name
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       LEFT JOIN projects p ON p.id = c.project_id
       WHERE m.content LIKE ? AND m.role IN ('user', 'assistant')
       ORDER BY m.id DESC
       LIMIT ?`
    )
    .all(like, limit)
    .map((row) => ({
      entityType: "message",
      entityId: String(row.id),
      title: row.title,
      snippet: String(row.content || "").slice(0, 120),
      projectName: row.project_name,
      crmEntityType: row.crm_entity_type,
      crmEntityId: row.crm_entity_id,
    }));

  const projects = db
    .prepare(
      `SELECT id, name, description FROM projects
       WHERE name LIKE ? OR IFNULL(description, '') LIKE ? OR IFNULL(instruction, '') LIKE ?
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(like, like, like, limit)
    .map((row) => ({
      entityType: "project",
      entityId: row.id,
      title: row.name,
      snippet: String(row.description || "").slice(0, 120),
      projectName: row.name,
      crmEntityType: null,
      crmEntityId: null,
    }));

  return [...chats, ...messages, ...projects].slice(0, limit);
}
