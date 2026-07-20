import { callBitrixMethod } from "../bitrixClient.js";
import {
  ENTITY_TYPE,
  PAGINATION,
  crmItemList,
  crmItemListAll,
  crmItemGet,
  crmItemUpdate,
  crmItemDelete,
  crmItemFields,
  requireDestructiveConfirm,
  notImplementedAction,
  applyListLimit,
} from "./helpers.js";

/** Список сделок с фильтрами (безопасный лимит по умолчанию). */
export async function deal_list(params = {}) {
  const limit = params.limit ?? PAGINATION.DEFAULT_LIST_LIMIT;
  const { limit: _limit, allPages, ...rest } = params;

  if (allPages === true) {
    return crmItemListAll(ENTITY_TYPE.DEAL, rest, "crm.deal.list", {
      actionName: "deal_list_all",
    });
  }

  const page = await crmItemList(ENTITY_TYPE.DEAL, rest, "crm.deal.list");
  return applyListLimit(page, limit);
}

/** Внутренняя полная выборка для аналитики. */
export async function dealListAll(params = {}, options = {}) {
  return crmItemListAll(ENTITY_TYPE.DEAL, params, "crm.deal.list", {
    actionName: options.actionName || "deal_list_all",
    maxPages: options.maxPages,
  });
}

/** Получить сделку по ID. */
export async function deal_get(params = {}) {
  if (!params.id) throw new Error("id is required");
  return crmItemGet(ENTITY_TYPE.DEAL, params.id, "crm.deal.get");
}

/** Подсчёт сделок по фильтру. */
export async function deal_count(params = {}) {
  const { items, total } = await deal_list({
    ...params,
    select: ["ID"],
    limit: 1,
  });
  return { count: total ?? items.length, total: total ?? items.length };
}

/** Обновить сделку. */
export async function deal_update(params = {}) {
  if (!params.id) throw new Error("id is required");
  if (!params.fields) throw new Error("fields is required");
  return crmItemUpdate(ENTITY_TYPE.DEAL, params.id, params.fields, "crm.deal.update");
}

/** Удалить сделку (требует confirm: true). */
export async function deal_delete(params = {}) {
  requireDestructiveConfirm(params);
  if (!params.id) throw new Error("id is required");
  return crmItemDelete(ENTITY_TYPE.DEAL, params.id, "crm.deal.delete");
}

/** Поля сделки. */
export async function deal_fields() {
  return crmItemFields(ENTITY_TYPE.DEAL, "crm.deal.fields");
}

/** Товарные позиции сделки. */
export async function deal_product_rows_get(params = {}) {
  if (!params.id) throw new Error("id is required");
  return callBitrixMethod("crm.deal.productrows.get", { id: Number(params.id) });
}

/** Установить товарные позиции сделки. */
export async function deal_product_rows_set(params = {}) {
  if (!params.id) throw new Error("id is required");
  if (!params.rows) throw new Error("rows is required");
  return callBitrixMethod("crm.deal.productrows.set", {
    id: Number(params.id),
    rows: params.rows,
  });
}

export const deal_bulk_update = notImplementedAction("deal_bulk_update");
