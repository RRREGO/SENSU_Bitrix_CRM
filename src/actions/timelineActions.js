import { callBitrixMethod, callBitrixMethodFull } from "../bitrixClient.js";
import {
  mapTimelineEntityType,
  requireDestructiveConfirm,
  PAGINATION,
  applyListLimit,
  fetchAllPages,
  normalizeListResult,
  getAnalyticsMaxPages,
} from "./helpers.js";

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

/** Список комментариев таймлайна. */
export async function timeline_comment_list(params = {}) {
  const { entityType, entityId } = params;
  if (!entityType) throw new Error("entityType is required");
  if (!entityId) throw new Error("entityId is required");

  const mapped = mapTimelineEntityType(entityType);

  try {
    return await callBitrixMethod("crm.timeline.comment.list", {
      filter: {
        ENTITY_ID: Number(entityId),
        ENTITY_TYPE: mapped.entityType,
      },
    });
  } catch (error) {
    return callBitrixMethod("crm.timeline.comment.list", {
      filter: {
        OWNER_ID: Number(entityId),
        OWNER_TYPE: mapped.ownerType,
      },
    });
  }
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
    comments = await timeline_comment_list({ entityType, entityId });
    if (!Array.isArray(comments)) comments = comments?.comments || [];
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
