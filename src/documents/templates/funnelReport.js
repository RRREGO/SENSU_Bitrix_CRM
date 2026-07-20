import {
  renderSection,
  renderSummaryGrid,
  renderTable,
  wrapDocumentHtml,
} from "../render/htmlShell.js";
import { crm_funnel_summary, deal_count_by_stage } from "../../actions/analyticsActions.js";
import { processText } from "../../utils/text.js";

export const type = "funnel_report";
export const title = "Отчёт по воронке";

function formatTotals(totalsByCurrency = {}) {
  const entries = Object.entries(totalsByCurrency || {});
  if (!entries.length) return "—";
  return entries
    .map(([currency, sum]) => `${Number(sum || 0).toLocaleString("ru-RU")} ${currency}`)
    .join("; ");
}

export async function build(params = {}) {
  const categoryId = params.categoryId ?? 0;
  const dateFrom = params.dateFrom || null;
  const dateTo = params.dateTo || null;

  const [summary, byStage] = await Promise.all([
    crm_funnel_summary({ categoryId }),
    deal_count_by_stage({ categoryId }),
  ]);

  const bodyHtml = [
    renderSection(
      "Сводные показатели",
      renderSummaryGrid([
        { label: "Воронка", value: `ID ${categoryId}` },
        { label: "Всего сделок", value: summary.totalDeals },
        { label: "Суммы по валютам", value: formatTotals(summary.totalsByCurrency) },
        {
          label: "Просроченных дел",
          value: summary.overdueActivitiesCount ?? summary.overdueActivities?.length ?? 0,
        },
      ])
    ),
    renderSection(
      "Сделки по стадиям",
      renderTable(
        [
          { key: "stageName", label: "Стадия" },
          { key: "count", label: "Количество" },
        ],
        byStage
      )
    ),
  ].join("");

  return {
    title: processText(title),
    bodyHtml,
    meta: { dateFrom, dateTo, categoryId, summary, byStage },
  };
}

export function toHtml(result) {
  return wrapDocumentHtml({
    title: result.title,
    bodyHtml: result.bodyHtml,
    meta: {
      dateFrom: result.meta.dateFrom,
      dateTo: result.meta.dateTo,
      generatedAt: new Date(),
      source: "Bitrix24",
    },
  });
}
