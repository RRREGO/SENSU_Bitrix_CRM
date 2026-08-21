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

export function pickHubChannel(transports) {
  const wanted = (transports || []).map((t) => String(t).toLowerCase());
  const channels = repo.listHubChannels({ provider: "wazzup" });
  const active = channels.filter((c) =>
    ["active", "authorized", "ok", "ready"].includes(String(c.state || c.status || "").toLowerCase())
  );
  for (const t of wanted) {
    const hit = active.find((c) => String(c.transport || "").toLowerCase() === t);
    if (hit) return hit;
  }
  return null;
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
    const { default: bitrix } = await import("../bitrixClient.js");
    const res = await bitrix.call("crm.contact.get", { id: Number(contactId) });
    return res?.result || null;
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{
 *   chatType: string,
 *   transport: string,
 *   channelId: string|null,
 *   phone: string|null,
 *   username: string|null,
 *   chatId: string|null,
 *   recipientName: string|null,
 *   recipientMasked: string|null,
 *   isFirstContact: boolean|undefined,
 *   firstContactGround: string|null,
 *   addressSource: string|null
 * }>}
 */
export async function resolveHubOutboundAddress(params = {}) {
  const cfg = getCommunicationsConfig();
  const mapped = mapChannelToWazzup(params.channel, params.transport);
  const chatType = String(params.chatType || mapped.chatType).toLowerCase();
  const transports = mapped.transports;
  const hubChannel = params.channelId
    ? repo.getHubChannel(params.channelId) || { id: params.channelId, transport: params.transport }
    : pickHubChannel(transports);
  const transport = String(
    params.transport || hubChannel?.transport || transports[0] || chatType
  ).toLowerCase();

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
  let addressSource = phone || username || chatId ? "params" : null;

  const contactId = params.contactId ? String(params.contactId) : null;
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

  if (contactId && !phone && !username && !chatId) {
    const contact = await fetchBitrixContact(contactId);
    if (contact) {
      recipientName = recipientName || contactDisplayName(contact);
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
  }

  let isFirstContact = params.isFirstContact;
  let firstContactGround = params.firstContactGround || null;
  if (contactId && isFirstContact == null) {
    const recent = repo.listMessages({ contactId, limit: 30 });
    const inbound = recent.some(
      (m) =>
        m.direction === "inbound" &&
        (String(m.chatType || "").toLowerCase() === chatType ||
          transports.includes(String(m.transport || "").toLowerCase()))
    );
    if (inbound) {
      isFirstContact = false;
      firstContactGround = firstContactGround || "inbound";
    }
  }

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
    channelId: hubChannel?.externalChannelId || hubChannel?.id || params.channelId || null,
    phone,
    username,
    chatId,
    recipientName,
    recipientMasked,
    isFirstContact,
    firstContactGround,
    addressSource,
  };
}
