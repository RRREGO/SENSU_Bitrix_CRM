import crypto from "crypto";
import { getDatabase, getSearchMode } from "../index.js";
import { WorkspaceError } from "../../workspace/config.js";

function uid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function mapChat(row) {
  if (!row) return null;
  const updatedAt = row.updated_at;
  return {
    id: row.id,
    projectId: row.project_id || null,
    sessionId: row.session_id || null,
    title: row.title,
    status: row.status,
    crmEntityType: row.crm_entity_type || null,
    crmEntityId: row.crm_entity_id != null ? String(row.crm_entity_id) : null,
    modelName: row.model_name || null,
    aiModelId: row.ai_model_id || null,
    aiProviderId: row.ai_provider_id || null,
    promptProfileId: row.prompt_profile_id || null,
    createdAt: row.created_at,
    updatedAt,
    lastActivityAt: updatedAt,
    archivedAt: row.archived_at || null,
    ownerUserId: row.owner_user_id || null,
    createdByUserId: row.created_by_user_id || null,
    projectName: row.project_name || null,
    lastMessagePreview: row.last_message_preview || null,
    isPinned: Boolean(row.is_pinned),
  };
}

function upsertSearchChat(chat) {
  if (getSearchMode() !== "fts5") return;
  const db = getDatabase();
  db.prepare("DELETE FROM workspace_search WHERE entity_type = ? AND entity_id = ?").run(
    "chat",
    chat.id
  );
  db.prepare(
    `INSERT INTO workspace_search (
      entity_type, entity_id, title, body, project_name, crm_entity_type, crm_entity_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "chat",
    chat.id,
    chat.title || "",
    "",
    chat.projectName || "",
    chat.crmEntityType || "",
    chat.crmEntityId || ""
  );
}

export function createChat(data = {}) {
  const id = uid();
  const ts = now();
  try {
    getDatabase()
      .prepare(
        `INSERT INTO chats (
          id, project_id, session_id, title, status, crm_entity_type, crm_entity_id,
          model_name, created_at, updated_at, archived_at, owner_user_id, created_by_user_id
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(
        id,
        data.projectId || null,
        data.sessionId || null,
        data.title || "Новый диалог",
        data.crmEntityType || null,
        data.crmEntityId != null ? String(data.crmEntityId) : null,
        data.modelName || process.env.CLAUDE_MODEL || null,
        ts,
        ts,
        data.ownerUserId || data.createdByUserId || null,
        data.createdByUserId || data.ownerUserId || null
      );
  } catch (error) {
    throw new WorkspaceError("DATABASE_WRITE_FAILED", error.message);
  }

  const chat = getChatById(id);
  upsertSearchChat(chat);
  return chat;
}

export function getChatById(id) {
  const row = getDatabase()
    .prepare(
      `SELECT c.*, p.name AS project_name FROM chats c
       LEFT JOIN projects p ON p.id = c.project_id
       WHERE c.id = ?`
    )
    .get(id);
  return mapChat(row);
}

export function getChatBySessionId(sessionId, { ownerUserId } = {}) {
  if (!sessionId) return null;
  const owner = ownerUserId ? String(ownerUserId) : null;
  const row = owner
    ? getDatabase()
        .prepare(
          `SELECT c.*, p.name AS project_name FROM chats c
           LEFT JOIN projects p ON p.id = c.project_id
           WHERE c.session_id = ? AND c.status = 'active'
             AND (c.owner_user_id = ? OR c.created_by_user_id = ?)
           ORDER BY c.updated_at DESC LIMIT 1`
        )
        .get(sessionId, owner, owner)
    : getDatabase()
        .prepare(
          `SELECT c.*, p.name AS project_name FROM chats c
           LEFT JOIN projects p ON p.id = c.project_id
           WHERE c.session_id = ? AND c.status = 'active'
           ORDER BY c.updated_at DESC LIMIT 1`
        )
        .get(sessionId);
  return mapChat(row);
}

export function listChats(filters = {}) {
  const where = [];
  const args = [];

  if (filters.projectId) {
    where.push("c.project_id = ?");
    args.push(filters.projectId);
  } else if (filters.unassigned === true || filters.unassigned === "1" || filters.unassigned === "true") {
    where.push("c.project_id IS NULL");
  }

  if (filters.status) {
    where.push("c.status = ?");
    args.push(filters.status);
  } else if (!filters.includeArchived) {
    where.push("c.status = 'active'");
  }

  const q = String(filters.q || "").trim();
  if (q) {
    where.push(
      `(c.title LIKE ? OR p.name LIKE ? OR EXISTS (
        SELECT 1 FROM messages m
        WHERE m.chat_id = c.id AND m.content LIKE ?
        LIMIT 1
      ))`
    );
    const like = `%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    args.push(like, like, like);
  }

  const limit = Math.min(Number(filters.limit) || 50, 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  let orderBy = "c.is_pinned DESC, c.updated_at DESC";
  const sort = String(filters.sort || "activity").toLowerCase();
  if (sort === "created") {
    orderBy = "c.is_pinned DESC, c.created_at DESC";
  } else if (sort === "title") {
    orderBy = "c.is_pinned DESC, LOWER(c.title) ASC";
  }

  const sql = `
    SELECT c.*, p.name AS project_name,
      (SELECT SUBSTR(m.content, 1, 120) FROM messages m
       WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message_preview
    FROM chats c
    LEFT JOIN projects p ON p.id = c.project_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;
  args.push(limit, offset);

  return getDatabase().prepare(sql).all(...args).map(mapChat);
}

export function updateChat(id, patch = {}) {
  const current = getChatById(id);
  if (!current) throw new WorkspaceError("CHAT_NOT_FOUND", "Чат не найден.");

  const nextStatus = patch.status ?? current.status;
  const archivedAt =
    nextStatus === "archived"
      ? patch.archivedAt || current.archivedAt || now()
      : null;

  try {
    getDatabase()
      .prepare(
        `UPDATE chats SET
          title = ?,
          project_id = ?,
          crm_entity_type = ?,
          crm_entity_id = ?,
          status = ?,
          archived_at = ?,
          model_name = ?,
          ai_model_id = ?,
          ai_provider_id = ?,
          prompt_profile_id = ?,
          is_pinned = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .run(
        patch.title ?? current.title,
        patch.projectId !== undefined ? patch.projectId : current.projectId,
        patch.crmEntityType !== undefined ? patch.crmEntityType : current.crmEntityType,
        patch.crmEntityId !== undefined
          ? patch.crmEntityId != null
            ? String(patch.crmEntityId)
            : null
          : current.crmEntityId,
        nextStatus,
        archivedAt,
        patch.modelName !== undefined ? patch.modelName : current.modelName,
        patch.aiModelId !== undefined ? patch.aiModelId : current.aiModelId,
        patch.aiProviderId !== undefined ? patch.aiProviderId : current.aiProviderId,
        patch.promptProfileId !== undefined ? patch.promptProfileId : current.promptProfileId,
        patch.isPinned !== undefined ? (patch.isPinned ? 1 : 0) : current.isPinned ? 1 : 0,
        now(),
        id
      );
  } catch (error) {
    throw new WorkspaceError("DATABASE_WRITE_FAILED", error.message);
  }

  const chat = getChatById(id);
  upsertSearchChat(chat);
  return chat;
}

export function touchChat(id) {
  getDatabase().prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(now(), id);
}

export function archiveChat(id) {
  return updateChat(id, { status: "archived" });
}

export function restoreChat(id) {
  return updateChat(id, { status: "active", archivedAt: null });
}

export function deleteChatPermanently(id) {
  const chat = getChatById(id);
  if (!chat) throw new WorkspaceError("CHAT_NOT_FOUND", "Чат не найден.");

  const db = getDatabase();
  const messageIds = db.prepare("SELECT id FROM messages WHERE chat_id = ?").all(id);

  if (getSearchMode() === "fts5") {
    db.prepare("DELETE FROM workspace_search WHERE entity_type = ? AND entity_id = ?").run(
      "chat",
      id
    );
    const delMsg = db.prepare(
      "DELETE FROM workspace_search WHERE entity_type = ? AND entity_id = ?"
    );
    for (const row of messageIds) {
      delMsg.run("message", String(row.id));
    }
  }

  db.prepare("DELETE FROM chat_summaries WHERE chat_id = ?").run(id);
  db.prepare("DELETE FROM messages WHERE chat_id = ?").run(id);
  db.prepare("DELETE FROM chats WHERE id = ?").run(id);

  return { id, deleted: true };
}

/**
 * Duplicate chat with messages into a new session.
 */
export function duplicateChat(id, { ownerUserId = null, createdByUserId = null } = {}) {
  const source = getChatById(id);
  if (!source) throw new WorkspaceError("CHAT_NOT_FOUND", "Чат не найден.");

  const copy = createChat({
    title: `${source.title || "Диалог"} (копия)`,
    projectId: source.projectId,
    crmEntityType: source.crmEntityType,
    crmEntityId: source.crmEntityId,
    sessionId: uid(),
    modelName: source.modelName,
    ownerUserId: ownerUserId || source.ownerUserId,
    createdByUserId: createdByUserId || ownerUserId || source.createdByUserId,
  });

  const db = getDatabase();
  const messages = db
    .prepare(
      `SELECT role, content, message_type, metadata_json, created_at
       FROM messages WHERE chat_id = ? ORDER BY id ASC`
    )
    .all(id);

  const insert = db.prepare(
    `INSERT INTO messages (chat_id, role, content, message_type, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const m of messages) {
    insert.run(copy.id, m.role, m.content, m.message_type, m.metadata_json, m.created_at);
  }

  touchChat(copy.id);
  return getChatById(copy.id);
}

export function autoTitleFromMessage(text) {
  const cleaned = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "");
  if (!cleaned) return "Новый диалог";
  return cleaned.slice(0, 80);
}

export function ensureChatForSession({ sessionId, chatId, projectId, ownerUserId } = {}) {
  if (chatId) {
    const chat = getChatById(chatId);
    if (!chat) throw new WorkspaceError("CHAT_NOT_FOUND", "Чат не найден.");
    return chat;
  }
  if (sessionId) {
    const existing = getChatBySessionId(sessionId, { ownerUserId });
    if (existing) return existing;
    return createChat({ sessionId, projectId, ownerUserId, createdByUserId: ownerUserId });
  }
  return createChat({ projectId, ownerUserId, createdByUserId: ownerUserId });
}
