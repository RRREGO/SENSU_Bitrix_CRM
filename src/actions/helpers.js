import { callBitrixMethod, callBitrixMethodFull } from "../bitrixClient.js";

export const ENTITY_TYPE = {
  LEAD: 1,
  DEAL: 2,
  CONTACT: 3,
  COMPANY: 4,
};

/** Лимиты пагинации и безопасных списков. */
export const PAGINATION = {
  PAGE_SIZE: 50,
  /** По умолчанию; переопределяется BITRIX_ANALYTICS_MAX_PAGES */
  MAX_PAGES: 200,
  DEFAULT_LIST_LIMIT: 50,
  SAMPLE_LIMIT: 100,
  /** Максимум элементов при полной выборке read-only списков таймлайна/истории стадий. */
  READ_LIST_MAX_ITEMS: 500,
  /** Максимум страниц для read-only списков таймлайна/истории стадий. */
  READ_LIST_MAX_PAGES: 20,
};

/** Положительное целое число (> 0). */
export function normalizePositiveInt(value, fieldName = "value") {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`${fieldName} должен быть положительным целым числом`);
  }
  return n;
}

/** Неотрицательное целое число (>= 0). */
export function normalizeNonNegativeInt(value, fieldName = "value") {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`${fieldName} должен быть неотрицательным целым числом`);
  }
  return n;
}

/** entityType (строка) → entityTypeId Bitrix CRM. */
export function resolveEntityTypeId(entityType) {
  const key = String(entityType || "").toLowerCase();
  const map = {
    lead: ENTITY_TYPE.LEAD,
    deal: ENTITY_TYPE.DEAL,
    contact: ENTITY_TYPE.CONTACT,
    company: ENTITY_TYPE.COMPANY,
  };
  const id = map[key];
  if (!id) {
    throw new Error(
      `Неизвестный entityType: ${entityType}. Используйте lead, deal, contact или company.`
    );
  }
  return id;
}

/** Актуальный лимит страниц аналитики из env. */
export function getAnalyticsMaxPages() {
  const fromEnv = Number(process.env.BITRIX_ANALYTICS_MAX_PAGES);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  return PAGINATION.MAX_PAGES;
}

/** Предупреждение о неполной выборке. */
export function buildTruncationMeta(truncated) {
  if (!truncated) {
    return { truncated: false, warning: null };
  }
  return {
    truncated: true,
    warning: "Отчёт построен не по всем данным: достигнут лимит страниц.",
    warnings: [
      {
        code: "ANALYTICS_PAGE_LIMIT_REACHED",
        message: "Отчёт построен не по всем данным: достигнут лимит страниц.",
      },
    ],
  };
}

/** Заглушка для зарегистрированных, но ещё не реализованных actions. */
export function notImplementedAction(name) {
  return async function notImplemented() {
    return {
      success: false,
      error: {
        code: "REPORT_NOT_IMPLEMENTED",
        message: "Этот отчёт зарегистрирован, но пока не реализован.",
        action: name,
      },
    };
  };
}

/** Логирование аналитики без клиентских данных. */
export function logAnalytics(fields = {}) {
  const {
    action = "unknown",
    pages = 0,
    items = 0,
    durationMs = 0,
    truncated = false,
    ...rest
  } = fields;

  const extras = Object.entries(rest)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");

  console.log(
    `[Analytics] action=${action} pages=${pages} items=${items} durationMs=${durationMs} truncated=${truncated}${
      extras ? ` ${extras}` : ""
    }`
  );
}

/**
 * Безопасный базовый URL портала из BITRIX_WEBHOOK_URL.
 * Удаляет /rest/... и секрет вебхука. Никогда не возвращает webhook path.
 */
export function getBitrixPortalBaseUrl() {
  const raw = process.env.BITRIX_WEBHOOK_URL;
  if (!raw || !String(raw).trim()) return null;
  try {
    const url = new URL(raw.trim());
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** URL карточки CRM-сущности (без секретов). */
export function buildCrmEntityUrl(entity, id) {
  const base = getBitrixPortalBaseUrl();
  if (!base || id == null) return null;
  const type = String(entity || "").toLowerCase();
  const map = {
    contact: "contact",
    deal: "deal",
    lead: "lead",
    company: "company",
  };
  const pathType = map[type];
  if (!pathType) return null;
  return `${base}/crm/${pathType}/details/${Number(id)}/`;
}


/** Проверка confirm: true для деструктивных действий. */
export function requireDestructiveConfirm(params = {}) {
  if (params.confirm !== true) {
    throw new Error("This action is destructive. Pass confirm: true to execute.");
  }
}

/** Поиск элемента по названию (регистронезависимо). */
export function findByName(items, name, nameFields = ["NAME", "name", "TITLE"]) {
  if (!name || !Array.isArray(items)) return null;
  const needle = String(name).trim().toLowerCase();
  return (
    items.find((item) =>
      nameFields.some((field) => {
        const value = item?.[field];
        return value && String(value).trim().toLowerCase() === needle;
      })
    ) || null
  );
}

/** Нормализация ответа list-методов Bitrix24. */
export function normalizeListResult(result, meta = {}) {
  let items = [];
  let total = meta.total ?? null;
  const next = meta.next ?? null;

  if (result?.items && Array.isArray(result.items)) {
    items = result.items;
    if (result.total != null) total = result.total;
  } else if (Array.isArray(result)) {
    items = result;
  } else if (result?.tasks && Array.isArray(result.tasks)) {
    items = result.tasks;
  }

  return { items, total, next };
}

/**
 * Ограничение списка для Claude / UI.
 * Аналитика должна обходить все страницы через fetchAllPages / crmItemListAll.
 */
export function applyListLimit(listResult, limit = PAGINATION.DEFAULT_LIST_LIMIT) {
  const items = Array.isArray(listResult?.items) ? listResult.items : [];
  const safeLimit = Math.max(1, Number(limit) || PAGINATION.DEFAULT_LIST_LIMIT);
  const limited = items.slice(0, safeLimit);
  const total = listResult?.total ?? null;
  const hasMore =
    Boolean(listResult?.next) ||
    (total != null && total > limited.length) ||
    items.length > safeLimit;

  return {
    items: limited,
    returned: limited.length,
    total: total ?? limited.length,
    hasMore,
    next: listResult?.next ?? null,
  };
}

/**
 * Обход всех страниц Bitrix24 с защитой от бесконечного цикла.
 * @param {{ fetchPage: (start: number) => Promise<{items: any[], next?: number|null, total?: number|null}>, maxPages?: number, actionName?: string }} options
 */
export async function fetchAllPages({
  fetchPage,
  maxPages = getAnalyticsMaxPages(),
  actionName = "list",
} = {}) {
  if (typeof fetchPage !== "function") {
    throw new Error("fetchAllPages requires fetchPage(start)");
  }

  const started = Date.now();
  const all = [];
  let start = 0;
  let pages = 0;
  let total = null;
  let truncated = false;
  let previousStart = null;

  while (pages < maxPages) {
    let page;
    try {
      page = await fetchPage(start);
    } catch (error) {
      // Page-level failure after read retries → partial/truncated, do not restart whole report
      truncated = true;
      const warning = {
        code: "BITRIX_PAGE_LOAD_FAILED",
        message: "Не удалось загрузить часть данных Bitrix24.",
        details: { pageStart: start, pagesLoaded: pages },
      };
      logAnalytics({
        action: actionName,
        pages,
        items: all.length,
        durationMs: Date.now() - started,
        truncated: true,
        warning: warning.code,
      });
      return {
        items: all,
        total: total ?? all.length,
        pages,
        truncated: true,
        partial: true,
        hasMore: true,
        returned: all.length,
        warnings: [warning],
        failedPageStart: start,
      };
    }
    const items = Array.isArray(page?.items) ? page.items : [];
    all.push(...items);
    pages += 1;

    if (page?.total != null) total = page.total;

    const next = page?.next;
    if (next == null || items.length === 0) {
      break;
    }

    if (next === start || next === previousStart) {
      truncated = true;
      break;
    }

    previousStart = start;
    start = next;
  }

  if (pages >= maxPages) {
    const likelyMore = total != null ? all.length < total : true;
    if (likelyMore) truncated = true;
  }

  logAnalytics({
    action: actionName,
    pages,
    items: all.length,
    durationMs: Date.now() - started,
    truncated,
  });

  return {
    items: all,
    total: total ?? all.length,
    pages,
    truncated,
    partial: Boolean(truncated),
    returned: all.length,
    hasMore: truncated,
  };
}

/**
 * Полная выборка с ограничением по страницам и общему числу элементов.
 */
export async function fetchAllPagesCapped({
  fetchPage,
  maxPages = PAGINATION.READ_LIST_MAX_PAGES,
  maxItems = PAGINATION.READ_LIST_MAX_ITEMS,
  actionName = "list",
} = {}) {
  const result = await fetchAllPages({ fetchPage, maxPages, actionName });
  if (result.items.length > maxItems) {
    result.items = result.items.slice(0, maxItems);
    result.truncated = true;
    result.hasMore = true;
    result.returned = result.items.length;
    const warning = {
      code: "READ_LIST_ITEM_LIMIT_REACHED",
      message: `Достигнут безопасный лимит элементов (${maxItems}).`,
    };
    result.warnings = [...(result.warnings || []), warning];
  }
  return result;
}

/** Маппинг legacy-полей фильтра → crm.item.list (camelCase). */
const ITEM_FILTER_FIELD_MAP = {
  ID: "id",
  TITLE: "title",
  STAGE_ID: "stageId",
  STATUS_ID: "statusId",
  CATEGORY_ID: "categoryId",
  ASSIGNED_BY_ID: "assignedById",
  OPPORTUNITY: "opportunity",
  CURRENCY_ID: "currencyId",
  DATE_CREATE: "dateCreate",
  CLOSEDATE: "closedate",
  CLOSED: "closed",
  COMPANY_ID: "companyId",
  CONTACT_ID: "contactId",
  BIRTHDATE: "birthdate",
  NAME: "name",
  LAST_NAME: "lastName",
  SECOND_NAME: "secondName",
};

/**
 * Нормализует filter для crm.item.list.
 * Bitrix искажает UPPER_SNAKE с операторами (>=DATE_CREATE → >=_DA_TE_...).
 */
export function normalizeItemFilter(filter = {}) {
  const out = {};
  for (const [key, value] of Object.entries(filter || {})) {
    const match = String(key).match(/^(>=|<=|>|<|!|%)?(.+)$/);
    const op = match?.[1] || "";
    const field = match?.[2] || key;
    const mapped = ITEM_FILTER_FIELD_MAP[field] || field;
    out[`${op}${mapped}`] = value;
  }
  return out;
}

/** Нормализация order для crm.item.list. */
export function normalizeItemOrder(order = {}) {
  const out = {};
  for (const [key, value] of Object.entries(order || {})) {
    out[ITEM_FILTER_FIELD_MAP[key] || key] = value;
  }
  return out;
}

function filterUsesUserFields(filter = {}, select = []) {
  const keys = [
    ...Object.keys(filter || {}),
    ...(Array.isArray(select) ? select : []),
  ];
  return keys.some((key) => {
    const field = String(key).replace(/^(>=|<=|>|<|!|%)/, "");
    return /^UF_/i.test(field);
  });
}

/** Универсальный list через crm.item.list с fallback. */
export async function crmItemList(entityTypeId, params = {}, legacyMethod) {
  const { filter = {}, select = [], order = {}, start = 0 } = params;
  const itemFilter = normalizeItemFilter(filter);
  const itemOrder = normalizeItemOrder(order);
  const preferLegacy = Boolean(legacyMethod) && filterUsesUserFields(filter, select);

  // UF_CRM_* через crm.item.list Bitrix часто искажает (UF__CRM_...).
  // Для пользовательских полей предпочитаем legacy-методы.
  if (preferLegacy) {
    try {
      const legacyParams = { filter, order, start };
      if (select?.length) legacyParams.select = select;
      const { result, next, total } = await callBitrixMethodFull(legacyMethod, legacyParams);
      return normalizeListResult(result, { next, total });
    } catch (legacyError) {
      console.warn(`legacy ${legacyMethod} failed, trying crm.item.list:`, legacyError.message);
    }
  }

  try {
    const { result, next, total } = await callBitrixMethodFull("crm.item.list", {
      entityTypeId,
      filter: itemFilter,
      select,
      order: itemOrder,
      start,
    });
    return normalizeListResult(result, { next, total });
  } catch (error) {
    console.warn(`crm.item.list fallback to ${legacyMethod}:`, error.message);
    const legacyParams = { filter, order, start };
    if (select?.length) legacyParams.select = select;
    const { result, next, total } = await callBitrixMethodFull(legacyMethod, legacyParams);
    return normalizeListResult(result, { next, total });
  }
}

/** Загрузка всех страниц crm.item.list / legacy list для аналитики. */
export async function crmItemListAll(entityTypeId, params = {}, legacyMethod, options = {}) {
  const { filter = {}, select = [], order = {} } = params;
  return fetchAllPages({
    actionName: options.actionName || legacyMethod || `crm.item.list:${entityTypeId}`,
    maxPages: options.maxPages ?? getAnalyticsMaxPages(),
    fetchPage: (start) =>
      crmItemList(entityTypeId, { filter, select, order, start }, legacyMethod),
  });
}

/** Универсальный get через crm.item.get с fallback. */
export async function crmItemGet(entityTypeId, id, legacyMethod) {
  try {
    return await callBitrixMethod("crm.item.get", {
      entityTypeId,
      id: Number(id),
    });
  } catch (error) {
    console.warn(`crm.item.get fallback to ${legacyMethod}:`, error.message);
    return callBitrixMethod(legacyMethod, { id: Number(id) });
  }
}

/** Универсальный update через crm.item.update с fallback. */
export async function crmItemUpdate(entityTypeId, id, fields, legacyMethod) {
  try {
    return await callBitrixMethod("crm.item.update", {
      entityTypeId,
      id: Number(id),
      fields,
    });
  } catch (error) {
    console.warn(`crm.item.update fallback to ${legacyMethod}:`, error.message);
    return callBitrixMethod(legacyMethod, { id: Number(id), fields });
  }
}

/** Универсальный add через crm.item.add с fallback. */
export async function crmItemAdd(entityTypeId, fields, legacyMethod) {
  try {
    return await callBitrixMethod("crm.item.add", {
      entityTypeId,
      fields,
    });
  } catch (error) {
    console.warn(`crm.item.add fallback to ${legacyMethod}:`, error.message);
    return callBitrixMethod(legacyMethod, { fields });
  }
}

/** Универсальный delete через crm.item.delete с fallback. */
export async function crmItemDelete(entityTypeId, id, legacyMethod) {
  try {
    return await callBitrixMethod("crm.item.delete", {
      entityTypeId,
      id: Number(id),
    });
  } catch (error) {
    console.warn(`crm.item.delete fallback to ${legacyMethod}:`, error.message);
    return callBitrixMethod(legacyMethod, { id: Number(id) });
  }
}

/** Универсальный fields через crm.item.fields с fallback. */
export async function crmItemFields(entityTypeId, legacyMethod) {
  try {
    return await callBitrixMethod("crm.item.fields", { entityTypeId });
  } catch (error) {
    console.warn(`crm.item.fields fallback to ${legacyMethod}:`, error.message);
    return callBitrixMethod(legacyMethod, {});
  }
}

export function isNil(value) {
  return value === null || value === undefined;
}

/** Значение задано (0 и непустые строки — валидны). */
export function hasPresentValue(value) {
  if (isNil(value)) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  return true;
}

/** ENTITY_ID для стадий сделок по categoryId. CATEGORY_ID=0 — общая воронка. */
export function getDealStageEntityId(categoryId = 0) {
  if (isNil(categoryId)) {
    categoryId = 0;
  }
  const id = Number(categoryId);
  if (!Number.isFinite(id) || id < 0) {
    throw new Error(`Invalid categoryId: ${categoryId}`);
  }
  if (id === 0) {
    return "DEAL_STAGE";
  }
  return `DEAL_STAGE_${id}`;
}

/** Маппинг entityType → Bitrix timeline type. */
export function mapTimelineEntityType(entityType) {
  const map = {
    lead: { entityType: "lead", ownerType: "LEAD" },
    deal: { entityType: "deal", ownerType: "DEAL" },
    contact: { entityType: "contact", ownerType: "CONTACT" },
    company: { entityType: "company", ownerType: "COMPANY" },
  };
  const key = String(entityType || "").toLowerCase();
  const mapped = map[key];
  if (!mapped) {
    throw new Error(`Unknown entityType: ${entityType}. Use lead, deal, contact, or company.`);
  }
  return mapped;
}

/** Извлечь item из ответа crm.item.get (может быть обёрнут в item). */
export function unwrapCrmItem(result) {
  if (result?.item) return result.item;
  return result;
}

/** Получить поля сделки из item-формата или legacy. */
export function extractDealFields(item) {
  const data = unwrapCrmItem(item);
  return {
    ...data,
    stageId: data.STAGE_ID || data.stageId,
    opportunity: Number(data.OPPORTUNITY ?? data.opportunity ?? 0),
    currencyId: data.CURRENCY_ID || data.currencyId || "RUB",
    title: data.TITLE || data.title,
  };
}

/** Карта stageId → русское название. */
export function buildStageNameMap(stages = []) {
  const map = new Map();
  for (const stage of stages) {
    const id = stage.STATUS_ID || stage.statusId;
    if (!id) continue;
    map.set(String(id), stage.NAME || stage.name || String(id));
  }
  return map;
}

/** Суммировать opportunity с группировкой по валюте. */
export function addCurrencyAmount(totalsByCurrency, currencyId, amount) {
  const currency = currencyId || "RUB";
  const value = Number(amount) || 0;
  totalsByCurrency[currency] = (totalsByCurrency[currency] || 0) + value;
  return totalsByCurrency;
}
