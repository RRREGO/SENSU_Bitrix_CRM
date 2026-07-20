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
  const payload = {
    action,
    params: redactObject(params || {}),
    entityIds: [...entityIds].map(String).sort(),
    before: redactObject(before),
    after: redactObject(after),
    affectedCount: Number(affectedCount) || 0,
  };

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
