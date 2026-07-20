/**
 * CRUD for certification / runs / provider snapshots.
 */

import crypto from "crypto";
import { getDatabase } from "../../database/index.js";

function now() {
  return new Date().toISOString();
}

function uid() {
  return crypto.randomUUID();
}

function parseJson(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function mapCertification(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    channel: row.channel,
    transportId: row.transport_id,
    accountFingerprint: row.account_fingerprint,
    environment: row.environment,
    status: row.status,
    capabilities: parseJson(row.capabilities_json, {}),
    connectionTestedAt: row.connection_tested_at,
    channelsSyncedAt: row.channels_synced_at,
    webhookVerifiedAt: row.webhook_verified_at,
    singleSendVerifiedAt: row.single_send_verified_at,
    deliveryStatusVerifiedAt: row.delivery_status_verified_at,
    inboundReplyVerifiedAt: row.inbound_reply_verified_at,
    campaignVerifiedAt: row.campaign_verified_at,
    sequenceVerifiedAt: row.sequence_verified_at,
    expiresAt: row.expires_at,
    lastError: parseJson(row.last_error_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    certificationId: row.certification_id,
    testType: row.test_type,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    operationId: row.operation_id,
    draftId: row.draft_id,
    outboundMessageId: row.outbound_message_id,
    safeResult: parseJson(row.safe_result_json, null),
    error: parseJson(row.error_json, null),
    createdAt: row.created_at,
  };
}

function mapSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    accountFingerprint: row.account_fingerprint,
    channelsHash: row.channels_hash,
    capabilitiesHash: row.capabilities_hash,
    providerVersion: row.provider_version,
    snapshot: parseJson(row.snapshot_json, {}),
    createdAt: row.created_at,
  };
}

export function createCertification(data) {
  const id = data.id || uid();
  const ts = now();
  getDatabase()
    .prepare(
      `INSERT INTO communication_provider_certifications (
        id, provider, channel, transport_id, account_fingerprint, environment, status,
        capabilities_json, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      data.provider || "wazzup",
      data.channel || null,
      data.transportId || null,
      data.accountFingerprint,
      data.environment || process.env.APP_ENV || "development",
      data.status || "not_started",
      JSON.stringify(data.capabilities || {}),
      data.expiresAt || null,
      ts,
      ts
    );
  return getCertification(id);
}

export function getCertification(id) {
  return mapCertification(
    getDatabase()
      .prepare(`SELECT * FROM communication_provider_certifications WHERE id = ?`)
      .get(id)
  );
}

export function listCertifications(filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.provider) {
    clauses.push("provider = ?");
    params.push(filters.provider);
  }
  if (filters.channel) {
    clauses.push("channel = ?");
    params.push(filters.channel);
  }
  if (filters.transportId) {
    clauses.push("transport_id = ?");
    params.push(filters.transportId);
  }
  if (filters.accountFingerprint) {
    clauses.push("account_fingerprint = ?");
    params.push(filters.accountFingerprint);
  }
  if (filters.status) {
    clauses.push("status = ?");
    params.push(filters.status);
  }
  if (filters.environment) {
    clauses.push("environment = ?");
    params.push(filters.environment);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Number(filters.limit) || 100, 500);
  return getDatabase()
    .prepare(
      `SELECT * FROM communication_provider_certifications ${where}
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(...params, limit)
    .map(mapCertification);
}

export function findActiveCertification({
  provider,
  channel,
  transportId,
  accountFingerprint,
  environment,
} = {}) {
  const clauses = ["status NOT IN ('expired','failed','revoked','not_started')"];
  const params = [];
  if (provider) {
    clauses.push("provider = ?");
    params.push(provider);
  }
  if (channel) {
    clauses.push("(channel IS NULL OR channel = ?)");
    params.push(channel);
  }
  if (transportId) {
    clauses.push("(transport_id IS NULL OR transport_id = ?)");
    params.push(transportId);
  }
  if (accountFingerprint) {
    clauses.push("account_fingerprint = ?");
    params.push(accountFingerprint);
  }
  if (environment) {
    clauses.push("environment = ?");
    params.push(environment);
  }
  return mapCertification(
    getDatabase()
      .prepare(
        `SELECT * FROM communication_provider_certifications
         WHERE ${clauses.join(" AND ")}
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get(...params)
  );
}

export function updateCertification(id, patch = {}) {
  const row = getCertification(id);
  if (!row) return null;
  const ts = now();
  const next = {
    status: patch.status ?? row.status,
    capabilities: patch.capabilities ?? row.capabilities,
    connectionTestedAt: patch.connectionTestedAt ?? row.connectionTestedAt,
    channelsSyncedAt: patch.channelsSyncedAt ?? row.channelsSyncedAt,
    webhookVerifiedAt: patch.webhookVerifiedAt ?? row.webhookVerifiedAt,
    singleSendVerifiedAt: patch.singleSendVerifiedAt ?? row.singleSendVerifiedAt,
    deliveryStatusVerifiedAt: patch.deliveryStatusVerifiedAt ?? row.deliveryStatusVerifiedAt,
    inboundReplyVerifiedAt: patch.inboundReplyVerifiedAt ?? row.inboundReplyVerifiedAt,
    campaignVerifiedAt: patch.campaignVerifiedAt ?? row.campaignVerifiedAt,
    sequenceVerifiedAt: patch.sequenceVerifiedAt ?? row.sequenceVerifiedAt,
    expiresAt: patch.expiresAt !== undefined ? patch.expiresAt : row.expiresAt,
    accountFingerprint: patch.accountFingerprint ?? row.accountFingerprint,
    lastError: patch.lastError !== undefined ? patch.lastError : row.lastError,
  };
  getDatabase()
    .prepare(
      `UPDATE communication_provider_certifications SET
        status = ?, capabilities_json = ?, connection_tested_at = ?, channels_synced_at = ?,
        webhook_verified_at = ?, single_send_verified_at = ?, delivery_status_verified_at = ?,
        inbound_reply_verified_at = ?, campaign_verified_at = ?, sequence_verified_at = ?,
        expires_at = ?, account_fingerprint = ?, last_error_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      next.status,
      JSON.stringify(next.capabilities || {}),
      next.connectionTestedAt || null,
      next.channelsSyncedAt || null,
      next.webhookVerifiedAt || null,
      next.singleSendVerifiedAt || null,
      next.deliveryStatusVerifiedAt || null,
      next.inboundReplyVerifiedAt || null,
      next.campaignVerifiedAt || null,
      next.sequenceVerifiedAt || null,
      next.expiresAt || null,
      next.accountFingerprint,
      next.lastError ? JSON.stringify(next.lastError) : null,
      ts,
      id
    );
  return getCertification(id);
}

export function createCertificationRun(data) {
  const id = data.id || uid();
  const ts = now();
  getDatabase()
    .prepare(
      `INSERT INTO communication_certification_runs (
        id, certification_id, test_type, status, started_at, completed_at,
        operation_id, draft_id, outbound_message_id, safe_result_json, error_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      data.certificationId,
      data.testType,
      data.status || "pending",
      data.startedAt || ts,
      data.completedAt || null,
      data.operationId || null,
      data.draftId || null,
      data.outboundMessageId || null,
      data.safeResult ? JSON.stringify(data.safeResult) : null,
      data.error ? JSON.stringify(data.error) : null,
      ts
    );
  return getCertificationRun(id);
}

export function getCertificationRun(id) {
  return mapRun(
    getDatabase().prepare(`SELECT * FROM communication_certification_runs WHERE id = ?`).get(id)
  );
}

export function updateCertificationRun(id, patch = {}) {
  const row = getCertificationRun(id);
  if (!row) return null;
  getDatabase()
    .prepare(
      `UPDATE communication_certification_runs SET
        status = ?, completed_at = COALESCE(?, completed_at),
        operation_id = COALESCE(?, operation_id),
        draft_id = COALESCE(?, draft_id),
        outbound_message_id = COALESCE(?, outbound_message_id),
        safe_result_json = COALESCE(?, safe_result_json),
        error_json = COALESCE(?, error_json)
       WHERE id = ?`
    )
    .run(
      patch.status ?? row.status,
      patch.completedAt || null,
      patch.operationId || null,
      patch.draftId || null,
      patch.outboundMessageId || null,
      patch.safeResult ? JSON.stringify(patch.safeResult) : null,
      patch.error ? JSON.stringify(patch.error) : null,
      id
    );
  return getCertificationRun(id);
}

export function listCertificationRuns(certificationId, { limit = 50 } = {}) {
  return getDatabase()
    .prepare(
      `SELECT * FROM communication_certification_runs
       WHERE certification_id = ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(certificationId, Math.min(Number(limit) || 50, 200))
    .map(mapRun);
}

export function insertProviderSnapshot(data) {
  const id = data.id || uid();
  const ts = now();
  getDatabase()
    .prepare(
      `INSERT INTO communication_provider_snapshots (
        id, provider, account_fingerprint, channels_hash, capabilities_hash,
        provider_version, snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      data.provider || "wazzup",
      data.accountFingerprint,
      data.channelsHash || null,
      data.capabilitiesHash || null,
      data.providerVersion || null,
      JSON.stringify(data.snapshot || {}),
      ts
    );
  return getProviderSnapshot(id);
}

export function getProviderSnapshot(id) {
  return mapSnapshot(
    getDatabase().prepare(`SELECT * FROM communication_provider_snapshots WHERE id = ?`).get(id)
  );
}

export function getLatestProviderSnapshot({ provider, accountFingerprint } = {}) {
  const clauses = [];
  const params = [];
  if (provider) {
    clauses.push("provider = ?");
    params.push(provider);
  }
  if (accountFingerprint) {
    clauses.push("account_fingerprint = ?");
    params.push(accountFingerprint);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return mapSnapshot(
    getDatabase()
      .prepare(
        `SELECT * FROM communication_provider_snapshots ${where}
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(...params)
  );
}

export function countWebhookEventsSince({ provider, sinceIso } = {}) {
  const clauses = [];
  const params = [];
  if (provider) {
    clauses.push("provider = ?");
    params.push(provider);
  }
  if (sinceIso) {
    clauses.push("received_at >= ?");
    params.push(sinceIso);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) AS c FROM communication_webhook_events ${where}`)
    .get(...params);
  return row?.c || 0;
}

export function certificationSummary() {
  const rows = getDatabase()
    .prepare(
      `SELECT status, COUNT(*) AS c FROM communication_provider_certifications GROUP BY status`
    )
    .all();
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = r.c;
  const active = getDatabase()
    .prepare(
      `SELECT
         SUM(CASE WHEN single_send_verified_at IS NOT NULL AND status NOT IN ('expired','revoked','failed') THEN 1 ELSE 0 END) AS singleOk,
         SUM(CASE WHEN campaign_verified_at IS NOT NULL AND status NOT IN ('expired','revoked','failed') THEN 1 ELSE 0 END) AS campaignOk,
         SUM(CASE WHEN sequence_verified_at IS NOT NULL AND status NOT IN ('expired','revoked','failed') THEN 1 ELSE 0 END) AS sequenceOk,
         SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired,
         SUM(CASE WHEN last_error_json LIKE '%PROVIDER_CONTRACT_CHANGED%' THEN 1 ELSE 0 END) AS contractChanges
       FROM communication_provider_certifications`
    )
    .get();
  return {
    byStatus,
    singleCertified: active?.singleOk || 0,
    campaignCertified: active?.campaignOk || 0,
    sequenceCertified: active?.sequenceOk || 0,
    expired: active?.expired || 0,
    contractChanges: active?.contractChanges || 0,
  };
}
