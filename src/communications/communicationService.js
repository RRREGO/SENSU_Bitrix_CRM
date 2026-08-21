/**
 * Communications Hub service: overview, channel sync, threads, drafts, prepare.
 */

import crypto from "crypto";
import {
  CommunicationError,
  getCommunicationsConfig,
  getCommunicationsPublicConfig,
  maskPhone,
} from "./config.js";
import { getProvider } from "./providers/index.js";
import { evaluateSendPolicy } from "./communicationPolicy.js";
import { buildSingleMessagePreparePreview } from "./communicationSafety.js";
import { renderTemplate, assertRequiredVarsFilled } from "./templateRenderer.js";
import { resolveHubOutboundAddress, inferPreferredHubChannel, HUB_CHANNEL_FALLBACK_ORDER } from "./outboundAddress.js";
import * as repo from "./communicationRepository.js";
import { getOutboxHealth } from "./communicationScheduler.js";
import { buildCommunicationContext } from "./communicationContext.js";

let lastConnectionCheck = null;

export function getCommunicationsOverview() {
  const cfg = getCommunicationsConfig();
  const channels = repo.listHubChannels({ provider: "wazzup" });
  const active = channels.filter((c) =>
    ["active", "authorized", "ok", "ready"].includes(String(c.state || c.status || "").toLowerCase())
  );
  const unauthorized = channels.filter((c) =>
    ["unauthorized", "qr", "not_authorized"].includes(String(c.state || "").toLowerCase())
  );
  const unanswered = repo.listThreads({ unanswered: true, limit: 100 });
  const queue = getOutboxHealth();
  const campaigns = repo.listCampaigns({ status: "running", limit: 20 });
  const sequences = repo.listSequences({ status: "active" });

  return {
    success: true,
    config: getCommunicationsPublicConfig(cfg),
    provider: {
      name: "wazzup",
      configured: cfg.wazzup.apiKeyConfigured,
      enabled: cfg.wazzup.enabled,
      lastSuccessfulCheckAt: lastConnectionCheck?.checkedAt || null,
      lastCheckOk: lastConnectionCheck?.ok ?? null,
    },
    channels: {
      total: channels.length,
      active: active.length,
      unauthorized: unauthorized.length,
      items: channels.map(publicChannel),
    },
    unansweredCount: unanswered.length,
    queue,
    activeCampaigns: campaigns.length,
    activeSequences: sequences.length,
  };
}

function publicChannel(c) {
  return {
    id: c.id,
    provider: c.provider,
    transport: c.transport,
    displayName: c.displayName,
    plainId: c.plainId ? maskPlainId(c.plainId) : null,
    state: c.state,
    status: c.status,
    capabilities: c.capabilities,
    lastSyncedAt: c.lastSyncedAt,
    // never expose secrets / raw credentials
  };
}

function maskPlainId(plainId) {
  const s = String(plainId);
  if (/^\d+$/.test(s) && s.length >= 8) return maskPhone(s);
  if (s.length <= 4) return "***";
  return `${s.slice(0, 2)}***${s.slice(-2)}`;
}

export async function syncChannels() {
  const cfg = getCommunicationsConfig();
  if (!cfg.enabled) {
    throw new CommunicationError("COMMUNICATIONS_DISABLED", "Communications Hub выключен.");
  }
  const provider = getProvider("wazzup");
  const channels = await provider.listChannels();
  const saved = [];
  for (const ch of channels) {
    saved.push(
      repo.upsertHubChannel({
        id: `wazzup:${ch.externalChannelId}`,
        channel: ch.transport || "unknown",
        provider: "wazzup",
        status: ch.state,
        externalChannelId: ch.externalChannelId,
        transport: ch.transport,
        displayName: ch.displayName,
        plainId: ch.plainId,
        state: ch.state,
        capabilities: ch.capabilities,
      })
    );
  }
  return {
    success: true,
    count: saved.length,
    channels: saved.map(publicChannel),
    syncedAt: new Date().toISOString(),
  };
}

export async function testProviderConnection(providerName = "wazzup") {
  const cfg = getCommunicationsConfig();
  if (!cfg.enabled && providerName === "wazzup") {
    // Allow connection test when configuring, but report disabled flag
  }
  const provider = getProvider(providerName);
  const result = await provider.testConnection();
  if (providerName === "wazzup" && result.ok) {
    lastConnectionCheck = result;
    // Seed probe timestamp for health (app_settings — breaks circular import with capabilityService)
    try {
      const { setSetting } = await import("../database/repositories/settingsRepository.js");
      setSetting("communications_last_connection_ok_at", result.checkedAt || new Date().toISOString());
    } catch {
      /* settings may be unavailable in some tests */
    }
  }
  return {
    success: Boolean(result.ok),
    ...result,
    // strip any accidental secrets
    config: getCommunicationsPublicConfig(cfg)[providerName === "max_bot" ? "maxBot" : "wazzup"],
  };
}

export function listThreads(query = {}) {
  return {
    success: true,
    threads: repo.listThreads(query),
  };
}

export function getThread(id) {
  const thread = repo.getThread(id);
  if (!thread) throw new CommunicationError("THREAD_NOT_FOUND", "Диалог не найден.");
  const messages = repo.listMessages({ threadId: id, limit: 100 });
  return { success: true, thread, messages };
}

export function draftThreadMessage(threadId, params = {}) {
  const thread = repo.getThread(threadId);
  if (!thread) throw new CommunicationError("THREAD_NOT_FOUND", "Диалог не найден.");

  let body = params.body || "";
  if (params.templateId) {
    const template = repo.getTemplate(params.templateId);
    if (!template) throw new CommunicationError("TEMPLATE_NOT_FOUND", "Шаблон не найден.");
    body = renderTemplate(template.body, {
      ...(params.vars || {}),
      __category: template.category,
      __channel: template.channel,
      __wabaTemplateId: template.wabaTemplateId,
    });
  }

  return {
    success: true,
    draft: {
      threadId,
      contactId: thread.contactId,
      channel: params.channel || thread.chatType || thread.transport,
      body,
      dryRun: getCommunicationsConfig().dryRun || !getCommunicationsConfig().sendEnabled,
    },
  };
}

/**
 * Prepare a Hub send via Safety Layer path (returns preview; does not send).
 * If channel is omitted / "wazzup", picks Telegram vs WhatsApp vs MAX from the contact.
 * If the chosen channel has no address, tries the other messengers instead of asking.
 */
export async function prepareMessageSend(params = {}) {
  const cfg = getCommunicationsConfig();
  if (!cfg.enabled) {
    throw new CommunicationError("COMMUNICATIONS_DISABLED", "Communications Hub выключен.");
  }

  const contactId = params.contactId ? String(params.contactId) : null;
  const preferred = await inferPreferredHubChannel(params);
  const order = [preferred, ...HUB_CHANNEL_FALLBACK_ORDER.filter((c) => c !== preferred)];

  let last = null;
  for (const channel of order) {
    const prepared = await prepareMessageSendForChannel(params, contactId, channel, cfg);
    last = prepared;
    if (prepared.policy?.allowed) {
      if (channel !== preferred && prepared.preview) {
        prepared.preview.channelAutoSelected = channel;
        prepared.preview.warnings = [
          ...(prepared.preview.warnings || []),
          `Канал ${preferred} без адреса — выбран ${channel}.`,
        ];
      }
      return prepared;
    }
    if (prepared.policy?.code !== "NO_ADDRESS") {
      return prepared;
    }
  }
  return last;
}

async function prepareMessageSendForChannel(params, contactId, channel, cfg) {
  const address = await resolveHubOutboundAddress({
    ...params,
    contactId,
    channel,
  });
  const transport = address.transport;
  const chatType = address.chatType;

  let body = params.body || "";
  let template = null;
  if (params.templateId) {
    template = repo.getTemplate(params.templateId);
    if (!template) throw new CommunicationError("TEMPLATE_NOT_FOUND", "Шаблон не найден.");
    assertRequiredVarsFilled(template.body, params.vars || {});
    body = renderTemplate(template.body, {
      ...(params.vars || {}),
      __category: template.category,
      __channel: template.channel,
      __wabaTemplateId: template.wabaTemplateId,
    });
  }

  const policy = evaluateSendPolicy({
    contactId,
    statusValue: params.statusValue,
    channel: chatType,
    transport,
    chatType,
    externalChatId: address.chatId,
    phone: address.phone,
    username: address.username,
    category: template?.category || params.category || "service",
    wabaTemplateId: template?.wabaTemplateId || params.wabaTemplateId,
    wabaTemplateStatus: params.wabaTemplateStatus,
    isFirstContact: address.isFirstContact,
    firstContactGround: address.firstContactGround,
    allowPersonal: params.allowPersonal,
    personalCommunicationReason: params.personalCommunicationReason,
    channelState: params.channelState || "active",
    ambiguousContact: params.ambiguousContact,
    resolutionStatus: params.resolutionStatus,
  });

  const dryRun = cfg.dryRun || !cfg.sendEnabled;
  const preview = buildSingleMessagePreparePreview({
    contactId,
    channel: chatType,
    transport,
    chatType,
    body,
    templateId: template?.id,
    wabaTemplateId: template?.wabaTemplateId || params.wabaTemplateId,
    recipientMasked: address.recipientMasked,
    policy,
    dryRun,
  });

  // Queue only after Safety commit — here we stage a prepare package
  const prepareId = crypto.randomUUID();
  const idempotencyKey = params.idempotencyKey || `msg:${prepareId}`;

  return {
    success: true,
    prepareId,
    requiresConfirmation: true,
    confirmationPhrase: address.recipientName
      ? `ОТПРАВИТЬ СООБЩЕНИЕ ${String(address.recipientName).toUpperCase()}`
      : params.recipientName
        ? `ОТПРАВИТЬ СООБЩЕНИЕ ${String(params.recipientName).toUpperCase()}`
        : null,
    policy,
    preview,
    outboxDraft: {
      idempotencyKey,
      provider: params.provider || "wazzup",
      channelId: address.channelId,
      transport,
      chatType,
      externalChatId: address.chatId || address.phone,
      contactId,
      body,
      wabaTemplateId: template?.wabaTemplateId || params.wabaTemplateId,
      crmMessageId: idempotencyKey,
      dryRun,
      payload: {
        phone: address.phone || null,
        username: address.username || null,
        category: template?.category || params.category,
        isFirstContact: address.isFirstContact,
        firstContactGround: address.firstContactGround,
        channelId: address.channelId,
        addressSource: address.addressSource,
      },
    },
    // LLM / actions must not call provider.send — only Safety commit may enqueue
  };
}

/**
 * Enqueue after confirmed Safety commit. Still respects dry-run.
 */
export function enqueuePreparedMessage(outboxDraft, { operationId } = {}) {
  if (!outboxDraft?.idempotencyKey) {
    throw new CommunicationError("OUTBOX_DRAFT_INVALID", "Нет idempotencyKey.");
  }
  const cfg = getCommunicationsConfig();
  const dryRun = outboxDraft.dryRun || cfg.dryRun || !cfg.sendEnabled;
  return repo.createOutboxJob({
    ...outboxDraft,
    dryRun,
    operationId: operationId || null,
  });
}

export function getContactCommunicationContext(contactId, options = {}) {
  return buildCommunicationContext(contactId, options);
}

export function getCachedConnectionCheck() {
  return lastConnectionCheck;
}

export function setCachedConnectionCheck(result) {
  lastConnectionCheck = result;
  if (result?.ok && result?.checkedAt) {
    try {
      // Sync to app_settings for health without cyclic imports at module load
      import("../database/repositories/settingsRepository.js")
        .then(({ setSetting }) => {
          setSetting("communications_last_connection_ok_at", result.checkedAt);
        })
        .catch(() => {});
    } catch {
      /* ignore */
    }
  }
}
