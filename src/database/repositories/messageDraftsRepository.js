import crypto from "crypto";
import { getDatabase } from "../index.js";

function uid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

export function hashBody(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function mapDraft(row) {
  if (!row) return null;
  return {
    id: row.id,
    chatId: row.chat_id,
    projectId: row.project_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    contactId: row.contact_id,
    channel: row.channel,
    recipientReference: row.recipient_reference,
    subject: row.subject,
    body: row.body,
    bodyHash: row.body_hash,
    status: row.status,
    basedOn: row.based_on_json ? JSON.parse(row.based_on_json) : [],
    warnings: row.warnings_json ? JSON.parse(row.warnings_json) : [],
    recipient: row.recipient_json ? JSON.parse(row.recipient_json) : null,
    sendAvailable: Boolean(row.send_available),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
  };
}

export function createMessageDraft(data = {}) {
  const id = uid();
  const ts = now();
  const body = String(data.body || "");
  getDatabase()
    .prepare(
      `INSERT INTO message_drafts (
        id, chat_id, project_id, entity_type, entity_id, contact_id, channel,
        recipient_reference, subject, body, body_hash, status,
        based_on_json, warnings_json, recipient_json, send_available,
        created_at, updated_at, sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    .run(
      id,
      data.chatId || null,
      data.projectId || null,
      data.entityType || null,
      data.entityId != null ? String(data.entityId) : null,
      data.contactId != null ? String(data.contactId) : null,
      data.channel,
      data.recipientReference || null,
      data.subject || null,
      body,
      hashBody(body),
      data.status || "draft",
      JSON.stringify(data.basedOn || []),
      JSON.stringify(data.warnings || []),
      JSON.stringify(data.recipient || null),
      data.sendAvailable ? 1 : 0,
      ts,
      ts
    );
  return getMessageDraft(id);
}

export function getMessageDraft(id) {
  return mapDraft(getDatabase().prepare("SELECT * FROM message_drafts WHERE id = ?").get(id));
}

export function listMessageDrafts({ chatId, entityType, entityId, limit = 50 } = {}) {
  const where = [];
  const args = [];
  if (chatId) {
    where.push("chat_id = ?");
    args.push(chatId);
  }
  if (entityType && entityId) {
    where.push("entity_type = ? AND entity_id = ?");
    args.push(entityType, String(entityId));
  }
  args.push(Number(limit) || 50);
  const sql = `SELECT * FROM message_drafts ${
    where.length ? `WHERE ${where.join(" AND ")}` : ""
  } ORDER BY updated_at DESC LIMIT ?`;
  return getDatabase().prepare(sql).all(...args).map(mapDraft);
}

export function updateMessageDraft(id, patch = {}) {
  const current = getMessageDraft(id);
  if (!current) return null;
  if (["sent", "cancelled"].includes(current.status) && patch.status !== "sent") {
    // allow status transitions carefully by caller
  }
  const body = patch.body !== undefined ? String(patch.body) : current.body;
  const ts = now();
  getDatabase()
    .prepare(
      `UPDATE message_drafts SET
        channel = ?, recipient_reference = ?, subject = ?, body = ?, body_hash = ?,
        status = ?, based_on_json = ?, warnings_json = ?, recipient_json = ?,
        send_available = ?, contact_id = ?, updated_at = ?, sent_at = ?
       WHERE id = ?`
    )
    .run(
      patch.channel ?? current.channel,
      patch.recipientReference !== undefined ? patch.recipientReference : current.recipientReference,
      patch.subject !== undefined ? patch.subject : current.subject,
      body,
      hashBody(body),
      patch.status ?? current.status,
      JSON.stringify(patch.basedOn ?? current.basedOn),
      JSON.stringify(patch.warnings ?? current.warnings),
      JSON.stringify(patch.recipient !== undefined ? patch.recipient : current.recipient),
      (patch.sendAvailable !== undefined ? patch.sendAvailable : current.sendAvailable) ? 1 : 0,
      patch.contactId !== undefined
        ? patch.contactId != null
          ? String(patch.contactId)
          : null
        : current.contactId,
      ts,
      patch.sentAt !== undefined ? patch.sentAt : current.sentAt,
      id
    );
  return getMessageDraft(id);
}

function mapOutbound(row) {
  if (!row) return null;
  return {
    id: row.id,
    draftId: row.draft_id,
    operationId: row.operation_id,
    channel: row.channel,
    provider: row.provider,
    recipientReference: row.recipient_reference,
    bodyHash: row.body_hash,
    externalMessageId: row.external_message_id,
    status: row.status,
    verificationStatus: row.verification_status,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    failedAt: row.failed_at,
    error: row.error_json ? JSON.parse(row.error_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getOutboundByDraftAndOperation(draftId, operationId) {
  return mapOutbound(
    getDatabase()
      .prepare("SELECT * FROM outbound_messages WHERE draft_id = ? AND operation_id = ?")
      .get(draftId, operationId)
  );
}

export function createOutboundMessage(data) {
  const existing = getOutboundByDraftAndOperation(data.draftId, data.operationId);
  if (existing) return { outbound: existing, created: false };

  const id = uid();
  const ts = now();
  try {
    getDatabase()
      .prepare(
        `INSERT INTO outbound_messages (
          id, draft_id, operation_id, channel, provider, recipient_reference, body_hash,
          external_message_id, status, verification_status, sent_at, delivered_at, failed_at,
          error_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`
      )
      .run(
        id,
        data.draftId,
        data.operationId,
        data.channel,
        data.provider,
        data.recipientReference || null,
        data.bodyHash,
        data.externalMessageId || null,
        data.status || "sent",
        data.verificationStatus || "unavailable",
        data.sentAt || ts,
        ts,
        ts
      );
  } catch (error) {
    if (/UNIQUE/i.test(error.message)) {
      return {
        outbound: getOutboundByDraftAndOperation(data.draftId, data.operationId),
        created: false,
      };
    }
    throw error;
  }
  return { outbound: getOutboundMessage(id), created: true };
}

export function getOutboundMessage(id) {
  return mapOutbound(getDatabase().prepare("SELECT * FROM outbound_messages WHERE id = ?").get(id));
}

export function listOutboundMessages({ limit = 50 } = {}) {
  return getDatabase()
    .prepare(`SELECT * FROM outbound_messages ORDER BY created_at DESC LIMIT ?`)
    .all(Number(limit) || 50)
    .map(mapOutbound);
}

export function updateOutboundMessage(id, patch = {}) {
  const current = getOutboundMessage(id);
  if (!current) return null;
  const ts = now();
  getDatabase()
    .prepare(
      `UPDATE outbound_messages SET
        external_message_id = ?, status = ?, verification_status = ?,
        sent_at = ?, delivered_at = ?, failed_at = ?, error_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.externalMessageId !== undefined ? patch.externalMessageId : current.externalMessageId,
      patch.status ?? current.status,
      patch.verificationStatus ?? current.verificationStatus,
      patch.sentAt !== undefined ? patch.sentAt : current.sentAt,
      patch.deliveredAt !== undefined ? patch.deliveredAt : current.deliveredAt,
      patch.failedAt !== undefined ? patch.failedAt : current.failedAt,
      patch.error !== undefined
        ? patch.error
          ? JSON.stringify(patch.error)
          : null
        : current.error
          ? JSON.stringify(current.error)
          : null,
      ts,
      id
    );
  return getOutboundMessage(id);
}

export function addDeliveryEvent({
  outboundMessageId,
  eventType,
  providerStatus = null,
  eventIdempotencyKey = null,
  payload = null,
}) {
  if (eventIdempotencyKey) {
    const hit = getDatabase()
      .prepare("SELECT id FROM message_delivery_events WHERE event_idempotency_key = ?")
      .get(eventIdempotencyKey);
    if (hit) return { id: hit.id, duplicate: true };
  }
  const id = uid();
  getDatabase()
    .prepare(
      `INSERT INTO message_delivery_events (
        id, outbound_message_id, event_type, provider_status, event_idempotency_key, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      outboundMessageId,
      eventType,
      providerStatus,
      eventIdempotencyKey,
      payload ? JSON.stringify(payload) : null,
      now()
    );
  return { id, duplicate: false };
}

export function countVerificationRequired() {
  try {
    return getDatabase()
      .prepare(
        `SELECT COUNT(*) AS c FROM outbound_messages WHERE status = 'verification_required'`
      )
      .get().c;
  } catch {
    return 0;
  }
}
