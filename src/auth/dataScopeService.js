/**
 * Data scope for CRM entities (own vs all).
 */

import { AuthError } from "./config.js";
import { hasPermission } from "./authorizationService.js";
import { callReadMethod } from "../bitrixClient.js";
import { ENTITY_TYPE, unwrapCrmItem } from "../actions/helpers.js";

const ENTITY_TYPE_IDS = {
  lead: ENTITY_TYPE.LEAD,
  deal: ENTITY_TYPE.DEAL,
  contact: ENTITY_TYPE.CONTACT,
  company: ENTITY_TYPE.COMPANY,
};

export function userHasFullCrmRead(user) {
  return Boolean(user && hasPermission(user, "crm.read.all"));
}

export function requireBitrixMapping(user) {
  if (!user?.bitrixUserId) {
    throw new AuthError(
      "BITRIX_USER_MAPPING_REQUIRED",
      "Для пользователя не настроена связь с сотрудником Bitrix24."
    );
  }
  return String(user.bitrixUserId);
}

/**
 * Force list filter for own scope. Mutates and returns filter.
 */
export function applyEntityListScope({ user, entityType, filter = {} }) {
  if (!user || user.isLocalOnlySynthetic || userHasFullCrmRead(user) || user.dataScope === "all") {
    return { ...(filter || {}), __scopeApplied: "all" };
  }
  const bitrixUserId = requireBitrixMapping(user);
  const next = { ...(filter || {}) };

  // Strip any attempt to override assignee via client filter aliases
  const banned = [
    "ASSIGNED_BY_ID",
    "assignedById",
    "responsibleId",
    "RESPONSIBLE_ID",
    "!ASSIGNED_BY_ID",
    ">=ASSIGNED_BY_ID",
  ];
  for (const key of Object.keys(next)) {
    if (banned.includes(key) || /ASSIGNED_BY_ID/i.test(key)) {
      delete next[key];
    }
  }
  next.ASSIGNED_BY_ID = bitrixUserId;
  next.__scopeApplied = "own";
  next.__scopedBitrixUserId = bitrixUserId;
  return next;
}

export function restrictResponsibleIds({ user, responsibleIds }) {
  if (!user || user.isLocalOnlySynthetic || userHasFullCrmRead(user) || user.dataScope === "all") {
    return responsibleIds || null;
  }
  const bitrixUserId = requireBitrixMapping(user);
  if (!responsibleIds || (Array.isArray(responsibleIds) && responsibleIds.length === 0)) {
    return [bitrixUserId];
  }
  const list = Array.isArray(responsibleIds) ? responsibleIds.map(String) : [String(responsibleIds)];
  if (list.some((id) => id !== bitrixUserId)) {
    throw new AuthError("RESOURCE_ACCESS_DENIED", "Нельзя запрашивать данные другого ответственного.");
  }
  return [bitrixUserId];
}

async function fetchEntityAssignee(entityType, entityId) {
  const type = String(entityType || "").toLowerCase();
  const id = Number(entityId);
  if (!type || !id) return null;
  try {
    if (type === "task") {
      const raw = await callReadMethod("tasks.task.get", {
        taskId: id,
        select: ["ID", "RESPONSIBLE_ID", "CREATED_BY"],
      });
      const task = raw?.task || raw?.result?.task || raw;
      return {
        assignedById: task?.responsibleId || task?.RESPONSIBLE_ID || null,
        exists: Boolean(task?.id || task?.ID),
      };
    }
    const entityTypeId = ENTITY_TYPE_IDS[type];
    if (!entityTypeId) return null;
    const raw = await callReadMethod("crm.item.get", {
      entityTypeId,
      id,
      select: ["id", "assignedById", "ASSIGNED_BY_ID"],
    });
    const item = unwrapCrmItem(raw) || raw;
    return {
      assignedById: item?.assignedById ?? item?.ASSIGNED_BY_ID ?? null,
      exists: Boolean(item?.id || item?.ID),
    };
  } catch {
    return { assignedById: null, exists: false };
  }
}

export async function authorizeEntityRead({ user, entityType, entityId }) {
  if (!user || user.isLocalOnlySynthetic || userHasFullCrmRead(user) || user.dataScope === "all") {
    return { ok: true, scope: "all" };
  }
  if (!hasPermission(user, "crm.read.own") && !hasPermission(user, "crm.context.read")) {
    throw new AuthError("PERMISSION_DENIED", "Нет доступа к CRM.");
  }
  const bitrixUserId = requireBitrixMapping(user);
  const meta = await fetchEntityAssignee(entityType, entityId);
  if (!meta?.exists) {
    throw new AuthError("RESOURCE_ACCESS_DENIED", "У пользователя нет доступа к этой CRM-сущности.");
  }
  if (String(meta.assignedById) !== String(bitrixUserId)) {
    throw new AuthError("RESOURCE_ACCESS_DENIED", "У пользователя нет доступа к этой CRM-сущности.");
  }
  return { ok: true, scope: "own", bitrixUserId };
}

export async function authorizeEntityWrite({ user, entityType, entityId }) {
  return authorizeEntityRead({ user, entityType, entityId });
}

/** Map action name → entity type for get-by-id */
export const DIRECT_GET_ACTIONS = {
  deal_get: "deal",
  lead_get: "lead",
  contact_get: "contact",
  company_get: "company",
  task_get: "task",
};

export const LIST_SCOPE_ACTIONS = new Set([
  "deal_list",
  "lead_list",
  "contact_list",
  "company_list",
  "deals_by_stage",
  "deal_count_by_stage",
  "leads_by_status",
  "stale_leads_report",
  "stale_deals_report",
  "overdue_activities_by_manager",
  "crm_discipline_report",
  "manager_workload",
  "contact_quality_report",
  "contacts_without_deals_report",
  "contacts_in_cycle_without_next_activity",
  "birthday_contacts_report",
]);

export const BLOCKED_FOR_OWN_ANALYTICS = new Set([
  // portal-wide aggregates that cannot be safely reduced without misleading numbers
]);

/**
 * Apply scope to action params before handler.
 */
export async function applyActionDataScope(actionName, params, user) {
  if (!user || user.isLocalOnlySynthetic) {
    return { params, scopeMeta: { type: "all" } };
  }

  if (DIRECT_GET_ACTIONS[actionName]) {
    await authorizeEntityRead({
      user,
      entityType: DIRECT_GET_ACTIONS[actionName],
      entityId: params.id || params.taskId || params.entityId,
    });
    return {
      params,
      scopeMeta: { type: user.dataScope === "own" ? "own" : "all", bitrixUserId: user.bitrixUserId },
    };
  }

  if (actionName === "crm_context_get" || actionName === "crm_context_summary") {
    await authorizeEntityRead({
      user,
      entityType: params.entityType,
      entityId: params.entityId,
    });
    return {
      params,
      scopeMeta: { type: user.dataScope === "own" ? "own" : "all", bitrixUserId: user.bitrixUserId },
    };
  }

  if (LIST_SCOPE_ACTIONS.has(actionName) || /_report$|_list$|workload|discipline|overdue/.test(actionName)) {
    if (user.dataScope === "own" && !userHasFullCrmRead(user)) {
      const bitrixUserId = requireBitrixMapping(user);
      const next = { ...params };
      if (next.filter && typeof next.filter === "object") {
        next.filter = applyEntityListScope({ user, entityType: actionName, filter: next.filter });
      } else {
        next.filter = applyEntityListScope({ user, entityType: actionName, filter: {} });
      }
      next.responsibleIds = restrictResponsibleIds({
        user,
        responsibleIds: next.responsibleIds || next.managerIds || next.assignedByIds,
      });
      delete next.managerIds;
      delete next.assignedByIds;
      if (next.responsibleId && String(next.responsibleId) !== String(bitrixUserId)) {
        throw new AuthError("RESOURCE_ACCESS_DENIED", "Нельзя запрашивать данные другого ответственного.");
      }
      next.responsibleId = bitrixUserId;
      next.assignedById = bitrixUserId;
      return {
        params: next,
        scopeMeta: { type: "own", bitrixUserId },
      };
    }
  }

  return {
    params,
    scopeMeta: { type: userHasFullCrmRead(user) || user.dataScope === "all" ? "all" : "own" },
  };
}
