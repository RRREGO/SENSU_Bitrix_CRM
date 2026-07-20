import crypto from "crypto";
import { formatBusinessText } from "../textFormatters.js";

function formatMoney(value, currency = null) {
  const num = Number(value) || 0;
  const formatted = num.toLocaleString("ru-RU");
  if (currency) return `${formatted} ${currency}`;
  return formatted;
}

function formatTotalsByCurrency(totalsByCurrency = {}) {
  const entries = Object.entries(totalsByCurrency || {});
  if (!entries.length) return "—";
  return entries.map(([currency, sum]) => formatMoney(sum, currency)).join("; ");
}

function buildPeriod(params = {}) {
  return {
    dateFrom: params.dateFrom || null,
    dateTo: params.dateTo || null,
  };
}

function defaultRecommendations(type, raw) {
  const items = [];

  if (type === "deals_without_next_step" || type === "deals_without_activity") {
    items.push("Назначить следующие шаги по сделкам без активности.");
  }
  if (type === "overdue_tasks") {
    items.push("Проверить просроченные задачи и обновить сроки.");
  }
  if (type === "leads_without_assigned" || type === "leads_without_responsible") {
    items.push("Назначить ответственных по лидам без владельца.");
  }
  if (raw?.overdueActivitiesCount > 0 || raw?.overdueActivities?.length) {
    items.push("Закрыть или перенести просроченные дела в CRM.");
  }
  if (!items.length) {
    items.push("Использовать данные отчёта для планирования работы менеджеров.");
  }

  return items.map((item) => formatBusinessText(item));
}

function normalizeFunnelSummary(raw) {
  const totalsLabel = formatTotalsByCurrency(raw.totalsByCurrency);
  const summary = [
    { label: "Всего сделок", value: raw.totalDeals ?? 0 },
    { label: "Суммы по валютам", value: totalsLabel },
    {
      label: "Просроченных дел",
      value: raw.overdueActivitiesCount ?? raw.overdueActivities?.length ?? 0,
    },
  ];

  const tables = [];
  if (Array.isArray(raw.byStage) && raw.byStage.length) {
    tables.push({
      title: "Сделки по стадиям",
      columns: ["Стадия", "Количество", "Суммы"],
      rows: raw.byStage.map((row) => [
        row.stageName || row.stageId || "—",
        String(row.count ?? 0),
        formatTotalsByCurrency(row.totalsByCurrency) || formatMoney(row.sum),
      ]),
    });
  }

  const sections = [
    {
      title: "Краткий вывод",
      content: formatBusinessText(
        `В воронке ${summary[0].value} сделок. Суммы: ${totalsLabel}.`
      ),
    },
  ];

  return { summary, tables, sections };
}

function normalizeStageCount(raw) {
  const rows = (Array.isArray(raw) ? raw : raw?.byStage || []).map((row) => [
    row.stageName || row.stageId || "—",
    String(row.count ?? 0),
  ]);

  const total = rows.reduce((sum, row) => sum + Number(row[1] || 0), 0);

  return {
    summary: [{ label: "Всего сделок", value: total }],
    tables: rows.length
      ? [{ title: "Сделки по стадиям", columns: ["Стадия", "Количество"], rows }]
      : [],
    sections: [
      {
        title: "Краткий вывод",
        content: formatBusinessText(`Всего сделок в отчёте: ${total}.`),
      },
    ],
  };
}

function normalizeStageSum(raw) {
  const byStage = Array.isArray(raw) ? raw : raw?.byStage || [];
  const totalsByCurrency = raw?.totalsByCurrency || {};
  const rows = byStage.map((row) => [
    row.stageName || row.stageId || "—",
    String(row.count ?? 0),
    formatTotalsByCurrency(row.totalsByCurrency) || formatMoney(row.sum),
  ]);

  const totalsLabel = formatTotalsByCurrency(totalsByCurrency);

  return {
    summary: [
      { label: "Всего сделок", value: rows.reduce((s, r) => s + Number(r[1] || 0), 0) },
      { label: "Суммы по валютам", value: totalsLabel },
    ],
    tables: rows.length
      ? [{ title: "Сумма сделок по стадиям", columns: ["Стадия", "Количество", "Суммы"], rows }]
      : [],
    sections: [
      {
        title: "Краткий вывод",
        content: formatBusinessText(`Суммы по валютам: ${totalsLabel}.`),
      },
    ],
  };
}

function normalizeDealsList(raw, title) {
  const deals = raw.deals || [];
  return {
    summary: [{ label: "Количество", value: raw.count ?? deals.length }],
    tables: deals.length
      ? {
          title,
          columns: ["ID", "Название", "Стадия"],
          rows: deals.map((d) => [
            String(d.id),
            d.title || "—",
            d.stageName || d.stageId || "—",
          ]),
        }
      : null,
    sections: [
      {
        title: "Краткий вывод",
        content: formatBusinessText(`Найдено записей: ${raw.count ?? deals.length}.`),
      },
    ],
  };
}

function normalizeLeadsList(raw) {
  const leads = raw.leads || [];
  return {
    summary: [{ label: "Количество", value: raw.count ?? leads.length }],
    tables: leads.length
      ? {
          title: "Лиды без ответственного",
          columns: ["ID", "Название", "Стадия"],
          rows: leads.map((l) => [
            String(l.id),
            l.title || "—",
            l.stageName || l.statusId || "—",
          ]),
        }
      : null,
    sections: [
      {
        title: "Краткий вывод",
        content: formatBusinessText(`Лидов без ответственного: ${raw.count ?? leads.length}.`),
      },
    ],
  };
}

function normalizeTasksList(raw) {
  const tasks = raw.tasks || [];
  return {
    summary: [{ label: "Просрочено", value: raw.count ?? tasks.length }],
    tables: tasks.length
      ? {
          title: "Просроченные задачи",
          columns: ["ID", "Название", "Срок"],
          rows: tasks.map((t) => [
            String(t.id || t.ID),
            t.title || t.TITLE || "—",
            t.deadline || t.DEADLINE || "—",
          ]),
        }
      : null,
    sections: [
      {
        title: "Краткий вывод",
        content: formatBusinessText(`Просроченных задач: ${raw.count ?? tasks.length}.`),
      },
    ],
  };
}

function normalizePeriodDeals(raw, title) {
  const deals = raw.deals || [];
  const totalsLabel = formatTotalsByCurrency(raw.totalsByCurrency);
  return {
    summary: [
      { label: "Количество", value: raw.count ?? deals.length },
      { label: "Суммы по валютам", value: totalsLabel },
    ],
    tables: deals.length
      ? {
          title,
          columns: ["ID", "Название", "Стадия", "Сумма"],
          rows: deals.map((d) => [
            String(d.id),
            d.title || "—",
            d.stageName || d.stageId || "—",
            formatMoney(d.opportunity, d.currencyId),
          ]),
        }
      : null,
    sections: [
      {
        title: "Краткий вывод",
        content: formatBusinessText(
          `${title}: ${raw.count ?? deals.length}, суммы: ${totalsLabel}.`
        ),
      },
    ],
  };
}

function normalizeContactStatusGroups(raw) {
  const groups = raw.groups || [];
  return {
    summary: [
      { label: "Всего контактов", value: raw.total ?? 0 },
      { label: "Групп статусов", value: groups.length },
    ],
    tables: groups.length
      ? [
          {
            title: "Контакты по статусам",
            columns: ["Статус", "Количество"],
            rows: groups.map((g) => [g.statusName || "Без статуса", String(g.count ?? 0)]),
          },
        ]
      : [],
    sections: [
      {
        title: "Краткий вывод",
        content: formatBusinessText(`Всего контактов: ${raw.total ?? 0}.`),
      },
    ],
  };
}

function normalizeContactIssueList(raw, title) {
  const sample = raw.sample || raw.withoutActivity || [];
  const count = raw.count ?? raw.countWithoutActivity ?? sample.length;
  const truncatedNote = raw.truncated
    ? ` Показаны первые ${raw.sampleLimit || 100} из ${count}.`
    : "";

  const tables = [];
  if (sample.length) {
    tables.push({
      title,
      columns: ["ID", "Контакт", "Ответственный", "Компания", "Ссылка"],
      rows: sample.map((row) => [
        String(row.id ?? "—"),
        row.name || row.title || "—",
        row.responsibleName || (row.responsibleId ? `#${row.responsibleId}` : "—"),
        row.companyName || (row.companyId ? `#${row.companyId}` : "—"),
        row.url || "—",
      ]),
    });
  }

  if (Array.isArray(raw.withOverdueActivityOnly) && raw.withOverdueActivityOnly.length) {
    tables.push({
      title: "Только просроченное дело",
      columns: ["ID", "Название", "Ответственный", "Ссылка"],
      rows: raw.withOverdueActivityOnly.map((row) => [
        String(row.id ?? "—"),
        row.name || row.title || "—",
        row.responsibleName || (row.responsibleId ? `#${row.responsibleId}` : "—"),
        row.url || "—",
      ]),
    });
  }

  return {
    summary: [
      { label: "Нарушений", value: count },
      ...(raw.countWithOverdueActivityOnly != null
        ? [{ label: "Только просроченные дела", value: raw.countWithOverdueActivityOnly }]
        : []),
      { label: "Критичность", value: raw.severity || "warning" },
    ],
    tables,
    sections: [
      {
        title: "Краткий вывод",
        content: formatBusinessText(`${title}: ${count}.${truncatedNote}`),
      },
      ...(raw.note
        ? [{ title: "Примечание", content: formatBusinessText(raw.note) }]
        : []),
    ],
  };
}

function normalizeBirthdayReport(raw) {
  const tables = [];
  const pushTable = (title, rows) => {
    if (!rows?.length) return;
    tables.push({
      title,
      columns: ["ID", "Контакт", "ДР", "Через дней", "Ответственный", "Ссылка"],
      rows: rows.map((row) => [
        String(row.id ?? "—"),
        row.name || "—",
        row.nextBirthday || row.birthdate || "—",
        row.daysUntil ?? "—",
        row.responsibleName || (row.responsibleId ? `#${row.responsibleId}` : "—"),
        row.url || "—",
      ]),
    });
  };

  pushTable("Нет дела на поздравление", raw.missing);
  pushTable("Просроченные поздравления", raw.overdue);
  pushTable("Запланированные поздравления", raw.planned);

  return {
    summary: [
      { label: "Ближайшие ДР", value: raw.upcomingCount ?? 0 },
      { label: "Нет дела", value: raw.birthdayActivityMissing ?? 0 },
      { label: "Просрочено", value: raw.birthdayActivityOverdue ?? 0 },
      { label: "Запланировано", value: raw.birthdayActivityPlanned ?? 0 },
    ],
    tables,
    sections: [
      {
        title: "Краткий вывод",
        content: formatBusinessText(
          `Горизонт ${raw.daysAhead ?? 30} дней: без дела ${raw.birthdayActivityMissing ?? 0}, просрочено ${raw.birthdayActivityOverdue ?? 0}.`
        ),
      },
      {
        title: "Метод определения",
        content: formatBusinessText(
          raw.note ||
            "Поздравления определяются по названию CRM-дела (шаблоны из конфигурации)."
        ),
      },
    ],
  };
}

function normalizeContactQuality(raw) {
  const summary = raw.summary || {};
  const issues = raw.issues || [];
  return {
    summary: [
      { label: "Всего контактов", value: summary.totalContacts ?? 0 },
      { label: "Без статуса", value: summary.withoutStatus ?? "—" },
      { label: "Без компании", value: summary.withoutCompany ?? 0 },
      { label: "Без ДР", value: summary.withoutBirthday ?? 0 },
      { label: "Цикл без дела", value: summary.cycleWithoutActivity ?? "—" },
      { label: "Цикл: только просрочка", value: summary.cycleWithOverdueActivityOnly ?? "—" },
      { label: "Нет поздравления", value: summary.birthdayActivityMissing ?? "—" },
      { label: "Поздравление просрочено", value: summary.birthdayActivityOverdue ?? "—" },
    ],
    tables: issues.length
      ? [
          {
            title: "Нарушения",
            columns: ["Код", "Описание", "Количество", "Критичность"],
            rows: issues.map((issue) => [
              issue.code || "—",
              issue.title || "—",
              issue.count == null ? "—" : String(issue.count),
              issue.severity || "—",
            ]),
          },
        ]
      : [],
    sections: [
      {
        title: "Краткий вывод",
        content: formatBusinessText(
          `Проверено контактов: ${summary.totalContacts ?? 0}. Найдено типов нарушений: ${issues.length}.`
        ),
      },
    ],
    recommendations: (raw.recommendations || []).map((item) => formatBusinessText(item)),
  };
}

function normalizeManagerWorkload(raw) {
  const managers = raw.managers || [];
  const formatSums = (sums = {}) => {
    const entries = Object.entries(sums);
    if (!entries.length) return "—";
    return entries.map(([c, v]) => `${Number(v || 0).toLocaleString("ru-RU")} ${c}`).join("; ");
  };

  return {
    summary: [
      { label: "Менеджеров", value: raw.summary?.managers ?? managers.length },
      { label: "Активные лиды", value: raw.summary?.activeLeads ?? 0 },
      { label: "Активные сделки", value: raw.summary?.activeDeals ?? 0 },
      { label: "Просроченные дела", value: raw.summary?.overdueActivities ?? 0 },
      { label: "Без следующего шага", value: raw.summary?.entitiesWithoutNextStep ?? 0 },
      {
        label: "Задачи",
        value: raw.summary?.tasksAvailable === false ? "недоступны" : "доступны",
      },
    ],
    tables: managers.length
      ? [
          {
            title: "Нагрузка по менеджерам",
            columns: [
              "Менеджер",
              "Лиды",
              "Сделки",
              "Суммы",
              "Просрочка дел",
              "Лиды без дела",
              "Сделки без шага",
              "Без изменений",
              "Качество CRM",
            ],
            rows: managers.map((m) => [
              m.responsibleName || `#${m.responsibleId}`,
              String(m.leads?.total ?? 0),
              String(m.deals?.total ?? 0),
              formatSums(m.deals?.sumsByCurrency),
              String(m.activities?.overdue ?? 0),
              String((m.leads?.withoutActivity || 0) + (m.leads?.withOverdueActivityOnly || 0)),
              String(m.deals?.withoutNextStep ?? 0),
              String((m.leads?.stale || 0) + (m.deals?.stale || 0)),
              m.qualityScore == null ? "—" : String(m.qualityScore),
            ]),
          },
        ]
      : [],
    sections: [
      {
        title: "Краткий вывод",
        content: formatBusinessText(
          `В отчёте ${managers.length} менеджеров. Просроченных CRM-дел: ${raw.summary?.overdueActivities ?? 0}.`
        ),
      },
      ...(raw.truncated
        ? [
            {
              title: "Ограничение выборки",
              content: formatBusinessText(raw.warning || "Отчёт построен не по всем данным."),
            },
          ]
        : []),
      ...((raw.warnings || []).length
        ? [
            {
              title: "Предупреждения",
              content: formatBusinessText(
                raw.warnings.map((w) => w.message || w.code).join(" ")
              ),
            },
          ]
        : []),
    ],
    recommendations: (raw.warnings || [])
      .filter((w) => w.code === "TASKS_ACCESS_DENIED")
      .map((w) => formatBusinessText(w.message)),
  };
}

function normalizeCrmDiscipline(raw) {
  const summary = raw.summary || {};
  const critical = raw.criticalAlerts || [];
  const warnings = raw.warnings || [];
  const byManager = raw.byManager || [];
  const risk = raw.financialRiskByCurrency || {};

  return {
    summary: [
      { label: "Контакты без статуса", value: summary.contactsWithoutStatus ?? 0 },
      { label: "Цикл без дела", value: summary.contactsCycleWithoutActivity ?? 0 },
      { label: "Лиды без дела", value: summary.leadsWithoutActivity ?? 0 },
      { label: "Сделки без шага", value: summary.dealsWithoutNextStep ?? 0 },
      { label: "Лиды без изменений", value: summary.staleLeads ?? 0 },
      { label: "Сделки без изменений", value: summary.staleDeals ?? 0 },
      { label: "Просроченные дела", value: summary.overdueActivities ?? 0 },
      {
        label: "Просроченные задачи",
        value: summary.overdueTasks == null ? "н/д" : summary.overdueTasks,
      },
    ],
    tables: [
      ...(critical.length
        ? [
            {
              title: "Критические нарушения",
              columns: ["Код", "Описание", "Количество"],
              rows: critical.map((i) => [i.code || "—", i.title || "—", String(i.count ?? "—")]),
            },
          ]
        : []),
      ...(warnings.length
        ? [
            {
              title: "Предупреждения",
              columns: ["Код", "Описание", "Количество"],
              rows: warnings.map((i) => [
                i.code || "—",
                i.title || i.message || "—",
                i.count == null ? "—" : String(i.count),
              ]),
            },
          ]
        : []),
      ...(byManager.length
        ? [
            {
              title: "По менеджерам",
              columns: [
                "Менеджер",
                "Качество CRM",
                "Просрочка",
                "Лиды без дела",
                "Сделки без шага",
                "Без изменений",
              ],
              rows: byManager.map((m) => [
                m.responsibleName || `#${m.responsibleId}`,
                m.qualityScore == null ? "—" : String(m.qualityScore),
                String(m.overdueActivities ?? 0),
                String(m.leadsWithoutActivity ?? 0),
                String(m.dealsWithoutNextStep ?? 0),
                String((m.staleLeads || 0) + (m.staleDeals || 0)),
              ]),
            },
          ]
        : []),
      ...(Object.keys(risk).length
        ? [
            {
              title: "Финансовый риск (оценка по сделкам без движения)",
              columns: ["Валюта", "Сумма"],
              rows: Object.entries(risk).map(([c, v]) => [
                c,
                Math.round(Number(v) || 0).toLocaleString("ru-RU"),
              ]),
            },
          ]
        : []),
    ],
    sections: [
      {
        title: "Краткий вывод",
        content: formatBusinessText(
          `Критических типов нарушений: ${critical.length}. Предупреждений: ${warnings.length}.`
        ),
      },
    ],
    recommendations: (raw.recommendations || []).map((item) => formatBusinessText(item)),
  };
}

function normalizeLeadsWithoutActivity(raw) {
  return normalizeContactIssueList(
    {
      count: raw.countWithoutActivity,
      countWithOverdueActivityOnly: raw.countWithOverdueActivityOnly,
      sample: raw.withoutActivity,
      withOverdueActivityOnly: raw.withOverdueActivityOnly,
      truncated: raw.truncated,
      sampleLimit: raw.sampleLimit,
      severity: "critical",
      note: raw.note,
    },
    "Лиды без следующего CRM-дела"
  );
}

function normalizeStaleEntities(raw, title) {
  const sample = raw.withoutChanges || raw.sample || [];
  return {
    summary: [
      { label: "Количество", value: raw.count ?? sample.length },
      ...(raw.totalsByCurrency
        ? [
            {
              label: "Суммы",
              value: Object.entries(raw.totalsByCurrency)
                .map(([c, v]) => `${Number(v).toLocaleString("ru-RU")} ${c}`)
                .join("; "),
            },
          ]
        : []),
    ],
    tables: sample.length
      ? [
          {
            title,
            columns: ["ID", "Название", "Стадия", "Дней без изменений", "Ответственный", "Ссылка"],
            rows: sample.map((row) => [
              String(row.id ?? "—"),
              row.title || row.name || "—",
              row.stageName || row.stageId || "—",
              String(row.daysInactive ?? "—"),
              row.responsibleName || (row.responsibleId ? `#${row.responsibleId}` : "—"),
              row.url || "—",
            ]),
          },
        ]
      : [],
    sections: [
      {
        title: "Краткий вывод",
        content: formatBusinessText(
          `${title}: ${raw.count ?? 0}. Основание: ${raw.inactivityBasis || "DATE_MODIFY"}.`
        ),
      },
    ],
  };
}

function normalizeOverdueByManager(raw) {
  const groups = raw.groups || [];
  return {
    summary: [{ label: "Просроченных дел", value: raw.total ?? 0 }],
    tables: groups.length
      ? [
          {
            title: "По менеджерам",
            columns: ["Менеджер", "Всего", "Контакты", "Лиды", "Сделки"],
            rows: groups.map((g) => [
              g.responsibleName || `#${g.responsibleId}`,
              String(g.count ?? 0),
              String(g.byOwnerType?.contact ?? 0),
              String(g.byOwnerType?.lead ?? 0),
              String(g.byOwnerType?.deal ?? 0),
            ]),
          },
        ]
      : [],
    sections: [
      {
        title: "Краткий вывод",
        content: formatBusinessText(`Просроченных CRM-дел: ${raw.total ?? 0}.`),
      },
    ],
  };
}

function normalizeConfigError(raw) {
  return {
    summary: [],
    tables: [],
    sections: [
      {
        title: "Требуется настройка",
        content: formatBusinessText(raw?.error?.message || "Недостаточно конфигурации."),
      },
      ...(raw?.error?.details?.recommendedAction
        ? [
            {
              title: "Рекомендуемое действие",
              content: formatBusinessText(
                `Запустите ${raw.error.details.recommendedAction} и заполните переменные .env.`
              ),
            },
          ]
        : []),
    ],
    recommendations: [
      formatBusinessText("См. docs/contact-analytics.md и docs/manager-analytics.md."),
    ],
  };
}

function normalizeStub() {
  return {
    summary: [],
    tables: [],
    sections: [
      {
        title: "Статус",
        content: formatBusinessText("Этот отчёт зарегистрирован, но пока не реализован."),
      },
    ],
    recommendations: [
      formatBusinessText("Дождитесь реализации отчёта на сервере или выберите другой тип."),
    ],
    implemented: false,
    error: {
      code: "REPORT_NOT_IMPLEMENTED",
      message: "Этот отчёт зарегистрирован, но пока не реализован.",
    },
  };
}

function normalizeBody(type, raw) {
  if (raw?.success === false && raw?.error?.code) {
    return normalizeConfigError(raw);
  }

  switch (type) {
    case "funnel_summary":
      return normalizeFunnelSummary(raw);
    case "deal_count_by_stage":
      return normalizeStageCount(raw);
    case "deal_sum_by_stage":
      return normalizeStageSum(raw);
    case "overdue_tasks":
      return normalizeTasksList(raw);
    case "deals_without_next_step":
      return normalizeDealsList(raw, "Сделки без следующего шага");
    case "deals_without_activity":
      return normalizeDealsList(raw, "Сделки без активности");
    case "leads_without_assigned":
    case "leads_without_responsible":
      return normalizeLeadsList(raw);
    case "new_deals_period":
      return normalizePeriodDeals(raw, "Новые сделки за период");
    case "closed_deals_period":
      return normalizePeriodDeals(raw, "Закрытые сделки за период");
    case "contact_count_by_status":
      return normalizeContactStatusGroups(raw);
    case "contacts_without_status":
      return normalizeContactIssueList(raw, "Контакты без статуса");
    case "contacts_without_company":
      return normalizeContactIssueList(raw, "Контакты без компании");
    case "contacts_missing_birthday":
      return normalizeContactIssueList(raw, "Контакты без даты рождения");
    case "contacts_cycle_without_next_activity":
      return normalizeContactIssueList(raw, "Цикл без следующего дела");
    case "contacts_birthday_activity_report":
      return normalizeBirthdayReport(raw);
    case "contact_quality_report":
      return normalizeContactQuality(raw);
    case "manager_workload":
      return normalizeManagerWorkload(raw);
    case "crm_discipline_report":
      return normalizeCrmDiscipline(raw);
    case "leads_without_next_activity":
      return normalizeLeadsWithoutActivity(raw);
    case "stale_leads_report":
      return normalizeStaleEntities(raw, raw.title || "Лиды без изменений");
    case "stale_deals_report":
      return normalizeStaleEntities(raw, raw.title || "Сделки без изменений");
    case "overdue_activities_by_manager":
      return normalizeOverdueByManager(raw);
    default:
      return {
        summary: [{ label: "Записей", value: Array.isArray(raw) ? raw.length : 1 }],
        tables: [],
        sections: [
          {
            title: "Данные",
            content: formatBusinessText("Отчёт сформирован. Подробности в таблицах ниже."),
          },
        ],
      };
  }
}

/**
 * Приводит сырой результат к единому формату отчёта.
 */
export function normalizeReport({ type, title, raw, params = {}, funnel = null, implemented = true }) {
  const configErrorCodes = new Set([
    "REPORT_NOT_IMPLEMENTED",
    "CONTACT_STATUS_FIELD_NOT_CONFIGURED",
    "CONTACT_STATUS_CYCLE_VALUES_NOT_CONFIGURED",
    "CRM_ACTIVITIES_ACCESS_DENIED",
    "TASKS_ACCESS_DENIED",
  ]);

  if (
    !implemented ||
    raw?.error?.code === "REPORT_NOT_IMPLEMENTED" ||
    (raw?.success === false && configErrorCodes.has(raw?.error?.code) && type === "manager_workload")
  ) {
    if (!implemented || raw?.error?.code === "REPORT_NOT_IMPLEMENTED") {
      const stub = normalizeStub();
      return {
        id: crypto.randomBytes(8).toString("hex"),
        type,
        title: formatBusinessText(title),
        period: buildPeriod(params),
        funnel: funnel ? { id: funnel.id, name: formatBusinessText(funnel.name) } : null,
        summary: stub.summary,
        sections: stub.sections,
        tables: stub.tables,
        recommendations: stub.recommendations,
        source: "Bitrix24",
        createdAt: new Date().toISOString(),
        implemented: false,
        success: false,
        error: stub.error,
      };
    }
  }

  if (raw?.success === false && raw?.error?.code && configErrorCodes.has(raw.error.code)) {
    const body = normalizeConfigError(raw);
    return {
      id: crypto.randomBytes(8).toString("hex"),
      type,
      title: formatBusinessText(title),
      period: buildPeriod(params),
      funnel: funnel ? { id: funnel.id, name: formatBusinessText(funnel.name) } : null,
      summary: body.summary || [],
      sections: body.sections || [],
      tables: body.tables || [],
      recommendations: body.recommendations || [],
      source: "Bitrix24",
      createdAt: new Date().toISOString(),
      implemented: true,
      success: false,
      error: raw.error,
    };
  }

  const body = normalizeBody(type, raw);
  const tables = Array.isArray(body.tables) ? body.tables : body.tables ? [body.tables] : [];

  return {
    id: crypto.randomBytes(8).toString("hex"),
    type,
    title: formatBusinessText(title),
    period: buildPeriod(params),
    funnel: funnel ? { id: funnel.id, name: formatBusinessText(funnel.name) } : null,
    summary: body.summary || [],
    sections: body.sections || [],
    tables,
    recommendations: body.recommendations || defaultRecommendations(type, raw),
    source: "Bitrix24",
    createdAt: new Date().toISOString(),
    implemented: true,
    success: true,
  };
}

/**
 * Текстовая версия отчёта для копирования.
 */
export function reportToPlainText(report) {
  const lines = [
    report.title,
    `Период: ${report.period?.dateFrom || "—"} — ${report.period?.dateTo || "—"}`,
  ];

  if (report.funnel?.name) {
    lines.push(`Воронка: ${report.funnel.name}`);
  }

  lines.push("");

  if (report.summary?.length) {
    lines.push("Краткая сводка:");
    for (const item of report.summary) {
      lines.push(`${item.label}: ${item.value}`);
    }
    lines.push("");
  }

  for (const section of report.sections || []) {
    lines.push(section.title);
    lines.push(section.content);
    lines.push("");
  }

  for (const table of report.tables || []) {
    lines.push(table.title);
    lines.push(table.columns.join(" | "));
    for (const row of table.rows) {
      lines.push(row.join(" | "));
    }
    lines.push("");
  }

  if (report.recommendations?.length) {
    lines.push("Рекомендации:");
    for (const item of report.recommendations) {
      lines.push(`- ${item}`);
    }
  }

  return formatBusinessText(lines.join("\n"));
}
