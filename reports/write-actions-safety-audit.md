# Write Actions Safety Audit

Аудит политик безопасности всех зарегистрированных actions Bitrix CRM Assistant.

Источник: `src/safety/policies.js` (ACTION_POLICIES) ↔ `src/actions/index.js` (actionCatalog).

**Всего actions:** 111 (policy = catalog, без расхождений).

---

## Сводка по статусам

| Status | Count |
|---|---:|
| read_only | 55 |
| rollback_supported | 10 |
| rollback_conditional | 13 |
| protected | 13 |
| blocked | 20 |
| **total** | **111** |

## Заблокированные structural / bulk

### Structural (blocked)

| Action | Title | Reason |
|---|---|---|
| `create_crm_custom_field` | Создание пользовательского поля | Структурные изменения CRM заблокированы. |
| `create_default_funnel` | Создание воронки | Структурные изменения CRM заблокированы. |
| `create_funnel_with_custom_stages` | Создание воронки со стадиями | Структурные изменения CRM заблокированы. |
| `create_new_funnel_stage` | Создание стадии | Структурные изменения CRM заблокированы. |
| `delete_funnel` | Удаление воронки | Удаление воронок заблокировано политикой безопасности. |
| `delete_funnel_stage` | Удаление стадии | Удаление стадий заблокировано политикой безопасности. |
| `rename_funnel_stages` | Переименование стадий | Структурные изменения CRM заблокированы. |
| `rename_funnel_title` | Переименование воронки | Структурные изменения CRM заблокированы. |
| `update_funnel_stages` | Изменение стадий | Структурные изменения CRM заблокированы. |

### Bulk (blocked)

| Action | Title | Reason |
|---|---|---|
| `deal_bulk_update` | Массовое изменение сделок | Массовые изменения заблокированы по умолчанию. Включите BITRIX_BULK_ACTIONS_ENABLED и используйте operation plan. |
| `lead_bulk_update` | Массовое изменение лидов | Массовые изменения заблокированы по умолчанию. Включите BITRIX_BULK_ACTIONS_ENABLED и используйте operation plan. |
| `move_deals_between_funnels` | Массовый перенос сделок между воронками | Массовые изменения заблокированы по умолчанию. Включите BITRIX_BULK_ACTIONS_ENABLED и используйте operation plan. |
| `move_deals_between_stages` | Массовый перенос сделок между стадиями | Массовые изменения заблокированы по умолчанию. Включите BITRIX_BULK_ACTIONS_ENABLED и используйте operation plan. |

### Прочие blocked (не реализованы)

| Action | Title | Reason |
|---|---|---|
| `checklist_reorder` | Перестановка чек-листа | Action не реализован. |
| `set_daily_task_recurrence` | Ежедневная повторяемость | Action не реализован. |
| `set_monthly_by_month_days_task_recurrence` | Ежемесячная повторяемость | Action не реализован. |
| `set_monthly_by_week_days_task_recurrence` | Ежемесячная повторяемость | Action не реализован. |
| `set_weekly_task_recurrence` | Еженедельная повторяемость | Action не реализован. |
| `set_yearly_by_month_days_task_recurrence` | Ежегодная повторяемость | Action не реализован. |
| `set_yearly_by_week_days_task_recurrence` | Ежегодная повторяемость | Action не реализован. |

## Preview-supported write (не blocked)

Write / destructive actions с `supportsPreview: true` и без `blocked`:

- `activity_add` (write, protected)
- `activity_complete` (write, rollback_conditional)
- `activity_delete` (destructive, protected)
- `activity_update` (write, rollback_supported)
- `add_accomplices` (write, rollback_conditional)
- `add_auditors` (write, rollback_conditional)
- `add_current_user_as_auditor` (write, rollback_conditional)
- `add_task_reminder` (write, protected)
- `add_task_result` (write, protected)
- `clear_task_deadline` (write, rollback_supported)
- `company_create` (write, rollback_conditional)
- `company_update` (write, rollback_supported)
- `contact_create` (write, rollback_conditional)
- `contact_update` (write, rollback_supported)
- `create_check_list` (write, rollback_conditional)
- `create_check_list_item` (write, rollback_conditional)
- `create_deal` (write, rollback_conditional)
- `create_task` (write, rollback_conditional)
- `deal_delete` (destructive, protected)
- `deal_product_rows_set` (write, protected)
- `deal_update` (write, rollback_supported)
- `delete_accomplices` (write, rollback_conditional)
- `delete_auditors` (write, rollback_conditional)
- `delete_check_list` (destructive, protected)
- `delete_check_list_item` (destructive, protected)
- `delete_task` (destructive, protected)
- `detach_task_from_group` (write, rollback_supported)
- `lead_create` (write, rollback_conditional)
- `lead_delete` (destructive, protected)
- `lead_product_rows_set` (write, protected)
- `lead_update` (write, rollback_supported)
- `send_chat_message` (write, protected)
- `timeline_comment_add` (write, protected)
- `update_check_list` (write, rollback_supported)
- `update_check_list_item` (write, rollback_supported)
- `update_task` (write, rollback_supported)

**Count:** 36

## Оставшиеся риски

- **Destructive без rollback:** `lead_delete`, `deal_delete`, `delete_task`, `activity_delete`, `delete_check_list`, `delete_check_list_item` — preview + confirmation, `reversible: false`.
- **Protected writes без rollback:** product rows set, timeline comments, chat messages, task results/reminders, `activity_add` — изменения трудно/нельзя откатить автоматически.
- **Conditional rollback:** create-entity и участники задач — откат зависит от возможности delete/restore; не гарантирован.
- **Bulk / structural:** заблокированы политикой; bulk можно включить только через `BITRIX_BULK_ACTIONS_ENABLED` + operation plan.
- **Stubs:** recurrence + `checklist_reorder` — blocked как не реализованные; при реализации нужны отдельные политики.
- **Audit trail:** для write+ audit=yes; качество снапшотов/rollback зависит от safety executor.

---

## Полная таблица actions

| Action | Implementation file | access | risk | requiresConfirmation | preview | audit | rollback | direct endpoint protected | status |
|---|---|---|---|---|---|---|---|---|---|
| `activity_add` | timelineActions.js | write | medium | true | true | yes | false | yes | protected |
| `activity_complete` | timelineActions.js | write | medium | true | true | yes | conditional | yes | rollback_conditional |
| `activity_delete` | timelineActions.js | destructive | high | true | true | yes | false | yes | protected |
| `activity_list` | timelineActions.js | read | low | false | false | no | false | yes | read_only |
| `activity_update` | timelineActions.js | write | medium | true | true | yes | true | yes | rollback_supported |
| `add_accomplices` | taskMemberActions.js | write | medium | true | true | yes | conditional | yes | rollback_conditional |
| `add_auditors` | taskMemberActions.js | write | medium | true | true | yes | conditional | yes | rollback_conditional |
| `add_current_user_as_auditor` | taskMemberActions.js | write | medium | true | true | yes | conditional | yes | rollback_conditional |
| `add_task_reminder` | reminderActions.js | write | medium | true | true | yes | false | yes | protected |
| `add_task_result` | taskActions.js | write | medium | true | true | yes | false | yes | protected |
| `checklist_reorder` | checklistActions.js | write | medium | true | true | yes | true | yes | blocked |
| `clear_task_deadline` | taskActions.js | write | medium | true | true | yes | true | yes | rollback_supported |
| `closed_deals_period` | analyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `company_create` | crmActions.js | write | medium | true | true | yes | conditional | yes | rollback_conditional |
| `company_get` | crmActions.js | read | low | false | false | no | false | yes | read_only |
| `company_list` | crmActions.js | read | low | false | false | no | false | yes | read_only |
| `company_update` | crmActions.js | write | medium | true | true | yes | true | yes | rollback_supported |
| `contact_count` | contactAnalyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `contact_count_by_status` | contactAnalyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `contact_create` | crmActions.js | write | medium | true | true | yes | conditional | yes | rollback_conditional |
| `contact_field_audit` | contactAnalyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `contact_get` | crmActions.js | read | low | false | false | no | false | yes | read_only |
| `contact_list` | crmActions.js | read | low | false | false | no | false | yes | read_only |
| `contact_quality_report` | contactAnalyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `contact_update` | crmActions.js | write | medium | true | true | yes | true | yes | rollback_supported |
| `contacts_birthday_activity_report` | contactAnalyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `contacts_cycle_without_next_activity` | contactAnalyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `contacts_missing_birthday` | contactAnalyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `contacts_without_company` | contactAnalyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `contacts_without_status` | contactAnalyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `create_check_list` | checklistActions.js | write | medium | true | true | yes | conditional | yes | rollback_conditional |
| `create_check_list_item` | checklistActions.js | write | medium | true | true | yes | conditional | yes | rollback_conditional |
| `create_crm_custom_field` | crmActions.js | structural | critical | true | false | yes | false | yes | blocked |
| `create_deal` | crmActions.js | write | medium | true | true | yes | conditional | yes | rollback_conditional |
| `create_default_funnel` | crmActions.js | structural | critical | true | false | yes | false | yes | blocked |
| `create_funnel_with_custom_stages` | crmActions.js | structural | critical | true | false | yes | false | yes | blocked |
| `create_new_funnel_stage` | crmActions.js | structural | critical | true | false | yes | false | yes | blocked |
| `create_task` | taskActions.js | write | medium | true | true | yes | conditional | yes | rollback_conditional |
| `crm_discipline_report` | managerAnalyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `crm_duplicate_search` | analyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `crm_funnel_summary` | analyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `deal_bulk_update` | dealActions.js | write | high | true | true | yes | true | yes | blocked |
| `deal_category_list` | crmActions.js | read | low | false | false | no | false | yes | read_only |
| `deal_count` | dealActions.js | read | low | false | false | no | false | yes | read_only |
| `deal_count_by_stage` | analyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `deal_delete` | dealActions.js | destructive | critical | true | true | yes | false | yes | protected |
| `deal_fields` | dealActions.js | read | low | false | false | no | false | yes | read_only |
| `deal_get` | dealActions.js | read | low | false | false | no | false | yes | read_only |
| `deal_list` | dealActions.js | read | low | false | false | no | false | yes | read_only |
| `deal_product_rows_get` | dealActions.js | read | low | false | false | no | false | yes | read_only |
| `deal_product_rows_set` | dealActions.js | write | high | true | true | yes | false | yes | protected |
| `deal_stage_list` | crmActions.js | read | low | false | false | no | false | yes | read_only |
| `deal_sum_by_stage` | analyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `deal_update` | dealActions.js | write | medium | true | true | yes | true | yes | rollback_supported |
| `deals_without_activity` | analyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `deals_without_next_step` | analyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `delete_accomplices` | taskMemberActions.js | write | medium | true | true | yes | conditional | yes | rollback_conditional |
| `delete_auditors` | taskMemberActions.js | write | medium | true | true | yes | conditional | yes | rollback_conditional |
| `delete_check_list` | checklistActions.js | destructive | high | true | true | yes | false | yes | protected |
| `delete_check_list_item` | checklistActions.js | destructive | high | true | true | yes | false | yes | protected |
| `delete_funnel` | crmActions.js | structural | critical | true | false | yes | false | yes | blocked |
| `delete_funnel_stage` | crmActions.js | structural | critical | true | false | yes | false | yes | blocked |
| `delete_task` | taskActions.js | destructive | high | true | true | yes | false | yes | protected |
| `department_list` | userActions.js | read | low | false | false | no | false | yes | read_only |
| `detach_task_from_group` | taskActions.js | write | medium | true | true | yes | true | yes | rollback_supported |
| `get_task_by_id` | taskActions.js | read | low | false | false | no | false | yes | read_only |
| `lead_bulk_update` | leadActions.js | write | high | true | true | yes | true | yes | blocked |
| `lead_conversion_report` | analyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `lead_count` | leadActions.js | read | low | false | false | no | false | yes | read_only |
| `lead_count_by_stage` | analyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `lead_create` | leadActions.js | write | medium | true | true | yes | conditional | yes | rollback_conditional |
| `lead_delete` | leadActions.js | destructive | critical | true | true | yes | false | yes | protected |
| `lead_fields` | leadActions.js | read | low | false | false | no | false | yes | read_only |
| `lead_get` | leadActions.js | read | low | false | false | no | false | yes | read_only |
| `lead_list` | leadActions.js | read | low | false | false | no | false | yes | read_only |
| `lead_product_rows_get` | leadActions.js | read | low | false | false | no | false | yes | read_only |
| `lead_product_rows_set` | leadActions.js | write | high | true | true | yes | false | yes | protected |
| `lead_stage_list` | leadActions.js | read | low | false | false | no | false | yes | read_only |
| `lead_update` | leadActions.js | write | medium | true | true | yes | true | yes | rollback_supported |
| `leads_without_assigned` | analyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `leads_without_next_activity` | managerAnalyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `leads_without_responsible` | analyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `manager_workload` | managerAnalyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `move_deals_between_funnels` | crmActions.js | write | high | true | true | yes | true | yes | blocked |
| `move_deals_between_stages` | crmActions.js | write | high | true | true | yes | true | yes | blocked |
| `new_deals_period` | analyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `overdue_activities_by_manager` | managerAnalyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `overdue_activity_report` | analyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `overdue_tasks_report` | analyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `rename_funnel_stages` | crmActions.js | structural | critical | true | false | yes | false | yes | blocked |
| `rename_funnel_title` | crmActions.js | structural | critical | true | false | yes | false | yes | blocked |
| `sales_forecast` | analyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `search_tasks` | taskActions.js | read | low | false | false | no | false | yes | read_only |
| `search_users` | userActions.js | read | low | false | false | no | false | yes | read_only |
| `send_chat_message` | taskActions.js | write | medium | true | true | yes | false | yes | protected |
| `set_daily_task_recurrence` | reminderActions.js | write | medium | true | true | yes | true | yes | blocked |
| `set_monthly_by_month_days_task_recurrence` | reminderActions.js | write | medium | true | true | yes | true | yes | blocked |
| `set_monthly_by_week_days_task_recurrence` | reminderActions.js | write | medium | true | true | yes | true | yes | blocked |
| `set_weekly_task_recurrence` | reminderActions.js | write | medium | true | true | yes | true | yes | blocked |
| `set_yearly_by_month_days_task_recurrence` | reminderActions.js | write | medium | true | true | yes | true | yes | blocked |
| `set_yearly_by_week_days_task_recurrence` | reminderActions.js | write | medium | true | true | yes | true | yes | blocked |
| `stale_deals_report` | managerAnalyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `stale_leads_report` | managerAnalyticsActions.js | read | low | false | false | no | false | yes | read_only |
| `timeline_comment_add` | timelineActions.js | write | low | true | true | yes | false | yes | protected |
| `timeline_comment_list` | timelineActions.js | read | low | false | false | no | false | yes | read_only |
| `timeline_list` | timelineActions.js | read | low | false | false | no | false | yes | read_only |
| `update_check_list` | checklistActions.js | write | medium | true | true | yes | true | yes | rollback_supported |
| `update_check_list_item` | checklistActions.js | write | medium | true | true | yes | true | yes | rollback_supported |
| `update_funnel_stages` | crmActions.js | structural | critical | true | false | yes | false | yes | blocked |
| `update_task` | taskActions.js | write | medium | true | true | yes | true | yes | rollback_supported |
| `user_get` | userActions.js | read | low | false | false | no | false | yes | read_only |
