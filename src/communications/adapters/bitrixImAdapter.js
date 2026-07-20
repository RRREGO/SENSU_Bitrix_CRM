/**
 * Базовые адаптеры каналов. Send только при capabilities.canSend.
 */

import { callReadMethod, callWriteMethod } from "../../bitrixClient.js";
import { CommunicationError } from "../config.js";

function caps(extra = {}) {
  return {
    canSend: false,
    canRead: false,
    supportsDeliveryStatus: false,
    supportsAttachments: false,
    supportsSubject: false,
    supportsReplyToConversation: false,
    ...extra,
  };
}

export const bitrixImAdapter = {
  id: "bitrix_im",
  channel: "bitrix_chat",
  provider: "Bitrix IM",
  capabilities: caps({ canSend: false }),

  async detect() {
    const warnings = [];
    let status = "not_configured";
    let canSend = false;
    let lastError = null;
    try {
      // Read probe: user.current or im.recent.list — soft
      await callReadMethod("user.current", {});
      try {
        await callReadMethod("im.recent.list", { LIMIT: 1 });
        canSend = true;
        status = "available_write_only";
      } catch (error) {
        lastError = { code: "IM_SCOPE", message: error.message };
        status = /ACCESS|SCOPE|permission|denied/i.test(error.message)
          ? "insufficient_scope"
          : "configured_but_api_unavailable";
        warnings.push({
          code: "CHANNEL_SCOPE_REQUIRED",
          message: "Права «Чат и уведомления» необходимы для im.message.add.",
        });
      }
    } catch (error) {
      lastError = { code: "DETECT_FAILED", message: error.message };
      status = "not_configured";
    }
    this.capabilities = caps({
      canSend,
      canRead: false,
      supportsDeliveryStatus: false,
    });
    return {
      id: this.id,
      channel: this.channel,
      provider: this.provider,
      status,
      capabilities: this.capabilities,
      warnings,
      lastError,
    };
  },

  async validateRecipient(recipient) {
    if (!recipient?.userId && !recipient?.dialogId) {
      throw new CommunicationError(
        "MESSAGE_RECIPIENT_NOT_FOUND",
        "Для внутреннего чата нужен userId сотрудника Bitrix24."
      );
    }
    return true;
  },

  async preparePayload({ body, recipient }) {
    await this.validateRecipient(recipient);
    return {
      method: "im.message.add",
      params: {
        DIALOG_ID: recipient.dialogId || String(recipient.userId),
        MESSAGE: body,
      },
    };
  },

  async send(payload) {
    const result = await callWriteMethod(payload.method, payload.params);
    const externalId =
      result?.id ||
      result?.ID ||
      result?.messageId ||
      (typeof result === "number" || typeof result === "string" ? result : null);
    return {
      success: true,
      externalMessageId: externalId != null ? String(externalId) : null,
      raw: { accepted: true },
    };
  },

  async verifyDelivery() {
    return { status: "unavailable", verificationStatus: "unavailable" };
  },
};

export const bitrixEmailAdapter = {
  id: "bitrix_email",
  channel: "email",
  provider: "Bitrix CRM Email",
  capabilities: caps({ supportsSubject: true, canRead: true }),

  async detect() {
    const warnings = [];
    let status = "available_read_only";
    let lastError = null;
    try {
      await callReadMethod("crm.activity.list", {
        filter: { TYPE_ID: 4 },
        select: ["ID"],
        start: 0,
      });
    } catch (error) {
      lastError = { code: "EMAIL_DETECT", message: error.message };
      status = /ACCESS|SCOPE|denied/i.test(error.message)
        ? "insufficient_scope"
        : "not_configured";
    }
    warnings.push({
      code: "CHANNEL_SEND_NOT_SUPPORTED",
      message:
        "Безопасная REST-отправка email через SMTP в текущем webhook не подтверждена. Доступен только черновик.",
    });
    this.capabilities = caps({
      canSend: false,
      canRead: status === "available_read_only",
      supportsSubject: true,
    });
    return {
      id: this.id,
      channel: this.channel,
      provider: this.provider,
      status,
      capabilities: this.capabilities,
      warnings,
      lastError,
    };
  },

  async validateRecipient(recipient) {
    if (!recipient?.email) {
      throw new CommunicationError("MESSAGE_RECIPIENT_NOT_FOUND", "Email получателя не найден.");
    }
    return true;
  },

  async preparePayload() {
    throw new CommunicationError(
      "CHANNEL_SEND_NOT_SUPPORTED",
      "Отправка email через CRM Assistant отключена: нет безопасного REST send без SMTP."
    );
  },

  async send() {
    throw new CommunicationError("CHANNEL_SEND_NOT_SUPPORTED", "Отправка email недоступна.");
  },

  async verifyDelivery() {
    return { status: "unavailable", verificationStatus: "unavailable" };
  },
};

export const bitrixOpenLinesAdapter = {
  id: "bitrix_open_lines",
  channel: "open_lines",
  provider: "Bitrix Open Lines",
  capabilities: caps({ supportsReplyToConversation: true }),

  async detect() {
    const warnings = [];
    let status = "not_configured";
    let lastError = null;
    let canSend = false;
    const tryMethods = [
      ["imopenlines.config.list.get", {}],
      ["imopenlines.config.get", {}],
    ];
    for (const [method, params] of tryMethods) {
      try {
        await callReadMethod(method, params);
        status = "configured_but_api_unavailable";
        warnings.push({
          code: "CHANNEL_SEND_NOT_SUPPORTED",
          message:
            "Open Lines обнаружены или доступны частично; безопасный send не активирован без подтверждённого метода на портале.",
        });
        break;
      } catch (error) {
        lastError = { code: method, message: error.message };
        if (/ACCESS|SCOPE|denied|permission/i.test(error.message)) {
          status = "insufficient_scope";
        }
      }
    }
    this.capabilities = caps({
      canSend,
      canRead: false,
      supportsReplyToConversation: true,
      supportsDeliveryStatus: false,
    });
    return {
      id: this.id,
      channel: this.channel,
      provider: this.provider,
      status,
      capabilities: this.capabilities,
      warnings,
      lastError,
    };
  },

  async validateRecipient() {
    throw new CommunicationError(
      "CHANNEL_SEND_NOT_SUPPORTED",
      "Отправка через Open Lines недоступна для текущего webhook."
    );
  },

  async preparePayload() {
    throw new CommunicationError("CHANNEL_SEND_NOT_SUPPORTED", "Open Lines send недоступен.");
  },

  async send() {
    throw new CommunicationError("CHANNEL_SEND_NOT_SUPPORTED", "Open Lines send недоступен.");
  },

  async verifyDelivery() {
    return { status: "unavailable", verificationStatus: "unavailable" };
  },
};

/** WhatsApp / Telegram через OL или сторонний провайдер — без выдуманного API. */
export function createProviderChannelAdapter(channel, providerLabel) {
  return {
    id: `provider_${channel}`,
    channel,
    provider: providerLabel,
    capabilities: caps({}),

    async detect() {
      const ol = await bitrixOpenLinesAdapter.detect();
      let status = "not_configured";
      const warnings = [
        {
          code: "PROVIDER_SPECIFIC",
          message: `${providerLabel}: не используем неофициальный/сторонний REST без явной поддержки. Проверка через Open Lines: ${ol.status}.`,
        },
      ];
      if (ol.status === "insufficient_scope") status = "insufficient_scope";
      else if (ol.status !== "not_configured") status = "configured_but_api_unavailable";
      else status = "provider_specific";
      this.capabilities = caps({ canSend: false });
      return {
        id: this.id,
        channel: this.channel,
        provider: this.provider,
        status,
        capabilities: this.capabilities,
        warnings: [...warnings, ...(ol.warnings || [])],
        lastError: ol.lastError,
      };
    },

    async validateRecipient() {
      throw new CommunicationError(
        "CHANNEL_SEND_NOT_SUPPORTED",
        `Канал ${channel} не поддерживает отправку через текущий webhook.`
      );
    },

    async preparePayload() {
      throw new CommunicationError("CHANNEL_SEND_NOT_SUPPORTED", `Send ${channel} недоступен.`);
    },

    async send() {
      throw new CommunicationError("CHANNEL_SEND_NOT_SUPPORTED", `Send ${channel} недоступен.`);
    },

    async verifyDelivery() {
      return { status: "unavailable", verificationStatus: "unavailable" };
    },
  };
}

export const whatsappAdapter = createProviderChannelAdapter("whatsapp", "WhatsApp / Open Lines");
export const telegramAdapter = createProviderChannelAdapter("telegram", "Telegram / Open Lines");
