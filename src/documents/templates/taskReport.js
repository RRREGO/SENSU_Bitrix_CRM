import { renderSection, renderSummaryGrid, renderTable, wrapDocumentHtml } from "../render/htmlShell.js";
import { search_tasks, get_task_by_id } from "../../actions/taskActions.js";
import { processText } from "../../utils/text.js";

export const type = "task_report";
export const title = "Отчёт по задачам";

function normalizeTasks(result) {
  if (Array.isArray(result)) return result;
  if (result?.tasks && Array.isArray(result.tasks)) return result.tasks;
  if (result?.items && Array.isArray(result.items)) return result.items;
  return [];
}

export async function build(params = {}) {
  const dateFrom = params.dateFrom || null;
  const dateTo = params.dateTo || null;

  let tasks = [];

  if (params.taskId || params.id) {
    const taskId = params.taskId || params.id;
    const raw = await get_task_by_id({ id: taskId });
    const task = raw?.task || raw;
    tasks = task ? [task] : [];
  } else {
    const filter = { ...(params.filter || {}) };
    if (dateFrom) filter[">=CREATED_DATE"] = dateFrom;
    if (dateTo) filter["<=CREATED_DATE"] = dateTo;

    const raw = await search_tasks({
      filter,
      select: ["ID", "TITLE", "STATUS", "DEADLINE", "RESPONSIBLE_ID", "CREATED_DATE"],
    });
    tasks = normalizeTasks(raw);
  }

  const overdue = tasks.filter((t) => {
    const deadline = t.deadline || t.DEADLINE;
    if (!deadline) return false;
    const status = String(t.status || t.STATUS || "");
    if (status === "5" || status === "completed") return false;
    return new Date(deadline) < new Date();
  });

  const completed = tasks.filter((t) => {
    const status = String(t.status || t.STATUS || "");
    return status === "5" || status === "completed";
  });

  const bodyHtml = [
    renderSection(
      "Сводка",
      renderSummaryGrid([
        { label: "Всего задач", value: tasks.length },
        { label: "Просрочено", value: overdue.length },
        { label: "Выполнено", value: completed.length },
        { label: "В работе", value: tasks.length - completed.length },
      ])
    ),
    renderSection(
      "Список задач",
      tasks.length
        ? renderTable(
            [
              { key: "id", label: "ID", render: (r) => r.id || r.ID },
              { key: "title", label: "Название", render: (r) => r.title || r.TITLE },
              { key: "status", label: "Статус", render: (r) => r.status || r.STATUS },
              { key: "deadline", label: "Срок", render: (r) => r.deadline || r.DEADLINE || "—" },
              { key: "responsible", label: "Ответственный", render: (r) => r.responsibleId || r.RESPONSIBLE_ID || "—" },
            ],
            tasks.slice(0, 100)
          )
        : "<p>Задачи не найдены по заданным параметрам.</p>"
    ),
  ].join("");

  return {
    title: processText(title),
    bodyHtml,
    meta: { dateFrom, dateTo, tasks, overdue },
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
