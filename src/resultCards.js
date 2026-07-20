import { processText } from "./utils/text.js";
import { unwrapCrmItem } from "./actions/helpers.js";

const ACTION_CARD_MAP = {
  deal_get: "deal",
  deal_list: "deal",
  create_deal: "deal",
  lead_get: "lead",
  lead_list: "lead",
  lead_create: "lead",
  get_task_by_id: "task",
  search_tasks: "task",
  create_task: "task",
  contact_get: "contact",
  contact_list: "contact",
  company_get: "company",
  company_list: "company",
  crm_funnel_summary: "report",
  deal_count_by_stage: "report",
  deal_sum_by_stage: "report",
  lead_count_by_stage: "report",
  lead_conversion_report: "report",
  overdue_activity_report: "report",
  overdue_tasks_report: "report",
  deals_without_next_step: "report",
  leads_without_responsible: "report",
  contacts_without_status: "report",
  contacts_without_company: "report",
  contact_count_by_status: "report",
  contacts_cycle_without_next_activity: "report",
  contacts_birthday_activity_report: "report",
  contact_quality_report: "report",
};

const REPORT_ACTIONS = new Set([
  "crm_funnel_summary",
  "deal_count_by_stage",
  "deal_sum_by_stage",
  "lead_count_by_stage",
  "lead_conversion_report",
  "overdue_activity_report",
  "overdue_tasks_report",
  "deals_without_next_step",
  "leads_without_responsible",
  "contacts_without_status",
  "contacts_without_company",
  "contact_count_by_status",
  "contacts_cycle_without_next_activity",
  "contacts_birthday_activity_report",
  "contact_quality_report",
]);

function pickTitle(item, fallback) {
  const data = unwrapCrmItem(item);
  return (
    data.TITLE ||
    data.title ||
    data.NAME ||
    data.name ||
    data.SUBJECT ||
    data.subject ||
    fallback
  );
}

function buildDealCard(action, params, result) {
  if (action === "deal_get") {
    const deal = unwrapCrmItem(result);
    return {
      type: "deal",
      title: processText(pickTitle(deal, `Сделка №${params.id}`)),
      fields: [
        { label: "ID", value: deal.ID || deal.id || params.id },
        { label: "Стадия", value: deal.STAGE_ID || deal.stageId || "—" },
        { label: "Сумма", value: deal.OPPORTUNITY || deal.opportunity || "—" },
      ],
    };
  }

  const items = result?.items || (Array.isArray(result) ? result : []);
  return {
    type: "deal",
    title: processText("Сделки"),
    table: {
      columns: ["ID", "Название", "Стадия", "Сумма"],
      rows: items.slice(0, 10).map((item) => {
        const data = unwrapCrmItem(item);
        return [
          data.ID || data.id,
          pickTitle(data, "—"),
          data.STAGE_ID || data.stageId || "—",
          data.OPPORTUNITY || data.opportunity || "—",
        ];
      }),
    },
    total: result?.total ?? items.length,
  };
}

function buildLeadCard(action, params, result) {
  if (action === "lead_get") {
    const lead = unwrapCrmItem(result);
    return {
      type: "lead",
      title: processText(pickTitle(lead, `Лид №${params.id}`)),
      fields: [
        { label: "ID", value: lead.ID || lead.id || params.id },
        { label: "Стадия", value: lead.STATUS_ID || lead.statusId || "—" },
      ],
    };
  }

  const items = result?.items || (Array.isArray(result) ? result : []);
  return {
    type: "lead",
    title: processText("Лиды"),
    table: {
      columns: ["ID", "Название", "Стадия"],
      rows: items.slice(0, 10).map((item) => {
        const data = unwrapCrmItem(item);
        return [data.ID || data.id, pickTitle(data, "—"), data.STATUS_ID || data.statusId || "—"];
      }),
    },
    total: result?.total ?? items.length,
  };
}

function buildTaskCard(action, params, result) {
  if (action === "get_task_by_id") {
    const task = result?.task || unwrapCrmItem(result);
    return {
      type: "task",
      title: processText(pickTitle(task, `Задача №${params.id}`)),
      fields: [
        { label: "ID", value: task.id || task.ID || params.id },
        { label: "Срок", value: task.deadline || task.DEADLINE || "—" },
        { label: "Статус", value: task.status || task.STATUS || "—" },
      ],
    };
  }

  const tasks = result?.tasks || (Array.isArray(result) ? result : []);
  return {
    type: "task",
    title: processText("Задачи"),
    table: {
      columns: ["ID", "Название", "Срок"],
      rows: tasks.slice(0, 10).map((task) => [
        task.id || task.ID,
        pickTitle(task, "—"),
        task.deadline || task.DEADLINE || "—",
      ]),
    },
    total: tasks.length,
  };
}

function buildContactCard(action, params, result) {
  if (action === "contact_get") {
    const contact = unwrapCrmItem(result);
    return {
      type: "contact",
      title: processText(pickTitle(contact, `Контакт №${params.id}`)),
      fields: [
        { label: "ID", value: contact.ID || contact.id || params.id },
        { label: "Телефон", value: contact.PHONE || contact.phone || "—" },
      ],
    };
  }

  const items = result?.items || (Array.isArray(result) ? result : []);
  return {
    type: "contact",
    title: processText("Контакты"),
    table: {
      columns: ["ID", "Имя"],
      rows: items.slice(0, 10).map((item) => {
        const data = unwrapCrmItem(item);
        return [data.ID || data.id, pickTitle(data, "—")];
      }),
    },
    total: result?.total ?? items.length,
  };
}

function buildCompanyCard(action, params, result) {
  if (action === "company_get") {
    const company = unwrapCrmItem(result);
    return {
      type: "company",
      title: processText(pickTitle(company, `Компания №${params.id}`)),
      fields: [
        { label: "ID", value: company.ID || company.id || params.id },
        { label: "Отрасль", value: company.INDUSTRY || company.industry || "—" },
      ],
    };
  }

  const items = result?.items || (Array.isArray(result) ? result : []);
  return {
    type: "company",
    title: processText("Компании"),
    table: {
      columns: ["ID", "Название"],
      rows: items.slice(0, 10).map((item) => {
        const data = unwrapCrmItem(item);
        return [data.ID || data.id, pickTitle(data, "—")];
      }),
    },
    total: result?.total ?? items.length,
  };
}

function buildReportCard(action, result) {
  if (Array.isArray(result?.byStage)) {
    return {
      type: "report",
      title: processText("Отчёт"),
      table: {
        columns: ["Стадия", "Количество", "Сумма"],
        rows: result.byStage.map((row) => [
          row.stageName || row.stageId,
          row.count ?? "—",
          row.sum ?? "—",
        ]),
      },
      summary:
        result.totalDeals != null
          ? `Сделок: ${result.totalDeals}, суммы: ${
              result.totalsByCurrency
                ? Object.entries(result.totalsByCurrency)
                    .map(([c, s]) => `${s} ${c}`)
                    .join("; ")
                : result.totalSum ?? "—"
            }`
          : null,
    };
  }

  if (Array.isArray(result)) {
    return {
      type: "report",
      title: processText("Отчёт"),
      table: {
        columns: ["Стадия", "Количество", "Сумма"],
        rows: result.map((row) => [row.stageName || row.stageId, row.count ?? "—", row.sum ?? "—"]),
      },
    };
  }

  if (Array.isArray(result?.deals)) {
    return {
      type: "report",
      title: processText("Сделки без следующего шага"),
      table: {
        columns: ["ID", "Название", "Стадия"],
        rows: result.deals.slice(0, 10).map((row) => [row.id, row.title || "—", row.stageId || "—"]),
      },
      summary: `Всего: ${result.count}`,
    };
  }

  if (Array.isArray(result?.leads)) {
    return {
      type: "report",
      title: processText("Лиды без ответственного"),
      table: {
        columns: ["ID", "Название", "Стадия"],
        rows: result.leads.slice(0, 10).map((row) => [row.id, row.title || "—", row.statusId || "—"]),
      },
      summary: `Всего: ${result.count}`,
    };
  }

  if (Array.isArray(result?.tasks) || Array.isArray(result?.activities)) {
    const list = result.tasks || result.activities;
    return {
      type: "report",
      title: processText("Отчёт"),
      table: {
        columns: ["ID", "Название", "Срок"],
        rows: list.slice(0, 10).map((row) => [
          row.id || row.ID,
          row.title || row.TITLE || row.SUBJECT || "—",
          row.deadline || row.DEADLINE || "—",
        ]),
      },
      summary: result.count != null ? `Всего: ${result.count}` : null,
    };
  }

  return {
    type: "report",
    title: processText("Отчёт"),
    fields: [{ label: "Данные", value: "См. ответ ассистента" }],
  };
}

function buildCard(action, params, result) {
  const cardType = ACTION_CARD_MAP[action];
  if (!cardType) return null;

  if (cardType === "deal") return buildDealCard(action, params, result);
  if (cardType === "lead") return buildLeadCard(action, params, result);
  if (cardType === "task") return buildTaskCard(action, params, result);
  if (cardType === "contact") return buildContactCard(action, params, result);
  if (cardType === "company") return buildCompanyCard(action, params, result);
  if (cardType === "report" || REPORT_ACTIONS.has(action)) {
    return buildReportCard(action, result);
  }

  return null;
}

export function buildResultCards(toolCalls = []) {
  const cards = [];

  for (const call of toolCalls) {
    const card = buildCard(call.action, call.params || {}, call.result);
    if (card) {
      cards.push({
        ...card,
        action: call.action,
      });
    }
  }

  return cards;
}

export function buildDocumentCard(documentResult) {
  if (!documentResult) return null;

  return {
    type: "document",
    title: processText(documentResult.title || "Документ"),
    fields: [
      { label: "ID", value: documentResult.documentId },
      { label: "Тип", value: documentResult.type || "—" },
    ],
    links: {
      html: documentResult.download?.html,
      pdf: documentResult.download?.pdf,
    },
  };
}
