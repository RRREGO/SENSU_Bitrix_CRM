# Безопасное выполнение изменяющих действий (Safety Layer)

Документ описывает центральный слой:

```text
prepare → preview → confirmation → commit → audit → optional rollback
```

Промпт Claude **не** является механизмом безопасности. Защита применяется ко всем источникам: `/chat`, `/chat/confirm`, `/bitrix/action`, отчёты, внутренние вызовы.

## Модель угроз

| Угроза | Защита |
|--------|--------|
| Случайное/массовое изменение CRM | Prepare + preview + confirmationId |
| Обход через прямой API | `/bitrix/action` всегда через executor |
| `confirm: true` без плана | Отклоняется |
| Повторный commit | Идемпотентность по статусу + SQLite |
| Изменение данных между preview и commit | Optimistic locking |
| Затирание чужих правок при откате | Rollback conflict |
| Утечка секретов в журнал | Redaction перед записью в SQLite |
| Структурные разрушения | Политика `blocked` |

## Политики actions

Источник: `src/safety/policies.js`.

Каждый action имеет явную политику:

- `access`: `read` | `write` | `destructive` | `structural`
- `risk`: `low` | `medium` | `high` | `critical`
- `requiresConfirmation`
- `supportsPreview`
- `reversible`: `true` | `conditional` | `false`
- `bulk`
- `blocked` (немедленный запрет)

Без политики действие **блокируется** (`unsafe_missing_policy`).

Полный аудит: `reports/write-actions-safety-audit.md`.

## SQLite

Путь по умолчанию: `data/operations.sqlite` (в `.gitignore`).

При открытии:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

Миграции — `src/database/migrations.js`, применяются автоматически при старте сервера.

### Таблицы

- `schema_migrations`
- `operations` — plan, preview, before/after, hash, статусы
- `operation_items` — поэлементный журнал
- `operation_events` — append-only события

История чатов и проекты в БД **пока не** хранятся, но схема расширяема.

## Prepare / Commit

```js
prepareAction(action, params, context)
commitAction(confirmationId, context)
cancelAction(confirmationId, context)
```

**Prepare** читает текущее состояние CRM, строит preview и plan hash, сохраняет operation. Bitrix24 **не изменяется**.

**Commit** принимает только `confirmationId` (и при необходимости `confirmationPhrase` для внешних сообщений). Новые params игнорируются. Перед записью:

1. срок действия;
2. статус;
3. plan hash;
4. подтверждающая фраза (если задана в plan/preview для `client_message_send`);
5. повторная проверка before (optimistic lock);
6. выполнение сохранённого `__execPlan`;
7. audit events.

`client_message_send`: risk **high**, irreversible; rollback после отправки не предлагается. Подробнее: [safe-outbound-messaging.md](./safe-outbound-messaging.md).

Prepare сохраняет identity сессии (`initiated_by_user_id`). Commit/confirm проверяет `operations.confirm.own|any`. См. [access-control.md](./access-control.md) и [user-roles.md](./user-roles.md).

## Plan hash

SHA-256 от нормализованных: action, params, entity IDs, before, after, affectedCount.

При повреждении плана: `OPERATION_PLAN_INVALID`.

## Optimistic locking

Если поля из `before` изменились в CRM после preview: `OPERATION_STATE_CHANGED`.

## Идемпотентность

Уникальный `confirmation_id`, переход статуса `pending_confirmation → executing` атомарно. Повторный commit возвращает сохранённый результат без повторной записи в Bitrix24.

## Rollback

```js
prepareRollback(operationId, context)
commitRollback(confirmationId, context)
```

Откат тоже через preview + confirmation.

Поддерживается:

- восстановление изменённых полей (не полный snapshot);
- стадия / воронка / ответственный через `deal_update` и аналоги;
- условный откат создания (если сущность не менялась дальше).

Не поддерживается: удаление воронок/стадий, структурные изменения.

Конфликт: `ROLLBACK_CONFLICT`.

## Bulk

```env
BITRIX_BULK_ACTIONS_ENABLED=false
BITRIX_BULK_MAX_ITEMS=20
BITRIX_BULK_CHUNK_SIZE=10
BITRIX_CONFIRMATION_TTL_MINUTES=15
BITRIX_ROLLBACK_TTL_HOURS=24
```

По умолчанию bulk выключен. При включении требуется фраза вида:

```text
ПОДТВЕРЖДАЮ ИЗМЕНЕНИЕ 20 СДЕЛОК
```

## Заблокированные действия

- удаление воронок и стадий;
- структурные изменения CRM (создание/переименование воронок, UF-поля);
- массовые переносы и bulk-update (пока политика `blocked` / bulk off);
- actions без политики.

## Endpoints

| Method | Path | Назначение |
|--------|------|------------|
| POST | `/bitrix/action` | read сразу; write → prepare; commit по `confirmationId` |
| POST | `/bitrix/deal/:id/analyze` | **только чтение**: Claude-анализ, без записи в CRM |
| POST | `/bitrix/deal/:id/analyze/save/prepare` | prepare `timeline_comment_add` через executor |
| POST | `/bitrix/event` | исходящий webhook: **без auto-write**, recommendation |
| POST | `/chat` / `/chat/confirm` | Claude → prepare → UI confirm → commit |
| GET | `/operations` | список (краткое представление) |
| GET | `/operations/pending` | pending / recovery после рестарта |
| GET | `/operations/:id` | детали before/after без секретов |
| POST | `/operations/:id/recover` | анализ interrupted operation (без write) |
| POST | `/operations/:id/cancel` | отмена pending |
| POST | `/operations/:id/rollback/prepare` | prepare отката |
| POST | `/operations/rollback/commit` | commit отката |
| GET | `/health` | БД + safety + recovery + LLM transport (без секретов) |

После рестарта сервера `recoverOperationsOnStartup()` истекает TTL pending и помечает interrupted `executing` как `recovery_required` без авто-retry. Commit продолжается по SQLite plan без runtime tool_use. Подробнее: [production-hardening.md](./production-hardening.md).

## Запрет прямых write-вызовов

`src/bitrixClient.js` разделяет:

- `callReadMethod` — без контекста;
- `callWriteMethod` — только внутри `runWithSafetyContext`.

Классификация методов: `src/safety/writeMethods.js` (паттерны + явные списки).  
Неизвестный метод = потенциальный write → блокировка без контекста.

Код ошибки: `WRITE_CALL_OUTSIDE_SAFETY_EXECUTOR`.

Аудит call sites: `reports/direct-write-calls-audit.md`.

## Execution context / token

При commit executor создаёт контекст:

```js
{ operationId, confirmationId, action, source, executionToken }
```

`executionToken`:

- генерируется сервером (`crypto.randomBytes`);
- живёт только в AsyncLocalStorage на время commit;
- **не** принимается из JSON клиента (`stripClientExecutionToken`);
- передача `executionToken` в options `callBitrixMethod` отклоняется.

## Analyze и webhook

1. `POST /bitrix/deal/:id/analyze` — read-only (`savedToTimeline: false`).
2. Сохранение: `.../analyze/save/prepare` или `/bitrix/action` с `timeline_comment_add` → confirm → commit.
3. `POST /bitrix/event` не пишет в CRM; возвращает `WEBHOOK_WRITE_BLOCKED` и recommendation.

## Live smoke-test

```bash
BITRIX_LIVE_SAFETY_TEST_ENABLED=true node scripts/smoke-test-safety-live.js --entity deal --id 123 --field COMMENTS
```

Опционально: `--test-conflict` (ручное изменение поля → `OPERATION_STATE_CHANGED`).

Только allowlist полей (`COMMENTS` и т.п.). Без стадий, ответственных, сумм, create/delete/bulk.

## Backup SQLite

```bash
npm run db:backup
npm run db:check-backup
```

Backup использует better-sqlite3 `db.backup()` (учитывает WAL), файлы в `backups/` (в `.gitignore`).

Проверка: `PRAGMA integrity_check`, мигра version, counts.

## Минимизация данных

В SQLite не сохраняются телефоны, email, webhook URL, API keys, полные карточки и таймлайны без необходимости. Перед записью — `redactObject`.

## Тесты

```bash
npm run test:safety
npm run test:safety:hardening
```

Моки, без изменения рабочих данных Bitrix24.

Регрессия аналитики:

```bash
npm run test:analytics
npm run test:contacts
npm run test:managers
```

## Восстановление после ошибки

1. `GET /operations?status=failed` — найти операцию.
2. При `OPERATION_STATE_CHANGED` — сформировать plan заново (новый prepare).
3. При `partially_completed` — смотреть `operation_items`.
4. Откат: `rollback/prepare` → подтверждение → `rollback/commit`.
5. `npm run db:backup` / `db:check-backup` для снимка журнала операций.
6. `GET /health` — journalMode, migrationVersion, blockedActions.