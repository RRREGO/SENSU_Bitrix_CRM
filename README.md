# bitrix-claude-local-bridge

Локальный Node.js-мост между Bitrix24 REST API и Claude: CRM-чат, read-only аналитика, Client Context, протоколы встреч, плановые сводки и Safety Layer для всех изменений CRM.

Сервер **не** изменяет Bitrix24 без явного подтверждения (prepare → preview → confirmationId → commit).

Краткий обзор UI и разделов: [docs/app-overview.md](docs/app-overview.md).

## Требования

- Node.js 20+
- Bitrix24 входящий webhook (CRM; Tasks — для задач/manager_workload)
- API-ключ Anthropic (Claude)

## Структура проекта

```text
bitrix-claude-local-bridge/
  package.json
  server.js
  .env.example
  README.md
  docs/                  # тематическая документация
  reports/               # аудиты и HTML-экспорт
  scripts/               # тесты
  data/                  # SQLite (одна БД)
  public/                # UI
  src/
    actions/             # Bitrix REST actions
    safety/              # prepare/commit/policies/recovery
    database/            # миграции v1–v5, repositories
    reports/             # quick reports, normalizer
    scheduler/           # плановые сводки, алерты, уведомления
    workspace/           # чаты, проекты, профиль
    clientContext/       # CRM-контекст, протоколы, черновики
    communications/      # Hub (Wazzup/campaigns/sequences) + legacy outbound
    documents/
    llm/
    bitrix/
```

Актуальная миграция: **v11** (`v11_communications_certification`) поверх v1–v10. По умолчанию `APP_ACCESS_MODE=local_only`. Документация: [docs/access-control.md](docs/access-control.md), [docs/user-roles.md](docs/user-roles.md), [docs/session-security.md](docs/session-security.md), [docs/go-live-security.md](docs/go-live-security.md), [docs/deployment.md](docs/deployment.md) (pilot), [docs/communications.md](docs/communications.md) (Hub), [docs/communications-certification.md](docs/communications-certification.md).

## Быстрый старт

```bash
copy .env.example .env
npm install
npm run dev
```

Откройте http://localhost:3005

Переменные методологии контактов, timezone, scheduler и messaging — в `.env.example`. Документация: [docs/contact-analytics.md](docs/contact-analytics.md), [docs/manager-analytics.md](docs/manager-analytics.md), [docs/client-context.md](docs/client-context.md), [docs/meeting-workflow.md](docs/meeting-workflow.md), [docs/scheduled-reports.md](docs/scheduled-reports.md), [docs/notification-center.md](docs/notification-center.md), [docs/communication-channels.md](docs/communication-channels.md), [docs/safe-outbound-messaging.md](docs/safe-outbound-messaging.md), [docs/communications.md](docs/communications.md).

## Safety Layer

Изменяющие actions: `prepare → preview → confirmation → commit → audit` (SQLite).

- Write REST только внутри safety executor (`WRITE_CALL_OUTSIDE_SAFETY_EXECUTOR` при обходе).
- Структурные и опасные actions заблокированы политиками.
- Параметр `confirm: true` **не** выполняет write: всегда сначала prepare и `confirmationId`.
- Документация: [docs/action-safety.md](docs/action-safety.md).

### Анализ сделки (read-only)

```bash
curl -X POST http://localhost:3005/bitrix/deal/123/analyze
```

Только чтение: Claude-анализ, **без** записи в таймлайн (`savedToTimeline: false`).

### Сохранение анализа в CRM

```text
POST /bitrix/deal/:id/analyze/save/prepare
  → timeline_comment_add (prepare)
  → preview + confirmationId
  → POST /bitrix/action { confirmationId }  или  /chat/confirm
  → commit
```

Исходящий webhook (`/bitrix/event`) не пишет в CRM автоматически.

### Пример write через Safety

```powershell
# 1) prepare (ничего не меняет в Bitrix)
Invoke-RestMethod -Method POST -Uri http://localhost:3005/bitrix/action `
  -ContentType "application/json" `
  -Body '{"action":"create_task","params":{"title":"Позвонить","responsibleId":1}}'

# 2) commit по confirmationId из ответа prepare
Invoke-RestMethod -Method POST -Uri http://localhost:3005/bitrix/action `
  -ContentType "application/json" `
  -Body '{"confirmationId":"<id-из-prepare>"}'
```

## Аналитика и отчёты

- Быстрые отчёты UI и `GET/POST /reports/quick…`
- `manager_workload` и `crm_discipline_report` **реализованы** (не заглушки)
- Contact analytics: статус, цикл, ДР и т.д.
- Плановые сводки: [docs/scheduled-reports.md](docs/scheduled-reports.md)

## Client Context и Meeting Workflow

Чат с CRM-привязкой, `crm_context_get` / summary, транскрипты, протоколы (сохранение только через Safety), черновики сообщений.

Вкладки UI: Чат, Проекты, Протоколы, Отчёты, **Уведомления**, **Хаб** (Communications Hub), Расписания (в настройках/отчётах), Документы, История, Настройки.

## Workspace Persistence

Чаты, проекты, профиль и поиск — в той же SQLite (`APP_DATABASE_PATH`). См. [docs/workspace-persistence.md](docs/workspace-persistence.md).

## Production Hardening

Recovery pending operations после рестарта, Bitrix read-retry, динамический каталог actions, безопасный LLM proxy. См. [docs/production-hardening.md](docs/production-hardening.md).

## Health

```bash
curl http://localhost:3005/health
```

Ожидается `migrationVersion` ≥ 5, блоки `safety`, `workspace`, `scheduler`, `notifications`, `recovery` (без URL webhook и секретов).

## Основные API

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/health` | Диагностика |
| POST | `/chat`, `/chat/confirm`, `/chat/reset` | Чат + confirm Safety |
| GET | `/bitrix/deal/:id` | Сделка (read) |
| POST | `/bitrix/deal/:id/analyze` | Анализ Claude (**только read**) |
| POST | `/bitrix/deal/:id/analyze/save/prepare` | Prepare записи анализа |
| POST | `/bitrix/action` | Read сразу; write → prepare; commit по `confirmationId` |
| POST | `/bitrix/event` | Исходящий webhook без auto-write |
| GET/POST | `/reports/quick…` | Быстрые отчёты |
| | `/crm/context…`, `/meeting-*` | Client Context / протоколы |
| | `/scheduled-reports…`, `/notifications…` | Плановые сводки и уведомления |
| | `/operations…` | Audit / cancel / rollback prepare |

Полный каталог actions: `GET /bitrix/actions`.

## Pilot deployment

Развёртывание на VPS (systemd, nginx, backup timer):

```bash
npm run test:pilot          # pilot operations (~54 assertions)
npm run test:communications
npm run test:communications:certification   # v11 certification suite (mock)
# Live only when enabled:
# COMMUNICATION_LIVE_CERTIFY=true npm run certify:communications -- --confirm ...
npm run smoke:production    # только с PRODUCTION_SMOKE_TESTS_ENABLED=true
npm run db:backup-retention
```

Документация: [docs/deployment.md](docs/deployment.md), [docs/pilot-checklist.md](docs/pilot-checklist.md), [docs/observability.md](docs/observability.md), [reports/deployment-readiness-audit.md](reports/deployment-readiness-audit.md).

## Тесты

```bash
npm run test:analytics
npm run test:contacts
npm run test:managers
npm run test:safety
npm run test:safety:hardening
npm run test:workspace
npm run test:access
npm run test:go-live
npm run test:pilot
npm run test:communications
npm run test:communications:certification
npm run check:go-live
npm run smoke:production
npm run test:production
npm run test:client-context
npm run test:schedules
npm run db:backup
npm run db:check-backup
npm run db:backup-retention
npm run db:restore-drill
```

Go-Live: [docs/go-live-checklist.md](docs/go-live-checklist.md). Pilot: [docs/pilot-checklist.md](docs/pilot-checklist.md). Аудиты: `reports/frontend-csrf-audit.md`, `reports/route-access-policy-audit.md`, `reports/data-scope-audit.md`, `reports/deployment-readiness-audit.md`.

Live Bitrix flake (`test:contacts` / `test:managers`) отличается от ошибки приложения: soft-skip допустим при сетевых сбоях портала.

## Безопасность

- Секреты только в `.env` (в `.gitignore`)
- Не логировать webhook URL, API keys, execution token, полные телефоны/email
- Плановые отчёты — только read-only, без отправки в Telegram/WhatsApp/email на этом этапе
