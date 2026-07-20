/**
 * Wazzup User API v3 provider.
 * chatType: whatsapp, telegram, viber, whatsgroup, instagram (+ max/maxgroup if API returns).
 * transport: whatsapp, wapi, telegram, tgapi, max, maxbot, …
 * Idempotency via crmMessageId.
 */

import { CommunicationProvider } from "./providerBase.js";
import { createWazzupClient } from "./wazzupClient.js";
import { CommunicationError, getCommunicationsConfig, CHAT_TYPES } from "../config.js";
import { normalizeWazzupWebhook } from "../webhookNormalizer.js";

function mapChannelState(raw) {
  const s = String(raw || "").toLowerCase();
  if (["active", "authorized", "ok", "ready"].includes(s)) return "active";
  if (["qr", "notauthorized", "not_authorized", "unauthorized"].includes(s)) return "unauthorized";
  if (["disabled", "inactive", "blocked", "rejected"].includes(s)) return "inactive";
  return s || "unknown";
}

function capabilitiesForTransport(transport) {
  const t = String(transport || "").toLowerCase();
  return {
    canSend: true,
    canReceive: true,
    supportsTemplates: t === "wapi",
    supportsReadReceipts: t === "wapi" || t === "whatsapp",
    requiresKnownChatId: t === "tgapi" || t === "telegram" || t === "max" || t === "maxbot",
    transport: t || null,
  };
}

export class WazzupProvider extends CommunicationProvider {
  constructor(options = {}) {
    super("wazzup");
    this.client = options.client || createWazzupClient(options);
  }

  isEnabled() {
    const cfg = getCommunicationsConfig();
    return cfg.wazzup.enabled && cfg.wazzup.apiKeyConfigured;
  }

  async testConnection() {
    if (!this.isEnabled()) {
      throw new CommunicationError(
        "WAZZUP_DISABLED",
        "Wazzup выключен (WAZZUP_ENABLED) или API key не задан."
      );
    }
    const { data, durationMs } = await this.client.get("/v3/channels");
    const channels = Array.isArray(data) ? data : data?.channels || [];
    return {
      ok: true,
      provider: this.name,
      channelCount: channels.length,
      durationMs,
      checkedAt: new Date().toISOString(),
    };
  }

  async listChannels() {
    if (!this.isEnabled()) {
      throw new CommunicationError(
        "WAZZUP_DISABLED",
        "Wazzup выключен (WAZZUP_ENABLED) или API key не задан."
      );
    }
    const { data } = await this.client.get("/v3/channels");
    const rows = Array.isArray(data) ? data : data?.channels || [];
    return rows.map((row) => {
      const transport = String(row.transport || row.channelType || "").toLowerCase() || null;
      const plainId = row.plainId != null ? String(row.plainId) : row.phone != null ? String(row.phone) : null;
      const state = mapChannelState(row.state || row.status);
      return {
        provider: this.name,
        externalChannelId: String(row.channelId || row.id || ""),
        transport,
        displayName: row.name || row.displayName || plainId || transport || "Wazzup channel",
        plainId,
        state,
        capabilities: capabilitiesForTransport(transport),
        rawSafe: {
          transport,
          state,
          hasPlainId: Boolean(plainId),
        },
      };
    });
  }

  async sendMessage(payload = {}) {
    if (!this.isEnabled()) {
      throw new CommunicationError(
        "WAZZUP_DISABLED",
        "Wazzup выключен — отправка невозможна."
      );
    }

    const channelId = payload.channelId || payload.externalChannelId;
    const chatType = String(payload.chatType || "").toLowerCase();
    if (!channelId) {
      throw new CommunicationError("WAZZUP_INVALID_PAYLOAD", "channelId обязателен.");
    }
    if (!chatType || !CHAT_TYPES.includes(chatType)) {
      throw new CommunicationError(
        "WAZZUP_INVALID_CHAT_TYPE",
        `Неподдерживаемый chatType: ${chatType || "(пусто)"}`,
        { allowed: CHAT_TYPES }
      );
    }
    if (!payload.crmMessageId) {
      throw new CommunicationError(
        "WAZZUP_CRM_MESSAGE_ID_REQUIRED",
        "crmMessageId обязателен для идемпотентности Wazzup."
      );
    }
    if (!payload.text && !payload.contentUri && !payload.templateId) {
      throw new CommunicationError(
        "WAZZUP_INVALID_PAYLOAD",
        "Нужен text, contentUri или templateId."
      );
    }

    const body = {
      channelId,
      chatType,
      crmMessageId: String(payload.crmMessageId),
    };
    if (payload.chatId) body.chatId = String(payload.chatId);
    if (payload.phone) body.phone = String(payload.phone);
    if (payload.username) body.username = String(payload.username).replace(/^@/, "");
    if (payload.text) body.text = String(payload.text);
    if (payload.contentUri) body.contentUri = String(payload.contentUri);
    if (payload.refMessageId) body.refMessageId = String(payload.refMessageId);
    if (payload.crmUserId) body.crmUserId = String(payload.crmUserId);
    if (payload.clearUnanswered != null) body.clearUnanswered = Boolean(payload.clearUnanswered);
    if (payload.templateId) {
      body.templateId = String(payload.templateId);
      if (Array.isArray(payload.templateValues)) body.templateValues = payload.templateValues.map(String);
    }
    if (payload.buttonsObject) body.buttonsObject = payload.buttonsObject;

    const { data, durationMs } = await this.client.post("/v3/message", body);
    return {
      provider: this.name,
      externalMessageId: data?.messageId || data?.id || null,
      crmMessageId: payload.crmMessageId,
      status: data?.status || "accepted",
      durationMs,
      rawSafe: {
        hasMessageId: Boolean(data?.messageId || data?.id),
      },
    };
  }

  async getTemplates(options = {}) {
    if (!this.isEnabled()) {
      throw new CommunicationError("WAZZUP_DISABLED", "Wazzup выключен.");
    }
    const query = {};
    if (options.channelId) query.channelId = options.channelId;
    const { data } = await this.client.get("/v3/templates/whatsapp", query);
    const rows = Array.isArray(data) ? data : data?.templates || [];
    return rows.map((t) => ({
      provider: this.name,
      templateId: String(t.templateId || t.id || ""),
      name: t.name || t.templateName || null,
      status: t.status || t.moderationStatus || null,
      language: t.language || null,
      category: t.category || null,
      channelId: t.channelId || options.channelId || null,
    }));
  }

  async subscribeWebhook(config = {}) {
    if (!this.isEnabled()) {
      throw new CommunicationError("WAZZUP_DISABLED", "Wazzup выключен.");
    }
    if (!config.webhooksUri) {
      throw new CommunicationError("WAZZUP_WEBHOOK_URI_REQUIRED", "webhooksUri обязателен.");
    }
    const body = {
      webhooksUri: String(config.webhooksUri),
      subscriptions: {
        messagesAndStatuses: config.messagesAndStatuses !== false,
        contactsAndDealsCreation: Boolean(config.contactsAndDealsCreation),
        channelsUpdates: config.channelsUpdates !== false,
        templateStatus: Boolean(config.templateStatus),
      },
    };
    const { data } = await this.client.patch("/v3/webhooks", body);
    return { ok: true, provider: this.name, result: data === "ok" || data?.ok !== false };
  }

  async normalizeWebhook(payload) {
    return normalizeWazzupWebhook(payload);
  }

  async getCapabilities(channel) {
    const transport = channel?.transport || channel;
    return capabilitiesForTransport(transport);
  }
}

export function createWazzupProvider(options) {
  return new WazzupProvider(options);
}
