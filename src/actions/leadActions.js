import { callBitrixMethod } from "../bitrixClient.js";
import {
  ENTITY_TYPE,
  PAGINATION,
  crmItemList,
  crmItemListAll,
  crmItemGet,
  crmItemUpdate,
  crmItemAdd,
  crmItemDelete,
  crmItemFields,
  findByName,
  requireDestructiveConfirm,
  notImplementedAction,
  applyListLimit,
} from "./helpers.js";

/** Получить стадии лидов; опционально найти по названию. */
export async function lead_stage_list(params = {}) {
  const stages = await callBitrixMethod("crm.status.list", {
    filter: { ENTITY_ID: "STATUS" },
  });

  const list = Array.isArray(stages) ? stages : [];

  if (params.name) {
    const found = findByName(list, params.name);
    return found || { message: `Stage "${params.name}" not found`, stages: list };
  }

  return list;
}

/** Список лидов с фильтрами (безопасный лимит по умолчанию). */
export async function lead_list(params = {}) {
  const limit = params.limit ?? PAGINATION.DEFAULT_LIST_LIMIT;
  const { limit: _limit, allPages, ...rest } = params;

  if (allPages === true) {
    return crmItemListAll(ENTITY_TYPE.LEAD, rest, "crm.lead.list", {
      actionName: "lead_list_all",
    });
  }

  const page = await crmItemList(ENTITY_TYPE.LEAD, rest, "crm.lead.list");
  return applyListLimit(page, limit);
}

/** Внутренняя полная выборка для аналитики. */
export async function leadListAll(params = {}, options = {}) {
  return crmItemListAll(ENTITY_TYPE.LEAD, params, "crm.lead.list", {
    actionName: options.actionName || "lead_list_all",
    maxPages: options.maxPages,
  });
}

/** Получить лид по ID. */
export async function lead_get(params = {}) {
  if (!params.id) throw new Error("id is required");
  return crmItemGet(ENTITY_TYPE.LEAD, params.id, "crm.lead.get");
}

/** Подсчёт лидов по фильтру. */
export async function lead_count(params = {}) {
  const { items, total } = await lead_list({
    ...params,
    select: ["ID"],
    limit: 1,
  });
  return { count: total ?? items.length, total: total ?? items.length };
}

/** Обновить лид. */
export async function lead_update(params = {}) {
  if (!params.id) throw new Error("id is required");
  if (!params.fields) throw new Error("fields is required");
  return crmItemUpdate(ENTITY_TYPE.LEAD, params.id, params.fields, "crm.lead.update");
}

/** Создать лид. */
export async function lead_create(params = {}) {
  if (!params.fields) throw new Error("fields is required");
  return crmItemAdd(ENTITY_TYPE.LEAD, params.fields, "crm.lead.add");
}

/** Удалить лид (требует confirm: true). */
export async function lead_delete(params = {}) {
  requireDestructiveConfirm(params);
  if (!params.id) throw new Error("id is required");
  return crmItemDelete(ENTITY_TYPE.LEAD, params.id, "crm.lead.delete");
}

/** Поля лида. */
export async function lead_fields() {
  return crmItemFields(ENTITY_TYPE.LEAD, "crm.lead.fields");
}

/** Товарные позиции лида. */
export async function lead_product_rows_get(params = {}) {
  if (!params.id) throw new Error("id is required");
  return callBitrixMethod("crm.lead.productrows.get", { id: Number(params.id) });
}

/** Установить товарные позиции лида. */
export async function lead_product_rows_set(params = {}) {
  if (!params.id) throw new Error("id is required");
  if (!params.rows) throw new Error("rows is required");
  return callBitrixMethod("crm.lead.productrows.set", {
    id: Number(params.id),
    rows: params.rows,
  });
}

export const lead_bulk_update = notImplementedAction("lead_bulk_update");
