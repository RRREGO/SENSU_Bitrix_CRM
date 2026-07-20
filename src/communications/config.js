/**
 * Конфигурация исходящих сообщений и Communications Hub.
 * Секреты читаются только из env — никогда не пишутся в SQLite/логи/health.
 *
 * Flag resolution (see resolveCommunicationSendFlags):
 * - Canonical: COMMUNICATIONS_ENABLED, COMMUNICATIONS_SEND_ENABLED, COMMUNICATIONS_DRY_RUN
 * - Deprecated alias: COMMUNICATION_SEND_ENABLED → sendEnabled when canonical unset
 * - If both COMMUNICATIONS_SEND_ENABLED and COMMUNICATION_SEND_ENABLED are set and disagree:
 *   flagsConflict=true, sendEnabled forced false, dryRun forced true
 */

function intEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function intEnvAllowZero(name, fallback) {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function boolEnv(name, fallback) {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(v));
}

function envExplicitlySet(name) {
  const v = process.env[name];
  return v != null && String(v).trim() !== "";
}

function parseBoolRaw(raw, fallback = false) {
  if (raw == null || String(raw).trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw));
}

function csvEnv(name, fallback = []) {
  const raw = process.env[name];
  if (raw == null || !String(raw).trim()) return [...fallback];
  return String(raw)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

function csvIntEnv(name, fallback = []) {
  return csvEnv(name, fallback.map(String))
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));
}

function secretConfigured(value) {
  return Boolean(value && String(value).trim());
}

/**
 * Resolve send/dry-run flags with deprecated alias + conflict detection.
 * @returns {{
 *   sendEnabled: boolean,
 *   dryRun: boolean,
 *   flagsConflict: boolean,
 *   usedDeprecatedAlias: boolean,
 *   sources: { send: string, dryRun: string }
 * }}
 */
export function resolveCommunicationSendFlags() {
  const canonicalSet = envExplicitlySet("COMMUNICATIONS_SEND_ENABLED");
  const legacySet = envExplicitlySet("COMMUNICATION_SEND_ENABLED");
  const dryRunSet = envExplicitlySet("COMMUNICATIONS_DRY_RUN");

  const canonicalSend = parseBoolRaw(process.env.COMMUNICATIONS_SEND_ENABLED, false);
  const legacySend = parseBoolRaw(process.env.COMMUNICATION_SEND_ENABLED, false);
  let dryRun = parseBoolRaw(process.env.COMMUNICATIONS_DRY_RUN, true);

  let sendEnabled = false;
  let flagsConflict = false;
  let usedDeprecatedAlias = false;
  let sendSource = "default";

  if (canonicalSet && legacySet) {
    if (canonicalSend !== legacySend) {
      flagsConflict = true;
      sendEnabled = false;
      dryRun = true;
      sendSource = "conflict";
    } else {
      sendEnabled = canonicalSend;
      sendSource = "COMMUNICATIONS_SEND_ENABLED";
    }
  } else if (canonicalSet) {
    sendEnabled = canonicalSend;
    sendSource = "COMMUNICATIONS_SEND_ENABLED";
  } else if (legacySet) {
    sendEnabled = legacySend;
    usedDeprecatedAlias = true;
    sendSource = "COMMUNICATION_SEND_ENABLED";
  } else {
    sendEnabled = false;
    sendSource = "default";
  }

  if (!dryRunSet && flagsConflict) {
    dryRun = true;
  }

  return {
    sendEnabled,
    dryRun: flagsConflict ? true : dryRun,
    flagsConflict,
    usedDeprecatedAlias,
    sources: {
      send: sendSource,
      dryRun: flagsConflict ? "forced_safe" : dryRunSet ? "COMMUNICATIONS_DRY_RUN" : "default",
    },
  };
}

export class CommunicationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "CommunicationError";
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

/** Throws COMMUNICATION_FLAGS_CONFLICT when canonical + legacy disagree. */
export function assertCommunicationFlagsOk() {
  const flags = resolveCommunicationSendFlags();
  if (flags.flagsConflict) {
    throw new CommunicationError(
      "COMMUNICATION_FLAGS_CONFLICT",
      "Конфликт COMMUNICATIONS_SEND_ENABLED и устаревшего COMMUNICATION_SEND_ENABLED. Реальная отправка заблокирована.",
      {
        COMMUNICATIONS_SEND_ENABLED: process.env.COMMUNICATIONS_SEND_ENABLED,
        COMMUNICATION_SEND_ENABLED: process.env.COMMUNICATION_SEND_ENABLED,
        sendEnabled: false,
        dryRun: true,
      }
    );
  }
  return flags;
}

export function getCommunicationsConfig() {
  const wazzupApiKey = (process.env.WAZZUP_API_KEY || "").trim();
  const wazzupWebhookSecret = (process.env.WAZZUP_WEBHOOK_SECRET || "").trim();
  const maxBotToken = (process.env.MAX_BOT_TOKEN || "").trim();
  const maxWebhookSecret = (process.env.MAX_WEBHOOK_SECRET || "").trim();
  const legacyWebhookToken = (process.env.COMMUNICATION_WEBHOOK_TOKEN || "").trim();

  const sendFlags = resolveCommunicationSendFlags();

  return {
    // Legacy outbound (Bitrix IM/email)
    duplicateWindowMinutes: intEnv("MESSAGE_DUPLICATE_WINDOW_MINUTES", 10),
    maxChars: {
      whatsapp: intEnv("MESSAGE_MAX_CHARS_WHATSAPP", 4000),
      telegram: intEnv("MESSAGE_MAX_CHARS_TELEGRAM", 4000),
      email: intEnv("MESSAGE_MAX_CHARS_EMAIL", 50000),
      bitrix_chat: intEnv("MESSAGE_MAX_CHARS_BITRIX_CHAT", 4000),
      open_lines: intEnv("MESSAGE_MAX_CHARS_WHATSAPP", 4000),
      max: intEnv("MESSAGE_MAX_CHARS_TELEGRAM", 4000),
      wapi: intEnv("MESSAGE_MAX_CHARS_WHATSAPP", 550),
    },
    liveTestEnabled: boolEnv("COMMUNICATION_LIVE_TEST_ENABLED", false),
    webhookToken: legacyWebhookToken || null,

    // Hub kill-switches (all dangerous OFF by default)
    enabled: boolEnv("COMMUNICATIONS_ENABLED", false),
    sendEnabled: sendFlags.sendEnabled,
    dryRun: sendFlags.dryRun,
    flagsConflict: sendFlags.flagsConflict,
    usedDeprecatedAlias: sendFlags.usedDeprecatedAlias,
    flagSources: sendFlags.sources,

    // Certification / test harness
    requireCertification: boolEnv("COMMUNICATIONS_REQUIRE_CERTIFICATION", true),
    testContactId: (process.env.COMMUNICATION_TEST_CONTACT_ID || "").trim() || null,
    testAllowedChannels: csvEnv("COMMUNICATION_TEST_ALLOWED_CHANNELS", []),
    certificationCampaignMaxRecipients: intEnv(
      "COMMUNICATION_CERTIFICATION_CAMPAIGN_MAX_RECIPIENTS",
      3
    ),
    storeRawProviderPayloads: boolEnv("COMMUNICATION_STORE_RAW_PROVIDER_PAYLOADS", false),
    certificationTtlDays: intEnv("COMMUNICATION_CERTIFICATION_TTL_DAYS", 90),
    certificationAllowMock: boolEnv("COMMUNICATION_CERTIFICATION_ALLOW_MOCK", false),

    timezone: (process.env.COMMUNICATIONS_DEFAULT_TIMEZONE || process.env.APP_TIMEZONE || "Asia/Almaty").trim(),
    quietHoursStart: (process.env.COMMUNICATIONS_QUIET_HOURS_START || "19:00").trim(),
    quietHoursEnd: (process.env.COMMUNICATIONS_QUIET_HOURS_END || "09:00").trim(),
    allowedWeekdays: csvIntEnv("COMMUNICATIONS_ALLOWED_WEEKDAYS", [1, 2, 3, 4, 5]),

    maxSingleBatch: intEnv("COMMUNICATIONS_MAX_SINGLE_BATCH", 20),
    maxCampaignRecipients: intEnv("COMMUNICATIONS_MAX_CAMPAIGN_RECIPIENTS", 100),
    maxMessagesPerMinute: intEnv("COMMUNICATIONS_MAX_MESSAGES_PER_MINUTE", 10),
    maxMessagesPerHour: intEnv("COMMUNICATIONS_MAX_MESSAGES_PER_HOUR", 100),
    maxMessagesPerContactPerDay: intEnv("COMMUNICATIONS_MAX_MESSAGES_PER_CONTACT_PER_DAY", 1),
    minIntervalSeconds: intEnv("COMMUNICATIONS_MIN_INTERVAL_SECONDS", 5),
    sendJitterSeconds: intEnvAllowZero("COMMUNICATIONS_SEND_JITTER_SECONDS", 15),

    outboxLockTtlSeconds: intEnv("COMMUNICATIONS_OUTBOX_LOCK_TTL_SECONDS", 120),
    outboxMaxAttempts: intEnv("COMMUNICATIONS_OUTBOX_MAX_ATTEMPTS", 5),
    outboxBatchSize: intEnv("COMMUNICATIONS_OUTBOX_BATCH_SIZE", 10),

    // Wazzup (secrets never exposed via publicConfig)
    wazzup: {
      enabled: boolEnv("WAZZUP_ENABLED", false),
      apiBase: (process.env.WAZZUP_API_BASE || "https://api.wazzup24.com").replace(/\/$/, ""),
      apiKeyConfigured: secretConfigured(wazzupApiKey),
      webhookSecretConfigured: secretConfigured(wazzupWebhookSecret),
      requestTimeoutMs: intEnv("WAZZUP_REQUEST_TIMEOUT_MS", 15000),
      // Internal accessors — callers must not log/return these
      _apiKey: wazzupApiKey || null,
      _webhookSecret: wazzupWebhookSecret || null,
    },

    // Official MAX Bot API (disabled; only known chatId)
    maxBot: {
      enabled: boolEnv("MAX_BOT_ENABLED", false),
      apiBase: (process.env.MAX_BOT_API_BASE || "https://platform-api2.max.ru").replace(/\/$/, ""),
      tokenConfigured: secretConfigured(maxBotToken),
      webhookSecretConfigured: secretConfigured(maxWebhookSecret),
      requestTimeoutMs: intEnv("MAX_BOT_REQUEST_TIMEOUT_MS", 15000),
      _token: maxBotToken || null,
      _webhookSecret: maxWebhookSecret || null,
    },

    bitrixFields: {
      telegram: (process.env.BITRIX_CONTACT_TELEGRAM_FIELD || "").trim() || null,
      max: (process.env.BITRIX_CONTACT_MAX_FIELD || "").trim() || null,
      communicationChannel:
        (process.env.BITRIX_CONTACT_COMMUNICATION_CHANNEL_FIELD || "").trim() || null,
      consent: (process.env.BITRIX_CONTACT_COMMUNICATION_CONSENT_FIELD || "").trim() || null,
      lastContact: (process.env.BITRIX_CONTACT_LAST_CONTACT_FIELD || "").trim() || null,
      warmupStep: (process.env.BITRIX_CONTACT_WARMUP_STEP_FIELD || "").trim() || null,
      firstContactGround:
        (process.env.BITRIX_CONTACT_FIRST_CONTACT_GROUND_FIELD || "").trim() || null,
    },

    autoCreateTimelineComment: boolEnv("COMMUNICATION_AUTO_CREATE_TIMELINE_COMMENT", false),
    autoChangeContactStatus: boolEnv("COMMUNICATION_AUTO_CHANGE_CONTACT_STATUS", false),
    autoCreateActivity: boolEnv("COMMUNICATION_AUTO_CREATE_ACTIVITY", false),

    contextRecentMessages: intEnv("COMMUNICATION_CONTEXT_RECENT_MESSAGES", 30),
    contextMaxChars: intEnv("COMMUNICATION_CONTEXT_MAX_CHARS", 40000),
    autoSummaryEnabled: boolEnv("COMMUNICATION_AUTO_SUMMARY_ENABLED", true),
    autoSummaryThreshold: intEnv("COMMUNICATION_AUTO_SUMMARY_THRESHOLD", 50),

    optOutPhrases: csvEnv("COMMUNICATION_OPT_OUT_PHRASES", [
      "не пишите",
      "не пишите мне",
      "отпишите",
      "удалите мой номер",
      "не интересно",
      "стоп",
      "stop",
      "unsubscribe",
    ]),
  };
}

/** Safe subset for /health, frontend, diagnostics — never secrets. */
export function getCommunicationsPublicConfig(cfg = getCommunicationsConfig()) {
  return {
    enabled: cfg.enabled,
    sendEnabled: cfg.sendEnabled,
    dryRun: cfg.dryRun,
    flagsConflict: cfg.flagsConflict,
    usedDeprecatedAlias: cfg.usedDeprecatedAlias,
    requireCertification: cfg.requireCertification,
    timezone: cfg.timezone,
    quietHoursStart: cfg.quietHoursStart,
    quietHoursEnd: cfg.quietHoursEnd,
    allowedWeekdays: cfg.allowedWeekdays,
    maxCampaignRecipients: cfg.maxCampaignRecipients,
    certificationCampaignMaxRecipients: cfg.certificationCampaignMaxRecipients,
    storeRawProviderPayloads: cfg.storeRawProviderPayloads,
    wazzup: {
      enabled: cfg.wazzup.enabled,
      apiBase: cfg.wazzup.apiBase,
      configured: cfg.wazzup.apiKeyConfigured,
      webhookConfigured: cfg.wazzup.webhookSecretConfigured,
    },
    maxBot: {
      enabled: cfg.maxBot.enabled,
      apiBase: cfg.maxBot.apiBase || null,
      configured: cfg.maxBot.tokenConfigured,
      webhookConfigured: cfg.maxBot.webhookSecretConfigured,
    },
    bitrixFieldsConfigured: {
      telegram: Boolean(cfg.bitrixFields.telegram),
      max: Boolean(cfg.bitrixFields.max),
      consent: Boolean(cfg.bitrixFields.consent),
      warmupStep: Boolean(cfg.bitrixFields.warmupStep),
      firstContactGround: Boolean(cfg.bitrixFields.firstContactGround),
    },
    autoFlags: {
      timelineComment: cfg.autoCreateTimelineComment,
      changeContactStatus: cfg.autoChangeContactStatus,
      createActivity: cfg.autoCreateActivity,
    },
  };
}

export function maskPhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 4) return "***";
  const tail = digits.slice(-4);
  const a = tail.slice(0, 2);
  const b = tail.slice(2);
  if (digits.startsWith("7") || String(raw).trim().startsWith("+7")) {
    return `+7 *** *** ${a} ${b}`;
  }
  return `*** *** ${a} ${b}`;
}

export function maskEmail(raw) {
  const s = String(raw || "").trim();
  const at = s.indexOf("@");
  if (at <= 0) return "***@***";
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  return `${local[0]}***@${domain}`;
}

export function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
}

export function normalizeTelegramUsername(raw) {
  const s = String(raw || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  return s || null;
}

export const CHAT_TYPES = Object.freeze([
  "whatsapp",
  "telegram",
  "viber",
  "whatsgroup",
  "instagram",
  "max",
  "maxgroup",
]);

export const WAZZUP_TRANSPORTS = Object.freeze([
  "whatsapp",
  "wapi",
  "telegram",
  "tgapi",
  "viber",
  "instagram",
  "max",
  "maxbot",
]);

export const TEMPLATE_CATEGORIES = Object.freeze([
  "warmup",
  "cycle",
  "follow_up",
  "meeting_summary",
  "birthday",
  "holiday",
  "personal_congratulation",
  "meeting_invitation",
  "newsletter",
  "service",
]);

export const CONGRATS_ONLY_CATEGORIES = Object.freeze([
  "birthday",
  "holiday",
  "personal_congratulation",
]);

export const FIRST_CONTACT_GROUNDS = Object.freeze([
  "inbound",
  "application",
  "call",
  "referral",
  "manual_consent",
  "active_dialog",
]);

export const TEMPLATE_ALLOWED_VARS = Object.freeze([
  "firstName",
  "fullName",
  "companyName",
  "managerName",
  "referrerName",
  "meetingDate",
  "lastContactDate",
  "contextReason",
]);

export const CERTIFICATION_STATUSES = Object.freeze([
  "not_started",
  "connection_verified",
  "webhook_verified",
  "single_send_verified",
  "delivery_verified",
  "campaign_verified",
  "sequence_verified",
  "certified",
  "expired",
  "failed",
  "revoked",
]);

export const CERTIFICATION_TEST_MARKER = "[CRM ASSISTANT TEST]";
export const CERTIFICATION_SINGLE_SEND_TEXT =
  "[CRM ASSISTANT TEST] Проверка исходящего сообщения. Ответьте словом TEST.";

export const EMERGENCY_STOP_PHRASE = "ПОДТВЕРЖДАЮ АВАРИЙНУЮ ОСТАНОВКУ КОММУНИКАЦИЙ";
export const EMERGENCY_RESUME_PHRASE = "ПОДТВЕРЖДАЮ СНЯТИЕ АВАРИЙНОЙ ОСТАНОВКИ";
export const EMERGENCY_STOP_SETTING_KEY = "communications_emergency_stop";
export const POLICY_VERSION = "v11";
