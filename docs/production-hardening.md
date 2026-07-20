# Production Hardening

Инфраструктурные улучшения перед работой с реальной клиентской перепиской.

## Pending operations после рестарта

При старте сервера вызывается `recoverOperationsOnStartup()`:

| Было | Действие |
|------|----------|
| `pending_confirmation` (TTL жив) | Остаётся доступной для commit/cancel |
| `pending_confirmation` (TTL истёк) | → `expired` + событие `expired_after_restart` |
| `executing` | → `recovery_required` (без авто-retry write) |
| `partially_completed` | Остаётся для ручной проверки |

Commit после рестарта идёт по SQLite operation plan. Старый Claude `tool_use` не требуется. В чат добавляется системное сообщение.

API:

- `GET /operations/pending`
- `POST /operations/:id/recover` — анализ без изменения CRM

Миграция `v3_production_hardening` добавляет в `operations`: `chat_id`, `message_id`, `project_id`.

Связанные этапы: [workspace-persistence.md](./workspace-persistence.md), [client-context.md](./client-context.md), [scheduled-reports.md](./scheduled-reports.md).

Планировщик отчётов использует ту же SQLite (миграция `v5_scheduled_reports`), lease-locks и recovery `running` → `failed` без автоповтора write/read CRM.

## Communications Hub

Флаги `COMMUNICATIONS_ENABLED` / `COMMUNICATIONS_SEND_ENABLED` / `COMMUNICATIONS_DRY_RUN` — отдельные kill switches поверх legacy messaging. После апгрейда до v10 отправка Wazzup не включается сама. См. [communications.md](./communications.md).

## Bitrix REST retry

Read (`callReadMethod`): exponential backoff + jitter + AbortController.

```env
BITRIX_READ_RETRY_ATTEMPTS=3
BITRIX_READ_RETRY_BASE_DELAY_MS=500
BITRIX_READ_TIMEOUT_MS=30000
```

Повторы: network, timeout, 429, 502/503/504, empty/invalid JSON.  
Не повторяются: access denied, scope, invalid parameter, not found.

Write (`callWriteMethod`): без слепого retry. При network error после отправки → `WRITE_RESULT_UNKNOWN` / `verification_required`.

## Read-back verification

После успешного write по возможности выполняется read-back (`verifyWriteResult`). Результат сохраняется в `result.verification`.

## Динамический каталог actions

Полный каталог (~111 actions) не отправляется целиком. `selectRelevantActions(message)` подбирает релевантные + discovery. Fallback: `action=__discover_actions`.

```env
SYSTEM_PROMPT_MAX_CHARS=60000
ACTION_CATALOG_MAX_CHARS=20000
```

Порядок урезания: каталог/файлы/история; Safety и профиль сохраняются.

## LLM transport

```env
LLM_PROXY_MODE=none|corporate|self_hosted
LLM_PROXY_URL=
LLM_PROXY_USERNAME=
LLM_PROXY_PASSWORD=
LLM_PROXY_CA_CERT_PATH=
LLM_PROXY_ALLOW_INSECURE_TLS=false
LLM_LOG_PAYLOADS=false
```

Секреты только в `.env`. Insecure TLS запрещён вне dev-флага.  
`POST /settings/llm-transport/test` — проверка без password из frontend.

См. [secure-llm-transport.md](./secure-llm-transport.md), [production-checklist.md](./production-checklist.md).

## Минимизация данных

`sanitizeLlmPayload(payload, purpose)` — allowlist по режимам analytics / entity_summary / operation_result / …

## Health

Добавлены блоки `bitrix`, `llmTransport`, `context.dynamicActionCatalog`, `recovery` без URL/секретов.

## Тесты

```bash
npm run test:production
```
