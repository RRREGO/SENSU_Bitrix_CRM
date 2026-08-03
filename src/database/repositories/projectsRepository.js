import crypto from "crypto";
import { getDatabase, getSearchMode } from "../index.js";
import { WorkspaceError } from "../../workspace/config.js";

function uid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

export const PROJECT_COLOR_KEYS = new Set(["violet", "teal", "slate", "amber", "rose"]);

function parseCrmBindings(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((b) => b && typeof b === "object" && b.type)
      .map((b) => ({
        type: String(b.type),
        id: b.id != null ? String(b.id) : null,
        title: b.title != null ? String(b.title) : null,
      }));
  } catch {
    return [];
  }
}

function normalizeColorKey(value) {
  if (value == null || value === "") return null;
  const key = String(value).toLowerCase();
  if (!PROJECT_COLOR_KEYS.has(key)) {
    throw new WorkspaceError(
      "INVALID_COLOR_KEY",
      `Допустимые цвета: ${[...PROJECT_COLOR_KEYS].join(", ")}.`
    );
  }
  return key;
}

function mapProject(row) {
  if (!row) return null;
  const updatedAt = row.updated_at;
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    instruction: row.instruction || "",
    profileId: row.profile_id || null,
    defaultAiModelId: row.default_ai_model_id || null,
    defaultPromptProfileId: row.default_prompt_profile_id || null,
    isArchived: Boolean(row.is_archived),
    isPinned: Boolean(row.is_pinned),
    colorKey: row.color_key || null,
    sortOrder: Number(row.sort_order) || 0,
    crmBindings: parseCrmBindings(row.crm_bindings_json),
    createdAt: row.created_at,
    updatedAt,
    lastActivityAt: updatedAt,
    ownerUserId: row.owner_user_id || null,
    createdByUserId: row.created_by_user_id || null,
  };
}

export function listProjects({ archived = false } = {}) {
  return getDatabase()
    .prepare(
      `SELECT * FROM projects WHERE is_archived = ?
       ORDER BY is_pinned DESC, sort_order ASC, updated_at DESC`
    )
    .all(archived ? 1 : 0)
    .map(mapProject);
}

export function getProjectById(id) {
  return mapProject(getDatabase().prepare("SELECT * FROM projects WHERE id = ?").get(id));
}

export function createProject(data = {}) {
  const id = uid();
  const ts = now();
  const colorKey = normalizeColorKey(data.colorKey);
  const crmBindingsJson =
    data.crmBindings != null ? JSON.stringify(data.crmBindings) : null;
  try {
    getDatabase()
      .prepare(
        `INSERT INTO projects (
          id, name, description, instruction, profile_id, is_archived, created_at, updated_at,
          owner_user_id, created_by_user_id, color_key, sort_order, crm_bindings_json
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        data.name || "Новый проект",
        data.description || "",
        data.instruction || "",
        data.profileId || null,
        ts,
        ts,
        data.ownerUserId || data.createdByUserId || null,
        data.createdByUserId || data.ownerUserId || null,
        colorKey,
        Number(data.sortOrder) || 0,
        crmBindingsJson
      );
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError("DATABASE_WRITE_FAILED", error.message);
  }
  return getProjectById(id);
}

export function updateProject(id, patch = {}) {
  const current = getProjectById(id);
  if (!current) throw new WorkspaceError("PROJECT_NOT_FOUND", "Проект не найден.");

  const colorKey =
    patch.colorKey !== undefined ? normalizeColorKey(patch.colorKey) : current.colorKey;
  const crmBindingsJson =
    patch.crmBindings !== undefined
      ? JSON.stringify(patch.crmBindings || [])
      : JSON.stringify(current.crmBindings || []);

  try {
    getDatabase()
      .prepare(
        `UPDATE projects SET
          name = ?,
          description = ?,
          instruction = ?,
          profile_id = ?,
          is_pinned = ?,
          color_key = ?,
          sort_order = ?,
          crm_bindings_json = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .run(
        patch.name ?? current.name,
        patch.description ?? current.description,
        patch.instruction ?? current.instruction,
        patch.profileId !== undefined ? patch.profileId : current.profileId,
        patch.isPinned !== undefined ? (patch.isPinned ? 1 : 0) : current.isPinned ? 1 : 0,
        colorKey,
        patch.sortOrder !== undefined ? Number(patch.sortOrder) || 0 : current.sortOrder,
        crmBindingsJson,
        now(),
        id
      );
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError("DATABASE_WRITE_FAILED", error.message);
  }
  return getProjectById(id);
}

export function archiveProject(id) {
  const current = getProjectById(id);
  if (!current) throw new WorkspaceError("PROJECT_NOT_FOUND", "Проект не найден.");
  getDatabase()
    .prepare("UPDATE projects SET is_archived = 1, updated_at = ? WHERE id = ?")
    .run(now(), id);
  return getProjectById(id);
}

export function restoreProject(id) {
  const current = getProjectById(id);
  if (!current) throw new WorkspaceError("PROJECT_NOT_FOUND", "Проект не найден.");
  getDatabase()
    .prepare("UPDATE projects SET is_archived = 0, updated_at = ? WHERE id = ?")
    .run(now(), id);
  return getProjectById(id);
}

export function deleteProjectPermanently(id) {
  const current = getProjectById(id);
  if (!current) throw new WorkspaceError("PROJECT_NOT_FOUND", "Проект не найден.");

  const db = getDatabase();
  const chatRows = db.prepare("SELECT id FROM chats WHERE project_id = ?").all(id);
  const messageIdsStmt = db.prepare("SELECT id FROM messages WHERE chat_id = ?");
  const deleteSummaries = db.prepare("DELETE FROM chat_summaries WHERE chat_id = ?");
  const deleteMessages = db.prepare("DELETE FROM messages WHERE chat_id = ?");
  const deleteChat = db.prepare("DELETE FROM chats WHERE id = ?");
  const deleteFiles = db.prepare("DELETE FROM project_files WHERE project_id = ?");
  const deleteMembers = db.prepare("DELETE FROM project_members WHERE project_id = ?");
  const unlinkTemplates = db.prepare(
    "UPDATE meeting_protocol_templates SET project_id = NULL WHERE project_id = ?"
  );
  const deleteProject = db.prepare("DELETE FROM projects WHERE id = ?");

  let searchMode = null;
  try {
    searchMode = getSearchMode();
  } catch {
    searchMode = null;
  }

  const run = db.transaction(() => {
    for (const row of chatRows) {
      const chatId = row.id;
      if (searchMode === "fts5") {
        db.prepare("DELETE FROM workspace_search WHERE entity_type = ? AND entity_id = ?").run(
          "chat",
          chatId
        );
        const delMsg = db.prepare(
          "DELETE FROM workspace_search WHERE entity_type = ? AND entity_id = ?"
        );
        for (const msg of messageIdsStmt.all(chatId)) {
          delMsg.run("message", String(msg.id));
        }
      }
      deleteSummaries.run(chatId);
      deleteMessages.run(chatId);
      deleteChat.run(chatId);
    }

    deleteFiles.run(id);
    try {
      deleteMembers.run(id);
    } catch {
      /* table may not exist in older DBs */
    }
    try {
      unlinkTemplates.run(id);
    } catch {
      /* optional */
    }
    deleteProject.run(id);
  });
  run();

  return { id, deleted: true, deletedChats: chatRows.length };
}

/**
 * Duplicate project metadata and files (without chats).
 */
export function duplicateProject(id, { ownerUserId = null, createdByUserId = null } = {}) {
  const source = getProjectById(id);
  if (!source) throw new WorkspaceError("PROJECT_NOT_FOUND", "Проект не найден.");

  const copy = createProject({
    name: `${source.name} (копия)`,
    description: source.description,
    instruction: source.instruction,
    profileId: source.profileId,
    colorKey: source.colorKey,
    sortOrder: source.sortOrder,
    crmBindings: source.crmBindings,
    ownerUserId: ownerUserId || source.ownerUserId,
    createdByUserId: createdByUserId || ownerUserId || source.createdByUserId,
  });

  const db = getDatabase();
  const files = db.prepare("SELECT * FROM project_files WHERE project_id = ?").all(id);
  const insertFile = db.prepare(
    `INSERT INTO project_files (
      id, project_id, filename, mime_type, content_text, content_hash, size_bytes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const ts = now();
  for (const file of files) {
    insertFile.run(
      uid(),
      copy.id,
      file.filename,
      file.mime_type,
      file.content_text,
      file.content_hash,
      file.size_bytes,
      ts,
      ts
    );
  }

  return getProjectById(copy.id);
}
