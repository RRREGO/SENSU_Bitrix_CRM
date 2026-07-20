import crypto from "crypto";
import { getDatabase } from "../index.js";

function uid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

const DEFAULT_STRUCTURE = {
  sections: [
    "date",
    "participants",
    "client",
    "company",
    "goal",
    "context",
    "topics",
    "needs",
    "constraints",
    "agreements",
    "nextSteps",
    "owners",
    "deadlines",
    "materials",
    "risks",
    "forecast",
    "recommendedStage",
    "openQuestions",
  ],
};

export function ensureDefaultProtocolTemplate() {
  const existing = getDatabase()
    .prepare("SELECT id FROM meeting_protocol_templates WHERE is_default = 1 LIMIT 1")
    .get();
  if (existing) return getProtocolTemplate(existing.id);

  const id = uid();
  const ts = now();
  getDatabase()
    .prepare(
      `INSERT INTO meeting_protocol_templates (
        id, name, description, instruction, structure_json, is_default, project_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, NULL, ?, ?)`
    )
    .run(
      id,
      "Базовый протокол встречи",
      "Строгий деловой протокол с разделением фактов и рекомендаций",
      "Сформируй протокол на русском. Отделяй факты из транскрипта, выводы и рекомендации. Не выдумывай участников, сроки и договорённости.",
      JSON.stringify(DEFAULT_STRUCTURE),
      ts,
      ts
    );
  return getProtocolTemplate(id);
}

function mapTemplate(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    instruction: row.instruction || "",
    structure: JSON.parse(row.structure_json || "{}"),
    isDefault: Boolean(row.is_default),
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getProtocolTemplate(id) {
  return mapTemplate(
    getDatabase().prepare("SELECT * FROM meeting_protocol_templates WHERE id = ?").get(id)
  );
}

export function listProtocolTemplates({ projectId = null } = {}) {
  if (projectId) {
    return getDatabase()
      .prepare(
        `SELECT * FROM meeting_protocol_templates
         WHERE project_id = ? OR is_default = 1
         ORDER BY is_default DESC, updated_at DESC`
      )
      .all(projectId)
      .map(mapTemplate);
  }
  return getDatabase()
    .prepare("SELECT * FROM meeting_protocol_templates ORDER BY is_default DESC, updated_at DESC")
    .all()
    .map(mapTemplate);
}

export function upsertProjectProtocolTemplate(projectId, data = {}) {
  const ts = now();
  const existing = getDatabase()
    .prepare(
      "SELECT id FROM meeting_protocol_templates WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1"
    )
    .get(projectId);

  if (existing) {
    getDatabase()
      .prepare(
        `UPDATE meeting_protocol_templates SET
          name = ?, description = ?, instruction = ?, structure_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        data.name || "Шаблон проекта",
        data.description || "",
        data.instruction || "",
        JSON.stringify(data.structure || DEFAULT_STRUCTURE),
        ts,
        existing.id
      );
    return getProtocolTemplate(existing.id);
  }

  const id = uid();
  getDatabase()
    .prepare(
      `INSERT INTO meeting_protocol_templates (
        id, name, description, instruction, structure_json, is_default, project_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`
    )
    .run(
      id,
      data.name || "Шаблон проекта",
      data.description || "",
      data.instruction || "",
      JSON.stringify(data.structure || DEFAULT_STRUCTURE),
      projectId,
      ts,
      ts
    );
  return getProtocolTemplate(id);
}

function mapProtocol(row) {
  if (!row) return null;
  return {
    id: row.id,
    transcriptId: row.transcript_id,
    chatId: row.chat_id,
    projectId: row.project_id,
    templateId: row.template_id,
    crmEntityType: row.crm_entity_type,
    crmEntityId: row.crm_entity_id,
    title: row.title,
    protocol: JSON.parse(row.protocol_json || "{}"),
    protocolText: row.protocol_text,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createMeetingProtocol(data = {}) {
  const id = uid();
  const ts = now();
  getDatabase()
    .prepare(
      `INSERT INTO meeting_protocols (
        id, transcript_id, chat_id, project_id, template_id,
        crm_entity_type, crm_entity_id, title, protocol_json, protocol_text, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      data.transcriptId || null,
      data.chatId || null,
      data.projectId || null,
      data.templateId || null,
      data.crmEntityType || null,
      data.crmEntityId != null ? String(data.crmEntityId) : null,
      data.title || "Протокол встречи",
      JSON.stringify(data.protocol || {}),
      data.protocolText || "",
      data.status || "draft",
      ts,
      ts
    );
  return getMeetingProtocol(id);
}

export function getMeetingProtocol(id) {
  return mapProtocol(getDatabase().prepare("SELECT * FROM meeting_protocols WHERE id = ?").get(id));
}

export function updateMeetingProtocol(id, patch = {}) {
  const current = getMeetingProtocol(id);
  if (!current) return null;
  getDatabase()
    .prepare(
      `UPDATE meeting_protocols SET
        title = ?, protocol_json = ?, protocol_text = ?, status = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.title ?? current.title,
      JSON.stringify(patch.protocol ?? current.protocol),
      patch.protocolText ?? current.protocolText,
      patch.status ?? current.status,
      now(),
      id
    );
  return getMeetingProtocol(id);
}

export function listMeetingProtocols({ entityType, entityId, chatId, limit = 30 } = {}) {
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
  args.push(Math.min(Number(limit) || 30, 100));
  return getDatabase()
    .prepare(
      `SELECT * FROM meeting_protocols
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(...args)
    .map(mapProtocol);
}
