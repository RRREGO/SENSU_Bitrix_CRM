/**
 * Черновики сообщений и рекомендации следующего шага.
 */

import { getContactMethodologyConfig } from "../config/contactMethodology.js";
import { crm_context_get } from "./crmContextGet.js";
import { crm_context_summary } from "./crmContextSummary.js";
import { ClientContextError } from "./config.js";
import { callReadMethod } from "../bitrixClient.js";
import { unwrapCrmItem, ENTITY_TYPE } from "../actions/helpers.js";
import { normalizeContactFields, getField, displayNameFromContact } from "./fieldAllowlists.js";
import { sanitizeLlmPayload } from "../llm/sanitize.js";

async function loadContactStatusValue(contactId) {
  if (!contactId) return null;
  const methodology = getContactMethodologyConfig();
  if (!methodology.statusField) return null;
  try {
    const raw = await callReadMethod("crm.item.get", {
      entityTypeId: ENTITY_TYPE.CONTACT,
      id: Number(contactId),
    });
    const fields = normalizeContactFields(unwrapCrmItem(raw) || raw, [methodology.statusField]);
    return {
      fields,
      statusValue: getField(fields, methodology.statusField),
      name: displayNameFromContact(fields),
    };
  } catch {
    return null;
  }
}

function isBlockedStatus(statusValue) {
  const methodology = getContactMethodologyConfig();
  const val = statusValue != null ? String(statusValue) : "";
  if (!val) return { blocked: false };

  if (methodology.statusSpamValues.map(String).includes(val)) {
    return { blocked: true, reason: "spam" };
  }
  if (methodology.statusDoNotContactValues.map(String).includes(val)) {
    return { blocked: true, reason: "do_not_contact" };
  }
  return { blocked: false, personal: methodology.statusPersonalValues.map(String).includes(val) };
}

/**
 * client_message_draft — только черновик, без отправки.
 */
export async function client_message_draft(params = {}) {
  const entityType = String(params.entityType || "").toLowerCase();
  const entityId = Number(params.entityId);
  const channel = String(params.channel || "whatsapp").toLowerCase();
  const purpose = params.purpose || "follow_up";
  const tone = params.tone || "business";

  const context = await crm_context_get({
    entityType,
    entityId,
    mode: "compact",
    include: ["fields", "relations", "activities", "timeline"],
  });

  const contactId =
    entityType === "contact" ? entityId : context.relations?.contact?.id || null;
  const contactInfo = contactId ? await loadContactStatusValue(contactId) : null;
  const statusCheck = isBlockedStatus(
    contactInfo?.statusValue ?? context.relations?.contact?.statusField
  );

  if (statusCheck.blocked) {
    throw new ClientContextError(
      "CLIENT_COMMUNICATION_BLOCKED",
      "Для контакта установлен статус, запрещающий коммуникацию.",
      { reason: statusCheck.reason }
    );
  }

  if (statusCheck.personal) {
    const responsibleId = context.entity?.responsible?.id;
    // Without current user identity — warn only
    // Block if we can't prove ownership — require explicit override flag
    if (!params.allowPersonal) {
      throw new ClientContextError(
        "CLIENT_COMMUNICATION_BLOCKED",
        "Контакт имеет статус «Личный». Черновик доступен только с allowPersonal=true ответственного.",
        { reason: "personal", responsibleId }
      );
    }
  }

  const name =
    contactInfo?.name ||
    context.relations?.contact?.name ||
    (entityType === "contact" ? context.entity.title : null) ||
    "коллега";

  const last = context.timeline?.[0];
  const basedOn = [];
  if (last) {
    basedOn.push({
      type: last.source,
      id: last.id,
      text: last.title,
    });
  }
  if (context.state?.nextActivity) {
    basedOn.push({
      type: "crm_activity",
      id: context.state.nextActivity.id,
      text: context.state.nextActivity.title,
    });
  }

  let body;
  if (channel === "email") {
    body = [
      `Здравствуйте, ${name}!`,
      "",
      purpose === "follow_up"
        ? "Пишу по итогам нашего последнего общения. Готов направить материалы и согласовать следующие шаги."
        : "Направляю информацию по нашему вопросу.",
      "",
      "Если удобно — предложите время для короткого созвона.",
      "",
      "С уважением,",
      context.entity?.responsible?.name || "",
    ].join("\n");
  } else {
    // whatsapp / telegram / universal
    body = [
      `Здравствуйте, ${name}!`,
      purpose === "follow_up"
        ? "Коротко по итогам: готов продолжить и прислать обещанные материалы."
        : "Пишу по нашему вопросу.",
      "Подскажите, пожалуйста, удобный следующий шаг.",
    ].join(" ");
  }

  // Do not invent deadlines or promises
  const safe = sanitizeLlmPayload(
    {
      recipient: { name },
      channel,
      subject: channel === "email" ? `По ${context.entity.title}` : null,
      body,
      basedOn,
      warnings: statusCheck.personal
        ? [{ code: "PERSONAL_CONTACT", message: "Статус «Личный» — проверьте право коммуникации." }]
        : [],
    },
    "message_draft"
  );

  return {
    success: true,
    ...safe,
    tone,
    purpose,
    entity: { type: entityType, id: entityId },
  };
}

/**
 * recommend_next_client_action
 */
export async function recommend_next_client_action(params = {}) {
  const summary = await crm_context_summary(params);
  const context = await crm_context_get({
    entityType: params.entityType,
    entityId: params.entityId,
    mode: "standard",
    include: ["fields", "relations", "activities", "tasks", "timeline"],
  });

  const facts = summary.facts || [];
  const risks = summary.risks || [];
  const options = [];
  const notRecommended = [];

  if (context.state?.overdueActivities > 0) {
    options.push({
      priority: 1,
      action: "Обработать просроченные дела",
      reason: `Просрочек: ${context.state.overdueActivities}`,
      draftAvailable: false,
    });
  }

  options.push({
    priority: options.length ? 2 : 1,
    action: "Написать клиенту",
    reason: summary.lastInteraction
      ? "Есть зафиксированное взаимодействие — возможен follow-up"
      : "Явной коммуникации в доступных источниках нет — уточнить канал",
    draftAvailable: true,
  });

  if (!context.state?.nextActivity) {
    options.push({
      priority: 3,
      action: "Создать следующее CRM-дело",
      reason: "Нет незавершённого следующего шага в карточке",
      draftAvailable: false,
    });
  }

  notRecommended.push({
    action: "Автоматически менять стадию",
    reason: "Смена стадии только после явного подтверждения через Safety Layer",
  });
  notRecommended.push({
    action: "Отправлять сообщение без подтверждения",
    reason: "На этапе доступны только черновики",
  });

  return {
    success: true,
    facts,
    risks,
    options: options.sort((a, b) => a.priority - b.priority),
    notRecommended,
    warnings: context.warnings || [],
    partial: Boolean(context.partial || summary.partial),
  };
}
