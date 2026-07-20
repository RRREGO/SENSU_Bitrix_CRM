/**
 * Allowlists полей CRM для Client Context (без телефонов/email/ИИН).
 */

const COMMON_STRIP = new Set([
  "PHONE",
  "EMAIL",
  "WEB",
  "IM",
  "LINK",
  "ADDRESS",
  "ADDRESS_2",
  "ADDRESS_CITY",
  "ADDRESS_POSTAL_CODE",
  "ADDRESS_REGION",
  "ADDRESS_PROVINCE",
  "ADDRESS_COUNTRY",
  "ADDRESS_COUNTRY_CODE",
  "BANKING_DETAILS",
  "UQ",
  "FACE_ID",
]);

export const CONTACT_ALLOW = [
  "ID",
  "NAME",
  "LAST_NAME",
  "SECOND_NAME",
  "FULL_NAME",
  "COMPANY_ID",
  "ASSIGNED_BY_ID",
  "TYPE_ID",
  "SOURCE_ID",
  "SOURCE_DESCRIPTION",
  "BIRTHDATE",
  "DATE_CREATE",
  "DATE_MODIFY",
  "POST",
];

export const LEAD_ALLOW = [
  "ID",
  "TITLE",
  "STATUS_ID",
  "STATUS_SEMANTIC_ID",
  "ASSIGNED_BY_ID",
  "CONTACT_ID",
  "COMPANY_ID",
  "SOURCE_ID",
  "SOURCE_DESCRIPTION",
  "OPPORTUNITY",
  "CURRENCY_ID",
  "DATE_CREATE",
  "DATE_MODIFY",
  "COMMENTS",
];

export const DEAL_ALLOW = [
  "ID",
  "TITLE",
  "STAGE_ID",
  "CATEGORY_ID",
  "OPPORTUNITY",
  "CURRENCY_ID",
  "ASSIGNED_BY_ID",
  "CONTACT_ID",
  "COMPANY_ID",
  "BEGINDATE",
  "CLOSEDATE",
  "DATE_CREATE",
  "DATE_MODIFY",
  "COMMENTS",
  "PROBABILITY",
];

export const COMPANY_ALLOW = [
  "ID",
  "TITLE",
  "ASSIGNED_BY_ID",
  "INDUSTRY",
  "EMPLOYEES",
  "DATE_CREATE",
  "DATE_MODIFY",
  "COMMENTS",
];

function pickAllowed(raw, allow, extraUf = []) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  const allowSet = new Set([...allow, ...extraUf]);
  for (const [key, value] of Object.entries(raw)) {
    if (COMMON_STRIP.has(key)) continue;
    if (/PHONE|EMAIL|PASSWORD|TOKEN|INN|ИИН|BANK/i.test(key)) continue;
    if (allowSet.has(key) || (extraUf.length && extraUf.includes(key))) {
      out[key] = value;
    }
  }
  // Also map camelCase from crm.item.*
  for (const key of allow) {
    const camel = key
      .toLowerCase()
      .replace(/_([a-z])/g, (_, c) => c.toUpperCase())
      .replace(/^./, (c) => c.toLowerCase());
    // bitrix item uses camelCase like assignedById
    const variants = {
      ASSIGNED_BY_ID: ["assignedById", "ASSIGNED_BY_ID"],
      DATE_CREATE: ["createdTime", "dateCreate", "DATE_CREATE"],
      DATE_MODIFY: ["updatedTime", "dateModify", "DATE_MODIFY"],
      STAGE_ID: ["stageId", "STAGE_ID"],
      STATUS_ID: ["statusId", "STATUS_ID"],
      CATEGORY_ID: ["categoryId", "CATEGORY_ID"],
      COMPANY_ID: ["companyId", "COMPANY_ID"],
      CONTACT_ID: ["contactId", "CONTACT_ID"],
      OPPORTUNITY: ["opportunity", "OPPORTUNITY"],
      CURRENCY_ID: ["currencyId", "CURRENCY_ID"],
      TITLE: ["title", "TITLE"],
      NAME: ["name", "NAME"],
      LAST_NAME: ["lastName", "LAST_NAME"],
      SECOND_NAME: ["secondName", "SECOND_NAME"],
      BIRTHDATE: ["birthdate", "BIRTHDATE"],
      SOURCE_ID: ["sourceId", "SOURCE_ID"],
      ID: ["id", "ID"],
    };
    const keys = variants[key] || [key];
    for (const k of keys) {
      if (raw[k] != null && out[key] == null) out[key] = raw[k];
    }
  }
  return out;
}

export function normalizeContactFields(raw, extraUf = []) {
  return pickAllowed(raw, CONTACT_ALLOW, extraUf);
}

export function normalizeLeadFields(raw, extraUf = []) {
  return pickAllowed(raw, LEAD_ALLOW, extraUf);
}

export function normalizeDealFields(raw, extraUf = []) {
  return pickAllowed(raw, DEAL_ALLOW, extraUf);
}

export function normalizeCompanyFields(raw, extraUf = []) {
  return pickAllowed(raw, COMPANY_ALLOW, extraUf);
}

export function displayNameFromContact(fields = {}) {
  const full =
    fields.FULL_NAME ||
    [fields.LAST_NAME, fields.NAME, fields.SECOND_NAME].filter(Boolean).join(" ").trim();
  return full || fields.NAME || fields.TITLE || null;
}

export function getField(obj, ...keys) {
  if (!obj) return null;
  for (const key of keys) {
    if (obj[key] != null && obj[key] !== "") return obj[key];
  }
  return null;
}
