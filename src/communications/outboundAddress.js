/**
 * Resolve outbound Wazzup address for Hub prepare: identities, then Bitrix contact fields.
 * Never logs raw phones / usernames.
 */

import {
  getCommunicationsConfig,
  normalizePhone,
  normalizeTelegramUsername,
  maskPhone,
} from "./config.js";
import * as repo from "./communicationRepository.js";

const CHANNEL_MAP = {
  telegram: { chatType: "telegram", transports: ["tgapi", "telegram"] },
  tgapi: { chatType: "telegram", transports: ["tgapi", "telegram"] },
  whatsapp: { chatType: "whatsapp", transports: ["whatsapp", "wapi"] },
  wapi: { chatType: "whatsapp", transports: ["wapi", "whatsapp"] },
  waba: { chatType: "whatsapp", transports: ["wapi"] },
  max: { chatType: "max", transports: ["max", "maxbot"] },
  maxbot: { chatType: "max", transports: ["max", "maxbot"] },
  viber: { chatType: "viber", transports: ["viber"] },
  instagram: { chatType: "instagram", transports: ["instagram"] },
};

function phonesFromContact(contact) {
  const list = [];
  const fm = contact?.PHONE || contact?.FM?.PHONE || contact?.phone || [];
  const arr = Array.isArray(fm) ? fm : fm ? [fm] : [];
  for (const p of arr) {
    const n = normalizePhone(p?.VALUE || p?.value || p);
    if (n) list.push(n);
  }
  return list;
}

function telegramFromContact(contact, cfg) {
  const field = cfg.bitrixFields.telegram;
  if (field && contact?.[field]) return normalizeTelegramUsername(contact[field]);
  return (
    normalizeTelegramUsername(contact?.telegramUsername || contact?.telegram) || null
  );
}

function maxFromContact(contact, cfg) {
  const field = cfg.bitrixFields.max;
  if (field && contact?.[field]) return String(contact[field]).trim() || null;
  return contact?.maxChatId ? String(contact.maxChatId) : null;
}

function contactDisplayName(contact) {
  if (!contact) return null;
  const name = [contact.LAST_NAME || contact.lastName, contact.NAME || contact.name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || null;
}

const EXPLICIT_CHANNELS = new Set([
  "telegram",
  "tgapi",
  "whatsapp",
  "wapi",
  "waba",
  "max",
  "maxbot",
]);

export const HUB_CHANNEL_FALLBACK_ORDER = ["telegram", "whatsapp", "max"];

export function normalizeHubChannel(channel) {
  const key = String(channel || "").toLowerCase();
  if (key === "tgapi") return "telegram";
  if (key === "wapi" || key === "waba") return "whatsapp";
  if (key === "maxbot") return "max";
  return key;
}

export function isExplicitHubChannel(channel) {
  return EXPLICIT_CHANNELS.has(String(channel || "").toLowerCase());
}

export function mapChannelToWazzup(channel, transportHint) {
  const key = String(transportHint || channel || "telegram").toLowerCase();
  return CHANNEL_MAP[key] || { chatType: key, transports: [key] };
}

export async function inferPreferredHubChannel(params = {}) {
  const requested = normalizeHubChannel(params.channel || params.chatType);
  if (isExplicitHubChannel(requested)) return requested;
  if (normalizeTelegramUsername(params.username)) return "telegram";
  if (normalizePhone(params.phone)) return "whatsapp";
  const contactId = params.contactId ? String(params.contactId) : null;
  if (!contactId) return "telegram";
  const contact = await fetchBitrixContact(contactId);
  if (!contact) return "telegram";
  const cfg = getCommunicationsConfig();
  if (telegramFromContact(contact, cfg)) return "telegram";
  if (phonesFromContact(contact).length) return "whatsapp";
  if (maxFromContact(contact, cfg)) return "max";
  return "telegram";
}

export function wazzupApiChannelId(hubChannel, fallback = null) {
  const candidates = [
    hubChannel?.externalChannelId,
    fallback,
    hubChannel?.id,
  ];
  for (const value of candidates) {
    const id = String(value || "").trim();
    if (!id || id.startsWith("wazzup:")) continue;
    return id;
  }
  return null;
}

export function findHubChannel(id) {
  return repo.findHubChannel(id);
}

export function isHubChannelActive(channel) {
  const state = String(channel?.state || channel?.status || "").toLowerCase();
  return ["active", "authorized", "ok", "ready"].includes(state);
}

const WABA_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithin24hWindow(lastInboundAt, now = Date.now()) {
  if (!lastInboundAt) return false;
  const ts = Date.parse(lastInboundAt);
  if (!Number.isFinite(ts)) return false;
  return now - ts < WABA_WINDOW_MS;
}

export function getLastInboundAt(contactId, { chatType, transports } = {}) {
  if (!contactId) return null;
  const wanted = (transports || []).map((t) => String(t).toLowerCase());
  const messages = repo.listMessages({ contactId, limit: 80 });
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i];
    if (row.direction !== "inbound") continue;
    const ct = String(row.chatType || "").toLowerCase();
    const tr = String(row.transport || "").toLowerCase();
    if (chatType && ct === String(chatType).toLowerCase()) {
      return row.createdAt || row.sentAt || row.providerTimestamp || null;
    }
    if (wanted.includes(tr) || wanted.includes(ct)) {
      return row.createdAt || row.sentAt || row.providerTimestamp || null;
    }
  }
  return null;
}

export function contactFirstName(contact) {
  const name = String(contact?.NAME || contact?.name || "").trim();
  return name || null;
}

export function pickHubChannel(transports) {
  const wanted = (transports || []).map((t) => String(t).toLowerCase());
  const channels = repo.listHubChannels({ provider: "wazzup" });
  const isActive = (c) =>
    ["active", "authorized", "ok", "ready"].includes(String(c.state || c.status || "").toLowerCase());
  const matches = (c) => {
    const transport = String(c.transport || "").toLowerCase();
    const channel = String(c.channel || "").toLowerCase();
    return wanted.includes(transport) || wanted.includes(channel);
  };
  for (const c of channels) {
    if (isActive(c) && matches(c) && wazzupApiChannelId(c)) return c;
  }
  return channels.find((c) => matches(c) && wazzupApiChannelId(c)) || null;
}

/**
 * Pick a Wazzup channel for the chat type. If the local catalog is empty, sync from API once.
 */
export async function ensureHubChannel(channel, transportHint) {
  const mapped = mapChannelToWazzup(channel, transportHint);
  let hit = pickHubChannel(mapped.transports);
  if (wazzupApiChannelId(hit)) return hit;
  try {
    const { getProvider } = await import("./providers/index.js");
    const provider = getProvider("wazzup");
    if (!provider?.isEnabled?.()) return hit;
    const listed = await provider.listChannels();
    for (const ch of listed) {
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
      });
    }
  } catch {
    return hit;
  }
  return pickHubChannel(mapped.transports);
}

export function listIdentitiesForContact(contactId) {
  const id = String(contactId || "");
  if (!id) return [];
  return getDatabaseIdentities(id);
}

function getDatabaseIdentities(contactId) {
  return repo.listIdentitiesByContact(contactId);
}

function identityMatchesChannel(identity, chatType, transports) {
  const t = String(identity.transport || "").toLowerCase();
  const ct = String(identity.chatType || "").toLowerCase();
  return transports.includes(t) || ct === chatType || t === chatType;
}

async function fetchBitrixContact(contactId) {
  try {
    const { callReadMethod } = await import("../bitrixClient.js");
    const res = await callReadMethod("crm.contact.get", { id: Number(contactId) });
    return res?.result || res || null;
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{
 *   chatType: string,
 *   transport: string,
 *   channelId: string|null,
 *   channelDisplayName: string|null,
 *   channelState: string|null,
 *   channelError: { code: string, message: string }|null,
 *   phone: string|null,
 *   username: string|null,
 *   chatId: string|null,
 *   recipientName: string|null,
 *   recipientFirstName: string|null,
 *   recipientMasked: string|null,
 *   isFirstContact: boolean|undefined,
 *   firstContactGround: string|null,
 *   addressSource: string|null,
 *   within24h: boolean,
 *   lastInboundAt: string|null,
 *   addressStatus: string,
 *   contact: object|null
 * }>}
 */
export async function resolveHubOutboundAddress(params = {}) {
  const cfg = getCommunicationsConfig();
  const mapped = mapChannelToWazzup(params.channel, params.transport);
  const chatType = String(params.chatType || mapped.chatType).toLowerCase();
  const transports = mapped.transports;
  const requestedChannelId = params.channelId || params.wazzupChannelId || null;

  let hubChannel = null;
  let channelError = null;
  if (requestedChannelId) {
    hubChannel = findHubChannel(requestedChannelId);
    if (!hubChannel) {
      await ensureHubChannel(params.channel || "waba", params.transport);
      hubChannel = findHubChannel(requestedChannelId);
    }
    if (!hubChannel) {
      channelError = {
        code: "CHANNEL_NOT_FOUND",
        message: `Канал ${requestedChannelId} не найден среди каналов Wazzup.`,
      };
    } else if (!isHubChannelActive(hubChannel)) {
      channelError = {
        code: "CHANNEL_INACTIVE",
        message: `Канал «${hubChannel.displayName || requestedChannelId}» неактивен (state=${hubChannel.state || hubChannel.status}).`,
        state: hubChannel.state || hubChannel.status,
      };
    }
  } else {
    hubChannel = await ensureHubChannel(params.channel, params.transport);
  }

  const transport = String(
    params.transport || hubChannel?.transport || transports[0] || chatType
  ).toLowerCase();
  const isWhatsappFamily =
    chatType === "whatsapp" || transport === "wapi" || transport === "waba" || transport === "whatsapp";

  let phone = normalizePhone(params.phone);
  let username =
    chatType === "telegram" || chatType === "tgapi"
      ? normalizeTelegramUsername(params.username)
      : null;
  let chatId =
    params.chatId || params.externalChatId
      ? String(params.chatId || params.externalChatId)
      : null;
  let recipientName = params.recipientName || null;
  let recipientFirstName = params.recipientFirstName || null;
  let addressSource = phone || username || chatId ? "params" : null;
  let contact = null;

  const contactId = params.contactId ? String(params.contactId) : null;
  if (contactId) {
    contact = await fetchBitrixContact(contactId);
    if (contact) {
      recipientName = recipientName || contactDisplayName(contact);
      recipientFirstName = recipientFirstName || contactFirstName(contact);
    }
  }

  if (contactId && !phone && !username && !chatId) {
    const identities = listIdentitiesForContact(contactId).filter((row) =>
      identityMatchesChannel(row, chatType, transports)
    );
    const ident =
      identities.find((row) => row.externalChatId || row.username || row.phoneNormalized) ||
      identities[0];
    if (ident) {
      chatId = ident.externalChatId || chatId;
      username = ident.username || username;
      phone = ident.phoneNormalized || phone;
      addressSource = "identity";
    }
  }

  // WhatsApp / WABA: phone from Bitrix card is a valid address even if a username was also passed.
  if (contactId && contact && isWhatsappFamily && !phone) {
    const phones = phonesFromContact(contact);
    if (phones[0]) {
      phone = phones[0];
      addressSource = "bitrix_phone";
    }
  }

  if (contactId && contact && !phone && !username && !chatId) {
    if (chatType === "telegram") {
      username = telegramFromContact(contact, cfg);
      addressSource = username ? "bitrix_telegram_field" : addressSource;
    } else if (chatType === "max") {
      chatId = maxFromContact(contact, cfg);
      addressSource = chatId ? "bitrix_max_field" : addressSource;
    } else {
      const phones = phonesFromContact(contact);
      phone = phones[0] || null;
      addressSource = phone ? "bitrix_phone" : addressSource;
    }
  }

  const lastInboundAt = contactId
    ? getLastInboundAt(contactId, { chatType, transports })
    : null;
  const within24h = isWithin24hWindow(lastInboundAt);

  let isFirstContact = params.isFirstContact;
  let firstContactGround = params.firstContactGround || null;
  if (contactId && isFirstContact == null) {
    if (lastInboundAt) {
      isFirstContact = false;
      firstContactGround = firstContactGround || (within24h ? "active_dialog" : "inbound");
    }
  }

  const hasAddress = Boolean(phone || username || chatId);
  let addressStatus = "missing";
  if (hasAddress && within24h) addressStatus = "active_dialog";
  else if (hasAddress && isFirstContact !== false && !firstContactGround) addressStatus = "no_consent";
  else if (hasAddress) addressStatus = "ok";

  const recipientMasked = phone
    ? maskPhone(phone)
    : username
      ? `@${String(username).slice(0, 2)}***`
      : chatId
        ? "***"
        : null;

  return {
    chatType,
    transport,
    channelId: wazzupApiChannelId(hubChannel, requestedChannelId),
    channelDisplayName: hubChannel?.displayName || null,
    channelState: hubChannel?.state || hubChannel?.status || null,
    channelError,
    phone,
    username,
    chatId,
    recipientName,
    recipientFirstName,
    recipientMasked,
    isFirstContact,
    firstContactGround,
    addressSource,
    within24h,
    lastInboundAt,
    addressStatus,
    contact,
  };
}
