/**
 * Registry разрешённых плановых отчётов (allowlist).
 */

import { DEFAULT_ALERT_RULES } from "./alertEvaluator.js";
import { SchedulerError } from "./config.js";

export const SCHEDULED_REPORT_REGISTRY = {
  daily_director_brief: {
    name: "Ежедневная сводка руководителя",
    readOnly: true,
    timeoutSeconds: 600,
    partialOk: true,
    requiredSources: ["crm_discipline_report"],
    optionalSources: ["contacts_birthday_activity_report", "tasks"],
    defaultParams: { hour: 8, minute: 0 },
    defaultScheduleType: "daily",
    defaultAlertRules: DEFAULT_ALERT_RULES,
  },
  weekly_sales_summary: {
    name: "Еженедельная сводка продаж",
    readOnly: true,
    timeoutSeconds: 600,
    partialOk: true,
    requiredSources: ["crm_discipline_report", "new_deals_period", "closed_deals_period"],
    optionalSources: ["stale_leads_report", "stale_deals_report"],
    defaultParams: { hour: 8, minute: 0, dayOfWeek: 1 },
    defaultScheduleType: "weekly",
    defaultAlertRules: DEFAULT_ALERT_RULES.filter((r) =>
      ["overdueActivities", "staleDeals", "leadsWithoutNextActivity", "dealsWithoutNextStep"].includes(
        r.metric
      )
    ),
  },
  crm_discipline: {
    name: "Дисциплина CRM",
    readOnly: true,
    timeoutSeconds: 600,
    partialOk: true,
    requiredSources: ["crm_discipline_report"],
    optionalSources: [],
    defaultParams: { hour: 8, minute: 0 },
    defaultScheduleType: "daily",
    defaultAlertRules: DEFAULT_ALERT_RULES,
  },
  birthday_control: {
    name: "Контроль дней рождения",
    readOnly: true,
    timeoutSeconds: 300,
    partialOk: true,
    requiredSources: ["contacts_birthday_activity_report"],
    optionalSources: [],
    defaultParams: { hour: 8, minute: 0, daysAhead: 7 },
    defaultScheduleType: "daily",
    defaultAlertRules: [
      {
        metric: "overdueBirthdayGreetings",
        operator: ">",
        value: 0,
        severity: "critical",
        code: "OVERDUE_BIRTHDAY",
      },
      {
        metric: "missingBirthdayActivities",
        operator: ">",
        value: 0,
        severity: "warning",
        code: "MISSING_BIRTHDAY_ACTIVITY",
      },
    ],
  },
};

export function getScheduledReportDef(reportType) {
  return SCHEDULED_REPORT_REGISTRY[reportType] || null;
}

export function assertKnownReportType(reportType) {
  const def = SCHEDULED_REPORT_REGISTRY[reportType];
  if (!def) {
    throw new SchedulerError(
      "UNKNOWN_SCHEDULED_REPORT",
      `Тип отчёта «${reportType}» не в allowlist планировщика.`
    );
  }
  return def;
}

export function listScheduledReportTypes() {
  return Object.entries(SCHEDULED_REPORT_REGISTRY).map(([id, def]) => ({
    id,
    name: def.name,
    defaultScheduleType: def.defaultScheduleType,
  }));
}
