/**
 * Политика коммуникации перед prepare/send.
 * Legacy asserts сохранены для client_message_send; Hub использует evaluateSendPolicy.
 */

import { getContactMethodologyConfig } from "../config/contactMethodology.js";
import {
  CommunicationError,
  getCommunicationsConfig,
  assertCommunicationFlagsOk,
  CONGRATS_ONLY_CATEGORIES,
  FIRST_CONTACT_GROUNDS,
} from "./config.js";
import { getAdapterByChannel } from "./channelRegistry.js";
import { listStoredChannels } from "./capabilityService.js";
import * as repo from "./communicationRepository.js";

export function assertSingleRecipient(params = {}) {
  if (Array.isArray(params.recipients) && params.recipients.length > 1) {
    throw new CommunicationError(
      "BULK_MESSAGING_BLOCKED",
      "Массовая отправка сообщений отключена."
    );
  }
  if (Array.isArray(params.contactIds) && params.contactIds.length > 1) {
    throw new CommunicationError(
      "BULK_MESSAGING_BLOCKED",
      "Массовая отправка сообщений отключена."
    );
  }
  if (params.bulk === true || params.affectedCount > 1) {
    throw new CommunicationError(
      "BULK_MESSAGING_BLOCKED",
      "Массовая отправка сообщений отключена."
    );
  }
}

export function assertMessageLength(channel, body) {
  const cfg = getCommunicationsConfig();
  const max = cfg.maxChars[channel] || cfg.maxChars.whatsapp;
  const len = String(body || "").length;
  if (len > max) {
    throw new CommunicationError(
      "MESSAGE_TOO_LONG",
      `Текст превышает лимит канала (${max} символов). Сократите черновик.`,
      { length: len, max }
    );
  }
  return { length: len, max };
}

export function assertContactAllowed(statusValue, { allowPersonal = false, personalCommunicationReason = "" } = {}) {
  const methodology = getContactMethodologyConfig();
  const val = statusValue != null ? String(statusValue) : "";
  if (!val) return { ok: true };

  if (methodology.statusSpamValues.map(String).includes(val)) {
    throw new CommunicationError(
      "CLIENT_COMMUNICATION_BLOCKED",
      "Для контакта установлен статус, запрещающий коммуникацию (Спам).",
      { reason: "spam" }
    );
  }
  if (methodology.statusDoNotContactValues.map(String).includes(val)) {
    throw new CommunicationError(
      "CLIENT_COMMUNICATION_BLOCKED",
      "Для контакта установлен статус «Не трогать».",
      { reason: "do_not_contact" }
    );
  }
  if (methodology.statusPersonalValues.map(String).includes(val)) {
    if (!allowPersonal || !String(personalCommunicationReason || "").trim()) {
      throw new CommunicationError(
        "CLIENT_COMMUNICATION_BLOCKED",
        "Контакт имеет статус «Личный». Нужны allowPersonal=true и personalCommunicationReason.",
        { reason: "personal" }
      );
    }
  }
  return { ok: true, personal: methodology.statusPersonalValues.map(String).includes(val) };
}

export function assertChannelSendAvailable(channel) {
  const adapter = getAdapterByChannel(channel);
  if (!adapter) {
    throw new CommunicationError("CHANNEL_NOT_AVAILABLE", `Канал «${channel}» неизвестен.`);
  }
  const stored = listStoredChannels().find((c) => c.channel === channel);
  const canSend = stored?.capabilities?.canSend ?? adapter.capabilities?.canSend;
  if (!canSend) {
    throw new CommunicationError(
      "CHANNEL_SEND_NOT_SUPPORTED",
      `Канал «${channel}» не поддерживает отправку для текущего webhook.`,
      { status: stored?.status || "unknown" }
    );
  }
  return adapter;
}

export function buildConfirmationPhrase(recipientName) {
  const name = String(recipientName || "ПОЛУЧАТЕЛЮ")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  return `ОТПРАВИТЬ СООБЩЕНИЕ ${name}`;
}

export function requiresStrongConfirmation(channel) {
  return ["whatsapp", "telegram", "email", "open_lines", "max", "wapi"].includes(
    String(channel || "").toLowerCase()
  );
}

function deny(code, message, details = {}) {
  return { allowed: false, code, message, details };
}

function allow(details = {}) {
  return { allowed: true, code: null, message: null, details };
}

function parseTimeToMinutes(hhmm) {
  const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Quiet hours in configured timezone (best-effort via Intl).
 */
export function isQuietHours(now = new Date(), cfg = getCommunicationsConfig()) {
  const start = parseTimeToMinutes(cfg.quietHoursStart);
  const end = parseTimeToMinutes(cfg.quietHoursEnd);
  if (start == null || end == null) return false;

  let weekday;
  let minutes;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: cfg.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    minutes = hour * 60 + minute;
    const wd = parts.find((p) => p.type === "weekday")?.value;
    const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    weekday = map[wd] || now.getDay() || 7;
  } catch {
    minutes = now.getHours() * 60 + now.getMinutes();
    weekday = now.getDay() === 0 ? 7 : now.getDay();
  }

  if (cfg.allowedWeekdays?.length && !cfg.allowedWeekdays.includes(weekday)) {
    return true;
  }

  if (start === end) return false;
  if (start < end) {
    return minutes >= start && minutes < end;
  }
  // overnight window e.g. 19:00–09:00
  return minutes >= start || minutes < end;
}

function statusKind(statusValue) {
  const methodology = getContactMethodologyConfig();
  const val = statusValue != null ? String(statusValue) : "";
  if (!val) return null;
  if (methodology.statusSpamValues.map(String).includes(val)) return "spam";
  if (methodology.statusDoNotContactValues.map(String).includes(val)) return "dont_touch";
  if (methodology.statusPersonalValues.map(String).includes(val)) return "personal";
  if (methodology.statusCongratsOnlyValues.map(String).includes(val)) return "congrats_only";
  if (methodology.statusNoContactValues.map(String).includes(val)) return "no_contact";
  return null;
}

function isCongratsOnlyStatus(statusValue) {
  if (statusKind(statusValue) === "congrats_only") return true;
  const mapping = repo.getFieldMapping("status_congrats_only");
  if (mapping?.bitrixEnumValues?.length) {
    return mapping.bitrixEnumValues.map(String).includes(String(statusValue));
  }
  return false;
}

/**
 * Unified send policy for Hub (single + campaign + sequence + outbox).
 * @returns {{ allowed: boolean, code: string|null, message: string|null, details: object }}
 */
export function evaluateSendPolicy(ctx = {}) {
  const cfg = getCommunicationsConfig();

  if (!cfg.enabled && !ctx.ignoreEnabledFlag) {
    return deny("COMMUNICATIONS_DISABLED", "Communications Hub выключен (COMMUNICATIONS_ENABLED=false).");
  }

  if (ctx.resolutionStatus === "ambiguous" || ctx.ambiguousContact) {
    return deny(
      "AMBIGUOUS_CONTACT",
      "Контакт неоднозначен — автоотправка запрещена.",
      { identityId: ctx.identityId || null }
    );
  }

  if (ctx.resolutionStatus === "unresolved" && !ctx.contactId) {
    return deny("CONTACT_UNRESOLVED", "Контакт не сопоставлен.", {
      identityId: ctx.identityId || null,
    });
  }

  const kind = statusKind(ctx.statusValue);
  if (kind === "spam") {
    return deny("STATUS_SPAM", "Статус «Спам» — коммуникация запрещена.");
  }
  if (kind === "dont_touch") {
    return deny("STATUS_DONT_TOUCH", "Статус «Не трогать» — коммуникация запрещена.");
  }
  if (kind === "personal") {
    if (!ctx.allowPersonal || !String(ctx.personalCommunicationReason || "").trim()) {
      return deny(
        "STATUS_PERSONAL",
        "Статус «Личный» — нужны allowPersonal и personalCommunicationReason."
      );
    }
  }

  if (ctx.contactId) {
    const suppression = repo.findActiveSuppression(ctx.contactId, {
      phone: ctx.phoneNormalized,
      channel: ctx.channel,
    });
    if (suppression) {
      return deny("SUPPRESSION", "Контакт в списке suppression.", {
        reason: suppression.reason,
        source: suppression.source,
      });
    }
  }

  if (ctx.optedOut) {
    return deny("OPT_OUT", "Контакт отписался от сообщений.");
  }

  const address =
    ctx.externalChatId || ctx.chatId || ctx.phone || ctx.username || ctx.recipientAddress;
  if (!address && !ctx.skipAddressCheck) {
    const ch = String(ctx.chatType || ctx.channel || ctx.transport || "").toLowerCase();
    if (ch === "telegram" || ch === "tgapi") {
      return deny(
        "NO_ADDRESS",
        "Нет адреса Telegram: у контакта не заполнен username, нет chatId и нет identity Hub."
      );
    }
    if (ch === "max" || ch === "maxbot") {
      return deny("NO_ADDRESS", "Нет chatId MAX у контакта.");
    }
    return deny("NO_ADDRESS", "Нет разрешённого адреса канала.");
  }

  const channelState = ctx.channelState || ctx.channel?.state;
  if (channelState && !["active", "authorized", "ok", "ready"].includes(String(channelState).toLowerCase())) {
    return deny("INACTIVE_CHANNEL", "Канал выключен или не авторизован.", {
      state: channelState,
    });
  }

  if (ctx.channelInactive) {
    return deny("INACTIVE_CHANNEL", "Канал выключен или не авторизован.");
  }

  if (ctx.contactId && !ctx.skipDailyLimit) {
    const sentToday = repo.countMessagesForContactToday(ctx.contactId);
    if (sentToday >= cfg.maxMessagesPerContactPerDay) {
      return deny("DAILY_LIMIT", "Превышен дневной лимит сообщений контакту.", {
        sentToday,
        limit: cfg.maxMessagesPerContactPerDay,
      });
    }
  }

  if (!ctx.skipQuietHours && isQuietHours(ctx.now || new Date(), cfg)) {
    return deny("QUIET_HOURS", "Сейчас запрещённое время (quiet hours / weekday).", {
      timezone: cfg.timezone,
      start: cfg.quietHoursStart,
      end: cfg.quietHoursEnd,
    });
  }

  if (ctx.campaignStatus && ["paused", "cancelled", "failed", "completed"].includes(ctx.campaignStatus)) {
    return deny("CAMPAIGN_STOPPED", `Кампания в статусе «${ctx.campaignStatus}».`);
  }

  if (ctx.sequenceEnrollmentStatus) {
    const stopped = [
      "completed",
      "stopped_by_reply",
      "stopped_by_status",
      "stopped_by_suppression",
      "stopped_manually",
      "failed",
    ];
    if (stopped.includes(ctx.sequenceEnrollmentStatus)) {
      return deny("SEQUENCE_DONE", "Цепочка уже завершена или остановлена.", {
        status: ctx.sequenceEnrollmentStatus,
      });
    }
  }

  if (ctx.idempotencyKey) {
    const existing = repo.getOutboxByIdempotencyKey(ctx.idempotencyKey);
    if (existing && ["sent", "accepted", "delivered", "read", "dry_run"].includes(existing.status)) {
      return deny("IDEMPOTENCY_EXISTS", "Сообщение уже отправлено по этому idempotency key.", {
        outboxId: existing.id,
        status: existing.status,
      });
    }
  }

  const transport = String(ctx.transport || ctx.channel || "").toLowerCase();
  const isWaba = transport === "wapi" || transport === "waba" || ctx.requiresWabaTemplate;
  if (isWaba && ctx.isFirstOutboundOutsideWindow !== false) {
    if (ctx.requiresWabaTemplate !== false && !ctx.wabaTemplateId && !ctx.templateId) {
      return deny(
        "WABA_TEMPLATE_REQUIRED",
        "Для WABA вне активного диалога нужен одобренный шаблон."
      );
    }
    if (ctx.wabaTemplateStatus && !["approved", "active", "ok"].includes(String(ctx.wabaTemplateStatus).toLowerCase())) {
      return deny("WABA_TEMPLATE_NOT_APPROVED", "WABA-шаблон не в статусе approved.", {
        status: ctx.wabaTemplateStatus,
      });
    }
  }

  if (isCongratsOnlyStatus(ctx.statusValue)) {
    const cat = String(ctx.category || "");
    if (!CONGRATS_ONLY_CATEGORIES.includes(cat)) {
      return deny(
        "CONGRATS_ONLY",
        "Статус «Только поздравления» разрешает только birthday/holiday/personal_congratulation.",
        { category: cat, allowed: CONGRATS_ONLY_CATEGORIES }
      );
    }
  }

  const needsGround =
    ["telegram", "tgapi", "max", "maxbot"].includes(transport) ||
    ["telegram", "max"].includes(String(ctx.chatType || "").toLowerCase());

  if (needsGround && ctx.isFirstContact !== false) {
    const ground = ctx.firstContactGround || ctx.consentGround;
    if (!ground || !FIRST_CONTACT_GROUNDS.includes(ground)) {
      return deny(
        transport.startsWith("max")
          ? "MAX_FIRST_CONTACT_FORBIDDEN"
          : "TELEGRAM_FIRST_CONTACT_FORBIDDEN",
        "Нельзя начинать холодную коммуникацию без подтверждённого основания.",
        { allowedGrounds: FIRST_CONTACT_GROUNDS }
      );
    }
    if ((transport === "max" || transport === "maxbot" || ctx.chatType === "max") && !ctx.externalChatId && !ctx.chatId) {
      return deny(
        "MAX_CHAT_ID_REQUIRED",
        "Для MAX нужен известный chatId. Отправка по телефону не поддерживается."
      );
    }
  }

  if (ctx.planHash && ctx.confirmedPlanHash && ctx.planHash !== ctx.confirmedPlanHash) {
    return deny(
      "PLAN_HASH_MISMATCH",
      "Payload не соответствует подтверждённому плану кампании."
    );
  }

  // Flag conflict always blocks; note certification when real send would proceed
  try {
    assertCommunicationFlagsOk();
  } catch (error) {
    if (error instanceof CommunicationError && error.code === "COMMUNICATION_FLAGS_CONFLICT") {
      return deny(error.code, error.message, error.details || {});
    }
    throw error;
  }

  const realSendPath =
    !cfg.dryRun && cfg.sendEnabled && !ctx.dryRun && !ctx.skipCertificationNote;
  return allow({
    dryRun: cfg.dryRun || !cfg.sendEnabled || Boolean(ctx.dryRun),
    sendEnabled: cfg.sendEnabled,
    certificationRequired: Boolean(realSendPath && cfg.requireCertification),
    flagsConflict: cfg.flagsConflict,
  });
}

/**
 * Campaign-level policy (separate from legacy bulk block on client_message_send).
 */
export function evaluateCampaignPolicy(ctx = {}) {
  const cfg = getCommunicationsConfig();
  if (!cfg.enabled) {
    return deny("COMMUNICATIONS_DISABLED", "Communications Hub выключен.");
  }
  const count = Number(ctx.recipientCount || 0);
  if (count > cfg.maxCampaignRecipients) {
    return deny("CAMPAIGN_LIMIT", "Превышен лимит получателей кампании.", {
      count,
      limit: cfg.maxCampaignRecipients,
    });
  }
  if (count < 1) {
    return deny("CAMPAIGN_EMPTY", "Нет получателей для кампании.");
  }
  if (ctx.status && ["cancelled", "completed"].includes(ctx.status)) {
    return deny("CAMPAIGN_STOPPED", `Кампания «${ctx.status}».`);
  }
  if (ctx.planHash && ctx.previousPlanHash && ctx.planHash !== ctx.previousPlanHash && ctx.alreadyConfirmed) {
    return deny(
      "PLAN_CHANGED",
      "План изменён после подтверждения — требуется повторное подтверждение."
    );
  }
  return allow({ recipientCount: count });
}

export function detectOptOut(text, cfg = getCommunicationsConfig()) {
  const lower = String(text || "").toLowerCase();
  if (!lower.trim()) return { matched: false };
  for (const phrase of cfg.optOutPhrases) {
    if (phrase && lower.includes(String(phrase).toLowerCase())) {
      return { matched: true, phrase };
    }
  }
  return { matched: false };
}
