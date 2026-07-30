# Возможности системы

Детальный справочник по тому, что **Bitrix24 CRM Assistant** умеет делать: какие запросы обрабатывает, что может создавать и изменять в Bitrix24, что заблокировано и почему.

Документ описывает фактическое состояние кода, а не планы. Для архитектурных деталей см. [action-safety.md](./action-safety.md), [app-overview.md](./app-overview.md).

---

## 1. Что это за система

Локальный Node.js-сервис (Express, порт `3005` по умолчанию), который связывает три вещи:

| Компонент | Роль |
|-----------|------|
| **Bitrix24 REST** | Источник данных и объект изменений. Авторизация через входящий вебхук (`BITRIX_WEBHOOK_URL`) |
| **Claude (Anthropic Messages API)** | Понимает запрос на естественном языке, выбирает и вызывает действия. Модель `CLAUDE_MODEL`, по умолчанию `claude-sonnet-4-5` |
| **Локальная SQLite** | Проекты, чаты, журнал операций, расписания, коммуникации, реестр схемы CRM |

Главный принцип: **чтение свободно, запись только через Safety Layer** (prepare → предпросмотр → подтверждение → commit). Ассистент физически не может изменить что-либо в Bitrix24 без явного подтверждения человека.

---

## 2. Краткий ответ: что можно создавать

Да, система создаёт сущности в Bitrix24 — но всегда через подтверждение.

| Что | Действие | Создаётся | Откат |
|-----|----------|-----------|-------|
| **Лид** | `lead_create` | Да | Условный (удаление, если лид не менялся) |
| **Сделка** | `create_deal` | Да | Условный |
| **Контакт** | `contact_create` | Да | Условный |
| **Компания** | `company_create` | Да | Условный |
| **Задача** | `create_task` | Да | Условный |
| **Дело CRM** (звонок, встреча) | `activity_add` | Да | Нет |
| **Комментарий в таймлайн** | `timeline_comment_add` | Да | Нет |
| **Чек-лист и пункты** | `create_check_list`, `create_check_list_item` | Да | Условный |
| **Напоминание по задаче** | `add_task_reminder` | Да | Нет |
| **Результат работы в задаче** | `add_task_result` | Да | Нет |
| **Сообщение в чат задачи** | `send_chat_message` | Да | Нет |
| **Воронка / стадия / пользовательское поле** | — | **Нет, заблокировано** | — |

Изменение существующих записей (`lead_update`, `deal_update`, `contact_update`, `company_update`, `update_task`, `activity_update`) поддерживается **с полным откатом** — система сохраняет состояние «до» и умеет его вернуть.

Удаление (`lead_delete`, `deal_delete`, `delete_task`, `activity_delete`, `delete_check_list`, `delete_check_list_item`) возможно, но **необратимо** и требует отдельного подтверждения.

---

## 3. Как обрабатывается запрос

### 3.1 Путь сообщения

Пользователь пишет в чат → `POST /chat`:

1. **Middleware**: request context → security headers → access gate (IP-фильтр в режиме `local_only`) → сессия/аутентификация → проверка режима обслуживания → CSRF.
2. **Резолв чата**: находится или создаётся запись в SQLite; автозаголовок из первых слов сообщения.
3. **Сборка контекста** (`buildConversationContext`): системный промпт + история.
4. **Цикл tool use с Claude**: до **8 итераций** на один запрос.
5. **Ответ**: `{ chatId, answer, toolCalls, resultCards, pendingConfirmation? }`.

Стриминга ответа нет — используется обычный запрос/ответ.

### 3.2 Как LLM вызывает действия

Используется **нативный tool calling** Anthropic, а не парсинг JSON из текста. Инструмент один:

```
run_bitrix_action({ action: string, params: object })
```

Цикл выглядит так:

```
пока итераций < 8:
    ответ = Claude(сообщения, tools=[run_bitrix_action])
    если нет tool_use  → это финальный текст, возвращаем
    для каждого tool_use:
        action == "__discover_actions"  → расширяем каталог, отдаём список
        action неизвестен / заблокирован → tool_result с ошибкой
        action требует подтверждения    → prepareAction(), цикл останавливается,
                                          пользователю уходит pendingConfirmation
        иначе                           → выполняем, tool_result с данными
    добавляем tool_result в диалог, продолжаем
```

Если за 8 итераций финального текста не получилось, пользователь видит сообщение о том, что запрос требует слишком много шагов.

Результат каждого действия перед отправкой в LLM проходит `sanitizeLlmPayload()` — по allowlist полей, с вырезанием секретов.

### 3.3 Отбор действий (catalog selector)

Полный каталог — **133 действия**. Целиком в промпт он не отправляется. `selectRelevantActions(userMessage)` отбирает подмножество:

| Шаг | Логика |
|-----|--------|
| Всегда включаются | `deal_category_list`, `deal_stage_list`, `lead_stage_list`, `search_users`, `contact_field_audit` |
| Определение категории | Регексы по сообщению: `contacts`, `leads`, `deals`, `companies`, `tasks`, `activities`, `analytics`, `reports`, `documents`, `users`, `timeline`, `stagehistory`, `structure` |
| Определение интента | `write` (создай/измени/удали), `analytics` (сколько/отчёт/статистика), иначе `read` |
| Скоринг | категория +5, интент +3…4, совпадение слов с именем действия +2, со описанием +1 |
| Отбор | по убыванию скора, до ~28 действий или до лимита `ACTION_CATALOG_MAX_CHARS` (20000) |

Если нужного действия в подмножестве нет, Claude вызывает служебное `__discover_actions` с поисковым запросом и получает до 20 дополнительных вариантов. Это позволяет держать промпт компактным без потери доступа к полному каталогу.

### 3.4 Что попадает в системный промпт

| Блок | Содержимое |
|------|------------|
| Базовые правила | Роль CRM-ассистента, правила работы с инструментами, русский язык, без эмодзи |
| Каталог действий | Отобранное подмножество в компактном формате с пометками `[read]` / `[write, confirm]` |
| Блок Safety | Приоритет Safety Layer абсолютен; обход подтверждений запрещён; секреты не раскрываются |
| Профиль | Роль ассистента, контекст пользователя и компании, **методология CRM**, правила ответов |
| Инструкция проекта | Текст из активного проекта (перекрывает профиль) |
| Файлы проекта | Фрагменты `.md`/`.txt`, отобранные по ключевым словам |
| Сводка диалога | Автосуммаризация более ранней части чата (генерируется Claude) |
| Привязка к CRM | `Чат привязан к CRM: {тип} #{id}` |
| Контекст клиента | Компактный JSON из `crm_context_get` — загружается только если сообщение соответствует интент-регексу |

Бюджеты: `SYSTEM_PROMPT_MAX_CHARS` (60000), `ACTION_CATALOG_MAX_CHARS` (20000), `CHAT_CONTEXT_MAX_CHARS` (120000). При переполнении обрезка идёт в порядке: файлы проекта → сводка → инструкция проекта → контекст CRM.

История диалога ограничена **20 последними сообщениями** с сохранением целостности пар tool_use/tool_result.

---

## 4. Safety Layer: как работает запись

Любая запись в Bitrix24 проходит через `executeAction()` в `src/safety/executor.js`. Обойти этот слой нельзя технически: клиент `bitrixClient.js` разделяет `callReadMethod` и `callWriteMethod`, и второй требует активного контекста исполнения (AsyncLocalStorage с одноразовым `executionToken`, сгенерированным сервером). Попытка записи вне контекста → ошибка `WRITE_CALL_OUTSIDE_SAFETY_EXECUTOR`. Токен, присланный клиентом, игнорируется.

### 4.1 Жизненный цикл

| Стадия | Что происходит | Изменяется Bitrix? |
|--------|----------------|--------------------|
| **Prepare** | Читается текущее состояние, строится предпросмотр и план `__execPlan`, считается `planHash` (SHA-256), операция пишется в SQLite | Нет |
| **Preview** | Предпросмотр «было → станет» возвращается пользователю | Нет |
| **Confirm** | Пользователь подтверждает; для части действий нужна вводимая фраза | Нет |
| **Commit** | План загружается по `confirmationId`, валидируется, выполняется | **Да** |
| **Audit** | Запись в `operation_events`, журнал действий, редактирование секретов | — |
| **Rollback** | Отдельный цикл prepare → confirm → commit с обратным планом | Да |

### 4.2 Проверки на commit (порядок важен)

1. Kill switches (`assertWritesAllowed`).
2. Операция существует; проверка прав (`operations.confirm.own` / `operations.confirm.any`).
3. Идемпотентность — если уже `completed`, повторный commit не дублирует запись.
4. Статус и срок `expires_at`.
5. **Совпадение фразы подтверждения** (сравнение по trim + uppercase).
6. **Совпадение `planHash`** — защита от подмены плана между prepare и commit.
7. Атомарный переход `pending_confirmation` → `executing`.
8. **Оптимистичная блокировка**: состояние в Bitrix перечитывается и сравнивается с зафиксированным на prepare. Если данные изменились — `OPERATION_STATE_CHANGED`, запись не выполняется.
9. Выполнение плана внутри `runWithSafetyContext`.
10. **Пост-верификация** — чтение результата обратно; при расхождении `verificationRequired: true`.

### 4.3 Сроки и статусы

| Параметр | Env | По умолчанию |
|----------|-----|--------------|
| Срок жизни подтверждения | `BITRIX_CONFIRMATION_TTL_MINUTES` | **15 минут** |
| Окно отката (подсказка в UI) | `BITRIX_ROLLBACK_TTL_HOURS` | 24 часа |

Статусы операции: `pending_confirmation` → `executing` → `completed` | `partially_completed` | `failed` | `verification_required` | `cancelled` | `expired` | `recovery_required` | `rolled_back` | `rollback_conflict`.

При перезапуске сервера `recoverOperationsOnStartup()` помечает просроченные подтверждения как `expired`, а прерванные `executing` — как `recovery_required`. **Автоматического повтора нет** — это осознанное решение, чтобы не продублировать запись, результат которой неизвестен.

### 4.4 Классификация действий

Каждое действие в `ACTION_POLICIES` имеет набор атрибутов:

| Атрибут | Значения |
|---------|----------|
| `access` | `read` \| `write` \| `destructive` \| `structural` |
| `risk` | `low` \| `medium` \| `high` \| `critical` |
| `requiresConfirmation` | да/нет |
| `reversible` | `true` \| `false` \| `"conditional"` |
| `auditStatus` | `read_only` \| `rollback_supported` \| `rollback_conditional` \| `protected` \| `blocked` |

Действие без описанной политики выполнить нельзя: `ACTION_BLOCKED_BY_SAFETY_POLICY`. То есть безопасность работает по принципу «запрещено всё, что не разрешено явно».

### 4.5 Фразы подтверждения

Для операций повышенного риска недостаточно нажать кнопку — нужно ввести точную фразу. Клиент не может подставить её на этапе prepare (поле вырезается).

| Ситуация | Точная фраза |
|----------|--------------|
| Массовое изменение (если включено) | `ПОДТВЕРЖДАЮ ИЗМЕНЕНИЕ {N} СДЕЛОК` |
| Отправка сообщения клиенту | `ОТПРАВИТЬ СООБЩЕНИЕ {ИМЯ}` |
| Запуск кампании | `ПОДТВЕРЖДАЮ РАССЫЛКУ {N} ПОЛУЧАТЕЛЯМ` |
| Аварийная остановка коммуникаций | `ПОДТВЕРЖДАЮ АВАРИЙНУЮ ОСТАНОВКУ КОММУНИКАЦИЙ` |
| Снятие аварийной остановки | `ПОДТВЕРЖДАЮ СНЯТИЕ АВАРИЙНОЙ ОСТАНОВКИ` |

Обычные CRM-записи (`deal_update`, `create_task` и т.п.) фразы не требуют — достаточно подтверждения в интерфейсе.

Дополнительно можно включить **разделение инициатора и подтверждающего**: при `AUTH_REQUIRE_SEPARATE_APPROVER_FOR_CRITICAL=true` операции с `risk: critical` не может подтвердить тот, кто их подготовил — нужен `director` или `administrator`. Аналогично `AUTH_REQUIRE_SEPARATE_APPROVER_FOR_EXTERNAL_MESSAGES` для внешних сообщений.

### 4.6 Откат

| Тип исходной операции | Механизм отката |
|-----------------------|-----------------|
| Обновление сущности / задачи | Повторное применение сохранённых полей «до» |
| Создание сущности / задачи | Удаление созданного объекта — **только если он не менялся** после создания |
| Операции с участниками задач | Восстановление полей, если не было правок после |

Откат сам проходит полный цикл prepare → confirm → commit и требует права `operations.rollback` (по умолчанию только `administrator` и `director`).

Если состояние в Bitrix уже отличается от зафиксированного «после» — откат отклоняется с `ROLLBACK_CONFLICT`, чтобы не затереть чужие правки.

**Откатить нельзя**: все удаления, товарные позиции, комментарии таймлайна, дела CRM, сообщения в чат задачи, любые отправленные сообщения клиентам.

### 4.7 Что заблокировано полностью

Эти действия зарегистрированы, но выполняться не будут — они меняют структуру портала или затрагивают много записей сразу.

**Структурные (`risk: critical`, `blocked: true`)**: `create_default_funnel`, `create_funnel_with_custom_stages`, `create_new_funnel_stage`, `rename_funnel_title`, `rename_funnel_stages`, `update_funnel_stages`, `delete_funnel`, `delete_funnel_stage`, `create_crm_custom_field`.

**Массовые**: `move_deals_between_funnels`, `move_deals_between_stages`, `lead_bulk_update`, `deal_bulk_update` — разблокируются только через `BITRIX_BULK_ACTIONS_ENABLED=true` с лимитами `BITRIX_BULK_MAX_ITEMS` (20) и обязательной фразой подтверждения.

**Не реализованы** (11 действий в каталоге помечены `implemented: false`): `crm_duplicate_search`, `sales_forecast`, `checklist_reorder`, `lead_bulk_update`, `deal_bulk_update` и все шесть `set_*_task_recurrence` (регулярные задачи).

---

## 5. Полный каталог действий

133 действия. Обозначения: **R** — чтение без подтверждения, **W** — запись через подтверждение, **D** — необратимое удаление, **B** — заблокировано, **—** — не реализовано.

### 5.1 Лиды

| Действие | Тип | Что делает |
|----------|-----|------------|
| `lead_list` | R | Список лидов с фильтром, сортировкой, пагинацией |
| `lead_get` | R | Лид по ID |
| `lead_count` | R | Подсчёт по фильтру |
| `lead_fields` | R | Описание полей лида (включая пользовательские) |
| `lead_stage_list` | R | Стадии лидов |
| `lead_product_rows_get` | R | Товарные позиции лида |
| `lead_create` | W | Создать лид |
| `lead_update` | W | Обновить лид (с откатом) |
| `lead_product_rows_set` | W | Установить товарные позиции (без отката) |
| `lead_delete` | D | Удалить лид (`risk: critical`) |
| `lead_bulk_update` | — | Массовое обновление |

### 5.2 Сделки

| Действие | Тип | Что делает |
|----------|-----|------------|
| `deal_list` | R | Список сделок |
| `deal_get` | R | Сделка по ID |
| `deal_count` | R | Подсчёт по фильтру |
| `deal_fields` | R | Описание полей сделки |
| `deal_category_list` | R | Список воронок |
| `deal_stage_list` | R | Стадии в воронке |
| `deal_product_rows_get` | R | Товарные позиции сделки |
| `create_deal` | W | Создать сделку (воронка, стадия, сумма) |
| `deal_update` | W | Обновить сделку (с откатом) — в том числе перевод по стадиям |
| `deal_product_rows_set` | W | Установить товарные позиции |
| `deal_delete` | D | Удалить сделку (`risk: critical`) |
| `deal_bulk_update` | — | Массовое обновление |

### 5.3 Контакты и компании

| Действие | Тип | Что делает |
|----------|-----|------------|
| `contact_list`, `contact_get` | R | Список / карточка контакта |
| `company_list`, `company_get` | R | Список / карточка компании |
| `contact_create`, `company_create` | W | Создание |
| `contact_update`, `company_update` | W | Обновление (с откатом) |

### 5.4 Структура портала

| Действие | Тип |
|----------|-----|
| `create_default_funnel`, `create_funnel_with_custom_stages`, `create_new_funnel_stage` | B |
| `rename_funnel_title`, `rename_funnel_stages`, `update_funnel_stages` | B |
| `delete_funnel`, `delete_funnel_stage` | B |
| `create_crm_custom_field` | B |
| `move_deals_between_funnels`, `move_deals_between_stages` | B |
| `crm_duplicate_search` | — |

### 5.5 Таймлайн и дела CRM

| Действие | Тип | Что делает |
|----------|-----|------------|
| `timeline_comment_list` | R | Комментарии таймлайна лида/сделки/контакта/компании |
| `timeline_list` | R | Сводная история: комментарии + дела |
| `stagehistory_list` | R | История перемещения по стадиям — сколько времени сделка провела на каждой |
| `activity_list` | R | Список дел CRM |
| `timeline_comment_add` | W | Добавить комментарий в таймлайн |
| `activity_add` | W | Создать дело (звонок, встреча, задача CRM) |
| `activity_update` | W | Обновить дело |
| `activity_complete` | W | Закрыть дело как выполненное |
| `activity_delete` | D | Удалить дело |

### 5.6 Задачи

| Действие | Тип | Что делает |
|----------|-----|------------|
| `search_tasks` | R | Поиск задач по фильтру |
| `get_task_by_id` | R | Задача по ID |
| `create_task` | W | Создать задачу: заголовок, описание, ответственный, дедлайн, группа, привязка к CRM (`crmBindings`) |
| `update_task` | W | Обновить задачу (с откатом) |
| `clear_task_deadline` | W | Снять дедлайн |
| `detach_task_from_group` | W | Отвязать от группы |
| `add_task_result` | W | Добавить результат работы |
| `send_chat_message` | W | Сообщение в комментарии задачи |
| `add_task_reminder` | W | Напоминание на дату |
| `delete_task` | D | Удалить задачу |
| `set_daily_task_recurrence` и 5 других `set_*_recurrence` | — | Регулярные задачи |

### 5.7 Участники задач, пользователи

| Действие | Тип | Что делает |
|----------|-----|------------|
| `search_users` | R | Поиск сотрудников |
| `user_get` | R | Пользователь по ID |
| `department_list` | R | Подразделения |
| `add_accomplices`, `delete_accomplices` | W | Соисполнители |
| `add_auditors`, `delete_auditors` | W | Наблюдатели |
| `add_current_user_as_auditor` | W | Добавить владельца вебхука наблюдателем |

### 5.8 Чек-листы

| Действие | Тип |
|----------|-----|
| `create_check_list`, `create_check_list_item` | W |
| `update_check_list`, `update_check_list_item` | W |
| `delete_check_list`, `delete_check_list_item` | D |
| `checklist_reorder` | — |

### 5.9 Аналитика по воронке и продажам

Все действия этой группы — **чтение**, подтверждения не требуют.

| Действие | Что считает |
|----------|-------------|
| `lead_count_by_stage` | Лиды по стадиям |
| `deal_count_by_stage` | Сделки по стадиям |
| `deal_sum_by_stage` | Сумма сделок по стадиям |
| `lead_conversion_report` | Конверсия лидов за период |
| `crm_funnel_summary` | Сводка по воронке |
| `new_deals_period` | Новые сделки за период |
| `closed_deals_period` | Закрытые сделки за период |
| `overdue_activity_report` | Просроченные дела |
| `overdue_tasks_report` | Просроченные задачи |
| `deals_without_next_step` | Сделки без следующего шага |
| `deals_without_activity` | Сделки без активности |
| `leads_without_responsible` / `leads_without_assigned` | Лиды без ответственного |
| `manager_workload` | Нагрузка и качество ведения CRM по менеджерам |
| `sales_forecast` | Прогноз продаж — **не реализован** |

### 5.10 Качество данных по контактам

| Действие | Что проверяет |
|----------|---------------|
| `contact_field_audit` | Аудит полей контакта, включая пользовательские |
| `contact_count`, `contact_count_by_status` | Количество, распределение по статусам |
| `contacts_without_status` | Контакты без статуса |
| `contacts_without_company` | Контакты без привязки к компании |
| `contacts_missing_birthday` | Без даты рождения |
| `contacts_cycle_without_next_activity` | В статусе «Цикл» без следующего дела |
| `contacts_birthday_activity_report` | Контроль поздравлений с ДР |
| `contact_quality_report` | Сводный отчёт качества |

### 5.11 Дисциплина ведения CRM

| Действие | Что проверяет |
|----------|---------------|
| `leads_without_next_activity` | Лиды без запланированного дела |
| `stale_leads_report` | Лиды без изменений более N дней (по умолчанию 14) |
| `stale_deals_report` | Сделки без изменений более N дней |
| `overdue_activities_by_manager` | Просроченные дела в разрезе менеджеров |
| `crm_discipline_report` | Сводный отчёт дисциплины |

### 5.12 Контекст клиента и встречи

| Действие | Тип | Что делает |
|----------|-----|------------|
| `crm_context_get` | R | Нормализованный контекст: поля, связи, дела, задачи, таймлайн |
| `crm_context_summary` | R | Управленческая сводка по клиенту |
| `recommend_next_client_action` | R | Рекомендация следующего шага |
| `meeting_protocol_generate` | R | Протокол встречи по транскрипту |
| `client_message_draft` | R | Черновик сообщения (без отправки) |
| `client_message_send` | W | Отправка сообщения — необратимо, нужна фраза |

### 5.13 Коммуникации (Hub)

| Действие | Тип | Что делает |
|----------|-----|------------|
| `communication_channels_list` | R | Каналы Wazzup/Hub без секретов |
| `communication_thread_get` | R | Диалог |
| `communication_contact_context` | R | Контекст переписки контакта |
| `communication_message_draft` | R | Черновик |
| `communication_campaign_preview` | R | Предпросмотр кампании |
| `communication_sequence_list` | R | Список цепочек касаний |
| `communication_delivery_report` | R | Отчёт доставки |
| `communication_unanswered_report` | R | Неотвеченные диалоги |
| `communication_message_send_prepare` | W | Подготовка отправки |
| `communication_campaign_start_prepare` | W | Запуск кампании (фраза) |
| `communication_campaign_pause_prepare` / `_cancel_prepare` | W | Пауза / отмена |
| `communication_sequence_activate_prepare` | W | Активация цепочки |
| `communication_sequence_enroll_prepare` | W | Подключение контакта к цепочке |
| `communication_enrollment_stop_prepare` | W | Остановка enrollment |

---

## 6. Отчёты и документы

### 6.1 Быстрые отчёты

`GET /reports/quick` — список пресетов, `POST /reports/quick/:id/run` — запуск. Отчёты строятся на аналитических действиях из разделов 5.9–5.11, полностью read-only. Результат — текст/таблица с экспортом в HTML и возможностью открыть как документ.

Запись результата в таймлайн Bitrix возможна только для отчёта по конкретной сделке или лиду и только через Safety (`POST /bitrix/deal/:id/analyze/save/prepare`).

### 6.2 Document Studio

`POST /documents/generate` с указанием типа шаблона.

| Тип | Название | Обязательные параметры | Источники данных |
|-----|----------|------------------------|------------------|
| `funnel_report` | Отчёт по воронке | `categoryId` | `crm_funnel_summary`, `deal_count_by_stage` |
| `deal_summary` | Сводка по сделке | `dealId` | `deal_get`, `activity_list`, `timeline_comment_list` |
| `commercial_proposal` | Коммерческое предложение | `dealId` | `deal_get`, `deal_product_rows_get`, `contact_get`, `company_get` |
| `meeting_protocol` | Протокол встречи | `entityId` / `dealId` | Дела и комментарии CRM + параметры |
| `task_report` | Отчёт по задачам | `taskId` или фильтр по датам | `search_tasks`, `get_task_by_id` |

**Форматы экспорта**: HTML (основной, файл сохраняется в `reports/` и доступен по URL) и производный plain text. PDF-экспорт есть как утилита на Puppeteer, но **в основной поток генерации не подключён** — `generateDocument()` возвращает `download.pdf: null`. Markdown и XLSX для документов не поддерживаются.

---

## 7. Протоколы встреч

Отдельный сценарий: транскрипт → протокол → CRM.

```
загрузка транскрипта (.txt / .md / вставка текстом)
  → meeting_transcripts (SQLite, SHA-256 content_hash, лимит MEETING_TRANSCRIPT_MAX_CHARS = 200000)
  → meeting_protocol_generate (эвристика + опционально Claude)
  → предпросмотр и правка
  → сохранение в CRM через timeline_comment_add (Safety: prepare → confirm → commit)
  → recommendedActions (только предложения)
  → client_message_draft (только черновик)
```

Структура протокола: каждая секция помечена как `fact` / `inference` / `recommendation`, чтобы отличать сказанное на встрече от выводов модели. Секции: дата, участники, клиент, компания, цель, контекст, темы, потребности, ограничения, договорённости, следующие шаги, ответственные, дедлайны, материалы, риски, прогноз, рекомендуемая стадия, открытые вопросы.

**Что не происходит автоматически**: перевод по стадиям, создание задач и дел, отправка сообщений клиенту. Всё это — только явным действием пользователя.

---

## 8. Плановые отчёты и уведомления

Планировщик работает **строго read-only** — в Bitrix24 он ничего не пишет.

### 8.1 Типы отчётов

| ID | Название | Расписание по умолчанию |
|----|----------|-------------------------|
| `daily_director_brief` | Ежедневная сводка руководителя | ежедневно 08:00 |
| `weekly_sales_summary` | Еженедельная сводка продаж | понедельник 08:00 |
| `crm_discipline` | Дисциплина CRM | ежедневно 08:00 |
| `birthday_control` | Контроль дней рождения | ежедневно 08:00, `daysAhead: 7` |

К отчёту опционально добавляется текстовое резюме от Claude — на расчёт алертов оно не влияет.

### 8.2 Формат расписания

Типы: `daily`, `weekly`, `monthly`, `cron`.

Cron поддерживается в урезанном виде: 5 полей `m h * * dow`, где день месяца и месяц обязаны быть `*`, а минуты и часы — конкретными значениями. Минимальный интервал — `SCHEDULED_REPORT_MIN_INTERVAL_MINUTES` (15).

Часовой пояс берётся из `APP_TIMEZONE` (по умолчанию `Asia/Almaty`), а не из системного времени сервера. Ключ идемпотентности `{scheduleId}:{scheduledFor}` не даёт запустить один слот дважды. При пропуске окна действует grace-период `SCHEDULED_REPORT_MISFIRE_GRACE_MINUTES` (120) — выполняется один догоняющий запуск, без отработки всей истории.

### 8.3 Алерты

Операторы сравнения: `>`, `>=`, `<`, `<=`, `==`, `!=` — выражения не вычисляются через `eval`, только структурные правила.

| Код | Метрика | Уровень |
|-----|---------|---------|
| `CONTACTS_WITHOUT_STATUS` | контакты без статуса | critical |
| `CONTACTS_CYCLE_NO_ACTIVITY` | «Цикл» без следующего дела | critical |
| `LEADS_WITHOUT_NEXT` | лиды без следующего дела | critical |
| `DEALS_WITHOUT_NEXT` | сделки без следующего шага | critical |
| `OVERDUE_ACTIVITIES` | просроченные дела | critical |
| `OVERDUE_BIRTHDAY` | просроченные поздравления | critical |
| `STALE_DEALS` | зависшие сделки | warning |
| `TASKS_UNAVAILABLE` | нет доступа к модулю Задач | warning |

### 8.4 Уведомления

Типы: `report_ready`, `partial_report`, `critical_alert`, `warning`, `schedule_failed`, `system_failure`, `communication_status`.

**Доставка только внутри приложения.** Email, Telegram, WhatsApp и push для уведомлений не реализованы — это осознанное ограничение, чтобы планировщик не мог ничего отправить наружу.

---

## 9. Коммуникации с клиентами

В системе две подсистемы обмена сообщениями.

| Подсистема | Назначение |
|------------|------------|
| **Исходящие** (legacy) | Одиночные сообщения через адаптеры Bitrix |
| **Communications Hub** | Wazzup: диалоги, кампании, цепочки касаний, очередь отправки |

### 9.1 Каналы

Через Wazzup (`chatType`): `whatsapp`, `telegram`, `viber`, `whatsgroup`, `instagram`, `max`, `maxgroup`.

Транспорты: `whatsapp`, `wapi`, `telegram`, `tgapi`, `viber`, `instagram`, `max`, `maxbot`. Шаблоны WABA доступны только на `wapi`; отчёты о прочтении — на `wapi` и `whatsapp`.

Legacy-адаптеры: WhatsApp, Telegram, Bitrix Open Lines, Bitrix CRM Email (**только черновик**, отправка отключена), Bitrix IM (`im.message.add` при наличии scope).

### 9.2 Три уровня защиты отправки

**Уровень 1 — kill switches** (все по умолчанию в безопасном положении):

| Env | По умолчанию | Что контролирует |
|-----|--------------|------------------|
| `COMMUNICATIONS_ENABLED` | `false` | Hub целиком: API, UI, воркер |
| `COMMUNICATIONS_SEND_ENABLED` | `false` | Реальный HTTP-вызов провайдера |
| `COMMUNICATIONS_DRY_RUN` | `true` | Outbox пишет статус `dry_run` без вызова Wazzup |

Если канонический и устаревший флаг отправки противоречат друг другу — срабатывает `COMMUNICATION_FLAGS_CONFLICT`, отправка выключается, dry-run включается.

**Уровень 2 — policy engine.** Перед каждой отправкой проверяется набор правил. Коды отказа: `STATUS_SPAM`, `STATUS_DONT_TOUCH`, `STATUS_PERSONAL`, `SUPPRESSION`, `OPT_OUT`, `NO_ADDRESS`, `INACTIVE_CHANNEL`, `DAILY_LIMIT`, `QUIET_HOURS`, `WABA_TEMPLATE_REQUIRED`, `CONGRATS_ONLY`, `TELEGRAM_FIRST_CONTACT_FORBIDDEN`, `MAX_FIRST_CONTACT_FORBIDDEN`, `AMBIGUOUS_CONTACT`, `PLAN_HASH_MISMATCH`, `CAMPAIGN_LIMIT`.

Тихие часы по умолчанию `19:00–09:00`, разрешённые дни — с понедельника по пятницу. Основания для первого контакта (`FIRST_CONTACT_GROUNDS`): `inbound`, `application`, `call`, `referral`, `manual_consent`, `active_dialog` — без основания первое касание в Telegram и MAX запрещено.

**Уровень 3 — сертификация.** При `COMMUNICATIONS_REQUIRE_CERTIFICATION=true` реальная отправка требует пройденных живых тестов:

| Операция | Требуемый уровень |
|----------|-------------------|
| Одиночная отправка / outbox | `single_send_verified` |
| Запуск кампании | `campaign_verified` |
| Шаг цепочки | `sequence_verified` + входящий ответ |

Срок годности сертификации — `COMMUNICATION_LIVE_TEST_MAX_AGE_DAYS` (90 дней).

### 9.3 Лимиты отправки

| Env | По умолчанию |
|-----|--------------|
| `COMMUNICATIONS_MAX_CAMPAIGN_RECIPIENTS` | 100 |
| `COMMUNICATIONS_MAX_SINGLE_BATCH` | 20 |
| `COMMUNICATIONS_MAX_MESSAGES_PER_MINUTE` | 10 |
| `COMMUNICATIONS_MAX_MESSAGES_PER_HOUR` | 100 |
| `COMMUNICATIONS_MAX_MESSAGES_PER_CONTACT_PER_DAY` | **1** |
| `COMMUNICATIONS_MIN_INTERVAL_SECONDS` | 5 |
| `COMMUNICATIONS_SEND_JITTER_SECONDS` | 15 |
| `COMMUNICATIONS_OUTBOX_MAX_ATTEMPTS` | 5 |

### 9.4 Кампании и цепочки

Кампания: `draft → preview (planHash) → фраза подтверждения → running → outbox → pause/cancel`. Статусы: `draft`, `running`, `paused`, `cancelled`, `completed`, `failed`. План кампании после подтверждения иммутабелен — изменение состава получателей ломает `planHash`.

Цепочки касаний (drip): шаги с задержкой в `days` / `hours` / `minutes`, флаг `business_days`. Enrollment останавливается автоматически при ответе клиента (`stopped_by_reply`), попадании в стоп-статус (`stopped_by_status`), suppression-лист (`stopped_by_suppression`) или вручную.

Категории шаблонов: `warmup`, `cycle`, `follow_up`, `meeting_summary`, `birthday`, `holiday`, `personal_congratulation`, `meeting_invitation`, `newsletter`, `service`.

Разрешённые переменные шаблонов: `firstName`, `fullName`, `companyName`, `managerName`, `referrerName`, `meetingDate`, `lastContactDate`, `contextReason`.

### 9.5 Контекст переписки для LLM

`communication_contact_context` отдаёт модели: последние сообщения (лимит `COMMUNICATION_CONTEXT_RECENT_MESSAGES` = 30), последнее входящее и исходящее, активные цепочки, предпочтительный канал, неотвеченные, ограничения. Секреты и данные других контактов не попадают никогда.

---

## 10. Реестр схемы CRM

Локальная версионированная копия метаданных CRM (миграция v14). Решает три задачи:

1. **Аудит** — сравнение портала с эталоном (SENSU против базовой линии TWIGA BI).
2. **Знание процесса для LLM и UI** — объяснить смысл стадии, обязательные поля, рекомендуемые следующие стадии, **не выполняя записи в Bitrix**.
3. **Кросс-портальный маппинг** — черновики соответствий стадий и enum-значений через канонические ключи.

Приоритет источников: `live_bitrix` (чтение через REST) → согласованные бизнес-правила → seed-файлы `excel_twiga` / `excel_sensu` → выведенная онтология `sales_process`.

Конфигурация в `config/crm/`: `twiga-fields.json`, `twiga-enums.json`, `twiga-stages.json`, `sensu-draft-fields.json`, `sensu-draft-stages.json`, `sales-process-ontology.json`, `stage-mapping-draft.json`.

Каждая запись помечена уровнем доверия: `verified_from_live_bitrix`, `imported_from_excel`, `inferred`, `needs_confirmation`, `draft`.

Практическая польза: ассистент может расшифровать непрозрачные `STAGE_ID` и коды UF-полей через канонические стадии онтологии (`lead.target`, `lead.meeting_ready`, `lead.first_meeting` и т.д.).

Важное ограничение: **реестр не выведен как действия для LLM** — доступ только через REST (`GET /api/crm-schema/*`) с правом `crm.schema.read`. Во всех функциях знания процесса стоит явный флаг `performsTransition: false` — модель получает рекомендацию, но не автоматический перевод по стадиям.

---

## 11. Доступ и права

### 11.1 Режимы доступа

| `APP_ACCESS_MODE` | Поведение |
|-------------------|-----------|
| `local_only` (по умолчанию) | IP-allowlist из `APP_ALLOWED_IPS`, синтетический пользователь с полными правами для локальной разработки |
| `authenticated` | Обязательна серверная сессия в HttpOnly-cookie, личность определяется только сервером |

### 11.2 Роли

| Роль | Что может |
|------|-----------|
| **`administrator`** | Всё: все 33 права, включая управление пользователями, ролями, настройками, захват схемы CRM |
| **`director`** | Всё кроме `users.manage`, `roles.manage`, `settings.manage`, `crm.schema.capture`. Есть `operations.rollback` и `operations.confirm.any` — может подтверждать и откатывать чужие операции |
| **`manager`** | `crm.read.own`, `operations.prepare`, `operations.confirm.own`, `communications.send`/`draft`/`manage`. **Не может** откатывать и подтверждать чужие операции |
| **`analyst`** | Только чтение CRM и аналитика, просмотр своих операций. Без prepare / confirm / send |
| **`viewer`** | `reports.view`, `notifications.view`, `projects.view` |

### 11.3 Область данных

Поле пользователя `data_scope`: `own` (по умолчанию) или `all`.

При `own` требуется заполненный `bitrix_user_id`, иначе — `BITRIX_USER_MAPPING_REQUIRED`. Все списки принудительно фильтруются по `ASSIGNED_BY_ID = bitrixUserId`, а попытки клиента переопределить фильтр вырезаются. Доступ к конкретной записи проверяется по ответственному — иначе `RESOURCE_ACCESS_DENIED`.

Журнал операций тоже фильтруется: без права `operations.view.all` пользователь видит только операции, которые сам инициировал или подтвердил.

---

## 12. Надёжность работы с Bitrix24

### 12.1 Чтение и запись обрабатываются по-разному

| | Повторы | Таймаут | При сетевом сбое |
|---|---------|---------|------------------|
| **Чтение** | Да, `withRetry()` | `BITRIX_READ_TIMEOUT_MS` (30000) на попытку | Нормализованная ошибка, повтор |
| **Запись** | **Нет** | Одна попытка | `WRITE_RESULT_UNKNOWN` |

Запись сознательно не повторяется: если ответ не получен, неизвестно, применилась ли операция. Повтор мог бы создать дубль лида или задачи, поэтому система честно сообщает о неопределённом результате и оставляет решение человеку. Для таких случаев есть runbook [communication-result-unknown.md](./runbooks/communication-result-unknown.md).

Повторы чтения: `BITRIX_READ_RETRY_ATTEMPTS` (3), базовая задержка `BITRIX_READ_RETRY_BASE_DELAY_MS` (500) с экспоненциальным ростом и джиттером ±30%, общий бюджет `BITRIX_READ_RETRY_MAX_TOTAL_MS` (90000).

### 12.2 Таксономия ошибок

| Код | Повторяемая | Причина |
|-----|-------------|---------|
| `BITRIX_NETWORK_ERROR` | да | Сбой соединения |
| `BITRIX_TIMEOUT` | да | Превышен таймаут |
| `BITRIX_RATE_LIMITED` | да | HTTP 429 / `query_limit` |
| `BITRIX_TEMPORARY_ERROR` | да | 502 / 503 / 504 |
| `BITRIX_INVALID_JSON` | да | Пустой или битый ответ |
| `BITRIX_ACCESS_DENIED` | нет | Нет прав |
| `BITRIX_INSUFFICIENT_SCOPE` | нет | Недостаточный scope вебхука |
| `BITRIX_ENTITY_NOT_FOUND` | нет | Запись не найдена |
| `BITRIX_INVALID_PARAMETER` | нет | Неверные параметры |
| `WRITE_RESULT_UNKNOWN` | нет | Результат записи неизвестен |

Все ошибки доходят до пользователя как `BitrixAppError` с русским текстом, без технических деталей и секретов.

### 12.3 Пагинация

| Параметр | Значение |
|----------|----------|
| Размер страницы | 50 |
| Максимум страниц (аналитика) | 200, override `BITRIX_ANALYTICS_MAX_PAGES` |
| Максимум записей в обычном чтении | 500 |
| Максимум страниц в обычном чтении | 20 |

`fetchAllPages()` идёт по курсору `next`, детектит зацикливание и при достижении лимита ставит флаг `truncated: true` — модель и пользователь видят, что данные неполные, вместо тихого обрезания.

### 12.4 Ограничение частоты запросов

Скользящее окно на минуту, ключ — `userId` / `sessionId` / хеш IP:

| Бакет | Env | По умолчанию |
|-------|-----|--------------|
| API | `API_RATE_LIMIT_REQUESTS_PER_MINUTE` | 120 |
| LLM | `LLM_RATE_LIMIT_REQUESTS_PER_MINUTE` | 20 |
| Запись | `WRITE_RATE_LIMIT_REQUESTS_PER_MINUTE` | 30 |
| Логин | `AUTH_LOGIN_MAX_ATTEMPTS` | 5 попыток / 15 мин, блокировка 15 мин |

### 12.5 Режимы обслуживания

| Env / переключатель | Что блокирует |
|---------------------|---------------|
| `APP_MAINTENANCE_MODE` | Все записи (`MAINTENANCE_MODE`) |
| `APP_READ_ONLY_MODE` | Все записи (`READ_ONLY_MODE`) |
| `BITRIX_WRITE_ENABLED=false` | Commit в CRM (`BITRIX_WRITE_DISABLED`) |
| `LLM_ENABLED=false` | Обращения к модели |
| `SCHEDULER_ENABLED=false` | Плановые отчёты |

Режимы read-only и maintenance переключаются на ходу через `POST /admin/system/read-only/enable|disable` и аналогичные для maintenance (право `settings.manage`); значения хранятся в памяти процесса.

### 12.6 Защита данных в логах

Перед записью в SQLite и журнал аудита `redact.js` заменяет значения ключей, попадающих под `PHONE|EMAIL|TOKEN|PASSWORD|SECRET|API_KEY`, на `[redacted]`, обрезает длинные строки и вычищает URL вебхуков и Bearer-токены из значений. Адреса получателей в UI маскируются.

---

## 13. Локальное хранилище

SQLite, 14 миграций. Основные группы таблиц:

| Группа | Таблицы |
|--------|---------|
| Safety | `operations`, `operation_items`, `operation_events` |
| Рабочее пространство | `profiles`, `projects`, `project_files`, `chats`, `messages`, `chat_summaries`, `app_settings` |
| Встречи | `meeting_transcripts`, `meeting_protocol_templates`, `meeting_protocols` |
| Планировщик | `report_schedules`, `report_runs`, `notifications`, `notification_recipients`, `scheduler_locks` |
| Доступ | `app_roles`, `role_permissions`, `app_users`, `user_sessions`, `auth_events`, `project_members` |
| Коммуникации (legacy) | `communication_channels`, `message_drafts`, `outbound_messages`, `message_delivery_events` |
| Hub | `communication_identities`, `communication_threads`, `communication_messages`, `communication_templates`, `communication_campaigns`, `communication_campaign_recipients`, `communication_sequences`, `communication_sequence_steps`, `communication_sequence_enrollments`, `communication_outbox`, `communication_webhook_events`, `communication_suppressions`, `communication_consents`, `communication_field_mappings` |
| Сертификация | `communication_provider_certifications`, `communication_certification_runs`, `communication_provider_snapshots` |
| Схема CRM | `crm_schema_snapshots`, `crm_field_definitions`, `crm_field_enum_values`, `crm_pipeline_definitions`, `crm_stage_definitions`, `crm_stage_requirements`, `crm_stage_mappings`, `crm_process_rules` |
| Наблюдаемость | `application_errors` |

---

## 14. HTTP API

Основные группы эндпоинтов.

| Группа | Эндпоинты |
|--------|-----------|
| Здоровье | `GET /health`, `/health/readiness` (публичные), `/health/details`, `/admin/go-live-readiness` |
| Аутентификация | `POST /auth/login`, `/auth/logout`, `/auth/change-password`, `GET /auth/me`, `/auth/csrf`, `/auth/sessions` |
| Пользователи и роли | `GET/POST/PATCH /users`, `/users/:id/disable`, `/enable`, `/reset-password`, `GET/PATCH /roles` |
| Чат | `POST /chat`, `/chat/confirm`, `/chat/reset`, `GET /actions/history` |
| Bitrix напрямую | `GET /bitrix/deal/:id`, `GET /bitrix/actions`, `POST /bitrix/action`, `POST /bitrix/deal/:id/analyze`, `POST /bitrix/event` |
| Операции Safety | `GET /operations`, `/operations/pending`, `/operations/:id`, `POST /operations/:id/cancel`, `/recover`, `/rollback/prepare`, `POST /operations/rollback/commit` |
| Документы и отчёты | `GET /documents/templates`, `/documents/list`, `POST /documents/generate`, `/documents/export-html`, `GET /reports/quick`, `POST /reports/quick/:id/run` |
| Рабочее пространство | `/profiles`, `/projects` (+ файлы, архив, дублирование), `/chats`, `/search`, `/settings` |
| Контекст клиента | `GET /crm/context/:entityType/:entityId`, `POST /crm/context/summary`, `/client-message/draft`, `/client-next-action/recommend` |
| Встречи | `POST /meeting-transcripts`, `/meeting-protocols/generate`, `PATCH /meeting-protocols/:id`, `POST /meeting-protocols/:id/save-to-crm/prepare` |
| Планировщик | `/scheduled-report-types`, `/scheduled-reports` (+ enable/disable/run-now), `/scheduled-reports/:id/runs`, `/notifications` |
| Коммуникации | `/communications/overview`, `/channels`, `/threads`, `/messages/prepare`, `/messages/commit`, `/templates`, `/sequences`, `/campaigns`, `/certifications`, `/delivery`, `/analytics`, `/suppressions` |
| Вебхуки провайдеров | `POST /communication-events/:channel`, `/webhooks/wazzup/:secret`, `/webhooks/max/:secret` |
| Схема CRM | `GET /api/crm-schema/portals`, `/snapshots`, `/entities`, `/pipelines`, `/stages`, `/diff`, `/stage-explanation`, `POST /snapshots/capture` |
| Администрирование | `GET /admin/system/status`, `/metrics`, `/disk`, `/admin/errors`, `POST /admin/system/read-only/*`, `/maintenance/*`, `/admin/communications/emergency-stop` |

---

## 15. Чего система не делает

Список важен не меньше, чем список возможностей — он объясняет границы автоматизации.

| Не делает | Почему |
|-----------|--------|
| Не пишет в Bitrix24 без подтверждения человека | Архитектурное требование; запись вне Safety-контекста технически невозможна |
| Не меняет структуру портала (воронки, стадии, поля) | Заблокировано на уровне политик: слишком высокий риск для всего портала |
| Не делает массовых изменений по умолчанию | Требуется явный `BITRIX_BULK_ACTIONS_ENABLED` + фраза подтверждения |
| Не отправляет сообщения по расписанию | Планировщик read-only, уведомления только внутри приложения |
| Не создаёт задачи и дела по итогам встречи автоматически | Только предложения; создание — явным действием |
| Не повторяет неудавшуюся запись | Риск дублей; вместо этого `WRITE_RESULT_UNKNOWN` |
| Не переводит сделки по стадиям на основе знания процесса | `performsTransition: false`; реестр схемы даёт только рекомендации |
| Не хранит секреты в UI и не показывает их модели | Redaction на входе в логи и в payload для LLM |
| Не поддерживает стриминг ответов LLM | Только полный запрос/ответ |
| Не генерирует PDF в основном потоке документов | Экспорт HTML; PDF-утилита существует, но не подключена |
| Не работает с несколькими LLM-провайдерами | Только Anthropic Messages API |

---

## 16. Типовые сценарии

| Запрос пользователя | Что делает система |
|---------------------|--------------------|
| «Покажи сделки в работе по воронке 3» | `deal_category_list` → `deal_list` с фильтром → таблица |
| «Сколько лидов на каждой стадии» | `lead_count_by_stage` → сводка |
| «Сколько времени сделка 123 висела на каждой стадии» | `stagehistory_list` → расчёт по интервалам |
| «Создай задачу Иванову с дедлайном в пятницу по сделке 456» | `search_users` → `create_task` (prepare) → предпросмотр → подтверждение → commit |
| «Заведи лид: Пётр, +7…, интерес к оборудованию» | `lead_create` (prepare) → предпросмотр полей → подтверждение → commit |
| «Переведи сделку 456 на стадию согласования» | `deal_stage_list` → `deal_update` (prepare) → подтверждение → commit, откат доступен |
| «Кто из менеджеров запустил CRM» | `crm_discipline_report` или `manager_workload` |
| «Что писали в таймлайне лида 789» | `timeline_comment_list` |
| «Собери протокол по этому транскрипту и сохрани в сделку» | загрузка транскрипта → `meeting_protocol_generate` → правка → prepare `timeline_comment_add` → подтверждение |
| «Напиши клиенту follow-up» | `client_message_draft` → черновик; отправка отдельно, с фразой `ОТПРАВИТЬ СООБЩЕНИЕ …` |
| «Удали сделку 999» | `deal_delete` (prepare, `risk: critical`) → предпросмотр → подтверждение; откат невозможен, предупреждение показывается заранее |

---

## Связанные документы

| Тема | Документ |
|------|----------|
| Обзор интерфейса | [app-overview.md](./app-overview.md) |
| Safety Layer детально | [action-safety.md](./action-safety.md) |
| Доступ и роли | [access-control.md](./access-control.md), [user-roles.md](./user-roles.md) |
| Контекст клиента | [client-context.md](./client-context.md) |
| Встречи | [meeting-workflow.md](./meeting-workflow.md) |
| Плановые отчёты | [scheduled-reports.md](./scheduled-reports.md) |
| Коммуникации | [communications.md](./communications.md), [communication-policy.md](./communication-policy.md), [campaigns-and-sequences.md](./campaigns-and-sequences.md) |
| Аналитика | [manager-analytics.md](./manager-analytics.md), [contact-analytics.md](./contact-analytics.md) |
| Эксплуатация | [deployment.md](./deployment.md), [observability.md](./observability.md), [incident-response.md](./incident-response.md) |
