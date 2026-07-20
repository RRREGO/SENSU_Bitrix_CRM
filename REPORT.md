# Отчёт: bitrix-claude-local-bridge

## 1. Назначение

Локальный Node.js-сервер — мост между **Bitrix24 REST API** и **Claude API (Anthropic)**.  
Позволяет работать с CRM на естественном русском языке, формировать отчёты и документы, а также автоматически анализировать сделки через Claude.

| Параметр | Значение |
|----------|----------|
| Название сервиса | `bitrix-claude-local-bridge` |
| Версия | 1.0.0 |
| Стек | Node.js 20+, Express, Anthropic Claude, Bitrix24 webhook REST, Puppeteer, Typograf, xlsx |

---

## 2. Сервер

| Параметр | Значение |
|----------|----------|
| Тип | Локальный HTTP-сервер (Express) |
| Порт по умолчанию | `3005` |
| URL | `http://localhost:3005` |
| Точка входа | `server.js` |
| Запуск | `npm run dev` (nodemon) / `npm start` |
| Health-check | `GET /health` → `{ "ok": true, "service": "bitrix-claude-local-bridge" }` |

### Переменные окружения (`.env`)

| Переменная | Назначение |
|------------|------------|
| `PORT` | Порт сервера (по умолчанию 3005) |
| `BITRIX_WEBHOOK_URL` | Входящий вебхук Bitrix24 |
| `BITRIX_OUTBOUND_TOKEN` | Токен исходящего вебхука (опционально) |
| `ANTHROPIC_API_KEY` | Ключ Claude API |
| `CLAUDE_MODEL` | Модель Claude (например `claude-sonnet-4-5`) |
| `ANTHROPIC_PROXY` | HTTP/SOCKS5 прокси для Claude (при необходимости) |

### Архитектура потока данных

```text
Пользователь (браузер / API)
        ↓
Express-сервер (localhost:3005)
        ↓
┌───────────────────┬────────────────────┐
│  Claude API       │  Bitrix24 REST     │
│  (чат, анализ)    │  (через webhook)   │
└───────────────────┴────────────────────┘
```

### Права входящего вебхука Bitrix24

- CRM
- Задачи
- Пользователи
- Чат и уведомления (для сообщений в задачи)
- Рабочие группы/проекты (если задачи в группах)

Для входящих событий из Bitrix24 локальный сервер публикуется через **ngrok** / **cloudflared** на endpoint `/bitrix/event`.

---

## 3. Веб-интерфейс

Адрес: `http://localhost:3005`

Вкладки:

1. **Чат** — CRM-ассистент на естественном языке
2. **Отчёты** — быстрые отчёты по воронке и периоду
3. **Документы** — генерация и предпросмотр деловых документов
4. **История действий** — журнал выполненных операций
5. **Настройки** — параметры интерфейса

---

## 4. Функционал

### 4.1. Чат с CRM-ассистентом (Claude + tools)

- Пользователь пишет на русском («Покажи сделки в работе», «Создай задачу…»).
- Claude выбирает нужный Bitrix-action через tool **`run_bitrix_action`**.
- **Чтение** выполняется сразу.
- **Создание / изменение / удаление** — только после подтверждения в UI (кнопки «Подтвердить» / «Отмена»).
- Деструктивные действия всегда требуют `confirm: true`.

### 4.2. Анализ сделки Claude

Сценарий: получить сделку → анализ Claude → комментарий в таймлайн Bitrix24.

- Вручную: `POST /bitrix/deal/:id/analyze`
- Автоматически: исходящий вебхук → `POST /bitrix/event` (с защитой от дублей)

### 4.3. Универсальный Bitrix Action API

- `GET /bitrix/actions` — каталог всех actions
- `POST /bitrix/action` — вызов любого action по имени и params

### 4.4. Быстрые отчёты

| ID | Название | Статус |
|----|----------|--------|
| `funnel_summary` | Сводка по воронке | реализован |
| `deal_count_by_stage` | Сделки по стадиям | реализован |
| `deal_sum_by_stage` | Сумма сделок по стадиям | реализован |
| `overdue_tasks` | Просроченные задачи | реализован |
| `deals_without_next_step` | Сделки без следующего шага | реализован |
| `leads_without_assigned` | Лиды без ответственного | реализован |
| `deals_without_activity` | Сделки без активности | реализован |
| `new_deals_period` | Новые сделки за период | реализован |
| `closed_deals_period` | Закрытые сделки за период | реализован |
| `manager_workload` | Нагрузка по менеджерам | заглушка |

Фильтры: воронка, период (сегодня / 7 / 30 дней / месяц), экспорт HTML, печать в PDF.

### 4.5. Документы

Шаблоны:

- Отчёт по воронке (`funnel_report`)
- Сводка по сделке (`deal_summary`)
- Коммерческое предложение (`commercial_proposal`)
- Протокол встречи (`meeting_protocol`)
- Отчёт по задаче (`task_report`)

Экспорт: HTML в папку `reports/`, PDF через печать браузера / Puppeteer.  
Тексты проходят типографику (Typograf), без эмодзи.

---

## 5. HTTP API (endpoints)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/` | Веб-интерфейс |
| GET | `/health` | Проверка сервера |
| POST | `/chat` | Сообщение ассистенту |
| POST | `/chat/confirm` | Подтверждение действия |
| POST | `/test/claude` | Тест Claude без Bitrix |
| GET | `/bitrix/deal/:id` | Получить сделку |
| POST | `/bitrix/deal/:id/analyze` | Анализ сделки + таймлайн |
| GET | `/bitrix/actions` | Список actions |
| POST | `/bitrix/action` | Вызов action |
| POST | `/bitrix/event` | События исходящего вебхука |
| GET | `/reports/quick` | Список быстрых отчётов |
| POST | `/reports/quick/:id/run` | Запуск отчёта |
| GET | `/documents/templates` | Шаблоны документов |
| GET | `/documents/list` | Сохранённые документы |
| POST | `/documents/generate` | Генерация документа |
| POST | `/documents/export-html` | Экспорт отчёта в HTML |
| GET | `/actions/history` | История действий |

---

## 6. Инструменты Claude (tool use)

У чат-агента один основной tool:

### `run_bitrix_action`

Выполняет действие Bitrix24 через локальный action registry.

**Параметры:**

- `action` (string) — имя из каталога
- `params` (object) — параметры action

Модель не просит пользователя писать JSON и не выдумывает данные; при нехватке данных задаёт уточняющий вопрос.

---

## 7. Каталог Bitrix24 actions

Всего в каталоге ~90+ actions. Реализованные группы:

### Лиды

`lead_stage_list`, `lead_list`, `lead_get`, `lead_count`, `lead_update`, `lead_create`, `lead_delete`, `lead_fields`, `lead_product_rows_get`, `lead_product_rows_set`  
*(заглушка: `lead_bulk_update`)*

### Воронки и стадии

`deal_category_list`, `deal_stage_list`, `create_deal`, `create_default_funnel`, `create_funnel_with_custom_stages`, `create_new_funnel_stage`, `rename_funnel_title`, `rename_funnel_stages`, `update_funnel_stages`, `delete_funnel`, `delete_funnel_stage`, `move_deals_between_funnels`, `move_deals_between_stages`, `create_crm_custom_field`  
*(заглушка: `crm_duplicate_search`)*

### Сделки

`deal_list`, `deal_get`, `deal_count`, `deal_update`, `deal_delete`, `deal_fields`, `deal_product_rows_get`, `deal_product_rows_set`  
*(заглушка: `deal_bulk_update`)*

### Контакты и компании

`contact_list`, `contact_get`, `contact_create`, `contact_update`, `company_list`, `company_get`, `company_create`, `company_update`

### Таймлайн и дела

`timeline_comment_add`, `timeline_comment_list`, `timeline_list`, `activity_list`, `activity_add`, `activity_update`, `activity_delete`, `activity_complete`

### Задачи

`create_task`, `search_tasks`, `get_task_by_id`, `update_task`, `delete_task`, `clear_task_deadline`, `detach_task_from_group`, `add_task_result`, `send_chat_message`

### Пользователи и участники задач

`search_users`, `user_get`, `department_list`, `add_accomplices`, `delete_accomplices`, `add_auditors`, `add_current_user_as_auditor`, `delete_auditors`

### Чек-листы

`create_check_list`, `create_check_list_item`, `update_check_list`, `update_check_list_item`, `delete_check_list`, `delete_check_list_item`  
*(заглушка: `checklist_reorder`)*

### Напоминания

`add_task_reminder`  
*(заглушки: регулярности задач — daily/weekly/monthly/yearly)*

### Аналитика

`lead_count_by_stage`, `deal_count_by_stage`, `deal_sum_by_stage`, `lead_conversion_report`, `crm_funnel_summary`, `overdue_activity_report`, `overdue_tasks_report`, `deals_without_next_step`, `leads_without_responsible` / `leads_without_assigned`, `deals_without_activity`, `new_deals_period`, `closed_deals_period`  
*(заглушки: `manager_workload`, `sales_forecast`)*

Многие actions имеют алиасы методов Bitrix REST (`crm.deal.list` → `deal_list` и т.д.).

---

## 8. Безопасность действий

| Категория | Поведение |
|-----------|-----------|
| Read-only | Выполняются сразу |
| Write | Требуют подтверждения в чате |
| Destructive (`delete_*`, `lead_delete`, `deal_delete` и др.) | Всегда `confirm: true` |

Секреты только в `.env`, не логируются и не отдаются в UI/документы.

---

## 9. Структура модулей

```text
server.js                 — Express API
src/chatAgent.js          — чат-агент Claude + tool use
src/claudeClient.js       — клиент Anthropic
src/bitrixClient.js       — клиент Bitrix REST
src/toolDefinitions.js    — описание tool run_bitrix_action
src/actionSafety.js       — уровни подтверждения
src/actions/*             — реестр Bitrix actions
src/reports/*             — быстрые отчёты
src/documents/*           — шаблоны и экспорт документов
public/*                  — веб-UI
```

---

## 10. Краткое резюме

Локальный CRM-ассистент: сервер на порту **3005** связывает Bitrix24 и Claude. Пользователь общается на русском; Claude вызывает Bitrix через tool `run_bitrix_action`. Есть веб-UI (чат, отчёты, документы, история), REST API, анализ сделок с записью в таймлайн, экспорт отчётов в HTML/PDF. Изменения в CRM требуют подтверждения; опасные удаления — явного `confirm`.
