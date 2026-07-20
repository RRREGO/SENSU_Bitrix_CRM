import { lead_stage_list, lead_list, leadListAll } from "./leadActions.js";
import { dealListAll } from "./dealActions.js";
import { deal_stage_list } from "./crmActions.js";
import { activity_list, activityListAll } from "./timelineActions.js";
import { searchTasksAll } from "./taskActions.js";
import {
  PAGINATION,
  unwrapCrmItem,
  extractDealFields,
  notImplementedAction,
  buildStageNameMap,
  addCurrencyAmount,
  logAnalytics,
} from "./helpers.js";

function sampleItems(items, limit = PAGINATION.SAMPLE_LIMIT) {
  return Array.isArray(items) ? items.slice(0, limit) : [];
}

function formatTotalsByCurrency(totalsByCurrency = {}) {
  return Object.fromEntries(
    Object.entries(totalsByCurrency).map(([currency, sum]) => [currency, Number(sum) || 0])
  );
}

function mapDealRow(deal, stageNames = new Map()) {
  const data = extractDealFields(deal);
  const stageId = data.stageId || "UNKNOWN";
  return {
    id: data.ID || data.id,
    title: data.title || data.TITLE,
    stageId,
    stageName: stageNames.get(String(stageId)) || stageId,
    opportunity: data.opportunity || 0,
    currencyId: data.currencyId || "RUB",
    assignedById: data.ASSIGNED_BY_ID || data.assignedById,
    dateCreate: data.DATE_CREATE || data.dateCreate,
    closeDate: data.CLOSEDATE || data.closeDate,
  };
}

/** Подсчёт лидов по стадиям. */
export async function lead_count_by_stage() {
  const stages = await lead_stage_list({});
  const stageList = Array.isArray(stages) ? stages : [];

  const { items: leads } = await leadListAll(
    { select: ["ID", "id", "STATUS_ID", "statusId"] },
    { actionName: "lead_count_by_stage" }
  );

  const counts = {};
  for (const lead of leads) {
    const data = unwrapCrmItem(lead);
    const stageId = data.STATUS_ID || data.statusId || "UNKNOWN";
    counts[stageId] = (counts[stageId] || 0) + 1;
  }

  return stageList.map((stage) => ({
    stageId: stage.STATUS_ID || stage.statusId,
    stageName: stage.NAME || stage.name,
    count: counts[stage.STATUS_ID || stage.statusId] || 0,
  }));
}

/** Подсчёт сделок по стадиям в воронке. */
export async function deal_count_by_stage(params = {}) {
  const categoryId = params.categoryId ?? 0;
  const stages = await deal_stage_list({ categoryId });
  const stageList = Array.isArray(stages) ? stages : [];

  const { items: deals } = await dealListAll(
    {
      filter: { CATEGORY_ID: categoryId },
      select: ["ID", "id", "STAGE_ID", "stageId"],
    },
    { actionName: "deal_count_by_stage" }
  );

  const counts = {};
  for (const deal of deals) {
    const data = extractDealFields(deal);
    const stageId = data.stageId || "UNKNOWN";
    counts[stageId] = (counts[stageId] || 0) + 1;
  }

  return stageList.map((stage) => {
    const stageId = stage.STATUS_ID || stage.statusId;
    return {
      stageId,
      stageName: stage.NAME || stage.name,
      count: counts[stageId] || 0,
    };
  });
}

/** Сумма сделок по стадиям в воронке (с группировкой по валютам). */
export async function deal_sum_by_stage(params = {}) {
  const categoryId = params.categoryId ?? 0;
  const stages = await deal_stage_list({ categoryId });
  const stageList = Array.isArray(stages) ? stages : [];

  const { items: deals } = await dealListAll(
    {
      filter: { CATEGORY_ID: categoryId },
      select: [
        "ID",
        "id",
        "STAGE_ID",
        "stageId",
        "OPPORTUNITY",
        "opportunity",
        "CURRENCY_ID",
        "currencyId",
      ],
    },
    { actionName: "deal_sum_by_stage" }
  );

  const stats = {};
  const totalsByCurrency = {};

  for (const deal of deals) {
    const data = extractDealFields(deal);
    const stageId = data.stageId || "UNKNOWN";
    const currencyId = data.currencyId || "RUB";
    if (!stats[stageId]) {
      stats[stageId] = { count: 0, sum: 0, totalsByCurrency: {} };
    }
    stats[stageId].count += 1;
    stats[stageId].sum += data.opportunity || 0;
    addCurrencyAmount(stats[stageId].totalsByCurrency, currencyId, data.opportunity);
    addCurrencyAmount(totalsByCurrency, currencyId, data.opportunity);
  }

  return {
    categoryId,
    totalsByCurrency: formatTotalsByCurrency(totalsByCurrency),
    byStage: stageList.map((stage) => {
      const stageId = stage.STATUS_ID || stage.statusId;
      const s = stats[stageId] || { count: 0, sum: 0, totalsByCurrency: {} };
      return {
        stageId,
        stageName: stage.NAME || stage.name,
        count: s.count,
        sum: s.sum,
        totalsByCurrency: formatTotalsByCurrency(s.totalsByCurrency),
      };
    }),
  };
}

/** Упрощённый отчёт конверсии лидов по текущим стадиям. */
export async function lead_conversion_report(params = {}) {
  const { dateFrom, dateTo } = params;
  const filter = {};

  if (dateFrom) filter[">=DATE_CREATE"] = dateFrom;
  if (dateTo) filter["<=DATE_CREATE"] = dateTo;

  const byStage = await lead_count_by_stage();
  const { total, items } = await lead_list({ filter, select: ["ID"], limit: 1 });

  return {
    note: "Это отчёт по текущему состоянию лидов, не историческая конверсия.",
    period: { dateFrom, dateTo },
    totalInPeriod: total ?? items.length,
    byStage,
  };
}

/** Сводка по воронке сделок. */
export async function crm_funnel_summary(params = {}) {
  const categoryId = params.categoryId ?? 0;

  const sumReport = await deal_sum_by_stage({ categoryId });
  const byStage = sumReport.byStage || [];
  const totalDeals = byStage.reduce((sum, s) => sum + s.count, 0);
  const totalsByCurrency = sumReport.totalsByCurrency || {};

  let overdueCount = 0;
  try {
    const { total, items, returned } = await activity_list({
      filter: {
        COMPLETED: "N",
        "<DEADLINE": new Date().toISOString(),
      },
      select: ["ID"],
      limit: 1,
    });
    overdueCount = total ?? returned ?? items.length;
  } catch (error) {
    console.warn("crm_funnel_summary overdue activities:", error.message);
  }

  return {
    categoryId,
    totalDeals,
    totalsByCurrency,
    // totalSum оставлен для обратной совместимости UI; не смешивает валюты в одном числе.
    totalSum: null,
    byStage,
    overdueActivitiesCount: overdueCount,
    note: "Суммы сгруппированы по валютам в totalsByCurrency. dealsWithoutNextStep — отдельный отчёт.",
  };
}

/** Отчёт по просроченным делам. */
export async function overdue_activity_report(params = {}) {
  const filter = {
    COMPLETED: "N",
    "<DEADLINE": new Date().toISOString(),
    ...(params.filter || {}),
  };

  const { items, total, pages, truncated } = await activityListAll(
    {
      filter,
      select: ["ID", "SUBJECT", "DEADLINE", "OWNER_ID", "OWNER_TYPE_ID", "RESPONSIBLE_ID"],
    },
    { actionName: "overdue_activity_report" }
  );

  const sample = sampleItems(items).map((item) => {
    const data = unwrapCrmItem(item);
    return {
      id: data.ID || data.id,
      subject: data.SUBJECT || data.subject,
      deadline: data.DEADLINE || data.deadline,
      ownerId: data.OWNER_ID || data.ownerId,
      ownerTypeId: data.OWNER_TYPE_ID || data.ownerTypeId,
      responsibleId: data.RESPONSIBLE_ID || data.responsibleId,
    };
  });

  return {
    count: total ?? items.length,
    returned: sample.length,
    hasMore: items.length > sample.length || truncated,
    activities: sample,
    pages,
    truncated,
    note: "Сущности без будущих активностей требуют отдельного анализа по OWNER_ID",
  };
}

/** Просроченные задачи. */
export async function overdue_tasks_report(params = {}) {
  const now = new Date().toISOString();

  try {
    const { items, total, pages, truncated } = await searchTasksAll(
      {
        filter: {
          "<DEADLINE": now,
          "!STATUS": 5,
          ...(params.filter || {}),
        },
        select: ["ID", "TITLE", "DEADLINE", "STATUS", "RESPONSIBLE_ID"],
      },
      { actionName: "overdue_tasks_report" }
    );

    const sample = sampleItems(items).map((task) => {
      const data = unwrapCrmItem(task);
      return {
        id: data.id || data.ID,
        title: data.title || data.TITLE,
        deadline: data.deadline || data.DEADLINE,
        status: data.status || data.STATUS,
        responsibleId: data.responsibleId || data.RESPONSIBLE_ID,
      };
    });

    return {
      count: total ?? items.length,
      returned: sample.length,
      hasMore: items.length > sample.length || truncated,
      tasks: sample,
      pages,
      truncated,
      note: "Просроченные задачи со статусом, отличным от выполненной.",
    };
  } catch (error) {
    return {
      success: false,
      count: 0,
      returned: 0,
      hasMore: false,
      tasks: [],
      error: {
        code: "TASKS_ACCESS_DENIED",
        message:
          error.message ||
          "Не удалось получить задачи. Проверьте права webhook на модуль tasks.",
      },
    };
  }
}

/** Сделки без запланированного следующего шага. */
export async function deals_without_next_step(params = {}) {
  const started = Date.now();
  const categoryId = params.categoryId ?? 0;
  const stages = await deal_stage_list({ categoryId });
  const stageNames = buildStageNameMap(Array.isArray(stages) ? stages : []);

  const { items: deals, pages, truncated } = await dealListAll(
    {
      filter: { CATEGORY_ID: categoryId, CLOSED: "N" },
      select: ["ID", "id", "TITLE", "title", "STAGE_ID", "stageId", "ASSIGNED_BY_ID"],
    },
    { actionName: "deals_without_next_step.deals" }
  );

  const { items: futureActivities } = await activityListAll(
    {
      filter: {
        OWNER_TYPE_ID: 2,
        COMPLETED: "N",
        ">=DEADLINE": new Date().toISOString(),
      },
      select: ["ID", "OWNER_ID"],
    },
    { actionName: "deals_without_next_step.activities" }
  );

  const dealsWithFutureActivity = new Set();
  for (const activity of futureActivities) {
    const data = unwrapCrmItem(activity);
    const ownerId = data.OWNER_ID || data.ownerId;
    if (ownerId != null) dealsWithFutureActivity.add(String(ownerId));
  }

  const withoutNextStep = deals
    .map((deal) => mapDealRow(deal, stageNames))
    .filter((deal) => !dealsWithFutureActivity.has(String(deal.id)));

  const sample = sampleItems(withoutNextStep);

  logAnalytics({
    action: "deals_without_next_step",
    pages,
    items: withoutNextStep.length,
    durationMs: Date.now() - started,
    truncated,
  });

  return {
    categoryId,
    count: withoutNextStep.length,
    returned: sample.length,
    hasMore: withoutNextStep.length > sample.length,
    deals: sample,
    truncated,
    note: "Сделки без незавершённых активностей с дедлайном в будущем.",
  };
}

/** Лиды без ответственного. */
export async function leads_without_responsible(params = {}) {
  const stages = await lead_stage_list({});
  const stageNames = buildStageNameMap(Array.isArray(stages) ? stages : []);

  const { items: leads, pages, truncated } = await leadListAll(
    {
      filter: {
        ASSIGNED_BY_ID: 0,
        ...(params.filter || {}),
      },
      select: ["ID", "id", "TITLE", "title", "STATUS_ID", "statusId", "DATE_CREATE", "ASSIGNED_BY_ID"],
    },
    { actionName: "leads_without_responsible" }
  );

  const unassigned = leads
    .map((lead) => {
      const data = unwrapCrmItem(lead);
      const assigned = data.ASSIGNED_BY_ID ?? data.assignedById;
      if (assigned && Number(assigned) !== 0) return null;
      const statusId = data.STATUS_ID || data.statusId;
      return {
        id: data.ID || data.id,
        title: data.TITLE || data.title,
        statusId,
        stageName: stageNames.get(String(statusId)) || statusId,
        dateCreate: data.DATE_CREATE || data.dateCreate,
      };
    })
    .filter(Boolean);

  const sample = sampleItems(unassigned);

  return {
    count: unassigned.length,
    returned: sample.length,
    hasMore: unassigned.length > sample.length || truncated,
    leads: sample,
    pages,
    truncated,
  };
}

/** Алиас для отчёта лидов без ответственного. */
export async function leads_without_assigned(params = {}) {
  return leads_without_responsible(params);
}

/** Сделки без любой активности. */
export async function deals_without_activity(params = {}) {
  const started = Date.now();
  const categoryId = params.categoryId ?? 0;
  const stages = await deal_stage_list({ categoryId });
  const stageNames = buildStageNameMap(Array.isArray(stages) ? stages : []);

  const { items: deals, pages, truncated } = await dealListAll(
    {
      filter: { CATEGORY_ID: categoryId, CLOSED: "N" },
      select: ["ID", "id", "TITLE", "title", "STAGE_ID", "stageId"],
    },
    { actionName: "deals_without_activity.deals" }
  );

  const { items: activities } = await activityListAll(
    {
      filter: { OWNER_TYPE_ID: 2 },
      select: ["ID", "OWNER_ID"],
    },
    { actionName: "deals_without_activity.activities" }
  );

  const dealsWithActivity = new Set();
  for (const activity of activities) {
    const data = unwrapCrmItem(activity);
    const ownerId = data.OWNER_ID || data.ownerId;
    if (ownerId != null) dealsWithActivity.add(String(ownerId));
  }

  const withoutActivity = deals
    .map((deal) => mapDealRow(deal, stageNames))
    .filter((deal) => !dealsWithActivity.has(String(deal.id)));

  const sample = sampleItems(withoutActivity);

  logAnalytics({
    action: "deals_without_activity",
    pages,
    items: withoutActivity.length,
    durationMs: Date.now() - started,
    truncated,
  });

  return {
    categoryId,
    count: withoutActivity.length,
    returned: sample.length,
    hasMore: withoutActivity.length > sample.length,
    deals: sample,
    truncated,
    note: "Сделки без зарегистрированных активностей.",
  };
}

/** Новые сделки за период. */
export async function new_deals_period(params = {}) {
  const categoryId = params.categoryId ?? 0;
  const filter = { CATEGORY_ID: categoryId };
  if (params.dateFrom) filter[">=DATE_CREATE"] = params.dateFrom;
  if (params.dateTo) filter["<=DATE_CREATE"] = params.dateTo;

  const stages = await deal_stage_list({ categoryId });
  const stageNames = buildStageNameMap(Array.isArray(stages) ? stages : []);

  const { items: deals, total, pages, truncated } = await dealListAll(
    {
      filter,
      select: [
        "ID",
        "id",
        "TITLE",
        "title",
        "STAGE_ID",
        "stageId",
        "OPPORTUNITY",
        "opportunity",
        "CURRENCY_ID",
        "currencyId",
        "DATE_CREATE",
      ],
      order: { DATE_CREATE: "DESC" },
    },
    { actionName: "new_deals_period" }
  );

  const mapped = deals.map((deal) => mapDealRow(deal, stageNames));
  const totalsByCurrency = {};
  for (const deal of mapped) {
    addCurrencyAmount(totalsByCurrency, deal.currencyId, deal.opportunity);
  }

  const sample = sampleItems(mapped);

  return {
    categoryId,
    count: total ?? mapped.length,
    totalsByCurrency: formatTotalsByCurrency(totalsByCurrency),
    totalSum: null,
    returned: sample.length,
    hasMore: mapped.length > sample.length || truncated,
    deals: sample,
    pages,
    truncated,
    period: { dateFrom: params.dateFrom, dateTo: params.dateTo },
  };
}

/** Закрытые сделки за период. */
export async function closed_deals_period(params = {}) {
  const categoryId = params.categoryId ?? 0;
  const filter = { CATEGORY_ID: categoryId, CLOSED: "Y" };
  if (params.dateFrom) filter[">=CLOSEDATE"] = params.dateFrom;
  if (params.dateTo) filter["<=CLOSEDATE"] = params.dateTo;

  const stages = await deal_stage_list({ categoryId });
  const stageNames = buildStageNameMap(Array.isArray(stages) ? stages : []);

  const { items: deals, total, pages, truncated } = await dealListAll(
    {
      filter,
      select: [
        "ID",
        "id",
        "TITLE",
        "title",
        "STAGE_ID",
        "stageId",
        "OPPORTUNITY",
        "opportunity",
        "CURRENCY_ID",
        "currencyId",
        "CLOSEDATE",
      ],
      order: { CLOSEDATE: "DESC" },
    },
    { actionName: "closed_deals_period" }
  );

  const mapped = deals.map((deal) => mapDealRow(deal, stageNames));
  const totalsByCurrency = {};
  for (const deal of mapped) {
    addCurrencyAmount(totalsByCurrency, deal.currencyId, deal.opportunity);
  }

  const sample = sampleItems(mapped);

  return {
    categoryId,
    count: total ?? mapped.length,
    totalsByCurrency: formatTotalsByCurrency(totalsByCurrency),
    totalSum: null,
    returned: sample.length,
    hasMore: mapped.length > sample.length || truncated,
    deals: sample,
    pages,
    truncated,
    period: { dateFrom: params.dateFrom, dateTo: params.dateTo },
  };
}

export const sales_forecast = notImplementedAction("sales_forecast");
