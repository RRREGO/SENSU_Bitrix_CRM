import crypto from "crypto";
import { getDatabase } from "../index.js";

function uid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function mapRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    report: row.report_json ? JSON.parse(row.report_json) : null,
    summaryText: row.summary_text,
    warnings: row.warnings_json ? JSON.parse(row.warnings_json) : [],
    error: row.error_json ? JSON.parse(row.error_json) : null,
    durationMs: row.duration_ms,
    idempotencyKey: row.idempotency_key,
    retryOfRunId: row.retry_of_run_id || null,
    createdAt: row.created_at,
  };
}

export function getRunById(id) {
  return mapRun(getDatabase().prepare("SELECT * FROM report_runs WHERE id = ?").get(id));
}

export function getRunByIdempotencyKey(key) {
  return mapRun(
    getDatabase().prepare("SELECT * FROM report_runs WHERE idempotency_key = ?").get(key)
  );
}

export function listRunsForSchedule(scheduleId, { limit = 50 } = {}) {
  return getDatabase()
    .prepare(
      `SELECT * FROM report_runs WHERE schedule_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(scheduleId, Number(limit) || 50)
    .map(mapRun);
}

export function getLastSuccessfulRun(scheduleId) {
  return mapRun(
    getDatabase()
      .prepare(
        `SELECT * FROM report_runs
         WHERE schedule_id = ? AND status IN ('completed', 'partial')
         ORDER BY completed_at DESC LIMIT 1`
      )
      .get(scheduleId)
  );
}

export function listRunningRuns() {
  return getDatabase()
    .prepare(`SELECT * FROM report_runs WHERE status = 'running'`)
    .all()
    .map(mapRun);
}

/**
 * Create queued/running run. Returns existing if idempotency key hits.
 */
export function createRun({
  scheduleId,
  scheduledFor,
  idempotencyKey,
  status = "queued",
  retryOfRunId = null,
}) {
  const existing = getRunByIdempotencyKey(idempotencyKey);
  if (existing) return { run: existing, created: false };

  const id = uid();
  const ts = now();
  try {
    getDatabase()
      .prepare(
        `INSERT INTO report_runs (
          id, schedule_id, scheduled_for, started_at, completed_at, status,
          report_json, summary_text, warnings_json, error_json, duration_ms,
          idempotency_key, retry_of_run_id, created_at
        ) VALUES (?, ?, ?, NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`
      )
      .run(id, scheduleId, scheduledFor, status, idempotencyKey, retryOfRunId, ts);
  } catch (error) {
    if (/UNIQUE/i.test(error.message)) {
      return { run: getRunByIdempotencyKey(idempotencyKey), created: false };
    }
    throw error;
  }
  return { run: getRunById(id), created: true };
}

export function markRunRunning(id) {
  getDatabase()
    .prepare(`UPDATE report_runs SET status = 'running', started_at = ? WHERE id = ?`)
    .run(now(), id);
  return getRunById(id);
}

export function completeRun(id, { status, report, summaryText, warnings, error, durationMs }) {
  // Store compact report: strip huge nested manager lists if any
  let reportJson = null;
  if (report) {
    const compact = compactReportForStorage(report);
    reportJson = JSON.stringify(compact);
  }
  getDatabase()
    .prepare(
      `UPDATE report_runs SET
        status = ?, completed_at = ?, report_json = ?, summary_text = ?,
        warnings_json = ?, error_json = ?, duration_ms = ?
       WHERE id = ?`
    )
    .run(
      status,
      now(),
      reportJson,
      summaryText || null,
      warnings ? JSON.stringify(warnings) : null,
      error ? JSON.stringify(error) : null,
      durationMs ?? null,
      id
    );
  return getRunById(id);
}

function compactReportForStorage(report) {
  const copy = { ...report };
  // Drop obvious PII-bearing deep lists; keep counts
  if (copy.sections) {
    copy.sections = copy.sections.map((s) => {
      if (!s?.data) return s;
      const data = { ...s.data };
      delete data.PHONE;
      delete data.EMAIL;
      if (data.data && typeof data.data === "object") {
        // discipline full payload — keep summary only if huge
        const str = JSON.stringify(data);
        if (str.length > 80000) {
          return {
            ...s,
            data: {
              truncatedForStorage: true,
              summary: data.summary || data.data?.summary || null,
              criticalAlerts: data.criticalAlerts || data.data?.criticalAlerts || null,
            },
          };
        }
      }
      return { ...s, data };
    });
  }
  return copy;
}
