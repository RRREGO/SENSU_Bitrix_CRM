/**
 * Persist / detect communication channel capabilities.
 */

import crypto from "crypto";
import { getDatabase } from "../database/index.js";
import { listAdapters } from "./channelRegistry.js";
import {
  getCommunicationsConfig,
  getCommunicationsPublicConfig,
} from "./config.js";
import { countOutboxByStatus } from "./communicationRepository.js";
import { getSetting } from "../database/repositories/settingsRepository.js";
import { certificationSummary } from "./certification/certificationRepository.js";
import { getEmergencyStopState } from "./certification/certificationService.js";

function now() {
  return new Date().toISOString();
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    channel: row.channel,
    provider: row.provider,
    status: row.status,
    capabilities: JSON.parse(row.capabilities_json || "{}"),
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error_json ? JSON.parse(row.last_error_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listStoredChannels() {
  try {
    return getDatabase()
      .prepare("SELECT * FROM communication_channels ORDER BY channel")
      .all()
      .map(mapRow);
  } catch {
    return [];
  }
}

export function getStoredChannel(id) {
  return mapRow(
    getDatabase().prepare("SELECT * FROM communication_channels WHERE id = ?").get(id)
  );
}

function upsertChannel(detected) {
  const ts = now();
  const existing = getDatabase()
    .prepare("SELECT id FROM communication_channels WHERE id = ?")
    .get(detected.id);
  if (existing) {
    getDatabase()
      .prepare(
        `UPDATE communication_channels SET
          channel = ?, provider = ?, status = ?, capabilities_json = ?,
          last_checked_at = ?, last_error_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        detected.channel,
        detected.provider,
        detected.status,
        JSON.stringify(detected.capabilities || {}),
        ts,
        detected.lastError ? JSON.stringify(detected.lastError) : null,
        ts,
        detected.id
      );
  } else {
    getDatabase()
      .prepare(
        `INSERT INTO communication_channels (
          id, channel, provider, status, capabilities_json,
          last_checked_at, last_error_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        detected.id,
        detected.channel,
        detected.provider,
        detected.status,
        JSON.stringify(detected.capabilities || {}),
        ts,
        detected.lastError ? JSON.stringify(detected.lastError) : null,
        ts,
        ts
      );
  }
  return getStoredChannel(detected.id);
}

/**
 * Read-only discovery. No test send.
 */
export async function detectCommunicationChannels() {
  const warnings = [];
  const channels = [];
  for (const adapter of listAdapters()) {
    try {
      const result = await adapter.detect();
      channels.push(upsertChannel(result));
      for (const w of result.warnings || []) warnings.push({ channel: result.channel, ...w });
    } catch (error) {
      warnings.push({
        channel: adapter.channel,
        code: "DETECT_FAILED",
        message: error.message,
      });
      channels.push(
        upsertChannel({
          id: adapter.id,
          channel: adapter.channel,
          provider: adapter.provider,
          status: "not_configured",
          capabilities: adapter.capabilities || {},
          lastError: { message: error.message },
          warnings: [],
        })
      );
    }
  }
  return {
    success: true,
    channels,
    warnings,
    detectedAt: now(),
    detectionId: crypto.randomUUID(),
  };
}

/** Safe health block — never secrets. */
export function getCommunicationsHealth() {
  const channels = listStoredChannels();
  const base = {
    detectedChannels: channels.length,
    sendAvailable: channels.filter((c) => c.capabilities?.canSend).length,
    verificationRequired: 0,
  };
  try {
    const cfg = getCommunicationsConfig();
    const pub = getCommunicationsPublicConfig(cfg);
    let queue = { pending: 0, failed: 0 };
    try {
      const counts = countOutboxByStatus();
      queue = {
        pending: (counts.pending || 0) + (counts.retry || 0),
        failed: (counts.failed || 0) + (counts.dead_letter || 0),
        verificationRequired: counts.verification_required || 0,
      };
    } catch {
      /* hub tables may be absent on pre-v10 */
    }

    let certification = null;
    let emergencyStop = { active: false };
    try {
      certification = certificationSummary();
      emergencyStop = getEmergencyStopState();
    } catch {
      /* cert module / tables may be absent */
    }

    return {
      ...base,
      enabled: pub.enabled,
      sendEnabled: pub.sendEnabled,
      dryRun: pub.dryRun,
      flagsConflict: pub.flagsConflict,
      requireCertification: pub.requireCertification,
      provider: "wazzup",
      configured: Boolean(pub.wazzup?.configured),
      lastSuccessfulCheckAt: getSetting("communications_last_connection_ok_at", null),
      queue,
      certification,
      emergencyStop,
      outboxBacklog: queue.pending || 0,
    };
  } catch {
    return base;
  }
}


