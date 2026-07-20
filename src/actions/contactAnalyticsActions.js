/**
 * Read-only аналитика контактов и качества ведения CRM.
 */
import { callBitrixMethod } from "../bitrixClient.js";
import {
  getContactMethodologyConfig,
  requireStatusField,
  requireCycleValues,
  configError,
} from "../config/contactMethodology.js";
import { resolveUsersByIds, resolveCompaniesByIds } from "../cache/directoryCache.js";
import { contactListAll } from "./crmActions.js";
import { activityListAll } from "./timelineActions.js";
import { buildActivityIndex, OWNER_TYPE } from "../analytics/activityIndex.js";
import {
  PAGINATION,
  ENTITY_TYPE,
  unwrapCrmItem,
  logAnalytics,
  buildCrmEntityUrl,
  crmItemList,
  buildTruncationMeta,
} from "./helpers.js";

const CONTACT_OWNER_TYPE_ID = 3;

let fieldAuditCache = null;
let fieldAuditCacheAt = 0;
const FIELD_AUDIT_TTL_MS = 5 * 60 * 1000;

const FIELD_NOISE = new Set([
  "PHONE",
  "EMAIL",
  "WEB",
  "IM",
  "LINK",
  "UF_CRM_INSTAGRAM_WZ",
  "UF_CRM_TELEGRAMUSERNAME_WZ",
  "UF_CRM_TELEGRAMID_WZ",
  "UF_CRM_VK_WZ",
  "UF_CRM_AVITO_WZ",
  "UF_CRM_MAXUSERNAME_WZ",
  "UF_CRM_MAXID_WZ",
]);

function sampleLimit(limit) {
  return Math.min(Number(limit) || PAGINATION.SAMPLE_LIMIT, PAGINATION.SAMPLE_LIMIT);
}

function isEmptyFieldValue(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0 || value.every((v) => isEmptyFieldValue(v));
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function normalizeStatusId(value) {
  if (isEmptyFieldValue(value)) return null;
  if (Array.isArray(value)) {
    const first = value.find((v) => !isEmptyFieldValue(v));
    return first == null ? null : String(first);
  }
  return String(value);
}

function formatContactName(data = {}) {
  const parts = [
    data.NAME || data.name,
    data.SECOND_NAME || data.secondName,
    data.LAST_NAME || data.lastName,
  ]
    .map((part) => (part == null ? "" : String(part).trim()))
    .filter(Boolean);
  if (parts.length) return parts.join(" ");
  return data.TITLE || data.title || `Контакт #${data.ID || data.id || "?"}`;
}

function getFieldValue(data, fieldId) {
  if (!fieldId) return undefined;
  if (data[fieldId] !== undefined) return data[fieldId];
  // crm.item может отдавать ufCrm... camelCase — пробуем оба вида
  const camel = fieldId.replace(/_([A-Z0-9])/gi, (_, c) => c.toUpperCase()).replace(/^UF/, "uf");
  if (data[camel] !== undefined) return data[camel];
  return undefined;
}

function localizeTitle(meta, fallback) {
  const candidates = [
    meta?.formLabel,
    meta?.listLabel,
    meta?.title,
    meta?.editFormLabel,
    meta?.LIST_COLUMN_LABEL,
    meta?.EDIT_FORM_LABEL,
    meta?.TITLE,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === "string") return candidate;
    if (typeof candidate === "object") {
      return candidate.ru || candidate.en || Object.values(candidate)[0] || fallback;
    }
  }
  return fallback;
}

function extractEnumValues(meta = {}) {
  const raw = meta.items || meta.list || meta.enumValues || meta.items?.values || null;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      id: String(item.ID ?? item.id ?? item.VALUE ?? item.value ?? ""),
      value: String(item.VALUE ?? item.value ?? item.NAME ?? item.name ?? item.ID ?? item.id ?? ""),
    }))
    .filter((item) => item.id || item.value);
}

function isActivitiesAccessError(error) {
  const message = error?.message || String(error);
  return /privileges|access|permission|scope|denied|недостаточно прав/i.test(message);
}

function activitiesAccessDenied() {
  return {
    success: false,
    error: {
      code: "CRM_ACTIVITIES_ACCESS_DENIED",
      message: "У входящего вебхука недостаточно прав для чтения CRM-дел.",
      details: { requiredScope: "CRM" },
    },
  };
}

async function loadContactActivitiesSafe(select = ["ID", "OWNER_ID", "SUBJECT", "DEADLINE", "COMPLETED"]) {
  try {
    const result = await activityListAll(
      {
        filter: {
          OWNER_TYPE_ID: CONTACT_OWNER_TYPE_ID,
          COMPLETED: "N",
        },
        select,
      },
      { actionName: "contact_activities_incomplete" }
    );
    return { ok: true, ...result };
  } catch (error) {
    if (isActivitiesAccessError(error)) {
      return { ok: false, error: activitiesAccessDenied() };
    }
    throw error;
  }
}

function classifyContactActivities(activities = []) {
  const now = Date.now();
  const byContact = new Map();

  for (const activity of activities) {
    const data = unwrapCrmItem(activity);
    const ownerId = String(data.OWNER_ID || data.ownerId || "");
    if (!ownerId) continue;
    const deadlineRaw = data.DEADLINE || data.deadline || data.END_TIME || data.endTime;
    const deadlineMs = deadlineRaw ? new Date(deadlineRaw).getTime() : null;
    const isFutureOrCurrent = deadlineMs == null || Number.isNaN(deadlineMs) || deadlineMs >= now;
    const isOverdue = deadlineMs != null && !Number.isNaN(deadlineMs) && deadlineMs < now;

    if (!byContact.has(ownerId)) {
      byContact.set(ownerId, { hasFuture: false, hasOverdue: false, activities: [] });
    }
    const bucket = byContact.get(ownerId);
    bucket.activities.push(data);
    if (isFutureOrCurrent) bucket.hasFuture = true;
    if (isOverdue) bucket.hasOverdue = true;
  }

  return byContact;
}

async function enrichContactSamples(contacts, { statusField = null, statusMap = new Map() } = {}) {
  const responsibleIds = contacts.map((c) => c.ASSIGNED_BY_ID ?? c.assignedById).filter(Boolean);
  const companyIds = contacts.map((c) => c.COMPANY_ID ?? c.companyId).filter(Boolean);
  const [users, companies] = await Promise.all([
    resolveUsersByIds(responsibleIds),
    resolveCompaniesByIds(companyIds),
  ]);

  return contacts.map((raw) => {
    const data = unwrapCrmItem(raw);
    const id = Number(data.ID || data.id);
    const responsibleId = data.ASSIGNED_BY_ID ?? data.assignedById ?? null;
    const companyId = data.COMPANY_ID ?? data.companyId ?? null;
    const statusId = statusField ? normalizeStatusId(getFieldValue(data, statusField)) : null;

    return {
      id,
      name: formatContactName(data),
      responsibleId: responsibleId != null ? Number(responsibleId) : null,
      responsibleName: responsibleId != null ? users.get(String(responsibleId))?.name || null : null,
      companyId: companyId && Number(companyId) !== 0 ? Number(companyId) : null,
      companyName:
        companyId && Number(companyId) !== 0
          ? companies.get(String(companyId))?.name || null
          : null,
      statusId,
      statusName: statusId ? statusMap.get(String(statusId)) || String(statusId) : null,
      url: buildCrmEntityUrl("contact", id),
    };
  });
}

async function getStatusEnumMap(statusField) {
  const audit = await contact_field_audit({});
  const field = (audit.fields || []).find((f) => f.id === statusField);
  const map = new Map();
  for (const item of field?.enumValues || []) {
    map.set(String(item.id), item.value);
  }
  return { map, field };
}

/** Аудит полей контакта (стандартные + UF, без шума). */
export async function contact_field_audit(params = {}) {
  const force = Boolean(params.force);
  if (!force && fieldAuditCache && Date.now() - fieldAuditCacheAt < FIELD_AUDIT_TTL_MS) {
    return fieldAuditCache;
  }

  const started = Date.now();
  let raw;
  try {
    raw = await callBitrixMethod("crm.contact.fields", {});
  } catch (error) {
    try {
      raw = await callBitrixMethod("crm.item.fields", { entityTypeId: ENTITY_TYPE.CONTACT });
      raw = raw?.fields || raw;
    } catch {
      throw error;
    }
  }

  const fields = [];
  for (const [id, meta] of Object.entries(raw || {})) {
    if (FIELD_NOISE.has(id)) continue;
    if (/^(PHONE|EMAIL|WEB|IM|LINK)$/i.test(id)) continue;

    const type = meta?.type || meta?.TYPE || meta?.userTypeId || meta?.userTypeID || "unknown";
    const title = localizeTitle(meta, id);
    const multiple = Boolean(meta?.isMultiple || meta?.multiple || meta?.isMultiple === "Y");
    const required = Boolean(meta?.isRequired || meta?.required || meta?.isRequired === "Y");
    const enumValues = /enum|enumeration|crm_status/i.test(String(type))
      ? extractEnumValues(meta)
      : [];

    if (!id.startsWith("UF_") && /^(ADDRESS_|UTM_|FACE_ID|HAS_|DATE_|TYPE_ID|SOURCE_ID|ORIGIN)/i.test(id)) {
      const keep = new Set([
        "ID",
        "NAME",
        "SECOND_NAME",
        "LAST_NAME",
        "BIRTHDATE",
        "COMPANY_ID",
        "COMPANY_IDS",
        "ASSIGNED_BY_ID",
        "TYPE_ID",
        "SOURCE_ID",
        "POST",
        "COMMENTS",
        "OPENED",
        "EXPORT",
      ]);
      if (!keep.has(id) && !/NAME|BIRTH|COMPANY|ASSIGNED|POST|TYPE|SOURCE/i.test(id)) {
        continue;
      }
    }

    fields.push({
      id,
      title,
      type,
      multiple,
      required,
      ...(enumValues.length ? { enumValues } : {}),
    });
  }

  fields.sort((a, b) => {
    const aUf = a.id.startsWith("UF_") ? 1 : 0;
    const bUf = b.id.startsWith("UF_") ? 1 : 0;
    if (aUf !== bUf) return aUf - bUf;
    return String(a.title).localeCompare(String(b.title), "ru");
  });

  logAnalytics({
    action: "contact_field_audit",
    pages: 1,
    items: fields.length,
    durationMs: Date.now() - started,
    truncated: false,
  });

  fieldAuditCache = {
    entity: "contact",
    fields,
    configHints: {
      statusFieldEnv: "BITRIX_CONTACT_STATUS_FIELD",
      warmupFieldEnv: "BITRIX_CONTACT_WARMUP_FIELD",
      birthdayFieldEnv: "BITRIX_CONTACT_BIRTHDAY_FIELD",
    },
  };
  fieldAuditCacheAt = Date.now();
  return fieldAuditCache;
}

/** Общее количество контактов. */
export async function contact_count(params = {}) {
  const started = Date.now();
  const filter = params.filter || {};

  const first = await crmItemList(
    ENTITY_TYPE.CONTACT,
    { filter, select: ["ID", "id"], start: 0 },
    "crm.contact.list"
  );

  if (first.total != null) {
    const pagesProcessed = Math.max(1, Math.ceil(Number(first.total) / PAGINATION.PAGE_SIZE));
    logAnalytics({
      action: "contact_count",
      pages: 1,
      items: first.total,
      durationMs: Date.now() - started,
      truncated: false,
      pagesProcessed,
    });
    return {
      entity: "contact",
      total: first.total,
      pagesProcessed,
      truncated: false,
    };
  }

  const { items, total, pages, truncated } = await contactListAll(
    { filter, select: ["ID", "id"] },
    { actionName: "contact_count" }
  );

  logAnalytics({
    action: "contact_count",
    pages,
    items: total ?? items.length,
    durationMs: Date.now() - started,
    truncated,
  });

  return {
    entity: "contact",
    total: total ?? items.length,
    pagesProcessed: pages,
    truncated,
  };
}

/** Контакты по статусам. */
export async function contact_count_by_status(params = {}) {
  const config = getContactMethodologyConfig();
  const missing = requireStatusField(config);
  if (missing) return missing;

  const started = Date.now();
  const statusField = config.statusField;
  const { map: statusMap } = await getStatusEnumMap(statusField);

  const { items, pages, truncated, total } = await contactListAll(
    {
      filter: params.filter || {},
      select: ["ID", "id", statusField],
    },
    { actionName: "contact_count_by_status" }
  );

  const counts = new Map();
  for (const item of items) {
    const data = unwrapCrmItem(item);
    const statusId = normalizeStatusId(getFieldValue(data, statusField));
    const key = statusId ?? "__empty__";
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const groups = [];
  for (const [key, count] of counts.entries()) {
    if (key === "__empty__") {
      groups.push({ statusId: null, statusName: "Без статуса", count });
    } else {
      groups.push({
        statusId: key,
        statusName: statusMap.get(key) || key,
        count,
      });
    }
  }

  groups.sort((a, b) => {
    if (a.statusId == null && b.statusId != null) return 1;
    if (b.statusId == null && a.statusId != null) return -1;
    return b.count - a.count;
  });

  // Явно вынести «Без статуса» в конец, но видимым
  const empty = groups.filter((g) => g.statusId == null);
  const filled = groups.filter((g) => g.statusId != null);
  const ordered = [...filled, ...empty];

  logAnalytics({
    action: "contact_count_by_status",
    pages,
    items: items.length,
    durationMs: Date.now() - started,
    truncated,
    groups: ordered.length,
  });

  return {
    entity: "contact",
    groupBy: "status",
    statusField,
    total: total ?? items.length,
    groups: ordered,
    truncated,
    pages,
  };
}

/** Контакты без статуса. */
export async function contacts_without_status(params = {}) {
  const config = getContactMethodologyConfig();
  const missing = requireStatusField(config);
  if (missing) return missing;

  const started = Date.now();
  const statusField = config.statusField;
  const { map: statusMap } = await getStatusEnumMap(statusField);

  const { items, pages, truncated } = await contactListAll(
    {
      filter: params.filter || {},
      select: [
        "ID",
        "id",
        "NAME",
        "name",
        "SECOND_NAME",
        "secondName",
        "LAST_NAME",
        "lastName",
        "ASSIGNED_BY_ID",
        "assignedById",
        "COMPANY_ID",
        "companyId",
        statusField,
      ],
    },
    { actionName: "contacts_without_status" }
  );

  const without = items.filter((item) => {
    const data = unwrapCrmItem(item);
    return normalizeStatusId(getFieldValue(data, statusField)) == null;
  });

  const sample = await enrichContactSamples(without.slice(0, sampleLimit()), {
    statusField,
    statusMap,
  });

  logAnalytics({
    action: "contacts_without_status",
    pages,
    items: without.length,
    durationMs: Date.now() - started,
    truncated,
    sample: sample.length,
  });

  return {
    entity: "contact",
    issue: "missing_status",
    statusField,
    count: without.length,
    sample,
    sampleLimit: PAGINATION.SAMPLE_LIMIT,
    truncated: Boolean(truncated) || without.length > PAGINATION.SAMPLE_LIMIT,
    severity: "critical",
    pages,
  };
}

/** Контакты без компании. */
export async function contacts_without_company(params = {}) {
  const started = Date.now();
  const config = getContactMethodologyConfig();
  const statusField = config.statusField;
  const statusMap = statusField ? (await getStatusEnumMap(statusField)).map : new Map();

  const select = [
    "ID",
    "id",
    "NAME",
    "name",
    "SECOND_NAME",
    "secondName",
    "LAST_NAME",
    "lastName",
    "ASSIGNED_BY_ID",
    "assignedById",
    "COMPANY_ID",
    "companyId",
    "COMPANY_IDS",
    "companyIds",
  ];
  if (statusField) select.push(statusField);

  const { items, pages, truncated } = await contactListAll(
    {
      filter: params.filter || {},
      select,
    },
    { actionName: "contacts_without_company" }
  );

  const without = items.filter((item) => {
    const data = unwrapCrmItem(item);
    const companyId = data.COMPANY_ID ?? data.companyId;
    const companyIds = data.COMPANY_IDS ?? data.companyIds;
    const hasSingle = companyId != null && String(companyId) !== "" && Number(companyId) !== 0;
    const hasMulti = Array.isArray(companyIds)
      ? companyIds.some((id) => id != null && String(id) !== "" && Number(id) !== 0)
      : !isEmptyFieldValue(companyIds);
    return !hasSingle && !hasMulti;
  });

  const sample = await enrichContactSamples(without.slice(0, sampleLimit()), {
    statusField,
    statusMap,
  });

  logAnalytics({
    action: "contacts_without_company",
    pages,
    items: without.length,
    durationMs: Date.now() - started,
    truncated,
    sample: sample.length,
  });

  return {
    entity: "contact",
    issue: "missing_company",
    count: without.length,
    sample,
    sampleLimit: PAGINATION.SAMPLE_LIMIT,
    truncated: Boolean(truncated) || without.length > PAGINATION.SAMPLE_LIMIT,
    severity: "warning",
    pages,
  };
}

/** Контакты без даты рождения. */
export async function contacts_missing_birthday(params = {}) {
  const started = Date.now();
  const config = getContactMethodologyConfig();
  const birthdayField = config.birthdayField || "BIRTHDATE";
  const statusField = config.statusField;
  const statusMap = statusField ? (await getStatusEnumMap(statusField)).map : new Map();

  const filter = { ...(params.filter || {}) };
  if (params.responsibleId) filter.ASSIGNED_BY_ID = params.responsibleId;
  if (statusField && Array.isArray(params.statusIds) && params.statusIds.length) {
    filter[statusField] = params.statusIds;
  }

  const select = [
    "ID",
    "id",
    "NAME",
    "name",
    "SECOND_NAME",
    "secondName",
    "LAST_NAME",
    "lastName",
    "ASSIGNED_BY_ID",
    "assignedById",
    "COMPANY_ID",
    "companyId",
    birthdayField,
  ];
  if (statusField) select.push(statusField);

  const { items, pages, truncated } = await contactListAll(
    { filter, select },
    { actionName: "contacts_missing_birthday" }
  );

  let missing = items.filter((item) => {
    const data = unwrapCrmItem(item);
    return isEmptyFieldValue(getFieldValue(data, birthdayField) ?? data.BIRTHDATE ?? data.birthdate);
  });

  if (statusField && Array.isArray(params.statusIds) && params.statusIds.length) {
    const allowed = new Set(params.statusIds.map(String));
    missing = missing.filter((item) => {
      const data = unwrapCrmItem(item);
      const statusId = normalizeStatusId(getFieldValue(data, statusField));
      return statusId && allowed.has(statusId);
    });
  }

  const sample = await enrichContactSamples(missing.slice(0, sampleLimit()), {
    statusField,
    statusMap,
  });

  logAnalytics({
    action: "contacts_missing_birthday",
    pages,
    items: missing.length,
    durationMs: Date.now() - started,
    truncated,
    sample: sample.length,
  });

  return {
    entity: "contact",
    issue: "missing_birthday",
    birthdayField,
    count: missing.length,
    sample,
    sampleLimit: PAGINATION.SAMPLE_LIMIT,
    truncated: Boolean(truncated) || missing.length > PAGINATION.SAMPLE_LIMIT,
    severity: "warning",
    pages,
  };
}

/** Контакты в «Цикле» без следующего CRM-дела. */
export async function contacts_cycle_without_next_activity(params = {}) {
  const config = getContactMethodologyConfig();
  const missing = requireCycleValues(config);
  if (missing) return missing;

  const started = Date.now();
  const statusField = config.statusField;
  const cycleValues = new Set(config.statusCycleValues.map(String));
  const { map: statusMap } = await getStatusEnumMap(statusField);

  // Проверка неизвестных значений статуса
  const unknownValues = config.statusCycleValues.filter((id) => !statusMap.has(String(id)));
  if (unknownValues.length && params.strictUnknown !== false) {
    // Не блокируем полностью — предупреждаем в результате, но продолжаем
  }

  const { items: contacts, pages, truncated } = await contactListAll(
    {
      filter: {
        [statusField]: config.statusCycleValues,
        ...(params.filter || {}),
        ...(params.responsibleId ? { ASSIGNED_BY_ID: params.responsibleId } : {}),
      },
      select: [
        "ID",
        "id",
        "NAME",
        "name",
        "SECOND_NAME",
        "secondName",
        "LAST_NAME",
        "lastName",
        "ASSIGNED_BY_ID",
        "assignedById",
        "COMPANY_ID",
        "companyId",
        statusField,
      ],
    },
    { actionName: "contacts_cycle_without_next_activity.contacts" }
  );

  // Доп. фильтр на случай, если Bitrix вернул шире
  const cycleContacts = contacts.filter((item) => {
    const data = unwrapCrmItem(item);
    const statusId = normalizeStatusId(getFieldValue(data, statusField));
    return statusId && cycleValues.has(statusId);
  });

  const activitiesResult = await loadContactActivitiesSafe([
    "ID",
    "OWNER_ID",
    "SUBJECT",
    "DEADLINE",
    "COMPLETED",
  ]);
  if (!activitiesResult.ok) return activitiesResult.error;

  const byContact = classifyContactActivities(activitiesResult.items || []);
  const withoutActivity = [];
  const withOverdueActivityOnly = [];

  for (const item of cycleContacts) {
    const data = unwrapCrmItem(item);
    const id = String(data.ID || data.id);
    const bucket = byContact.get(id);
    if (!bucket) {
      withoutActivity.push(item);
    } else if (!bucket.hasFuture && bucket.hasOverdue) {
      withOverdueActivityOnly.push(item);
    }
  }

  const [withoutSample, overdueSample] = await Promise.all([
    enrichContactSamples(withoutActivity.slice(0, sampleLimit()), { statusField, statusMap }),
    enrichContactSamples(withOverdueActivityOnly.slice(0, sampleLimit()), {
      statusField,
      statusMap,
    }),
  ]);

  logAnalytics({
    action: "contacts_cycle_without_next_activity",
    pages,
    contacts: cycleContacts.length,
    items: withoutActivity.length + withOverdueActivityOnly.length,
    activityRequests: activitiesResult.pages || 1,
    durationMs: Date.now() - started,
    truncated,
    sample: withoutSample.length + overdueSample.length,
  });

  return {
    entity: "contact",
    issue: "cycle_without_next_activity",
    statusField,
    cycleValues: config.statusCycleValues,
    unknownCycleValues: unknownValues,
    countWithoutActivity: withoutActivity.length,
    countWithOverdueActivityOnly: withOverdueActivityOnly.length,
    withoutActivity: withoutSample,
    withOverdueActivityOnly: overdueSample,
    sampleLimit: PAGINATION.SAMPLE_LIMIT,
    truncated:
      Boolean(truncated) ||
      withoutActivity.length > PAGINATION.SAMPLE_LIMIT ||
      withOverdueActivityOnly.length > PAGINATION.SAMPLE_LIMIT,
    severity: "critical",
    pages,
    note: "Проверяются только CRM-дела (crm.activity), не задачи tasks.",
  };
}

function nextBirthdayDate(birthdate, year) {
  const d = new Date(birthdate);
  if (Number.isNaN(d.getTime())) return null;
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  // 29 февраля → 28 февраля в невисокосные
  let candidate = new Date(Date.UTC(year, month, day));
  if (month === 1 && day === 29 && candidate.getUTCMonth() !== 1) {
    candidate = new Date(Date.UTC(year, 1, 28));
  }
  return candidate;
}

function matchesBirthdayPattern(subject, patterns) {
  const text = String(subject || "").toLowerCase();
  return patterns.some((pattern) => text.includes(pattern));
}

/** Контроль поздравлений с днём рождения. */
export async function contacts_birthday_activity_report(params = {}) {
  const config = getContactMethodologyConfig();
  const birthdayField = config.birthdayField || "BIRTHDATE";
  const daysAhead = Number(params.daysAhead ?? 30);
  const year = Number(params.year || new Date().getFullYear());
  const patterns = config.birthdayActivityPatterns;
  const started = Date.now();

  const filter = { ...(params.filter || {}) };
  if (params.responsibleId) filter.ASSIGNED_BY_ID = params.responsibleId;

  const { items: contacts, pages, truncated } = await contactListAll(
    {
      filter,
      select: [
        "ID",
        "id",
        "NAME",
        "name",
        "SECOND_NAME",
        "secondName",
        "LAST_NAME",
        "lastName",
        "ASSIGNED_BY_ID",
        "assignedById",
        "COMPANY_ID",
        "companyId",
        birthdayField,
      ],
    },
    { actionName: "contacts_birthday_activity_report.contacts" }
  );

  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const horizonMs = daysAhead * 24 * 60 * 60 * 1000;

  const upcoming = [];
  for (const item of contacts) {
    const data = unwrapCrmItem(item);
    const birth = getFieldValue(data, birthdayField) ?? data.BIRTHDATE ?? data.birthdate;
    if (isEmptyFieldValue(birth)) continue;

    let next = nextBirthdayDate(birth, year);
    if (!next) continue;
    let nextMs = next.getTime();
    // если день рождения в этом году уже прошёл относительно today — смотрим следующий год в пределах горизонта
    if (nextMs < todayUtc) {
      next = nextBirthdayDate(birth, year + 1);
      nextMs = next?.getTime();
    }
    if (nextMs == null) continue;
    const delta = nextMs - todayUtc;
    if (delta < 0 || delta > horizonMs) continue;

    upcoming.push({
      raw: item,
      data,
      birthdate: birth,
      nextBirthday: new Date(nextMs).toISOString().slice(0, 10),
      daysUntil: Math.round(delta / (24 * 60 * 60 * 1000)),
    });
  }

  const activitiesResult = await loadContactActivitiesSafe([
    "ID",
    "OWNER_ID",
    "SUBJECT",
    "DEADLINE",
    "COMPLETED",
  ]);
  if (!activitiesResult.ok) return activitiesResult.error;

  const birthdayActivitiesByContact = new Map();
  for (const activity of activitiesResult.items || []) {
    const data = unwrapCrmItem(activity);
    if (!matchesBirthdayPattern(data.SUBJECT || data.subject, patterns)) continue;
    const ownerId = String(data.OWNER_ID || data.ownerId || "");
    if (!ownerId) continue;
    if (!birthdayActivitiesByContact.has(ownerId)) birthdayActivitiesByContact.set(ownerId, []);
    birthdayActivitiesByContact.get(ownerId).push(data);
  }

  const now = Date.now();
  const missing = [];
  const overdue = [];
  const planned = [];

  for (const entry of upcoming) {
    const id = String(entry.data.ID || entry.data.id);
    const acts = birthdayActivitiesByContact.get(id) || [];
    if (!acts.length) {
      missing.push(entry);
      continue;
    }
    const hasFuture = acts.some((a) => {
      const deadline = a.DEADLINE || a.deadline;
      if (!deadline) return true;
      const ms = new Date(deadline).getTime();
      return Number.isNaN(ms) || ms >= now;
    });
    const hasOverdue = acts.some((a) => {
      const deadline = a.DEADLINE || a.deadline;
      if (!deadline) return false;
      const ms = new Date(deadline).getTime();
      return !Number.isNaN(ms) && ms < now;
    });
    if (hasFuture) planned.push(entry);
    else if (hasOverdue) overdue.push(entry);
    else missing.push(entry);
  }

  const toSample = async (list) => {
    const enriched = await enrichContactSamples(
      list.slice(0, sampleLimit()).map((e) => e.raw),
      {}
    );
    return enriched.map((row, idx) => ({
      ...row,
      birthdate: list[idx]?.birthdate || null,
      nextBirthday: list[idx]?.nextBirthday || null,
      daysUntil: list[idx]?.daysUntil ?? null,
    }));
  };

  const [missingSample, overdueSample, plannedSample] = await Promise.all([
    toSample(missing),
    toSample(overdue),
    toSample(planned),
  ]);

  logAnalytics({
    action: "contacts_birthday_activity_report",
    pages,
    contacts: contacts.length,
    items: upcoming.length,
    activityRequests: activitiesResult.pages || 1,
    durationMs: Date.now() - started,
    truncated,
    sample: missingSample.length + overdueSample.length,
  });

  return {
    entity: "contact",
    issue: "birthday_activity",
    daysAhead,
    year,
    detectionMethod: "activity_subject_pattern",
    patterns,
    note: "Поздравления определяются по названию CRM-дела (конфигурируемые шаблоны).",
    upcomingCount: upcoming.length,
    birthdayActivityMissing: missing.length,
    birthdayActivityOverdue: overdue.length,
    birthdayActivityPlanned: planned.length,
    missing: missingSample,
    overdue: overdueSample,
    planned: plannedSample,
    sampleLimit: PAGINATION.SAMPLE_LIMIT,
    truncated: Boolean(truncated) || upcoming.length > PAGINATION.SAMPLE_LIMIT,
    severity: "warning",
  };
}

/**
 * Единый сбор данных для contact quality (один обход контактов).
 * Публичный формат подотчётов не меняется — используется внутри quality/manager.
 */
export async function collectContactQualityDataset(params = {}) {
  const started = Date.now();
  const config = getContactMethodologyConfig();
  const statusField = config.statusField;
  const birthdayField = config.birthdayField || "BIRTHDATE";
  const cycleValues = new Set((config.statusCycleValues || []).map(String));
  const daysAhead = Number(params.daysAhead ?? 30);
  const year = Number(params.year || new Date().getFullYear());
  const patterns = config.birthdayActivityPatterns;

  let statusMap = new Map();
  if (statusField) {
    statusMap = (await getStatusEnumMap(statusField)).map;
  }

  const select = [
    "ID",
    "id",
    "NAME",
    "name",
    "SECOND_NAME",
    "secondName",
    "LAST_NAME",
    "lastName",
    "ASSIGNED_BY_ID",
    "assignedById",
    "COMPANY_ID",
    "companyId",
    "COMPANY_IDS",
    "companyIds",
    birthdayField,
  ];
  if (statusField) select.push(statusField);

  const filter = { ...(params.filter || {}) };
  if (params.responsibleId) filter.ASSIGNED_BY_ID = params.responsibleId;

  const { items, pages, truncated, total } = await contactListAll(
    { filter, select },
    { actionName: "collect_contact_quality_dataset" }
  );

  const withoutStatus = [];
  const withoutCompany = [];
  const withoutBirthday = [];
  const cycleContacts = [];
  const statusCounts = new Map();
  const byResponsible = new Map();

  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const horizonMs = daysAhead * 24 * 60 * 60 * 1000;
  const upcomingBirthdays = [];

  for (const item of items) {
    const data = unwrapCrmItem(item);
    const id = String(data.ID || data.id);
    const responsibleId = data.ASSIGNED_BY_ID ?? data.assignedById ?? null;
    const statusId = statusField ? normalizeStatusId(getFieldValue(data, statusField)) : null;

    const statusKey = statusId ?? "__empty__";
    statusCounts.set(statusKey, (statusCounts.get(statusKey) || 0) + 1);

    if (statusId == null && statusField) withoutStatus.push(item);

    const companyId = data.COMPANY_ID ?? data.companyId;
    const companyIds = data.COMPANY_IDS ?? data.companyIds;
    const hasSingle = companyId != null && String(companyId) !== "" && Number(companyId) !== 0;
    const hasMulti = Array.isArray(companyIds)
      ? companyIds.some((cid) => cid != null && String(cid) !== "" && Number(cid) !== 0)
      : !isEmptyFieldValue(companyIds);
    if (!hasSingle && !hasMulti) withoutCompany.push(item);

    const birth = getFieldValue(data, birthdayField) ?? data.BIRTHDATE ?? data.birthdate;
    if (isEmptyFieldValue(birth)) withoutBirthday.push(item);
    else {
      let next = nextBirthdayDate(birth, year);
      let nextMs = next?.getTime();
      if (nextMs != null && nextMs < todayUtc) {
        next = nextBirthdayDate(birth, year + 1);
        nextMs = next?.getTime();
      }
      if (nextMs != null) {
        const delta = nextMs - todayUtc;
        if (delta >= 0 && delta <= horizonMs) {
          upcomingBirthdays.push({
            raw: item,
            data,
            birthdate: birth,
            nextBirthday: new Date(nextMs).toISOString().slice(0, 10),
            daysUntil: Math.round(delta / (24 * 60 * 60 * 1000)),
          });
        }
      }
    }

    if (statusId && cycleValues.has(statusId)) cycleContacts.push(item);

    const rid = responsibleId != null ? String(responsibleId) : "0";
    if (!byResponsible.has(rid)) {
      byResponsible.set(rid, {
        total: 0,
        withoutStatus: 0,
        withoutCompany: 0,
        cycle: [],
      });
    }
    const bucket = byResponsible.get(rid);
    bucket.total += 1;
    if (statusId == null && statusField) bucket.withoutStatus += 1;
    if (!hasSingle && !hasMulti) bucket.withoutCompany += 1;
    if (statusId && cycleValues.has(statusId)) bucket.cycle.push(item);
  }

  // Activities: один bulk только для контактов (нужны цикл + дни рождения)
  let activityIndex = null;
  let activitiesError = null;
  const activityResult = await buildActivityIndex({
    ownerTypeIds: [OWNER_TYPE.contact],
  });
  if (!activityResult.ok) {
    activitiesError = activityResult.error;
  } else {
    activityIndex = activityResult;
  }

  const cycleWithout = [];
  const cycleOverdueOnly = [];
  for (const item of cycleContacts) {
    const data = unwrapCrmItem(item);
    const id = data.ID || data.id;
    if (!activityIndex) break;
    const cls = activityIndex.classifyOwner(OWNER_TYPE.contact, id);
    if (cls.withoutActivity) cycleWithout.push(item);
    else if (cls.withOverdueActivityOnly) cycleOverdueOnly.push(item);
  }

  const birthdayMissing = [];
  const birthdayOverdue = [];
  const birthdayPlanned = [];
  if (activityIndex) {
    const now = Date.now();
    for (const entry of upcomingBirthdays) {
      const id = entry.data.ID || entry.data.id;
      const acts = (activityIndex.byOwner.get(`${OWNER_TYPE.contact}:${id}`) || []).filter((a) =>
        matchesBirthdayPattern(a.subject, patterns)
      );
      if (!acts.length) {
        birthdayMissing.push(entry);
        continue;
      }
      const hasFuture = acts.some((a) => !a.isOverdue);
      const hasOverdue = acts.some((a) => a.isOverdue);
      if (hasFuture) birthdayPlanned.push(entry);
      else if (hasOverdue) birthdayOverdue.push(entry);
      else birthdayMissing.push(entry);
    }
  }

  // Cycle metrics per responsible
  for (const [rid, bucket] of byResponsible.entries()) {
    bucket.cycleWithoutNextActivity = 0;
    bucket.cycleWithOverdueActivityOnly = 0;
    if (!activityIndex) continue;
    for (const item of bucket.cycle) {
      const data = unwrapCrmItem(item);
      const cls = activityIndex.classifyOwner(OWNER_TYPE.contact, data.ID || data.id);
      if (cls.withoutActivity) bucket.cycleWithoutNextActivity += 1;
      else if (cls.withOverdueActivityOnly) bucket.cycleWithOverdueActivityOnly += 1;
    }
  }

  const truncMeta = buildTruncationMeta(truncated);

  logAnalytics({
    action: "collect_contact_quality_dataset",
    pages,
    items: items.length,
    activityRequests: activityIndex?.activityRequests || 0,
    durationMs: Date.now() - started,
    truncated,
    contactPasses: 1,
  });

  return {
    config,
    statusField,
    statusMap,
    birthdayField,
    items,
    total: total ?? items.length,
    pages,
    truncated: truncMeta.truncated,
    warning: truncMeta.warning,
    warnings: truncMeta.warnings || [],
    withoutStatus,
    withoutCompany,
    withoutBirthday,
    cycleContacts,
    cycleWithout,
    cycleOverdueOnly,
    statusCounts,
    byResponsible,
    upcomingBirthdays,
    birthdayMissing,
    birthdayOverdue,
    birthdayPlanned,
    activityIndex,
    activitiesError,
    activityRequests: activityIndex?.activityRequests || 0,
    contactPasses: 1,
    daysAhead,
    patterns,
  };
}

/** Сводный отчёт качества контактов (один обход контактов). */
export async function contact_quality_report(params = {}) {
  const started = Date.now();
  const dataset = await collectContactQualityDataset(params);
  const config = dataset.config;

  const [withoutStatusSample, withoutCompanySample, withoutBirthdaySample, cycleWithoutSample, cycleOverdueSample] =
    await Promise.all([
      enrichContactSamples(dataset.withoutStatus.slice(0, sampleLimit()), {
        statusField: dataset.statusField,
        statusMap: dataset.statusMap,
      }),
      enrichContactSamples(dataset.withoutCompany.slice(0, sampleLimit()), {
        statusField: dataset.statusField,
        statusMap: dataset.statusMap,
      }),
      enrichContactSamples(dataset.withoutBirthday.slice(0, sampleLimit()), {
        statusField: dataset.statusField,
        statusMap: dataset.statusMap,
      }),
      enrichContactSamples(dataset.cycleWithout.slice(0, sampleLimit()), {
        statusField: dataset.statusField,
        statusMap: dataset.statusMap,
      }),
      enrichContactSamples(dataset.cycleOverdueOnly.slice(0, sampleLimit()), {
        statusField: dataset.statusField,
        statusMap: dataset.statusMap,
      }),
    ]);

  const summary = {
    totalContacts: dataset.total,
    withoutStatus: config.statusField ? dataset.withoutStatus.length : null,
    withoutCompany: dataset.withoutCompany.length,
    withoutBirthday: dataset.withoutBirthday.length,
    cycleWithoutActivity: dataset.activitiesError ? null : dataset.cycleWithout.length,
    cycleWithOverdueActivityOnly: dataset.activitiesError ? null : dataset.cycleOverdueOnly.length,
    birthdayActivityMissing: dataset.activitiesError ? null : dataset.birthdayMissing.length,
    birthdayActivityOverdue: dataset.activitiesError ? null : dataset.birthdayOverdue.length,
  };

  const issues = [];
  if (!config.statusField) {
    issues.push({
      code: "CONTACT_STATUS_FIELD_NOT_CONFIGURED",
      title: "Не настроено пользовательское поле статуса контакта.",
      count: null,
      severity: "critical",
    });
  } else if (summary.withoutStatus > 0) {
    issues.push({
      code: "CONTACT_WITHOUT_STATUS",
      title: "Контакты без статуса",
      count: summary.withoutStatus,
      severity: "critical",
    });
  }

  if (summary.withoutCompany > 0) {
    issues.push({
      code: "CONTACT_WITHOUT_COMPANY",
      title: "Контакты без компании",
      count: summary.withoutCompany,
      severity: "warning",
    });
  }
  if (summary.withoutBirthday > 0) {
    issues.push({
      code: "CONTACT_WITHOUT_BIRTHDAY",
      title: "Контакты без даты рождения",
      count: summary.withoutBirthday,
      severity: "warning",
    });
  }

  if (dataset.activitiesError) {
    issues.push({
      code: "CRM_ACTIVITIES_ACCESS_DENIED",
      title: dataset.activitiesError.error?.message || "Нет доступа к CRM-делам",
      count: null,
      severity: "critical",
    });
  } else {
    if (summary.cycleWithoutActivity > 0) {
      issues.push({
        code: "CONTACT_CYCLE_WITHOUT_ACTIVITY",
        title: "Контакты в «Цикле» без следующего дела",
        count: summary.cycleWithoutActivity,
        severity: "critical",
      });
    }
    if (summary.cycleWithOverdueActivityOnly > 0) {
      issues.push({
        code: "CONTACT_CYCLE_OVERDUE_ACTIVITY_ONLY",
        title: "Контакты в «Цикле» только с просроченным делом",
        count: summary.cycleWithOverdueActivityOnly,
        severity: "critical",
      });
    }
    if (summary.birthdayActivityMissing > 0) {
      issues.push({
        code: "BIRTHDAY_ACTIVITY_MISSING",
        title: "Нет дела на ближайшее поздравление",
        count: summary.birthdayActivityMissing,
        severity: "warning",
      });
    }
    if (summary.birthdayActivityOverdue > 0) {
      issues.push({
        code: "BIRTHDAY_ACTIVITY_OVERDUE",
        title: "Просроченное поздравление",
        count: summary.birthdayActivityOverdue,
        severity: "critical",
      });
    }
  }

  const recommendations = [];
  if (summary.withoutStatus > 0) {
    recommendations.push(
      `Заполнить статус у ${summary.withoutStatus} контактов — без статуса невозможно управлять методологией.`
    );
  }
  if (summary.cycleWithoutActivity > 0) {
    recommendations.push(
      `Назначить следующее CRM-дело для ${summary.cycleWithoutActivity} контактов в статусе «Цикл».`
    );
  }
  if (summary.cycleWithOverdueActivityOnly > 0) {
    recommendations.push(
      `Обновить или закрыть просроченные дела у ${summary.cycleWithOverdueActivityOnly} контактов в «Цикле» и поставить актуальный следующий шаг.`
    );
  }
  if (summary.withoutCompany > 0) {
    recommendations.push(
      `Привязать компанию к ${summary.withoutCompany} контактам для корректной B2B-связки.`
    );
  }
  if (summary.withoutBirthday > 0) {
    recommendations.push(
      `По возможности заполнить дату рождения у ${summary.withoutBirthday} контактов (качество данных, не блокер).`
    );
  }
  if (summary.birthdayActivityMissing > 0) {
    recommendations.push(
      `Создать дела на поздравление для ${summary.birthdayActivityMissing} контактов с ближайшим днём рождения.`
    );
  }
  if (summary.birthdayActivityOverdue > 0) {
    recommendations.push(
      `Закрыть или перенести ${summary.birthdayActivityOverdue} просроченных поздравлений.`
    );
  }
  if (!config.statusField) {
    recommendations.push(
      "Запустите contact_field_audit и укажите BITRIX_CONTACT_STATUS_FIELD в .env."
    );
  }
  if (dataset.truncated) {
    recommendations.push(dataset.warning);
  }
  if (!recommendations.length) {
    recommendations.push("Критических нарушений не найдено. Продолжайте регулярный контроль качества.");
  }

  logAnalytics({
    action: "contact_quality_report",
    pages: dataset.pages,
    contacts: summary.totalContacts,
    activityRequests: dataset.activityRequests,
    durationMs: Date.now() - started,
    truncated: dataset.truncated,
    sample: PAGINATION.SAMPLE_LIMIT,
    contactPasses: 1,
  });

  return {
    reportType: "contact_quality",
    summary,
    issues,
    recommendations,
    truncated: dataset.truncated,
    warning: dataset.warning,
    warnings: dataset.warnings || [],
    diagnostics: {
      activityStrategy: "bulk",
      activityRequests: dataset.activityRequests,
      entitiesChecked: dataset.items.length,
      contactPasses: 1,
    },
    samples: {
      withoutStatus: withoutStatusSample,
      withoutCompany: withoutCompanySample,
      withoutBirthday: withoutBirthdaySample,
      cycleWithoutActivity: cycleWithoutSample,
      cycleWithOverdueActivityOnly: cycleOverdueSample,
    },
    config: {
      statusField: config.statusField,
      birthdayField: config.birthdayField,
      cycleValuesConfigured: config.statusCycleValues.length > 0,
    },
  };
}
