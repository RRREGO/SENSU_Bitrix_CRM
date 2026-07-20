# Аудит Bitrix24 Actions

## Сводка

- Всего требований из Excel: 85
- Реализовано точным совпадением: 78
- Реализовано через alias: 1
- Зарегистрировано, но пока не реализовано: 6
- Отсутствует в коде: 0
- Есть в коде, но нет в Excel: 48
- Дубликаты в Excel: 0

## Отсутствующие действия

| Раздел | Требуемое действие | Описание |
| --- | --- | --- |
| — | — | — |

## Зарегистрировано, но пока не реализовано

| Действие | Описание |
| --- | --- |
| set_daily_task_recurrence | Настроить ежедневную регулярность задачи |
| set_weekly_task_recurrence | Настроить еженедельную регулярность задачи |
| set_monthly_by_month_days_task_recurrence | Настроить ежемесячную регулярность по числу месяца |
| set_monthly_by_week_days_task_recurrence | Настроить ежемесячную регулярность по дню недели |
| set_yearly_by_month_days_task_recurrence | Настроить ежегодную регулярность по дате |
| set_yearly_by_week_days_task_recurrence | Настроить ежегодную регулярность по дню недели |

## Реализованные действия

| Требуемое действие | Найденное действие | Тип совпадения | Раздел |
| --- | --- | --- | --- |
| lead_stage_list | lead_stage_list | Точное совпадение | Лиды |
| deal_category_list | deal_category_list | Точное совпадение | Сделки и воронки |
| deal_stage_list | deal_stage_list | Точное совпадение | Сделки и воронки |
| create_deal | create_deal | Точное совпадение | Сделки и воронки |
| create_default_funnel | create_default_funnel | Точное совпадение | Сделки и воронки |
| create_funnel_with_custom_stages | create_funnel_with_custom_stages | Точное совпадение | Сделки и воронки |
| create_new_funnel_stage | create_new_funnel_stage | Точное совпадение | Сделки и воронки |
| rename_funnel_title | rename_funnel_title | Точное совпадение | Сделки и воронки |
| rename_funnel_stages | rename_funnel_stages | Точное совпадение | Сделки и воронки |
| update_funnel_stages | update_funnel_stages | Точное совпадение | Сделки и воронки |
| delete_funnel | delete_funnel | Точное совпадение | Сделки и воронки |
| delete_funnel_stage | delete_funnel_stage | Точное совпадение | Сделки и воронки |
| move_deals_between_funnels | move_deals_between_funnels | Точное совпадение | Сделки и воронки |
| move_deals_between_stages | move_deals_between_stages | Точное совпадение | Сделки и воронки |
| create_crm_custom_field | create_crm_custom_field | Точное совпадение | Сделки и воронки |
| create_task | create_task | Точное совпадение | Задачи |
| search_tasks | search_tasks | Точное совпадение | Задачи |
| get_task_by_id | get_task_by_id | Точное совпадение | Задачи |
| update_task | update_task | Точное совпадение | Задачи |
| delete_task | delete_task | Точное совпадение | Задачи |
| clear_task_deadline | clear_task_deadline | Точное совпадение | Задачи |
| detach_task_from_group | detach_task_from_group | Точное совпадение | Задачи |
| add_task_result | add_task_result | Точное совпадение | Задачи |
| send_chat_message | send_chat_message | Точное совпадение | Задачи |
| search_users | search_users | Точное совпадение | Участники задач |
| add_accomplices | add_accomplices | Точное совпадение | Участники задач |
| delete_accomplices | delete_accomplices | Точное совпадение | Участники задач |
| add_auditors | add_auditors | Точное совпадение | Участники задач |
| add_current_user_as_auditor | add_current_user_as_auditor | Точное совпадение | Участники задач |
| delete_auditors | delete_auditors | Точное совпадение | Участники задач |
| create_check_list | create_check_list | Точное совпадение | Чек-листы |
| create_check_list_item | create_check_list_item | Точное совпадение | Чек-листы |
| update_check_list | update_check_list | Точное совпадение | Чек-листы |
| update_check_list_item | update_check_list_item | Точное совпадение | Чек-листы |
| delete_check_list | delete_check_list | Точное совпадение | Чек-листы |
| delete_check_list_item | delete_check_list_item | Точное совпадение | Чек-листы |
| add_task_reminder | add_task_reminder | Точное совпадение | Напоминания и регулярность |
| crm.lead.list / lead_list | lead_list | Точное совпадение | Лиды |
| crm.lead.get / lead_get | lead_get | Точное совпадение | Лиды |
| lead_count | lead_count | Точное совпадение | Лиды |
| crm.lead.update / lead_update | lead_update | Точное совпадение | Лиды |
| crm.lead.add / lead_create | lead_create | Точное совпадение | Лиды |
| crm.lead.delete / lead_delete | lead_delete | Точное совпадение | Лиды |
| crm.lead.fields / lead_fields | lead_fields | Точное совпадение | Лиды |
| lead_product_rows_get | lead_product_rows_get | Точное совпадение | Лиды |
| lead_product_rows_set | lead_product_rows_set | Точное совпадение | Лиды |
| crm.deal.list / deal_list | deal_list | Точное совпадение | Сделки |
| crm.deal.get / deal_get | deal_get | Точное совпадение | Сделки |
| deal_count | deal_count | Точное совпадение | Сделки |
| crm.deal.update / deal_update | deal_update | Точное совпадение | Сделки |
| crm.deal.delete / deal_delete | deal_delete | Точное совпадение | Сделки |
| crm.deal.fields / deal_fields | deal_fields | Точное совпадение | Сделки |
| deal_product_rows_get | deal_product_rows_get | Точное совпадение | Сделки |
| deal_product_rows_set | deal_product_rows_set | Точное совпадение | Сделки |
| crm.contact.list / contact_list | contact_list | Точное совпадение | Контакты и компании |
| crm.contact.get / contact_get | contact_get | Точное совпадение | Контакты и компании |
| crm.contact.add / contact_create | contact_create | Точное совпадение | Контакты и компании |
| crm.contact.update / contact_update | contact_update | Точное совпадение | Контакты и компании |
| crm.company.list / company_list | company_list | Точное совпадение | Контакты и компании |
| crm.company.get / company_get | company_get | Точное совпадение | Контакты и компании |
| crm.company.add / company_create | company_create | Точное совпадение | Контакты и компании |
| crm.company.update / company_update | company_update | Точное совпадение | Контакты и компании |
| crm.timeline.comment.add / timeline_comment_add | timeline_comment_add | Точное совпадение | Комментарии, история и дела |
| timeline_comment_list | timeline_comment_list | Точное совпадение | Комментарии, история и дела |
| timeline_list | timeline_list | Точное совпадение | Комментарии, история и дела |
| crm.activity.list / activity_list | activity_list | Точное совпадение | Комментарии, история и дела |
| crm.activity.add / activity_add | activity_add | Точное совпадение | Комментарии, история и дела |
| crm.activity.update / activity_update | activity_update | Точное совпадение | Комментарии, история и дела |
| crm.activity.delete / activity_delete | activity_delete | Точное совпадение | Комментарии, история и дела |
| activity_complete | activity_complete | Точное совпадение | Комментарии, история и дела |
| user.search / crm_user_list | search_users | Через alias | Пользователи |
| user_get | user_get | Точное совпадение | Пользователи |
| department_list | department_list | Точное совпадение | Пользователи |
| lead_count_by_stage | lead_count_by_stage | Точное совпадение | Аналитика |
| deal_count_by_stage | deal_count_by_stage | Точное совпадение | Аналитика |
| deal_sum_by_stage | deal_sum_by_stage | Точное совпадение | Аналитика |
| lead_conversion_report | lead_conversion_report | Точное совпадение | Аналитика |
| crm_funnel_summary | crm_funnel_summary | Точное совпадение | Аналитика |
| overdue_activity_report | overdue_activity_report | Точное совпадение | Аналитика |

## Есть в коде, но нет в Excel

| Действие | Описание |
| --- | --- |
| lead_bulk_update | Массовое обновление лидов |
| crm_duplicate_search | Поиск дубликатов CRM |
| deal_bulk_update | Массовое обновление сделок |
| checklist_reorder | Изменить порядок чек-листа |
| overdue_tasks_report | Просроченные задачи |
| deals_without_next_step | Сделки без следующего шага |
| leads_without_responsible | Лиды без ответственного |
| leads_without_assigned | Лиды без ответственного |
| deals_without_activity | Сделки без активности |
| new_deals_period | Новые сделки за период |
| closed_deals_period | Закрытые сделки за период |
| manager_workload | Нагрузка и качество ведения CRM по менеджерам |
| sales_forecast | Прогноз продаж |
| contact_field_audit | Аудит полей контакта (стандартные и UF) |
| contact_count | Количество контактов |
| contact_count_by_status | Контакты по статусам |
| contacts_without_status | Контакты без статуса |
| contacts_without_company | Контакты без компании |
| contacts_missing_birthday | Контакты без даты рождения |
| contacts_cycle_without_next_activity | Контакты в «Цикле» без следующего CRM-дела |
| contacts_birthday_activity_report | Контроль поздравлений с днём рождения |
| contact_quality_report | Сводный отчёт качества контактов |
| leads_without_next_activity | Лиды без следующего CRM-дела |
| stale_leads_report | Лиды без изменений более N дней |
| stale_deals_report | Сделки без изменений более N дней |
| overdue_activities_by_manager | Просроченные CRM-дела по менеджерам |
| crm_discipline_report | Сводный отчёт дисциплины ведения CRM |
| crm_context_get | Нормализованный CRM-контекст клиента |
| crm_context_summary | Управленческая сводка по клиенту |
| meeting_protocol_generate | Сформировать протокол встречи по транскрипту |
| client_message_draft | Черновик сообщения клиенту (без отправки) |
| client_message_send | Отправка одиночного сообщения клиенту (Safety, irreversible) |
| recommend_next_client_action | Рекомендации следующего шага по клиенту |
| communication_channels_list | Список каналов Wazzup/Hub (без секретов) |
| communication_thread_get | Диалог Communications Hub |
| communication_contact_context | Контекст переписки контакта для LLM |
| communication_message_draft | Черновик Hub-сообщения (без отправки) |
| communication_message_send_prepare | Prepare отправки через Hub/Safety (не шлёт само) |
| communication_campaign_preview | Preview кампании без отправки |
| communication_campaign_start_prepare | Prepare запуска кампании (фраза ПОДТВЕРЖДАЮ РАССЫЛКУ N) |
| communication_campaign_pause_prepare | Prepare паузы кампании |
| communication_campaign_cancel_prepare | Prepare отмены кампании |
| communication_sequence_list | Список цепочек касаний |
| communication_sequence_activate_prepare | Prepare активации цепочки |
| communication_sequence_enroll_prepare | Prepare подключения контакта к цепочке |
| communication_enrollment_stop_prepare | Prepare остановки enrollment |
| communication_delivery_report | Отчёт доставки (без выдуманных read) |
| communication_unanswered_report | Неотвеченные диалоги |

## Дубликаты в Excel

| Действие | Количество повторов |
| --- | --- |
| — | — |

## Детальная таблица

| Раздел | Требуемое действие | Найденное действие | Статус | Описание | Строка Excel |
| --- | --- | --- | --- | --- | --- |
| Лиды | lead_stage_list | lead_stage_list | Реализовано точным совпадением | Получить стадии лидов и ID стадии по названию | Что уже есть#2 |
| Сделки и воронки | deal_category_list | deal_category_list | Реализовано точным совпадением | Получить список воронок сделок или найти воронку по названию | Что уже есть#3 |
| Сделки и воронки | deal_stage_list | deal_stage_list | Реализовано точным совпадением | Получить список стадий сделок в конкретной воронке | Что уже есть#4 |
| Сделки и воронки | create_deal | create_deal | Реализовано точным совпадением | Создать новую сделку в выбранной воронке | Что уже есть#5 |
| Сделки и воронки | create_default_funnel | create_default_funnel | Реализовано точным совпадением | Создать новую воронку со стандартными стадиями | Что уже есть#6 |
| Сделки и воронки | create_funnel_with_custom_stages | create_funnel_with_custom_stages | Реализовано точным совпадением | Создать новую воронку с кастомными рабочими стадиями | Что уже есть#7 |
| Сделки и воронки | create_new_funnel_stage | create_new_funnel_stage | Реализовано точным совпадением | Добавить новую стадию в CRM-воронку | Что уже есть#8 |
| Сделки и воронки | rename_funnel_title | rename_funnel_title | Реализовано точным совпадением | Переименовать воронку | Что уже есть#9 |
| Сделки и воронки | rename_funnel_stages | rename_funnel_stages | Реализовано точным совпадением | Переименовать одну или несколько стадий | Что уже есть#10 |
| Сделки и воронки | update_funnel_stages | update_funnel_stages | Реализовано точным совпадением | Обновить рабочие стадии воронки, названия, цвета и порядок | Что уже есть#11 |
| Сделки и воронки | delete_funnel | delete_funnel | Реализовано точным совпадением | Удалить воронку | Что уже есть#12 |
| Сделки и воронки | delete_funnel_stage | delete_funnel_stage | Реализовано точным совпадением | Удалить стадию воронки | Что уже есть#13 |
| Сделки и воронки | move_deals_between_funnels | move_deals_between_funnels | Реализовано точным совпадением | Перенести сделки из одной воронки в другую | Что уже есть#14 |
| Сделки и воронки | move_deals_between_stages | move_deals_between_stages | Реализовано точным совпадением | Перенести сделки между стадиями внутри одной воронки | Что уже есть#15 |
| Сделки и воронки | create_crm_custom_field | create_crm_custom_field | Реализовано точным совпадением | Создать пользовательское поле для сделки | Что уже есть#16 |
| Задачи | create_task | create_task | Реализовано точным совпадением | Создать задачу | Что уже есть#17 |
| Задачи | search_tasks | search_tasks | Реализовано точным совпадением | Найти задачи по названию, описанию, срокам, статусу и участникам | Что уже есть#18 |
| Задачи | get_task_by_id | get_task_by_id | Реализовано точным совпадением | Получить полную карточку задачи по ID | Что уже есть#19 |
| Задачи | update_task | update_task | Реализовано точным совпадением | Изменить задачу: название, описание, срок, ответственного, статус, проект | Что уже есть#20 |
| Задачи | delete_task | delete_task | Реализовано точным совпадением | Удалить задачу | Что уже есть#21 |
| Задачи | clear_task_deadline | clear_task_deadline | Реализовано точным совпадением | Снять дедлайн с задачи | Что уже есть#22 |
| Задачи | detach_task_from_group | detach_task_from_group | Реализовано точным совпадением | Отвязать задачу от проекта или группы | Что уже есть#23 |
| Задачи | add_task_result | add_task_result | Реализовано точным совпадением | Добавить официальный результат работы в задачу | Что уже есть#24 |
| Задачи | send_chat_message | send_chat_message | Реализовано точным совпадением | Написать комментарий в чат задачи | Что уже есть#25 |
| Участники задач | search_users | search_users | Реализовано точным совпадением | Найти пользователя и получить его ID | Что уже есть#26 |
| Участники задач | add_accomplices | add_accomplices | Реализовано точным совпадением | Добавить соисполнителей в задачу | Что уже есть#27 |
| Участники задач | delete_accomplices | delete_accomplices | Реализовано точным совпадением | Удалить соисполнителей из задачи | Что уже есть#28 |
| Участники задач | add_auditors | add_auditors | Реализовано точным совпадением | Добавить наблюдателей в задачу | Что уже есть#29 |
| Участники задач | add_current_user_as_auditor | add_current_user_as_auditor | Реализовано точным совпадением | Добавить текущего пользователя наблюдателем | Что уже есть#30 |
| Участники задач | delete_auditors | delete_auditors | Реализовано точным совпадением | Удалить наблюдателей из задачи | Что уже есть#31 |
| Чек-листы | create_check_list | create_check_list | Реализовано точным совпадением | Создать чек-лист в задаче | Что уже есть#32 |
| Чек-листы | create_check_list_item | create_check_list_item | Реализовано точным совпадением | Добавить пункт чек-листа | Что уже есть#33 |
| Чек-листы | update_check_list | update_check_list | Реализовано точным совпадением | Изменить название или порядок чек-листа | Что уже есть#34 |
| Чек-листы | update_check_list_item | update_check_list_item | Реализовано точным совпадением | Изменить название или порядок пункта чек-листа | Что уже есть#35 |
| Чек-листы | delete_check_list | delete_check_list | Реализовано точным совпадением | Удалить чек-лист | Что уже есть#36 |
| Чек-листы | delete_check_list_item | delete_check_list_item | Реализовано точным совпадением | Удалить пункт чек-листа | Что уже есть#37 |
| Напоминания и регулярность | add_task_reminder | add_task_reminder | Реализовано точным совпадением | Поставить напоминание по задаче | Что уже есть#38 |
| Напоминания и регулярность | set_daily_task_recurrence | set_daily_task_recurrence | Зарегистрировано, но пока не реализовано | Настроить ежедневную регулярность задачи | Что уже есть#39 |
| Напоминания и регулярность | set_weekly_task_recurrence | set_weekly_task_recurrence | Зарегистрировано, но пока не реализовано | Настроить еженедельную регулярность задачи | Что уже есть#40 |
| Напоминания и регулярность | set_monthly_by_month_days_task_recurrence | set_monthly_by_month_days_task_recurrence | Зарегистрировано, но пока не реализовано | Настроить ежемесячную регулярность по числу месяца | Что уже есть#41 |
| Напоминания и регулярность | set_monthly_by_week_days_task_recurrence | set_monthly_by_week_days_task_recurrence | Зарегистрировано, но пока не реализовано | Настроить ежемесячную регулярность по дню недели | Что уже есть#42 |
| Напоминания и регулярность | set_yearly_by_month_days_task_recurrence | set_yearly_by_month_days_task_recurrence | Зарегистрировано, но пока не реализовано | Настроить ежегодную регулярность по дате | Что уже есть#43 |
| Напоминания и регулярность | set_yearly_by_week_days_task_recurrence | set_yearly_by_week_days_task_recurrence | Зарегистрировано, но пока не реализовано | Настроить ежегодную регулярность по дню недели | Что уже есть#44 |
| Лиды | crm.lead.list / lead_list | lead_list | Реализовано точным совпадением | Получать список лидов с фильтрами по стадии, ответственному, дате, источнику | Что нужно добавить#2 |
| Лиды | crm.lead.get / lead_get | lead_get | Реализовано точным совпадением | Открывать карточку конкретного лида по ID | Что нужно добавить#3 |
| Лиды | lead_count | lead_count | Реализовано точным совпадением | Быстро считать лиды всего и по фильтрам | Что нужно добавить#4 |
| Лиды | crm.lead.update / lead_update | lead_update | Реализовано точным совпадением | Редактировать поля лида, стадию, ответственного, контакты | Что нужно добавить#5 |
| Лиды | crm.lead.add / lead_create | lead_create | Реализовано точным совпадением | Создавать новый лид | Что нужно добавить#6 |
| Лиды | crm.lead.delete / lead_delete | lead_delete | Реализовано точным совпадением | Удалять лид | Что нужно добавить#7 |
| Лиды | crm.lead.fields / lead_fields | lead_fields | Реализовано точным совпадением | Получать список доступных полей лида, включая пользовательские | Что нужно добавить#8 |
| Лиды | lead_product_rows_get | lead_product_rows_get | Реализовано точным совпадением | Смотреть товары/услуги в лиде | Что нужно добавить#9 |
| Лиды | lead_product_rows_set | lead_product_rows_set | Реализовано точным совпадением | Обновлять товары/услуги в лиде | Что нужно добавить#10 |
| Сделки | crm.deal.list / deal_list | deal_list | Реализовано точным совпадением | Получать список сделок с фильтрами по воронке, стадии, ответственному, дате | Что нужно добавить#11 |
| Сделки | crm.deal.get / deal_get | deal_get | Реализовано точным совпадением | Открывать карточку конкретной сделки | Что нужно добавить#12 |
| Сделки | deal_count | deal_count | Реализовано точным совпадением | Считать сделки по воронкам, стадиям и ответственным | Что нужно добавить#13 |
| Сделки | crm.deal.update / deal_update | deal_update | Реализовано точным совпадением | Редактировать поля сделки, сумму, стадию, ответственного | Что нужно добавить#14 |
| Сделки | crm.deal.delete / deal_delete | deal_delete | Реализовано точным совпадением | Удалять сделку | Что нужно добавить#15 |
| Сделки | crm.deal.fields / deal_fields | deal_fields | Реализовано точным совпадением | Получать список стандартных и пользовательских полей сделки | Что нужно добавить#16 |
| Сделки | deal_product_rows_get | deal_product_rows_get | Реализовано точным совпадением | Смотреть товары/услуги в сделке | Что нужно добавить#17 |
| Сделки | deal_product_rows_set | deal_product_rows_set | Реализовано точным совпадением | Обновлять товары/услуги в сделке | Что нужно добавить#18 |
| Контакты и компании | crm.contact.list / contact_list | contact_list | Реализовано точным совпадением | Искать контакты по имени, телефону, email | Что нужно добавить#19 |
| Контакты и компании | crm.contact.get / contact_get | contact_get | Реализовано точным совпадением | Открывать карточку контакта | Что нужно добавить#20 |
| Контакты и компании | crm.contact.add / contact_create | contact_create | Реализовано точным совпадением | Создавать контакт | Что нужно добавить#21 |
| Контакты и компании | crm.contact.update / contact_update | contact_update | Реализовано точным совпадением | Редактировать контакт | Что нужно добавить#22 |
| Контакты и компании | crm.company.list / company_list | company_list | Реализовано точным совпадением | Искать компании | Что нужно добавить#23 |
| Контакты и компании | crm.company.get / company_get | company_get | Реализовано точным совпадением | Открывать карточку компании | Что нужно добавить#24 |
| Контакты и компании | crm.company.add / company_create | company_create | Реализовано точным совпадением | Создавать компанию | Что нужно добавить#25 |
| Контакты и компании | crm.company.update / company_update | company_update | Реализовано точным совпадением | Редактировать компанию | Что нужно добавить#26 |
| Комментарии, история и дела | crm.timeline.comment.add / timeline_comment_add | timeline_comment_add | Реализовано точным совпадением | Добавлять комментарий в лид, сделку, контакт или компанию | Что нужно добавить#27 |
| Комментарии, история и дела | timeline_comment_list | timeline_comment_list | Реализовано точным совпадением | Получать комментарии по объекту CRM | Что нужно добавить#28 |
| Комментарии, история и дела | timeline_list | timeline_list | Реализовано точным совпадением | Получать историю активности по объекту CRM | Что нужно добавить#29 |
| Комментарии, история и дела | crm.activity.list / activity_list | activity_list | Реализовано точным совпадением | Получать звонки, письма, встречи и дела | Что нужно добавить#30 |
| Комментарии, история и дела | crm.activity.add / activity_add | activity_add | Реализовано точным совпадением | Создавать дело, звонок, встречу или письмо | Что нужно добавить#31 |
| Комментарии, история и дела | crm.activity.update / activity_update | activity_update | Реализовано точным совпадением | Обновлять дело | Что нужно добавить#32 |
| Комментарии, история и дела | crm.activity.delete / activity_delete | activity_delete | Реализовано точным совпадением | Удалять дело | Что нужно добавить#33 |
| Комментарии, история и дела | activity_complete | activity_complete | Реализовано точным совпадением | Закрывать дело как выполненное | Что нужно добавить#34 |
| Пользователи | user.search / crm_user_list | search_users | Реализовано через alias | Находить пользователей Bitrix24 для назначения ответственных | Что нужно добавить#35 |
| Пользователи | user_get | user_get | Реализовано точным совпадением | Получать данные пользователя по ID | Что нужно добавить#36 |
| Пользователи | department_list | department_list | Реализовано точным совпадением | Смотреть структуру отделов | Что нужно добавить#37 |
| Аналитика | lead_count_by_stage | lead_count_by_stage | Реализовано точным совпадением | Вернуть таблицу лидов по стадиям | Что нужно добавить#38 |
| Аналитика | deal_count_by_stage | deal_count_by_stage | Реализовано точным совпадением | Вернуть таблицу сделок по стадиям | Что нужно добавить#39 |
| Аналитика | deal_sum_by_stage | deal_sum_by_stage | Реализовано точным совпадением | Посчитать сумму сделок по стадиям | Что нужно добавить#40 |
| Аналитика | lead_conversion_report | lead_conversion_report | Реализовано точным совпадением | Посчитать конверсию лидов по стадиям и периодам | Что нужно добавить#41 |
| Аналитика | crm_funnel_summary | crm_funnel_summary | Реализовано точным совпадением | Вернуть сводку по воронке: количество, сумма, просрочки, последние изменения | Что нужно добавить#42 |
| Аналитика | overdue_activity_report | overdue_activity_report | Реализовано точным совпадением | Найти лиды/сделки без следующего шага или с просроченными делами | Что нужно добавить#43 |
