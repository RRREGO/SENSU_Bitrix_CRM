import { renderSection, renderSummaryGrid, wrapDocumentHtml } from "../render/htmlShell.js";
import { deal_get } from "../../actions/dealActions.js";
import { activity_list, timeline_comment_list } from "../../actions/timelineActions.js";
import { processText } from "../../utils/text.js";
import { extractDealFields, unwrapCrmItem } from "../../actions/helpers.js";

export const type = "deal_summary";
export const title = "Сводка по сделке";

export async function build(params = {}) {
  if (!params.dealId && !params.id) {
    throw new Error("dealId is required for deal_summary");
  }

  const dealId = params.dealId || params.id;
  const dealRaw = await deal_get({ id: dealId });
  const deal = extractDealFields(dealRaw);

  let activities = [];
  let comments = [];

  try {
    const activityResult = await activity_list({
      filter: { OWNER_TYPE_ID: 2, OWNER_ID: dealId },
      select: ["ID", "SUBJECT", "DEADLINE", "COMPLETED", "TYPE_ID"],
    });
    activities = Array.isArray(activityResult)
      ? activityResult
      : activityResult?.items || [];
  } catch {
    activities = [];
  }

  try {
    comments = await timeline_comment_list({
      entityType: "deal",
      entityId: dealId,
    });
    if (!Array.isArray(comments)) comments = comments?.items || [];
  } catch {
    comments = [];
  }

  const bodyHtml = [
    renderSection(
      "Основные данные",
      renderSummaryGrid([
        { label: "ID", value: dealId },
        { label: "Название", value: deal.title || "—" },
        { label: "Стадия", value: deal.stageId || "—" },
        { label: "Сумма", value: `${(deal.opportunity || 0).toLocaleString("ru-RU")} руб.` },
      ])
    ),
    renderSection(
      "Детали",
      `<p><strong>Ответственный:</strong> ${processText(String(deal.ASSIGNED_BY_ID || deal.assignedById || "—"))}</p>
       <p><strong>Компания:</strong> ${processText(String(deal.COMPANY_ID || deal.companyId || "—"))}</p>
       <p><strong>Контакт:</strong> ${processText(String(deal.CONTACT_ID || deal.contactId || "—"))}</p>`
    ),
    activities.length
      ? renderSection(
          "Активности",
          `<ul class="doc-list">${activities
            .slice(0, 15)
            .map((a) => {
              const item = unwrapCrmItem(a);
              return `<li>${processText(item.SUBJECT || item.subject || "Без темы")} — срок: ${processText(String(item.DEADLINE || item.deadline || "—"))}</li>`;
            })
            .join("")}</ul>`
        )
      : renderSection("Активности", "<p>Активности не найдены.</p>"),
    comments.length
      ? renderSection(
          "Комментарии",
          `<ul class="doc-list">${comments
            .slice(0, 10)
            .map((c) => {
              const item = unwrapCrmItem(c);
              return `<li>${processText(item.COMMENT || item.comment || item.TEXT || "—")}</li>`;
            })
            .join("")}</ul>`
        )
      : "",
  ].join("");

  return {
    title: processText(`${title} №${dealId}`),
    bodyHtml,
    meta: { dealId, deal, activities, comments },
  };
}

export function toHtml(result) {
  return wrapDocumentHtml({
    title: result.title,
    bodyHtml: result.bodyHtml,
    meta: { generatedAt: new Date(), source: "Bitrix24" },
  });
}
