# Аудит аналитики Bitrix24 CRM Assistant

Дата: 2026-07-13  
Область: actions аналитики, быстрые отчёты, пагинация, передача данных в Claude.

## Краткий вердикт

До исправлений аналитика считала в основном **первую страницу Bitrix24 (~50 записей)**: `callBitrixMethod` отбрасывал `next`/`total`, общего helper пагинации не было. Подсчёты уже выполнялись в Node.js, но на неполной выборке. Суммы разных валют складывались в одно число. В списках нарушений пользователю часто показывались технические ID стадий. Заглушки бросали exception вместо структурированного `REPORT_NOT_IMPLEMENTED`.

После критических исправлений: единый `fetchAllPages` / `crmItemListAll`, безопасные лимиты списков, группировка сумм по валютам, русские названия стадий в отчётах, sample вместо полных массивов для Claude.

Дополнительно исправлена нормализация фильтров `crm.item.list` (`>=DATE_CREATE` → `>=dateCreate`), иначе Bitrix отклонял периодные отчёты. Отчёт по задачам корректно сообщает об отсутствии прав webhook (`TASKS_ACCESS_DENIED`).

---

## Пагинация Bitrix24

| Вопрос | До исправления | После исправления |
|--------|----------------|-------------------|
| Используется ли `start` | Да, только `start=0` | Да, постранично |
| Используется ли `next` | Нет (терялся в `callBitrixMethod`) | Да, через `callBitrixMethodFull` |
| Загружаются ли все страницы | Нет | Да, в аналитике через `fetchAllPages` |
| Защита от бесконечного цикла | Нет | Да: `next` не меняется → stop; `MAX_PAGES=100` |
| Максимум страниц | Нет | `PAGINATION.MAX_PAGES = 100` |
| Постраничная обработка | Нет | Есть (`fetchPage(start)`) |
| Накопление лишних массивов | Первая страница целиком уходила в Claude в ряде отчётов | Аналитика отдаёт sample ≤100; списки — limit 50 |

Helper: `src/actions/helpers.js` — `fetchAllPages`, `crmItemListAll`, `applyListLimit`, `logAnalytics`.  
Клиент: `src/bitrixClient.js` — `callBitrixMethodFull`.

---

## Аналитические actions

### lead_count_by_stage

| Поле | Значение |
|------|----------|
| Файл | `src/actions/analyticsActions.js` |
| Зарегистрирован | Да |
| Реализован | Да |
| Пагинация | Да (после фикса) |
| Ограничение выборки | Нет для подсчёта; ранее — 1 страница |
| Подсчёт на Node.js | Да |
| Полный массив Claude | Нет (только сводка по стадиям) |
| Русские стадии | Да (`stageName` из `crm.status.list`) |
| Валюты | Н/П |
| Статус | **работает** |
| Рекомендация | Ок |

### deal_count_by_stage

| Поле | Значение |
|------|----------|
| Файл | `src/actions/analyticsActions.js` |
| Зарегистрирован | Да |
| Реализован | Да |
| Пагинация | Да (после фикса) |
| Ограничение | Ранее 50; сейчас все страницы |
| Подсчёт Node.js | Да |
| Полный массив Claude | Нет |
| Русские стадии | Да |
| Валюты | Н/П |
| Статус | **работает** |
| Рекомендация | Ок |

### deal_sum_by_stage

| Поле | Значение |
|------|----------|
| Файл | `src/actions/analyticsActions.js` |
| Зарегистрирован | Да |
| Реализован | Да |
| Пагинация | Да (после фикса) |
| Подсчёт Node.js | Да |
| Полный массив Claude | Нет |
| Русские стадии | Да |
| Валюты | Да, `totalsByCurrency` (после фикса; ранее суммы смешивались) |
| Статус | **работает** |
| Рекомендация | Ок; формат ответа теперь объект `{ byStage, totalsByCurrency }` |

### lead_conversion_report

| Поле | Значение |
|------|----------|
| Файл | `src/actions/analyticsActions.js` |
| Зарегистрирован | Да |
| Реализован | Частично |
| Пагинация | Через `lead_count_by_stage` — да |
| Подсчёт Node.js | Да |
| Полный массив Claude | Нет |
| Русские стадии | Да (через byStage) |
| Валюты | Н/П |
| Статус | **работает частично** |
| Рекомендация | `byStage` — текущее состояние всех лидов, а не историческая конверсия за период; `totalInPeriod` считает период. Нужна отдельная историческая модель. |

### crm_funnel_summary

| Поле | Значение |
|------|----------|
| Файл | `src/actions/analyticsActions.js` |
| Зарегистрирован | Да |
| Реализован | Да |
| Пагинация | Через `deal_sum_by_stage` |
| Подсчёт Node.js | Да |
| Полный массив Claude | Нет (раньше отдавал до 20 сырых activities) |
| Русские стадии | Да |
| Валюты | Да (`totalsByCurrency`) |
| Статус | **работает** |
| Рекомендация | `dealsWithoutNextStep` вынесен в отдельный отчёт |

### overdue_activity_report

| Поле | Значение |
|------|----------|
| Файл | `src/actions/analyticsActions.js` |
| Зарегистрирован | Да |
| Реализован | Да |
| Пагинация | Да (после фикса) |
| Подсчёт Node.js | Да |
| Полный массив Claude | Нет (sample ≤100) |
| Статус | **работает** |
| Рекомендация | Не в quick reports UI; можно добавить карточку |

### overdue_tasks_report

| Поле | Значение |
|------|----------|
| Файл | `src/actions/analyticsActions.js` |
| Зарегистрирован | Да |
| Реализован | Да |
| Пагинация | Да (после фикса) |
| Подсчёт Node.js | Да |
| Полный массив Claude | Нет (sample ≤100) |
| Статус | **работает** |

### deals_without_next_step

| Поле | Значение |
|------|----------|
| Файл | `src/actions/analyticsActions.js` |
| Зарегистрирован | Да |
| Реализован | Да |
| Пагинация | Да; ранее анализ только первых 50 сделок (N+1) |
| Подсчёт Node.js | Да |
| Полный массив Claude | Нет (sample ≤100) |
| Русские стадии | Да (после фикса) |
| Статус | **работает** |
| Рекомендация | Ок; bulk по activities вместо N+1 |

### leads_without_responsible / leads_without_assigned

| Поле | Значение |
|------|----------|
| Файл | `src/actions/analyticsActions.js` |
| Зарегистрирован | Да (оба — дубликаты) |
| Реализован | Да |
| Пагинация | Да (после фикса) |
| Подсчёт Node.js | Да |
| Полный массив Claude | Нет (sample) |
| Русские стадии | Да (`stageName`) |
| Статус | **работает** |
| Рекомендация | Оставить один публичный alias в UI |

### deals_without_activity

| Поле | Значение |
|------|----------|
| Файл | `src/actions/analyticsActions.js` |
| Зарегистрирован | Да |
| Реализован | Да |
| Пагинация | Да; ранее только первые 50 |
| Русские стадии | Да |
| Статус | **работает** |

### new_deals_period / closed_deals_period

| Поле | Значение |
|------|----------|
| Файл | `src/actions/analyticsActions.js` |
| Зарегистрирован | Да |
| Реализован | Да |
| Пагинация | Да (после фикса; count по всем, sample ≤100) |
| Валюты | Да (`totalsByCurrency`) |
| Русские стадии | Да |
| Статус | **работает** |

### manager_workload

| Поле | Значение |
|------|----------|
| Файл | `src/actions/analyticsActions.js` |
| Зарегистрирован | Да |
| Реализован | Нет |
| Статус | **заглушка** |
| Рекомендация | Реализовать группировку сделок/задач по `ASSIGNED_BY_ID` / `RESPONSIBLE_ID` |

### sales_forecast

| Поле | Значение |
|------|----------|
| Файл | `src/actions/analyticsActions.js` |
| Зарегистрирован | Да |
| Реализован | Нет |
| Статус | **зарегистрирован, но не реализован** |
| Рекомендация | Не показывать в UI до реализации |

---

## Быстрые отчёты (`src/reports/quickReports.js`)

| Отчёт | Action | Статус |
|-------|--------|--------|
| Сводка по воронке | `crm_funnel_summary` | работает |
| Сделки по стадиям | `deal_count_by_stage` | работает |
| Сумма сделок по стадиям | `deal_sum_by_stage` | работает |
| Просроченные задачи | `overdue_tasks_report` | работает |
| Сделки без следующего шага | `deals_without_next_step` | работает |
| Лиды без ответственного | `leads_without_assigned` | работает |
| Сделки без активности | `deals_without_activity` | работает |
| Новые сделки за период | `new_deals_period` | работает |
| Закрытые сделки за период | `closed_deals_period` | работает |
| Нагрузка по менеджерам | `manager_workload` | **заглушка** → `REPORT_NOT_IMPLEMENTED` |

---

## Списки (безопасные лимиты)

| Action | До | После |
|--------|----|-------|
| `deal_list` | вся 1-я страница без метаданных hasMore | `returned/total/hasMore`, default limit 50 |
| `lead_list` | то же | то же |
| `contact_list` | то же | то же |
| `company_list` | то же | то же |
| `search_tasks` | сырой ответ Bitrix | нормализованный limit + `tasks`/`hasMore` |
| `activity_list` | сырой массив | `{ items, returned, total, hasMore }` |

Аналитика использует `dealListAll` / `leadListAll` / `activityListAll` / `searchTasksAll`, а не урезанные list-actions.

---

## Передача больших массивов Claude

| Место | До | После |
|-------|----|-------|
| `formatToolResult` в `chatAgent.js` | JSON.stringify всего результата | Без изменений; результаты аналитики уже сжаты |
| `overdue_*` | полный список первой страницы | count + sample ≤100 |
| `deal_list` и др. | до 50 без предупреждения hasMore | явный hasMore |
| Подсчёты через Claude | Не обнаружены: count/sum уже в Node | — |

---

## Технические ID стадий

| Место | До | После |
|-------|----|-------|
| `deal_count_by_stage` / `deal_sum_by_stage` | `stageName` уже был | Без изменений логики имён |
| `deals_without_*`, period reports, leads | в UI/`reportNormalizer` — `stageId` | `stageName` из справочника |
| Карточки deal_get / deal_list | технические STAGE_ID | не критично для этого этапа |

---

## Валюты

| Место | До | После |
|-------|----|-------|
| `deal_sum_by_stage` | одно `sum` | `totalsByCurrency` + per-stage |
| `crm_funnel_summary` | `totalSum` смешанный | `totalsByCurrency`, `totalSum: null` |
| period reports | смешанный `totalSum` | `totalsByCurrency` |
| `reportNormalizer` | всегда «руб.» | суммы с кодом валюты |

---

## Дубликаты

| Пара | Комментарий |
|------|-------------|
| `leads_without_responsible` / `leads_without_assigned` | Один код, два имени; alias намеренный |
| `crm_funnel_summary` vs `deal_count/sum_by_stage` | Сводка агрегирует sum; не дубль, а композиция |
| `overdue_activity_report` vs `overdue_tasks_report` | Разные сущности (дела CRM vs задачи) |

---

## Логирование

Формат:

```text
[Analytics] action=deal_count_by_stage pages=4 items=182 durationMs=830 truncated=false
```

Не логируются webhook, ключи, ФИО, телефоны, email, переписки, полные карточки.

---

## Критические исправления этого этапа

1. `callBitrixMethodFull` + `fetchAllPages` / `crmItemListAll`.
2. Аналитика обходит все страницы.
3. Безопасные лимиты list-actions.
4. `totalsByCurrency` вместо смешения валют.
5. Русские названия стадий в list-отчётах.
6. Sample вместо полных массивов нарушений.
7. Заглушки → `{ success: false, error: { code: "REPORT_NOT_IMPLEMENTED" } }`.
8. `scripts/test-analytics.js` (read-only).

---

## Следующий этап (рекомендации)

1. Реализовать `manager_workload`.
2. Историческая конверсия лидов (не snapshot).
3. Batch Bitrix для ускорения activity-отчётов на больших порталах.
4. Опционально: стриминговая агрегация без накопления всех items в памяти.
5. Не трогать chat history / SQLite / провайдеры на следующем шаге аналитики.
