# Meeting Workflow

Транскрипт → протокол → рекомендации → черновики → сохранение в CRM **только через Safety Layer**.

См. также: [client-context.md](./client-context.md).

## Поток

```text
загрузка транскрипта (.txt / .md / вставка)
  → meeting_transcripts (SQLite, content hash)
  → meeting_protocol_generate (эвристика + опциональный Claude)
  → предпросмотр / правка
  → «Сохранить в CRM» → timeline_comment_add → prepare → confirm → commit
  → recommendedActions (дела / задачи / комментарий) — только предложения
  → client_message_draft — только черновик
```

Автоматически **не** выполняется: смена стадии, создание задач/дел, отправка WhatsApp/Telegram/email.

## Миграция

`v4_client_context`:

- `meeting_transcripts`
- `meeting_protocol_templates` (+ базовый шаблон)
- `meeting_protocols`

## API

```text
POST   /meeting-transcripts
GET    /meeting-transcripts/:id
POST   /meeting-protocols/generate
GET    /meeting-protocols/:id
PATCH  /meeting-protocols/:id
POST   /meeting-protocols/:id/save-to-crm/prepare
GET    /meeting-protocol-templates
PUT    /projects/:id/meeting-protocol-template
```

## Протокол: факты vs выводы

Каждый раздел содержит:

- `fact` — из транскрипта / CRM
- `inference` — вывод ассистента
- `recommendation` — рекомендация (не факт)

Участники, сроки и договорённости не выдумываются.

## Конфиденциальность

```env
MEETING_TRANSCRIPT_MAX_CHARS=200000
```

- транскрипт **не** логируется целиком в diagnostics / operation audit;
- перед LLM: `sanitizeLlmPayload(..., "meeting_protocol"|"message_draft")`;
- сохранение в CRM = preview + confirmation через Safety.

## UI

Вкладка **Протоколы**: транскрипт, генерация, предпросмотр, сохранение в CRM, черновик сообщения.  
В проекте: **Протоколы встреч → Шаблон**.

## Тесты

```bash
npm run test:client-context
```
