import { ENTITY_TYPE } from "../actions/helpers.js";
import { callReadMethod } from "../bitrixClient.js";
import { pickFields, redactObject } from "./redact.js";
import { getActionPolicy } from "./policies.js";
import { rollbackExpiresAt } from "./config.js";

const FIELD_LABELS = {
  TITLE: "Название",
  STAGE_ID: "Стадия",
  CATEGORY_ID: "Воронка",
  ASSIGNED_BY_ID: "Ответственный",
  OPPORTUNITY: "Сумма",
  CURRENCY_ID: "Валюта",
  COMMENTS: "Комментарий",
  STATUS_ID: "Статус",
  NAME: "Имя",
  LAST_NAME: "Фамилия",
  SECOND_NAME: "Отчество",
  COMPANY_ID: "Компания",
  CONTACT_ID: "Контакт",
  RESPONSIBLE_ID: "Ответственный",
  DESCRIPTION: "Описание",
  DEADLINE: "Крайний срок",
  COMPLETED: "Завершено",
  SUBJECT: "Тема",
};

function label(field) {
  return FIELD_LABELS[field] || FIELD_LABELS[String(field).toUpperCase()] || field;
}

function unwrapItem(result) {
  if (!result) return null;
  if (result.item) return result.item;
  if (result.result?.item) return result.result.item;
  if (result.result && typeof result.result === "object" && !Array.isArray(result.result)) {
    return result.result;
  }
  return result;
}

function entityName(entity, fallback = "Без названия") {
  return (
    entity?.TITLE ||
    entity?.title ||
    [entity?.LAST_NAME || entity?.lastName, entity?.NAME || entity?.name]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    fallback
  );
}

function getField(entity, field) {
  if (!entity) return undefined;
  if (Object.prototype.hasOwnProperty.call(entity, field)) return entity[field];
  const upper = String(field).toUpperCase();
  const lower = String(field).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(entity, upper)) return entity[upper];
  if (Object.prototype.hasOwnProperty.call(entity, lower)) return entity[lower];
  return undefined;
}

async function fetchCrmEntity(entityType, id) {
  const map = {
    deal: { typeId: ENTITY_TYPE.DEAL, legacy: "crm.deal.get" },
    lead: { typeId: ENTITY_TYPE.LEAD, legacy: "crm.lead.get" },
    contact: { typeId: ENTITY_TYPE.CONTACT, legacy: "crm.contact.get" },
    company: { typeId: ENTITY_TYPE.COMPANY, legacy: "crm.company.get" },
  };
  const cfg = map[entityType];
  if (!cfg) throw new Error(`Unsupported entity type: ${entityType}`);

  try {
    const result = await callReadMethod("crm.item.get", {
      entityTypeId: cfg.typeId,
      id: Number(id),
    });
    return unwrapItem(result);
  } catch {
    const result = await callReadMethod(cfg.legacy, { id: Number(id) });
    return unwrapItem(result);
  }
}

async function fetchTask(id) {
  const result = await callReadMethod("tasks.task.get", {
    taskId: Number(id),
    select: ["ID", "TITLE", "DESCRIPTION", "RESPONSIBLE_ID", "DEADLINE", "STATUS", "GROUP_ID"],
  });
  return result?.task || result?.result?.task || result;
}

function buildChanges(beforeFields, afterFields) {
  const changes = [];
  for (const field of Object.keys(afterFields || {})) {
    const before = beforeFields?.[field];
    const after = afterFields[field];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    changes.push({
      field,
      fieldName: label(field),
      before: before ?? null,
      after: after ?? null,
    });
  }
  return changes;
}

/**
 * Построить план preview для write-action (без изменений Bitrix24).
 * @returns {Promise<{
 *  preview: object,
 *  before: object,
 *  after: object,
 *  items: array,
 *  entityIds: array,
 *  affectedCount: number,
 *  execPlan: object
 * }>}
 */
export async function buildOperationPlan(action, params, policy) {
  const title = policy?.title || action;

  switch (action) {
    case "deal_update":
      return planEntityUpdate("deal", params, title);
    case "lead_update":
      return planEntityUpdate("lead", params, title);
    case "contact_update":
      return planEntityUpdate("contact", params, title);
    case "company_update":
      return planEntityUpdate("company", params, title);
    case "update_task":
      return planTaskUpdate(params, title);
    case "create_deal":
      return planCreateDeal(params, title);
    case "lead_create":
      return planCreate("lead", params, title);
    case "contact_create":
      return planCreate("contact", params, title);
    case "company_create":
      return planCreate("company", params, title);
    case "create_task":
      return planCreateTask(params, title);
    case "activity_add":
      return planActivityAdd(params, title);
    case "timeline_comment_add":
      return planTimelineComment(params, title);
    case "client_message_send":
      return planClientMessageSend(params, title, policy);
    case "communication_message_send_prepare":
      return planCommunicationMessageSend(params, title, policy);
    case "communication_campaign_start_prepare":
      return planCommunicationCampaignStart(params, title, policy);
    case "communication_campaign_pause_prepare":
      return planCommunicationCampaignPause(params, title, policy);
    case "communication_campaign_cancel_prepare":
      return planCommunicationCampaignCancel(params, title, policy);
    case "communication_sequence_activate_prepare":
      return planCommunicationSequenceActivate(params, title, policy);
    case "communication_sequence_enroll_prepare":
      return planCommunicationSequenceEnroll(params, title, policy);
    case "communication_enrollment_stop_prepare":
      return planCommunicationEnrollmentStop(params, title, policy);
    case "activity_update":
    case "activity_complete":
      return planActivityUpdate(action, params, title);
    case "lead_delete":
    case "deal_delete":
    case "delete_task":
    case "activity_delete":
      return planDelete(action, params, title);
    default:
      return planGeneric(action, params, title, policy);
  }
}

async function planCommunicationMessageSend(params, title, policy) {
  const { prepareMessageSend } = await import("../communications/communicationService.js");
  const prepared = prepareMessageSend(params || {});
  if (!prepared.policy?.allowed) {
    throw Object.assign(new Error(prepared.policy?.message || "Отправка запрещена политикой."), {
      code: prepared.policy?.code || "POLICY_BLOCKED",
    });
  }
  const hubPreview = prepared.preview;
  const requiredConfirmationPhrase = prepared.confirmationPhrase || null;
  const preview = {
    title: title || "Отправка сообщения (Communications Hub)",
    risk: policy?.risk || "high",
    affectedCount: 1,
    reversible: false,
    channel: hubPreview.channel || params.channel,
    transport: hubPreview.transport,
    contactId: hubPreview.contactId,
    recipientMasked: hubPreview.recipientMasked,
    bodyPreview: hubPreview.bodyPreview,
    bodyLength: hubPreview.bodyLength,
    templateId: hubPreview.templateId,
    policyAllowed: hubPreview.policyAllowed,
    policyCode: hubPreview.policyCode,
    dryRun: hubPreview.dryRun,
    warnings: [
      "После подтверждения сообщение попадёт в outbox. Отозвать через CRM Assistant нельзя.",
      ...(hubPreview.dryRun
        ? ["Dry-run: реальной отправки провайдеру не будет."]
        : []),
    ],
    requiredConfirmationPhrase,
    rollbackAvailable: false,
    rollbackHint: "Откат невозможен после постановки в outbox.",
    note: hubPreview.note,
  };

  const execParams = {
    __execute: true,
    outboxDraft: prepared.outboxDraft,
    policy: prepared.policy,
    prepareId: prepared.prepareId,
    requiredConfirmationPhrase,
  };

  return {
    preview,
    before: { status: "prepared", prepareId: prepared.prepareId },
    after: { status: "enqueued", channel: hubPreview.channel },
    items: [
      {
        entityType: "communication_outbox",
        entityId: prepared.prepareId,
        before: { status: "prepared" },
        after: { status: "enqueued" },
      },
    ],
    entityIds: [String(prepared.prepareId)],
    affectedCount: 1,
    execPlan: {
      kind: "raw_handler",
      action: "communication_message_send_prepare",
      params: execParams,
    },
  };
}

async function planCommunicationCampaignStart(params, title, policy) {
  const repo = await import("../communications/communicationRepository.js");
  const { buildCampaignPreparePreview } = await import(
    "../communications/communicationSafety.js"
  );
  const campaign = repo.getCampaign(params.campaignId);
  if (!campaign) throw new Error("Кампания не найдена");
  if (!campaign.plan) throw new Error("Сначала выполните preview кампании");

  const hubPreview = buildCampaignPreparePreview(campaign, {
    planHash: campaign.planHash,
    allowedCount: campaign.confirmedRecipientCount,
    excludedCount: campaign.stats?.excluded || 0,
    channelBreakdown: campaign.plan.channelBreakdown,
    samples: campaign.plan.samples,
    exclusions: campaign.plan.exclusions,
  });

  const preview = {
    title: title || "Запуск кампании",
    risk: policy?.risk || "high",
    affectedCount: hubPreview.recipientCount,
    reversible: false,
    campaignId: campaign.id,
    name: campaign.name,
    planHash: hubPreview.planHash,
    recipientCount: hubPreview.recipientCount,
    excludedCount: hubPreview.excludedCount,
    channelBreakdown: hubPreview.channelBreakdown,
    sample: hubPreview.sample,
    exclusions: hubPreview.exclusions,
    dryRun: hubPreview.dryRun,
    requiredConfirmationPhrase: hubPreview.confirmationPhrase,
    warnings: [
      `Будет поставлено в outbox до ${hubPreview.recipientCount} сообщений.`,
      "Фраза подтверждения должна совпасть точно.",
    ],
    rollbackAvailable: false,
  };

  return {
    preview,
    before: { status: campaign.status, planHash: campaign.planHash },
    after: { status: "running", planHash: campaign.planHash },
    items: [
      {
        entityType: "communication_campaign",
        entityId: campaign.id,
        before: { status: campaign.status },
        after: { status: "running" },
      },
    ],
    entityIds: [campaign.id],
    affectedCount: hubPreview.recipientCount,
    execPlan: {
      kind: "raw_handler",
      action: "communication_campaign_start_prepare",
      params: {
        __execute: true,
        campaignId: campaign.id,
        planHash: campaign.planHash,
        confirmationPhrase: hubPreview.confirmationPhrase,
        requiredConfirmationPhrase: hubPreview.confirmationPhrase,
      },
    },
  };
}

function planCommunicationCampaignPause(params, title, policy) {
  const campaignId = params.campaignId;
  return {
    preview: {
      title: title || "Пауза кампании",
      risk: policy?.risk || "medium",
      affectedCount: 1,
      reversible: false,
      campaignId,
      kind: "communication_campaign_pause",
      warnings: ["Новые outbox-задачи кампании перестанут планироваться."],
      rollbackAvailable: false,
    },
    before: { status: "running" },
    after: { status: "paused" },
    items: [
      {
        entityType: "communication_campaign",
        entityId: String(campaignId),
        before: { status: "running" },
        after: { status: "paused" },
      },
    ],
    entityIds: [String(campaignId)],
    affectedCount: 1,
    execPlan: {
      kind: "raw_handler",
      action: "communication_campaign_pause_prepare",
      params: { __execute: true, campaignId },
    },
  };
}

function planCommunicationCampaignCancel(params, title, policy) {
  const campaignId = params.campaignId;
  return {
    preview: {
      title: title || "Отмена кампании",
      risk: policy?.risk || "medium",
      affectedCount: 1,
      reversible: false,
      campaignId,
      kind: "communication_campaign_cancel",
      warnings: ["Ожидающие outbox-задачи кампании будут отменены."],
      rollbackAvailable: false,
    },
    before: { status: "running_or_paused" },
    after: { status: "cancelled" },
    items: [
      {
        entityType: "communication_campaign",
        entityId: String(campaignId),
        before: {},
        after: { status: "cancelled" },
      },
    ],
    entityIds: [String(campaignId)],
    affectedCount: 1,
    execPlan: {
      kind: "raw_handler",
      action: "communication_campaign_cancel_prepare",
      params: { __execute: true, campaignId },
    },
  };
}

async function planCommunicationSequenceActivate(params, title, policy) {
  const repo = await import("../communications/communicationRepository.js");
  const sequence = repo.getSequence(params.sequenceId);
  if (!sequence) throw new Error("Цепочка не найдена");
  return {
    preview: {
      title: title || "Активация цепочки",
      risk: policy?.risk || "medium",
      affectedCount: 1,
      reversible: false,
      sequenceId: sequence.id,
      sequenceName: sequence.name,
      steps: (sequence.steps || []).length,
      kind: "communication_sequence_activate",
      rollbackAvailable: false,
    },
    before: { status: sequence.status },
    after: { status: "active" },
    items: [
      {
        entityType: "communication_sequence",
        entityId: sequence.id,
        before: { status: sequence.status },
        after: { status: "active" },
      },
    ],
    entityIds: [sequence.id],
    affectedCount: 1,
    execPlan: {
      kind: "raw_handler",
      action: "communication_sequence_activate_prepare",
      params: { __execute: true, sequenceId: sequence.id },
    },
  };
}

async function planCommunicationSequenceEnroll(params, title, policy) {
  const repo = await import("../communications/communicationRepository.js");
  const sequence = repo.getSequence(params.sequenceId);
  if (!sequence) throw new Error("Цепочка не найдена");
  if (!params.contactId) throw new Error("contactId обязателен");
  return {
    preview: {
      title: title || "Подключение к цепочке",
      risk: policy?.risk || "high",
      affectedCount: 1,
      reversible: false,
      sequenceId: sequence.id,
      sequenceName: sequence.name,
      contactId: params.contactId,
      steps: (sequence.steps || []).length,
      kind: "communication_sequence_enroll",
      warnings: ["Контакт будет получать шаги цепочки по расписанию (через outbox)."],
      rollbackAvailable: false,
    },
    before: { enrolled: false },
    after: { enrolled: true, contactId: params.contactId },
    items: [
      {
        entityType: "communication_enrollment",
        entityId: `${sequence.id}:${params.contactId}`,
        before: {},
        after: { contactId: params.contactId },
      },
    ],
    entityIds: [String(params.contactId)],
    affectedCount: 1,
    execPlan: {
      kind: "raw_handler",
      action: "communication_sequence_enroll_prepare",
      params: {
        __execute: true,
        sequenceId: sequence.id,
        contactId: params.contactId,
        vars: params.vars || {},
        address: params.address || {},
      },
    },
  };
}

function planCommunicationEnrollmentStop(params, title, policy) {
  const enrollmentId = params.enrollmentId;
  return {
    preview: {
      title: title || "Остановка enrollment",
      risk: policy?.risk || "medium",
      affectedCount: 1,
      reversible: false,
      enrollmentId,
      kind: "communication_enrollment_stop",
      rollbackAvailable: false,
    },
    before: { status: "active" },
    after: { status: "stopped_manually" },
    items: [
      {
        entityType: "communication_enrollment",
        entityId: String(enrollmentId),
        before: { status: "active" },
        after: { status: "stopped_manually" },
      },
    ],
    entityIds: [String(enrollmentId)],
    affectedCount: 1,
    execPlan: {
      kind: "raw_handler",
      action: "communication_enrollment_stop_prepare",
      params: {
        __execute: true,
        enrollmentId,
        reason: params.reason || "stopped_manually",
      },
    },
  };
}

function planClientMessageSend(params, title, policy) {
  const channel = String(params.channel || "").toLowerCase();
  const body = String(params.body || "");
  const recipient = params.recipient || {};
  const strong = ["whatsapp", "telegram", "email", "open_lines"].includes(channel);
  const name = String(recipient.name || "ПОЛУЧАТЕЛЮ")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  const requiredConfirmationPhrase = strong ? `ОТПРАВИТЬ СООБЩЕНИЕ ${name}` : null;
  const warnings = [
    "После отправки сообщение невозможно отозвать через CRM Assistant.",
    ...(params.forceDuplicateReason
      ? [`Повторная отправка с причиной: ${params.forceDuplicateReason}`]
      : []),
  ];
  if (channel === "bitrix_chat") {
    warnings.unshift("Канал: внутренний чат Bitrix24 (не сообщение клиенту).");
  }

  const preview = {
    title: title || "Отправка сообщения клиенту",
    risk: policy?.risk || "high",
    affectedCount: 1,
    reversible: false,
    channel: channel === "bitrix_chat" ? "Внутренний чат" : channel,
    provider: params.provider || null,
    entity: params.entityType
      ? { type: params.entityType, id: Number(params.entityId) }
      : null,
    recipient: {
      name: recipient.name || null,
      address: recipient.maskedAddress || null,
      contactId: recipient.contactId || null,
    },
    message: {
      subject: params.subject || null,
      body,
      length: body.length,
    },
    basedOnDraftId: params.draftId,
    bodyHash: params.bodyHash,
    warnings,
    requiredConfirmationPhrase,
    rollbackAvailable: false,
    rollbackHint: "Откат невозможен после отправки.",
  };

  const execParams = {
    draftId: params.draftId,
    channel: params.channel,
    provider: params.provider,
    entityType: params.entityType,
    entityId: params.entityId,
    contactId: params.contactId,
    bodyHash: params.bodyHash,
    subject: params.subject,
    body,
    recipient: {
      contactId: recipient.contactId,
      userId: recipient.userId,
      name: recipient.name,
      maskedAddress: recipient.maskedAddress,
      optionId: recipient.optionId,
      kind: recipient.kind,
    },
    affectedCount: 1,
    forceDuplicateReason: params.forceDuplicateReason || null,
    allowPersonal: Boolean(params.allowPersonal),
    personalCommunicationReason: params.personalCommunicationReason || null,
    requiredConfirmationPhrase,
  };

  return {
    preview,
    before: { draftId: params.draftId, bodyHash: params.bodyHash, status: "prepared" },
    after: {
      draftId: params.draftId,
      status: "sent",
      channel: params.channel,
      recipient: preview.recipient,
    },
    items: [
      {
        entityType: "message_draft",
        entityId: String(params.draftId),
        before: { status: "prepared" },
        after: { status: "sent" },
      },
    ],
    entityIds: [String(params.draftId)],
    affectedCount: 1,
    execPlan: { kind: "raw_handler", action: "client_message_send", params: execParams },
  };
}

async function planEntityUpdate(entityType, params, title) {
  if (!params.id) throw new Error("id is required");
  if (!params.fields || typeof params.fields !== "object") {
    throw new Error("fields is required");
  }

  const fields = { ...params.fields };
  const entity = await fetchCrmEntity(entityType, params.id);
  if (!entity) throw new Error(`${entityType} ${params.id} not found`);

  const fieldKeys = Object.keys(fields);
  const beforeFields = pickFields(entity, fieldKeys);
  const afterFields = {};
  for (const key of fieldKeys) {
    afterFields[key] = fields[key];
  }

  const changes = buildChanges(beforeFields, afterFields);
  const entityId = String(params.id);

  const preview = {
    title,
    entity: {
      type: entityType,
      id: Number(params.id),
      name: entityName(entity),
    },
    changes,
    affectedCount: 1,
    risk: getActionPolicy(`${entityType}_update`)?.risk || "medium",
    reversible: true,
    rollbackExpiresAt: rollbackExpiresAt(),
  };

  const before = {
    entityType,
    entityId,
    fields: beforeFields,
  };
  const after = {
    entityType,
    entityId,
    fields: afterFields,
  };

  return {
    preview,
    before,
    after,
    items: [
      {
        entityType,
        entityId,
        before: beforeFields,
        after: afterFields,
      },
    ],
    entityIds: [entityId],
    affectedCount: 1,
    execPlan: {
      kind: "entity_update",
      entityType,
      entityId,
      fields: afterFields,
    },
  };
}

async function planTaskUpdate(params, title) {
  const id = params.taskId ?? params.id;
  if (!id) throw new Error("taskId is required");
  const fields = { ...(params.fields || {}) };
  if (params.title) fields.TITLE = params.title;
  if (params.description !== undefined) fields.DESCRIPTION = params.description;
  if (params.responsibleId) fields.RESPONSIBLE_ID = params.responsibleId;
  if (params.deadline !== undefined) fields.DEADLINE = params.deadline;

  const task = await fetchTask(id);
  const fieldKeys = Object.keys(fields);
  const beforeFields = pickFields(task, fieldKeys);
  const afterFields = { ...fields };
  const changes = buildChanges(beforeFields, afterFields);

  return {
    preview: {
      title,
      entity: { type: "task", id: Number(id), name: entityName(task, `Задача #${id}`) },
      changes,
      affectedCount: 1,
      reversible: true,
      rollbackExpiresAt: rollbackExpiresAt(),
    },
    before: { entityType: "task", entityId: String(id), fields: beforeFields },
    after: { entityType: "task", entityId: String(id), fields: afterFields },
    items: [{ entityType: "task", entityId: String(id), before: beforeFields, after: afterFields }],
    entityIds: [String(id)],
    affectedCount: 1,
    execPlan: {
      kind: "task_update",
      entityType: "task",
      entityId: String(id),
      fields: afterFields,
    },
  };
}

async function planCreateDeal(params, title) {
  const { buildCreateDealPlan } = await import("../deals/dealCreateService.js");
  const built = await buildCreateDealPlan(params, {
    step: "prepare_write",
    confirmationState: "pending",
    safetyContext: true,
  });

  if (built.status === "ready") {
    return planCreate("deal", built.createParams, title);
  }

  if (built.status === "needs_input" || built.status === "ambiguous_assignee") {
    throw Object.assign(new Error(built.message || "Не хватает данных для создания сделки."), {
      code: built.code || "DEAL_CREATE_NOT_READY",
      details: built,
    });
  }

  if (built.status === "not_found" || built.status === "error") {
    throw Object.assign(new Error(built.message || "Не удалось подготовить сделку."), {
      code: built.code || "DEAL_CREATE_FAILED",
      details: built,
    });
  }

  throw Object.assign(new Error("Не удалось подготовить сделку."), {
    code: "DEAL_CREATE_UNKNOWN",
    details: built,
  });
}

function planCreate(entityType, params, title) {
  const fields = { ...(params.fields || {}) };
  if (entityType === "deal") {
    if (params.title) fields.TITLE = params.title;
    if (params.categoryId !== undefined) fields.CATEGORY_ID = params.categoryId;
    if (params.stageId != null && String(params.stageId).trim() !== "") {
      fields.STAGE_ID = String(params.stageId);
    }
    if (params.opportunity !== undefined) fields.OPPORTUNITY = params.opportunity;
    if (params.currencyId) fields.CURRENCY_ID = params.currencyId;
    if (params.assignedById !== undefined && params.assignedById !== null) {
      fields.ASSIGNED_BY_ID = params.assignedById;
    }
  }

  const safeFields = redactObject(fields);
  const changes = Object.entries(safeFields).map(([field, after]) => ({
    field,
    fieldName: label(field),
    before: null,
    after,
  }));

  return {
    preview: {
      title,
      entity: {
        type: entityType,
        id: null,
        name: fields.TITLE || fields.NAME || "Новая запись",
      },
      changes,
      affectedCount: 1,
      reversible: "conditional",
      rollbackExpiresAt: rollbackExpiresAt(),
    },
    before: { entityType, entityId: null, fields: {} },
    after: { entityType, entityId: null, fields: safeFields },
    items: [{ entityType, entityId: null, before: {}, after: safeFields }],
    entityIds: [],
    affectedCount: 1,
    execPlan: { kind: "entity_create", entityType, fields },
  };
}

function planCreateTask(params, title) {
  const fields = { ...(params.fields || {}) };
  if (params.title) fields.TITLE = params.title;
  if (params.description !== undefined) fields.DESCRIPTION = params.description;
  if (params.responsibleId) fields.RESPONSIBLE_ID = params.responsibleId;
  if (params.deadline !== undefined) fields.DEADLINE = params.deadline;

  const safeFields = redactObject(fields);
  return {
    preview: {
      title,
      entity: { type: "task", id: null, name: fields.TITLE || "Новая задача" },
      changes: Object.entries(safeFields).map(([field, after]) => ({
        field,
        fieldName: label(field),
        before: null,
        after,
      })),
      affectedCount: 1,
      reversible: "conditional",
      rollbackExpiresAt: rollbackExpiresAt(),
    },
    before: { entityType: "task", entityId: null, fields: {} },
    after: { entityType: "task", entityId: null, fields: safeFields },
    items: [{ entityType: "task", entityId: null, before: {}, after: safeFields }],
    entityIds: [],
    affectedCount: 1,
    execPlan: { kind: "task_create", entityType: "task", fields },
  };
}

function planActivityAdd(params, title) {
  const fields = redactObject(params.fields || params);
  return {
    preview: {
      title,
      entity: {
        type: "activity",
        id: null,
        name: fields.SUBJECT || fields.subject || "Новое CRM-дело",
      },
      changes: Object.entries(fields).map(([field, after]) => ({
        field,
        fieldName: label(field),
        before: null,
        after,
      })),
      affectedCount: 1,
      reversible: false,
    },
    before: { entityType: "activity", fields: {} },
    after: { entityType: "activity", fields },
    items: [{ entityType: "activity", entityId: null, before: {}, after: fields }],
    entityIds: [],
    affectedCount: 1,
    execPlan: { kind: "raw_handler", action: "activity_add", params },
  };
}

function planTimelineComment(params, title) {
  const safe = redactObject({
    entityType: params.entityType,
    entityId: params.entityId,
    comment: params.comment,
  });
  return {
    preview: {
      title,
      entity: {
        type: String(params.entityType || "crm"),
        id: Number(params.entityId) || null,
        name: `Комментарий к ${params.entityType} #${params.entityId}`,
      },
      changes: [
        {
          field: "COMMENT",
          fieldName: "Комментарий",
          before: null,
          after: safe.comment,
        },
      ],
      affectedCount: 1,
      reversible: false,
    },
    before: { entityType: "timeline", fields: {} },
    after: { entityType: "timeline", fields: safe },
    items: [
      {
        entityType: String(params.entityType || "crm"),
        entityId: String(params.entityId || ""),
        before: {},
        after: safe,
      },
    ],
    entityIds: params.entityId != null ? [String(params.entityId)] : [],
    affectedCount: 1,
    execPlan: { kind: "raw_handler", action: "timeline_comment_add", params },
  };
}

async function planActivityUpdate(action, params, title) {
  const id = params.id;
  if (!id) throw new Error("id is required");
  let current;
  try {
    current = await callReadMethod("crm.activity.get", { id: Number(id) });
    current = unwrapItem(current);
  } catch {
    current = { ID: id };
  }
  const fields = { ...(params.fields || {}) };
  if (action === "activity_complete") fields.COMPLETED = "Y";
  const beforeFields = pickFields(current, Object.keys(fields).length ? Object.keys(fields) : ["COMPLETED"]);
  const afterFields = Object.keys(fields).length ? fields : { COMPLETED: "Y" };

  return {
    preview: {
      title,
      entity: {
        type: "activity",
        id: Number(id),
        name: entityName(current, `Дело #${id}`),
      },
      changes: buildChanges(beforeFields, afterFields),
      affectedCount: 1,
      reversible: "conditional",
      rollbackExpiresAt: rollbackExpiresAt(),
    },
    before: { entityType: "activity", entityId: String(id), fields: beforeFields },
    after: { entityType: "activity", entityId: String(id), fields: afterFields },
    items: [
      {
        entityType: "activity",
        entityId: String(id),
        before: beforeFields,
        after: afterFields,
      },
    ],
    entityIds: [String(id)],
    affectedCount: 1,
    execPlan: { kind: "raw_handler", action, params },
  };
}

async function planDelete(action, params, title) {
  const id = params.id ?? params.taskId;
  if (!id) throw new Error("id is required");

  let entityType = "entity";
  let entity = null;
  if (action === "deal_delete") {
    entityType = "deal";
    entity = await fetchCrmEntity("deal", id);
  } else if (action === "lead_delete") {
    entityType = "lead";
    entity = await fetchCrmEntity("lead", id);
  } else if (action === "delete_task") {
    entityType = "task";
    entity = await fetchTask(id);
  } else {
    entityType = "activity";
  }

  return {
    preview: {
      title,
      entity: {
        type: entityType,
        id: Number(id),
        name: entity ? entityName(entity, `#${id}`) : `#${id}`,
      },
      changes: [
        {
          field: "_delete",
          fieldName: "Удаление",
          before: "существует",
          after: "будет удалено",
        },
      ],
      affectedCount: 1,
      reversible: false,
      warning: "Удаление необратимо в рамках safety layer.",
    },
    before: {
      entityType,
      entityId: String(id),
      fields: entity ? pickFields(entity, ["TITLE", "STAGE_ID", "STATUS_ID", "ASSIGNED_BY_ID"]) : { id },
    },
    after: { entityType, entityId: String(id), deleted: true },
    items: [
      {
        entityType,
        entityId: String(id),
        before: entity ? pickFields(entity, ["TITLE", "ID"]) : { id },
        after: { deleted: true },
      },
    ],
    entityIds: [String(id)],
    affectedCount: 1,
    execPlan: {
      kind: "raw_handler",
      action,
      params: { ...params, confirm: true },
      entityType,
      entityId: String(id),
      expectDeleted: true,
    },
  };
}

function planGeneric(action, params, title, policy) {
  const safeParams = redactObject(params || {});
  return {
    preview: {
      title,
      entity: null,
      changes: [
        {
          field: "params",
          fieldName: "Параметры",
          before: null,
          after: safeParams,
        },
      ],
      affectedCount: 1,
      reversible: policy?.reversible ?? false,
      risk: policy?.risk || "medium",
    },
    before: { params: {} },
    after: { params: safeParams },
    items: [{ entityType: "generic", entityId: null, before: {}, after: safeParams }],
    entityIds: params?.id != null ? [String(params.id)] : [],
    affectedCount: 1,
    execPlan: { kind: "raw_handler", action, params },
  };
}

/**
 * Сравнить текущее состояние с before (optimistic locking).
 */
export async function reloadAndCompare(execPlan, before) {
  if (!execPlan) return { ok: true, conflictingFields: [] };

  if (execPlan.kind === "entity_update") {
    const current = await fetchCrmEntity(execPlan.entityType, execPlan.entityId);
    const conflictingFields = [];
    for (const field of Object.keys(before.fields || {})) {
      const expected = before.fields[field];
      const actual = getField(current, field);
      if (JSON.stringify(expected ?? null) !== JSON.stringify(actual ?? null)) {
        conflictingFields.push(field);
      }
    }
    return { ok: conflictingFields.length === 0, conflictingFields, current };
  }

  if (execPlan.kind === "task_update") {
    const current = await fetchTask(execPlan.entityId);
    const conflictingFields = [];
    for (const field of Object.keys(before.fields || {})) {
      const expected = before.fields[field];
      const actual = getField(current, field);
      if (JSON.stringify(expected ?? null) !== JSON.stringify(actual ?? null)) {
        conflictingFields.push(field);
      }
    }
    return { ok: conflictingFields.length === 0, conflictingFields, current };
  }

  return { ok: true, conflictingFields: [] };
}

export { fetchCrmEntity, fetchTask, getField, entityName, label };
