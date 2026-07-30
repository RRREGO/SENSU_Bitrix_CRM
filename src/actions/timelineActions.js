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

/** Создать дело CRM. */
export async function activity_add(params = {}) {
  if (!params.fields) throw new Error("fields is required");
  return callBitrixMethod("crm.activity.add", { fields: params.fields });
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
