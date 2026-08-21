import * as dealCreateActions from "./dealCreateActions.js";
import * as leadActions from "./leadActions.js";
import * as dealActions from "./dealActions.js";
import * as crmActions from "./crmActions.js";
import * as taskActions from "./taskActions.js";
import * as taskMemberActions from "./taskMemberActions.js";
import * as checklistActions from "./checklistActions.js";
import * as reminderActions from "./reminderActions.js";
import * as userActions from "./userActions.js";
import * as timelineActions from "./timelineActions.js";
import * as analyticsActions from "./analyticsActions.js";
import * as contactAnalyticsActions from "./contactAnalyticsActions.js";
import * as managerAnalyticsActions from "./managerAnalyticsActions.js";
import * as clientContextActions from "./clientContextActions.js";

/** Канонические обработчики actions. */
const handlers = {
  ...dealCreateActions,
  ...leadActions,
  ...dealActions,
  ...crmActions,
  ...taskActions,
  ...taskMemberActions,
  ...checklistActions,
  ...reminderActions,
  ...userActions,
  ...timelineActions,
  ...analyticsActions,
  ...contactAnalyticsActions,
  ...managerAnalyticsActions,
  ...clientContextActions,
};

/** Алиасы REST-методов Bitrix24 → каноническое имя action. */
const aliases = {
  "crm.lead.list": "lead_list",
  "crm.lead.get": "lead_get",
  "crm.lead.update": "lead_update",
  "crm.lead.add": "lead_create",
  "crm.lead.delete": "lead_delete",
  "crm.lead.fields": "lead_fields",
  "crm.deal.list": "deal_list",
  "crm.deal.get": "deal_get",
  "crm.deal.update": "deal_update",
  "crm.deal.delete": "deal_delete",
  "crm.deal.fields": "deal_fields",
  "crm.contact.list": "contact_list",
  "crm.contact.get": "contact_get",
  "crm.contact.add": "contact_create",
  "crm.contact.update": "contact_update",
  "crm.company.list": "company_list",
  "crm.company.get": "company_get",
  "crm.company.add": "company_create",
  "crm.company.update": "company_update",
  "crm.timeline.comment.add": "timeline_comment_add",
  "crm.timeline.comment.list": "timeline_comment_list",
  "crm.stagehistory.list": "stagehistory_list",
  "crm.activity.list": "activity_list",
  "crm.activity.add": "activity_add",
  "crm.activity.todo.add": "activity_add",
  "crm.activity.update": "activity_update",
  "crm.activity.delete": "activity_delete",
  "tasks.task.add": "create_task",
  "tasks.task.list": "search_tasks",
  "tasks.task.get": "get_task_by_id",
  "tasks.task.update": "update_task",
  "tasks.task.delete": "delete_task",
  "user.search": "search_users",
  crm_user_list: "search_users",
};

/** Метаданные actions для GET /bitrix/actions. */
const actionCatalog = [
  // Лиды
  { name: "lead_stage_list", description: "Стадии лидов (crm.status.list, ENTITY_ID=STATUS)", params: { name: "string (optional)" }, destructive: false, implemented: true },
  { name: "lead_list", aliases: ["crm.lead.list"], description: "Список лидов", params: { filter: {}, select: [], order: {}, start: 0 }, destructive: false, implemented: true },
  { name: "lead_get", aliases: ["crm.lead.get"], description: "Получить лид по ID", params: { id: "number" }, destructive: false, implemented: true },
  { name: "lead_count", description: "Подсчёт лидов", params: { filter: {} }, destructive: false, implemented: true },
  { name: "lead_update", aliases: ["crm.lead.update"], description: "Обновить лид", params: { id: "number", fields: {} }, destructive: false, implemented: true },
  { name: "lead_create", aliases: ["crm.lead.add"], description: "Создать лид", params: { fields: {} }, destructive: false, implemented: true },
  { name: "lead_delete", aliases: ["crm.lead.delete"], description: "Удалить лид", params: { id: "number", confirm: true }, destructive: true, implemented: true },
  { name: "lead_fields", aliases: ["crm.lead.fields"], description: "Поля лида", params: {}, destructive: false, implemented: true },
  { name: "lead_product_rows_get", description: "Товарные позиции лида", params: { id: "number" }, destructive: false, implemented: true },
  { name: "lead_product_rows_set", description: "Установить товарные позиции лида", params: { id: "number", rows: [] }, destructive: false, implemented: true },
  { name: "lead_bulk_update", description: "Массовое обновление лидов", params: {}, destructive: false, implemented: false },

  // Воронки и CRM
  { name: "deal_category_list", description: "Список воронок сделок", params: { name: "string (optional)" }, destructive: false, implemented: true },
  { name: "deal_stage_list", description: "Стадии сделок в воронке", params: { categoryId: 0, name: "string (optional)" }, destructive: false, implemented: true },
  { name: "deal_create_prepare", description: "Подготовить создание сделки (сотрудник, воронка, стадия, обязательные поля) без записи в CRM", params: { title: "string", assigneeQuery: "string", assignedById: "number", categoryId: 0, categoryName: "string", stageId: "string", fields: {} }, destructive: false, implemented: true },
  { name: "create_deal", description: "Создать сделку", params: { title: "string", categoryId: 0, stageId: "string", opportunity: 0, fields: {} }, destructive: false, implemented: true },
  { name: "create_default_funnel", description: "Создать воронку", params: { name: "string" }, destructive: false, implemented: true },
  { name: "create_funnel_with_custom_stages", description: "Создать воронку с кастомными стадиями", params: { name: "string", stages: [] }, destructive: false, implemented: true },
  { name: "create_new_funnel_stage", description: "Добавить стадию в воронку", params: { categoryId: 0, name: "string", statusId: "string", color: "string", sort: 100 }, destructive: false, implemented: true },
  { name: "rename_funnel_title", description: "Переименовать воронку", params: { categoryId: "number", name: "string" }, destructive: false, implemented: true },
  { name: "rename_funnel_stages", description: "Переименовать стадии", params: { stages: [{ id: "number", name: "string" }] }, destructive: false, implemented: true },
  { name: "update_funnel_stages", description: "Обновить стадии воронки", params: { stages: [{ id: "number", name: "string", color: "string", sort: 0 }] }, destructive: false, implemented: true },
  { name: "delete_funnel", description: "Удалить воронку", params: { categoryId: "number", confirm: true }, destructive: true, implemented: true },
  { name: "delete_funnel_stage", description: "Удалить стадию воронки", params: { id: "number", confirm: true }, destructive: true, implemented: true },
  { name: "move_deals_between_funnels", description: "Перенести сделки между воронками", params: { fromCategoryId: 0, toCategoryId: 1, toStageId: "string", filter: {}, limit: 50 }, destructive: false, implemented: true },
  { name: "move_deals_between_stages", description: "Перенести сделки между стадиями", params: { categoryId: 0, fromStageId: "string", toStageId: "string", limit: 50 }, destructive: false, implemented: true },
  { name: "create_crm_custom_field", description: "Создать пользовательское поле CRM", params: { entityType: "deal|lead|contact|company", fieldName: "string", label: "string", type: "string" }, destructive: false, implemented: true },
  { name: "crm_duplicate_search", description: "Поиск дубликатов CRM", params: {}, destructive: false, implemented: false },

  // Сделки
  { name: "deal_list", aliases: ["crm.deal.list"], description: "Список сделок", params: { filter: {}, select: [], order: {}, start: 0 }, destructive: false, implemented: true },
  { name: "deal_get", aliases: ["crm.deal.get"], description: "Получить сделку", params: { id: "number" }, destructive: false, implemented: true },
  { name: "deal_count", description: "Подсчёт сделок", params: { filter: {} }, destructive: false, implemented: true },
  { name: "deal_update", aliases: ["crm.deal.update"], description: "Обновить сделку", params: { id: "number", fields: {} }, destructive: false, implemented: true },
  { name: "deal_delete", aliases: ["crm.deal.delete"], description: "Удалить сделку", params: { id: "number", confirm: true }, destructive: true, implemented: true },
  { name: "deal_fields", aliases: ["crm.deal.fields"], description: "Поля сделки", params: {}, destructive: false, implemented: true },
  { name: "deal_product_rows_get", description: "Товарные позиции сделки", params: { id: "number" }, destructive: false, implemented: true },
  { name: "deal_product_rows_set", description: "Установить товарные позиции сделки", params: { id: "number", rows: [] }, destructive: false, implemented: true },
  { name: "deal_bulk_update", description: "Массовое обновление сделок", params: {}, destructive: false, implemented: false },

  // Контакты и компании
  { name: "contact_list", aliases: ["crm.contact.list"], description: "Список контактов", params: { filter: {}, select: [], order: {}, start: 0 }, destructive: false, implemented: true },
  { name: "contact_get", aliases: ["crm.contact.get"], description: "Получить контакт", params: { id: "number" }, destructive: false, implemented: true },
  { name: "contact_create", aliases: ["crm.contact.add"], description: "Создать контакт", params: { fields: {} }, destructive: false, implemented: true },
  { name: "contact_update", aliases: ["crm.contact.update"], description: "Обновить контакт", params: { id: "number", fields: {} }, destructive: false, implemented: true },
  { name: "company_list", aliases: ["crm.company.list"], description: "Список компаний", params: { filter: {}, select: [], order: {}, start: 0 }, destructive: false, implemented: true },
  { name: "company_get", aliases: ["crm.company.get"], description: "Получить компанию", params: { id: "number" }, destructive: false, implemented: true },
  { name: "company_create", aliases: ["crm.company.add"], description: "Создать компанию", params: { fields: {} }, destructive: false, implemented: true },
  { name: "company_update", aliases: ["crm.company.update"], description: "Обновить компанию", params: { id: "number", fields: {} }, destructive: false, implemented: true },

  // Таймлайн и дела
  { name: "timeline_comment_add", aliases: ["crm.timeline.comment.add"], description: "Комментарий в таймлайн CRM", params: { entityType: "lead|deal|contact|company", entityId: "number", comment: "string" }, destructive: false, implemented: true },
  {
    name: "timeline_comment_list",
    aliases: ["crm.timeline.comment.list"],
    description: "Получение комментариев таймлайна CRM-элемента (лид, сделка, контакт, компания)",
    params: { filter: { ENTITY_ID: "number", ENTITY_TYPE: "deal|lead|contact|company" }, entityType: "deal|lead|contact|company", entityId: "number", order: {}, select: [], start: 0, limit: 50, allPages: false },
    userScenarios: [
      "Покажи комментарии сделки 123",
      "Что менеджеры писали в таймлайне лида 456",
    ],
    destructive: false,
    implemented: true,
  },
  {
    name: "stagehistory_list",
    aliases: ["crm.stagehistory.list"],
    description: "Получение истории перемещения лида, сделки или другого CRM-элемента по стадиям",
    params: { entityTypeId: "number", entityType: "deal|lead|contact|company", entityId: "number", filter: { OWNER_ID: "number" }, order: {}, select: [], start: 0, limit: 50, allPages: false },
    userScenarios: [
      "Покажи историю стадий сделки 123",
      "Сколько времени сделка 123 находилась на каждой стадии",
    ],
    destructive: false,
    implemented: true,
  },
  { name: "timeline_list", description: "История: комментарии + дела", params: { entityType: "string", entityId: "number" }, destructive: false, implemented: true },
  { name: "activity_list", aliases: ["crm.activity.list"], description: "Список дел CRM", params: { filter: {}, select: [], order: {} }, destructive: false, implemented: true },
  { name: "activity_add", aliases: ["crm.activity.add", "crm.activity.todo.add"], description: "Создать CRM-дело (todo). fields: OWNER_TYPE_ID, OWNER_ID, SUBJECT, RESPONSIBLE_ID?, DEADLINE?", params: { fields: { OWNER_TYPE_ID: 2, OWNER_ID: 0, SUBJECT: "", RESPONSIBLE_ID: 0 } }, destructive: false, implemented: true },
  { name: "activity_update", aliases: ["crm.activity.update"], description: "Обновить дело CRM", params: { id: "number", fields: {} }, destructive: false, implemented: true },
  { name: "activity_delete", aliases: ["crm.activity.delete"], description: "Удалить дело CRM", params: { id: "number", confirm: true }, destructive: true, implemented: true },
  { name: "activity_complete", description: "Закрыть дело как выполненное", params: { id: "number" }, destructive: false, implemented: true },

  // Задачи
  { name: "create_task", aliases: ["tasks.task.add"], description: "Создать задачу", params: { title: "string", description: "string", responsibleId: 1, deadline: "ISO date", groupId: 0, crmBindings: [] }, destructive: false, implemented: true },
  { name: "search_tasks", aliases: ["tasks.task.list"], description: "Поиск задач", params: { filter: {}, select: [], order: {}, start: 0 }, destructive: false, implemented: true },
  { name: "get_task_by_id", aliases: ["tasks.task.get"], description: "Получить задачу", params: { id: "number" }, destructive: false, implemented: true },
  { name: "update_task", aliases: ["tasks.task.update"], description: "Обновить задачу", params: { id: "number", fields: {} }, destructive: false, implemented: true },
  { name: "delete_task", aliases: ["tasks.task.delete"], description: "Удалить задачу", params: { id: "number", confirm: true }, destructive: true, implemented: true },
  { name: "clear_task_deadline", description: "Очистить дедлайн задачи", params: { id: "number" }, destructive: false, implemented: true },
  { name: "detach_task_from_group", description: "Отвязать задачу от группы", params: { id: "number" }, destructive: false, implemented: true },
  { name: "add_task_result", description: "Добавить результат работы в задачу", params: { taskId: "number", text: "string" }, destructive: false, implemented: true },
  { name: "send_chat_message", description: "Сообщение в чат/комментарии задачи", params: { taskId: "number", message: "string" }, destructive: false, implemented: true },

  // Участники задач и пользователи
  { name: "search_users", aliases: ["user.search", "crm_user_list"], description: "Поиск пользователей", params: { query: "string", filter: {} }, destructive: false, implemented: true },
  { name: "user_get", description: "Получить пользователя", params: { id: "number" }, destructive: false, implemented: true },
  { name: "department_list", description: "Список подразделений", params: { id: "number (optional)" }, destructive: false, implemented: true },
  { name: "add_accomplices", description: "Добавить соисполнителей", params: { taskId: "number", userIds: [] }, destructive: false, implemented: true },
  { name: "delete_accomplices", description: "Удалить соисполнителей", params: { taskId: "number", userIds: [] }, destructive: false, implemented: true },
  { name: "add_auditors", description: "Добавить наблюдателей", params: { taskId: "number", userIds: [] }, destructive: false, implemented: true },
  { name: "add_current_user_as_auditor", description: "Добавить текущего пользователя вебхука как наблюдателя", params: { taskId: "number" }, destructive: false, implemented: true },
  { name: "delete_auditors", description: "Удалить наблюдателей", params: { taskId: "number", userIds: [] }, destructive: false, implemented: true },

  // Чек-листы
  { name: "create_check_list", description: "Создать чек-лист в задаче", params: { taskId: "number", title: "string" }, destructive: false, implemented: true },
  { name: "create_check_list_item", description: "Добавить пункт чек-листа", params: { taskId: "number", title: "string", parentId: 0, sort: 100 }, destructive: false, implemented: true },
  { name: "update_check_list", description: "Обновить чек-лист", params: { id: "number", title: "string", sort: 0 }, destructive: false, implemented: true },
  { name: "update_check_list_item", description: "Обновить пункт чек-листа", params: { id: "number", title: "string", sort: 0 }, destructive: false, implemented: true },
  { name: "delete_check_list", description: "Удалить чек-лист", params: { id: "number" }, destructive: false, implemented: true },
  { name: "delete_check_list_item", description: "Удалить пункт чек-листа", params: { id: "number" }, destructive: false, implemented: true },
  { name: "checklist_reorder", description: "Изменить порядок чек-листа", params: {}, destructive: false, implemented: false },

  // Напоминания и регулярность
  { name: "add_task_reminder", description: "Напоминание по задаче", params: { taskId: "number", userId: "number", remindAt: "ISO date" }, destructive: false, implemented: true },
  { name: "set_daily_task_recurrence", description: "Ежедневная регулярность задачи", params: {}, destructive: false, implemented: false },
  { name: "set_weekly_task_recurrence", description: "Еженедельная регулярность задачи", params: {}, destructive: false, implemented: false },
  { name: "set_monthly_by_month_days_task_recurrence", description: "Ежемесячная регулярность (по дням месяца)", params: {}, destructive: false, implemented: false },
  { name: "set_monthly_by_week_days_task_recurrence", description: "Ежемесячная регулярность (по дням недели)", params: {}, destructive: false, implemented: false },
  { name: "set_yearly_by_month_days_task_recurrence", description: "Ежегодная регулярность (по дням месяца)", params: {}, destructive: false, implemented: false },
  { name: "set_yearly_by_week_days_task_recurrence", description: "Ежегодная регулярность (по дням недели)", params: {}, destructive: false, implemented: false },

  // Аналитика
  { name: "lead_count_by_stage", description: "Лиды по стадиям", params: {}, destructive: false, implemented: true },
  { name: "deal_count_by_stage", description: "Сделки по стадиям", params: { categoryId: 0 }, destructive: false, implemented: true },
  { name: "deal_sum_by_stage", description: "Сумма сделок по стадиям", params: { categoryId: 0 }, destructive: false, implemented: true },
  { name: "lead_conversion_report", description: "Конверсия лидов (упрощённый отчёт)", params: { dateFrom: "string", dateTo: "string" }, destructive: false, implemented: true },
  { name: "crm_funnel_summary", description: "Сводка по воронке", params: { categoryId: 0 }, destructive: false, implemented: true },
  { name: "overdue_activity_report", description: "Просроченные дела", params: { filter: {} }, destructive: false, implemented: true },
  { name: "overdue_tasks_report", description: "Просроченные задачи", params: { filter: {} }, destructive: false, implemented: true },
  { name: "deals_without_next_step", description: "Сделки без следующего шага", params: { categoryId: 0 }, destructive: false, implemented: true },
  { name: "leads_without_responsible", description: "Лиды без ответственного", params: { filter: {} }, destructive: false, implemented: true },
  { name: "leads_without_assigned", description: "Лиды без ответственного", params: { filter: {} }, destructive: false, implemented: true },
  { name: "deals_without_activity", description: "Сделки без активности", params: { categoryId: 0 }, destructive: false, implemented: true },
  { name: "new_deals_period", description: "Новые сделки за период", params: { categoryId: 0, dateFrom: "string", dateTo: "string" }, destructive: false, implemented: true },
  { name: "closed_deals_period", description: "Закрытые сделки за период", params: { categoryId: 0, dateFrom: "string", dateTo: "string" }, destructive: false, implemented: true },
  { name: "manager_workload", description: "Нагрузка и качество ведения CRM по активным менеджерам (includeInactiveUsers: true — вместе с уволенными и без данных CRM)", params: { dateFrom: null, dateTo: null, responsibleIds: [], includeInactiveUsers: false }, destructive: false, implemented: true },
  { name: "sales_forecast", description: "Прогноз продаж", params: {}, destructive: false, implemented: false },

  // Аналитика контактов и качество CRM
  { name: "contact_field_audit", description: "Аудит полей контакта (стандартные и UF)", params: {}, destructive: false, implemented: true },
  { name: "contact_count", description: "Количество контактов", params: { filter: {} }, destructive: false, implemented: true },
  { name: "contact_count_by_status", description: "Контакты по статусам", params: { filter: {} }, destructive: false, implemented: true },
  { name: "contacts_without_status", description: "Контакты без статуса", params: { filter: {} }, destructive: false, implemented: true },
  { name: "contacts_without_company", description: "Контакты без компании", params: { filter: {} }, destructive: false, implemented: true },
  { name: "contacts_missing_birthday", description: "Контакты без даты рождения", params: { responsibleId: null, statusIds: [] }, destructive: false, implemented: true },
  { name: "contacts_cycle_without_next_activity", description: "Контакты в «Цикле» без следующего CRM-дела", params: { responsibleId: null }, destructive: false, implemented: true },
  { name: "contacts_birthday_activity_report", description: "Контроль поздравлений с днём рождения", params: { daysAhead: 30, year: 2026 }, destructive: false, implemented: true },
  { name: "contact_quality_report", description: "Сводный отчёт качества контактов", params: { daysAhead: 30 }, destructive: false, implemented: true },

  // Контроль менеджеров и дисциплина CRM
  { name: "leads_without_next_activity", description: "Лиды без следующего CRM-дела", params: { responsibleIds: [], includeFinalStages: false }, destructive: false, implemented: true },
  { name: "stale_leads_report", description: "Лиды без изменений более N дней", params: { inactiveDays: 14 }, destructive: false, implemented: true },
  { name: "stale_deals_report", description: "Сделки без изменений более N дней", params: { inactiveDays: 14, categoryId: null }, destructive: false, implemented: true },
  { name: "overdue_activities_by_manager", description: "Просроченные CRM-дела по менеджерам", params: { ownerTypes: ["contact", "lead", "deal"] }, destructive: false, implemented: true },
  { name: "crm_discipline_report", description: "Сводный отчёт дисциплины ведения CRM", params: { inactiveDays: 14 }, destructive: false, implemented: true },

  // Client context / meeting
  { name: "crm_context_get", description: "Нормализованный CRM-контекст клиента", params: { entityType: "deal|lead|contact|company", entityId: "number", include: [], mode: "standard" }, destructive: false, implemented: true },
  { name: "crm_context_summary", description: "Управленческая сводка по клиенту", params: { entityType: "deal", entityId: "number" }, destructive: false, implemented: true },
  { name: "meeting_protocol_generate", description: "Сформировать протокол встречи по транскрипту", params: { transcriptId: "uuid", entityType: "lead", entityId: "number" }, destructive: false, implemented: true },
  { name: "client_message_draft", description: "Черновик сообщения клиенту (без отправки)", params: { entityType: "deal", entityId: "number", channel: "whatsapp|email|telegram", purpose: "follow_up" }, destructive: false, implemented: true },
  { name: "client_message_send", description: "Отправка одиночного сообщения клиенту (Safety, irreversible)", params: { draftId: "uuid", channel: "whatsapp|email|telegram|bitrix_chat" }, destructive: false, implemented: true },
  { name: "recommend_next_client_action", description: "Рекомендации следующего шага по клиенту", params: { entityType: "deal", entityId: "number" }, destructive: false, implemented: true },

  // Communications Hub
  { name: "communication_channels_list", description: "Список каналов Wazzup/Hub (без секретов)", params: { sync: false }, destructive: false, implemented: true },
  { name: "communication_thread_get", description: "Диалог Communications Hub", params: { threadId: "uuid" }, destructive: false, implemented: true },
  { name: "communication_contact_context", description: "Контекст переписки контакта для LLM", params: { contactId: "number" }, destructive: false, implemented: true },
  { name: "communication_message_draft", description: "Черновик Hub-сообщения (без отправки)", params: { contactId: "number", channel: "whatsapp|telegram|max", body: "string" }, destructive: false, implemented: true },
  { name: "communication_message_send_prepare", description: "Prepare отправки через Wazzup/Hub/Safety (не шлёт само). channel необязателен: если пусто или wazzup — сам выберет telegram/whatsapp/max по данным контакта и переключится при отсутствии адреса. Если сотрудник явно просит написать, передай firstContactGround=manual_consent.", params: { contactId: "number", channel: "whatsapp|telegram|max", body: "string", username: "string", phone: "string", firstContactGround: "inbound|manual_consent|active_dialog" }, destructive: false, implemented: true },
  { name: "communication_campaign_preview", description: "Preview кампании без отправки", params: { campaignId: "uuid", contacts: [] }, destructive: false, implemented: true },
  { name: "communication_campaign_start_prepare", description: "Prepare запуска кампании (фраза ПОДТВЕРЖДАЮ РАССЫЛКУ N)", params: { campaignId: "uuid" }, destructive: false, implemented: true },
  { name: "communication_campaign_pause_prepare", description: "Prepare паузы кампании", params: { campaignId: "uuid" }, destructive: false, implemented: true },
  { name: "communication_campaign_cancel_prepare", description: "Prepare отмены кампании", params: { campaignId: "uuid" }, destructive: false, implemented: true },
  { name: "communication_sequence_list", description: "Список цепочек касаний", params: { status: "active" }, destructive: false, implemented: true },
  { name: "communication_sequence_activate_prepare", description: "Prepare активации цепочки", params: { sequenceId: "uuid" }, destructive: false, implemented: true },
  { name: "communication_sequence_enroll_prepare", description: "Prepare подключения контакта к цепочке", params: { sequenceId: "uuid", contactId: "number" }, destructive: false, implemented: true },
  { name: "communication_enrollment_stop_prepare", description: "Prepare остановки enrollment", params: { enrollmentId: "uuid" }, destructive: false, implemented: true },
  { name: "communication_delivery_report", description: "Отчёт доставки (без выдуманных read)", params: { sinceDays: 30 }, destructive: false, implemented: true },
  { name: "communication_unanswered_report", description: "Неотвеченные диалоги", params: { limit: 50 }, destructive: false, implemented: true },
];

// Регистрируем алиасы из каталога
for (const entry of actionCatalog) {
  if (entry.aliases) {
    for (const alias of entry.aliases) {
      aliases[alias] = entry.name;
    }
  }
}

export const actionRegistry = handlers;

const STUB_HANDLER_PATTERNS = [
  /not\s+implemented/i,
  /registered\s+but\s+not\s+implemented/i,
  /REPORT_NOT_IMPLEMENTED/,
];

/** Определяет, является ли handler заглушкой notImplementedAction. */
export function isStubHandler(handler) {
  if (typeof handler !== "function") return false;
  if (handler.name === "notImplemented") return true;
  const source = handler.toString();
  return STUB_HANDLER_PATTERNS.some((pattern) => pattern.test(source));
}

/** Полный список actions с metadata для аудита и GET /bitrix/actions. */
export function getActionRegistryEntries() {
  return actionCatalog.map((entry) => {
    const handler = handlers[entry.name];
    const catalogImplemented = entry.implemented !== false;
    const implemented = catalogImplemented && !isStubHandler(handler);

    return {
      name: entry.name,
      aliases: entry.aliases || [],
      description: entry.description,
      params: entry.params,
      userScenarios: entry.userScenarios || [],
      destructive: entry.destructive || false,
      implemented,
      handler,
    };
  });
}

export function getActionHandler(actionName) {
  const key = aliases[actionName] || actionName;
  return handlers[key];
}

export function getActionList() {
  return actionCatalog.map((a) => a.name).sort();
}

export function getActionCatalog() {
  return getActionRegistryEntries()
    .map(({ name, aliases: actionAliases, description, params, userScenarios, destructive, implemented }) => ({
      name,
      aliases: actionAliases,
      description,
      params,
      userScenarios: userScenarios || [],
      destructive,
      implemented,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export { aliases };
