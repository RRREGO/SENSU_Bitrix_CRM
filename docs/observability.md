# Observability (pilot)

Структурированные логи, метрики, readiness, журнал ошибок.

## Логи

- `LOG_LEVEL` — debug|info|warn|error (по умолчанию info)
- `LOG_FORMAT` — json в production, text в dev
- `LOG_TO_FILE=true` + `APP_LOG_DIR` — JSON Lines в `app.jsonl`
- В production предпочтителен **journald** (`journalctl -u bitrix-crm-assistant`)
- Ротация: `deploy/logrotate/bitrix-crm-assistant` (опционально)

Секреты маскируются (`redact.js`, ключи password/token/… → `[REDACTED]`).

## Метрики

`GET /admin/system/metrics` — HTTP, Bitrix, LLM, safety, scheduler, communications, database (session + `settings.view` + `audit.view`).

In-memory счётчики + SQLite aggregates. Без webhook URL и API keys.

Блок **communications** в health/metrics: `enabled`, `sendEnabled`, `dryRun`, `configured`, очередь outbox (`pending` / `failed`), `lastSuccessfulCheckAt` (из `app_settings`, без секретов).

## Readiness

- `GET /health` — liveness (`{ ok: true }`)
- `GET /health/readiness` — migrations ≥ 9, DB, policies, production config
- Bitrix/LLM — soft warning, не блокируют readiness по умолчанию

## Журнал ошибок

Таблица `application_errors` (миграция v9). API:

- `GET /admin/errors`
- `GET /admin/errors/:id`
- `POST /admin/errors/:id/resolve`

## UI

Вкладка **Система** — статус, метрики, ошибки (без секретов).

## Request ID

Middleware `requestContextMiddleware` — заголовок `X-Request-Id` в ответах.

См. [incident-response.md](./incident-response.md), runbooks в `docs/runbooks/`.
