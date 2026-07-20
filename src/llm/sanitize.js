/**
 * Минимизация данных перед отправкой в LLM.
 */

import { redactObject } from "../safety/redact.js";

const ALLOWLISTS = {
  analytics: [
    "total",
    "count",
    "groups",
    "truncated",
    "partial",
    "warnings",
    "byStage",
    "byStatus",
    "managers",
    "summary",
    "pages",
    "returned",
    "hasMore",
    "qualityScore",
    "issues",
  ],
  entity_summary: [
    "ID",
    "id",
    "TITLE",
    "title",
    "NAME",
    "name",
    "LAST_NAME",
    "lastName",
    "SECOND_NAME",
    "secondName",
    "FULL_NAME",
    "fullName",
    "STAGE_ID",
    "stageId",
    "STATUS_ID",
    "statusId",
    "CATEGORY_ID",
    "categoryId",
    "OPPORTUNITY",
    "opportunity",
    "CURRENCY_ID",
    "currencyId",
    "ASSIGNED_BY_ID",
    "assignedById",
    "COMPANY_ID",
    "companyId",
    "CONTACT_ID",
    "contactId",
    "SOURCE_ID",
    "sourceId",
    "DATE_CREATE",
    "dateCreate",
    "DATE_MODIFY",
    "dateModify",
    "createdTime",
    "updatedTime",
    "type",
    "stage",
    "responsible",
    "relations",
    "state",
    "timeline",
    "warnings",
    "entity",
  ],
  meeting_protocol: [
    "title",
    "date",
    "participants",
    "decisions",
    "nextSteps",
    "summary",
    "client",
    "company",
    "agreements",
    "risks",
    "openQuestions",
    "basedOn",
    "warnings",
  ],
  message_draft: [
    "toName",
    "channel",
    "subject",
    "draftText",
    "tone",
    "recipient",
    "body",
    "basedOn",
    "warnings",
    "purpose",
  ],
  operation_result: [
    "success",
    "status",
    "action",
    "operationId",
    "confirmationId",
    "verified",
    "verificationRequired",
    "message",
  ],
};

const STRIP_KEYS = new Set([
  "PHONE",
  "EMAIL",
  "phones",
  "emails",
  "UF_CRM_PHONE",
  "WEBHOOK",
  "webhook",
  "executionToken",
  "execution_token",
  "OPENLINE",
  "IM",
]);

function pick(obj, allowed) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  const out = {};
  for (const key of allowed) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

function stripSensitive(value, depth = 0) {
  if (depth > 6) return null;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => stripSensitive(v, depth + 1));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (STRIP_KEYS.has(k) || /PHONE|EMAIL|PASSWORD|TOKEN|WEBHOOK|SECRET/i.test(k)) continue;
    out[k] = stripSensitive(v, depth + 1);
  }
  return out;
}

/**
 * @param {any} payload
 * @param {"analytics"|"entity_summary"|"meeting_protocol"|"message_draft"|"operation_result"|"generic"} purpose
 */
export function sanitizeLlmPayload(payload, purpose = "generic") {
  const redacted = redactObject(payload);
  const cleaned = stripSensitive(redacted);
  const allow = ALLOWLISTS[purpose];
  if (!allow) return cleaned;

  if (Array.isArray(cleaned)) {
    return cleaned.slice(0, 30).map((item) => (item && typeof item === "object" ? pick(item, allow) : item));
  }
  if (cleaned && typeof cleaned === "object") {
    const base = pick(cleaned, allow);
    // keep nested summary-ish keys if present
    for (const key of Object.keys(cleaned)) {
      if (allow.includes(key)) continue;
      if (["items", "sample", "rows", "managers"].includes(key) && Array.isArray(cleaned[key])) {
        base[key] = cleaned[key]
          .slice(0, 20)
          .map((row) => (row && typeof row === "object" ? pick(row, ALLOWLISTS.entity_summary) : row));
      }
    }
    return base;
  }
  return cleaned;
}
