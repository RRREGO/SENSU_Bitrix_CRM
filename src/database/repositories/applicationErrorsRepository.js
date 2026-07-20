import crypto from "crypto";
import { getDatabase } from "../index.js";
import { redactObject } from "../../safety/redact.js";
import { getReleaseMetadata } from "../../config/paths.js";

function uid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function mapError(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestId: row.request_id,
    source: row.source,
    errorCode: row.error_code,
    severity: row.severity,
    messageSafe: row.message_safe,
    details: row.details_json ? JSON.parse(row.details_json) : null,
    userId: row.user_id,
    operationId: row.operation_id,
    reportRunId: row.report_run_id,
    releaseId: row.release_id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
  };
}

export function recordApplicationError({
  requestId = null,
  source = "http",
  errorCode = "INTERNAL_ERROR",
  severity = "error",
  messageSafe,
  details = null,
  userId = null,
  operationId = null,
  reportRunId = null,
}) {
  const id = uid();
  const safeDetails = details ? redactObject(details) : null;
  getDatabase()
    .prepare(
      `INSERT INTO application_errors (
        id, request_id, source, error_code, severity, message_safe, details_json,
        user_id, operation_id, report_run_id, release_id, created_at, resolved_at, resolution_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
    )
    .run(
      id,
      requestId,
      source,
      errorCode,
      severity,
      String(messageSafe || "Ошибка").slice(0, 500),
      safeDetails ? JSON.stringify(safeDetails) : null,
      userId,
      operationId,
      reportRunId,
      getReleaseMetadata().releaseId,
      now()
    );
  return getApplicationErrorById(id);
}

export function getApplicationErrorById(id) {
  return mapError(getDatabase().prepare("SELECT * FROM application_errors WHERE id = ?").get(id));
}

export function listApplicationErrors({
  source,
  severity,
  unresolvedOnly = false,
  limit = 50,
} = {}) {
  const where = [];
  const args = [];
  if (source) {
    where.push("source = ?");
    args.push(source);
  }
  if (severity) {
    where.push("severity = ?");
    args.push(severity);
  }
  if (unresolvedOnly) where.push("resolved_at IS NULL");
  const sql = `SELECT * FROM application_errors ${
    where.length ? `WHERE ${where.join(" AND ")}` : ""
  } ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Number(limit) || 50, 200));
  return getDatabase().prepare(sql).all(...args).map(mapError);
}

export function resolveApplicationError(id, { note = null, userId = null } = {}) {
  getDatabase()
    .prepare(
      `UPDATE application_errors SET resolved_at = ?, resolution_note = ? WHERE id = ?`
    )
    .run(now(), note || (userId ? `resolved by ${userId}` : "resolved"), id);
  return getApplicationErrorById(id);
}
