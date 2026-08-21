/**
 * SQLite repository for Communications Hub tables.
 */

import crypto from "crypto";
import { getDatabase } from "../database/index.js";

function uid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function parseJson(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function mapChannel(row) {
  if (!row) return null;
  return {
    id: row.id,
    channel: row.channel,
    provider: row.provider,
    status: row.status,
    externalChannelId: row.external_channel_id || null,
    transport: row.transport || null,
    displayName: row.display_name || null,
    plainId: row.plain_id || null,
    state: row.state || row.status || null,
    capabilities: parseJson(row.capabilities_json, {}),
    lastCheckedAt: row.last_checked_at,
    lastSyncedAt: row.last_synced_at || null,
    lastError: parseJson(row.last_error_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapIdentity(row) {
  if (!row) return null;
  return {
    id: row.id,
    contactId: row.contact_id,
    provider: row.provider,
    transport: row.transport,
    chatType: row.chat_type,
    externalChatId: row.external_chat_id,
    username: row.username,
    phoneNormalized: row.phone_normalized,
    source: row.source,
    verified: Boolean(row.verified),
    resolutionStatus: row.resolution_status,
    lastInboundAt: row.last_inbound_at,
    lastOutboundAt: row.last_outbound_at,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapThread(row) {
  if (!row) return null;
  return {
    id: row.id,
    contactId: row.contact_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    provider: row.provider,
    channelId: row.channel_id,
    transport: row.transport,
    chatType: row.chat_type,
    externalChatId: row.external_chat_id,
    identityId: row.identity_id,
    lastInboundAt: row.last_inbound_at,
    lastOutboundAt: row.last_outbound_at,
    unanswered: Boolean(row.unanswered),
    lastMessagePreview: row.last_message_preview,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    threadId: row.thread_id,
    provider: row.provider,
    externalMessageId: row.external_message_id,
    direction: row.direction,
    status: row.status,
    transport: row.transport,
    chatType: row.chat_type,
    channelId: row.channel_id,
    contactId: row.contact_id,
    textSafe: row.text_safe,
    textHash: row.text_hash,
    templateId: row.template_id,
    campaignId: row.campaign_id,
    sequenceEnrollmentId: row.sequence_enrollment_id,
    outboxId: row.outbox_id,
    operationId: row.operation_id,
    replyToExternalId: row.reply_to_external_id,
    crmMessageId: row.crm_message_id,
    errorCode: row.error_code,
    errorSafe: row.error_safe,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
    providerTimestamp: row.provider_timestamp,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOutbox(row) {
  if (!row) return null;
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    provider: row.provider,
    channelId: row.channel_id,
    transport: row.transport,
    chatType: row.chat_type,
    externalChatId: row.external_chat_id,
    contactId: row.contact_id,
    threadId: row.thread_id,
    campaignId: row.campaign_id,
    campaignRecipientId: row.campaign_recipient_id,
    sequenceEnrollmentId: row.sequence_enrollment_id,
    sequenceStepNumber: row.sequence_step_number,
    templateId: row.template_id,
    body: row.body,
    templateValues: parseJson(row.template_values_json, null),
    wabaTemplateId: row.waba_template_id,
    crmMessageId: row.crm_message_id,
    payload: parseJson(row.payload_json, {}),
    status: row.status,
    dryRun: Boolean(row.dry_run),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    lockExpiresAt: row.lock_expires_at,
    providerMessageId: row.provider_message_id,
    lastErrorCode: row.last_error_code,
    lastErrorSafe: row.last_error_safe,
    operationId: row.operation_id,
    planHash: row.plan_hash,
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    certificationId: row.certification_id ?? null,
    accountFingerprint: row.account_fingerprint ?? null,
    channelFingerprint: row.channel_fingerprint ?? null,
    recipientSnapshotHash: row.recipient_snapshot_hash ?? null,
    policyVersion: row.policy_version ?? null,
    templateVersion: row.template_version ?? null,
    bodyHash: row.body_hash ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertHubChannel(data) {
  const db = getDatabase();
  const ts = now();
  const id =
    data.id ||
    `${data.provider || "wazzup"}:${data.externalChannelId || data.channel || uid()}`;
  const existing = db.prepare("SELECT id FROM communication_channels WHERE id = ?").get(id);
  if (existing) {
    db.prepare(
      `UPDATE communication_channels SET
        channel = COALESCE(?, channel),
        provider = COALESCE(?, provider),
        status = COALESCE(?, status),
        external_channel_id = COALESCE(?, external_channel_id),
        transport = COALESCE(?, transport),
        display_name = COALESCE(?, display_name),
        plain_id = COALESCE(?, plain_id),
        state = COALESCE(?, state),
        capabilities_json = COALESCE(?, capabilities_json),
        last_checked_at = ?,
        last_synced_at = ?,
        last_error_json = ?,
        updated_at = ?
       WHERE id = ?`
    ).run(
      data.channel || null,
      data.provider || null,
      data.status || data.state || null,
      data.externalChannelId || null,
      data.transport || null,
      data.displayName || null,
      data.plainId || null,
      data.state || null,
      data.capabilities ? JSON.stringify(data.capabilities) : null,
      ts,
      ts,
      data.lastError ? JSON.stringify(data.lastError) : null,
      ts,
      id
    );
  } else {
    db.prepare(
      `INSERT INTO communication_channels (
        id, channel, provider, status, capabilities_json,
        external_channel_id, transport, display_name, plain_id, state,
        last_checked_at, last_synced_at, last_error_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      data.channel || data.transport || "unknown",
      data.provider || "wazzup",
      data.status || data.state || "unknown",
      JSON.stringify(data.capabilities || {}),
      data.externalChannelId || null,
      data.transport || null,
      data.displayName || null,
      data.plainId || null,
      data.state || null,
      ts,
      ts,
      data.lastError ? JSON.stringify(data.lastError) : null,
      ts,
      ts
    );
  }
  return mapChannel(db.prepare("SELECT * FROM communication_channels WHERE id = ?").get(id));
}

export function listHubChannels({ provider } = {}) {
  const db = getDatabase();
  const rows = provider
    ? db
        .prepare("SELECT * FROM communication_channels WHERE provider = ? ORDER BY display_name, channel")
        .all(provider)
    : db.prepare("SELECT * FROM communication_channels ORDER BY display_name, channel").all();
  return rows.map(mapChannel);
}

export function getHubChannel(id) {
  return mapChannel(
    getDatabase().prepare("SELECT * FROM communication_channels WHERE id = ?").get(id)
  );
}

export function getIdentity(id) {
  return mapIdentity(
    getDatabase().prepare("SELECT * FROM communication_identities WHERE id = ?").get(id)
  );
}

export function findIdentityByChat(provider, chatId) {
  return mapIdentity(
    getDatabase()
      .prepare(
        `SELECT * FROM communication_identities
         WHERE provider = ? AND external_chat_id = ? LIMIT 1`
      )
      .get(provider, String(chatId))
  );
}

export function findIdentitiesByPhone(phone) {
  return getDatabase()
    .prepare(
      `SELECT * FROM communication_identities WHERE phone_normalized = ?`
    )
    .all(phone)
    .map(mapIdentity);
}

export function findIdentitiesByUsername(provider, username) {
  return getDatabase()
    .prepare(
      `SELECT * FROM communication_identities WHERE provider = ? AND lower(username) = lower(?)`
    )
    .all(provider, username)
    .map(mapIdentity);
}

export function listIdentitiesByContact(contactId) {
  if (!contactId) return [];
  return getDatabase()
    .prepare(
      `SELECT * FROM communication_identities WHERE contact_id = ? ORDER BY updated_at DESC`
    )
    .all(String(contactId))
    .map(mapIdentity);
}

export function upsertIdentity(data) {
  const db = getDatabase();
  const ts = now();
  let existing = null;
  if (data.id) existing = db.prepare("SELECT * FROM communication_identities WHERE id = ?").get(data.id);
  if (!existing && data.externalChatId) {
    existing = db
      .prepare(
        `SELECT * FROM communication_identities WHERE provider = ? AND external_chat_id = ?`
      )
      .get(data.provider, String(data.externalChatId));
  }
  if (existing) {
    db.prepare(
      `UPDATE communication_identities SET
        contact_id = COALESCE(?, contact_id),
        transport = COALESCE(?, transport),
        chat_type = COALESCE(?, chat_type),
        username = COALESCE(?, username),
        phone_normalized = COALESCE(?, phone_normalized),
        source = COALESCE(?, source),
        verified = COALESCE(?, verified),
        resolution_status = COALESCE(?, resolution_status),
        metadata_json = COALESCE(?, metadata_json),
        updated_at = ?
       WHERE id = ?`
    ).run(
      data.contactId !== undefined ? data.contactId : null,
      data.transport || null,
      data.chatType || null,
      data.username || null,
      data.phoneNormalized || null,
      data.source || null,
      data.verified != null ? (data.verified ? 1 : 0) : null,
      data.resolutionStatus || null,
      data.metadata ? JSON.stringify(data.metadata) : null,
      ts,
      existing.id
    );
    return getIdentity(existing.id);
  }
  const id = uid();
  db.prepare(
    `INSERT INTO communication_identities (
      id, contact_id, provider, transport, chat_type, external_chat_id,
      username, phone_normalized, source, verified, resolution_status,
      metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.contactId || null,
    data.provider,
    data.transport || null,
    data.chatType || null,
    data.externalChatId || null,
    data.username || null,
    data.phoneNormalized || null,
    data.source || "manual",
    data.verified ? 1 : 0,
    data.resolutionStatus || "resolved",
    JSON.stringify(data.metadata || {}),
    ts,
    ts
  );
  return getIdentity(id);
}

export function updateIdentity(id, patch) {
  return upsertIdentity({ id, ...patch });
}

export function upsertThread(data) {
  const db = getDatabase();
  const ts = now();
  let existing = null;
  if (data.id) existing = db.prepare("SELECT * FROM communication_threads WHERE id = ?").get(data.id);
  if (!existing && data.externalChatId) {
    existing = db
      .prepare(
        `SELECT * FROM communication_threads WHERE provider = ? AND external_chat_id = ?`
      )
      .get(data.provider, String(data.externalChatId));
  }
  if (existing) {
    db.prepare(
      `UPDATE communication_threads SET
        contact_id = COALESCE(?, contact_id),
        entity_type = COALESCE(?, entity_type),
        entity_id = COALESCE(?, entity_id),
        channel_id = COALESCE(?, channel_id),
        transport = COALESCE(?, transport),
        chat_type = COALESCE(?, chat_type),
        identity_id = COALESCE(?, identity_id),
        last_inbound_at = COALESCE(?, last_inbound_at),
        last_outbound_at = COALESCE(?, last_outbound_at),
        unanswered = COALESCE(?, unanswered),
        last_message_preview = COALESCE(?, last_message_preview),
        last_synced_at = ?,
        updated_at = ?
       WHERE id = ?`
    ).run(
      data.contactId ?? null,
      data.entityType ?? null,
      data.entityId ?? null,
      data.channelId ?? null,
      data.transport ?? null,
      data.chatType ?? null,
      data.identityId ?? null,
      data.lastInboundAt ?? null,
      data.lastOutboundAt ?? null,
      data.unanswered != null ? (data.unanswered ? 1 : 0) : null,
      data.lastMessagePreview ?? null,
      ts,
      ts,
      existing.id
    );
    return mapThread(db.prepare("SELECT * FROM communication_threads WHERE id = ?").get(existing.id));
  }
  const id = uid();
  db.prepare(
    `INSERT INTO communication_threads (
      id, contact_id, entity_type, entity_id, provider, channel_id, transport, chat_type,
      external_chat_id, identity_id, last_inbound_at, last_outbound_at, unanswered,
      last_message_preview, last_synced_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.contactId || null,
    data.entityType || null,
    data.entityId || null,
    data.provider,
    data.channelId || null,
    data.transport || null,
    data.chatType || null,
    data.externalChatId || null,
    data.identityId || null,
    data.lastInboundAt || null,
    data.lastOutboundAt || null,
    data.unanswered ? 1 : 0,
    data.lastMessagePreview || null,
    ts,
    ts,
    ts
  );
  return mapThread(db.prepare("SELECT * FROM communication_threads WHERE id = ?").get(id));
}

export function listThreads({ unanswered, contactId, limit = 50, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (unanswered != null) {
    clauses.push("unanswered = ?");
    params.push(unanswered ? 1 : 0);
  }
  if (contactId) {
    clauses.push("contact_id = ?");
    params.push(String(contactId));
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit, offset);
  return getDatabase()
    .prepare(
      `SELECT * FROM communication_threads ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params)
    .map(mapThread);
}

export function getThread(id) {
  return mapThread(getDatabase().prepare("SELECT * FROM communication_threads WHERE id = ?").get(id));
}

export function insertMessage(data) {
  const db = getDatabase();
  const ts = now();
  const id = data.id || uid();
  const text = data.textSafe != null ? String(data.textSafe).slice(0, 4000) : null;
  const textHash = text
    ? crypto.createHash("sha256").update(text).digest("hex")
    : null;
  try {
    db.prepare(
      `INSERT INTO communication_messages (
        id, thread_id, provider, external_message_id, direction, status, transport, chat_type,
        channel_id, contact_id, text_safe, text_hash, template_id, campaign_id,
        sequence_enrollment_id, outbox_id, operation_id, reply_to_external_id, crm_message_id,
        error_code, error_safe, sent_at, delivered_at, read_at, provider_timestamp, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      data.threadId || null,
      data.provider,
      data.externalMessageId || null,
      data.direction,
      data.status,
      data.transport || null,
      data.chatType || null,
      data.channelId || null,
      data.contactId || null,
      text,
      textHash,
      data.templateId || null,
      data.campaignId || null,
      data.sequenceEnrollmentId || null,
      data.outboxId || null,
      data.operationId || null,
      data.replyToExternalId || null,
      data.crmMessageId || null,
      data.errorCode || null,
      data.errorSafe || null,
      data.sentAt || null,
      data.deliveredAt || null,
      data.readAt || null,
      data.providerTimestamp || null,
      ts,
      ts
    );
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      if (data.externalMessageId) {
        return mapMessage(
          db
            .prepare(
              `SELECT * FROM communication_messages WHERE provider = ? AND external_message_id = ?`
            )
            .get(data.provider, data.externalMessageId)
        );
      }
      throw error;
    }
    throw error;
  }
  return mapMessage(db.prepare("SELECT * FROM communication_messages WHERE id = ?").get(id));
}

export function updateMessageStatus(provider, externalMessageId, status, extra = {}) {
  const db = getDatabase();
  const ts = now();
  const row = db
    .prepare(
      `SELECT * FROM communication_messages WHERE provider = ? AND external_message_id = ?`
    )
    .get(provider, externalMessageId);
  if (!row) return null;
  const deliveredAt = status === "delivered" ? extra.timestamp || ts : row.delivered_at;
  const readAt = status === "read" ? extra.timestamp || ts : row.read_at;
  const sentAt = status === "sent" ? extra.timestamp || ts : row.sent_at;
  db.prepare(
    `UPDATE communication_messages SET
      status = ?, delivered_at = ?, read_at = ?, sent_at = ?,
      error_code = COALESCE(?, error_code), error_safe = COALESCE(?, error_safe), updated_at = ?
     WHERE id = ?`
  ).run(
    status,
    deliveredAt,
    readAt,
    sentAt,
    extra.errorCode || null,
    extra.errorSafe || null,
    ts,
    row.id
  );
  return mapMessage(db.prepare("SELECT * FROM communication_messages WHERE id = ?").get(row.id));
}

export function listMessages({ threadId, contactId, limit = 50 } = {}) {
  if (threadId) {
    return getDatabase()
      .prepare(
        `SELECT * FROM communication_messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(threadId, limit)
      .map(mapMessage)
      .reverse();
  }
  if (contactId) {
    return getDatabase()
      .prepare(
        `SELECT * FROM communication_messages WHERE contact_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(String(contactId), limit)
      .map(mapMessage)
      .reverse();
  }
  return [];
}

export function countMessagesForContactToday(contactId) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS c FROM communication_messages
       WHERE contact_id = ? AND direction IN ('outbound','outbound_echo')
         AND created_at >= ?
         AND status IN ('sent','accepted','delivered','read')`
    )
    .get(String(contactId), start.toISOString());
  return row?.c || 0;
}

export function insertWebhookEvent(data) {
  const db = getDatabase();
  const id = uid();
  try {
    db.prepare(
      `INSERT INTO communication_webhook_events (
        id, provider, event_hash, event_type, processing_status,
        external_message_id, payload_redacted_json, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      data.provider,
      data.eventHash,
      data.eventType,
      data.processingStatus || "received",
      data.externalMessageId || null,
      data.payloadRedacted ? JSON.stringify(data.payloadRedacted) : null,
      now()
    );
    return { id, duplicate: false };
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return { id: null, duplicate: true };
    }
    throw error;
  }
}

export function markWebhookProcessed(id, status = "processed", errorSafe = null) {
  getDatabase()
    .prepare(
      `UPDATE communication_webhook_events SET processing_status = ?, error_safe = ?, processed_at = ? WHERE id = ?`
    )
    .run(status, errorSafe, now(), id);
}

export function findActiveSuppression(contactId, { phone, channel } = {}) {
  const db = getDatabase();
  if (contactId) {
    const row = channel
      ? db
          .prepare(
            `SELECT * FROM communication_suppressions
             WHERE contact_id = ? AND active = 1
               AND (channel IS NULL OR channel = ?)
             ORDER BY created_at DESC LIMIT 1`
          )
          .get(String(contactId), channel)
      : db
          .prepare(
            `SELECT * FROM communication_suppressions
             WHERE contact_id = ? AND active = 1
             ORDER BY created_at DESC LIMIT 1`
          )
          .get(String(contactId));
    if (row) return mapSuppression(row);
  }
  if (phone) {
    const row = db
      .prepare(
        `SELECT * FROM communication_suppressions
         WHERE phone_normalized = ? AND active = 1 LIMIT 1`
      )
      .get(phone);
    if (row) return mapSuppression(row);
  }
  return null;
}

function mapSuppression(row) {
  if (!row) return null;
  return {
    id: row.id,
    contactId: row.contact_id,
    phoneNormalized: row.phone_normalized,
    channel: row.channel,
    transport: row.transport,
    reason: row.reason,
    source: row.source,
    messageHash: row.message_hash,
    active: Boolean(row.active),
    createdAt: row.created_at,
    liftedAt: row.lifted_at,
  };
}

export function createSuppression(data) {
  const id = uid();
  const ts = now();
  getDatabase()
    .prepare(
      `INSERT INTO communication_suppressions (
        id, contact_id, phone_normalized, channel, transport, reason, source,
        message_hash, active, created_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      id,
      data.contactId || null,
      data.phoneNormalized || null,
      data.channel || null,
      data.transport || null,
      data.reason,
      data.source,
      data.messageHash || null,
      data.createdByUserId || null,
      ts
    );
  return mapSuppression(
    getDatabase().prepare("SELECT * FROM communication_suppressions WHERE id = ?").get(id)
  );
}

export function listSuppressions({ limit = 100, activeOnly = true } = {}) {
  const rows = activeOnly
    ? getDatabase()
        .prepare(
          `SELECT * FROM communication_suppressions WHERE active = 1
           ORDER BY created_at DESC LIMIT ?`
        )
        .all(Number(limit) || 100)
    : getDatabase()
        .prepare(`SELECT * FROM communication_suppressions ORDER BY created_at DESC LIMIT ?`)
        .all(Number(limit) || 100);
  return rows.map(mapSuppression);
}

export function createConsent(data) {
  const id = uid();
  const ts = now();
  getDatabase()
    .prepare(
      `INSERT INTO communication_consents (
        id, contact_id, channel, transport, ground, source, notes_safe, active, created_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      id,
      String(data.contactId),
      data.channel || null,
      data.transport || null,
      data.ground,
      data.source,
      data.notesSafe || null,
      data.createdByUserId || null,
      ts
    );
  return id;
}

export function findActiveConsent(contactId, channel) {
  return getDatabase()
    .prepare(
      `SELECT * FROM communication_consents
       WHERE contact_id = ? AND active = 1
         AND (channel IS NULL OR channel = ?)
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(String(contactId), channel || null);
}

export function getFieldMapping(key) {
  const row = getDatabase()
    .prepare(`SELECT * FROM communication_field_mappings WHERE mapping_key = ?`)
    .get(key);
  if (!row) return null;
  return {
    id: row.id,
    mappingKey: row.mapping_key,
    bitrixField: row.bitrix_field,
    bitrixEnumValues: parseJson(row.bitrix_enum_values_json, []),
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

export function upsertFieldMapping(key, data) {
  const db = getDatabase();
  const existing = db
    .prepare(`SELECT id FROM communication_field_mappings WHERE mapping_key = ?`)
    .get(key);
  const ts = now();
  if (existing) {
    db.prepare(
      `UPDATE communication_field_mappings SET bitrix_field = ?, bitrix_enum_values_json = ?, notes = ?, updated_at = ? WHERE id = ?`
    ).run(
      data.bitrixField || null,
      JSON.stringify(data.bitrixEnumValues || []),
      data.notes || null,
      ts,
      existing.id
    );
    return getFieldMapping(key);
  }
  const id = uid();
  db.prepare(
    `INSERT INTO communication_field_mappings (id, mapping_key, bitrix_field, bitrix_enum_values_json, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    key,
    data.bitrixField || null,
    JSON.stringify(data.bitrixEnumValues || []),
    data.notes || null,
    ts
  );
  return getFieldMapping(key);
}

export function createOutboxJob(data) {
  const db = getDatabase();
  const ts = now();
  const id = uid();
  const cfgMax = data.maxAttempts || 5;
  try {
    db.prepare(
      `INSERT INTO communication_outbox (
        id, idempotency_key, provider, channel_id, transport, chat_type, external_chat_id,
        contact_id, thread_id, campaign_id, campaign_recipient_id, sequence_enrollment_id,
        sequence_step_number, template_id, body, template_values_json, waba_template_id,
        crm_message_id, payload_json, status, dry_run, attempts, max_attempts,
        next_attempt_at, operation_id, plan_hash, scheduled_at,
        certification_id, account_fingerprint, channel_fingerprint, recipient_snapshot_hash,
        policy_version, template_version, body_hash,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      data.idempotencyKey,
      data.provider || "wazzup",
      data.channelId || null,
      data.transport || null,
      data.chatType || null,
      data.externalChatId || null,
      data.contactId || null,
      data.threadId || null,
      data.campaignId || null,
      data.campaignRecipientId || null,
      data.sequenceEnrollmentId || null,
      data.sequenceStepNumber ?? null,
      data.templateId || null,
      data.body || null,
      data.templateValues ? JSON.stringify(data.templateValues) : null,
      data.wabaTemplateId || null,
      data.crmMessageId || id,
      JSON.stringify(data.payload || {}),
      data.status || "pending",
      data.dryRun ? 1 : 0,
      cfgMax,
      data.nextAttemptAt || data.scheduledAt || ts,
      data.operationId || null,
      data.planHash || null,
      data.scheduledAt || ts,
      data.certificationId || null,
      data.accountFingerprint || null,
      data.channelFingerprint || null,
      data.recipientSnapshotHash || null,
      data.policyVersion || null,
      data.templateVersion || null,
      data.bodyHash || null,
      ts,
      ts
    );
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return getOutboxByIdempotencyKey(data.idempotencyKey);
    }
    throw error;
  }
  return mapOutbox(db.prepare("SELECT * FROM communication_outbox WHERE id = ?").get(id));
}

export function getOutboxByIdempotencyKey(key) {
  return mapOutbox(
    getDatabase().prepare(`SELECT * FROM communication_outbox WHERE idempotency_key = ?`).get(key)
  );
}

export function getOutbox(id) {
  return mapOutbox(getDatabase().prepare(`SELECT * FROM communication_outbox WHERE id = ?`).get(id));
}

/**
 * Atomically claim outbox jobs for a worker.
 */
export function claimOutboxJobs({ workerId, limit = 10, lockTtlSeconds = 120 }) {
  const db = getDatabase();
  const ts = now();
  const lockExpires = new Date(Date.now() + lockTtlSeconds * 1000).toISOString();
  const claimed = [];

  const tx = db.transaction(() => {
    const candidates = db
      .prepare(
        `SELECT id FROM communication_outbox
         WHERE status IN ('pending', 'retry')
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           AND (lock_expires_at IS NULL OR lock_expires_at < ?)
         ORDER BY next_attempt_at ASC
         LIMIT ?`
      )
      .all(ts, ts, limit);

    const update = db.prepare(
      `UPDATE communication_outbox SET
        status = 'processing', locked_by = ?, locked_at = ?, lock_expires_at = ?,
        attempts = attempts + 1, updated_at = ?
       WHERE id = ? AND (lock_expires_at IS NULL OR lock_expires_at < ?) AND status IN ('pending','retry')`
    );

    for (const c of candidates) {
      const info = update.run(workerId, ts, lockExpires, ts, c.id, ts);
      if (info.changes > 0) {
        claimed.push(mapOutbox(db.prepare("SELECT * FROM communication_outbox WHERE id = ?").get(c.id)));
      }
    }
  });
  tx();
  return claimed;
}

export function completeOutboxJob(id, patch) {
  const ts = now();
  getDatabase()
    .prepare(
      `UPDATE communication_outbox SET
        status = ?, provider_message_id = COALESCE(?, provider_message_id),
        sent_at = COALESCE(?, sent_at), last_error_code = ?, last_error_safe = ?,
        locked_by = NULL, locked_at = NULL, lock_expires_at = NULL, updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.status,
      patch.providerMessageId || null,
      patch.sentAt || (["sent", "accepted", "dry_run"].includes(patch.status) ? ts : null),
      patch.lastErrorCode || null,
      patch.lastErrorSafe || null,
      ts,
      id
    );
  return getOutbox(id);
}

export function failOutboxJob(id, { errorCode, errorSafe, retryable, retryAfterSeconds, maxAttempts }) {
  const row = getOutbox(id);
  if (!row) return null;
  const attempts = row.attempts;
  const max = maxAttempts || row.maxAttempts || 5;
  let status = "failed";
  let nextAttemptAt = null;
  if (retryable && attempts < max) {
    status = "retry";
    const backoff = retryAfterSeconds
      ? retryAfterSeconds * 1000
      : Math.min(3600_000, 1000 * Math.pow(2, attempts));
    nextAttemptAt = new Date(Date.now() + backoff).toISOString();
  } else if (retryable && attempts >= max) {
    status = "dead_letter";
  }
  const ts = now();
  getDatabase()
    .prepare(
      `UPDATE communication_outbox SET
        status = ?, next_attempt_at = ?, last_error_code = ?, last_error_safe = ?,
        locked_by = NULL, locked_at = NULL, lock_expires_at = NULL, updated_at = ?
       WHERE id = ?`
    )
    .run(status, nextAttemptAt, errorCode || null, errorSafe || null, ts, id);
  return getOutbox(id);
}

export function cancelOutboxForCampaign(campaignId) {
  const ts = now();
  return getDatabase()
    .prepare(
      `UPDATE communication_outbox SET status = 'cancelled', updated_at = ?
       WHERE campaign_id = ? AND status IN ('pending','retry')`
    )
    .run(ts, campaignId).changes;
}

export function cancelOutboxForEnrollment(enrollmentId) {
  const ts = now();
  return getDatabase()
    .prepare(
      `UPDATE communication_outbox SET status = 'cancelled', updated_at = ?
       WHERE sequence_enrollment_id = ? AND status IN ('pending','retry')`
    )
    .run(ts, enrollmentId).changes;
}

export function countOutboxByStatus() {
  const rows = getDatabase()
    .prepare(`SELECT status, COUNT(*) AS c FROM communication_outbox GROUP BY status`)
    .all();
  const out = {};
  for (const r of rows) out[r.status] = r.c;
  return out;
}

// Templates
export function createTemplate(data) {
  const id = uid();
  const ts = now();
  getDatabase()
    .prepare(
      `INSERT INTO communication_templates (
        id, name, purpose, channel, category, language, body, allowed_vars_json,
        status, version, waba_template_id, constraints_json, created_by_user_id, updated_by_user_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      data.name,
      data.purpose || null,
      data.channel,
      data.category,
      data.language || "ru",
      data.body,
      JSON.stringify(data.allowedVars || []),
      data.status || "draft",
      data.wabaTemplateId || null,
      JSON.stringify(data.constraints || {}),
      data.createdByUserId || null,
      data.updatedByUserId || null,
      ts,
      ts
    );
  return getTemplate(id);
}

export function getTemplate(id) {
  const row = getDatabase().prepare(`SELECT * FROM communication_templates WHERE id = ?`).get(id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    channel: row.channel,
    category: row.category,
    language: row.language,
    body: row.body,
    allowedVars: parseJson(row.allowed_vars_json, []),
    status: row.status,
    version: row.version,
    wabaTemplateId: row.waba_template_id,
    constraints: parseJson(row.constraints_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTemplates({ status, category } = {}) {
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  if (category) {
    clauses.push("category = ?");
    params.push(category);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return getDatabase()
    .prepare(`SELECT id FROM communication_templates ${where} ORDER BY updated_at DESC`)
    .all(...params)
    .map((r) => getTemplate(r.id));
}

export function updateTemplate(id, patch) {
  const cur = getTemplate(id);
  if (!cur) return null;
  const ts = now();
  getDatabase()
    .prepare(
      `UPDATE communication_templates SET
        name = ?, purpose = ?, channel = ?, category = ?, language = ?, body = ?,
        allowed_vars_json = ?, status = ?, version = version + 1,
        waba_template_id = ?, constraints_json = ?, updated_by_user_id = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.name ?? cur.name,
      patch.purpose ?? cur.purpose,
      patch.channel ?? cur.channel,
      patch.category ?? cur.category,
      patch.language ?? cur.language,
      patch.body ?? cur.body,
      JSON.stringify(patch.allowedVars ?? cur.allowedVars),
      patch.status ?? cur.status,
      patch.wabaTemplateId ?? cur.wabaTemplateId,
      JSON.stringify(patch.constraints ?? cur.constraints),
      patch.updatedByUserId || null,
      ts,
      id
    );
  return getTemplate(id);
}

/** Soft-delete: archive template (no hard delete — retain audit trail). */
export function deleteTemplate(id) {
  const cur = getTemplate(id);
  if (!cur) return null;
  return updateTemplate(id, { status: "archived" });
}

// Campaigns
export function createCampaign(data) {
  const id = uid();
  const ts = now();
  getDatabase()
    .prepare(
      `INSERT INTO communication_campaigns (
        id, name, status, channel, template_id, segment_json, schedule_json,
        dry_run, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      data.name,
      data.channel || null,
      data.templateId || null,
      JSON.stringify(data.segment || {}),
      JSON.stringify(data.schedule || {}),
      data.dryRun != null ? (data.dryRun ? 1 : 0) : 1,
      data.createdByUserId || null,
      ts,
      ts
    );
  return getCampaign(id);
}

export function getCampaign(id) {
  const row = getDatabase().prepare(`SELECT * FROM communication_campaigns WHERE id = ?`).get(id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    channel: row.channel,
    templateId: row.template_id,
    segment: parseJson(row.segment_json, {}),
    schedule: parseJson(row.schedule_json, {}),
    plan: parseJson(row.plan_json, null),
    planHash: row.plan_hash,
    confirmedRecipientCount: row.confirmed_recipient_count,
    confirmationPhrase: row.confirmation_phrase,
    dryRun: Boolean(row.dry_run),
    stats: parseJson(row.stats_json, {}),
    createdByUserId: row.created_by_user_id,
    confirmedByUserId: row.confirmed_by_user_id,
    confirmedAt: row.confirmed_at,
    startedAt: row.started_at,
    pausedAt: row.paused_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function updateCampaign(id, patch) {
  const cur = getCampaign(id);
  if (!cur) return null;
  const ts = now();
  getDatabase()
    .prepare(
      `UPDATE communication_campaigns SET
        name = ?, status = ?, channel = ?, template_id = ?, segment_json = ?, schedule_json = ?,
        plan_json = ?, plan_hash = ?, confirmed_recipient_count = ?, confirmation_phrase = ?,
        dry_run = ?, stats_json = ?, confirmed_by_user_id = COALESCE(?, confirmed_by_user_id),
        confirmed_at = COALESCE(?, confirmed_at), started_at = COALESCE(?, started_at),
        paused_at = COALESCE(?, paused_at), completed_at = COALESCE(?, completed_at),
        cancelled_at = COALESCE(?, cancelled_at), updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.name ?? cur.name,
      patch.status ?? cur.status,
      patch.channel ?? cur.channel,
      patch.templateId ?? cur.templateId,
      JSON.stringify(patch.segment ?? cur.segment),
      JSON.stringify(patch.schedule ?? cur.schedule),
      patch.plan !== undefined ? JSON.stringify(patch.plan) : cur.plan ? JSON.stringify(cur.plan) : null,
      patch.planHash ?? cur.planHash,
      patch.confirmedRecipientCount ?? cur.confirmedRecipientCount,
      patch.confirmationPhrase ?? cur.confirmationPhrase,
      patch.dryRun != null ? (patch.dryRun ? 1 : 0) : cur.dryRun ? 1 : 0,
      JSON.stringify(patch.stats ?? cur.stats),
      patch.confirmedByUserId || null,
      patch.confirmedAt || null,
      patch.startedAt || null,
      patch.pausedAt || null,
      patch.completedAt || null,
      patch.cancelledAt || null,
      ts,
      id
    );
  return getCampaign(id);
}

export function listCampaigns({ status, limit = 50 } = {}) {
  const rows = status
    ? getDatabase()
        .prepare(`SELECT id FROM communication_campaigns WHERE status = ? ORDER BY updated_at DESC LIMIT ?`)
        .all(status, limit)
    : getDatabase()
        .prepare(`SELECT id FROM communication_campaigns ORDER BY updated_at DESC LIMIT ?`)
        .all(limit);
  return rows.map((r) => getCampaign(r.id));
}

export function upsertCampaignRecipient(data) {
  const db = getDatabase();
  const ts = now();
  const existing = db
    .prepare(
      `SELECT id FROM communication_campaign_recipients
       WHERE campaign_id = ? AND recipient_key = ? AND step_number = ?`
    )
    .get(data.campaignId, data.recipientKey, data.stepNumber || 1);
  if (existing) {
    db.prepare(
      `UPDATE communication_campaign_recipients SET
        contact_id = ?, channel = ?, transport = ?, identity_id = ?, rendered_body = ?,
        scheduled_at = ?, exclusion_code = ?, exclusion_message = ?, status = ?, outbox_id = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      data.contactId,
      data.channel || null,
      data.transport || null,
      data.identityId || null,
      data.renderedBody || null,
      data.scheduledAt || null,
      data.exclusionCode || null,
      data.exclusionMessage || null,
      data.status || "pending",
      data.outboxId || null,
      ts,
      existing.id
    );
    return existing.id;
  }
  const id = uid();
  db.prepare(
    `INSERT INTO communication_campaign_recipients (
      id, campaign_id, contact_id, recipient_key, step_number, channel, transport,
      identity_id, rendered_body, scheduled_at, exclusion_code, exclusion_message, status, outbox_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.campaignId,
    data.contactId,
    data.recipientKey,
    data.stepNumber || 1,
    data.channel || null,
    data.transport || null,
    data.identityId || null,
    data.renderedBody || null,
    data.scheduledAt || null,
    data.exclusionCode || null,
    data.exclusionMessage || null,
    data.status || "pending",
    data.outboxId || null,
    ts,
    ts
  );
  return id;
}

export function listCampaignRecipients(campaignId, { excluded = null, limit = 500 } = {}) {
  let sql = `SELECT * FROM communication_campaign_recipients WHERE campaign_id = ?`;
  const params = [campaignId];
  if (excluded === true) sql += ` AND exclusion_code IS NOT NULL`;
  if (excluded === false) sql += ` AND exclusion_code IS NULL`;
  sql += ` ORDER BY created_at ASC LIMIT ?`;
  params.push(limit);
  return getDatabase()
    .prepare(sql)
    .all(...params)
    .map((row) => ({
      id: row.id,
      campaignId: row.campaign_id,
      contactId: row.contact_id,
      recipientKey: row.recipient_key,
      stepNumber: row.step_number,
      channel: row.channel,
      transport: row.transport,
      identityId: row.identity_id,
      renderedBody: row.rendered_body,
      scheduledAt: row.scheduled_at,
      exclusionCode: row.exclusion_code,
      exclusionMessage: row.exclusion_message,
      status: row.status,
      outboxId: row.outbox_id,
    }));
}

// Sequences
export function createSequence(data) {
  const id = uid();
  const ts = now();
  getDatabase()
    .prepare(
      `INSERT INTO communication_sequences (
        id, name, status, target_crm_status, enroll_conditions_json, stop_conditions_json,
        completion_action_json, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      data.name,
      data.targetCrmStatus || null,
      JSON.stringify(data.enrollConditions || {}),
      JSON.stringify(data.stopConditions || {}),
      JSON.stringify(data.completionAction || {}),
      data.createdByUserId || null,
      ts,
      ts
    );
  return getSequence(id);
}

export function getSequence(id) {
  const row = getDatabase().prepare(`SELECT * FROM communication_sequences WHERE id = ?`).get(id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    targetCrmStatus: row.target_crm_status,
    enrollConditions: parseJson(row.enroll_conditions_json, {}),
    stopConditions: parseJson(row.stop_conditions_json, {}),
    completionAction: parseJson(row.completion_action_json, {}),
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    steps: listSequenceSteps(row.id),
  };
}

export function listSequences({ status } = {}) {
  const rows = status
    ? getDatabase()
        .prepare(`SELECT id FROM communication_sequences WHERE status = ? ORDER BY updated_at DESC`)
        .all(status)
    : getDatabase().prepare(`SELECT id FROM communication_sequences ORDER BY updated_at DESC`).all();
  return rows.map((r) => getSequence(r.id));
}

export function updateSequence(id, patch) {
  const cur = getSequence(id);
  if (!cur) return null;
  const ts = now();
  getDatabase()
    .prepare(
      `UPDATE communication_sequences SET
        name = ?, status = ?, target_crm_status = ?, enroll_conditions_json = ?,
        stop_conditions_json = ?, completion_action_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.name ?? cur.name,
      patch.status ?? cur.status,
      patch.targetCrmStatus ?? cur.targetCrmStatus,
      JSON.stringify(patch.enrollConditions ?? cur.enrollConditions),
      JSON.stringify(patch.stopConditions ?? cur.stopConditions),
      JSON.stringify(patch.completionAction ?? cur.completionAction),
      ts,
      id
    );
  return getSequence(id);
}

export function replaceSequenceSteps(sequenceId, steps = []) {
  const db = getDatabase();
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM communication_sequence_steps WHERE sequence_id = ?`).run(sequenceId);
    const insert = db.prepare(
      `INSERT INTO communication_sequence_steps (
        id, sequence_id, step_number, delay_value, delay_unit, business_days,
        channel, template_id, send_window_json, conditions_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    steps.forEach((s, i) => {
      insert.run(
        uid(),
        sequenceId,
        s.stepNumber ?? i + 1,
        s.delayValue ?? 0,
        s.delayUnit || "days",
        s.businessDays != null ? (s.businessDays ? 1 : 0) : 1,
        s.channel,
        s.templateId || null,
        JSON.stringify(s.sendWindow || {}),
        JSON.stringify(s.conditions || {}),
        ts,
        ts
      );
    });
  });
  tx();
  return listSequenceSteps(sequenceId);
}

export function listSequenceSteps(sequenceId) {
  return getDatabase()
    .prepare(
      `SELECT * FROM communication_sequence_steps WHERE sequence_id = ? ORDER BY step_number ASC`
    )
    .all(sequenceId)
    .map((row) => ({
      id: row.id,
      sequenceId: row.sequence_id,
      stepNumber: row.step_number,
      delayValue: row.delay_value,
      delayUnit: row.delay_unit,
      businessDays: Boolean(row.business_days),
      channel: row.channel,
      templateId: row.template_id,
      sendWindow: parseJson(row.send_window_json, {}),
      conditions: parseJson(row.conditions_json, {}),
    }));
}

export function createEnrollment(data) {
  const id = uid();
  const ts = now();
  getDatabase()
    .prepare(
      `INSERT INTO communication_sequence_enrollments (
        id, sequence_id, contact_id, status, current_step, next_run_at,
        enrolled_by_user_id, enrolled_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      data.sequenceId,
      String(data.contactId),
      data.status || "pending",
      data.nextRunAt || ts,
      data.enrolledByUserId || null,
      ts,
      ts,
      ts
    );
  return getEnrollment(id);
}

export function getEnrollment(id) {
  const row = getDatabase()
    .prepare(`SELECT * FROM communication_sequence_enrollments WHERE id = ?`)
    .get(id);
  if (!row) return null;
  return {
    id: row.id,
    sequenceId: row.sequence_id,
    contactId: row.contact_id,
    status: row.status,
    currentStep: row.current_step,
    nextRunAt: row.next_run_at,
    stopReason: row.stop_reason,
    lastErrorSafe: row.last_error_safe,
    enrolledByUserId: row.enrolled_by_user_id,
    enrolledAt: row.enrolled_at,
    completedAt: row.completed_at,
    stoppedAt: row.stopped_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function updateEnrollment(id, patch) {
  const cur = getEnrollment(id);
  if (!cur) return null;
  const ts = now();
  getDatabase()
    .prepare(
      `UPDATE communication_sequence_enrollments SET
        status = ?, current_step = ?, next_run_at = ?, stop_reason = ?,
        last_error_safe = ?, completed_at = COALESCE(?, completed_at),
        stopped_at = COALESCE(?, stopped_at), updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.status ?? cur.status,
      patch.currentStep ?? cur.currentStep,
      patch.nextRunAt ?? cur.nextRunAt,
      patch.stopReason ?? cur.stopReason,
      patch.lastErrorSafe ?? cur.lastErrorSafe,
      patch.completedAt || null,
      patch.stoppedAt || null,
      ts,
      id
    );
  return getEnrollment(id);
}

export function listDueEnrollments(limit = 20) {
  const ts = now();
  return getDatabase()
    .prepare(
      `SELECT id FROM communication_sequence_enrollments
       WHERE status IN ('pending','active') AND (next_run_at IS NULL OR next_run_at <= ?)
       ORDER BY next_run_at ASC LIMIT ?`
    )
    .all(ts, limit)
    .map((r) => getEnrollment(r.id));
}

export function listActiveEnrollmentsForContact(contactId) {
  return getDatabase()
    .prepare(
      `SELECT id FROM communication_sequence_enrollments
       WHERE contact_id = ? AND status IN ('pending','active','paused')`
    )
    .all(String(contactId))
    .map((r) => getEnrollment(r.id));
}

export function stopEnrollmentsForContact(contactId, reason) {
  const enrollments = listActiveEnrollmentsForContact(contactId);
  const ts = now();
  for (const e of enrollments) {
    updateEnrollment(e.id, {
      status: reason,
      stopReason: reason,
      stoppedAt: ts,
    });
    cancelOutboxForEnrollment(e.id);
  }
  return enrollments.length;
}
