/**
 * Пакетная индексация CRM-дел (без N+1 по сущностям).
 */
import { activityListAll } from "../actions/timelineActions.js";
import { unwrapCrmItem, ENTITY_TYPE, logAnalytics } from "../actions/helpers.js";

export const OWNER_TYPE = {
  lead: ENTITY_TYPE.LEAD,
  deal: ENTITY_TYPE.DEAL,
  contact: ENTITY_TYPE.CONTACT,
  company: ENTITY_TYPE.COMPANY,
};

function ownerKey(ownerTypeId, ownerId) {
  return `${ownerTypeId}:${ownerId}`;
}

function isActivitiesAccessError(error) {
  const message = error?.message || String(error);
  return /privileges|access|permission|scope|denied|недостаточно прав/i.test(message);
}

/**
 * Загрузить незавершённые CRM-дела и построить индекс по владельцу.
 * @param {{ ownerTypeIds?: number[], responsibleIds?: number[], select?: string[] }} options
 */
export async function buildActivityIndex(options = {}) {
  const started = Date.now();
  const ownerTypeIds = options.ownerTypeIds || [
    OWNER_TYPE.lead,
    OWNER_TYPE.deal,
    OWNER_TYPE.contact,
  ];
  const select = options.select || [
    "ID",
    "OWNER_TYPE_ID",
    "OWNER_ID",
    "RESPONSIBLE_ID",
    "SUBJECT",
    "DEADLINE",
    "COMPLETED",
  ];

  const byOwner = new Map();
  const byResponsible = new Map();
  let activityRequests = 0;
  let totalItems = 0;
  let truncated = false;
  const now = Date.now();

  try {
    for (const ownerTypeId of ownerTypeIds) {
      const filter = {
        OWNER_TYPE_ID: ownerTypeId,
        COMPLETED: "N",
        ...(options.filter || {}),
      };
      if (options.responsibleIds?.length) {
        filter.RESPONSIBLE_ID = options.responsibleIds;
      }

      const page = await activityListAll(
        { filter, select },
        { actionName: `activity_index:${ownerTypeId}` }
      );
      activityRequests += page.pages || 1;
      totalItems += page.items?.length || 0;
      if (page.truncated) truncated = true;

      for (const raw of page.items || []) {
        const data = unwrapCrmItem(raw);
        const oid = data.OWNER_ID ?? data.ownerId;
        const otid = data.OWNER_TYPE_ID ?? data.ownerTypeId ?? ownerTypeId;
        if (oid == null) continue;

        const key = ownerKey(otid, oid);
        const deadlineRaw = data.DEADLINE || data.deadline || data.END_TIME || data.endTime;
        const deadlineMs = deadlineRaw ? new Date(deadlineRaw).getTime() : null;
        const isOverdue = deadlineMs != null && !Number.isNaN(deadlineMs) && deadlineMs < now;
        const isFutureOrCurrent =
          deadlineMs == null || Number.isNaN(deadlineMs) || deadlineMs >= now;
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const endOfToday = new Date(startOfToday);
        endOfToday.setDate(endOfToday.getDate() + 1);
        const in7 = new Date(startOfToday);
        in7.setDate(in7.getDate() + 7);

        const entry = {
          id: data.ID || data.id,
          ownerTypeId: Number(otid),
          ownerId: Number(oid),
          responsibleId: data.RESPONSIBLE_ID ?? data.responsibleId ?? null,
          subject: data.SUBJECT || data.subject || null,
          deadline: deadlineRaw || null,
          deadlineMs,
          isOverdue,
          isFutureOrCurrent,
          isToday:
            deadlineMs != null &&
            deadlineMs >= startOfToday.getTime() &&
            deadlineMs < endOfToday.getTime(),
          isNext7Days:
            deadlineMs != null &&
            deadlineMs >= startOfToday.getTime() &&
            deadlineMs < in7.getTime(),
        };

        if (!byOwner.has(key)) byOwner.set(key, []);
        byOwner.get(key).push(entry);

        const rid = entry.responsibleId != null ? String(entry.responsibleId) : "0";
        if (!byResponsible.has(rid)) byResponsible.set(rid, []);
        byResponsible.get(rid).push(entry);
      }
    }
  } catch (error) {
    if (isActivitiesAccessError(error)) {
      return {
        ok: false,
        error: {
          success: false,
          error: {
            code: "CRM_ACTIVITIES_ACCESS_DENIED",
            message: "У входящего вебхука недостаточно прав для чтения CRM-дел.",
            details: { requiredScope: "CRM" },
          },
        },
        byOwner,
        byResponsible,
        activityRequests,
        totalItems,
        truncated,
        strategy: "bulk",
      };
    }
    throw error;
  }

  logAnalytics({
    action: "build_activity_index",
    pages: activityRequests,
    items: totalItems,
    durationMs: Date.now() - started,
    truncated,
  });

  return {
    ok: true,
    byOwner,
    byResponsible,
    activityRequests,
    totalItems,
    truncated,
    strategy: "bulk",
    classifyOwner(ownerTypeId, ownerId) {
      const list = byOwner.get(ownerKey(ownerTypeId, ownerId)) || [];
      const hasFuture = list.some((a) => a.isFutureOrCurrent);
      const hasOverdue = list.some((a) => a.isOverdue);
      return {
        activities: list,
        hasAny: list.length > 0,
        hasFuture,
        hasOverdue,
        withoutActivity: list.length === 0,
        withOverdueActivityOnly: list.length > 0 && !hasFuture && hasOverdue,
      };
    },
  };
}

export { ownerKey };
