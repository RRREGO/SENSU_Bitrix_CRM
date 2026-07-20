/**
 * Certification fingerprint / contract / test-contact validators.
 * Never persist API keys, webhook secrets, full phones, client names, or raw message bodies.
 */

import crypto from "crypto";
import {
  CommunicationError,
  CERTIFICATION_TEST_MARKER,
  getCommunicationsConfig,
  maskPhone,
  normalizePhone,
} from "../config.js";

function sha256(input) {
  return crypto.createHash("sha256").update(String(input), "utf8").digest("hex");
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
}

/**
 * @param {{ provider: string, accountId?: string|null, channelIds?: string[], transports?: string[], environment?: string }} input
 */
export function computeAccountFingerprint(input = {}) {
  const provider = String(input.provider || "").toLowerCase().trim();
  const accountId = String(input.accountId || "default").trim();
  const channelIds = [...(input.channelIds || [])]
    .map((id) => String(id).trim())
    .filter(Boolean)
    .sort();
  const hashedChannels = channelIds.map((id) => sha256(id)).sort();
  const transports = [...(input.transports || [])]
    .map((t) => String(t).toLowerCase().trim())
    .filter(Boolean)
    .sort();
  const environment = String(input.environment || process.env.APP_ENV || "development")
    .toLowerCase()
    .trim();
  return sha256(
    [provider, accountId, hashedChannels.join(","), transports.join(","), environment].join("|")
  );
}

export function computeChannelsHash(channels = []) {
  const rows = (channels || []).map((ch) => ({
    id: String(ch.externalChannelId || ch.channelId || ch.id || ""),
    transport: String(ch.transport || "").toLowerCase(),
    state: String(ch.state || "").toLowerCase(),
    capabilities: {
      canSend: Boolean(ch.capabilities?.canSend),
      canReceive: Boolean(ch.capabilities?.canReceive),
      supportsTemplates: Boolean(ch.capabilities?.supportsTemplates),
      requiresKnownChatId: Boolean(ch.capabilities?.requiresKnownChatId),
    },
  }));
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return sha256(stableJson(rows));
}

export function computeCapabilitiesHash(capabilities = {}) {
  return sha256(stableJson(capabilities || {}));
}

/**
 * Redacted provider contract — no secrets, phones masked/hashed, no client names.
 */
export function buildProviderContractSnapshot(channels = [], extras = {}) {
  const safeChannels = (channels || []).map((ch) => {
    const plainId = ch.plainId != null ? String(ch.plainId) : null;
    return {
      externalChannelIdHash: ch.externalChannelId
        ? sha256(String(ch.externalChannelId))
        : null,
      transport: ch.transport || null,
      state: ch.state || null,
      displayNamePresent: Boolean(ch.displayName),
      plainIdMasked: plainId ? maskPhone(plainId) : null,
      plainIdHash: plainId ? sha256(normalizePhone(plainId) || plainId) : null,
      capabilities: {
        canSend: Boolean(ch.capabilities?.canSend),
        canReceive: Boolean(ch.capabilities?.canReceive),
        supportsTemplates: Boolean(ch.capabilities?.supportsTemplates),
        supportsReadReceipts: Boolean(ch.capabilities?.supportsReadReceipts),
        requiresKnownChatId: Boolean(ch.capabilities?.requiresKnownChatId),
      },
    };
  });

  return {
    provider: extras.provider || "wazzup",
    providerVersion: extras.providerVersion || null,
    environment: extras.environment || process.env.APP_ENV || "development",
    channelCount: safeChannels.length,
    transports: [
      ...new Set(safeChannels.map((c) => c.transport).filter(Boolean)),
    ].sort(),
    channels: safeChannels,
    capabilitiesSummary: {
      hasWaba: safeChannels.some((c) => c.transport === "wapi" || c.capabilities.supportsTemplates),
      hasMax: safeChannels.some((c) => String(c.transport || "").startsWith("max")),
      hasTelegram: safeChannels.some((c) =>
        ["telegram", "tgapi"].includes(String(c.transport || ""))
      ),
    },
    createdAt: new Date().toISOString(),
  };
}

/**
 * @returns {{ changed: boolean, reason: string|null }}
 */
export function detectContractChange(oldSnap, newSnap) {
  if (!oldSnap) return { changed: false, reason: null };
  if (!newSnap) return { changed: true, reason: "NEW_SNAPSHOT_MISSING" };

  const oldChannels =
    typeof oldSnap.channelsHash === "string"
      ? oldSnap.channelsHash
      : computeChannelsHash(oldSnap.channels || []);
  const newChannels =
    typeof newSnap.channelsHash === "string"
      ? newSnap.channelsHash
      : computeChannelsHash(newSnap.channels || []);

  if (oldChannels !== newChannels) {
    return { changed: true, reason: "PROVIDER_CONTRACT_CHANGED:channels" };
  }

  const oldCaps =
    typeof oldSnap.capabilitiesHash === "string"
      ? oldSnap.capabilitiesHash
      : computeCapabilitiesHash(oldSnap.capabilitiesSummary || oldSnap.capabilities || {});
  const newCaps =
    typeof newSnap.capabilitiesHash === "string"
      ? newSnap.capabilitiesHash
      : computeCapabilitiesHash(newSnap.capabilitiesSummary || newSnap.capabilities || {});

  if (oldCaps !== newCaps) {
    return { changed: true, reason: "PROVIDER_CONTRACT_CHANGED:capabilities" };
  }

  if (
    oldSnap.providerVersion &&
    newSnap.providerVersion &&
    oldSnap.providerVersion !== newSnap.providerVersion
  ) {
    return { changed: true, reason: "PROVIDER_CONTRACT_CHANGED:version" };
  }

  return { changed: false, reason: null };
}

/**
 * Test contact must carry [CRM ASSISTANT TEST] marker and not be spam/dont_touch/personal.
 */
export function assertTestContactAllowed(contact = {}) {
  const cfg = getCommunicationsConfig();
  const markerSources = [
    contact.name,
    contact.fullName,
    contact.comments,
    contact.marker,
    contact.notes,
    contact.title,
  ]
    .filter(Boolean)
    .join(" ");

  if (!String(markerSources).includes(CERTIFICATION_TEST_MARKER)) {
    throw new CommunicationError(
      "COMMUNICATION_TEST_CONTACT_REQUIRED",
      `Тестовый контакт должен содержать маркер ${CERTIFICATION_TEST_MARKER}.`,
      { contactId: contact.id || contact.contactId || null }
    );
  }

  const status = String(contact.statusValue || contact.status || "").toLowerCase();
  if (["spam", "dont_touch", "do_not_contact", "personal"].includes(status)) {
    throw new CommunicationError(
      "COMMUNICATION_TEST_CONTACT_STATUS_FORBIDDEN",
      "Тестовый контакт не может быть в статусах Спам / Не трогать / Личный.",
      { status }
    );
  }

  const contactId = String(contact.id || contact.contactId || "");
  if (cfg.testContactId && contactId && contactId !== String(cfg.testContactId)) {
    throw new CommunicationError(
      "COMMUNICATION_TEST_CONTACT_MISMATCH",
      "contactId не совпадает с COMMUNICATION_TEST_CONTACT_ID.",
      { expected: cfg.testContactId, actual: contactId }
    );
  }

  if (cfg.testAllowedChannels?.length && contact.channel) {
    const ch = String(contact.channel).toLowerCase();
    if (!cfg.testAllowedChannels.map((x) => x.toLowerCase()).includes(ch)) {
      throw new CommunicationError(
        "COMMUNICATION_TEST_CHANNEL_FORBIDDEN",
        "Канал не входит в COMMUNICATION_TEST_ALLOWED_CHANNELS.",
        { channel: ch, allowed: cfg.testAllowedChannels }
      );
    }
  }

  return true;
}

export function validateWabaTemplate(template = {}, options = {}) {
  if (!template || (!template.id && !template.wabaTemplateId && !options.wabaTemplateId)) {
    throw new CommunicationError(
      "WABA_TEMPLATE_REQUIRED",
      "Для WABA нужен одобренный шаблон."
    );
  }
  const status = String(template.status || options.status || "").toLowerCase();
  if (status && !["approved", "active", "ok"].includes(status)) {
    throw new CommunicationError(
      "WABA_TEMPLATE_NOT_APPROVED",
      "WABA-шаблон не в статусе approved.",
      { status, templateId: template.id || template.wabaTemplateId }
    );
  }
  if (options.expectedLanguage && template.language && template.language !== options.expectedLanguage) {
    throw new CommunicationError(
      "WABA_TEMPLATE_LANGUAGE_MISMATCH",
      "Язык WABA-шаблона не совпадает.",
      { expected: options.expectedLanguage, actual: template.language }
    );
  }
  if (
    options.expectedVarCount != null &&
    Array.isArray(template.allowedVars) &&
    template.allowedVars.length !== Number(options.expectedVarCount)
  ) {
    throw new CommunicationError(
      "WABA_TEMPLATE_VARS_MISMATCH",
      "Количество переменных WABA-шаблона не совпадает.",
      {
        expected: options.expectedVarCount,
        actual: template.allowedVars.length,
      }
    );
  }
  return true;
}

const ALLOWED_IDENTITY_SOURCES = new Set([
  "provider_sync",
  "webhook",
  "verified_thread",
  "wazzup_sync",
  "inbound",
]);

/**
 * Block arbitrary frontend chatId/phone/username for Telegram/MAX first contact.
 */
export function assertTelegramMaxIdentity({ identity, source } = {}) {
  const src = String(source || identity?.source || "").toLowerCase();
  if (!ALLOWED_IDENTITY_SOURCES.has(src)) {
    throw new CommunicationError(
      "TELEGRAM_MAX_IDENTITY_UNTRUSTED",
      "Идентичность Telegram/MAX должна происходить из provider sync, webhook или verified thread — не из произвольного frontend input.",
      { source: src || null, allowed: [...ALLOWED_IDENTITY_SOURCES] }
    );
  }
  if (!identity?.externalChatId && !identity?.verified) {
    throw new CommunicationError(
      "TELEGRAM_MAX_CHAT_ID_REQUIRED",
      "Для Telegram/MAX нужен известный verified chatId."
    );
  }
  if (identity?.arbitraryFrontend) {
    throw new CommunicationError(
      "TELEGRAM_MAX_ARBITRARY_BLOCKED",
      "Произвольный chatId/phone/username из frontend запрещён."
    );
  }
  return true;
}

export function hashRecipientSnapshot(snapshot = {}) {
  const safe = {
    contactId: snapshot.contactId || null,
    externalChatIdHash: snapshot.externalChatId
      ? sha256(String(snapshot.externalChatId))
      : null,
    phoneHash: snapshot.phone ? sha256(normalizePhone(snapshot.phone) || String(snapshot.phone)) : null,
    usernameHash: snapshot.username ? sha256(String(snapshot.username).toLowerCase()) : null,
    channel: snapshot.channel || null,
    transport: snapshot.transport || null,
  };
  return sha256(stableJson(safe));
}

export function hashBody(body) {
  return sha256(String(body || ""));
}

export { sha256, stableJson };
