# Аудит отчётов для плановых сводок

Дата: 2026-07-14

## Метод

Код `quickReports.js`, `analyticsActions`, `contactAnalyticsActions`, `managerAnalyticsActions`, пагинация helpers.  
Среднее время — оценка по страницам REST (зависит от объёма портала).

| Статус | Значение |
|--------|----------|
| yes | Пригоден как есть (read-only action) |
| partial | Нужен wrapper / обработка ошибок scope |
| no | Не для автозапуска без доработки |

## Сводка

| Отчёт / action | Auto | Read-only | Params | ~time | Bitrix errors | Partial | Daily | Weekly |
|----------------|------|-----------|--------|-------|---------------|---------|-------|--------|
| `crm_funnel_summary` / funnel_summary | yes | yes | categoryId | 5–30s | retryable network | warnings in helper | yes | yes |
| `deal_count_by_stage` | yes | yes | categoryId | 5–40s | pages truncate | yes | yes | yes |
| `deal_sum_by_stage` | yes | yes | categoryId | 5–40s | currency split OK | yes | yes | yes |
| `overdue_tasks_report` | partial | yes | — | 3–20s | TASKS scope | partial | yes | yes |
| `deals_without_next_step` | yes | yes | categoryId? | 10–60s | pages | yes | yes | yes |
| `leads_without_assigned` | yes | yes | — | 5–30s | — | yes | yes | yes |
| `deals_without_activity` | yes | yes | days | 10–60s | — | yes | warning | yes |
| `new_deals_period` | yes | yes | dateFrom/To | 5–40s | — | yes | no* | yes |
| `closed_deals_period` | yes | yes | dateFrom/To | 5–40s | — | yes | no* | yes |
| **`manager_workload`** | yes | yes | categoryId? | 20–120s | tasks/activities | **yes** | **yes (core)** | **yes** |
| **`crm_discipline_report`** | yes | yes | wraps workload | =workload | same | yes | **yes** | **yes** |
| `leads_without_next_activity` | yes | yes | — | 10–60s | — | yes | yes | yes |
| `stale_leads_report` | yes | yes | days | 10–60s | — | yes | warning | yes |
| `stale_deals_report` | yes | yes | days | 10–60s | — | yes | warning | yes |
| `overdue_activities_by_manager` | yes | yes | — | 10–60s | activities scope | yes | yes | yes |
| `contact_quality_report` | yes | yes | methodology env | 15–90s | UF config | yes | yes | yes |
| `contacts_without_status` | yes | yes | status field | 10–60s | config | yes | yes | yes |
| `contacts_cycle_without_next_activity` | yes | yes | — | 15–90s | — | yes | yes | yes |
| `contacts_birthday_activity_report` | yes | yes | daysAhead | 10–60s | — | yes | **yes** | optional |
| `contact_count_by_status` | yes | yes | — | 10–60s | — | yes | optional | yes |
| Stage history movement | **no** | n/a | — | — | not integrated | — | no | no (не выдумывать) |

\* Для daily brief период = «сегодня»; new/closed обычно в weekly.

## Рекомендация для presets

1. **daily_director_brief** — один вызов `crm_discipline_report` (+ birthday report), без повторного `manager_workload`.
2. **weekly_sales_summary** — `crm_discipline_report` + new/closed deals за 7 дней + stale; diff с прошлым run в Node.
3. **crm_discipline** — `crm_discipline_report` напрямую.
4. **birthday_control** — `contacts_birthday_activity_report`.

Все перечисленные actions — **read-only**, не создают задач/дел/стадий.
