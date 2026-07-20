/**
 * Transactional outbox worker for Communications Hub.
 * Uses scheduler_locks; dry-run / send-disabled never call provider.send.
 * Real sends require flags OK, no emergency stop, and active certification.
 */

import crypto from "crypto";
import { acquireLock, releaseLock } from "../scheduler/locks.js";
import { getCommunicationsConfig, CommunicationError } from "./config.js";
import { evaluateSendPolicy } from "./communicationPolicy.js";
import { getProvider } from "./providers/index.js";
import * as repo from "./communicationRepository.js";
import logger from "../observability/logger.js";
import {
  assertFlagsAllowSend,
  assertNotEmergencyStopped,
  assertSendCertified,
} from "./certification/certificationService.js";

const LOCK_KEY = "communications_outbox_worker";

function workerId() {
  return `comm-outbox-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
}

function shouldSendForReal(cfg, job) {
  if (job.dryRun) return false;
  if (cfg.dryRun) return false;
  if (!cfg.sendEnabled) return false;
  if (!cfg.enabled) return false;
  if (cfg.flagsConflict) return false;
  return true;
}

function jobSendLevel(job) {
  if (job.campaignId) return "campaign";
  if (job.sequenceEnrollmentId) return "sequence";
  return "single";
}

/**
 * Retry matrix: only DNS/connect before body, 429, 502/503/504, temporary unavailable.
 * Timeout-after-body / success+bad JSON → MESSAGE_SEND_RESULT_UNKNOWN, no auto-retry.
 */
export function classifyProviderSendError(error) {
  const code = String(error?.code || "").toUpperCase();
  const status = Number(error?.status || error?.details?.status || 0);
  const phase = String(error?.details?.phase || error?.phase || "").toLowerCase();
  const msg = String(error?.message || "").toLowerCase();

  if (
    code === "MESSAGE_SEND_RESULT_UNKNOWN" ||
    code === "PROVIDER_RESPONSE_INVALID" ||
    error?.details?.verificationRequired
  ) {
    return {
      retryable: false,
      errorCode: "MESSAGE_SEND_RESULT_UNKNOWN",
      verificationRequired: true,
    };
  }

  if (phase === "after_body" || phase === "after_send" || error?.details?.bodySent) {
    return {
      retryable: false,
      errorCode: "MESSAGE_SEND_RESULT_UNKNOWN",
      verificationRequired: true,
    };
  }

  if (
    code.includes("TIMEOUT") ||
    msg.includes("timeout") ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_BODY_TIMEOUT"
  ) {
    if (phase === "connect" || phase === "before_body" || error?.details?.beforeBody) {
      return { retryable: true, errorCode: code || "PROVIDER_TIMEOUT_CONNECT" };
    }
    return {
      retryable: false,
      errorCode: "MESSAGE_SEND_RESULT_UNKNOWN",
      verificationRequired: true,
    };
  }

  if (
    status === 429 ||
    code === "RATE_LIMIT" ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    (code === "ECONNRESET" && phase === "connect") ||
    msg.includes("temporarily unavailable") ||
    code === "PROVIDER_TEMPORARY"
  ) {
    return {
      retryable: true,
      errorCode: code || `HTTP_${status || "TEMP"}`,
      retryAfterSeconds: error?.details?.retryAfterSeconds,
    };
  }

  if (code === "ECONNRESET" || msg.includes("socket hang up")) {
    return {
      retryable: false,
      errorCode: "MESSAGE_SEND_RESULT_UNKNOWN",
      verificationRequired: true,
    };
  }

  return {
    retryable: Boolean(error?.details?.retryable),
    errorCode: code || "OUTBOX_ERROR",
  };
}

/**
 * Process a batch of outbox jobs. Returns summary.
 */
export async function processOutboxBatch({ limit } = {}) {
  const cfg = getCommunicationsConfig();
  if (!cfg.enabled) {
    return { skipped: true, reason: "COMMUNICATIONS_DISABLED" };
  }

  const owner = workerId();
  const lock = acquireLock(LOCK_KEY, owner, cfg.outboxLockTtlSeconds);
  if (!lock.acquired) {
    return { skipped: true, reason: "LOCK_HELD" };
  }

  const results = { processed: 0, dryRun: 0, sent: 0, failed: 0, blocked: 0 };
  try {
    const jobs = repo.claimOutboxJobs({
      workerId: owner,
      limit: limit || cfg.outboxBatchSize,
      lockTtlSeconds: cfg.outboxLockTtlSeconds,
    });

    for (const job of jobs) {
      results.processed += 1;
      try {
        await processOneJob(job, cfg, results);
      } catch (error) {
        results.failed += 1;
        const classified = classifyProviderSendError(error);
        const retryable = classified.retryable;
        repo.failOutboxJob(job.id, {
          errorCode: classified.errorCode || error.code || "OUTBOX_ERROR",
          errorSafe: String(error.message || "error").slice(0, 300),
          retryable,
          retryAfterSeconds: classified.retryAfterSeconds || error?.details?.retryAfterSeconds,
          maxAttempts: cfg.outboxMaxAttempts,
        });
        if (classified.verificationRequired) {
          logger.warn("communication.message.verification_required", {
            outboxId: job.id,
            code: classified.errorCode,
          });
        }
        logger.warn("communication.message.failed", {
          outboxId: job.id,
          code: classified.errorCode || error.code || "OUTBOX_ERROR",
          retryable,
        });
      }
    }
  } finally {
    releaseLock(LOCK_KEY, owner);
  }

  return results;
}

async function processOneJob(job, cfg, results) {
  // Re-check campaign / sequence stopped
  if (job.campaignId) {
    const campaign = repo.getCampaign(job.campaignId);
    if (campaign && ["paused", "cancelled"].includes(campaign.status)) {
      repo.completeOutboxJob(job.id, {
        status: "cancelled",
        lastErrorCode: "CAMPAIGN_STOPPED",
        lastErrorSafe: `Кампания ${campaign.status}`,
      });
      results.blocked += 1;
      return;
    }
  }
  if (job.sequenceEnrollmentId) {
    const enrollment = repo.getEnrollment(job.sequenceEnrollmentId);
    if (
      enrollment &&
      [
        "paused",
        "completed",
        "stopped_by_reply",
        "stopped_by_status",
        "stopped_by_suppression",
        "stopped_manually",
        "failed",
      ].includes(enrollment.status)
    ) {
      repo.completeOutboxJob(job.id, {
        status: "cancelled",
        lastErrorCode: "SEQUENCE_DONE",
        lastErrorSafe: enrollment.status,
      });
      results.blocked += 1;
      return;
    }
  }

  const policy = evaluateSendPolicy({
    contactId: job.contactId,
    channel: job.transport || job.chatType,
    transport: job.transport,
    chatType: job.chatType,
    externalChatId: job.externalChatId,
    phone: job.payload?.phone,
    username: job.payload?.username,
    idempotencyKey: job.idempotencyKey,
    campaignStatus: job.campaignId ? repo.getCampaign(job.campaignId)?.status : null,
    sequenceEnrollmentStatus: job.sequenceEnrollmentId
      ? repo.getEnrollment(job.sequenceEnrollmentId)?.status
      : null,
    wabaTemplateId: job.wabaTemplateId,
    planHash: job.planHash,
    confirmedPlanHash: job.campaignId ? repo.getCampaign(job.campaignId)?.planHash : null,
    channelState: "active",
    category: job.payload?.category || "service",
    isFirstContact: job.payload?.isFirstContact,
    firstContactGround: job.payload?.firstContactGround,
  });

  if (!policy.allowed) {
    repo.completeOutboxJob(job.id, {
      status: "policy_blocked",
      lastErrorCode: policy.code,
      lastErrorSafe: policy.message,
    });
    results.blocked += 1;
    logger.info("communication.policy.blocked", {
      outboxId: job.id,
      code: policy.code,
      contactId: job.contactId,
    });
    return;
  }

  if (!shouldSendForReal(cfg, job)) {
    // Dry-run: record as dry_run, never call provider
    const fakeId = `dryrun-${job.id}`;
    repo.completeOutboxJob(job.id, {
      status: "dry_run",
      providerMessageId: fakeId,
      sentAt: new Date().toISOString(),
    });
    repo.insertMessage({
      provider: job.provider,
      externalMessageId: fakeId,
      direction: "outbound",
      status: "dry_run",
      transport: job.transport,
      chatType: job.chatType,
      channelId: job.channelId,
      contactId: job.contactId,
      threadId: job.threadId,
      textSafe: job.body,
      campaignId: job.campaignId,
      sequenceEnrollmentId: job.sequenceEnrollmentId,
      outboxId: job.id,
      crmMessageId: job.crmMessageId,
      sentAt: new Date().toISOString(),
    });
    results.dryRun += 1;
    logger.info("communication.message.queued", {
      outboxId: job.id,
      status: "dry_run",
      contactId: job.contactId,
      textLength: String(job.body || "").length,
    });
    return;
  }

  // --- Real send gates ---
  try {
    assertFlagsAllowSend({ level: jobSendLevel(job) });
    assertNotEmergencyStopped();
    assertSendCertified({
      level: jobSendLevel(job),
      provider: job.provider,
      channel: job.transport || job.chatType,
      transportId: job.channelId,
      accountFingerprint: job.accountFingerprint,
      dryRun: false,
    });
  } catch (gateError) {
    if (gateError instanceof CommunicationError) {
      repo.completeOutboxJob(job.id, {
        status: "policy_blocked",
        lastErrorCode: gateError.code,
        lastErrorSafe: String(gateError.message).slice(0, 300),
      });
      results.blocked += 1;
      logger.warn("communication.send.gate_blocked", {
        outboxId: job.id,
        code: gateError.code,
      });
      return;
    }
    throw gateError;
  }

  // Fingerprint match on job vs certification (when present)
  if (job.accountFingerprint && job.certificationId) {
    const certRow = (
      await import("./certification/certificationRepository.js")
    ).getCertification(job.certificationId);
    if (certRow && certRow.accountFingerprint !== job.accountFingerprint) {
      repo.completeOutboxJob(job.id, {
        status: "policy_blocked",
        lastErrorCode: "CERTIFICATION_FINGERPRINT_MISMATCH",
        lastErrorSafe: "Fingerprint outbox ≠ certification",
      });
      results.blocked += 1;
      return;
    }
  }

  // Re-check policy / suppression / consent immediately before send
  const policyRecheck = evaluateSendPolicy({
    contactId: job.contactId,
    channel: job.transport || job.chatType,
    transport: job.transport,
    chatType: job.chatType,
    externalChatId: job.externalChatId,
    phone: job.payload?.phone,
    username: job.payload?.username,
    campaignStatus: job.campaignId ? repo.getCampaign(job.campaignId)?.status : null,
    sequenceEnrollmentStatus: job.sequenceEnrollmentId
      ? repo.getEnrollment(job.sequenceEnrollmentId)?.status
      : null,
    wabaTemplateId: job.wabaTemplateId,
    planHash: job.planHash,
    confirmedPlanHash: job.campaignId ? repo.getCampaign(job.campaignId)?.planHash : null,
    channelState: "active",
    category: job.payload?.category || "service",
    isFirstContact: job.payload?.isFirstContact,
    firstContactGround: job.payload?.firstContactGround,
    skipAddressCheck: false,
  });
  if (!policyRecheck.allowed) {
    repo.completeOutboxJob(job.id, {
      status: "policy_blocked",
      lastErrorCode: policyRecheck.code,
      lastErrorSafe: policyRecheck.message,
    });
    results.blocked += 1;
    return;
  }

  const providerName = job.provider === "max_bot" ? "max_bot" : "wazzup";
  const provider = getProvider(providerName);

  logger.info("communication.provider.request", {
    outboxId: job.id,
    provider: providerName,
    transport: job.transport,
    contactId: job.contactId,
    textLength: String(job.body || "").length,
  });

  let sendResult;
  try {
    sendResult = await provider.sendMessage({
      channelId: job.channelId || job.payload?.channelId,
      chatType: job.chatType || "whatsapp",
      chatId: job.externalChatId,
      phone: job.payload?.phone,
      username: job.payload?.username,
      text: job.body,
      templateId: job.wabaTemplateId,
      templateValues: job.templateValues,
      crmMessageId: job.crmMessageId || job.idempotencyKey,
    });
  } catch (error) {
    const classified = classifyProviderSendError(error);
    if (classified.verificationRequired) {
      error.code = "MESSAGE_SEND_RESULT_UNKNOWN";
      error.details = {
        ...(error.details || {}),
        retryable: false,
        verificationRequired: true,
      };
    } else {
      error.details = {
        ...(error.details || {}),
        retryable: classified.retryable,
        retryAfterSeconds: classified.retryAfterSeconds,
      };
      error.code = classified.errorCode || error.code;
    }
    throw error;
  }

  if (!sendResult?.externalMessageId && sendResult?.ok !== false) {
    // HTTP success path without expected external ID → unknown, no retry
    const err = new CommunicationError(
      "MESSAGE_SEND_RESULT_UNKNOWN",
      "Провайдер не вернул external message id — verification_required, без auto-retry.",
      { verificationRequired: true, retryable: false }
    );
    throw err;
  }

  repo.completeOutboxJob(job.id, {
    status: "accepted",
    providerMessageId: sendResult.externalMessageId,
    sentAt: new Date().toISOString(),
  });

  repo.insertMessage({
    provider: providerName,
    externalMessageId: sendResult.externalMessageId,
    direction: "outbound",
    status: "sent",
    transport: job.transport,
    chatType: job.chatType,
    channelId: job.channelId,
    contactId: job.contactId,
    threadId: job.threadId,
    textSafe: job.body,
    campaignId: job.campaignId,
    sequenceEnrollmentId: job.sequenceEnrollmentId,
    outboxId: job.id,
    crmMessageId: job.crmMessageId,
    sentAt: new Date().toISOString(),
  });

  results.sent += 1;
  logger.info("communication.message.sent", {
    outboxId: job.id,
    providerMessageId: sendResult.externalMessageId,
    contactId: job.contactId,
    durationMs: sendResult.durationMs,
  });
  logger.info("communication.provider.response", {
    outboxId: job.id,
    ok: true,
    hasMessageId: Boolean(sendResult.externalMessageId),
  });
}

/**
 * Legacy sync path — prefer webhookHandler.queue* + scheduleWebhookProcessing.
 */
export async function handleNormalizedWebhookEvents(normalized) {
  const { queueNormalizedEvents, processQueuedWebhook } = await import("./webhookHandler.js");
  const queued = queueNormalizedEvents(normalized);
  return processQueuedWebhook(queued);
}

export function getOutboxHealth() {
  const counts = repo.countOutboxByStatus();
  return {
    pending: (counts.pending || 0) + (counts.retry || 0),
    processing: counts.processing || 0,
    failed: (counts.failed || 0) + (counts.dead_letter || 0),
    dryRun: counts.dry_run || 0,
    accepted: counts.accepted || 0,
    verificationRequired: counts.verification_required || 0,
  };
}

let hubStarted = false;
let hubTimer = null;

/**
 * Outbox + sequence enrollment poller (similar to startScheduler).
 */
export function startCommunicationScheduler() {
  const cfg = getCommunicationsConfig();
  if (!cfg.enabled) {
    console.log("[Communications] scheduler not started (COMMUNICATIONS_ENABLED=false)");
    return { started: false };
  }
  if (hubStarted) return { started: true, already: true };

  const pollMs = Math.max(5, Number(process.env.COMMUNICATIONS_POLL_SECONDS || 15)) * 1000;
  hubTimer = setInterval(() => {
    tickCommunications().catch((e) =>
      console.warn("[Communications] tick failed:", e.message)
    );
  }, pollMs);
  if (typeof hubTimer.unref === "function") hubTimer.unref();
  hubStarted = true;
  console.log(`[Communications] scheduler started poll=${pollMs / 1000}s`);
  tickCommunications().catch(() => {});
  return { started: true };
}

export function stopCommunicationScheduler() {
  if (hubTimer) clearInterval(hubTimer);
  hubTimer = null;
  hubStarted = false;
}

async function tickCommunications() {
  const { processDueEnrollments } = await import("./sequenceRunner.js");
  const outbox = await processOutboxBatch();
  const enrollments = processDueEnrollments({ limit: 20 });
  return { outbox, enrollments };
}

export function getCommunicationSchedulerHealth() {
  return {
    started: hubStarted,
    outbox: getOutboxHealth(),
  };
}

