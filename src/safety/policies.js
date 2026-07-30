import { defaultPermissionsForAccess } from "../auth/permissions.js";

/** @typedef {object} ActionPolicy
 * ... existing retained via structure
 */

function withAuthz(policy) {
  if (!policy) return null;
  if (policy.blocked) {
    return {
      ...policy,
      requiredPermissions: policy.requiredPermissions || ["settings.manage"],
      confirmPermissions: policy.confirmPermissions || [],
      dataScope: policy.dataScope || "none",
    };
  }
  if (policy.requiredPermissions?.length) return policy;
  const defaults = defaultPermissionsForAccess(policy.access);
  return {
    ...defaults,
    ...policy,
    requiredPermissions: policy.requiredPermissions || defaults.requiredPermissions,
    confirmPermissions: policy.confirmPermissions || defaults.confirmPermissions,
    dataScope: policy.dataScope || defaults.dataScope,
  };
}

function read(extra = {}) {
  return {
    access: "read",
    risk: "low",
    requiresConfirmation: false,
    supportsPreview: false,
    reversible: false,
    bulk: false,
    auditStatus: "read_only",
    ...extra,
  };
}

function write(extra = {}) {
  return {
    access: "write",
    risk: "medium",
    requiresConfirmation: true,
    supportsPreview: true,
    reversible: true,
    bulk: false,
    auditStatus: "rollback_supported",
    ...extra,
  };
}

function createEntity(extra = {}) {
  return write({
    reversible: "conditional",
    auditStatus: "rollback_conditional",
    ...extra,
  });
}

function destructive(extra = {}) {
  return {
    access: "destructive",
    risk: "high",
    requiresConfirmation: true,
    supportsPreview: true,
    reversible: false,
    bulk: false,
    auditStatus: "protected",
    ...extra,
  };
}

function structuralBlocked(title, reason) {
  return {
    access: "structural",
    risk: "critical",
    requiresConfirmation: true,
    supportsPreview: false,
    reversible: false,
    bulk: false,
    blocked: true,
    blockReason: reason,
    title,
    auditStatus: "blocked",
  };
}

function bulkBlocked(title) {
  return {
    access: "write",
    risk: "high",
    requiresConfirmation: true,
    supportsPreview: true,
    reversible: true,
    bulk: true,
    blocked: true,
    blockReason:
      "Массовые изменения заблокированы по умолчанию. Включите BITRIX_BULK_ACTIONS_ENABLED и используйте operation plan.",
    title,
    auditStatus: "blocked",
  };
}

/** @type {Record<string, ActionPolicy>} */
export const ACTION_POLICIES = {
  // --- Read: leads / deals / crm ---
  lead_stage_list: read({ title: "Стадии лидов" }),
  lead_list: read({ title: "Список лидов" }),
  lead_get: read({ title: "Карточка лида" }),
  lead_count: read({ title: "Количество лидов" }),
  lead_fields: read({ title: "Поля лида" }),
  lead_product_rows_get: read({ title: "Товары лида" }),
  deal_category_list: read({ title: "Воронки" }),
  deal_stage_list: read({ title: "Стадии сделок" }),
  deal_create_prepare: read({ title: "Подготовка создания сделки" }),
  deal_list: read({ title: "Список сделок" }),
  deal_get: read({ title: "Карточка сделки" }),
  deal_count: read({ title: "Количество сделок" }),
  deal_fields: read({ title: "Поля сделки" }),
  deal_product_rows_get: read({ title: "Товары сделки" }),
  contact_list: read({ title: "Список контактов" }),
  contact_get: read({ title: "Карточка контакта" }),
  company_list: read({ title: "Список компаний" }),
  company_get: read({ title: "Карточка компании" }),
  timeline_comment_list: read({ title: "Комментарии таймлайна CRM" }),
  stagehistory_list: read({ title: "История стадий CRM" }),
  timeline_list: read({ title: "Таймлайн" }),
  activity_list: read({ title: "CRM-дела" }),
  search_tasks: read({ title: "Поиск задач" }),
  get_task_by_id: read({ title: "Карточка задачи" }),
  search_users: read({ title: "Поиск пользователей" }),
  user_get: read({ title: "Пользователь" }),
  department_list: read({ title: "Подразделения" }),

  // --- Analytics (read) ---
  lead_count_by_stage: read({ title: "Лиды по стадиям" }),
  deal_count_by_stage: read({ title: "Сделки по стадиям" }),
  deal_sum_by_stage: read({ title: "Суммы по стадиям" }),
  lead_conversion_report: read({ title: "Конверсия лидов" }),
  crm_funnel_summary: read({ title: "Сводка воронки" }),
  overdue_activity_report: read({ title: "Просроченные дела" }),
  overdue_tasks_report: read({ title: "Просроченные задачи" }),
  deals_without_next_step: read({ title: "Сделки без шага" }),
  leads_without_responsible: read({ title: "Лиды без ответственного" }),
  leads_without_assigned: read({ title: "Лиды без ответственного" }),
  deals_without_activity: read({ title: "Сделки без активности" }),
  new_deals_period: read({ title: "Новые сделки" }),
  closed_deals_period: read({ title: "Закрытые сделки" }),
  contact_field_audit: read({ title: "Аудит полей контакта" }),
  contact_count: read({ title: "Количество контактов" }),
  contact_count_by_status: read({ title: "Контакты по статусам" }),
  contacts_without_status: read({ title: "Контакты без статуса" }),
  contacts_without_company: read({ title: "Контакты без компании" }),
  contacts_missing_birthday: read({ title: "Контакты без ДР" }),
  contacts_cycle_without_next_activity: read({ title: "Цикл без дела" }),
  contacts_birthday_activity_report: read({ title: "Поздравления" }),
  contact_quality_report: read({ title: "Качество контактов" }),
  manager_workload: read({ title: "Нагрузка менеджеров" }),
  leads_without_next_activity: read({ title: "Лиды без дела" }),
  stale_leads_report: read({ title: "Лиды без изменений" }),
  stale_deals_report: read({ title: "Сделки без изменений" }),
  overdue_activities_by_manager: read({ title: "Просрочки по менеджерам" }),
  crm_discipline_report: read({ title: "Дисциплина CRM" }),
  sales_forecast: read({ title: "Прогноз продаж", risk: "low" }),
  crm_duplicate_search: read({ title: "Поиск дублей" }),

  // --- Single writes with preview/rollback ---
  deal_update: write({ title: "Изменение сделки", risk: "medium" }),
  lead_update: write({ title: "Изменение лида", risk: "medium" }),
  contact_update: write({ title: "Изменение контакта", risk: "medium" }),
  company_update: write({ title: "Изменение компании", risk: "medium" }),
  update_task: write({ title: "Изменение задачи", risk: "medium" }),
  activity_update: write({ title: "Изменение CRM-дела", risk: "medium" }),
  activity_complete: write({
    title: "Завершение CRM-дела",
    risk: "medium",
    reversible: "conditional",
    auditStatus: "rollback_conditional",
  }),
  clear_task_deadline: write({ title: "Сброс срока задачи" }),
  detach_task_from_group: write({ title: "Отвязка задачи от группы" }),
  lead_product_rows_set: write({
    title: "Товары лида",
    risk: "high",
    reversible: false,
    auditStatus: "protected",
  }),
  deal_product_rows_set: write({
    title: "Товары сделки",
    risk: "high",
    reversible: false,
    auditStatus: "protected",
  }),

  // --- Creates (conditional rollback) ---
  create_deal: createEntity({ title: "Создание сделки" }),
  lead_create: createEntity({ title: "Создание лида" }),
  contact_create: createEntity({ title: "Создание контакта" }),
  company_create: createEntity({ title: "Создание компании" }),
  create_task: createEntity({ title: "Создание задачи" }),
  activity_add: createEntity({
    title: "Создание CRM-дела",
    reversible: false,
    auditStatus: "protected",
  }),
  timeline_comment_add: write({
    title: "Комментарий в таймлайн",
    risk: "low",
    reversible: false,
    auditStatus: "protected",
  }),
  add_task_result: write({
    title: "Результат задачи",
    reversible: false,
    auditStatus: "protected",
  }),
  send_chat_message: write({
    title: "Сообщение в чат",
    risk: "medium",
    reversible: false,
    auditStatus: "protected",
  }),
  create_check_list: createEntity({ title: "Создание чек-листа" }),
  create_check_list_item: createEntity({ title: "Пункт чек-листа" }),
  update_check_list: write({ title: "Изменение чек-листа" }),
  update_check_list_item: write({ title: "Изменение пункта чек-листа" }),
  add_accomplices: write({ title: "Добавление соисполнителей", reversible: "conditional", auditStatus: "rollback_conditional" }),
  delete_accomplices: write({ title: "Удаление соисполнителей", reversible: "conditional", auditStatus: "rollback_conditional" }),
  add_auditors: write({ title: "Добавление наблюдателей", reversible: "conditional", auditStatus: "rollback_conditional" }),
  add_current_user_as_auditor: write({ title: "Стать наблюдателем", reversible: "conditional", auditStatus: "rollback_conditional" }),
  delete_auditors: write({ title: "Удаление наблюдателей", reversible: "conditional", auditStatus: "rollback_conditional" }),
  add_task_reminder: write({
    title: "Напоминание по задаче",
    reversible: false,
    auditStatus: "protected",
  }),

  // --- Destructive (preview, no rollback) ---
  lead_delete: destructive({ title: "Удаление лида", risk: "critical" }),
  deal_delete: destructive({ title: "Удаление сделки", risk: "critical" }),
  delete_task: destructive({ title: "Удаление задачи", risk: "high" }),
  activity_delete: destructive({ title: "Удаление CRM-дела", risk: "high" }),
  delete_check_list: destructive({ title: "Удаление чек-листа" }),
  delete_check_list_item: destructive({ title: "Удаление пункта чек-листа" }),

  // --- Structural / mass — permanently blocked at this stage ---
  delete_funnel: structuralBlocked(
    "Удаление воронки",
    "Удаление воронок заблокировано политикой безопасности."
  ),
  delete_funnel_stage: structuralBlocked(
    "Удаление стадии",
    "Удаление стадий заблокировано политикой безопасности."
  ),
  create_default_funnel: structuralBlocked(
    "Создание воронки",
    "Структурные изменения CRM заблокированы."
  ),
  create_funnel_with_custom_stages: structuralBlocked(
    "Создание воронки со стадиями",
    "Структурные изменения CRM заблокированы."
  ),
  create_new_funnel_stage: structuralBlocked(
    "Создание стадии",
    "Структурные изменения CRM заблокированы."
  ),
  rename_funnel_title: structuralBlocked(
    "Переименование воронки",
    "Структурные изменения CRM заблокированы."
  ),
  rename_funnel_stages: structuralBlocked(
    "Переименование стадий",
    "Структурные изменения CRM заблокированы."
  ),
  update_funnel_stages: structuralBlocked(
    "Изменение стадий",
    "Структурные изменения CRM заблокированы."
  ),
  create_crm_custom_field: structuralBlocked(
    "Создание пользовательского поля",
    "Структурные изменения CRM заблокированы."
  ),
  move_deals_between_funnels: bulkBlocked("Массовый перенос сделок между воронками"),
  move_deals_between_stages: bulkBlocked("Массовый перенос сделок между стадиями"),
  lead_bulk_update: bulkBlocked("Массовое изменение лидов"),
  deal_bulk_update: bulkBlocked("Массовое изменение сделок"),

  // stubs / not implemented — still have policy so they are not "missing"
  checklist_reorder: write({
    title: "Перестановка чек-листа",
    blocked: true,
    blockReason: "Action не реализован.",
    auditStatus: "blocked",
  }),
  set_daily_task_recurrence: write({
    title: "Ежедневная повторяемость",
    blocked: true,
    blockReason: "Action не реализован.",
    auditStatus: "blocked",
  }),
  set_weekly_task_recurrence: write({
    title: "Еженедельная повторяемость",
    blocked: true,
    blockReason: "Action не реализован.",
    auditStatus: "blocked",
  }),
  set_monthly_by_month_days_task_recurrence: write({
    title: "Ежемесячная повторяемость",
    blocked: true,
    blockReason: "Action не реализован.",
    auditStatus: "blocked",
  }),
  set_monthly_by_week_days_task_recurrence: write({
    title: "Ежемесячная повторяемость",
    blocked: true,
    blockReason: "Action не реализован.",
    auditStatus: "blocked",
  }),
  set_yearly_by_month_days_task_recurrence: write({
    title: "Ежегодная повторяемость",
    blocked: true,
    blockReason: "Action не реализован.",
    auditStatus: "blocked",
  }),
  set_yearly_by_week_days_task_recurrence: write({
    title: "Ежегодная повторяемость",
    blocked: true,
    blockReason: "Action не реализован.",
    auditStatus: "blocked",
  }),

  crm_context_get: read({
    title: "Контекст клиента",
    requiredPermissions: ["crm.context.read"],
    dataScope: "crm_entity",
  }),
  crm_context_summary: read({
    title: "Сводка по клиенту",
    requiredPermissions: ["crm.context.read"],
    dataScope: "crm_entity",
  }),
  meeting_protocol_generate: read({
    title: "Генерация протокола встречи",
    requiredPermissions: ["crm.context.read"],
  }),
  client_message_draft: read({
    title: "Черновик сообщения клиенту",
    requiredPermissions: ["communications.draft"],
  }),
  client_message_send: write({
    title: "Отправка сообщения клиенту",
    risk: "high",
    requiresConfirmation: true,
    supportsPreview: true,
    reversible: false,
    bulk: false,
    auditStatus: "protected",
    requiredPermissions: ["communications.send", "operations.prepare"],
    confirmPermissions: ["operations.confirm.own"],
    dataScope: "crm_entity",
  }),
  recommend_next_client_action: read({
    title: "Рекомендация следующего шага",
    requiredPermissions: ["crm.context.read"],
  }),

  // Communications Hub
  communication_channels_list: read({
    title: "Каналы Communications Hub",
    requiredPermissions: ["communications.view.own"],
  }),
  communication_thread_get: read({
    title: "Диалог Communications Hub",
    requiredPermissions: ["communications.view.own"],
  }),
  communication_contact_context: read({
    title: "Контекст коммуникаций контакта",
    requiredPermissions: ["communications.view.own", "crm.context.read"],
    dataScope: "crm_entity",
  }),
  communication_message_draft: read({
    title: "Черновик Hub-сообщения",
    requiredPermissions: ["communications.draft"],
  }),
  communication_message_send_prepare: write({
    title: "Подготовка отправки Hub-сообщения",
    risk: "high",
    requiresConfirmation: true,
    supportsPreview: true,
    reversible: false,
    bulk: false,
    auditStatus: "protected",
    requiredPermissions: ["communications.send", "operations.prepare"],
    confirmPermissions: ["operations.confirm.own"],
  }),
  communication_campaign_preview: read({
    title: "Preview кампании",
    requiredPermissions: ["communications.send"],
  }),
  communication_campaign_start_prepare: write({
    title: "Запуск кампании",
    risk: "high",
    requiresConfirmation: true,
    supportsPreview: true,
    reversible: false,
    bulk: true,
    auditStatus: "protected",
    requiredPermissions: ["communications.send", "operations.prepare"],
    confirmPermissions: ["operations.confirm.own"],
  }),
  communication_campaign_pause_prepare: write({
    title: "Пауза кампании",
    risk: "medium",
    requiresConfirmation: true,
    supportsPreview: true,
    reversible: false,
    requiredPermissions: ["communications.send", "operations.prepare"],
    confirmPermissions: ["operations.confirm.own"],
  }),
  communication_campaign_cancel_prepare: write({
    title: "Отмена кампании",
    risk: "medium",
    requiresConfirmation: true,
    supportsPreview: true,
    reversible: false,
    requiredPermissions: ["communications.send", "operations.prepare"],
    confirmPermissions: ["operations.confirm.own"],
  }),
  communication_sequence_list: read({
    title: "Список цепочек",
    requiredPermissions: ["communications.view.own"],
  }),
  communication_sequence_activate_prepare: write({
    title: "Активация цепочки",
    risk: "medium",
    requiresConfirmation: true,
    supportsPreview: true,
    reversible: false,
    requiredPermissions: ["communications.manage", "operations.prepare"],
    confirmPermissions: ["operations.confirm.own"],
  }),
  communication_sequence_enroll_prepare: write({
    title: "Подключение к цепочке",
    risk: "high",
    requiresConfirmation: true,
    supportsPreview: true,
    reversible: false,
    requiredPermissions: ["communications.send", "operations.prepare"],
    confirmPermissions: ["operations.confirm.own"],
  }),
  communication_enrollment_stop_prepare: write({
    title: "Остановка enrollment",
    risk: "medium",
    requiresConfirmation: true,
    supportsPreview: true,
    reversible: false,
    requiredPermissions: ["communications.send", "operations.prepare"],
    confirmPermissions: ["operations.confirm.own"],
  }),
  communication_delivery_report: read({
    title: "Отчёт доставки",
    requiredPermissions: ["communications.view.own"],
  }),
  communication_unanswered_report: read({
    title: "Неотвеченные сообщения",
    requiredPermissions: ["communications.view.own"],
  }),
};

export function getActionPolicy(actionName) {
  if (!actionName) return null;
  const raw = ACTION_POLICIES[actionName] || null;
  if (!raw) return null;
  return withAuthz(raw);
}

export function hasActionPolicy(actionName) {
  return Boolean(ACTION_POLICIES[actionName]);
}

export function isReadPolicy(policy) {
  return policy?.access === "read" && !policy?.blocked;
}

export function isBlockedPolicy(policy) {
  return Boolean(policy?.blocked);
}

export function listPolicies() {
  return Object.entries(ACTION_POLICIES).map(([name, policy]) => ({
    name,
    ...withAuthz(policy),
  }));
}
