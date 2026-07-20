/**
 * Delivery verification and webhook events.
 */

import { redactObject } from "../safety/redact.js";
import { CommunicationError, getCommunicationsConfig } from "./config.js";
import { getAdapterByChannel } from "./channelRegistry.js";
import {
  getOutboundMessage,
  updateOutboundMessage,
  addDeliveryEvent,
} from "../database/repositories/messageDraftsRepository.js";

export async function verifyOutboundMessage(id) {
  const outbound = getOutboundMessage(id);
  if (!outbound) {
    throw new CommunicationError("MESSAGE_RECIPIENT_NOT_FOUND", "Исходящее сообщение не найдено.");
  }
  const adapter = getAdapterByChannel(outbound.channel);
  if (!adapter?.capabilities?.supportsDeliveryStatus && !adapter?.verifyDelivery) {
    updateOutboundMessage(id, { verificationStatus: "unavailable" });
    return {
      success: true,
      outbound: getOutboundMessage(id),
      warning: {
        code: "DELIVERY_STATUS_UNAVAILABLE",
        message: "Канал не поддерживает проверку статуса доставки.",
      },
    };
  }
  const result = await adapter.verifyDelivery(outbound);
  if (result.verificationStatus === "unavailable" || result.status === "unavailable") {
    updateOutboundMessage(id, { verificationStatus: "unavailable" });
    throw new CommunicationError(
      "DELIVERY_STATUS_UNAVAILABLE",
      "Статус доставки недоступен для этого канала."
    );
  }
  updateOutboundMessage(id, {
    verificationStatus: result.verificationStatus || result.status,
    status: result.status === "delivered" ? "delivered" : outbound.status,
    deliveredAt: result.status === "delivered" ? new Date().toISOString() : outbound.deliveredAt,
  });
  addDeliveryEvent({
    outboundMessageId: id,
    eventType: "verify",
    providerStatus: result.status,
    payload: redactObject(result),
  });
  return { success: true, outbound: getOutboundMessage(id) };
}

/**
 * Ingest provider webhook. Requires token if configured.
 */
export function ingestCommunicationEvent(channel, body, headers = {}) {
  const cfg = getCommunicationsConfig();
  if (!cfg.webhookToken) {
    throw new CommunicationError(
      "CHANNEL_NOT_AVAILABLE",
      "Webhook статусов не настроен (COMMUNICATION_WEBHOOK_TOKEN)."
    );
  }
  const token =
    headers["x-communication-token"] ||
    headers["x-webhook-token"] ||
    body?.token ||
    "";
  if (String(token) !== cfg.webhookToken) {
    throw new CommunicationError("CHANNEL_SCOPE_REQUIRED", "Неверная подпись или токен webhook.");
  }

  const eventId = body?.eventId || body?.id || null;
  const outboundId = body?.outboundMessageId || body?.outbound_id;
  if (!outboundId) {
    throw new CommunicationError("MESSAGE_RECIPIENT_NOT_FOUND", "outboundMessageId обязателен.");
  }
  const outbound = getOutboundMessage(outboundId);
  if (!outbound) {
    throw new CommunicationError("MESSAGE_RECIPIENT_NOT_FOUND", "Исходящее сообщение не найдено.");
  }
  if (String(outbound.channel) !== String(channel)) {
    throw new CommunicationError("CHANNEL_NOT_AVAILABLE", "Канал события не совпадает.");
  }

  const event = addDeliveryEvent({
    outboundMessageId: outboundId,
    eventType: body?.eventType || body?.type || "status",
    providerStatus: body?.status || null,
    eventIdempotencyKey: eventId ? `${channel}:${eventId}` : null,
    payload: redactObject(body),
  });

  if (event.duplicate) {
    return { success: true, duplicate: true, eventId: event.id };
  }

  const status = String(body?.status || "").toLowerCase();
  if (status === "delivered" || status === "read") {
    updateOutboundMessage(outboundId, {
      status: status === "read" ? "delivered" : "delivered",
      verificationStatus: status,
      deliveredAt: new Date().toISOString(),
    });
  } else if (status === "failed") {
    updateOutboundMessage(outboundId, {
      status: "failed",
      verificationStatus: "failed",
      failedAt: new Date().toISOString(),
      error: { message: body?.error || "provider failed" },
    });
  }

  return { success: true, duplicate: false, eventId: event.id };
}
