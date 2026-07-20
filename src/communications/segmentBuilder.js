/**
 * Segment filters for campaigns (in-memory / provided contact list).
 * Does not invent Bitrix field IDs — caller supplies contact records with mapped fields.
 */

import { normalizePhone, normalizeTelegramUsername, getCommunicationsConfig } from "./config.js";
import * as repo from "./communicationRepository.js";

function contactHasPhone(contact) {
  const phones = contact.phones || contact.FM?.PHONE || [];
  if (Array.isArray(phones) && phones.length) return true;
  return Boolean(normalizePhone(contact.phone || contact.PHONE));
}

function contactTelegram(contact, cfg) {
  if (contact.telegramUsername || contact.telegram) {
    return normalizeTelegramUsername(contact.telegramUsername || contact.telegram);
  }
  const field = cfg.bitrixFields.telegram;
  if (field && contact[field]) return normalizeTelegramUsername(contact[field]);
  return null;
}

function contactMax(contact, cfg) {
  if (contact.maxChatId) return String(contact.maxChatId);
  const field = cfg.bitrixFields.max;
  if (field && contact[field]) return String(contact[field]);
  return null;
}

/**
 * @param {object[]} contacts — CRM contact-like objects
 * @param {object} filters
 * @returns {{ included: object[], excluded: { contact, code, message }[] }}
 */
export function buildSegment(contacts = [], filters = {}) {
  const cfg = getCommunicationsConfig();
  const included = [];
  const excluded = [];

  for (const contact of contacts) {
    const contactId = String(contact.id || contact.ID || contact.contactId || "");
    const reason = matchFilters(contact, contactId, filters, cfg);
    if (reason) {
      excluded.push({ contact, contactId, code: reason.code, message: reason.message });
    } else {
      included.push(contact);
    }
  }

  return { included, excluded, total: contacts.length };
}

function matchFilters(contact, contactId, filters, cfg) {
  const status = contact.statusValue ?? contact.status ?? contact[filters.statusField];
  if (filters.statusIn?.length) {
    if (!filters.statusIn.map(String).includes(String(status))) {
      return { code: "STATUS_FILTER", message: "Статус не входит в сегмент." };
    }
  }
  if (filters.statusNotIn?.length) {
    if (filters.statusNotIn.map(String).includes(String(status))) {
      return { code: "STATUS_EXCLUDED", message: "Статус исключён из сегмента." };
    }
  }

  if (filters.assignedById != null) {
    const assigned = contact.assignedById ?? contact.ASSIGNED_BY_ID;
    if (String(assigned) !== String(filters.assignedById)) {
      return { code: "ASSIGNED_FILTER", message: "Другой ответственный." };
    }
  }

  if (filters.companyId != null) {
    const company = contact.companyId ?? contact.COMPANY_ID;
    if (String(company) !== String(filters.companyId)) {
      return { code: "COMPANY_FILTER", message: "Другая компания." };
    }
  }

  if (filters.city) {
    const city = String(contact.city || contact.ADDRESS_CITY || "").toLowerCase();
    if (!city.includes(String(filters.city).toLowerCase())) {
      return { code: "CITY_FILTER", message: "Город не совпадает." };
    }
  }

  if (filters.hasPhone === true && !contactHasPhone(contact)) {
    return { code: "NO_PHONE", message: "Нет телефона." };
  }
  if (filters.hasTelegram === true && !contactTelegram(contact, cfg)) {
    return { code: "NO_TELEGRAM", message: "Нет Telegram." };
  }
  if (filters.hasMax === true && !contactMax(contact, cfg)) {
    return { code: "NO_MAX", message: "Нет поля MAX." };
  }

  if (filters.requireChannel) {
    const ch = String(filters.requireChannel).toLowerCase();
    if (ch === "telegram" && !contactTelegram(contact, cfg) && !contact.chatId) {
      return { code: "NO_CHANNEL_ADDRESS", message: "Нет адреса Telegram." };
    }
    if ((ch === "whatsapp" || ch === "wapi") && !contactHasPhone(contact) && !contact.chatId) {
      return { code: "NO_CHANNEL_ADDRESS", message: "Нет адреса WhatsApp." };
    }
    if (ch === "max" && !contactMax(contact, cfg) && !contact.chatId) {
      return { code: "NO_CHANNEL_ADDRESS", message: "Нет chatId MAX." };
    }
  }

  if (filters.excludeSuppression !== false && contactId) {
    const s = repo.findActiveSuppression(contactId, {
      phone: normalizePhone(contact.phone),
      channel: filters.requireChannel,
    });
    if (s) {
      return { code: "SUPPRESSION", message: "В suppression list." };
    }
  }

  if (filters.requireConsent && contactId) {
    const c = repo.findActiveConsent(contactId, filters.requireChannel);
    if (!c) {
      return { code: "NO_CONSENT", message: "Нет согласия на коммуникацию." };
    }
  }

  if (filters.excludeActiveSequence && contactId) {
    const active = repo.listActiveEnrollmentsForContact(contactId);
    if (active.length) {
      return { code: "ACTIVE_SEQUENCE", message: "Уже в активной цепочке." };
    }
  }

  if (filters.inactiveDays != null) {
    const last = contact.lastContactAt || contact.lastActivityAt;
    if (last) {
      const days = (Date.now() - new Date(last).getTime()) / 86400000;
      if (days < Number(filters.inactiveDays)) {
        return { code: "TOO_RECENT", message: "Была недавняя активность." };
      }
    }
  }

  if (filters.hasReply === true && contact.hasReply === false) {
    return { code: "NO_REPLY", message: "Нет ответа клиента." };
  }
  if (filters.hasReply === false && contact.hasReply === true) {
    return { code: "HAS_REPLY", message: "Есть ответ — исключён из сегмента." };
  }

  if (filters.birthdayMonth != null) {
    const bday = contact.birthday || contact.BIRTHDATE;
    if (!bday) return { code: "NO_BIRTHDAY", message: "Нет даты рождения." };
    const month = new Date(bday).getMonth() + 1;
    if (month !== Number(filters.birthdayMonth)) {
      return { code: "BIRTHDAY_FILTER", message: "Месяц ДР не совпадает." };
    }
  }

  return null;
}
