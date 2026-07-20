import crypto from "crypto";
import { getDatabase } from "../index.js";

function uid() {
  return crypto.randomUUID();
}

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function rowToOperation(row) {
  if (!row) return null;
  return {
    id: row.id,
    confirmationId: row.confirmation_id,
    action: row.action,
    accessType: row.access_type,
    riskLevel: row.risk_level,
    status: row.status,
    reversible: row.reversible,
    source: row.source,
    sessionId: row.session_id,
    chatId: row.chat_id || null,
    messageId: row.message_id != null ? row.message_id : null,
    projectId: row.project_id || null,
    params: parseJson(row.params_json, {}),
    preview: parseJson(row.preview_json, null),
    before: parseJson(row.before_json, null),
    after: parseJson(row.after_json, null),
    result: parseJson(row.result_json, null),
    error: parseJson(row.error_json, null),
    planHash: row.plan_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    initiatedByUserId: row.initiated_by_user_id || null,
    confirmedByUserId: row.confirmed_by_user_id || null,
    cancelledByUserId: row.cancelled_by_user_id || null,
    rolledBackByUserId: row.rolled_back_by_user_id || null,
    confirmedAt: row.confirmed_at,
    executedAt: row.executed_at,
    cancelledAt: row.cancelled_at,
    rolledBackAt: row.rolled_back_at,
  };
}

function rowToItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    operationId: row.operation_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    status: row.status,
    before: parseJson(row.before_json, null),
    after: parseJson(row.after_json, null),
    result: parseJson(row.result_json, null),
    error: parseJson(row.error_json, null),
    executedAt: row.executed_at,
    rolledBackAt: row.rolled_back_at,
  };
}

export function createOperation(data) {
  const db = getDatabase();
  const id = data.id || uid();
  const confirmationId = data.confirmationId || uid();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO operations (
      id, confirmation_id, action, access_type, risk_level, status, reversible,
      source, session_id, chat_id, message_id, project_id,
      params_json, preview_json, before_json, after_json,
      result_json, error_json, plan_hash, created_at, expires_at,
      initiated_by_user_id, confirmed_by_user_id, cancelled_by_user_id, rolled_back_by_user_id
    ) VALUES (
      @id, @confirmation_id, @action, @access_type, @risk_level, @status, @reversible,
      @source, @session_id, @chat_id, @message_id, @project_id,
      @params_json, @preview_json, @before_json, @after_json,
      @result_json, @error_json, @plan_hash, @created_at, @expires_at,
      @initiated_by_user_id, @confirmed_by_user_id, @cancelled_by_user_id, @rolled_back_by_user_id
    )`
  ).run({
    id,
    confirmation_id: confirmationId,
    action: data.action,
    access_type: data.accessType,
    risk_level: data.riskLevel,
    status: data.status || "pending_confirmation",
    reversible: String(data.reversible),
    source: data.source || null,
    session_id: data.sessionId || null,
    chat_id: data.chatId || null,
    message_id: data.messageId != null ? Number(data.messageId) : null,
    project_id: data.projectId || null,
    params_json: JSON.stringify(data.params ?? {}),
    preview_json: data.preview != null ? JSON.stringify(data.preview) : null,
    before_json: data.before != null ? JSON.stringify(data.before) : null,
    after_json: data.after != null ? JSON.stringify(data.after) : null,
    result_json: null,
    error_json: null,
    plan_hash: data.planHash,
    created_at: now,
    expires_at: data.expiresAt || null,
    initiated_by_user_id: data.initiatedByUserId || null,
    confirmed_by_user_id: data.confirmedByUserId || null,
    cancelled_by_user_id: data.cancelledByUserId || null,
    rolled_back_by_user_id: data.rolledBackByUserId || null,
  });

  if (Array.isArray(data.items)) {
    for (const item of data.items) {
      insertOperationItem({
        ...item,
        operationId: id,
        status: item.status || "pending",
      });
    }
  }

  addOperationEvent(id, "prepared", {
    action: data.action,
    affectedCount: data.items?.length || 0,
  });

  return getOperationById(id);
}

export function insertOperationItem(item) {
  const db = getDatabase();
  const id = item.id || uid();
  db.prepare(
    `INSERT INTO operation_items (
      id, operation_id, entity_type, entity_id, status,
      before_json, after_json, result_json, error_json, executed_at, rolled_back_at
    ) VALUES (
      @id, @operation_id, @entity_type, @entity_id, @status,
      @before_json, @after_json, @result_json, @error_json, @executed_at, @rolled_back_at
    )`
  ).run({
    id,
    operation_id: item.operationId,
    entity_type: item.entityType || null,
    entity_id: item.entityId != null ? String(item.entityId) : null,
    status: item.status || "pending",
    before_json: item.before != null ? JSON.stringify(item.before) : null,
    after_json: item.after != null ? JSON.stringify(item.after) : null,
    result_json: item.result != null ? JSON.stringify(item.result) : null,
    error_json: item.error != null ? JSON.stringify(item.error) : null,
    executed_at: item.executedAt || null,
    rolled_back_at: item.rolledBackAt || null,
  });
  return id;
}

export function addOperationEvent(operationId, eventType, payload = null) {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO operation_events (id, operation_id, event_type, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    uid(),
    operationId,
    eventType,
    payload != null ? JSON.stringify(payload) : null,
    new Date().toISOString()
  );
}

export function getOperationById(id) {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM operations WHERE id = ?").get(id);
  return rowToOperation(row);
}

export function getOperationByConfirmationId(confirmationId) {
  const db = getDatabase();
  const row = db
    .prepare("SELECT * FROM operations WHERE confirmation_id = ?")
    .get(confirmationId);
  return rowToOperation(row);
}

export function getOperationItems(operationId) {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM operation_items WHERE operation_id = ? ORDER BY rowid")
    .all(operationId)
    .map(rowToItem);
}

export function getOperationEvents(operationId) {
  const db = getDatabase();
  return db
    .prepare(
      "SELECT id, operation_id, event_type, payload_json, created_at FROM operation_events WHERE operation_id = ? ORDER BY created_at, rowid"
    )
    .all(operationId)
    .map((row) => ({
      id: row.id,
      operationId: row.operation_id,
      eventType: row.event_type,
      payload: parseJson(row.payload_json, null),
      createdAt: row.created_at,
    }));
}

export function updateOperation(id, patch) {
  const db = getDatabase();
  const current = getOperationById(id);
  if (!current) return null;

  const next = {
    status: patch.status ?? current.status,
    result_json:
      patch.result !== undefined
        ? JSON.stringify(patch.result)
        : current.result != null
          ? JSON.stringify(current.result)
          : null,
    error_json:
      patch.error !== undefined
        ? JSON.stringify(patch.error)
        : current.error != null
          ? JSON.stringify(current.error)
          : null,
    confirmed_at: patch.confirmedAt ?? current.confirmedAt,
    executed_at: patch.executedAt ?? current.executedAt,
    cancelled_at: patch.cancelledAt ?? current.cancelledAt,
    rolled_back_at: patch.rolledBackAt ?? current.rolledBackAt,
    preview_json:
      patch.preview !== undefined
        ? JSON.stringify(patch.preview)
        : current.preview != null
          ? JSON.stringify(current.preview)
          : null,
    before_json:
      patch.before !== undefined
        ? JSON.stringify(patch.before)
        : current.before != null
          ? JSON.stringify(current.before)
          : null,
    after_json:
      patch.after !== undefined
        ? JSON.stringify(patch.after)
        : current.after != null
          ? JSON.stringify(current.after)
          : null,
  };

  db.prepare(
    `UPDATE operations SET
      status = @status,
      result_json = @result_json,
      error_json = @error_json,
      confirmed_at = @confirmed_at,
      executed_at = @executed_at,
      cancelled_at = @cancelled_at,
      rolled_back_at = @rolled_back_at,
      preview_json = @preview_json,
      before_json = @before_json,
      after_json = @after_json,
      confirmed_by_user_id = COALESCE(@confirmed_by_user_id, confirmed_by_user_id),
      cancelled_by_user_id = COALESCE(@cancelled_by_user_id, cancelled_by_user_id),
      rolled_back_by_user_id = COALESCE(@rolled_back_by_user_id, rolled_back_by_user_id)
    WHERE id = @id`
  ).run({
    id,
    ...next,
    confirmed_by_user_id: patch.confirmedByUserId ?? null,
    cancelled_by_user_id: patch.cancelledByUserId ?? null,
    rolled_back_by_user_id: patch.rolledBackByUserId ?? null,
  });

  return getOperationById(id);
}

export function updateOperationItem(itemId, patch) {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM operation_items WHERE id = ?").get(itemId);
  if (!row) return null;

  const current = rowToItem(row);
  db.prepare(
    `UPDATE operation_items SET
      status = @status,
      result_json = @result_json,
      error_json = @error_json,
      executed_at = @executed_at,
      rolled_back_at = @rolled_back_at,
      after_json = @after_json
    WHERE id = @id`
  ).run({
    id: itemId,
    status: patch.status ?? current.status,
    result_json:
      patch.result !== undefined
        ? JSON.stringify(patch.result)
        : current.result != null
          ? JSON.stringify(current.result)
          : null,
    error_json:
      patch.error !== undefined
        ? JSON.stringify(patch.error)
        : current.error != null
          ? JSON.stringify(current.error)
          : null,
    executed_at: patch.executedAt ?? current.executedAt,
    rolled_back_at: patch.rolledBackAt ?? current.rolledBackAt,
    after_json:
      patch.after !== undefined
        ? JSON.stringify(patch.after)
        : current.after != null
          ? JSON.stringify(current.after)
          : null,
  });

  return true;
}

/**
 * Атомарный переход статуса (для идемпотентности commit).
 * @returns {boolean} true если статус обновлён
 */
export function transitionOperationStatus(id, fromStatuses, toStatus, patch = {}) {
  const db = getDatabase();
  const placeholders = fromStatuses.map(() => "?").join(",");
  const info = db
    .prepare(
      `UPDATE operations SET status = ?, confirmed_at = COALESCE(?, confirmed_at), executed_at = COALESCE(?, executed_at)
       WHERE id = ? AND status IN (${placeholders})`
    )
    .run(
      toStatus,
      patch.confirmedAt || null,
      patch.executedAt || null,
      id,
      ...fromStatuses
    );
  return info.changes > 0;
}

export function listOperations(filters = {}) {
  const db = getDatabase();
  const where = [];
  const args = [];

  if (filters.status) {
    where.push("status = ?");
    args.push(filters.status);
  }
  if (filters.action) {
    where.push("action = ?");
    args.push(filters.action);
  }
  if (filters.sessionId) {
    where.push("session_id = ?");
    args.push(filters.sessionId);
  }
  if (filters.source) {
    where.push("source = ?");
    args.push(filters.source);
  }
  if (filters.reversible != null && filters.reversible !== "") {
    where.push("reversible = ?");
    args.push(String(filters.reversible));
  }
  if (filters.dateFrom) {
    where.push("created_at >= ?");
    args.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    where.push("created_at <= ?");
    args.push(filters.dateTo);
  }

  const limit = Math.min(Number(filters.limit) || 100, 500);
  const sql = `
    SELECT * FROM operations
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC
    LIMIT ?
  `;
  args.push(limit);

  return db.prepare(sql).all(...args).map(rowToOperation);
}

/**
 * Краткое представление для UI (без сырых JSON).
 */
export function toPublicOperationSummary(op, items = []) {
  if (!op) return null;
  const preview = op.preview || {};
  return {
    id: op.id,
    confirmationId: op.confirmationId,
    action: op.action,
    title: preview.title || op.action,
    entity: preview.entity || null,
    status: op.status,
    statusLabel: statusLabelRu(op.status),
    accessType: op.accessType,
    riskLevel: op.riskLevel,
    reversible: op.reversible,
    source: op.source,
    sessionId: op.sessionId,
    chatId: op.chatId || null,
    messageId: op.messageId || null,
    projectId: op.projectId || null,
    initiatedByUserId: op.initiatedByUserId || null,
    confirmedByUserId: op.confirmedByUserId || null,
    affectedCount: items.length || preview.affectedCount || 0,
    createdAt: op.createdAt,
    expiresAt: op.expiresAt,
    executedAt: op.executedAt,
    rolledBackAt: op.rolledBackAt,
    rollbackAvailable: canOfferRollback(op),
    rollbackUnavailableReason: rollbackUnavailableReason(op),
    rollbackExpiresAt: preview.rollbackExpiresAt || null,
    error: op.error
      ? { code: op.error.code, message: op.error.message }
      : null,
  };
}

export function toPublicOperationDetail(op, items = [], events = []) {
  const summary = toPublicOperationSummary(op, items);
  if (!summary) return null;

  return {
    ...summary,
    preview: op.preview,
    changes: op.preview?.changes || [],
    before: sanitizeSnapshot(op.before),
    after: sanitizeSnapshot(op.after),
    items: items.map((item) => ({
      id: item.id,
      entityType: item.entityType,
      entityId: item.entityId,
      status: item.status,
      before: sanitizeSnapshot(item.before),
      after: sanitizeSnapshot(item.after),
      error: item.error ? { message: item.error.message || String(item.error) } : null,
    })),
    events: events.map((e) => ({
      eventType: e.eventType,
      createdAt: e.createdAt,
    })),
  };
}

function sanitizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const clone = JSON.parse(JSON.stringify(snapshot));
  // Уже должна быть redacted при записи; на всякий случай убираем типичные секреты.
  for (const key of Object.keys(clone)) {
    if (/PHONE|EMAIL|WEBHOOK|TOKEN|PASSWORD|SECRET|API_KEY/i.test(key)) {
      clone[key] = "[redacted]";
    }
  }
  return clone;
}

function statusLabelRu(status) {
  const map = {
    pending_confirmation: "Ожидает подтверждения",
    rollback_pending_confirmation: "Ожидает подтверждения отката",
    cancelled: "Отменено",
    executing: "Выполняется",
    completed: "Выполнено",
    partially_completed: "Выполнено частично",
    failed: "Ошибка",
    recovery_required: "Требуется восстановление",
    verification_required: "Требуется проверка результата",
    rollback_pending: "Откат доступен",
    rolling_back: "Выполняется откат",
    rolled_back: "Откат выполнен",
    rollback_conflict: "Конфликт отката",
    expired: "Истёк срок",
  };
  return map[status] || status;
}

function canOfferRollback(op) {
  if (!op) return false;
  if (!["completed", "partially_completed", "rollback_pending"].includes(op.status)) {
    return false;
  }
  if (op.reversible === "false" || op.reversible === false) return false;
  return true;
}

function rollbackUnavailableReason(op) {
  if (canOfferRollback(op)) return null;
  if (op.reversible === "false" || op.reversible === false) {
    return "Операция не поддерживает откат.";
  }
  if (op.status === "rolled_back") return "Откат уже выполнен.";
  if (op.status === "rollback_conflict") {
    return "Данные изменены после операции — автоматический откат остановлен.";
  }
  if (op.status === "pending_confirmation") {
    return "Операция ещё не выполнена.";
  }
  if (op.status === "cancelled") return "Операция отменена.";
  if (op.status === "failed") return "Исходная операция завершилась ошибкой.";
  return "Откат недоступен для текущего статуса.";
}
