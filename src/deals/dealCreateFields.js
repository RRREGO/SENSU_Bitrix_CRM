import { hasPresentValue, isNil } from "../actions/helpers.js";

export function buildDealCreateFields(params, { categoryId, stageId, assignedById }) {
  const fields = { ...(params.fields || {}) };
  if (params.title) fields.TITLE = params.title;
  if (!isNil(categoryId)) fields.CATEGORY_ID = categoryId;
  if (hasPresentValue(stageId)) fields.STAGE_ID = String(stageId);
  if (!isNil(assignedById)) fields.ASSIGNED_BY_ID = Number(assignedById);
  if (params.opportunity !== undefined) fields.OPPORTUNITY = params.opportunity;
  if (params.currencyId) fields.CURRENCY_ID = params.currencyId;
  if (!isNil(params.contactId)) fields.CONTACT_ID = params.contactId;
  if (!isNil(params.companyId)) fields.COMPANY_ID = params.companyId;
  mergeDealFieldValues(fields, params.extraFields);
  return fields;
}

function fieldMetaLabel(meta, code) {
  if (!meta || typeof meta !== "object") return code;
  return (
    meta.formLabel ||
    meta.listLabel ||
    meta.title ||
    meta.TITLE ||
    meta.LABEL ||
    code
  );
}

function isRequiredField(meta) {
  return meta?.isRequired === true || meta?.IS_REQUIRED === "Y" || meta?.isRequired === "Y";
}

function isReadOnlyField(meta) {
  return meta?.isReadOnly === true || meta?.IS_READ_ONLY === "Y" || meta?.isReadOnly === "Y";
}

/** Поля сделки, обязательные и доступные для записи (crm.deal.fields). */
export function listRequiredWritableDealFields(fieldsMeta) {
  const root = fieldsMeta?.fields && typeof fieldsMeta.fields === "object" ? fieldsMeta.fields : fieldsMeta;
  if (!root || typeof root !== "object") return [];

  const required = [];
  for (const [code, meta] of Object.entries(root)) {
    if (!meta || typeof meta !== "object") continue;
    if (!isRequiredField(meta) || isReadOnlyField(meta)) continue;
    required.push({
      code,
      label: fieldMetaLabel(meta, code),
      type: meta.type || meta.TYPE || "string",
      items: meta.items || meta.ITEMS || null,
      isMultiple: Boolean(meta.isMultiple || meta.MULTIPLE === "Y"),
    });
  }
  return required;
}

function valuePresentForField(value, field) {
  if (isNil(value)) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "integer" || field.type === "double") {
    return Number.isFinite(Number(value));
  }
  return true;
}

/**
 * @returns {{ ok: true } | { ok: false, missing: Array<{ code, label, type }> }}
 */
export function validateDealRequiredFields(fields, requiredMeta) {
  const missing = [];
  for (const field of requiredMeta) {
    const value = fields[field.code] ?? fields[field.code.toUpperCase()];
    if (!valuePresentForField(value, field)) {
      missing.push({ code: field.code, label: field.label, type: field.type });
    }
  }
  if (missing.length) return { ok: false, missing };
  return { ok: true };
}

export function mergeDealFieldValues(target, source) {
  if (!source || typeof source !== "object") return target;
  for (const [key, value] of Object.entries(source)) {
    if (hasPresentValue(value)) target[key] = value;
  }
  return target;
}
