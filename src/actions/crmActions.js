import { callBitrixMethod } from "../bitrixClient.js";
import { buildDealCreateFields } from "../deals/dealCreateFields.js";
import { logBeforeBitrixDealAdd } from "../deals/dealCreateLog.js";
import {
  ENTITY_TYPE,
  PAGINATION,
  crmItemList,
  crmItemListAll,
  crmItemGet,
  crmItemAdd,
  crmItemUpdate,
  findByName,
  getDealStageEntityId,
  hasPresentValue,
  isNil,
  requireDestructiveConfirm,
  notImplementedAction,
  applyListLimit,
} from "./helpers.js";
import { deal_list, deal_update } from "./dealActions.js";

// --- Воронки и стадии сделок ---

/** Список воронок сделок или поиск по названию. */
export async function deal_category_list(params = {}) {
  const categories = await callBitrixMethod("crm.category.list", {
    entityTypeId: ENTITY_TYPE.DEAL,
  });

  const list = categories?.categories || categories || [];
  const items = Array.isArray(list) ? list : [];

  if (params.name) {
    const found = findByName(items, params.name, ["name", "NAME"]);
    return found || { message: `Category "${params.name}" not found`, categories: items };
  }

  return items;
}

/** Список стадий сделок в воронке. */
export async function deal_stage_list(params = {}) {
  const categoryId = params.categoryId ?? 0;
  const entityId = getDealStageEntityId(categoryId);

  const stages = await callBitrixMethod("crm.status.list", {
    filter: { ENTITY_ID: entityId },
  });

  const list = Array.isArray(stages) ? stages : [];

  if (params.name) {
    const found = findByName(list, params.name);
    return found || { message: `Stage "${params.name}" not found`, stages: list };
  }

  return list;
}

/** Создать новую сделку. */
export async function create_deal(params = {}) {
  const categoryId = !isNil(params.categoryId)
    ? Number(params.categoryId)
    : !isNil(params.fields?.CATEGORY_ID)
      ? Number(params.fields.CATEGORY_ID)
      : undefined;
  const stageId = hasPresentValue(params.stageId)
    ? params.stageId
    : hasPresentValue(params.fields?.STAGE_ID)
      ? params.fields.STAGE_ID
      : undefined;
  const assignedById = !isNil(params.assignedById)
    ? Number(params.assignedById)
    : !isNil(params.fields?.ASSIGNED_BY_ID)
      ? Number(params.fields.ASSIGNED_BY_ID)
      : undefined;

  const fields = buildDealCreateFields(params, { categoryId, stageId, assignedById });

  if (!fields.TITLE) throw new Error("title or fields.TITLE is required");

  logBeforeBitrixDealAdd(params.actionId || params.__actionId || "create_deal", fields);

  try {
    return await callBitrixMethod("crm.item.add", {
      entityTypeId: ENTITY_TYPE.DEAL,
      fields,
    });
  } catch (error) {
    console.warn("crm.item.add fallback to crm.deal.add:", error.message);
    return callBitrixMethod("crm.deal.add", { fields });
  }
}

/** Создать воронку со стандартными стадиями. */
export async function create_default_funnel(params = {}) {
  if (!params.name) throw new Error("name is required");
  return callBitrixMethod("crm.category.add", {
    entityTypeId: ENTITY_TYPE.DEAL,
    fields: { name: params.name },
  });
}

/** Создать воронку с кастомными стадиями. */
export async function create_funnel_with_custom_stages(params = {}) {
  if (!params.name) throw new Error("name is required");
  if (!params.stages?.length) throw new Error("stages array is required");

  const category = await create_default_funnel({ name: params.name });
  const categoryId = category?.id ?? category?.ID ?? category;

  const createdStages = [];
  const entityId = getDealStageEntityId(categoryId);

  for (const stage of params.stages) {
    try {
      const result = await callBitrixMethod("crm.status.add", {
        fields: {
          ENTITY_ID: entityId,
          STATUS_ID: stage.statusId || `CUSTOM_${Date.now()}_${stage.sort || 0}`,
          NAME: stage.name,
          SORT: stage.sort ?? 100,
          COLOR: stage.color || "#39A8EF",
        },
      });
      createdStages.push(result);
    } catch (error) {
      throw new Error(
        `Воронка создана (id=${categoryId}), но не удалось создать стадию "${stage.name}". ` +
          `Проверьте REST-методы crm.status.* в вашем портале Bitrix24. Ошибка: ${error.message}`
      );
    }
  }

  return { categoryId, category, stages: createdStages };
}

/** Добавить стадию в воронку. */
export async function create_new_funnel_stage(params = {}) {
  const categoryId = params.categoryId ?? 0;
  if (!params.name) throw new Error("name is required");

  const entityId = getDealStageEntityId(categoryId);

  return callBitrixMethod("crm.status.add", {
    fields: {
      ENTITY_ID: entityId,
      STATUS_ID: params.statusId || `CUSTOM_${Date.now()}`,
      NAME: params.name,
      SORT: params.sort ?? 100,
      COLOR: params.color || "#39A8EF",
    },
  });
}

/** Переименовать воронку. */
export async function rename_funnel_title(params = {}) {
  if (params.categoryId === undefined) throw new Error("categoryId is required");
  if (!params.name) throw new Error("name is required");

  return callBitrixMethod("crm.category.update", {
    entityTypeId: ENTITY_TYPE.DEAL,
    id: Number(params.categoryId),
    fields: { name: params.name },
  });
}

/** Переименовать одну или несколько стадий. */
export async function rename_funnel_stages(params = {}) {
  if (!params.stages?.length) throw new Error("stages array is required");

  const results = [];
  for (const stage of params.stages) {
    if (!stage.id) throw new Error("Each stage must have id");
    results.push(
      await callBitrixMethod("crm.status.update", {
        id: stage.id,
        fields: { NAME: stage.name },
      })
    );
  }
  return results;
}

/** Обновить стадии воронки (название, цвет, порядок). */
export async function update_funnel_stages(params = {}) {
  if (!params.stages?.length) throw new Error("stages array is required");

  const results = [];
  for (const stage of params.stages) {
    if (!stage.id) throw new Error("Each stage must have id");
    const fields = {};
    if (stage.name) fields.NAME = stage.name;
    if (stage.color) fields.COLOR = stage.color;
    if (stage.sort !== undefined) fields.SORT = stage.sort;

    results.push(
      await callBitrixMethod("crm.status.update", { id: stage.id, fields })
    );
  }
  return results;
}

/** Удалить воронку (требует confirm: true). */
export async function delete_funnel(params = {}) {
  requireDestructiveConfirm(params);
  if (params.categoryId === undefined) throw new Error("categoryId is required");

  return callBitrixMethod("crm.category.delete", {
    entityTypeId: ENTITY_TYPE.DEAL,
    id: Number(params.categoryId),
  });
}

/** Удалить стадию воронки (требует confirm: true). */
export async function delete_funnel_stage(params = {}) {
  requireDestructiveConfirm(params);
  if (!params.id) throw new Error("id is required");

  return callBitrixMethod("crm.status.delete", { id: params.id });
}

/** Перенести сделки между воронками. */
export async function move_deals_between_funnels(params = {}) {
  const {
    fromCategoryId,
    toCategoryId,
    toStageId,
    filter = {},
    limit = 50,
  } = params;

  if (fromCategoryId === undefined) throw new Error("fromCategoryId is required");
  if (toCategoryId === undefined) throw new Error("toCategoryId is required");
  if (!toStageId) throw new Error("toStageId is required");

  const { items } = await deal_list({
    filter: { ...filter, CATEGORY_ID: fromCategoryId },
    select: ["ID", "id"],
    start: 0,
  });

  const deals = items.slice(0, limit);
  const results = [];

  for (const deal of deals) {
    const id = deal.id ?? deal.ID;
    results.push(
      await deal_update({
        id,
        fields: {
          CATEGORY_ID: toCategoryId,
          STAGE_ID: toStageId,
        },
      })
    );
  }

  return { moved: results.length, results };
}

/** Перенести сделки между стадиями внутри воронки. */
export async function move_deals_between_stages(params = {}) {
  const {
    categoryId = 0,
    fromStageId,
    toStageId,
    filter = {},
    limit = 50,
  } = params;

  if (!fromStageId) throw new Error("fromStageId is required");
  if (!toStageId) throw new Error("toStageId is required");

  const { items } = await deal_list({
    filter: { ...filter, CATEGORY_ID: categoryId, STAGE_ID: fromStageId },
    select: ["ID", "id"],
  });

  const deals = items.slice(0, limit);
  const results = [];

  for (const deal of deals) {
    const id = deal.id ?? deal.ID;
    results.push(
      await deal_update({
        id,
        fields: { STAGE_ID: toStageId },
      })
    );
  }

  return { moved: results.length, results };
}

/** Создать пользовательское поле CRM. */
export async function create_crm_custom_field(params = {}) {
  const { entityType, fieldName, label, type = "string" } = params;
  if (!entityType) throw new Error("entityType is required");
  if (!fieldName) throw new Error("fieldName is required");
  if (!label) throw new Error("label is required");

  const entityMap = {
    lead: "CRM_LEAD",
    deal: "CRM_DEAL",
    contact: "CRM_CONTACT",
    company: "CRM_COMPANY",
  };

  const entityId = entityMap[String(entityType).toLowerCase()];
  if (!entityId) throw new Error(`Unknown entityType: ${entityType}`);

  try {
    return await callBitrixMethod("crm.userfield.add", {
      fields: {
        ENTITY_ID: entityId,
        FIELD_NAME: fieldName,
        USER_TYPE_ID: type,
        EDIT_FORM_LABEL: { ru: label, en: label },
        LIST_COLUMN_LABEL: { ru: label, en: label },
      },
    });
  } catch (error) {
    throw new Error(
      `Не удалось создать пользовательское поле. Проверьте права CRM и метод crm.userfield.add. ${error.message}`
    );
  }
}

// --- Контакты ---

export async function contact_list(params = {}) {
  const limit = params.limit ?? PAGINATION.DEFAULT_LIST_LIMIT;
  const { limit: _limit, allPages, ...rest } = params;

  if (allPages === true) {
    return crmItemListAll(ENTITY_TYPE.CONTACT, rest, "crm.contact.list", {
      actionName: "contact_list_all",
    });
  }

  const page = await crmItemList(ENTITY_TYPE.CONTACT, rest, "crm.contact.list");
  return applyListLimit(page, limit);
}

/** Полная выборка контактов для аналитики. */
export async function contactListAll(params = {}, options = {}) {
  return crmItemListAll(ENTITY_TYPE.CONTACT, params, "crm.contact.list", {
    actionName: options.actionName || "contact_list_all",
    maxPages: options.maxPages,
  });
}

export async function contact_get(params = {}) {
  if (!params.id) throw new Error("id is required");
  return crmItemGet(ENTITY_TYPE.CONTACT, params.id, "crm.contact.get");
}

export async function contact_create(params = {}) {
  if (!params.fields) throw new Error("fields is required");
  return crmItemAdd(ENTITY_TYPE.CONTACT, params.fields, "crm.contact.add");
}

export async function contact_update(params = {}) {
  if (!params.id) throw new Error("id is required");
  if (!params.fields) throw new Error("fields is required");
  return crmItemUpdate(ENTITY_TYPE.CONTACT, params.id, params.fields, "crm.contact.update");
}

// --- Компании ---

export async function company_list(params = {}) {
  const limit = params.limit ?? PAGINATION.DEFAULT_LIST_LIMIT;
  const { limit: _limit, ...rest } = params;
  const page = await crmItemList(ENTITY_TYPE.COMPANY, rest, "crm.company.list");
  return applyListLimit(page, limit);
}

export async function company_get(params = {}) {
  if (!params.id) throw new Error("id is required");
  return crmItemGet(ENTITY_TYPE.COMPANY, params.id, "crm.company.get");
}

export async function company_create(params = {}) {
  if (!params.fields) throw new Error("fields is required");
  return crmItemAdd(ENTITY_TYPE.COMPANY, params.fields, "crm.company.add");
}

export async function company_update(params = {}) {
  if (!params.id) throw new Error("id is required");
  if (!params.fields) throw new Error("fields is required");
  return crmItemUpdate(ENTITY_TYPE.COMPANY, params.id, params.fields, "crm.company.update");
}

export const crm_duplicate_search = notImplementedAction("crm_duplicate_search");
