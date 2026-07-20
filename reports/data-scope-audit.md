# Data scope audit

Дата: go-live security closure.

## Стратегии

| Scope | Условие | Поведение |
|-------|---------|-----------|
| `all` | `data_scope=all` или `crm.read.all` | Фильтр не навязывается |
| `own` | manager без `crm.read.all` | `ASSIGNED_BY_ID = bitrix_user_id` |
| synthetic | `local_only` principal | scope не применяется (dev) |

## Серверные гарантии

### `applyEntityListScope`

- Удаляет client override: `ASSIGNED_BY_ID`, `assignedById`, `responsibleId`, `!ASSIGNED_BY_ID`, …
- Принудительно выставляет `ASSIGNED_BY_ID` из mapping пользователя
- Без `bitrix_user_id` → `BITRIX_USER_MAPPING_REQUIRED`

### `restrictResponsibleIds`

- Пустой список → `[bitrixUserId]`
- Чужой id → `RESOURCE_ACCESS_DENIED`

### `applyActionDataScope`

- `DIRECT_GET_ACTIONS` — authorize read по assignee
- `LIST_SCOPE_ACTIONS` / `*_report` / `*_list` — фильтр + responsibleIds
- `BLOCKED_FOR_OWN_ANALYTICS` — зарезервировано для portal-wide aggregates

## Workspace search

`searchWorkspace` фильтрует FTS/LIKE результаты по `owner_user_id` / `project_members` до отдачи snippet.

## Заблокированные действия

Политики Safety + permissions; manager не имеет `operations.confirm.any`, `users.manage`, `crm.read.all`.

## Проверка

`npm run test:go-live` — assertions 4–6, 14; `npm run test:access` — manager scope regressions.
