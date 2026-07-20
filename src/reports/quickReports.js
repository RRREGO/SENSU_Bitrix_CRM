import { getActionHandler } from "../actions/index.js";
import { generateDocument } from "../documents/documentService.js";
import { formatBusinessHtml } from "../textFormatters.js";
import { normalizeReport } from "./reportNormalizer.js";
import { renderReportHtml } from "./reportRenderer.js";

export const QUICK_REPORTS = [
  {
    id: "funnel_summary",
    type: "funnel_summary",
    title: "Сводка по воронке",
    description: "Общие показатели воронки сделок",
    action: "crm_funnel_summary",
    documentType: "funnel_report",
    params: { categoryId: 0 },
    implemented: true,
  },
  {
    id: "deal_count_by_stage",
    type: "deal_count_by_stage",
    title: "Сделки по стадиям",
    description: "Количество сделок в каждой стадии",
    action: "deal_count_by_stage",
    params: { categoryId: 0 },
    implemented: true,
  },
  {
    id: "deal_sum_by_stage",
    type: "deal_sum_by_stage",
    title: "Сумма сделок по стадиям",
    description: "Суммарная стоимость сделок по стадиям",
    action: "deal_sum_by_stage",
    params: { categoryId: 0 },
    implemented: true,
  },
  {
    id: "overdue_tasks",
    type: "overdue_tasks",
    title: "Просроченные задачи",
    description: "Задачи с истёкшим сроком выполнения",
    action: "overdue_tasks_report",
    params: {},
    implemented: true,
  },
  {
    id: "deals_without_next_step",
    type: "deals_without_next_step",
    title: "Сделки без следующего шага",
    description: "Открытые сделки без запланированных активностей",
    action: "deals_without_next_step",
    params: { categoryId: 0 },
    implemented: true,
  },
  {
    id: "leads_without_assigned",
    type: "leads_without_assigned",
    title: "Лиды без ответственного",
    description: "Лиды без назначенного ответственного",
    action: "leads_without_assigned",
    params: {},
    implemented: true,
  },
  {
    id: "deals_without_activity",
    type: "deals_without_activity",
    title: "Сделки без активности",
    description: "Сделки без зарегистрированных дел и встреч",
    action: "deals_without_activity",
    params: { categoryId: 0 },
    implemented: true,
  },
  {
    id: "new_deals_period",
    type: "new_deals_period",
    title: "Новые сделки за период",
    description: "Сделки, созданные в выбранном периоде",
    action: "new_deals_period",
    params: { categoryId: 0 },
    implemented: true,
  },
  {
    id: "closed_deals_period",
    type: "closed_deals_period",
    title: "Закрытые сделки за период",
    description: "Сделки, закрытые в выбранном периоде",
    action: "closed_deals_period",
    params: { categoryId: 0 },
    implemented: true,
  },
  {
    id: "manager_workload",
    type: "manager_workload",
    title: "Нагрузка по менеджерам",
    description: "Нагрузка, просрочки и качество ведения CRM по ответственным",
    action: "manager_workload",
    params: {},
    implemented: true,
    filters: ["period", "responsible"],
  },
  {
    id: "leads_without_next_activity",
    type: "leads_without_next_activity",
    title: "Лиды без следующего дела",
    description: "Активные лиды без актуального CRM-дела",
    action: "leads_without_next_activity",
    params: {},
    implemented: true,
    filters: ["responsible"],
  },
  {
    id: "stale_leads_report",
    type: "stale_leads_report",
    title: "Лиды без изменений",
    description: "Лиды без изменений более заданного числа дней",
    action: "stale_leads_report",
    params: { inactiveDays: 14 },
    implemented: true,
    filters: ["responsible", "inactiveDays"],
  },
  {
    id: "stale_deals_report",
    type: "stale_deals_report",
    title: "Сделки без изменений",
    description: "Сделки без изменений с суммами по валютам",
    action: "stale_deals_report",
    params: { inactiveDays: 14 },
    implemented: true,
    filters: ["funnel", "responsible", "inactiveDays"],
  },
  {
    id: "overdue_activities_by_manager",
    type: "overdue_activities_by_manager",
    title: "Просроченные CRM-дела по менеджерам",
    description: "Группировка просроченных дел по ответственным",
    action: "overdue_activities_by_manager",
    params: {},
    implemented: true,
    filters: ["responsible"],
  },
  {
    id: "crm_discipline_report",
    type: "crm_discipline_report",
    title: "Дисциплина ведения CRM",
    description: "Сводка критических нарушений и рекомендации руководителю",
    action: "crm_discipline_report",
    params: { inactiveDays: 14 },
    implemented: true,
    filters: ["period", "responsible", "inactiveDays"],
  },
  {
    id: "contact_count_by_status",
    type: "contact_count_by_status",
    title: "Контакты по статусам",
    description: "Распределение контактов по настроенному полю статуса",
    action: "contact_count_by_status",
    params: {},
    implemented: true,
    filters: ["status"],
  },
  {
    id: "contacts_without_status",
    type: "contacts_without_status",
    title: "Контакты без статуса",
    description: "Контакты с пустым или отсутствующим статусом",
    action: "contacts_without_status",
    params: {},
    implemented: true,
  },
  {
    id: "contacts_without_company",
    type: "contacts_without_company",
    title: "Контакты без компании",
    description: "Контакты без привязки к компании",
    action: "contacts_without_company",
    params: {},
    implemented: true,
  },
  {
    id: "contacts_cycle_without_next_activity",
    type: "contacts_cycle_without_next_activity",
    title: "Цикл без следующего дела",
    description: "Контакты в статусе «Цикл» без актуального CRM-дела",
    action: "contacts_cycle_without_next_activity",
    params: {},
    implemented: true,
    filters: ["responsible"],
  },
  {
    id: "contacts_birthday_activity_report",
    type: "contacts_birthday_activity_report",
    title: "Контроль дней рождения",
    description: "Ближайшие дни рождения и дела на поздравление",
    action: "contacts_birthday_activity_report",
    params: { daysAhead: 30 },
    implemented: true,
    filters: ["responsible", "daysAhead"],
  },
  {
    id: "contact_quality_report",
    type: "contact_quality_report",
    title: "Качество заполнения контактов",
    description: "Сводный контроль обязательных правил ведения CRM",
    action: "contact_quality_report",
    params: { daysAhead: 30 },
    implemented: true,
    filters: ["responsible", "daysAhead"],
  },
];

export function listQuickReports() {
  return QUICK_REPORTS.map(({ id, type, title, description, documentType, implemented }) => ({
    id,
    type,
    title,
    description,
    documentType: documentType || null,
    implemented,
  }));
}

export function getQuickReportDef(reportId) {
  return QUICK_REPORTS.find((item) => item.id === reportId || item.type === reportId) || null;
}

export async function runQuickReport(reportId, params = {}, funnel = null) {
  const reportDef = getQuickReportDef(reportId);
  if (!reportDef) {
    throw new Error(`Unknown quick report: ${reportId}`);
  }

  if (!reportDef.implemented) {
    return {
      success: false,
      error: {
        code: "REPORT_NOT_IMPLEMENTED",
        message: "Этот отчёт зарегистрирован, но пока не реализован.",
      },
      ...normalizeReport({
        type: reportDef.type,
        title: reportDef.title,
        raw: null,
        params,
        funnel,
        implemented: false,
      }),
    };
  }

  const handler = getActionHandler(reportDef.action);
  if (!handler) {
    throw new Error(`Action not found: ${reportDef.action}`);
  }

  const mergedParams = { ...reportDef.params, ...params };
  const raw = await handler(mergedParams);

  if (raw?.success === false && raw?.error?.code === "REPORT_NOT_IMPLEMENTED") {
    return {
      success: false,
      error: raw.error,
      ...normalizeReport({
        type: reportDef.type,
        title: reportDef.title,
        raw,
        params: mergedParams,
        funnel,
        implemented: false,
      }),
    };
  }

  return normalizeReport({
    type: reportDef.type,
    title: reportDef.title,
    raw,
    params: mergedParams,
    funnel,
    implemented: true,
  });
}

export async function runQuickReportAsDocument(reportId, params = {}, funnel = null, options = {}) {
  const report = await runQuickReport(reportId, params, funnel);
  const html = formatBusinessHtml(renderReportHtml(report, options));
  const { exportReportHtml } = await import("../documents/exportService.js");
  const { reportToPlainText } = await import("./reportNormalizer.js");

  const saved = await exportReportHtml({
    report,
    html,
    prefix: report.type,
  });

  return {
    documentId: saved.fileName.replace(/\.html$/, ""),
    title: report.title,
    html,
    text: reportToPlainText(report),
    download: { html: saved.file, pdf: null },
    savedAt: new Date().toISOString(),
    type: report.type,
    report,
    sourceReportId: report.id,
  };
}

export async function buildQuickReportOutput(reportId, params = {}, funnel = null, options = {}) {
  const report = await runQuickReport(reportId, params, funnel);
  const html = formatBusinessHtml(renderReportHtml(report, options));
  const { reportToPlainText } = await import("./reportNormalizer.js");
  const text = reportToPlainText(report);

  return { report, html, text };
}

/** @deprecated используйте renderReportHtml */
export async function formatQuickReportHtml(reportData) {
  const { normalizeReport: norm } = await import("./reportNormalizer.js");
  const normalized = norm({
    type: reportData.id || reportData.action,
    title: reportData.title,
    raw: reportData.result,
    params: reportData.params || {},
    implemented: true,
  });
  return renderReportHtml(normalized);
}
