/**
 * Resolve CRM contact for inbound/outbound messaging.
 * Order: identity → chatId → phone → telegram username → MAX field → Wazzup contact link → manual.
 * Ambiguous → unresolved, no auto-create contact.
 */

import {
  CommunicationError,
  getCommunicationsConfig,
  normalizePhone,
  normalizeTelegramUsername,
} from "./config.js";
import * as repo from "./communicationRepository.js";

async function fetchContactById(contactId) {
  try {
    const { default: bitrix } = await import("../bitrixClient.js");
    const res = await bitrix.call("crm.contact.get", { id: contactId });
    return res?.result || null;
  } catch {
    return null;
  }
}

function phonesFromContact(contact) {
  const list = [];
  const fm = contact?.FM?.PHONE || contact?.PHONE || [];
  const arr = Array.isArray(fm) ? fm : fm ? [fm] : [];
  for (const p of arr) {
    const v = p?.VALUE || p?.value || p;
    const n = normalizePhone(v);
    if (n) list.push(n);
  }
  return list;
}

/**
 * @param {object} input
 * @returns {Promise<{ status: 'resolved'|'unresolved'|'ambiguous', contactId: string|null, identityId: string|null, matches: object[], reason: string }>}
 */
export async function resolveContact(input = {}) {
  const provider = String(input.provider || "wazzup");
  const chatId = input.chatId != null ? String(input.chatId) : null;
  const phone = normalizePhone(input.phone);
  const username = normalizeTelegramUsername(input.username);
  const cfg = getCommunicationsConfig();
  const matches = [];

  // 1. Existing identity by id
  if (input.identityId) {
    const idRow = repo.getIdentity(input.identityId);
    if (idRow?.contactId) {
      return {
        status: "resolved",
        contactId: idRow.contactId,
        identityId: idRow.id,
        matches: [{ via: "identity", contactId: idRow.contactId }],
        reason: "identity",
      };
    }
  }

  // 1b. Existing identity by provider+chatId
  if (chatId) {
    const byChat = repo.findIdentityByChat(provider, chatId);
    if (byChat?.contactId) {
      return {
        status: "resolved",
        contactId: byChat.contactId,
        identityId: byChat.id,
        matches: [{ via: "identity_chat", contactId: byChat.contactId }],
        reason: "identity",
      };
    }
    if (byChat && !byChat.contactId) {
      return {
        status: byChat.resolutionStatus === "ambiguous" ? "ambiguous" : "unresolved",
        contactId: null,
        identityId: byChat.id,
        matches: [],
        reason: "identity_unlinked",
      };
    }
  }

  // 2. Exact chatId across identities (already covered) — also search identity table loosely
  // 3. Normalized phone
  if (phone) {
    const byPhone = repo.findIdentitiesByPhone(phone);
    for (const row of byPhone) {
      if (row.contactId) matches.push({ via: "phone_identity", contactId: String(row.contactId) });
    }
  }

  // 4. Telegram username
  if (username) {
    const byUser = repo.findIdentitiesByUsername(provider, username);
    for (const row of byUser) {
      if (row.contactId) matches.push({ via: "telegram_username", contactId: String(row.contactId) });
    }
  }

  // 5. Bitrix MAX field / telegram field (when contact candidates supplied or search)
  if (input.contactHintId) {
    const contact = await fetchContactById(input.contactHintId);
    if (contact) {
      if (phone) {
        const phones = phonesFromContact(contact);
        if (phones.includes(phone)) {
          matches.push({ via: "phone", contactId: String(contact.ID || input.contactHintId) });
        }
      }
      if (username && cfg.bitrixFields.telegram) {
        const tg = contact[cfg.bitrixFields.telegram];
        if (normalizeTelegramUsername(tg) === username) {
          matches.push({ via: "telegram_field", contactId: String(contact.ID || input.contactHintId) });
        }
      }
      if (chatId && cfg.bitrixFields.max) {
        const maxVal = String(contact[cfg.bitrixFields.max] || "");
        if (maxVal && maxVal === chatId) {
          matches.push({ via: "max_field", contactId: String(contact.ID || input.contactHintId) });
        }
      }
    }
  }

  // 6. Explicit Wazzup contact link (crm contact id in authorId / contactLink)
  const linkedContactId =
    input.wazzupContactId ||
    input.crmContactId ||
    (input.authorId && /^\d+$/.test(String(input.authorId)) ? String(input.authorId) : null);
  if (linkedContactId && input.acceptWazzupLink !== false) {
    matches.push({ via: "wazzup_contact_link", contactId: String(linkedContactId) });
  }

  // Deduplicate by contactId
  const unique = new Map();
  for (const m of matches) {
    if (!m.contactId) continue;
    if (!unique.has(m.contactId)) unique.set(m.contactId, m);
  }
  const uniqueMatches = [...unique.values()];

  if (uniqueMatches.length === 1) {
    const contactId = uniqueMatches[0].contactId;
    const identity = repo.upsertIdentity({
      contactId,
      provider,
      transport: input.transport || null,
      chatType: input.chatType || null,
      externalChatId: chatId,
      username,
      phoneNormalized: phone,
      source: uniqueMatches[0].via,
      verified: uniqueMatches[0].via === "identity" || uniqueMatches[0].via === "identity_chat",
      resolutionStatus: "resolved",
    });
    return {
      status: "resolved",
      contactId,
      identityId: identity.id,
      matches: uniqueMatches,
      reason: uniqueMatches[0].via,
    };
  }

  if (uniqueMatches.length > 1) {
    const identity = repo.upsertIdentity({
      contactId: null,
      provider,
      transport: input.transport || null,
      chatType: input.chatType || null,
      externalChatId: chatId,
      username,
      phoneNormalized: phone,
      source: "ambiguous",
      verified: false,
      resolutionStatus: "ambiguous",
      metadata: { matchContactIds: uniqueMatches.map((m) => m.contactId) },
    });
    return {
      status: "ambiguous",
      contactId: null,
      identityId: identity.id,
      matches: uniqueMatches,
      reason: "ambiguous",
    };
  }

  // Unresolved — store for manual resolution, do NOT auto-create CRM contact
  const identity = repo.upsertIdentity({
    contactId: null,
    provider,
    transport: input.transport || null,
    chatType: input.chatType || null,
    externalChatId: chatId,
    username,
    phoneNormalized: phone,
    source: input.source || "webhook",
    verified: false,
    resolutionStatus: "unresolved",
  });

  return {
    status: "unresolved",
    contactId: null,
    identityId: identity.id,
    matches: [],
    reason: "manual_required",
  };
}

export function linkIdentityToContact(identityId, contactId, { userId = null } = {}) {
  if (!identityId || !contactId) {
    throw new CommunicationError("IDENTITY_LINK_INVALID", "Нужны identityId и contactId.");
  }
  const identity = repo.getIdentity(identityId);
  if (!identity) {
    throw new CommunicationError("IDENTITY_NOT_FOUND", "Identity не найдена.");
  }
  return repo.updateIdentity(identityId, {
    contactId: String(contactId),
    resolutionStatus: "resolved",
    source: "manual",
    verified: true,
    metadata: {
      ...(identity.metadata || {}),
      linkedByUserId: userId,
      linkedAt: new Date().toISOString(),
    },
  });
}
