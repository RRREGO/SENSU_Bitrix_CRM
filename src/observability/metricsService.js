/**
 * In-memory operational metrics + SQLite-backed counters.
 */

import fs from "fs";
import path from "path";
import { getDatabase } from "../database/index.js";
import { getDefaultDatabasePath, getBackupDir, getReleaseMetadata } from "../config/paths.js";
import { getOperationalModes } from "./operationalModes.js";
import { getAuthConfig } from "../auth/config.js";
import { getLlmTransportConfig } from "../llm/transport.js";

const startedAt = Date.now();

const http = {
  total: 0,
  errors: 0,
  active: 0,
  latencies: [],
};

const bitrix = {
  reads: 0,
  retries: 0,
  rateLimits: 0,
  timeouts: 0,
  invalidJson: 0,
  lastSuccessAt: null,
  durations: [],
};

const llm = {
  requests: 0,
  failures: 0,
  durations: [],
  requestChars: 0,
  responseChars: 0,
  lastSuccessAt: null,
};

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function pushCapped(arr, value, max = 500) {
  arr.push(value);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

export function recordHttpRequest({ status, durationMs }) {
  http.total += 1;
  if (status >= 500) http.errors += 1;
  if (Number.isFinite(durationMs)) pushCapped(http.latencies, durationMs);
}

export function incHttpActive(delta) {
  http.active = Math.max(0, http.active + delta);
}

export function recordBitrixRead({ ok, durationMs, code }) {
  bitrix.reads += 1;
  if (ok) bitrix.lastSuccessAt = new Date().toISOString();
  if (Number.isFinite(durationMs)) pushCapped(bitrix.durations, durationMs);
  if (code === "BITRIX_RATE_LIMITED") bitrix.rateLimits += 1;
  if (code === "BITRIX_TIMEOUT") bitrix.timeouts += 1;
  if (code === "BITRIX_INVALID_JSON") bitrix.invalidJson += 1;
  if (code && /retry/i.test(String(code))) bitrix.retries += 1;
}

export function recordBitrixRetry() {
  bitrix.retries += 1;
}

export function recordLlmRequest({ ok, durationMs, requestChars = 0, responseChars = 0 }) {
  llm.requests += 1;
  if (!ok) llm.failures += 1;
  else llm.lastSuccessAt = new Date().toISOString();
  if (Number.isFinite(durationMs)) pushCapped(llm.durations, durationMs);
  llm.requestChars += Number(requestChars) || 0;
  llm.responseChars += Number(responseChars) || 0;
}

function avg(arr) {
  if (!arr.length) return null;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function countSafe(sql, ...args) {
  try {
    return getDatabase().prepare(sql).get(...args)?.c ?? 0;
  } catch {
    return 0;
  }
}

function settingGet(key) {
  try {
    const row = getDatabase().prepare("SELECT value_json FROM app_settings WHERE key = ?").get(key);
    if (!row) return null;
    try {
      return JSON.parse(row.value_json);
    } catch {
      return row.value_json;
    }
  } catch {
    return null;
  }
}

function fileSizeMb(filePath) {
  try {
    return Math.round((fs.statSync(filePath).size / (1024 * 1024)) * 100) / 100;
  } catch {
    return null;
  }
}

export function getMetricsSnapshot() {
  const lat = [...http.latencies].sort((a, b) => a - b);
  const bdur = [...bitrix.durations].sort((a, b) => a - b);
  const ldur = [...llm.durations].sort((a, b) => a - b);
  const dbPath = getDefaultDatabasePath();
  const walPath = `${dbPath}-wal`;
  const backupDir = getBackupDir();
  let lastBackup = null;
  try {
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.endsWith(".sqlite"))
      .map((f) => ({ f, m: fs.statSync(path.join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (files[0]) lastBackup = new Date(files[0].m).toISOString();
  } catch {
    /* ignore */
  }

  return {
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    release: getReleaseMetadata(),
    modes: getOperationalModes(),
    http: {
      requestsTotal: http.total,
      errorsTotal: http.errors,
      activeRequests: http.active,
      latencyMs: { p50: percentile(lat, 50), p95: percentile(lat, 95), avg: avg(http.latencies) },
    },
    bitrix: {
      readRequests: bitrix.reads,
      retries: bitrix.retries,
      rateLimits: bitrix.rateLimits,
      timeouts: bitrix.timeouts,
      invalidJson: bitrix.invalidJson,
      lastSuccessfulRead: bitrix.lastSuccessAt,
      averageDurationMs: avg(bitrix.durations),
      durationP95Ms: percentile(bdur, 95),
    },
    llm: {
      requests: llm.requests,
      failures: llm.failures,
      durationAvgMs: avg(llm.durations),
      durationP95Ms: percentile(ldur, 95),
      requestCharsTotal: llm.requestChars,
      responseCharsTotal: llm.responseChars,
      proxyMode: getLlmTransportConfig().mode,
      lastSuccessfulRequest: llm.lastSuccessAt,
      enabled: getOperationalModes().llmEnabled,
    },
    safety: {
      pending: countSafe(`SELECT COUNT(*) AS c FROM operations WHERE status = 'pending_confirmation'`),
      recoveryRequired: countSafe(
        `SELECT COUNT(*) AS c FROM operations WHERE status IN ('executing','verification_required')`
      ),
      verificationRequired: countSafe(
        `SELECT COUNT(*) AS c FROM operations WHERE status = 'verification_required'`
      ),
      failed: countSafe(`SELECT COUNT(*) AS c FROM operations WHERE status = 'failed'`),
      rollbackConflicts: countSafe(
        `SELECT COUNT(*) AS c FROM operations WHERE status = 'rollback_conflict'`
      ),
    },
    scheduler: {
      activeSchedules: countSafe(`SELECT COUNT(*) AS c FROM report_schedules WHERE is_enabled = 1`),
      runningJobs: countSafe(`SELECT COUNT(*) AS c FROM report_runs WHERE status = 'running'`),
      failedRuns: countSafe(`SELECT COUNT(*) AS c FROM report_runs WHERE status = 'failed'`),
      lastSuccessfulDirectorBrief: (() => {
        try {
          return (
            getDatabase()
              .prepare(
                `SELECT completed_at FROM report_runs r
                 JOIN report_schedules s ON s.id = r.schedule_id
                 WHERE s.report_type = 'daily_director_brief' AND r.status = 'completed'
                 ORDER BY r.completed_at DESC LIMIT 1`
              )
              .get()?.completed_at || null
          );
        } catch {
          return null;
        }
      })(),
    },
    communications: {
      drafts: countSafe(`SELECT COUNT(*) AS c FROM message_drafts WHERE status != 'cancelled'`),
      sent: countSafe(`SELECT COUNT(*) AS c FROM outbound_messages WHERE status = 'sent'`),
      verificationRequired: countSafe(
        `SELECT COUNT(*) AS c FROM outbound_messages WHERE status = 'verification_required'`
      ),
      failed: countSafe(`SELECT COUNT(*) AS c FROM outbound_messages WHERE status = 'failed'`),
      sendEnabled: getAuthConfig().communicationSendEnabled && getOperationalModes().communicationSendEnabled,
    },
    database: {
      fileSizeMb: fileSizeMb(dbPath),
      walSizeMb: fileSizeMb(walPath),
      migrationVersion: (() => {
        try {
          return getDatabase().prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v;
        } catch {
          return null;
        }
      })(),
      lastBackup,
      lastRestoreDrill: settingGet("last_restore_drill_at"),
    },
  };
}

export function getStartedAt() {
  return startedAt;
}
