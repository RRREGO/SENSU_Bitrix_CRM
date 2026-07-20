# Безопасная одиночная отправка сообщений

Поток:

```text
черновик → resolve → policy → duplicate guard → prepare → preview → confirm → commit → verify?
```

## Черновик

```http
POST /message-drafts
GET  /message-drafts/:id
PATCH /message-drafts/:id
POST /message-drafts/:id/cancel
POST /message-drafts/:id/send/prepare
```

Текст хранится в `message_drafts`. В `outbound_messages` — только `body_hash`, без дубля текста.

## Получатель

Сервер резолвит контакт / userId. При нескольких номерах/email:

`MESSAGE_RECIPIENT_AMBIGUOUS` + маскированные options (`+7 *** *** 12 34`, `e***@company.kz`).

## Блокирующие статусы

Спам / Не трогать / Личный без `allowPersonal` + `personalCommunicationReason`.

## Safety: `client_message_send`

- risk: **high**, `reversible: false`, `bulk: false`
- External (WhatsApp/Telegram/email/OL): подтверждающая фраза `ОТПРАВИТЬ СООБЩЕНИЕ <ИМЯ>` (сервер формирует в preview; клиентская фраза до prepare игнорируется)
- Internal bitrix_chat: обычное подтверждение; в preview явно «Внутренний чат»
- UI: «Откат невозможен после отправки.» — без кнопки Rollback

Commit **не** принимает новые body/channel/recipient — только `confirmationId` (+ phrase).

## Go-Live

- `COMMUNICATION_SEND_ENABLED=true` в production требует свежий live smoke (`communication_live_test_passed_at`, срок `COMMUNICATION_LIVE_TEST_MAX_AGE_DAYS`)
- `COMMUNICATION_ALLOW_UNVERIFIED_SEND_DEV` запрещён в production
- Проверка: `npm run test:go-live` assertion 9, `npm run check:go-live`

## Идемпотентность

Уникальный индекс `(draft_id, operation_id)`. Повторный commit возвращает тот же результат. После `MESSAGE_SEND_RESULT_UNKNOWN` / `verification_required` — **без** авто-retry.

## Duplicate guard

Одинаковый `body_hash` + контакт + канал в окне `MESSAGE_DUPLICATE_WINDOW_MINUTES` (по умолчанию 10). Обход: новый prepare с `forceDuplicateReason` → audit.

## Доставка

```http
GET  /outbound-messages
GET  /outbound-messages/:id
POST /outbound-messages/:id/verify   # read-only
POST /communication-events/:channel # только с COMMUNICATION_WEBHOOK_TOKEN
```

`delivered` только если API/webhook подтвердил доставку, не факт приёма запроса.

## Access control

Отправка и drafts требуют серверной сессии и permissions `communications.*`. Kill switch: `COMMUNICATION_SEND_ENABLED`. См. [access-control.md](./access-control.md).

`scripts/smoke-test-communication-live.js` — выключен по умолчанию; требует draftId, channel, phrase и `COMMUNICATION_LIVE_TEST_ENABLED=true`. В основной suite не входит.

## Communications Hub

Legacy «Исходящие» (`client_message_send`) и **Communications Hub** (Wazzup / кампании / sequences) сосуществуют: разные таблицы и флаги (`COMMUNICATIONS_*`). Hub по умолчанию в dry-run и не шлёт через Bitrix-адаптеры этого документа. См. [communications.md](./communications.md).
