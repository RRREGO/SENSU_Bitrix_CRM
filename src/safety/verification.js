/**
 * Post-write read-back verification for Bitrix actions.
 */

import { callReadMethod } from "../bitrixClient.js";
import { redactObject } from "../safety/redact.js";

/** UPPER_SNAKE → camelCase: задачи и crm.item.* отдают поля в camelCase. */
function toCamelCase(key) {
  return String(key)
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
}

function getField(obj, ...keys) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const key of keys) {
    for (const variant of [key, String(key).toUpperCase(), toCamelCase(key)]) {
      const value = obj[variant];
      if (value !== undefined && value !== null && value !== "") return value;
    }
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
    const entityType = execPlan?.entityType || null;
    const entityId =
      execPlan?.entityId ||
      result?.createdId ||
      result?.id ||
      result?.ID ||
      result?.task?.id ||
      result?.item?.id ||
      result?.result ||
      null;

    if (!entityType || !entityId) {
      return { verified: false, verificationRequired: true };
    }

    if (execPlan?.expectDeleted) {
      // Ошибка чтения после удаления = сущности больше нет.
      let existing = null;
      try {
        existing = await fetchEntity(entityType, entityId);
      } catch {
        existing = null;
      }
      if (existing?.id || existing?.ID) {
        return {
          verified: false,
          verificationRequired: true,
          verificationMethod: "read_back",
          mismatch: ["deleted"],
        };
      }
      return {
        verified: true,
        verificationMethod: "read_back",
        observed: { id: String(entityId), deleted: true },
      };
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
