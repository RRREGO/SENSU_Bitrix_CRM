# Go-Live Security

Закрытие этапа безопасности перед публикацией: маршруты, CSRF, data scope, production validator, уведомления, backup/restore.

## Миграция v9 (pilot)

`v9_pilot_operations` — журнал `application_errors`, `release_id` на operations/report_runs. Observability: [observability.md](./observability.md), [deployment.md](./deployment.md).

## Миграция v8

`v8_go_live_security` — поля scope/audience для плановых отчётов (`report_schedules.scope_type`, `scope_user_id`, `audience_json`).

## Проверки

```bash
npm run test:go-live      # 29 assertions, tmp SQLite
npm run check:go-live     # getGoLiveReadiness (без секретов)
npm run db:restore-drill  # backup → restore → integrity_check
```

## Production validator

При `APP_ENV=production` блокирует старт, если:

- `APP_ACCESS_MODE !== authenticated` или `local_only`
- `AUTH_COOKIE_SECURE=false`
- `APP_ALLOWED_ORIGINS` без HTTPS (кроме localhost)
- `COMMUNICATION_SEND_ENABLED=true` без свежего live smoke (`communication_live_test_passed_at`)
- insecure TLS / `LLM_LOG_PAYLOADS` / bulk actions
- второй instance на той же SQLite (`application_instance_lock`)

`GET /admin/go-live-readiness` — сводка для администратора (`settings.view` + `audit.view`).

## Frontend CSRF

Все write-запросы UI идут через `public/apiClient.js` с `X-CSRF-Token`. Сырой `fetch(` в `public/js/*` запрещён.

## Data scope

`data_scope=own` → сервер принудительно выставляет `ASSIGNED_BY_ID` и отклоняет чужие `responsibleIds`. См. [data-scope-audit](../reports/data-scope-audit.md).

## Связанные документы

- [go-live-checklist.md](./go-live-checklist.md)
- [access-control.md](./access-control.md)
- [session-security.md](./session-security.md)
- [production-checklist.md](./production-checklist.md)
- [pilot-checklist.md](./pilot-checklist.md)
