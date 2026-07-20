import crypto from "crypto";
import { getDatabase } from "../index.js";
import { getClientContextConfig, ClientContextError } from "../../clientContext/config.js";

function uid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function mapTranscript(row) {
  if (!row) return null;
  return {
    id: row.id,
    chatId: row.chat_id,
    projectId: row.project_id,
    crmEntityType: row.crm_entity_type,
    crmEntityId: row.crm_entity_id,
    title: row.title,
    meetingDate: row.meeting_date,
    contentText: row.content_text,
    contentHash: row.content_hash,
    sizeChars: row.size_chars,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createMeetingTranscript(data = {}) {
  const cfg = getClientContextConfig();
  const text = String(data.text || data.contentText || "");
  if (!text.trim()) {
    throw new ClientContextError("TRANSCRIPT_NOT_FOUND", "Текст транскрипта пуст.");
  }
  if (text.length > cfg.transcriptMaxChars) {
    throw new ClientContextError(
      "TRANSCRIPT_TOO_LARGE",
      `Транскрипт превышает лимит ${cfg.transcriptMaxChars} символов.`
    );
  }

  const id = uid();
  const ts = now();
  const hash = crypto.createHash("sha256").update(text, "utf8").digest("hex");

  getDatabase()
    .prepare(
      `INSERT INTO meeting_transcripts (
        id, chat_id, project_id, crm_entity_type, crm_entity_id,
        title, meeting_date, content_text, content_hash, size_chars, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      data.chatId || null,
      data.projectId || null,
      data.entityType || data.crmEntityType || null,
      data.entityId != null ? String(data.entityId) : data.crmEntityId || null,
      data.title || "Транскрипт встречи",
      data.meetingDate || null,
      text,
      hash,
      text.length,
      ts,
      ts
    );

  console.log(`[Meeting] transcript saved id=${id} chars=${text.length}`);
  return getMeetingTranscript(id);
}

export function getMeetingTranscript(id) {
  return mapTranscript(
    getDatabase().prepare("SELECT * FROM meeting_transcripts WHERE id = ?").get(id)
  );
}

export function listMeetingTranscripts({ chatId, entityType, entityId, limit = 50 } = {}) {
  const where = [];
  const args = [];
  if (chatId) {
    where.push("chat_id = ?");
    args.push(chatId);
  }
  if (entityType && entityId) {
    where.push("crm_entity_type = ? AND crm_entity_id = ?");
    args.push(entityType, String(entityId));
  }
  args.push(Math.min(Number(limit) || 50, 200));
  return getDatabase()
    .prepare(
      `SELECT * FROM meeting_transcripts
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(...args)
    .map(mapTranscript);
}
