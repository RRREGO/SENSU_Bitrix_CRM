/**
 * crm_context_get — нормализованный клиентский контекст.
 */

import { callReadMethod } from "../bitrixClient.js";
import {
  ENTITY_TYPE,
  unwrapCrmItem,
  buildCrmEntityUrl,
  fetchAllPages,
  applyListLimit,
} from "../actions/helpers.js";
import { timeline_comment_list } from "../actions/timelineActions.js";
import { getContactMethodologyConfig } from "../config/contactMethodology.js";
import { getClientContextConfig, ClientContextError } from "./config.js";
import {
  getCachedClientContext,
  setCachedClientContext,
} from "./cache.js";
import {
  normalizeContactFields,
  normalizeLeadFields,
  normalizeDealFields,
  normalizeCompanyFields,
  displayNameFromContact,
  getField,
} from "./fieldAllowlists.js";
import { buildClientTimeline } from "./timeline.js";
import { sanitizeLlmPayload } from "../llm/sanitize.js";

const OWNER_TYPE = { lead: 1, deal: 2, contact: 3, company: 4 };

function normalizeEntityType(raw) {
  const t = String(raw || "").toLowerCase();
  if (!["contact", "lead", "deal", "company"].includes(t)) {
    throw new ClientContextError(
      "CRM_CONTEXT_ENTITY_NOT_FOUND",
      "Поддерживаются contact, lead, deal, company."
    );
  }
  return t;
}

async function fetchEntityRaw(entityType, entityId) {
  const id = Number(entityId);
  if (!id) {
    throw new ClientContextError("CRM_CONTEXT_ENTITY_NOT_FOUND", "Некорректный ID сущности.");
  }
  const typeId = ENTITY_TYPE[entityType.toUpperCase()];
  const legacy = {
    contact: "crm.contact.get",
    lead: "crm.lead.get",
    deal: "crm.deal.get",
    company: "crm.company.get",
  }[entityType];

  try {
    const item = await callReadMethod("crm.item.get", { entityTypeId: typeId, id });
    return unwrapCrmItem(item) || item;
  } catch (error) {
    try {
      const item = await callReadMethod(legacy, { id });
      return unwrapCrmItem(item) || item;
    } catch (err2) {
      throw new ClientContextError(
        "CRM_CONTEXT_ENTITY_NOT_FOUND",
        "Сущность CRM не найдена или недоступна.",
        { technical: err2.message || error.message }
      );
    }
  }
}

async function loadUsers(ids) {
  const unique = [...new Set(ids.map(Number).filter(Boolean))];
  const map = new Map();
  if (!unique.length) return map;
  try {
    const users = await callReadMethod("user.get", { filter: { ID: unique } });
    const list = Array.isArray(users) ? users : users?.result || [];
    for (const u of list) {
      const id = Number(u.ID || u.id);
      const name = [u.LAST_NAME || u.lastName, u.NAME || u.name].filter(Boolean).join(" ").trim();
      map.set(id, name || `ID ${id}`);
    }
  } catch {
    /* partial */
  }
  return map;
}

async function loadStageName(entityType, stageId, categoryId) {
  if (!stageId) return null;
  try {
    if (entityType === "deal") {
      const entityId = categoryId ? `DEAL_STAGE_${categoryId}` : "DEAL_STAGE";
      const list = await callReadMethod("crm.status.list", { filter: { ENTITY_ID: entityId } });
      const arr = Array.isArray(list) ? list : [];
      const hit = arr.find((s) => String(s.STATUS_ID || s.statusId) === String(stageId));
      return hit?.NAME || hit?.name || null;
    }
    if (entityType === "lead") {
      const list = await callReadMethod("crm.status.list", { filter: { ENTITY_ID: "STATUS" } });
      const arr = Array.isArray(list) ? list : [];
      const hit = arr.find((s) => String(s.STATUS_ID || s.statusId) === String(stageId));
      return hit?.NAME || hit?.name || null;
    }
  } catch {
    return null;
  }
  return null;
}

async function loadActivities(entityType, entityId, limit) {
  const ownerTypeId = OWNER_TYPE[entityType];
  const items = [];
  try {
    const page = await fetchAllPages({
      actionName: "crm_context.activities",
      maxPages: Math.ceil(limit / 50) + 1,
      fetchPage: async (start) => {
        const data = await callReadMethod("crm.activity.list", {
          filter: { OWNER_TYPE_ID: ownerTypeId, OWNER_ID: Number(entityId) },
          select: [
            "ID",
            "SUBJECT",
            "DESCRIPTION",
            "START_TIME",
            "END_TIME",
            "COMPLETED",
            "RESPONSIBLE_ID",
            "TYPE_ID",
            "PROVIDER_TYPE_ID",
          ],
          order: { START_TIME: "DESC" },
          start,
        });
        const list = Array.isArray(data) ? data : data?.activities || data?.items || [];
        return { items: list, next: data?.next ?? (list.length >= 50 ? start + 50 : null) };
      },
    });
    items.push(...page.items.slice(0, limit));
    return { items, truncated: page.truncated || page.items.length > limit, warning: null };
  } catch (error) {
    return {
      items: [],
      truncated: false,
      warning: {
        code: "CRM_CONTEXT_SOURCE_UNAVAILABLE",
        message: "CRM-дела недоступны.",
        details: { reason: error.message },
      },
    };
  }
}

async function loadTasks(entityType, entityId, limit) {
  const binding = `T${OWNER_TYPE[entityType] || 2}_${entityId}`;
  try {
    const result = await callReadMethod("tasks.task.list", {
      filter: { UF_CRM_TASK: binding },
      select: ["ID", "TITLE", "DESCRIPTION", "STATUS", "RESPONSIBLE_ID", "CREATED_DATE", "DEADLINE"],
      order: { ID: "desc" },
    });
    const tasks = result?.tasks || result || [];
    const list = Array.isArray(tasks) ? tasks : Object.values(tasks);
    return { items: list.slice(0, limit), truncated: list.length > limit, warning: null };
  } catch (error) {
    return {
      items: [],
      truncated: false,
      warning: {
        code: "CRM_CONTEXT_SOURCE_UNAVAILABLE",
        message: "Задачи недоступны для webhook.",
        details: { reason: error.message },
      },
    };
  }
}

async function loadComments(entityType, entityId, limit) {
  try {
    let comments = await timeline_comment_list({ entityType, entityId });
    if (!Array.isArray(comments)) comments = comments?.result || comments?.comments || [];
    return { items: comments.slice(0, limit), truncated: comments.length > limit, warning: null };
  } catch (error) {
    return {
      items: [],
      truncated: false,
      warning: {
        code: "TIMELINE_ACCESS_DENIED",
        message: "Комментарии таймлайна недоступны.",
        details: { reason: error.message },
      },
    };
  }
}

/**
 * @param {{ entityType: string, entityId: number|string, include?: string[], mode?: string, dateFrom?: string, dateTo?: string, limits?: object, useCache?: boolean }} params
 */
export async function crm_context_get(params = {}) {
  const cfg = getClientContextConfig();
  const entityType = normalizeEntityType(params.entityType);
  const entityId = Number(params.entityId);
  const include = Array.isArray(params.include) && params.include.length
    ? params.include
    : ["fields", "relations", "activities", "tasks", "timeline"];
  const mode = params.mode || "standard";
  const limits = {
    activities: params.limits?.activities ?? cfg.defaultActivityLimit,
    tasks: params.limits?.tasks ?? cfg.defaultTaskLimit,
    timeline: params.limits?.timeline ?? cfg.defaultTimelineLimit,
    communications: params.limits?.communications ?? 100,
  };

  if (params.useCache !== false) {
    const cached = getCachedClientContext(entityType, entityId, include);
    if (cached) {
      return { ...cached, diagnostics: { ...(cached.diagnostics || {}), cacheHit: true } };
    }
  }

  const started = Date.now();
  const warnings = [];
  const methodology = getContactMethodologyConfig();
  const extraUf = [methodology.statusField, methodology.warmupField].filter(Boolean);

  const raw = await fetchEntityRaw(entityType, entityId);
  let fields;
  if (entityType === "contact") fields = normalizeContactFields(raw, extraUf);
  else if (entityType === "lead") fields = normalizeLeadFields(raw, extraUf);
  else if (entityType === "deal") fields = normalizeDealFields(raw, extraUf);
  else fields = normalizeCompanyFields(raw, extraUf);

  const responsibleId = getField(fields, "ASSIGNED_BY_ID");
  const stageId = getField(fields, "STAGE_ID", "STATUS_ID");
  const categoryId = getField(fields, "CATEGORY_ID");
  const [stageName, userMapSeed] = await Promise.all([
    include.includes("fields") ? loadStageName(entityType, stageId, categoryId) : null,
    loadUsers([responsibleId].filter(Boolean)),
  ]);

  const title =
    entityType === "contact"
      ? displayNameFromContact(fields) || `Контакт #${entityId}`
      : getField(fields, "TITLE") || `${entityType} #${entityId}`;

  const entity = {
    type: entityType,
    id: entityId,
    title,
    url: buildCrmEntityUrl(entityType, entityId),
    stage: stageId
      ? { id: String(stageId), name: stageName || String(stageId) }
      : null,
    responsible: responsibleId
      ? {
          id: Number(responsibleId),
          name: userMapSeed.get(Number(responsibleId)) || null,
        }
      : null,
    createdAt: getField(fields, "DATE_CREATE") || null,
    updatedAt: getField(fields, "DATE_MODIFY") || null,
    fields: sanitizeLlmPayload(fields, "entity_summary"),
  };

  const relations = { contact: null, company: null, lead: null };
  if (include.includes("relations")) {
    const contactId = getField(fields, "CONTACT_ID");
    const companyId = getField(fields, "COMPANY_ID");
    if (contactId && entityType !== "contact") {
      try {
        const c = normalizeContactFields(await fetchEntityRaw("contact", contactId), extraUf);
        relations.contact = {
          id: Number(contactId),
          name: displayNameFromContact(c),
          url: buildCrmEntityUrl("contact", contactId),
          statusField: methodology.statusField
            ? getField(c, methodology.statusField)
            : null,
        };
      } catch {
        warnings.push({
          code: "CRM_CONTEXT_SOURCE_UNAVAILABLE",
          message: "Связанный контакт недоступен.",
        });
      }
    }
    if (companyId && entityType !== "company") {
      try {
        const co = normalizeCompanyFields(await fetchEntityRaw("company", companyId));
        relations.company = {
          id: Number(companyId),
          name: getField(co, "TITLE"),
          url: buildCrmEntityUrl("company", companyId),
        };
      } catch {
        warnings.push({
          code: "CRM_CONTEXT_SOURCE_UNAVAILABLE",
          message: "Связанная компания недоступна.",
        });
      }
    }
  }

  let _rawActivities = [];
  let _rawTasks = [];
  let _rawComments = [];

  if (include.includes("activities")) {
    const act = await loadActivities(entityType, entityId, limits.activities);
    _rawActivities = act.items;
    if (act.warning) warnings.push(act.warning);
  }
  if (include.includes("tasks")) {
    const tasks = await loadTasks(entityType, entityId, limits.tasks);
    _rawTasks = tasks.items;
    if (tasks.warning) warnings.push(tasks.warning);
  }
  if (include.includes("timeline")) {
    const comments = await loadComments(entityType, entityId, limits.timeline);
    _rawComments = comments.items;
    if (comments.warning) warnings.push(comments.warning);
  }

  let hubCommunications = [];
  if (include.includes("communications")) {
    const contactIdForHub =
      entityType === "contact"
        ? String(entityId)
        : getField(fields, "CONTACT_ID")
          ? String(getField(fields, "CONTACT_ID"))
          : null;
    try {
      const { getCommunicationsConfig } = await import("../communications/config.js");
      const { buildCommunicationContext } = await import(
        "../communications/communicationContext.js"
      );
      if (getCommunicationsConfig().enabled && contactIdForHub) {
        const ctx = buildCommunicationContext(contactIdForHub, {
          recentLimit: limits.communications || 30,
        });
        hubCommunications = [
          {
            source: "communications_hub",
            contactId: ctx.contactId,
            preferredChannel: ctx.preferredChannel,
            unanswered: ctx.unanswered,
            lastInbound: ctx.lastInbound,
            lastOutbound: ctx.lastOutbound,
            recentMessages: ctx.recentMessages,
            activeSequences: ctx.activeSequences,
            threads: ctx.threads,
            restrictions: ctx.restrictions,
            summary: ctx.summary,
          },
        ];
      } else {
        // Keep legacy code COMMUNICATIONS_SOURCE_UNAVAILABLE so Client Context
        // callers and tests treat Hub-disabled / no-contact as partial, not full.
        warnings.push({
          code: "COMMUNICATIONS_SOURCE_UNAVAILABLE",
          message: !getCommunicationsConfig().enabled
            ? "Communications Hub выключен (COMMUNICATIONS_ENABLED=false); история сообщений недоступна."
            : "Нет contactId для подгрузки переписки Hub; анализ по карточке, делам и таймлайну.",
          details: {
            hubEnabled: getCommunicationsConfig().enabled,
            hasContactId: Boolean(contactIdForHub),
          },
        });
      }
    } catch (error) {
      warnings.push({
        code: "COMMUNICATIONS_SOURCE_UNAVAILABLE",
        message:
          error?.message ||
          "История сообщений Hub временно недоступна; анализ по карточке, делам и таймлайну.",
      });
    }
  }

  const userIds = [
    responsibleId,
    ..._rawActivities.map((a) => getField(a, "RESPONSIBLE_ID", "responsibleId")),
    ..._rawComments.map((c) => getField(c, "AUTHOR_ID", "authorId")),
  ];
  const userMap = await loadUsers(userIds);

  const timelineBuilt = buildClientTimeline(
    { _rawActivities, _rawComments, _rawTasks, _rawProtocols: [] },
    { mode, userMap }
  );

  const openTasks = _rawTasks.filter((t) => {
    const task = t.task || t;
    return String(getField(task, "status", "STATUS") || "") !== "5";
  }).length;

  const overdueActivities = _rawActivities.filter((a) => {
    const completed = String(getField(a, "COMPLETED", "completed") || "").toUpperCase();
    if (completed === "Y" || completed === "1") return false;
    const end = getField(a, "END_TIME", "endTime", "DEADLINE");
    return end && new Date(end).getTime() < Date.now();
  }).length;

  const nextActivity = _rawActivities.find((a) => {
    const completed = String(getField(a, "COMPLETED", "completed") || "").toUpperCase();
    return completed !== "Y" && completed !== "1";
  });

  const state = {
    nextActivity: nextActivity
      ? {
          id: getField(nextActivity, "ID", "id"),
          title: getField(nextActivity, "SUBJECT", "subject"),
          startTime: getField(nextActivity, "START_TIME", "startTime"),
        }
      : null,
    overdueActivities,
    openTasks,
    lastMeaningfulInteractionAt: timelineBuilt.lastMeaningfulInteractionAt,
  };

  const result = {
    success: true,
    entity,
    relations,
    state,
    timeline: timelineBuilt.timeline,
    communications: hubCommunications,
    partial: warnings.length > 0 || timelineBuilt.truncated,
    truncated: timelineBuilt.truncated,
    warnings,
    diagnostics: {
      durationMs: Date.now() - started,
      include,
      mode,
      activityCount: _rawActivities.length,
      taskCount: _rawTasks.length,
      commentCount: _rawComments.length,
      timelineEvents: timelineBuilt.timeline.length,
      cacheHit: false,
    },
  };

  // Budget trim for LLM consumers
  const jsonSize = JSON.stringify(result).length;
  if (jsonSize > cfg.maxChars) {
    result.timeline = result.timeline.slice(0, Math.floor(result.timeline.length / 2));
    result.warnings.push({
      code: "CRM_CONTEXT_LIMIT_REACHED",
      message: "Контекст урезан по CLIENT_CONTEXT_MAX_CHARS.",
    });
    result.partial = true;
  }

  setCachedClientContext(entityType, entityId, include, result);
  return result;
}

export { normalizeEntityType };
