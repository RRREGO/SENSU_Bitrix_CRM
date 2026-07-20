/**
 * Post-write read-back verification for Bitrix actions.
 */

import { callReadMethod } from "../bitrixClient.js";
import { redactObject } from "../safety/redact.js";

function getField(obj, ...keys) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
    const upper = String(key).toUpperCase();
    if (obj[upper] !== undefined && obj[upper] !== null && obj[upper] !== "") return obj[upper];
  }
  return undefined;
}

async function fetchEntity(entityType, entityId) {
  const id = Number(entityId);
  if (!id) return null;
  if (entityType === "deal") {
    try {
      return await callReadMethod("crm.item.get", { entityTypeId: 2, id });
    } catch {
      return callReadMethod("crm.deal.get", { id });
    }
  }
  if (entityType === "lead") {
    try {
      return await callReadMethod("crm.item.get", { entityTypeId: 1, id });
    } catch {
      return callReadMethod("crm.lead.get", { id });
    }
  }
  if (entityType === "contact") {
    try {
      return await callReadMethod("crm.item.get", { entityTypeId: 3, id });
    } catch {
      return callReadMethod("crm.contact.get", { id });
    }
  }
  if (entityType === "company") {
    try {
      return await callReadMethod("crm.item.get", { entityTypeId: 4, id });
    } catch {
      return callReadMethod("crm.company.get", { id });
    }
  }
  if (entityType === "task") {
    const res = await callReadMethod("tasks.task.get", { id });
    return res?.task || res;
  }
  if (entityType === "activity") {
    return callReadMethod("crm.activity.get", { id });
  }
  return null;
}

function expectedFieldsFromPlan(execPlan, afterSnapshot) {
  if (execPlan?.fields && typeof execPlan.fields === "object") return execPlan.fields;
  if (afterSnapshot && typeof afterSnapshot === "object") return afterSnapshot;
  return null;
}

/**
 * Verify write outcome when possible.
 * @returns {{ verified: boolean, verificationMethod?: string, verificationRequired?: boolean, observed?: object, mismatch?: string[] }}
 */
export async function verifyWriteResult({ execPlan, result, afterExpected = null }) {
  try {
    const kind = execPlan?.kind;
    let entityType = execPlan?.entityType || null;
    let entityId = execPlan?.entityId || result?.id || result?.ID || result?.result || null;

    if (kind === "entity_create" || kind === "create") {
      entityId = result?.id || result?.ID || result?.result || entityId;
    }

    if (!entityType || !entityId) {
      return { verified: false, verificationRequired: true };
    }

    const current = await fetchEntity(entityType, entityId);
    if (!current) {
      return { verified: false, verificationRequired: true };
    }

    const expected = expectedFieldsFromPlan(execPlan, afterExpected);
    const mismatches = [];

    if (expected && typeof expected === "object") {
      for (const [key, value] of Object.entries(expected)) {
        if (value == null || key.startsWith("__")) continue;
        const observed = getField(current, key);
        if (observed == null) continue;
        if (String(observed) !== String(value)) {
          mismatches.push(key);
        }
      }
    }

    if (mismatches.length) {
      return {
        verified: false,
        verificationRequired: true,
        verificationMethod: "read_back",
        mismatch: mismatches,
        observed: redactObject({
          STAGE_ID: getField(current, "STAGE_ID", "stageId"),
          CATEGORY_ID: getField(current, "CATEGORY_ID", "categoryId"),
          ASSIGNED_BY_ID: getField(current, "ASSIGNED_BY_ID", "assignedById"),
          STATUS_ID: getField(current, "STATUS_ID", "statusId"),
        }),
      };
    }

    return {
      verified: true,
      verificationMethod: "read_back",
      observed: redactObject({
        id: entityId,
        STAGE_ID: getField(current, "STAGE_ID", "stageId"),
        CATEGORY_ID: getField(current, "CATEGORY_ID", "categoryId"),
        ASSIGNED_BY_ID: getField(current, "ASSIGNED_BY_ID", "assignedById"),
      }),
    };
  } catch {
    return { verified: false, verificationRequired: true };
  }
}
