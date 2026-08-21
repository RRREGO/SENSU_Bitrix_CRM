import crypto from "crypto";
import { getDatabase, getSearchMode } from "../index.js";
import { WorkspaceError } from "../../workspace/config.js";
import { redactObject } from "../../safety/redact.js";
import { touchChat } from "./chatsRepository.js";

function now() {
  return new Date().toISOString();
}

const ALLOWED_ROLES = new Set(["user", "assistant", "system_note"]);
const ALLOWED_TYPES = new Set([
  "text",
  "confirmation_preview",
  "operation_result",
  "error",
  "summary",
]);

function mapMessage(row) {
  if (!row) return null;
  let metadata = null;
  if (row.metadata_json) {
    try {
      metadata = JSON.parse(row.metadata_json);
    } catch {
      metadata = null;
    }
  }
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role,
    content: row.content,
    messageType: row.message_type,
    metadata,
    createdAt: row.created_at,
  };
}

function indexMessage(message, chatMeta = {}) {
  if (getSearchMode() !== "fts5") return;
  if (message.role !== "user" && message.role !== "assistant") return;
  if (!["text", "confirmation_preview", "operation_result", "summary"].includes(message.messageType)) {
    return;
  }

  const db = getDatabase();
  db.prepare(
    `INSERT INTO workspace_search (
      entity_type, entity_id, title, body, project_name, crm_entity_type, crm_entity_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "message",
    String(message.id),
    chatMeta.title || "",
    message.content || "",
    chatMeta.projectName || "",
    chatMeta.crmEntityType || "",
    chatMeta.crmEntityId || ""
  );
}

/**
 * Save only safe plain-text messages. Never tool_use / tool_result.
 */
export function addMessage(chatId, { role, content, messageType = "text", metadata = null, chatMeta = {} }) {
  if (!ALLOWED_ROLES.has(role)) {
    throw new WorkspaceError("DATABASE_WRITE_FAILED", `Недопустимая роль сообщения: ${role}`);
  }
  if (!ALLOWED_TYPES.has(messageType)) {
    throw new WorkspaceError("DATABASE_WRITE_FAILED", `Недопустимый тип сообщения: ${messageType}`);
  }

  const text = String(content ?? "");
  if (!text.trim() && messageType === "text") {
    throw new WorkspaceError("DATABASE_WRITE_FAILED", "Пустое сообщение.");
  }

  // Refuse accidental tool payload storage
  if (/tool_use|tool_result|executionToken|execution_token/i.test(text)) {
    // Still allow human-readable text that mentions these words in explanation,
    // but block obvious JSON tool dumps.
    if (/^\s*\{[\s\S]*"type"\s*:\s*"tool_(use|result)"/.test(text)) {
      throw new WorkspaceError(
        "DATABASE_WRITE_FAILED",
        "Технические tool-блоки нельзя сохранять в историю."
      );
    }
  }

  const safeMeta = metadata != null ? redactObject(metadata) : null;

  let info;
  try {
    info = getDatabase()
      .prepare(
        `INSERT INTO messages (chat_id, role, content, message_type, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        chatId,
        role,
        text,
        messageType,
        safeMeta != null ? JSON.stringify(safeMeta) : null,
        now()
      );
    touchChat(chatId);
  } catch (error) {
    throw new WorkspaceError("DATABASE_WRITE_FAILED", error.message);
  }

  const message = getMessageById(info.lastInsertRowid);
  try {
    indexMessage(message, chatMeta);
  } catch (error) {
    console.warn("[Chat] search index skip:", error.message);
  }
  return message;
}

export function getMessageById(id) {
  return mapMessage(getDatabase().prepare("SELECT * FROM messages WHERE id = ?").get(id));
}

export function listMessages(chatId, { beforeId = null, limit = 50 } = {}) {
  const lim = Math.min(Number(limit) || 50, 200);
  let rows;
  if (beforeId) {
    rows = getDatabase()
      .prepare(
        `SELECT * FROM messages WHERE chat_id = ? AND id < ?
         ORDER BY id DESC LIMIT ?`
      )
      .all(chatId, Number(beforeId), lim);
  } else {
    rows = getDatabase()
      .prepare(
        `SELECT * FROM messages WHERE chat_id = ?
         ORDER BY id DESC LIMIT ?`
      )
      .all(chatId, lim);
  }
  return rows.map(mapMessage).reverse();
}

export function countMessages(chatId) {
  return (
    getDatabase().prepare("SELECT COUNT(*) AS c FROM messages WHERE chat_id = ?").get(chatId)?.c ||
    0
  );
}

export function getRecentPlainMessages(chatId, limit = 30) {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM messages
       WHERE chat_id = ? AND role IN ('user', 'assistant') AND message_type IN ('text', 'summary', 'confirmation_preview', 'operation_result')
       ORDER BY id DESC LIMIT ?`
    )
    .all(chatId, limit);
  return rows.map(mapMessage).reverse();
}

export function getMessagesBefore(chatId, throughIdExclusive, limit = 200) {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM messages
       WHERE chat_id = ? AND id < ? AND role IN ('user', 'assistant')
       ORDER BY id DESC LIMIT ?`
    )
    .all(chatId, Number(throughIdExclusive), limit);
  return rows.map(mapMessage).reverse();
}

export function createChatSummary({ chatId, summaryText, throughMessageId }) {
  const id = cryptoRandom();
  getDatabase()
    .prepare(
      `INSERT INTO chat_summaries (id, chat_id, summary_text, through_message_id, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, chatId, summaryText, Number(throughMessageId), now());
  return getLatestSummary(chatId);
}

function cryptoRandom() {
  return crypto.randomUUID();
}

export function getLatestSummary(chatId) {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM chat_summaries WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .get(chatId);
  if (!row) return null;
  return {
    id: row.id,
    chatId: row.chat_id,
    summaryText: row.summary_text,
    throughMessageId: row.through_message_id,
    createdAt: row.created_at,
  };
}
