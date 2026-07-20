/**
 * Normalize Wazzup webhook payloads (messages[], statuses[], channelsUpdates[]).
 * Real fields only. Hash for idempotency.
 */

import crypto from "crypto";

function hashPayload(parts) {
  return crypto.createHash("sha256").update(parts.filter((p) => p != null).join("|")).digest("hex");
}

function safeError(err) {
  if (!err || typeof err !== "object") return null;
  return {
    code: err.error || err.code || null,
    description: err.description ? String(err.description).slice(0, 300) : null,
  };
}

export function normalizeWazzupMessage(msg) {
  if (!msg || typeof msg !== "object") return null;
  const status = String(msg.status || "").toLowerCase();
  const isEcho = Boolean(msg.isEcho);
  let direction = "outbound";
  if (status === "inbound" || (!isEcho && status === "inbound")) direction = "inbound";
  if (status === "inbound") direction = "inbound";
  else if (isEcho) direction = "outbound_echo";
  else direction = "outbound";

  const contact = msg.contact && typeof msg.contact === "object" ? msg.contact : null;

  return {
    type: "message",
    provider: "wazzup",
    externalMessageId: msg.messageId || null,
    channelId: msg.channelId || null,
    chatType: msg.chatType || null,
    chatId: msg.chatId != null ? String(msg.chatId) : null,
    dateTime: msg.dateTime || null,
    messageType: msg.type || null,
    status,
    direction,
    text: msg.text != null ? String(msg.text) : null,
    contentUri: msg.contentUri || null,
    authorName: msg.authorName || null,
    authorId: msg.authorId || null,
    isEcho,
    sentFromApp: Boolean(msg.sentFromApp),
    isEdited: Boolean(msg.isEdited),
    isDeleted: Boolean(msg.isDeleted),
    error: safeError(msg.error),
    contact: contact
      ? {
          name: contact.name || null,
          username: contact.username || null,
          phone: contact.phone || null,
        }
      : null,
    quotedMessageId: msg.quotedMessage?.messageId || msg.quotedMessage?.id || null,
    eventHash: hashPayload([
      "wazzup",
      "message",
      msg.messageId,
      status,
      msg.dateTime,
      msg.isEdited ? "edited" : "",
      msg.isDeleted ? "deleted" : "",
      msg.text ? crypto.createHash("sha256").update(String(msg.text)).digest("hex").slice(0, 16) : "",
    ]),
  };
}

export function normalizeWazzupStatus(st) {
  if (!st || typeof st !== "object") return null;
  return {
    type: "status",
    provider: "wazzup",
    externalMessageId: st.messageId || null,
    timestamp: st.timestamp || null,
    status: String(st.status || "").toLowerCase(),
    error: safeError(st.error),
    eventHash: hashPayload(["wazzup", "status", st.messageId, st.status, st.timestamp]),
  };
}

export function normalizeWazzupChannelUpdate(ch) {
  if (!ch || typeof ch !== "object") return null;
  return {
    type: "channel_update",
    provider: "wazzup",
    channelId: ch.channelId || ch.id || null,
    state: ch.state || ch.status || null,
    transport: ch.transport || null,
    eventHash: hashPayload([
      "wazzup",
      "channel",
      ch.channelId || ch.id,
      ch.state || ch.status,
      ch.updatedAt || ch.timestamp || "",
    ]),
  };
}

/**
 * Normalize full webhook body. Supports messages, statuses, channelsUpdates.
 * Test ping { test: true } → type test.
 */
export function normalizeWazzupWebhook(payload) {
  if (!payload || typeof payload !== "object") {
    return { provider: "wazzup", events: [], unknown: true };
  }

  if (payload.test === true) {
    return {
      provider: "wazzup",
      events: [
        {
          type: "test",
          provider: "wazzup",
          eventHash: hashPayload(["wazzup", "test", String(Date.now())]),
        },
      ],
      unknown: false,
    };
  }

  const events = [];
  let unknownKeys = [];

  if (Array.isArray(payload.messages)) {
    for (const m of payload.messages) {
      const n = normalizeWazzupMessage(m);
      if (n) events.push(n);
    }
  }
  if (Array.isArray(payload.statuses)) {
    for (const s of payload.statuses) {
      const n = normalizeWazzupStatus(s);
      if (n) events.push(n);
    }
  }
  if (Array.isArray(payload.channelsUpdates)) {
    for (const c of payload.channelsUpdates) {
      const n = normalizeWazzupChannelUpdate(c);
      if (n) events.push(n);
    }
  }

  const known = new Set(["messages", "statuses", "channelsUpdates", "test", "createContact", "createDeal", "templateStatus"]);
  unknownKeys = Object.keys(payload).filter((k) => !known.has(k));

  // templateStatus array if present (optional subscription)
  if (Array.isArray(payload.templateStatus)) {
    for (const t of payload.templateStatus) {
      events.push({
        type: "template_status",
        provider: "wazzup",
        templateId: t.templateId || t.id || null,
        status: t.status || null,
        eventHash: hashPayload(["wazzup", "template", t.templateId || t.id, t.status]),
      });
    }
  }

  const hasKnown =
    Array.isArray(payload.messages) ||
    Array.isArray(payload.statuses) ||
    Array.isArray(payload.channelsUpdates) ||
    Array.isArray(payload.templateStatus);

  return {
    provider: "wazzup",
    events,
    unknown: !hasKnown && events.length === 0,
    unknownKeys,
    warning:
      !hasKnown && events.length === 0
        ? "Неизвестный тип webhook — событие сохранено как предупреждение, не как успешно обработанное известное."
        : unknownKeys.length
          ? `Неизвестные поля проигнорированы: ${unknownKeys.join(", ")}`
          : null,
  };
}

export function computeEventHash(provider, type, ...parts) {
  return hashPayload([provider, type, ...parts]);
}
