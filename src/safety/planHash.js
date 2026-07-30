import crypto from "crypto";
import { redactObject } from "./redact.js";

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/**
 * Служебные ключи (__execPlan, __initiatedBy, __rollbackOf) в хеш не входят:
 * они добавляются к params после построения плана и различаются между
 * prepare и commit.
 */
export function stripInternalParams(params) {
  if (!params || typeof params !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    if (key.startsWith("__")) continue;
    out[key] = value;
  }
  return out;
}

/**
 * JSON-нормализация: prepare хеширует объекты в памяти, commit — те же данные
 * после SQLite. Без нормализации undefined/Date дают разный хеш.
 */
function normalizeForHash(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return value ?? null;
  }
}

/**
 * Список entityIds операции. Одинаково считается на prepare и commit.
 */
export function planEntityIds({ before = null, items = [] } = {}) {
  if (before?.entityId != null) return [String(before.entityId)];
  if (Array.isArray(before?.items)) {
    return before.items.map((i) => i.entityId).filter(Boolean).map(String);
  }
  return (items || []).map((i) => i.entityId).filter(Boolean).map(String);
}

/**
 * SHA-256 plan hash из нормализованных данных операции.
 */
export function computePlanHash({
  action,
  params,
  entityIds = [],
  before = null,
  after = null,
  affectedCount = 0,
}) {
  const payload = normalizeForHash({
    action,
    params: redactObject(stripInternalParams(params)),
    entityIds: [...entityIds].map(String).sort(),
    before: redactObject(before),
    after: redactObject(after),
    affectedCount: Number(affectedCount) || 0,
  });

  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function verifyPlanHash(operation) {
  const expected = computePlanHash({
    action: operation.action,
    params: operation.params,
    entityIds: extractEntityIds(operation),
    before: operation.before,
    after: operation.after,
    affectedCount: operation.before?.items?.length || operation.after?.items?.length || operation.preview?.affectedCount || 0,
  });
  return expected === operation.planHash;
}

function extractEntityIds(operation) {
  if (Array.isArray(operation.before?.items)) {
    return operation.before.items.map((i) => i.entityId ?? i.id).filter((v) => v != null);
  }
  if (operation.before?.entityId != null) return [operation.before.entityId];
  if (operation.params?.id != null) return [operation.params.id];
  return [];
}
