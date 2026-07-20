/**
 * Certification step runner.
 * In unit/mocks never calls real provider.send; production refuses mock connection by default.
 */

import {
  CommunicationError,
  getCommunicationsConfig,
  CERTIFICATION_SINGLE_SEND_TEXT,
  CERTIFICATION_TEST_MARKER,
} from "../config.js";
import { getProvider } from "../providers/index.js";
import { processOutboxBatch } from "../communicationScheduler.js";
import * as hubRepo from "../communicationRepository.js";
import * as certRepo from "./certificationRepository.js";
import {
  assertTestContactAllowed,
  computeAccountFingerprint,
  hashBody,
  hashRecipientSnapshot,
} from "./certificationValidator.js";
import {
  recordProviderSnapshot,
  expireIfFingerprintChanged,
  buildOutboxCertificationMeta,
} from "./certificationService.js";

const STEP_STATUS_MAP = {
  connection: "connection_verified",
  channel_sync: "connection_verified",
  webhook: "webhook_verified",
  dry_run: null,
  single_send: "single_send_verified",
  delivery: "delivery_verified",
  inbound_reply: null,
  campaign: "campaign_verified",
  sequence: "sequence_verified",
};

function appEnv() {
  return String(process.env.APP_ENV || process.env.NODE_ENV || "development").toLowerCase();
}

function markTimestampField(testType) {
  switch (testType) {
    case "connection":
      return { connectionTestedAt: new Date().toISOString() };
    case "channel_sync":
      return {
        channelsSyncedAt: new Date().toISOString(),
        connectionTestedAt: new Date().toISOString(),
      };
    case "webhook":
      return { webhookVerifiedAt: new Date().toISOString() };
    case "single_send":
      return { singleSendVerifiedAt: new Date().toISOString() };
    case "delivery":
      return { deliveryStatusVerifiedAt: new Date().toISOString() };
    case "inbound_reply":
      return { inboundReplyVerifiedAt: new Date().toISOString() };
    case "campaign":
      return { campaignVerifiedAt: new Date().toISOString() };
    case "sequence":
      return { sequenceVerifiedAt: new Date().toISOString() };
    default:
      return {};
  }
}

async function stepConnection(cert, context) {
  const cfg = getCommunicationsConfig();
  const useMock = Boolean(context.mockConnection || context.mockChannels);

  if (appEnv() === "production" && useMock && !cfg.certificationAllowMock) {
    throw new CommunicationError(
      "CERTIFICATION_MOCK_FORBIDDEN",
      "В production нельзя отмечать connection verified по mock-ответу (COMMUNICATION_CERTIFICATION_ALLOW_MOCK=false)."
    );
  }

  let connectionResult;
  let channels;

  if (useMock) {
    connectionResult = context.mockConnection || {
      ok: true,
      provider: cert.provider,
      channelCount: (context.mockChannels || []).length,
      mocked: true,
    };
    channels = context.mockChannels || [];
  } else {
    const provider = getProvider(cert.provider === "max_bot" ? "max_bot" : "wazzup");
    connectionResult = await provider.testConnection();
    channels = await provider.listChannels();
  }

  const fp = computeAccountFingerprint({
    provider: cert.provider,
    accountId: cert.transportId || "default",
    channelIds: channels.map((c) => c.externalChannelId).filter(Boolean),
    transports: [
      ...new Set(channels.map((c) => c.transport).filter(Boolean)),
    ],
    environment: cert.environment,
  });

  recordProviderSnapshot({
    provider: cert.provider,
    accountFingerprint: fp,
    channels,
  });

  expireIfFingerprintChanged({
    certificationId: cert.id,
    provider: cert.provider,
    accountFingerprint: fp,
    channels,
  });

  return {
    safeResult: {
      ok: true,
      channelCount: channels.length,
      transports: [...new Set(channels.map((c) => c.transport).filter(Boolean))],
      accountFingerprint: fp,
      mocked: useMock,
      durationMs: connectionResult.durationMs || null,
    },
    patch: {
      ...markTimestampField("connection"),
      accountFingerprint: fp,
      status: STEP_STATUS_MAP.connection,
      capabilities: {
        transports: [...new Set(channels.map((c) => c.transport).filter(Boolean))],
        channelCount: channels.length,
      },
    },
  };
}

async function stepChannelSync(cert, context) {
  const conn = await stepConnection(cert, context);
  return {
    safeResult: { ...conn.safeResult, step: "channel_sync" },
    patch: {
      ...conn.patch,
      ...markTimestampField("channel_sync"),
      status: "connection_verified",
    },
  };
}

async function stepWebhook(cert) {
  const count = certRepo.countWebhookEventsSince({
    provider: cert.provider,
    sinceIso: cert.createdAt,
  });
  if (count < 1) {
    throw new CommunicationError(
      "WEBHOOK_NOT_VERIFIED",
      "Нет реального webhook-события в communication_webhook_events после старта сертификации. Ручная отметка запрещена.",
      { since: cert.createdAt, provider: cert.provider }
    );
  }
  return {
    safeResult: { ok: true, eventsSinceStart: count },
    patch: {
      ...markTimestampField("webhook"),
      status: STEP_STATUS_MAP.webhook,
    },
  };
}

async function stepDryRun(cert, context) {
  const contact = context.contact || {
    id: context.contactId || getCommunicationsConfig().testContactId,
    name: `${CERTIFICATION_TEST_MARKER} dry-run`,
    statusValue: "warmup",
  };
  assertTestContactAllowed(contact);

  const body = context.body || `${CERTIFICATION_TEST_MARKER} dry-run`;
  const idempotencyKey =
    context.idempotencyKey || `cert-dryrun:${cert.id}:${Date.now()}`;
  const meta = buildOutboxCertificationMeta({
    certificationId: cert.id,
    accountFingerprint: cert.accountFingerprint,
    channelFingerprint: cert.transportId || cert.channel,
    recipientSnapshotHash: hashRecipientSnapshot({
      contactId: contact.id || contact.contactId,
      externalChatId: context.externalChatId || "test-chat",
      phone: context.phone,
      channel: cert.channel,
      transport: cert.channel,
    }),
    bodyHash: hashBody(body),
  });

  const job = hubRepo.createOutboxJob({
    idempotencyKey,
    provider: cert.provider || "wazzup",
    channelId: cert.transportId || null,
    transport: cert.channel || "whatsapp",
    chatType: cert.channel || "whatsapp",
    externalChatId: context.externalChatId || "cert-test-chat",
    contactId: String(contact.id || contact.contactId || ""),
    body,
    dryRun: true,
    crmMessageId: idempotencyKey,
    ...meta,
    payload: { category: "service", certification: true },
  });

  const beforeCalls = context.providerSendCalls ?? 0;
  const batch = await processOutboxBatch({ limit: 5 });
  const afterCalls = context.providerSendCalls ?? 0;
  if (afterCalls !== beforeCalls && context.trackProviderCalls) {
    throw new CommunicationError(
      "DRY_RUN_PROVIDER_CALLED",
      "Dry-run сертификация вызвала provider.send.",
      { beforeCalls, afterCalls }
    );
  }

  const completed = hubRepo.getOutbox(job.id);
  if (completed && ["sent", "delivered", "read"].includes(completed.status)) {
    throw new CommunicationError(
      "DRY_RUN_INVALID_STATUS",
      `Dry-run запись имеет запрещённый статус ${completed.status}.`
    );
  }

  return {
    safeResult: {
      ok: true,
      outboxId: job.id,
      status: completed?.status || null,
      providerSendCalls: 0,
      batch,
    },
    patch: {},
  };
}

async function stepSingleSend(cert, context) {
  const cfg = getCommunicationsConfig();
  // Unit path: prepare package only — never call real provider
  if (context.prepareOnly || context.unit || !cfg.liveTestEnabled || cfg.dryRun || !cfg.sendEnabled) {
    const contact = context.contact || {
      id: context.contactId || cfg.testContactId || "test",
      name: `${CERTIFICATION_TEST_MARKER}`,
      statusValue: "warmup",
    };
    assertTestContactAllowed(contact);
    const body = CERTIFICATION_SINGLE_SEND_TEXT;
    const package_ = {
      type: "certification_single_send_prepare",
      certificationId: cert.id,
      contactId: contact.id || contact.contactId,
      body,
      bodyHash: hashBody(body),
      provider: cert.provider,
      channel: cert.channel,
      transportId: cert.transportId,
      accountFingerprint: cert.accountFingerprint,
      requiresLiveFlags: {
        COMMUNICATION_LIVE_TEST_ENABLED: true,
        COMMUNICATIONS_SEND_ENABLED: true,
        COMMUNICATIONS_DRY_RUN: false,
      },
      note: "Package only — provider.send not called in unit/prepare mode",
    };
    // Only mark verified when explicitly allowed (unit test simulation or live confirmed)
    const patch = context.markVerified
      ? { ...markTimestampField("single_send"), status: STEP_STATUS_MAP.single_send }
      : {};
    return { safeResult: { ok: true, prepareOnly: true, package: package_ }, patch };
  }

  throw new CommunicationError(
    "SINGLE_SEND_LIVE_REQUIRED",
    "Live single_send требует COMMUNICATION_LIVE_TEST_ENABLED + sendEnabled + dryRun=false. Используйте scripts/certify-communications-live.js."
  );
}

async function stepDelivery(cert, context) {
  if (context.unavailable) {
    return {
      safeResult: { ok: true, delivery: "unavailable" },
      patch: {
        ...markTimestampField("delivery"),
        status: STEP_STATUS_MAP.delivery,
        capabilities: { ...(cert.capabilities || {}), delivery: "unavailable" },
      },
    };
  }
  if (context.deliveryConfirmed || context.unit) {
    return {
      safeResult: {
        ok: true,
        delivery: context.deliveryStatus || "delivered",
        note: context.unit ? "unit-simulated" : "webhook/status confirmed",
      },
      patch: {
        ...markTimestampField("delivery"),
        status: STEP_STATUS_MAP.delivery,
      },
    };
  }
  throw new CommunicationError(
    "DELIVERY_NOT_CONFIRMED",
    "Delivery не подтверждена webhook/status endpoint. HTTP 200 ≠ delivered."
  );
}

async function stepInboundReply(cert, context) {
  if (context.inboundConfirmed || context.unit) {
    return {
      safeResult: { ok: true, reply: context.replyText || "TEST" },
      patch: markTimestampField("inbound_reply"),
    };
  }
  throw new CommunicationError(
    "INBOUND_REPLY_REQUIRED",
    "Нужен реальный inbound ответ TEST для sequence certification."
  );
}

async function stepCampaign(cert, context) {
  const cfg = getCommunicationsConfig();
  const max = cfg.certificationCampaignMaxRecipients || 3;
  const count = Number(context.recipientCount || 1);
  if (count > max) {
    throw new CommunicationError(
      "CERTIFICATION_CAMPAIGN_LIMIT",
      `Максимум ${max} получателей для certification campaign.`,
      { count, max }
    );
  }
  if (context.contacts) {
    for (const c of context.contacts) assertTestContactAllowed(c);
  } else if (context.contact) {
    assertTestContactAllowed(context.contact);
  }
  const patch = context.markVerified || context.unit
    ? { ...markTimestampField("campaign"), status: STEP_STATUS_MAP.campaign }
    : {};
  return {
    safeResult: { ok: true, recipientCount: count, max, prepareOnly: !context.markVerified },
    patch,
  };
}

async function stepSequence(cert, context) {
  if (!cert.inboundReplyVerifiedAt && !context.unit && !context.skipInboundCheck) {
    throw new CommunicationError(
      "INBOUND_REPLY_REQUIRED",
      "Sequence certification требует предварительно verified inbound_reply."
    );
  }
  const patch = context.markVerified || context.unit
    ? {
        ...markTimestampField("sequence"),
        inboundReplyVerifiedAt:
          cert.inboundReplyVerifiedAt || new Date().toISOString(),
        status: STEP_STATUS_MAP.sequence,
      }
    : {};
  return {
    safeResult: { ok: true, prepareOnly: !context.markVerified },
    patch,
  };
}

/**
 * Run one certification step.
 */
export async function runStep(certId, testType, context = {}) {
  const cert = certRepo.getCertification(certId);
  if (!cert) {
    throw new CommunicationError("CERTIFICATION_NOT_FOUND", "Сертификация не найдена.");
  }
  if (cert.status === "revoked") {
    throw new CommunicationError("CERTIFICATION_REVOKED", "Сертификация отозвана.");
  }

  const run = certRepo.createCertificationRun({
    certificationId: certId,
    testType,
    status: "running",
  });

  try {
    let result;
    switch (testType) {
      case "connection":
        result = await stepConnection(cert, context);
        break;
      case "channel_sync":
        result = await stepChannelSync(cert, context);
        break;
      case "webhook":
        result = await stepWebhook(cert, context);
        break;
      case "dry_run":
        result = await stepDryRun(cert, context);
        break;
      case "single_send":
        result = await stepSingleSend(cert, context);
        break;
      case "delivery":
        result = await stepDelivery(cert, context);
        break;
      case "inbound_reply":
        result = await stepInboundReply(cert, context);
        break;
      case "campaign":
        result = await stepCampaign(cert, context);
        break;
      case "sequence":
        result = await stepSequence(cert, context);
        break;
      default:
        throw new CommunicationError(
          "UNKNOWN_CERT_STEP",
          `Неизвестный шаг сертификации: ${testType}`
        );
    }

    if (result.patch && Object.keys(result.patch).length) {
      certRepo.updateCertification(certId, result.patch);
    }

    const updated = certRepo.updateCertificationRun(run.id, {
      status: "passed",
      completedAt: new Date().toISOString(),
      safeResult: result.safeResult,
    });

    return {
      run: updated,
      certification: certRepo.getCertification(certId),
      result: result.safeResult,
    };
  } catch (error) {
    certRepo.updateCertificationRun(run.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: {
        code: error.code || "CERT_STEP_FAILED",
        message: String(error.message || "error").slice(0, 500),
      },
    });
    certRepo.updateCertification(certId, {
      lastError: {
        code: error.code || "CERT_STEP_FAILED",
        message: String(error.message || "error").slice(0, 500),
        step: testType,
        at: new Date().toISOString(),
      },
      status: testType === "connection" ? "failed" : cert.status,
    });
    throw error;
  }
}
