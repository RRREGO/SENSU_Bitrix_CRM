import { renderSection, wrapDocumentHtml } from "../render/htmlShell.js";
import { activity_list } from "../../actions/timelineActions.js";
import { timeline_comment_list } from "../../actions/timelineActions.js";
import { processText } from "../../utils/text.js";
import { unwrapCrmItem } from "../../actions/helpers.js";

export const type = "meeting_protocol";
export const title = "Протокол встречи";

export async function build(params = {}) {
  const entityType = params.entityType || "deal";
  const entityId = params.entityId || params.dealId || params.id;

  if (!entityId) {
    throw new Error("entityId or dealId is required for meeting_protocol");
  }

  const ownerTypeMap = { lead: 1, deal: 2, contact: 3, company: 4 };
  const ownerTypeId = ownerTypeMap[entityType] || 2;

  let activities = [];
  let comments = [];

  try {
    const activityResult = await activity_list({
      filter: { OWNER_TYPE_ID: ownerTypeId, OWNER_ID: entityId },
      select: ["ID", "SUBJECT", "DESCRIPTION", "START_TIME", "END_TIME", "COMPLETED"],
    });
    activities = Array.isArray(activityResult)
      ? activityResult
      : activityResult?.items || [];
  } catch {
    activities = [];
  }

  try {
    comments = await timeline_comment_list({ entityType, entityId });
    if (!Array.isArray(comments)) comments = [];
  } catch {
    comments = [];
  }

  const meetingDate = params.meetingDate || params.dateFrom || new Date().toISOString().slice(0, 10);
  const participants = processText(params.participants || "Участники не указаны");
  const agenda = processText(params.agenda || "Повестка не указана");
  const decisions = processText(params.decisions || "Решения зафиксированы по итогам обсуждения в CRM.");
  const nextSteps = processText(params.nextSteps || "Следующие шаги определены ответственными в Bitrix24.");

  const activityNotes = activities
    .slice(0, 10)
    .map((a) => {
      const item = unwrapCrmItem(a);
      return `<li>${processText(item.SUBJECT || item.subject || "Встреча")} — ${processText(String(item.START_TIME || item.startTime || "—"))}</li>`;
    })
    .join("");

  const commentNotes = comments
    .slice(0, 10)
    .map((c) => {
      const item = unwrapCrmItem(c);
      return `<li>${processText(item.COMMENT || item.comment || item.TEXT || "—")}</li>`;
    })
    .join("");

  const bodyHtml = [
    renderSection("Дата встречи", `<p>${processText(meetingDate)}</p>`),
    renderSection("Участники", `<p>${participants}</p>`),
    renderSection("Повестка", `<p>${agenda}</p>`),
  renderSection("Обсуждение", `<ul class="doc-list">${activityNotes || "<li>Материалы встречи не найдены в активностях.</li>"}</ul>`),
    renderSection("Комментарии CRM", `<ul class="doc-list">${commentNotes || "<li>Комментарии отсутствуют.</li>"}</ul>`),
    renderSection("Принятые решения", `<p>${decisions}</p>`),
    renderSection("Следующие шаги", `<p>${nextSteps}</p>`),
  ].join("");

  return {
    title: processText(`${title} от ${meetingDate}`),
    bodyHtml,
    meta: { entityType, entityId, meetingDate, dateFrom: params.dateFrom, dateTo: params.dateTo },
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
