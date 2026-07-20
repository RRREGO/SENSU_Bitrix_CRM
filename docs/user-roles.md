# Роли и permissions

Системные роли: `administrator`, `director`, `manager`, `analyst`, `viewer`.

Проверка только через `authorizationService` / `requirePermission`, не через строку роли в endpoint.

| Permission | Назначение |
|------------|------------|
| `crm.read.all` / `crm.read.own` | CRM данные |
| `crm.context.read` | Client Context |
| `analytics.run` / `reports.*` / `schedules.*` | аналитика и плановые отчёты |
| `operations.prepare` / `confirm.own` / `confirm.any` / `rollback` | Safety |
| `communications.draft` / `send` / `view.*` | сообщения |
| `users.manage` / `roles.manage` | админ пользователей |
| `audit.view` / `settings.*` | audit и настройки |

## Data scope

`data_scope=own` → фильтр `ASSIGNED_BY_ID = bitrix_user_id`. Без mapping → `BITRIX_USER_MAPPING_REQUIRED`.

## Safety identity

Prepare сохраняет `initiated_by_user_id` и preview.initiatedBy. Commit — `confirmed_by_user_id`. Rollback — `rolled_back_by_user_id`.

## Go-Live data scope

При `data_scope=own` сервер **не доверяет** client filter: `applyEntityListScope` снимает override `ASSIGNED_BY_ID` и выставляет mapping Bitrix. Аудит: [data-scope-audit](../reports/data-scope-audit.md).
