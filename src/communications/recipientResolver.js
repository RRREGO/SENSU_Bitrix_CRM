/**
 * Разрешение получателя на сервере (с маскированием).
 */

import { callReadMethod } from "../bitrixClient.js";
import { ENTITY_TYPE, unwrapCrmItem } from "../actions/helpers.js";
import { CommunicationError, maskEmail, maskPhone, normalizeTelegramUsername, getCommunicationsConfig } from "./config.js";
import { getContactMethodologyConfig } from "../config/contactMethodology.js";
import { getField, displayNameFromContact } from "../clientContext/fieldAllowlists.js";

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "object" ? v.VALUE || v.value || v : v))
      .filter(Boolean)
      .map(String);
  }
  return [String(value)];
}

async function fetchContactRaw(contactId) {
  const id = Number(contactId);
  if (!id) return null;
  try {
    const item = await callReadMethod("crm.item.get", {
      entityTypeId: ENTITY_TYPE.CONTACT,
      id,
    });
    return unwrapCrmItem(item) || item;
  } catch {
    try {
      return unwrapCrmItem(await callReadMethod("crm.contact.get", { id })) || null;
    } catch {
      return null;
    }
  }
}

async function resolveContactId({ entityType, entityId, contactId }) {
  if (contactId) return Number(contactId);
  const type = String(entityType || "").toLowerCase();
  const id = Number(entityId);
  if (type === "contact" && id) return id;
  if (!type || !id) return null;
  try {
    const raw = await callReadMethod("crm.item.get", {
      entityTypeId: ENTITY_TYPE[type.toUpperCase()],
      id,
    });
    const item = unwrapCrmItem(raw) || raw;
    return Number(item.contactId || item.CONTACT_ID || 0) || null;
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<object>}
 */
export async function resolveMessageRecipient({
  entityType,
  entityId,
  contactId,
  channel,
  recipientOptionId = null,
  userId = null,
}) {
  const ch = String(channel || "").toLowerCase();

  if (ch === "bitrix_chat") {
    if (!userId) {
      throw new CommunicationError(
        "MESSAGE_RECIPIENT_NOT_FOUND",
        "Укажите userId сотрудника Bitrix24 для внутреннего чата."
      );
    }
    let name = `Пользователь #${userId}`;
    try {
      const users = await callReadMethod("user.get", { filter: { ID: Number(userId) } });
      const list = Array.isArray(users) ? users : [];
      const u = list[0];
      if (u) {
        name = [u.LAST_NAME || u.lastName, u.NAME || u.name].filter(Boolean).join(" ").trim() || name;
      }
    } catch {
      /* ignore */
    }
    return {
      channel: ch,
      contactId: null,
      userId: Number(userId),
      dialogId: String(userId),
      name,
      maskedAddress: `user:${userId}`,
      reference: `bitrix_user:${userId}`,
      statusValue: null,
    };
  }

  const resolvedContactId = await resolveContactId({ entityType, entityId, contactId });
  if (!resolvedContactId) {
    throw new CommunicationError(
      "MESSAGE_RECIPIENT_NOT_FOUND",
      "Не удалось определить контакт для отправки."
    );
  }

  const raw = await fetchContactRaw(resolvedContactId);
  if (!raw) {
    throw new CommunicationError("MESSAGE_RECIPIENT_NOT_FOUND", "Контакт не найден.");
  }

  const methodology = getContactMethodologyConfig();
  const name = displayNameFromContact(raw) || getField(raw, "NAME", "name") || `Контакт #${resolvedContactId}`;
  const statusValue = methodology.statusField
    ? getField(raw, methodology.statusField) || raw[methodology.statusField]
    : null;

  const phones = asList(raw.PHONE || raw.phone || raw.Phone);
  const emails = asList(raw.EMAIL || raw.email || raw.Email);

  const options = [];
  if (ch === "email") {
    for (let i = 0; i < emails.length; i++) {
      options.push({
        id: `email:${i}`,
        kind: "email",
        maskedAddress: maskEmail(emails[i]),
        // private field only in memory for prepare/send — not returned to client below
        _value: emails[i],
      });
    }
  } else if (ch === "telegram") {
    const cfg = getCommunicationsConfig();
    const field = cfg.bitrixFields.telegram;
    const tgRaw = field ? raw[field] || getField(raw, field) : null;
    const username = normalizeTelegramUsername(tgRaw);
    if (username) {
      options.push({
        id: "telegram:username",
        kind: "telegram_username",
        maskedAddress: `@${username.slice(0, 2)}***`,
        _username: username,
      });
    }
  } else if (ch === "whatsapp" || ch === "open_lines") {
    for (let i = 0; i < phones.length; i++) {
      options.push({
        id: `phone:${i}`,
        kind: "phone",
        maskedAddress: maskPhone(phones[i]),
        _value: phones[i],
      });
    }
  }

  if (!options.length) {
    throw new CommunicationError(
      "MESSAGE_RECIPIENT_NOT_FOUND",
      "У контакта нет подходящего адреса для выбранного канала."
    );
  }

  if (options.length > 1 && !recipientOptionId) {
    throw new CommunicationError(
      "MESSAGE_RECIPIENT_AMBIGUOUS",
      "Для контакта найдено несколько адресов получателя. Выберите нужный вариант.",
      {
        options: options.map(({ id, kind, maskedAddress }) => ({ id, kind, maskedAddress })),
      }
    );
  }

  const chosen =
    options.find((o) => o.id === recipientOptionId) || (options.length === 1 ? options[0] : null);
  if (!chosen) {
    throw new CommunicationError(
      "MESSAGE_RECIPIENT_AMBIGUOUS",
      "Выбранный вариант получателя не найден.",
      { options: options.map(({ id, kind, maskedAddress }) => ({ id, kind, maskedAddress })) }
    );
  }

  return {
    channel: ch,
    contactId: resolvedContactId,
    name,
    maskedAddress: chosen.maskedAddress,
    kind: chosen.kind,
    optionId: chosen.id,
    reference: `${ch}:${resolvedContactId}:${chosen.id}`,
    statusValue,
    email: chosen.kind === "email" ? chosen._value : null,
    phone: chosen.kind === "phone" ? chosen._value : null,
    username: chosen.kind === "telegram_username" ? chosen._username : null,
    // Public options without secrets
    publicOptions: options.map(({ id, kind, maskedAddress }) => ({ id, kind, maskedAddress })),
  };
}
