/**
 * Official MAX Bot API provider (dev.max.ru).
 * Auth: Authorization: {token} WITHOUT Bearer prefix.
 * Send: POST /messages?chat_id=... or ?user_id=... with body { text }.
 * Disabled by default. Only known chatId. No phone-based cold outreach.
 */

import crypto from "crypto";
import { CommunicationProvider } from "./providerBase.js";
import { CommunicationError, getCommunicationsConfig } from "../config.js";
import { computeEventHash } from "../webhookNormalizer.js";

function timingSafeEqualString(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export class MaxBotProvider extends CommunicationProvider {
  constructor(options = {}) {
    super("max_bot");
    const cfg = getCommunicationsConfig();
    this.apiBase = (options.apiBase || cfg.maxBot.apiBase || "").replace(/\/$/, "");
    this.token = options.token ?? cfg.maxBot._token;
    this.timeoutMs = options.timeoutMs || cfg.maxBot.requestTimeoutMs;
    this.webhookSecret = options.webhookSecret ?? cfg.maxBot._webhookSecret;
    this.fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
  }

  isEnabled() {
    const cfg = getCommunicationsConfig();
    return cfg.maxBot.enabled && cfg.maxBot.tokenConfigured && Boolean(this.apiBase);
  }

  /**
   * Verify X-Max-Bot-Api-Secret header and/or URL secret.
   */
  verifyWebhookSecret(provided, headerSecret) {
    if (!this.webhookSecret) {
      throw new CommunicationError(
        "MAX_WEBHOOK_SECRET_NOT_CONFIGURED",
        "MAX_WEBHOOK_SECRET не задан."
      );
    }
    const urlOk =
      provided != null &&
      provided !== "" &&
      timingSafeEqualString(provided, this.webhookSecret);
    const headerOk =
      headerSecret != null &&
      headerSecret !== "" &&
      timingSafeEqualString(headerSecret, this.webhookSecret);
    if (!urlOk && !headerOk) {
      throw new CommunicationError("MAX_WEBHOOK_FORBIDDEN", "Неверный секрет webhook MAX.");
    }
    return true;
  }

  async request(method, path, body, { query } = {}) {
    if (!this.isEnabled()) {
      throw new CommunicationError(
        "MAX_BOT_DISABLED",
        "MaxBotProvider выключен. Используйте Wazzup для transport max/maxbot, если канал есть в /v3/channels."
      );
    }

    let url = `${this.apiBase}${path.startsWith("/") ? path : `/${path}`}`;
    if (query && Object.keys(query).length) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v != null && v !== "") qs.set(k, String(v));
      }
      const s = qs.toString();
      if (s) url += (url.includes("?") ? "&" : "?") + s;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          // Official MAX Bot API: token without Bearer prefix
          Authorization: String(this.token),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        throw new CommunicationError(
          res.status === 401 ? "MAX_BOT_UNAUTHORIZED" : "MAX_BOT_REQUEST_FAILED",
          "MAX Bot API вернул ошибку.",
          { status: res.status, retryable }
        );
      }
      return parsed;
    } catch (error) {
      if (error instanceof CommunicationError) throw error;
      if (error?.name === "AbortError") {
        throw new CommunicationError("MAX_BOT_TIMEOUT", "MAX Bot API: таймаут.", {
          retryable: true,
        });
      }
      throw new CommunicationError("MAX_BOT_NETWORK_ERROR", "MAX Bot API: сетевая ошибка.", {
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection() {
    if (!this.isEnabled()) {
      return {
        ok: false,
        provider: this.name,
        reason: "disabled_or_not_configured",
        message:
          "MaxBotProvider выключен по умолчанию. Включите MAX_BOT_ENABLED и задайте MAX_BOT_API_BASE + MAX_BOT_TOKEN только для официального Bot API.",
      };
    }
    const me = await this.request("GET", "/me");
    return {
      ok: true,
      provider: this.name,
      botId: me?.user_id || me?.id || null,
      checkedAt: new Date().toISOString(),
    };
  }

  async listChannels() {
    if (!this.isEnabled()) return [];
    return [
      {
        provider: this.name,
        externalChannelId: "max_bot",
        transport: "maxbot",
        displayName: "MAX Bot API",
        plainId: null,
        state: "active",
        capabilities: await this.getCapabilities("max"),
      },
    ];
  }

  async sendMessage(payload = {}) {
    if (!this.isEnabled()) {
      throw new CommunicationError("MAX_BOT_DISABLED", "Прямой MAX Bot API выключен.");
    }
    const chatId = payload.chatId || payload.externalChatId;
    const userId = payload.userId || null;
    if (!chatId && !userId) {
      throw new CommunicationError(
        "MAX_CHAT_ID_REQUIRED",
        "MaxBotProvider отправляет только в известный chatId (или user_id). Отправка по номеру телефона не поддерживается."
      );
    }
    if (payload.phone && !chatId && !userId) {
      throw new CommunicationError(
        "MAX_PHONE_SEND_FORBIDDEN",
        "Нельзя имитировать отправку в MAX по номеру телефона."
      );
    }
    const text = String(payload.text || "").trim();
    if (!text) {
      throw new CommunicationError("MAX_EMPTY_TEXT", "Текст сообщения пуст.");
    }

    const query = chatId ? { chat_id: String(chatId) } : { user_id: String(userId) };
    const data = await this.request("POST", "/messages", { text }, { query });

    return {
      provider: this.name,
      externalMessageId: data?.message?.body?.mid || data?.message_id || data?.id || null,
      crmMessageId: payload.crmMessageId || null,
      status: "accepted",
      rawSafe: { hasMessageId: true },
    };
  }

  async getTemplates() {
    return [];
  }

  /**
   * POST /subscriptions when MAX_BOT_SUBSCRIBE_WEBHOOK=true and webhook URL provided.
   */
  async subscribeWebhook(options = {}) {
    if (!this.isEnabled()) {
      throw new CommunicationError("MAX_BOT_DISABLED", "MaxBotProvider выключен.");
    }
    const url = options.url || process.env.MAX_BOT_WEBHOOK_URL || "";
    if (!url) {
      throw new CommunicationError(
        "MAX_SUBSCRIBE_URL_REQUIRED",
        "Укажите url для POST /subscriptions или MAX_BOT_WEBHOOK_URL."
      );
    }
    if (!/^(1|true|yes|on)$/i.test(String(process.env.MAX_BOT_SUBSCRIBE_WEBHOOK || ""))) {
      throw new CommunicationError(
        "MAX_SUBSCRIBE_DISABLED",
        "Автоподписка выключена. Задайте MAX_BOT_SUBSCRIBE_WEBHOOK=true для вызова POST /subscriptions."
      );
    }
    const body = {
      url,
      update_types: options.updateTypes || [
        "message_created",
        "message_edited",
        "bot_started",
        "bot_added",
        "bot_removed",
      ],
    };
    if (this.webhookSecret) body.secret = this.webhookSecret;
    const data = await this.request("POST", "/subscriptions", body);
    return { success: true, subscribed: true, provider: this.name, result: data };
  }

  async normalizeWebhook(payload) {
    const updates = Array.isArray(payload?.updates)
      ? payload.updates
      : payload?.update_type || payload?.type
        ? [payload]
        : [];
    const events = [];
    for (const u of updates) {
      const type = u?.update_type || u?.type || "unknown";
      if (type === "message_created" || type === "message" || type === "message_edited") {
        const msg = u.message || u;
        const mid = msg?.body?.mid || msg?.id || null;
        const chatId = String(msg?.recipient?.chat_id || msg?.chat_id || u.chat_id || "");
        const text = msg?.body?.text || msg?.text || null;
        events.push({
          type: "message",
          provider: this.name,
          direction: "inbound",
          externalMessageId: mid,
          chatId,
          chatType: "max",
          transport: "maxbot",
          text,
          timestamp: u.timestamp ? new Date(u.timestamp).toISOString() : new Date().toISOString(),
          status: "inbound",
          eventHash: computeEventHash(
            this.name,
            "message",
            mid,
            chatId,
            String(u.timestamp || ""),
            text ? crypto.createHash("sha256").update(String(text)).digest("hex").slice(0, 16) : ""
          ),
        });
      } else {
        events.push({
          type: "unknown",
          provider: this.name,
          rawType: type,
          eventHash: computeEventHash(this.name, "unknown", type, String(u.timestamp || Date.now())),
        });
      }
    }
    return { provider: this.name, events };
  }

  async getCapabilities() {
    return {
      canSend: this.isEnabled(),
      canReceive: this.isEnabled(),
      supportsTemplates: false,
      supportsReadReceipts: false,
      requiresKnownChatId: true,
      phoneOutreachSupported: false,
    };
  }
}

export function createMaxBotProvider(options) {
  return new MaxBotProvider(options);
}
