/**
 * Fast-ACK webhook intake for Wazzup and MAX.
 * Insert → 200 → processQueuedWebhook via setImmediate.
 * Never logs secrets or full message text.
 */

import crypto from "crypto";
import { CommunicationError, getCommunicationsConfig } from "./config.js";
import { normalizeWazzupWebhook, computeEventHash } from "./webhookNormalizer.js";
import { createMaxBotProvider } from "./providers/maxBotProvider.js";
import * as repo from "./communicationRepository.js";
import logger from "../observability/logger.js";

function timingSafeEqualString(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function textHash(text) {
  if (text == null || text === "") return null;
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

function redactEventForStorage(event) {
  return {
    type: event.type,
    provider: event.provider,
    status: event.status || null,
    direction: event.direction || null,
    chatType: event.chatType || null,
    transport: event.transport || null,
    channelId: event.channelId || null,
    chatId: event.chatId || null,
    externalMessageId: event.externalMessageId || null,
    dateTime: event.dateTime || event.timestamp || null,
    hasText: Boolean(event.text),
    textHash: textHash(event.text),
    hasContact: Boolean(event.contact),
    contactPhoneMasked: event.contact?.phone
      ? `***${String(event.contact.phone).replace(/\D/g, "").slice(-4)}`
      : null,
    username: event.contact?.username || event.username || null,
    authorName: event.authorName || null,
    errorCode: event.error?.code || null,
    rawType: event.rawType || null,
  };
}

export function verifyWazzupWebhookSecret(urlSecret) {
  const expected = getCommunicationsConfig().wazzup._webhookSecret;
  if (!expected) {
    throw new CommunicationError(
      "WAZZUP_WEBHOOK_SECRET_NOT_CONFIGURED",
      "WAZZUP_WEBHOOK_SECRET не задан."
    );
  }
  if (!timingSafeEqualString(urlSecret, expected)) {
    throw new CommunicationError("WAZZUP_WEBHOOK_FORBIDDEN", "Неверный секрет webhook Wazzup.");
  }
  return true;
}

/**
 * MAX: accept URL secret OR X-Max-Bot-Api-Secret header (constant-time).
 */
export function verifyMaxWebhookSecret(urlSecret, headerSecret) {
  const expected = getCommunicationsConfig().maxBot._webhookSecret;
  if (!expected) {
    throw new CommunicationError(
      "MAX_WEBHOOK_SECRET_NOT_CONFIGURED",
      "MAX_WEBHOOK_SECRET не задан."
    );
  }
  const urlOk = urlSecret != null && urlSecret !== "" && timingSafeEqualString(urlSecret, expected);
  const headerOk =
    headerSecret != null &&
    headerSecret !== "" &&
    timingSafeEqualString(headerSecret, expected);
  if (!urlOk && !headerOk) {
    throw new CommunicationError("MAX_WEBHOOK_FORBIDDEN", "Неверный секрет webhook MAX.");
  }
  return true;
}

function ensureEventHash(provider, event) {
  if (event.eventHash) return event.eventHash;
  return computeEventHash(
    provider,
    event.type || "unknown",
    event.externalMessageId,
    event.status,
    event.chatId,
    event.dateTime || event.timestamp,
    textHash(event.text)?.slice(0, 16)
  );
}

/**
 * Insert webhook rows (dedupe by event_hash). Returns queued [{id, event}] for async process.
 * Keep full event in memory only — DB stores redacted payload without full text.
 */
export function queueNormalizedEvents(normalized) {
  const queued = [];
  const provider = normalized.provider || "wazzup";

  for (const event of normalized.events || []) {
    const eventHash = ensureEventHash(provider, event);
    const withHash = { ...event, provider: event.provider || provider, eventHash };

    const inserted = repo.insertWebhookEvent({
      provider,
      eventHash,
      eventType: withHash.type || "unknown",
      externalMessageId: withHash.externalMessageId || null,
      processingStatus: "queued",
      payloadRedacted: redactEventForStorage(withHash),
    });

    if (inserted.duplicate) {
      logger.info("communication.webhook.duplicate", {
        provider,
        type: withHash.type,
        messageId: withHash.externalMessageId || undefined,
      });
      continue;
    }

    queued.push({ id: inserted.id, event: withHash });
  }

  return queued;
}

export function queueWazzupWebhook(payload) {
  if (payload && payload.test === true) {
    return { test: true, queued: [], provider: "wazzup" };
  }
  const normalized = normalizeWazzupWebhook(payload);
  const queued = queueNormalizedEvents(normalized);
  return {
    test: false,
    queued,
    provider: "wazzup",
    warning: normalized.warning || null,
    unknown: Boolean(normalized.unknown),
  };
}

export async function queueMaxWebhook(payload) {
  const provider = createMaxBotProvider();
  const normalized = await provider.normalizeWebhook(payload || {});
  // Attach hashes for Max events
  for (const ev of normalized.events || []) {
    if (!ev.eventHash) {
      ev.eventHash = ensureEventHash("max_bot", ev);
    }
    if (!ev.provider) ev.provider = "max_bot";
  }
  const queued = queueNormalizedEvents(normalized);
  return {
    test: false,
    queued,
    provider: "max_bot",
    warning: normalized.warning || null,
  };
}

/**
 * Process one already-queued inbound/status/channel event.
 */
export async function processQueuedEvent(rowId, event) {
  const cfg = getCommunicationsConfig();

  try {
    if (event.type === "test") {
      repo.markWebhookProcessed(rowId, "processed");
      return { type: "test", ok: true };
    }

    if (event.type === "status") {
      if (event.externalMessageId) {
        repo.updateMessageStatus(event.provider || "wazzup", event.externalMessageId, event.status, {
          timestamp: event.timestamp,
          errorCode: event.error?.code,
          errorSafe: event.error?.description,
        });
        logger.info("communication.message.status_changed", {
          messageId: event.externalMessageId,
          status: event.status,
        });
      }
      repo.markWebhookProcessed(rowId, "processed");
      return { type: "status", ok: true };
    }

    if (event.type === "channel_update") {
      if (event.channelId) {
        const provider = event.provider || "wazzup";
        repo.upsertHubChannel({
          id: `${provider}:${event.channelId}`,
          provider,
          channel: event.transport || "unknown",
          externalChannelId: event.channelId,
          transport: event.transport,
          state: event.state,
          status: event.state,
        });
      }
      repo.markWebhookProcessed(rowId, "processed");
      return { type: "channel_update", ok: true };
    }

    if (event.type === "message") {
      const { resolveContact } = await import("./contactResolver.js");
      const { detectOptOut } = await import("./communicationPolicy.js");

      const resolution = await resolveContact({
        provider: event.provider || "wazzup",
        chatId: event.chatId,
        phone: event.contact?.phone,
        username: event.contact?.username,
        chatType: event.chatType,
        transport: event.transport || event.chatType,
      });

      const thread = repo.upsertThread({
        provider: event.provider || "wazzup",
        externalChatId: event.chatId,
        contactId: resolution.contactId,
        identityId: resolution.identityId,
        chatType: event.chatType,
        transport: event.transport || event.chatType,
        lastInboundAt: event.direction === "inbound" ? event.dateTime || new Date().toISOString() : null,
        lastOutboundAt:
          event.direction !== "inbound" ? event.dateTime || new Date().toISOString() : null,
        unanswered: event.direction === "inbound",
        lastMessagePreview: event.text ? String(event.text).slice(0, 200) : null,
      });

      repo.insertMessage({
        threadId: thread.id,
        provider: event.provider || "wazzup",
        externalMessageId: event.externalMessageId,
        direction: event.direction === "inbound" ? "inbound" : "outbound",
        status: event.status || (event.direction === "inbound" ? "inbound" : "sent"),
        transport: event.transport || event.chatType,
        chatType: event.chatType,
        channelId: event.channelId
          ? `${event.provider || "wazzup"}:${event.channelId}`
          : null,
        contactId: resolution.contactId,
        textSafe: event.text,
        providerTimestamp: event.dateTime || event.timestamp,
      });

      if (event.direction === "inbound" && resolution.contactId) {
        try {
          repo.stopEnrollmentsForContact(resolution.contactId, "stopped_by_reply");
        } catch {
          /* ignore */
        }
        const opt = detectOptOut(event.text, cfg);
        if (opt.matched) {
          repo.createSuppression({
            contactId: resolution.contactId,
            reason: "opt_out",
            source: "inbound_phrase",
            channel: event.chatType,
            messageHash: textHash(event.text),
          });
        }
      }

      repo.markWebhookProcessed(rowId, "processed");
      return {
        type: "message",
        ok: true,
        resolution: resolution.status,
        contactId: resolution.contactId,
      };
    }

    repo.markWebhookProcessed(rowId, "unknown", "unknown event type");
    return { type: event.type || "unknown", warning: true };
  } catch (error) {
    repo.markWebhookProcessed(rowId, "error", String(error.message || "error").slice(0, 300));
    logger.error("communication.webhook.failed", {
      type: event?.type,
      error: String(error.message || "error").slice(0, 200),
    });
    return { type: event?.type, error: true };
  }
}

export async function processQueuedWebhook(queued) {
  const results = [];
  for (const item of queued || []) {
    if (!item?.id || !item?.event) continue;
    results.push(await processQueuedEvent(item.id, item.event));
  }
  return results;
}

/** Fire-and-forget after HTTP 200 is on its way. */
export function scheduleWebhookProcessing(queued) {
  if (!queued?.length) return;
  setImmediate(() => {
    processQueuedWebhook(queued).catch((error) => {
      logger.error("communication.webhook.async_failed", {
        error: String(error.message || "error").slice(0, 200),
      });
    });
  });
}
