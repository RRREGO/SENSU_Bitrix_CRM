/**
 * Сборщики плановых отчётов — только существующие read-only actions.
 */

import { crm_discipline_report } from "../actions/managerAnalyticsActions.js";
import { contacts_birthday_activity_report } from "../actions/contactAnalyticsActions.js";
import { new_deals_period, closed_deals_period } from "../actions/analyticsActions.js";
import { stale_leads_report, stale_deals_report } from "../actions/managerAnalyticsActions.js";
import { evaluateAlertRules, computeMetricTrends, DEFAULT_ALERT_RULES } from "./alertEvaluator.js";
import { getScheduledReportDef } from "./reportRegistry.js";
import { formatIsoInZone, getZonedParts } from "./scheduleCalculator.js";
import { getSchedulerConfig } from "./config.js";
import { sanitizeLlmPayload } from "../llm/sanitize.js";
import { askClaude } from "../claudeClient.js";

function todayRange(tz) {
  const p = getZonedParts(new Date(), tz);
  const d = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return { dateFrom: d, dateTo: d };
}

function lastDaysRange(tz, days) {
  const end = getZonedParts(new Date(), tz);
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
  const start = getZonedParts(startDate, tz);
  return {
    dateFrom: `${start.year}-${String(start.month).padStart(2, "0")}-${String(start.day).padStart(2, "0")}`,
    dateTo: `${end.year}-${String(end.month).padStart(2, "0")}-${String(end.day).padStart(2, "0")}`,
  };
}

function pickNumber(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Метрики из crm_discipline / manager_workload */
export function extractMetricsFromDiscipline(discipline, birthday = null) {
  const summary = discipline?.summary || discipline?.totals || {};
  const alerts = discipline?.criticalAlerts || [];
  const metrics = {
    overdueActivities: pickNumber(
      summary.overdueActivities,
      summary.overdueCrmActivities,
      discipline?.overdueActivities?.count,
      alerts.find((a) => /просроч/i.test(a.title || a.message || ""))?.count
    ),
    leadsWithoutNextActivity: pickNumber(
      summary.leadsWithoutNextActivity,
      discipline?.leadsWithoutNextActivity?.count
    ),
    dealsWithoutNextStep: pickNumber(
      summary.dealsWithoutNextStep,
      discipline?.dealsWithoutNextStep?.count
    ),
    contactsWithoutStatus: pickNumber(
      summary.contactsWithoutStatus,
      discipline?.contactQuality?.withoutStatus
    ),
    contactsCycleWithoutNextActivity: pickNumber(
      summary.contactsCycleWithoutNextActivity,
      discipline?.contactQuality?.cycleWithoutNextActivity
    ),
    staleDeals: pickNumber(summary.staleDeals, discipline?.staleDeals?.count),
    staleLeads: pickNumber(summary.staleLeads, discipline?.staleLeads?.count),
    activeLeads: pickNumber(summary.activeLeads, summary.openLeads),
    activeDeals: pickNumber(summary.activeDeals, summary.openDeals),
    overdueBirthdayGreetings: 0,
    missingBirthdayActivities: 0,
    leadsWithoutNextActivityPercent: 0,
  };

  if (birthday) {
    metrics.overdueBirthdayGreetings = pickNumber(
      birthday.overdueCount,
      birthday.summary?.overdue,
      birthday.overdue?.length
    );
    metrics.missingBirthdayActivities = pickNumber(
      birthday.missingActivityCount,
      birthday.summary?.missingActivity,
      birthday.missing?.length
    );
  }

  const leadBase = metrics.activeLeads || pickNumber(summary.leadTotal);
  if (leadBase > 0) {
    metrics.leadsWithoutNextActivityPercent = Math.round(
      (metrics.leadsWithoutNextActivity / leadBase) * 100
    );
  }

  // Prefer structured criticalAlerts counts when present
  for (const a of alerts) {
    const code = String(a.code || a.id || "").toLowerCase();
    const c = pickNumber(a.count, a.value);
    if (/without_status|без статус/.test(code + (a.title || ""))) metrics.contactsWithoutStatus = c || metrics.contactsWithoutStatus;
    if (/cycle/.test(code)) metrics.contactsCycleWithoutNextActivity = c || metrics.contactsCycleWithoutNextActivity;
    if (/lead.*next|лид/.test(code + (a.title || ""))) metrics.leadsWithoutNextActivity = c || metrics.leadsWithoutNextActivity;
    if (/deal.*next|сделк/.test(code + (a.title || ""))) metrics.dealsWithoutNextStep = c || metrics.dealsWithoutNextStep;
    if (/overdue|просроч/.test(code + (a.title || ""))) metrics.overdueActivities = c || metrics.overdueActivities;
  }

  return metrics;
}

function envelope(reportType, period, sections, metrics, alerts, warnings, recommendations, partial) {
  const cfg = getSchedulerConfig();
  return {
    reportType,
    generatedAt: formatIsoInZone(new Date(), cfg.timezone),
    period,
    summary: metrics,
    criticalAlerts: alerts.filter((a) => a.severity === "critical"),
    warnings: [
      ...warnings,
      ...alerts.filter((a) => a.severity === "warning"),
    ],
    sections,
    recommendations,
    metrics,
    partial: Boolean(partial),
    source: "Bitrix24",
  };
}

async function softCall(fn, label) {
  try {
    const result = await fn();
    return { ok: true, result, warning: null };
  } catch (error) {
    return {
      ok: false,
      result: null,
      warning: {
        code: "BITRIX_TEMPORARY_ERROR",
        message: `${label}: ${error.message}`,
        source: label,
      },
    };
  }
}

export async function buildDailyDirectorBrief(params = {}) {
  const cfg = getSchedulerConfig();
  const period = todayRange(cfg.timezone);
  const warnings = [];
  const sections = [];

  const disc = await softCall(
    () => crm_discipline_report({ ...(params.discipline || {}), categoryId: params.categoryId }),
    "crm_discipline_report"
  );
  if (!disc.ok) warnings.push(disc.warning);
  else {
    sections.push({
      id: "discipline",
      title: "Дисциплина CRM / нагрузка",
      data: {
        summary: disc.result.summary || disc.result.totals || null,
        criticalAlerts: disc.result.criticalAlerts || [],
        financialRiskByCurrency: disc.result.financialRiskByCurrency || null,
        managersSample: (disc.result.managers || disc.result.byManager || []).slice?.(0, 15) || null,
      },
    });
    if (disc.result.partial || disc.result.truncated) {
      warnings.push({ code: "PARTIAL_REPORT", message: "Часть источников дисциплины CRM недоступна или усечена." });
    }
    for (const w of disc.result.warnings || []) {
      warnings.push(typeof w === "string" ? { code: "SOURCE_WARNING", message: w } : w);
    }
  }

  const bday = await softCall(
    () =>
      contacts_birthday_activity_report({
        daysAhead: params.daysAhead || 7,
      }),
    "contacts_birthday_activity_report"
  );
  if (!bday.ok) warnings.push(bday.warning);
  else {
    sections.push({
      id: "birthdays",
      title: "Дни рождения",
      data: {
        summary: bday.result.summary || null,
        overdue: bday.result.overdue?.length ?? bday.result.overdueCount,
        upcoming: bday.result.upcoming?.length ?? bday.result.upcomingCount,
      },
    });
  }

  const metrics = extractMetricsFromDiscipline(disc.result, bday.result);
  const rules = params.alertRules || getScheduledReportDef("daily_director_brief").defaultAlertRules;
  const { alerts } = evaluateAlertRules(metrics, rules);

  if (warnings.some((w) => /TASKS|tasks/i.test(JSON.stringify(w)))) {
    alerts.push({
      code: "TASKS_UNAVAILABLE",
      severity: "warning",
      title: "Tasks недоступны",
      count: null,
      source: "tasks",
      message: "Права Tasks у webhook отсутствуют — метрики задач неполны.",
    });
  }

  const recommendations = disc.result?.recommendations || [
    "Закрыть критические нарушения дисциплины CRM.",
    "Проверить просроченные дела и ДР.",
  ];

  return envelope(
    "daily_director_brief",
    period,
    sections,
    metrics,
    alerts,
    warnings,
    recommendations,
    warnings.length > 0 || disc.result?.partial
  );
}

export async function buildWeeklySalesSummary(params = {}, previousMetrics = null) {
  const cfg = getSchedulerConfig();
  const period = lastDaysRange(cfg.timezone, 7);
  const warnings = [];
  const sections = [];

  const disc = await softCall(
    () => crm_discipline_report({ categoryId: params.categoryId }),
    "crm_discipline_report"
  );
  if (!disc.ok) warnings.push(disc.warning);
  else {
    sections.push({
      id: "discipline",
      title: "Качество CRM по менеджерам",
      data: {
        summary: disc.result.summary || null,
        criticalAlerts: disc.result.criticalAlerts || [],
      },
    });
  }

  const neu = await softCall(
    () => new_deals_period({ dateFrom: period.dateFrom, dateTo: period.dateTo, categoryId: params.categoryId }),
    "new_deals_period"
  );
  if (!neu.ok) warnings.push(neu.warning);
  else sections.push({ id: "new_deals", title: "Новые сделки", data: { count: neu.result.count ?? neu.result.total, byCurrency: neu.result.totalsByCurrency } });

  const closed = await softCall(
    () => closed_deals_period({ dateFrom: period.dateFrom, dateTo: period.dateTo, categoryId: params.categoryId }),
    "closed_deals_period"
  );
  if (!closed.ok) warnings.push(closed.warning);
  else
    sections.push({
      id: "closed_deals",
      title: "Закрытые сделки",
      data: {
        won: closed.result.wonCount ?? closed.result.successCount,
        lost: closed.result.lostCount ?? closed.result.failCount,
        byCurrency: closed.result.totalsByCurrency,
      },
    });

  const staleL = await softCall(() => stale_leads_report({ days: params.staleDays || 14 }), "stale_leads_report");
  const staleD = await softCall(() => stale_deals_report({ days: params.staleDays || 14 }), "stale_deals_report");
  if (staleL.ok) sections.push({ id: "stale_leads", title: "Зависшие лиды", data: { count: staleL.result.count } });
  else warnings.push(staleL.warning);
  if (staleD.ok) sections.push({ id: "stale_deals", title: "Зависшие сделки", data: { count: staleD.result.count } });
  else warnings.push(staleD.warning);

  sections.push({
    id: "stage_movement",
    title: "Движение по стадиям",
    data: {
      available: false,
      message: "История стадий Bitrix24 в приложении недоступна — движение не рассчитывается.",
    },
  });

  const metrics = extractMetricsFromDiscipline(disc.result);
  metrics.staleLeads = pickNumber(staleL.result?.count, metrics.staleLeads);
  metrics.staleDeals = pickNumber(staleD.result?.count, metrics.staleDeals);
  metrics.newDeals = pickNumber(neu.result?.count, neu.result?.total);
  metrics.closedWon = pickNumber(closed.result?.wonCount, closed.result?.successCount);
  metrics.closedLost = pickNumber(closed.result?.lostCount, closed.result?.failCount);

  const trends = computeMetricTrends(metrics, previousMetrics);
  if (trends.length) sections.push({ id: "trends", title: "Динамика к прошлому отчёту", data: { trends } });

  const rules = params.alertRules || getScheduledReportDef("weekly_sales_summary").defaultAlertRules;
  const { alerts } = evaluateAlertRules(metrics, rules);

  return envelope(
    "weekly_sales_summary",
    period,
    sections,
    metrics,
    alerts,
    warnings,
    disc.result?.recommendations || ["Сфокусироваться на снижении просрочек и зависших сущностей."],
    warnings.length > 0 || disc.result?.partial
  );
}

export async function buildCrmDiscipline(params = {}) {
  const cfg = getSchedulerConfig();
  const period = todayRange(cfg.timezone);
  const warnings = [];
  const disc = await softCall(() => crm_discipline_report({ categoryId: params.categoryId }), "crm_discipline_report");
  if (!disc.ok) {
    return envelope("crm_discipline", period, [], {}, [], [disc.warning], [], true);
  }
  for (const w of disc.result.warnings || []) {
    warnings.push(typeof w === "string" ? { code: "SOURCE_WARNING", message: w } : w);
  }
  const metrics = extractMetricsFromDiscipline(disc.result);
  const { alerts } = evaluateAlertRules(
    metrics,
    params.alertRules || getScheduledReportDef("crm_discipline").defaultAlertRules
  );
  return envelope(
    "crm_discipline",
    period,
    [{ id: "discipline", title: "Дисциплина CRM", data: disc.result }],
    metrics,
    alerts,
    warnings,
    disc.result.recommendations || [],
    disc.result.partial || warnings.length > 0
  );
}

export async function buildBirthdayControl(params = {}) {
  const cfg = getSchedulerConfig();
  const period = todayRange(cfg.timezone);
  const bday = await softCall(
    () => contacts_birthday_activity_report({ daysAhead: params.daysAhead || 7 }),
    "contacts_birthday_activity_report"
  );
  if (!bday.ok) {
    return envelope("birthday_control", period, [], {}, [], [bday.warning], [], true);
  }
  const metrics = extractMetricsFromDiscipline(null, bday.result);
  const { alerts } = evaluateAlertRules(
    metrics,
    params.alertRules || getScheduledReportDef("birthday_control").defaultAlertRules
  );
  return envelope(
    "birthday_control",
    period,
    [{ id: "birthdays", title: "Контроль ДР", data: bday.result }],
    metrics,
    alerts,
    bday.result.warnings || [],
    ["Создать дела на поздравление для ближайших ДР (вручную через Safety)."],
    bday.result.partial
  );
}

let testOverride = null;

/** Только для тестов */
export function setReportBuilderOverride(fn) {
  testOverride = fn;
}

export async function runRegisteredReport(reportType, params = {}, previousMetrics = null) {
  if (typeof testOverride === "function") {
    return testOverride(reportType, params, previousMetrics);
  }
  switch (reportType) {
    case "daily_director_brief":
      return buildDailyDirectorBrief(params);
    case "weekly_sales_summary":
      return buildWeeklySalesSummary(params, previousMetrics);
    case "crm_discipline":
      return buildCrmDiscipline(params);
    case "birthday_control":
      return buildBirthdayControl(params);
    default:
      throw new Error(`Unknown report type: ${reportType}`);
  }
}

export async function maybeAttachNarrative(report, enabled) {
  if (!enabled) return { report, narrativeWarning: null };
  try {
    const compact = sanitizeLlmPayload(
      {
        reportType: report.reportType,
        period: report.period,
        summary: report.summary,
        criticalAlerts: report.criticalAlerts,
        recommendations: report.recommendations,
        partial: report.partial,
      },
      "analytics"
    );
    const text = await askClaude({
      systemPrompt:
        "Сформируй краткое управленческое резюме на русском. Не меняй и не выдумывай цифры. Только интерпретация переданных метрик и алертов.",
      userPrompt: JSON.stringify(compact),
    });
    return {
      report: { ...report, narrative: String(text || "").trim() },
      narrativeWarning: null,
    };
  } catch (error) {
    return {
      report,
      narrativeWarning: {
        code: "REPORT_NARRATIVE_UNAVAILABLE",
        message: "Числовой отчёт сформирован, но текстовое резюме недоступно.",
        details: { reason: error.message },
      },
    };
  }
}
