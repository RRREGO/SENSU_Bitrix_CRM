# Client Context

Нормализованный контекст CRM-сущности (контакт / лид / сделка / компания) для чата и Meeting Workflow.

См. также: [meeting-workflow.md](./meeting-workflow.md), аудит источников: `reports/client-context-audit.md`.

## Actions

| Action | Назначение |
|--------|------------|
| `crm_context_get` | Нормализованная карточка + timeline (без сырого REST JSON) |
| `crm_context_summary` | Управленческая сводка с provenance |
| `recommend_next_client_action` | Варианты следующего шага (не автовыполнение) |
| `client_message_draft` | Черновик WhatsApp / Telegram / email / текст (текст; без отправки) |

Персистентные drafts и безопасная отправка — [safe-outbound-messaging.md](./safe-outbound-messaging.md) (`POST /message-drafts`, action `client_message_send`).

## API

```text
GET  /crm/context/:entityType/:entityId
POST /crm/context/summary
POST /client-message/draft
POST /client-next-action/recommend
```

Query/body: `include`, `mode` (`compact` | `standard` | `full`), `dateFrom`/`dateTo`, `limits`.

## Источники

**Доступны:** поля карточки (allowlist), связи contact/company, CRM-дела (`crm.activity.list`), комментарии таймлайна, задачи (если scope).

**Частично:** email/звонки как типы дел, UF методологии.

**Недоступны в приложении:** open lines, тела WhatsApp/Telegram, расшифровки звонков, disk-документы CRM, `crm.stagehistory.list`.

При недоступном источнике ответ `partial: true` + `warnings` (карточка не отбрасывается).

## Нормализация и PII

Телефоны, email, ИИН, банковские реквизиты **не** входят в стандартный контекст.  
Контактные данные — только для адресного черновика сообщения (и с проверкой статуса).

Режимы timeline: `compact` / `standard` / `full`. Системный шум (bizproc/workflow) отфильтровывается; события дедуплицируются.

## Provenance

Важные выводы summary содержат `source: { type, id, occurredAt, url? }`.  
Отсутствие события при `COMMUNICATIONS_SOURCE_UNAVAILABLE` **не** доказывает отсутствие коммуникации.

## Чат с CRM-привязкой

Если у чата заполнены `crm_entity_type` / `crm_entity_id`:

- карточка **не** грузится при каждом открытии;
- при CRM-intent («что с клиентом», «следующий шаг», …) в system prompt добавляется компактный контекст;
- payload проходит `sanitizeLlmPayload(..., "entity_summary")`.

## Кэш

```env
CLIENT_CONTEXT_CACHE_TTL_SECONDS=60
CLIENT_CONTEXT_MAX_CHARS=100000
CLIENT_TIMELINE_MAX_EVENTS=150
```

In-memory TTL, ключ `entityType/entityId/include`. Инвалидация после write через Safety executor. Не для optimistic locking.

## Ошибки

`CRM_CONTEXT_ENTITY_NOT_FOUND`, `CRM_CONTEXT_SOURCE_UNAVAILABLE`, `CRM_CONTEXT_PARTIAL`, `TIMELINE_ACCESS_DENIED`, `COMMUNICATIONS_ACCESS_DENIED`, `CLIENT_COMMUNICATION_BLOCKED`, `CRM_CONTEXT_LIMIT_REACHED`, …

## Блокировка коммуникации

Статусы контакта из env (`BITRIX_CONTACT_STATUS_*`): Спам, Не трогать, Личный (без `allowPersonal`).

## Тесты

```bash
npm run test:client-context
```
