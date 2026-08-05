import { callBitrixMethod, callBitrixMethodFull } from "../bitrixClient.js";
import {
  mapTimelineEntityType,
  requireDestructiveConfirm,
  PAGINATION,
  applyListLimit,
  fetchAllPages,
  fetchAllPagesCapped,
  normalizeListResult,
  getAnalyticsMaxPages,
  normalizePositiveInt,
  normalizeNonNegativeInt,
  resolveEntityTypeId,
} from "./helpers.js";

/** Нормализация параметров crm.timeline.comment.list. */
export function normalizeTimelineCommentParams(params = {}) {
  const { entityType, entityId, filter = {}, order = {}, select = [], start = 0 } = params;

  let entityTypeValue;
  let entityIdValue;

  if (entityType != null || entityId != null) {
    if (entityType == null) throw new Error("entityType обязателен");
    if (entityId == null) throw new Error("entityId обязателен");
    const mapped = mapTimelineEntityType(entityType);
    entityTypeValue = mapped.entityType;
    entityIdValue = normalizePositiveInt(entityId, "ENTITY_ID");
  } else {
    if (!filter.ENTITY_TYPE) throw new Error("filter.ENTITY_TYPE обязателен");
    if (filter.ENTITY_ID == null) throw new Error("filter.ENTITY_ID обязателен");
    const mapped = mapTimelineEntityType(filter.ENTITY_TYPE);
    entityTypeValue = mapped.entityType;
    entityIdValue = normalizePositiveInt(filter.ENTITY_ID, "ENTITY_ID");
  }

  return {
    filter: {
      ...filter,
      ENTITY_TYPE: entityTypeValue,
      ENTITY_ID: entityIdValue,
    },
    order,
    select: Array.isArray(select) ? select : [],
    start: normalizeNonNegativeInt(start, "start"),
  };
}

/** Нормализация параметров crm.stagehistory.list. */
export function normalizeStageHistoryParams(params = {}) {
  const {
    entityTypeId: rawEntityTypeId,
    entityType,
    entityId,
    filter = {},
    order = {},
    select = [],
    start = 0,
  } = params;

  let entityTypeId = rawEntityTypeId;
  if (entityTypeId == null && entityType != null) {
    entityTypeId = resolveEntityTypeId(entityType);
  }
  if (entityTypeId == null) {
    throw new Error("entityTypeId обязателен (или укажите entityType)");
  }
  entityTypeId = normalizePositiveInt(entityTypeId, "entityTypeId");

  const ownerId = filter.OWNER_ID ?? entityId;
  if (ownerId == null) {
    throw new Error("filter.OWNER_ID обязателен (или укажите entityId)");
  }

  return {
    entityTypeId,
    filter: {
      ...filter,
      OWNER_ID: normalizePositiveInt(ownerId, "OWNER_ID"),
    },
    order,
    select: Array.isArray(select) ? select : [],
    start: normalizeNonNegativeInt(start, "start"),
  };
}

async function fetchTimelineCommentPage(normalized) {
  const requestParams = {
    filter: normalized.filter,
    order: normalized.order,
    start: normalized.start,
  };
  if (normalized.select.length) requestParams.select = normalized.select;

  try {
    const { result, next, total } = await callBitrixMethodFull(
      "crm.timeline.comment.list",
      requestParams
    );
    return normalizeListResult(result, { next, total });
  } catch (primaryError) {
    const mapped = mapTimelineEntityType(normalized.filter.ENTITY_TYPE);
    const { result, next, total } = await callBitrixMethodFull("crm.timeline.comment.list", {
      filter: {
        OWNER_ID: normalized.filter.ENTITY_ID,
        OWNER_TYPE: mapped.ownerType,
      },
      order: normalized.order,
      start: normalized.start,
      ...(normalized.select.length ? { select: normalized.select } : {}),
    });
    return normalizeListResult(result, { next, total });
  }
}

async function fetchStageHistoryPage(normalized) {
  const requestParams = {
    entityTypeId: normalized.entityTypeId,
    filter: normalized.filter,
    order: normalized.order,
    start: normalized.start,
  };
  if (normalized.select.length) requestParams.select = normalized.select;

  const { result, next, total } = await callBitrixMethodFull(
    "crm.stagehistory.list",
    requestParams
  );
  return normalizeListResult(result, { next, total });
}

/** Добавить комментарий в таймлайн CRM-сущности. */
export async function timeline_comment_add(params = {}) {
  const { entityType, entityId, comment } = params;
  if (!entityType) throw new Error("entityType is required");
  if (!entityId) throw new Error("entityId is required");
  if (!comment) throw new Error("comment is required");

  const mapped = mapTimelineEntityType(entityType);

  const primaryPayload = {
    fields: {
      ENTITY_ID: Number(entityId),
      ENTITY_TYPE: mapped.entityType,
      COMMENT: comment,
    },
  };

  try {
    return await callBitrixMethod("crm.timeline.comment.add", primaryPayload);
  } catch (primaryError) {
    console.warn("timeline_comment_add primary format failed:", primaryError.message);

    const fallbackPayload = {
      fields: {
        OWNER_ID: Number(entityId),
        OWNER_TYPE: mapped.ownerType,
        COMMENT: comment,
      },
    };

    try {
      return await callBitrixMethod("crm.timeline.comment.add", fallbackPayload);
    } catch (fallbackError) {
      throw new Error(
        `Не удалось добавить комментарий. Проверьте права CRM у вебхука. ` +
          `Primary: ${primaryError.message}. Fallback: ${fallbackError.message}`
      );
    }
  }
}

/** Список комментариев таймлайна CRM-элемента (crm.timeline.comment.list). */
export async function timeline_comment_list(params = {}) {
  const normalized = normalizeTimelineCommentParams(params);
  const limit = params.limit ?? PAGINATION.DEFAULT_LIST_LIMIT;
  const { limit: _limit, allPages, ...rest } = params;

  if (allPages === true) {
    return timelineCommentListAll(rest);
  }

  const page = await fetchTimelineCommentPage(normalized);
  return applyListLimit(page, limit);
}

/** Полная выборка комментариев таймлайна с безопасными лимитами. */
export async function timelineCommentListAll(params = {}, options = {}) {
  const normalized = normalizeTimelineCommentParams(params);
  return fetchAllPagesCapped({
    actionName: options.actionName || "timeline_comment_list_all",
    maxPages: options.maxPages ?? PAGINATION.READ_LIST_MAX_PAGES,
    maxItems: options.maxItems ?? PAGINATION.READ_LIST_MAX_ITEMS,
    fetchPage: (start) => fetchTimelineCommentPage({ ...normalized, start }),
  });
}

/** История перемещения CRM-элемента по стадиям (crm.stagehistory.list). */
export async function stagehistory_list(params = {}) {
  const normalized = normalizeStageHistoryParams(params);
  const limit = params.limit ?? PAGINATION.DEFAULT_LIST_LIMIT;
  const { limit: _limit, allPages, ...rest } = params;

  if (allPages === true) {
    return stagehistoryListAll(rest);
  }

  const page = await fetchStageHistoryPage(normalized);
  return applyListLimit(page, limit);
}

/** Полная выборка истории стадий с безопасными лимитами. */
export async function stagehistoryListAll(params = {}, options = {}) {
  const normalized = normalizeStageHistoryParams(params);
  return fetchAllPagesCapped({
    actionName: options.actionName || "stagehistory_list_all",
    maxPages: options.maxPages ?? PAGINATION.READ_LIST_MAX_PAGES,
    maxItems: options.maxItems ?? PAGINATION.READ_LIST_MAX_ITEMS,
    fetchPage: (start) => fetchStageHistoryPage({ ...normalized, start }),
  });
}

/** История активности: комментарии + дела. */
export async function timeline_list(params = {}) {
  const { entityType, entityId } = params;
  if (!entityType) throw new Error("entityType is required");
  if (!entityId) throw new Error("entityId is required");

  const mapped = mapTimelineEntityType(entityType);
  const ownerTypeIdMap = { LEAD: 1, DEAL: 2, CONTACT: 3, COMPANY: 4 };

  let comments = [];
  let activities = [];

  try {
    const commentResult = await timeline_comment_list({ entityType, entityId });
    comments = Array.isArray(commentResult)
      ? commentResult
      : commentResult?.items || commentResult?.comments || [];
  } catch (error) {
    console.warn("timeline_list comments failed:", error.message);
  }

  try {
    activities = await callBitrixMethod("crm.activity.list", {
      filter: {
        OWNER_ID: Number(entityId),
        OWNER_TYPE_ID: ownerTypeIdMap[mapped.ownerType],
      },
    });
    if (!Array.isArray(activities)) activities = [];
  } catch (error) {
    console.warn("timeline_list activities failed:", error.message);
  }

  return { comments, activities };
}

/** Список дел CRM (безопасный лимит по умолчанию). */
export async function activity_list(params = {}) {
  const {
    filter = {},
    select = [],
    order = {},
    start = 0,
    limit = PAGINATION.DEFAULT_LIST_LIMIT,
  } = params;

  const requestParams = { filter, order, start };
  if (select?.length) requestParams.select = select;

  const { result, next, total } = await callBitrixMethodFull(
    "crm.activity.list",
    requestParams
  );
  const page = normalizeListResult(result, { next, total });
  return applyListLimit(page, limit);
}

/** Полная выборка дел для аналитики. */
export async function activityListAll(params = {}, options = {}) {
  const { filter = {}, select = [], order = {} } = params;
  return fetchAllPages({
    actionName: options.actionName || "activity_list_all",
    maxPages: options.maxPages ?? getAnalyticsMaxPages(),
    fetchPage: async (start) => {
      const requestParams = { filter, order, start };
      if (select?.length) requestParams.select = select;
      const { result, next, total } = await callBitrixMethodFull(
        "crm.activity.list",
        requestParams
      );
      return normalizeListResult(result, { next, total });
    },
  });
}

const ACTIVITY_FIELD_ALIASES = {
  OWNETYPEID: "OWNER_TYPE_ID",
  OWNERTYPEID: "OWNER_TYPE_ID",
  OWNER_TYPE: "OWNER_TYPE_ID",
  OWNERTYPE: "OWNER_TYPE_ID",
  ownerTypeId: "OWNER_TYPE_ID",
  owner_type_id: "OWNER_TYPE_ID",
  OWNERID: "OWNER_ID",
  ownerId: "OWNER_ID",
  owner_id: "OWNER_ID",
  RESPONSIBLEID: "RESPONSIBLE_ID",
  responsibleId: "RESPONSIBLE_ID",
  responsible_id: "RESPONSIBLE_ID",
  ASSIGNED_BY_ID: "RESPONSIBLE_ID",
  assignedById: "RESPONSIBLE_ID",
  TYPEID: "TYPE_ID",
  typeId: "TYPE_ID",
  type_id: "TYPE_ID",
  SUBJECT: "SUBJECT",
  subject: "SUBJECT",
  title: "SUBJECT",
  TITLE: "SUBJECT",
  DESCRIPTION: "DESCRIPTION",
  description: "DESCRIPTION",
  DEADLINE: "DEADLINE",
  deadline: "DEADLINE",
  END_TIME: "END_TIME",
  endTime: "END_TIME",
  START_TIME: "START_TIME",
  startTime: "START_TIME",
  COMPLETED: "COMPLETED",
  completed: "COMPLETED",
  COMMUNICATIONS: "COMMUNICATIONS",
  communications: "COMMUNICATIONS",
};

/** Крайний срок по умолчанию (todo.add требует deadline). */
export function defaultActivityDeadline(base = new Date()) {
  const d = new Date(base);
  d.setHours(23, 59, 0, 0);
  if (d.getTime() <= Date.now()) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString();
}

function pickActivityRawFields(params = {}) {
  if (params.fields && typeof params.fields === "object" && !Array.isArray(params.fields)) {
    return { ...params.fields };
  }
  const raw = { ...params };
  delete raw.confirm;
  delete raw.fields;
  return raw;
}

/**
 * Нормализация params для activity_add.
 * Принимает { fields }, плоские CRM-поля или camelCase todo-параметры.
 */
export function normalizeActivityAddParams(params = {}) {
  const raw = pickActivityRawFields(params);
  const fields = {};

  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    const canonical = ACTIVITY_FIELD_ALIASES[key] || ACTIVITY_FIELD_ALIASES[String(key).toUpperCase()] || key;
    if (fields[canonical] === undefined) fields[canonical] = value;
  }

  if (fields.OWNER_TYPE_ID != null) fields.OWNER_TYPE_ID = Number(fields.OWNER_TYPE_ID);
  if (fields.OWNER_ID != null) fields.OWNER_ID = Number(fields.OWNER_ID);
  if (fields.RESPONSIBLE_ID != null) fields.RESPONSIBLE_ID = Number(fields.RESPONSIBLE_ID);
  if (fields.TYPE_ID != null) fields.TYPE_ID = Number(fields.TYPE_ID);

  if (!fields.OWNER_TYPE_ID || !fields.OWNER_ID) {
    throw new Error("Для создания CRM-дела нужны OWNER_TYPE_ID и OWNER_ID (сделка=2, лид=1, контакт=3).");
  }
  if (!fields.SUBJECT && !fields.DESCRIPTION) {
    throw new Error("Укажите тему дела (SUBJECT) или описание.");
  }
  if (!fields.SUBJECT) fields.SUBJECT = String(fields.DESCRIPTION).slice(0, 120);

  const typeId = Number(fields.TYPE_ID) || null;
  const hasCommunications =
    Array.isArray(fields.COMMUNICATIONS) && fields.COMMUNICATIONS.length > 0;
  // Звонок/письмо — классический crm.activity.add; остальное — универсальное todo.
  const useTodo = !hasCommunications && typeId !== 2 && typeId !== 4;

  return { fields, useTodo };
}

function buildTodoAddPayload(fields) {
  const deadline =
    fields.DEADLINE || fields.END_TIME || fields.START_TIME || defaultActivityDeadline();
  const payload = {
    ownerTypeId: Number(fields.OWNER_TYPE_ID),
    ownerId: Number(fields.OWNER_ID),
    deadline,
    title: String(fields.SUBJECT || ""),
    description: String(fields.DESCRIPTION || ""),
  };
  if (fields.RESPONSIBLE_ID) payload.responsibleId = Number(fields.RESPONSIBLE_ID);
  return payload;
}

function buildClassicActivityFields(fields) {
  const out = { ...fields };
  if (!Array.isArray(out.COMMUNICATIONS) || !out.COMMUNICATIONS.length) {
    out.COMMUNICATIONS = [
      {
        VALUE: "",
        ENTITY_ID: Number(out.OWNER_ID),
        ENTITY_TYPE_ID: Number(out.OWNER_TYPE_ID),
      },
    ];
  }
  if (!out.TYPE_ID) out.TYPE_ID = 1;
  if (!out.RESPONSIBLE_ID) {
    throw new Error("RESPONSIBLE_ID обязателен для crm.activity.add.");
  }
  // DEADLINE напрямую не пишется — переносим в START/END.
  if (out.DEADLINE && !out.START_TIME && !out.END_TIME) {
    out.START_TIME = out.DEADLINE;
    out.END_TIME = out.DEADLINE;
  }
  delete out.DEADLINE;
  return out;
}

/** Создать дело CRM (todo.add или классический activity.add). */
export async function activity_add(params = {}) {
  const { fields, useTodo } = normalizeActivityAddParams(params);

  if (useTodo) {
    try {
      return await callBitrixMethod("crm.activity.todo.add", buildTodoAddPayload(fields));
    } catch (todoError) {
      // Старые порталы без todo.add — fallback на классический метод.
      console.warn("crm.activity.todo.add failed, fallback to crm.activity.add:", todoError.message);
      const classic = buildClassicActivityFields(fields);
      return callBitrixMethod("crm.activity.add", { fields: classic });
    }
  }

  const classic = buildClassicActivityFields(fields);
  return callBitrixMethod("crm.activity.add", { fields: classic });
}

/** Обновить дело CRM. */
export async function activity_update(params = {}) {
  if (!params.id) throw new Error("id is required");
  if (!params.fields) throw new Error("fields is required");
  return callBitrixMethod("crm.activity.update", {
    id: Number(params.id),
    fields: params.fields,
  });
}

/** Удалить дело CRM (требует confirm: true). */
export async function activity_delete(params = {}) {
  requireDestructiveConfirm(params);
  if (!params.id) throw new Error("id is required");
  return callBitrixMethod("crm.activity.delete", { id: Number(params.id) });
}

/** Закрыть дело как выполненное. */
export async function activity_complete(params = {}) {
  if (!params.id) throw new Error("id is required");

  try {
    return await callBitrixMethod("crm.activity.update", {
      id: Number(params.id),
      fields: { COMPLETED: "Y", STATUS: 2 },
    });
  } catch (error) {
    try {
      return await callBitrixMethod("crm.activity.update", {
        id: Number(params.id),
        fields: { COMPLETED: "Y" },
      });
    } catch (fallbackError) {
      throw new Error(
        `Не удалось закрыть дело. Проверьте формат полей COMPLETED/STATUS в вашем портале. ` +
          `${error.message}; ${fallbackError.message}`
      );
    }
  }
}
