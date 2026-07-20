/**
 * Read-only аналитика нагрузки менеджеров и операционной дисциплины CRM.
 */
import { lead_stage_list, leadListAll } from "./leadActions.js";
import { dealListAll } from "./dealActions.js";
import { deal_stage_list } from "./crmActions.js";
import { searchTasksAll } from "./taskActions.js";
import {
  collectContactQualityDataset,
} from "./contactAnalyticsActions.js";
import { resolveUsersByIds } from "../cache/directoryCache.js";
import { buildActivityIndex, OWNER_TYPE } from "../analytics/activityIndex.js";
import { calculateCrmQualityScore } from "../analytics/qualityScore.js";
import {
  PAGINATION,
  unwrapCrmItem,
  extractDealFields,
  buildStageNameMap,
  addCurrencyAmount,
  logAnalytics,
  buildCrmEntityUrl,
  buildTruncationMeta,
} from "./helpers.js";

const SAMPLE = () => PAGINATION.SAMPLE_LIMIT;

function daysBetween(fromMs, toMs = Date.now()) {
  if (fromMs == null || Number.isNaN(fromMs)) return null;
  return Math.max(0, Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000)));
}

function parseDateMs(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function isFinalLeadStatus(stage, statusId) {
  const semantic = String(stage?.SEMANTICS || stage?.STATUS_SEMANTIC_ID || stage?.semantics || "").toUpperCase();
  if (semantic === "S" || semantic === "F") return true;
  const id = String(statusId || "").toUpperCase();
  return id === "CONVERTED" || id === "JUNK";
}

function formatLeadName(data) {
  return data.TITLE || data.title || `Лид #${data.ID || data.id}`;
}

function formatDealName(data) {
  return data.title || data.TITLE || `Сделка #${data.ID || data.id}`;
}

async function loadTasksSafe(filter = {}) {
  try {
    const result = await searchTasksAll(
      {
        filter,
        select: ["ID", "TITLE", "DEADLINE", "STATUS", "RESPONSIBLE_ID"],
      },
      { actionName: "manager_tasks" }
    );
    return { available: true, ...result };
  } catch (error) {
    const message = error?.message || String(error);
    if (/privileges|access|permission|scope|denied/i.test(message)) {
      return {
        available: false,
        items: [],
        warning: {
          code: "TASKS_ACCESS_DENIED",
          message: "Отчёт по задачам недоступен: входящий вебхук не имеет прав Tasks.",
        },
      };
    }
    throw error;
  }
}

function emptyManagerBucket(responsibleId) {
  return {
    responsibleId: Number(responsibleId) || 0,
    contacts: {
      total: 0,
      withoutStatus: 0,
      withoutCompany: 0,
      cycleWithoutNextActivity: 0,
      cycleWithOverdueActivityOnly: 0,
    },
    leads: {
      total: 0,
      byStage: {},
      withoutActivity: 0,
      withOverdueActivityOnly: 0,
      withoutContact: 0,
      withoutCompany: 0,
      withoutResponsible: 0,
      stale: 0,
    },
    deals: {
      total: 0,
      sumsByCurrency: {},
      byStage: {},
      withoutNextStep: 0,
      withoutActivity: 0,
      withOverdueActivity: 0,
      stale: 0,
      closedWon: 0,
      closedLost: 0,
    },
    activities: {
      active: 0,
      overdue: 0,
      today: 0,
      next7Days: 0,
    },
    tasks: {
      available: true,
      active: 0,
      overdue: 0,
      today: 0,
    },
    alerts: [],
  };
}

/**
 * Лиды без следующего CRM-дела.
 */
export async function leads_without_next_activity(params = {}) {
  const started = Date.now();
  const includeFinal = Boolean(params.includeFinalStages);
  const stages = await lead_stage_list({});
  const stageList = Array.isArray(stages) ? stages : [];
  const stageMap = buildStageNameMap(stageList);
  const finalIds = new Set(
    stageList
      .filter((s) => isFinalLeadStatus(s, s.STATUS_ID || s.statusId))
      .map((s) => String(s.STATUS_ID || s.statusId))
  );

  const filter = { ...(params.filter || {}) };
  if (params.responsibleIds?.length) filter.ASSIGNED_BY_ID = params.responsibleIds;

  const { items, pages, truncated } = await leadListAll(
    {
      filter,
      select: [
        "ID",
        "TITLE",
        "STATUS_ID",
        "ASSIGNED_BY_ID",
        "DATE_CREATE",
        "DATE_MODIFY",
        "CONTACT_ID",
        "COMPANY_ID",
      ],
    },
    { actionName: "leads_without_next_activity" }
  );

  const active = items.filter((item) => {
    const data = unwrapCrmItem(item);
    const statusId = String(data.STATUS_ID || data.statusId || "");
    if (!includeFinal && finalIds.has(statusId)) return false;
    return true;
  });

  const activityIndex = await buildActivityIndex({ ownerTypeIds: [OWNER_TYPE.lead] });
  if (!activityIndex.ok) return activityIndex.error;

  const withoutActivity = [];
  const withOverdueActivityOnly = [];

  for (const item of active) {
    const data = unwrapCrmItem(item);
    const cls = activityIndex.classifyOwner(OWNER_TYPE.lead, data.ID || data.id);
    if (cls.withoutActivity) withoutActivity.push(data);
    else if (cls.withOverdueActivityOnly) withOverdueActivityOnly.push(data);
  }

  const allSampleSource = [...withoutActivity, ...withOverdueActivityOnly];
  const users = await resolveUsersByIds(allSampleSource.map((d) => d.ASSIGNED_BY_ID || d.assignedById));

  const mapRow = (data) => {
    const id = Number(data.ID || data.id);
    const statusId = data.STATUS_ID || data.statusId;
    const modifyMs = parseDateMs(data.DATE_MODIFY || data.dateModify);
    const createMs = parseDateMs(data.DATE_CREATE || data.dateCreate);
    const responsibleId = data.ASSIGNED_BY_ID ?? data.assignedById ?? null;
    return {
      id,
      title: formatLeadName(data),
      stageId: statusId,
      stageName: stageMap.get(String(statusId)) || statusId,
      responsibleId: responsibleId != null ? Number(responsibleId) : null,
      responsibleName:
        responsibleId != null ? users.get(String(responsibleId))?.name || null : null,
      dateCreate: data.DATE_CREATE || data.dateCreate || null,
      dateModify: data.DATE_MODIFY || data.dateModify || null,
      daysSinceModify: daysBetween(modifyMs ?? createMs),
      inactivityField: modifyMs ? "DATE_MODIFY" : "DATE_CREATE",
      url: buildCrmEntityUrl("lead", id),
    };
  };

  const truncMeta = buildTruncationMeta(truncated || activityIndex.truncated);
  logAnalytics({
    action: "leads_without_next_activity",
    pages,
    items: withoutActivity.length + withOverdueActivityOnly.length,
    activityRequests: activityIndex.activityRequests,
    durationMs: Date.now() - started,
    truncated: truncMeta.truncated,
  });

  return {
    entity: "lead",
    issue: "without_next_activity",
    countWithoutActivity: withoutActivity.length,
    countWithOverdueActivityOnly: withOverdueActivityOnly.length,
    withoutActivity: withoutActivity.slice(0, SAMPLE()).map(mapRow),
    withOverdueActivityOnly: withOverdueActivityOnly.slice(0, SAMPLE()).map(mapRow),
    sampleLimit: SAMPLE(),
    ...truncMeta,
    diagnostics: {
      activityStrategy: activityIndex.strategy,
      activityRequests: activityIndex.activityRequests,
      entitiesChecked: active.length,
    },
    note: "Проверяются только CRM-дела (crm.activity), не задачи tasks.",
  };
}

/**
 * Лиды без изменений более N дней.
 */
export async function stale_leads_report(params = {}) {
  const started = Date.now();
  const inactiveDays = Number(params.inactiveDays ?? 14);
  const includeFinal = Boolean(params.includeFinalStages);
  const stages = await lead_stage_list({});
  const stageList = Array.isArray(stages) ? stages : [];
  const stageMap = buildStageNameMap(stageList);
  const finalIds = new Set(
    stageList
      .filter((s) => isFinalLeadStatus(s, s.STATUS_ID || s.statusId))
      .map((s) => String(s.STATUS_ID || s.statusId))
  );
  const stageFilter = new Set((params.stageIds || []).map(String));

  const filter = { ...(params.filter || {}) };
  if (params.responsibleIds?.length) filter.ASSIGNED_BY_ID = params.responsibleIds;

  const { items, pages, truncated } = await leadListAll(
    {
      filter,
      select: [
        "ID",
        "TITLE",
        "STATUS_ID",
        "ASSIGNED_BY_ID",
        "DATE_CREATE",
        "DATE_MODIFY",
        "CONTACT_ID",
        "COMPANY_ID",
      ],
    },
    { actionName: "stale_leads_report" }
  );

  const activityIndex = await buildActivityIndex({ ownerTypeIds: [OWNER_TYPE.lead] });
  if (!activityIndex.ok) return activityIndex.error;

  const thresholdMs = Date.now() - inactiveDays * 24 * 60 * 60 * 1000;
  const stale = [];
  const withoutActivity = [];
  const withOverdueOnly = [];

  for (const item of items) {
    const data = unwrapCrmItem(item);
    const statusId = String(data.STATUS_ID || data.statusId || "");
    if (!includeFinal && finalIds.has(statusId)) continue;
    if (stageFilter.size && !stageFilter.has(statusId)) continue;
    if (params.responsibleIds?.length) {
      const rid = String(data.ASSIGNED_BY_ID ?? data.assignedById ?? "");
      if (!params.responsibleIds.map(String).includes(rid)) continue;
    }

    const modifyMs = parseDateMs(data.DATE_MODIFY || data.dateModify);
    const createMs = parseDateMs(data.DATE_CREATE || data.dateCreate);
    const refMs = modifyMs ?? createMs;
    if (refMs == null || refMs > thresholdMs) continue;

    const cls = activityIndex.classifyOwner(OWNER_TYPE.lead, data.ID || data.id);
    const row = { data, refMs, field: modifyMs ? "DATE_MODIFY" : "DATE_CREATE", cls };
    stale.push(row);
    if (cls.withoutActivity) withoutActivity.push(row);
    else if (cls.withOverdueActivityOnly) withOverdueOnly.push(row);
  }

  const users = await resolveUsersByIds(stale.map((r) => r.data.ASSIGNED_BY_ID || r.data.assignedById));
  const mapRow = ({ data, refMs, field, cls }) => {
    const id = Number(data.ID || data.id);
    const statusId = data.STATUS_ID || data.statusId;
    const responsibleId = data.ASSIGNED_BY_ID ?? data.assignedById ?? null;
    return {
      id,
      title: formatLeadName(data),
      stageId: statusId,
      stageName: stageMap.get(String(statusId)) || statusId,
      responsibleId: responsibleId != null ? Number(responsibleId) : null,
      responsibleName:
        responsibleId != null ? users.get(String(responsibleId))?.name || null : null,
      dateModify: data.DATE_MODIFY || data.dateModify || null,
      daysInactive: daysBetween(refMs),
      inactivityField: field,
      nextActivity: cls.hasFuture,
      hasOverdueActivity: cls.hasOverdue,
      url: buildCrmEntityUrl("lead", id),
    };
  };

  const truncMeta = buildTruncationMeta(truncated || activityIndex.truncated);
  logAnalytics({
    action: "stale_leads_report",
    pages,
    items: stale.length,
    activityRequests: activityIndex.activityRequests,
    durationMs: Date.now() - started,
    truncated: truncMeta.truncated,
  });

  return {
    entity: "lead",
    issue: "stale_without_changes",
    title: `Лиды без изменений более ${inactiveDays} дней`,
    inactiveDays,
    inactivityBasis: "DATE_MODIFY (fallback DATE_CREATE). Это не длительность нахождения в стадии.",
    count: stale.length,
    countWithoutActivity: withoutActivity.length,
    countWithOverdueActivityOnly: withOverdueOnly.length,
    withoutChanges: stale.slice(0, SAMPLE()).map(mapRow),
    withoutActivity: withoutActivity.slice(0, SAMPLE()).map(mapRow),
    withOverdueActivityOnly: withOverdueOnly.slice(0, SAMPLE()).map(mapRow),
    sampleLimit: SAMPLE(),
    ...truncMeta,
    diagnostics: {
      activityStrategy: "bulk",
      activityRequests: activityIndex.activityRequests,
      entitiesChecked: items.length,
    },
  };
}

/**
 * Сделки без изменений более N дней.
 */
export async function stale_deals_report(params = {}) {
  const started = Date.now();
  const inactiveDays = Number(params.inactiveDays ?? 14);
  const includeClosed = Boolean(params.includeClosed);
  const categoryId = params.categoryId ?? null;
  const stageFilter = new Set((params.stageIds || []).map(String));

  const filter = { ...(params.filter || {}) };
  if (categoryId != null) filter.CATEGORY_ID = categoryId;
  if (!includeClosed) filter.CLOSED = "N";
  if (params.responsibleIds?.length) filter.ASSIGNED_BY_ID = params.responsibleIds;

  const stages = await deal_stage_list({ categoryId: categoryId ?? 0 });
  const stageMap = buildStageNameMap(Array.isArray(stages) ? stages : []);

  const { items, pages, truncated } = await dealListAll(
    {
      filter,
      select: [
        "ID",
        "TITLE",
        "STAGE_ID",
        "ASSIGNED_BY_ID",
        "OPPORTUNITY",
        "CURRENCY_ID",
        "DATE_CREATE",
        "DATE_MODIFY",
        "CLOSED",
        "CATEGORY_ID",
      ],
    },
    { actionName: "stale_deals_report" }
  );

  const activityIndex = await buildActivityIndex({ ownerTypeIds: [OWNER_TYPE.deal] });
  if (!activityIndex.ok) return activityIndex.error;

  const thresholdMs = Date.now() - inactiveDays * 24 * 60 * 60 * 1000;
  const stale = [];
  const totalsByCurrency = {};
  const byStage = new Map();
  const byResponsible = new Map();

  for (const item of items) {
    const data = extractDealFields(item);
    const stageId = String(data.stageId || "");
    if (stageFilter.size && !stageFilter.has(stageId)) continue;

    const modifyMs = parseDateMs(data.DATE_MODIFY || data.dateModify);
    const createMs = parseDateMs(data.DATE_CREATE || data.dateCreate);
    const refMs = modifyMs ?? createMs;
    if (refMs == null || refMs > thresholdMs) continue;

    const cls = activityIndex.classifyOwner(OWNER_TYPE.deal, data.ID || data.id);
    const overdueActs = (cls.activities || []).filter((a) => a.isOverdue);
    const futureActs = (cls.activities || []).filter((a) => a.isFutureOrCurrent);
    stale.push({ data, refMs, field: modifyMs ? "DATE_MODIFY" : "DATE_CREATE", cls, overdueActs, futureActs });

    addCurrencyAmount(totalsByCurrency, data.currencyId, data.opportunity);
    byStage.set(stageId, (byStage.get(stageId) || 0) + 1);
    const rid = String(data.ASSIGNED_BY_ID ?? data.assignedById ?? "0");
    byResponsible.set(rid, (byResponsible.get(rid) || 0) + 1);
  }

  const users = await resolveUsersByIds([
    ...stale.map((r) => r.data.ASSIGNED_BY_ID || r.data.assignedById),
    ...byResponsible.keys(),
  ]);

  const sample = stale.slice(0, SAMPLE()).map(({ data, refMs, field, cls, overdueActs, futureActs }) => {
    const id = Number(data.ID || data.id);
    const responsibleId = data.ASSIGNED_BY_ID ?? data.assignedById ?? null;
    return {
      id,
      title: formatDealName(data),
      stageId: data.stageId,
      stageName: stageMap.get(String(data.stageId)) || data.stageId,
      opportunity: data.opportunity || 0,
      currencyId: data.currencyId || "RUB",
      responsibleId: responsibleId != null ? Number(responsibleId) : null,
      responsibleName:
        responsibleId != null ? users.get(String(responsibleId))?.name || null : null,
      dateModify: data.DATE_MODIFY || data.dateModify || null,
      daysInactive: daysBetween(refMs),
      inactivityField: field,
      nextActivitySubject: futureActs[0]?.subject || null,
      nextActivityDeadline: futureActs[0]?.deadline || null,
      overdueActivitySubject: overdueActs[0]?.subject || null,
      overdueActivityDeadline: overdueActs[0]?.deadline || null,
      url: buildCrmEntityUrl("deal", id),
    };
  });

  const truncMeta = buildTruncationMeta(truncated || activityIndex.truncated);
  logAnalytics({
    action: "stale_deals_report",
    pages,
    items: stale.length,
    activityRequests: activityIndex.activityRequests,
    durationMs: Date.now() - started,
    truncated: truncMeta.truncated,
  });

  return {
    entity: "deal",
    issue: "stale_without_changes",
    title: `Сделки без изменений более ${inactiveDays} дней`,
    inactiveDays,
    inactivityBasis: "DATE_MODIFY (fallback DATE_CREATE). Это не длительность нахождения в стадии.",
    count: stale.length,
    totalsByCurrency,
    byStage: [...byStage.entries()].map(([stageId, count]) => ({
      stageId,
      stageName: stageMap.get(String(stageId)) || stageId,
      count,
    })),
    byResponsible: [...byResponsible.entries()].map(([responsibleId, count]) => ({
      responsibleId: Number(responsibleId),
      responsibleName: users.get(String(responsibleId))?.name || null,
      count,
    })),
    sample,
    sampleLimit: SAMPLE(),
    ...truncMeta,
    diagnostics: {
      activityStrategy: "bulk",
      activityRequests: activityIndex.activityRequests,
      entitiesChecked: items.length,
    },
  };
}

/**
 * Просроченные CRM-дела по менеджерам.
 */
export async function overdue_activities_by_manager(params = {}) {
  const started = Date.now();
  const ownerTypes = params.ownerTypes || ["contact", "lead", "deal"];
  const ownerTypeIds = ownerTypes.map((t) => OWNER_TYPE[t]).filter(Boolean);

  const activityIndex = await buildActivityIndex({
    ownerTypeIds,
    responsibleIds: params.responsibleIds,
  });
  if (!activityIndex.ok) return activityIndex.error;

  const now = Date.now();
  const dateToMs = params.dateTo ? parseDateMs(params.dateTo) : now;
  const groupsMap = new Map();
  let total = 0;

  for (const [, list] of activityIndex.byResponsible.entries()) {
    for (const act of list) {
      if (!act.isOverdue) continue;
      if (dateToMs != null && act.deadlineMs != null && act.deadlineMs > dateToMs) continue;
      if (params.responsibleIds?.length) {
        if (!params.responsibleIds.map(String).includes(String(act.responsibleId))) continue;
      }

      total += 1;
      const rid = String(act.responsibleId ?? "0");
      if (!groupsMap.has(rid)) {
        groupsMap.set(rid, {
          responsibleId: Number(rid) || 0,
          count: 0,
          byOwnerType: { contact: 0, lead: 0, deal: 0, company: 0 },
          sample: [],
        });
      }
      const g = groupsMap.get(rid);
      g.count += 1;
      const typeName =
        act.ownerTypeId === OWNER_TYPE.contact
          ? "contact"
          : act.ownerTypeId === OWNER_TYPE.lead
            ? "lead"
            : act.ownerTypeId === OWNER_TYPE.deal
              ? "deal"
              : "company";
      g.byOwnerType[typeName] = (g.byOwnerType[typeName] || 0) + 1;
      if (g.sample.length < 20) {
        g.sample.push({
          id: act.id,
          subject: act.subject,
          deadline: act.deadline,
          ownerType: typeName,
          ownerId: act.ownerId,
          url: buildCrmEntityUrl(typeName, act.ownerId),
        });
      }
    }
  }

  const users = await resolveUsersByIds([...groupsMap.keys()]);
  const groups = [...groupsMap.values()]
    .map((g) => ({
      ...g,
      responsibleName: users.get(String(g.responsibleId))?.name || null,
    }))
    .sort((a, b) => b.count - a.count);

  const truncMeta = buildTruncationMeta(activityIndex.truncated);
  logAnalytics({
    action: "overdue_activities_by_manager",
    pages: activityIndex.activityRequests,
    items: total,
    durationMs: Date.now() - started,
    truncated: truncMeta.truncated,
  });

  return {
    total,
    groups,
    ...truncMeta,
    diagnostics: {
      activityStrategy: "bulk",
      activityRequests: activityIndex.activityRequests,
      entitiesChecked: activityIndex.totalItems,
    },
  };
}

/**
 * Нагрузка и качество ведения CRM по менеджерам.
 */
export async function manager_workload(params = {}) {
  const started = Date.now();
  const dateFrom = params.dateFrom || null;
  const dateTo = params.dateTo || null;
  const sampleLimit = Math.min(Number(params.sampleLimit) || 20, SAMPLE());
  const inactiveDays = Number(params.inactiveDays ?? 14);
  const warnings = [];
  let truncated = false;
  let restRequests = 0;

  // 1) Contacts — один проход
  const contactDataset = await collectContactQualityDataset({
    filter: params.filter || {},
    daysAhead: params.daysAhead ?? 30,
  });
  restRequests += (contactDataset.pages || 0) + (contactDataset.activityRequests || 0);
  if (contactDataset.truncated) truncated = true;
  if (contactDataset.activitiesError) {
    warnings.push({
      code: "CRM_ACTIVITIES_ACCESS_DENIED",
      message: contactDataset.activitiesError.error?.message || "Нет доступа к CRM-делам контактов",
    });
  }
  if (contactDataset.warning) {
    warnings.push({
      code: "ANALYTICS_PAGE_LIMIT_REACHED",
      message: contactDataset.warning,
    });
  }

  // 2) Leads + deals + activities (lead/deal) + tasks
  const leadFilter = {};
  const dealFilter = { CLOSED: "N" };
  if (params.responsibleIds?.length) {
    leadFilter.ASSIGNED_BY_ID = params.responsibleIds;
    dealFilter.ASSIGNED_BY_ID = params.responsibleIds;
  }

  const [leadStages, leadPage, dealPage, activityIndex, tasksResult] = await Promise.all([
    lead_stage_list({}),
    leadListAll(
      {
        filter: leadFilter,
        select: [
          "ID",
          "TITLE",
          "STATUS_ID",
          "ASSIGNED_BY_ID",
          "DATE_CREATE",
          "DATE_MODIFY",
          "CONTACT_ID",
          "COMPANY_ID",
        ],
      },
      { actionName: "manager_workload.leads" }
    ),
    dealListAll(
      {
        filter: dealFilter,
        select: [
          "ID",
          "TITLE",
          "STAGE_ID",
          "ASSIGNED_BY_ID",
          "OPPORTUNITY",
          "CURRENCY_ID",
          "DATE_CREATE",
          "DATE_MODIFY",
          "CLOSED",
          "CATEGORY_ID",
        ],
      },
      { actionName: "manager_workload.deals" }
    ),
    buildActivityIndex({
      ownerTypeIds: [OWNER_TYPE.lead, OWNER_TYPE.deal],
      responsibleIds: params.responsibleIds,
    }),
    loadTasksSafe({
      "!STATUS": 5,
      ...(params.responsibleIds?.length ? { RESPONSIBLE_ID: params.responsibleIds } : {}),
    }),
  ]);

  restRequests += (leadPage.pages || 0) + (dealPage.pages || 0);
  if (leadPage.truncated || dealPage.truncated) truncated = true;
  if (!activityIndex.ok) {
    warnings.push({
      code: "CRM_ACTIVITIES_ACCESS_DENIED",
      message: activityIndex.error?.error?.message || "Нет доступа к CRM-делам",
    });
  } else {
    restRequests += activityIndex.activityRequests || 0;
    if (activityIndex.truncated) truncated = true;
  }

  let tasksAvailable = true;
  if (!tasksResult.available) {
    tasksAvailable = false;
    warnings.push(tasksResult.warning);
  } else {
    restRequests += tasksResult.pages || 0;
  }

  const stageList = Array.isArray(leadStages) ? leadStages : [];
  const finalLeadIds = new Set(
    stageList
      .filter((s) => isFinalLeadStatus(s, s.STATUS_ID || s.statusId))
      .map((s) => String(s.STATUS_ID || s.statusId))
  );
  const leadStageMap = buildStageNameMap(stageList);
  const thresholdMs = Date.now() - inactiveDays * 24 * 60 * 60 * 1000;

  const managers = new Map();
  const ensure = (rid) => {
    const key = String(rid ?? "0");
    if (!managers.has(key)) managers.set(key, emptyManagerBucket(key));
    return managers.get(key);
  };

  // Contacts from dataset
  for (const [rid, bucket] of contactDataset.byResponsible.entries()) {
    if (params.responsibleIds?.length && !params.responsibleIds.map(String).includes(rid)) continue;
    const m = ensure(rid);
    m.contacts.total = bucket.total;
    m.contacts.withoutStatus = bucket.withoutStatus;
    m.contacts.withoutCompany = bucket.withoutCompany;
    m.contacts.cycleWithoutNextActivity = bucket.cycleWithoutNextActivity || 0;
    m.contacts.cycleWithOverdueActivityOnly = bucket.cycleWithOverdueActivityOnly || 0;
  }

  // Leads
  let activeLeads = 0;
  for (const item of leadPage.items || []) {
    const data = unwrapCrmItem(item);
    const statusId = String(data.STATUS_ID || data.statusId || "");
    if (finalLeadIds.has(statusId)) continue;
    activeLeads += 1;
    const rid = data.ASSIGNED_BY_ID ?? data.assignedById ?? 0;
    const m = ensure(rid);
    m.leads.total += 1;
    m.leads.byStage[statusId] = (m.leads.byStage[statusId] || 0) + 1;
    if (!rid || Number(rid) === 0) m.leads.withoutResponsible += 1;
    if (!data.CONTACT_ID && !data.contactId) m.leads.withoutContact += 1;
    if (!data.COMPANY_ID && !data.companyId) m.leads.withoutCompany += 1;

    if (activityIndex.ok) {
      const cls = activityIndex.classifyOwner(OWNER_TYPE.lead, data.ID || data.id);
      if (cls.withoutActivity) m.leads.withoutActivity += 1;
      else if (cls.withOverdueActivityOnly) m.leads.withOverdueActivityOnly += 1;
    }

    const modifyMs = parseDateMs(data.DATE_MODIFY || data.dateModify) ?? parseDateMs(data.DATE_CREATE);
    if (modifyMs != null && modifyMs <= thresholdMs) m.leads.stale += 1;
  }

  // Deals
  let activeDeals = 0;
  for (const item of dealPage.items || []) {
    const data = extractDealFields(item);
    activeDeals += 1;
    const rid = data.ASSIGNED_BY_ID ?? data.assignedById ?? 0;
    const m = ensure(rid);
    m.deals.total += 1;
    const stageId = String(data.stageId || "UNKNOWN");
    m.deals.byStage[stageId] = (m.deals.byStage[stageId] || 0) + 1;
    addCurrencyAmount(m.deals.sumsByCurrency, data.currencyId, data.opportunity);

    if (activityIndex.ok) {
      const cls = activityIndex.classifyOwner(OWNER_TYPE.deal, data.ID || data.id);
      if (cls.withoutActivity) {
        m.deals.withoutActivity += 1;
        m.deals.withoutNextStep += 1;
      } else if (cls.withOverdueActivityOnly) {
        m.deals.withOverdueActivity += 1;
        m.deals.withoutNextStep += 1;
      } else if (cls.hasOverdue) {
        m.deals.withOverdueActivity += 1;
      }
    }

    const modifyMs = parseDateMs(data.DATE_MODIFY || data.dateModify) ?? parseDateMs(data.DATE_CREATE);
    if (modifyMs != null && modifyMs <= thresholdMs) m.deals.stale += 1;
  }

  // Closed deals for period (optional extra pass only if period set)
  if (dateFrom || dateTo) {
    const closedFilter = { CLOSED: "Y" };
    if (dateFrom) closedFilter[">=CLOSEDATE"] = dateFrom;
    if (dateTo) closedFilter["<=CLOSEDATE"] = dateTo;
    if (params.responsibleIds?.length) closedFilter.ASSIGNED_BY_ID = params.responsibleIds;
    const closedPage = await dealListAll(
      {
        filter: closedFilter,
        select: ["ID", "STAGE_ID", "ASSIGNED_BY_ID", "CATEGORY_ID"],
      },
      { actionName: "manager_workload.closed_deals" }
    );
    restRequests += closedPage.pages || 0;
    if (closedPage.truncated) truncated = true;
    for (const item of closedPage.items || []) {
      const data = extractDealFields(item);
      const rid = data.ASSIGNED_BY_ID ?? data.assignedById ?? 0;
      const m = ensure(rid);
      const stageId = String(data.stageId || "").toUpperCase();
      if (stageId.includes("WON") || stageId.endsWith(":WON")) m.deals.closedWon += 1;
      else m.deals.closedLost += 1;
    }
  }

  // Activities by responsible (lead+deal index + contact index from dataset)
  const mergeActivityStats = (byResponsible) => {
    for (const [rid, list] of byResponsible.entries()) {
      if (params.responsibleIds?.length && !params.responsibleIds.map(String).includes(rid)) continue;
      const m = ensure(rid);
      for (const act of list) {
        m.activities.active += 1;
        if (act.isOverdue) m.activities.overdue += 1;
        if (act.isToday) m.activities.today += 1;
        if (act.isNext7Days) m.activities.next7Days += 1;
      }
    }
  };
  if (activityIndex.ok) mergeActivityStats(activityIndex.byResponsible);
  if (contactDataset.activityIndex?.byResponsible) {
    mergeActivityStats(contactDataset.activityIndex.byResponsible);
  }

  // Tasks
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  if (tasksAvailable) {
    for (const task of tasksResult.items || []) {
      const data = unwrapCrmItem(task);
      const rid = data.responsibleId || data.RESPONSIBLE_ID || 0;
      if (params.responsibleIds?.length && !params.responsibleIds.map(String).includes(String(rid))) {
        continue;
      }
      const m = ensure(rid);
      m.tasks.available = true;
      m.tasks.active += 1;
      const deadline = data.deadline || data.DEADLINE;
      const deadlineMs = parseDateMs(deadline);
      if (deadlineMs != null && deadlineMs < now) m.tasks.overdue += 1;
      if (deadlineMs != null && deadlineMs >= startOfToday.getTime() && deadlineMs < endOfToday.getTime()) {
        m.tasks.today += 1;
      }
    }
  } else {
    for (const m of managers.values()) {
      m.tasks = { available: false, active: null, overdue: null, today: null };
    }
  }

  // Filter inactive users if needed
  let managerList = [...managers.values()];
  if (params.responsibleIds?.length) {
    managerList = managerList.filter((m) =>
      params.responsibleIds.map(String).includes(String(m.responsibleId))
    );
  }
  if (!params.includeInactiveUsers) {
    managerList = managerList.filter(
      (m) =>
        m.contacts.total +
          m.leads.total +
          m.deals.total +
          m.activities.active +
          (m.tasks.active || 0) >
        0
    );
  }

  // Unknown user check
  if (params.responsibleIds?.length) {
    for (const id of params.responsibleIds) {
      if (!managers.has(String(id))) {
        warnings.push({
          code: "UNKNOWN_USER",
          message: `Пользователь ${id} не найден среди ответственных с данными CRM.`,
          responsibleId: Number(id),
        });
      }
    }
  }

  const users = await resolveUsersByIds(managerList.map((m) => m.responsibleId));
  let overdueActivitiesTotal = 0;
  let entitiesWithoutNextStep = 0;

  const resultManagers = managerList.map((m) => {
    overdueActivitiesTotal += m.activities.overdue;
    entitiesWithoutNextStep +=
      m.leads.withoutActivity +
      m.leads.withOverdueActivityOnly +
      m.deals.withoutNextStep +
      m.contacts.cycleWithoutNextActivity;

    const { qualityScore, qualityBreakdown } = calculateCrmQualityScore({
      contactsTotal: m.contacts.total,
      contactsWithoutStatus: m.contacts.withoutStatus,
      leadsTotal: m.leads.total,
      leadsWithoutActivity: m.leads.withoutActivity + m.leads.withOverdueActivityOnly,
      dealsTotal: m.deals.total,
      dealsWithoutNextStep: m.deals.withoutNextStep,
      activitiesActive: m.activities.active,
      activitiesOverdue: m.activities.overdue,
      entitiesTotal: m.leads.total + m.deals.total,
      entitiesStale: m.leads.stale + m.deals.stale,
    });

    const alerts = [];
    if (m.activities.overdue >= 10) {
      alerts.push({
        severity: "critical",
        code: "MANY_OVERDUE_ACTIVITIES",
        message: `Просроченных CRM-дел: ${m.activities.overdue}`,
      });
    }
    if (m.leads.total > 0 && (m.leads.withoutActivity + m.leads.withOverdueActivityOnly) / m.leads.total >= 0.2) {
      alerts.push({
        severity: "critical",
        code: "LEADS_WITHOUT_NEXT_STEP_RATIO",
        message: "Более 20% активных лидов без следующего CRM-дела",
      });
    }
    if (m.contacts.withoutStatus > 0) {
      alerts.push({
        severity: "critical",
        code: "CONTACTS_WITHOUT_STATUS",
        message: `Контактов без статуса: ${m.contacts.withoutStatus}`,
      });
    }

    // Enrich byStage with names for leads (compact)
    const leadsByStage = Object.entries(m.leads.byStage).map(([stageId, count]) => ({
      stageId,
      stageName: leadStageMap.get(String(stageId)) || stageId,
      count,
    }));

    return {
      responsibleId: m.responsibleId,
      responsibleName: users.get(String(m.responsibleId))?.name || null,
      contacts: m.contacts,
      leads: { ...m.leads, byStage: leadsByStage },
      deals: m.deals,
      activities: m.activities,
      tasks: m.tasks,
      qualityScore,
      qualityBreakdown,
      alerts,
    };
  });

  resultManagers.sort((a, b) => (b.activities.overdue || 0) - (a.activities.overdue || 0));

  const truncMeta = buildTruncationMeta(truncated);
  logAnalytics({
    action: "manager_workload",
    pages: contactDataset.pages || 0,
    items: contactDataset.total + activeLeads + activeDeals,
    contacts: contactDataset.total,
    leads: activeLeads,
    deals: activeDeals,
    activities: activityIndex.ok ? activityIndex.totalItems : 0,
    restRequests,
    durationMs: Date.now() - started,
    truncated,
    contactPasses: 1,
  });

  return {
    success: true,
    partial: warnings.length > 0 || truncated,
    reportType: "manager_workload",
    period: { dateFrom, dateTo },
    summary: {
      managers: resultManagers.length,
      activeLeads,
      activeDeals,
      overdueActivities: overdueActivitiesTotal,
      entitiesWithoutNextStep,
      tasksAvailable,
    },
    managers: resultManagers,
    warnings,
    ...truncMeta,
    diagnostics: {
      activityStrategy: "bulk",
      activityRequests:
        (activityIndex.ok ? activityIndex.activityRequests : 0) +
        (contactDataset.activityRequests || 0),
      entitiesChecked:
        contactDataset.total + activeLeads + activeDeals,
      contactPasses: 1,
      restRequests,
    },
  };
}

/**
 * Сводный управленческий отчёт дисциплины CRM.
 */
export async function crm_discipline_report(params = {}) {
  const started = Date.now();
  const inactiveDays = Number(params.inactiveDays ?? 14);

  const workload = await manager_workload({
    ...params,
    inactiveDays,
  });

  // Reuse workload; supplement with stale counts from managers aggregation
  let staleLeads = 0;
  let staleDeals = 0;
  let leadsWithoutActivity = 0;
  let dealsWithoutNextStep = 0;
  let contactsWithoutStatus = 0;
  let contactsCycleWithoutActivity = 0;
  let overdueActivities = 0;
  let financialRiskByCurrency = {};

  const byManager = [];
  for (const m of workload.managers || []) {
    staleLeads += m.leads.stale || 0;
    staleDeals += m.deals.stale || 0;
    leadsWithoutActivity += (m.leads.withoutActivity || 0) + (m.leads.withOverdueActivityOnly || 0);
    dealsWithoutNextStep += m.deals.withoutNextStep || 0;
    contactsWithoutStatus += m.contacts.withoutStatus || 0;
    contactsCycleWithoutActivity += m.contacts.cycleWithoutNextActivity || 0;
    overdueActivities += m.activities.overdue || 0;

    for (const [currency, sum] of Object.entries(m.deals.sumsByCurrency || {})) {
      // financial risk: stale deals approx — use manager stale share if sums available
      if ((m.deals.stale || 0) > 0 && (m.deals.total || 0) > 0) {
        const share = m.deals.stale / m.deals.total;
        financialRiskByCurrency[currency] =
          (financialRiskByCurrency[currency] || 0) + Number(sum) * share;
      }
    }

    byManager.push({
      responsibleId: m.responsibleId,
      responsibleName: m.responsibleName,
      qualityScore: m.qualityScore,
      overdueActivities: m.activities.overdue,
      leadsWithoutActivity: (m.leads.withoutActivity || 0) + (m.leads.withOverdueActivityOnly || 0),
      dealsWithoutNextStep: m.deals.withoutNextStep,
      staleLeads: m.leads.stale,
      staleDeals: m.deals.stale,
      contactsWithoutStatus: m.contacts.withoutStatus,
      alerts: m.alerts,
    });
  }

  const criticalAlerts = [];
  const warningAlerts = [];

  if (contactsWithoutStatus > 0) {
    criticalAlerts.push({
      code: "CONTACT_WITHOUT_STATUS",
      title: "Контакты без статуса",
      count: contactsWithoutStatus,
      severity: "critical",
    });
  }
  if (contactsCycleWithoutActivity > 0) {
    criticalAlerts.push({
      code: "CONTACT_CYCLE_WITHOUT_ACTIVITY",
      title: "Контакты в цикле без следующего дела",
      count: contactsCycleWithoutActivity,
      severity: "critical",
    });
  }
  if (leadsWithoutActivity > 0) {
    criticalAlerts.push({
      code: "LEADS_WITHOUT_NEXT_ACTIVITY",
      title: "Лиды без следующего CRM-дела",
      count: leadsWithoutActivity,
      severity: "critical",
    });
  }
  if (dealsWithoutNextStep > 0) {
    criticalAlerts.push({
      code: "DEALS_WITHOUT_NEXT_STEP",
      title: "Сделки без следующего шага",
      count: dealsWithoutNextStep,
      severity: "critical",
    });
  }
  if (overdueActivities > 0) {
    criticalAlerts.push({
      code: "OVERDUE_ACTIVITIES",
      title: "Просроченные CRM-дела",
      count: overdueActivities,
      severity: "critical",
    });
  }
  if (staleLeads > 0) {
    warningAlerts.push({
      code: "STALE_LEADS",
      title: `Лиды без изменений более ${inactiveDays} дней`,
      count: staleLeads,
      severity: "warning",
    });
  }
  if (staleDeals > 0) {
    warningAlerts.push({
      code: "STALE_DEALS",
      title: `Сделки без изменений более ${inactiveDays} дней`,
      count: staleDeals,
      severity: "warning",
    });
  }

  for (const w of workload.warnings || []) {
    warningAlerts.push({ ...w, severity: w.code === "TASKS_ACCESS_DENIED" ? "warning" : "warning" });
  }

  const recommendations = [];
  for (const m of byManager) {
    if ((m.overdueActivities || 0) >= 10) {
      recommendations.push(
        `Провести разбор просрочек с ${m.responsibleName || `#${m.responsibleId}`} (${m.overdueActivities} дел).`
      );
    }
  }
  if (workload.summary?.activeLeads > 0 && leadsWithoutActivity / workload.summary.activeLeads >= 0.2) {
    recommendations.push(
      "Более 20% активных лидов без следующего CRM-дела — нарушение методологии ведения CRM."
    );
  }
  const riskEntries = Object.entries(financialRiskByCurrency).filter(([, v]) => v > 0);
  if (riskEntries.length) {
    const formatted = riskEntries
      .map(([c, v]) => `${Math.round(v).toLocaleString("ru-RU")} ${c}`)
      .join("; ");
    recommendations.push(`Финансовый риск по сделкам без движения (оценка): ${formatted}.`);
  }
  if (!workload.summary?.tasksAvailable) {
    recommendations.push(
      "Метрики задач неполны: добавьте права Tasks во входящем вебхуке Bitrix24."
    );
  }
  if (contactsWithoutStatus > 0) {
    recommendations.push(`Заполнить статус у ${contactsWithoutStatus} контактов.`);
  }
  if (!recommendations.length) {
    recommendations.push("Критических нарушений дисциплины CRM не выявлено.");
  }

  logAnalytics({
    action: "crm_discipline_report",
    pages: 0,
    items: byManager.length,
    durationMs: Date.now() - started,
    truncated: Boolean(workload.truncated),
  });

  return {
    success: true,
    partial: Boolean(workload.partial),
    reportType: "crm_discipline",
    summary: {
      contactsWithoutStatus,
      contactsCycleWithoutActivity,
      leadsWithoutActivity,
      dealsWithoutNextStep,
      staleLeads,
      staleDeals,
      overdueActivities,
      overdueTasks: workload.summary?.tasksAvailable
        ? (workload.managers || []).reduce((s, m) => s + (m.tasks?.overdue || 0), 0)
        : null,
      tasksAvailable: workload.summary?.tasksAvailable ?? false,
    },
    criticalAlerts,
    warnings: warningAlerts,
    byManager,
    financialRiskByCurrency,
    recommendations,
    truncated: workload.truncated,
    warning: workload.warning || null,
    diagnostics: workload.diagnostics,
  };
}
