# Каналы коммуникации

Capability-driven аудит и отправка **только** через подтверждённые адаптеры.

См. также: [reports/communication-channels-audit.md](../reports/communication-channels-audit.md), [safe-outbound-messaging.md](safe-outbound-messaging.md).

## Обнаружение

```http
POST /communication-channels/detect
GET  /communication-channels
GET  /communication-channels/:id
```

Detect — **read-only** (без тестовой отправки). Результат сохраняется в `communication_channels` (без credentials).

## Каналы

| Канал | Типичный статус на этапе |
|-------|---------------------------|
| whatsapp / telegram | `provider_specific` / `configured_but_api_unavailable` — send только после подтверждения REST |
| open_lines | detect через `imopenlines.*`; send не включается «наугад» |
| email | draft + copy; SMTP credentials не внедряются |
| bitrix_chat | внутренний IM (`im.message.add`) при scope «Чат» |

## Адаптеры

`src/communications/adapters/*` — интерфейс `detect / validateRecipient / preparePayload / send / verifyDelivery` и `capabilities`.

Недоступный канал **не** притворяется рабочим: `canSend: false`.

## Ограничения

- Нет массовых рассылок, scheduler-сообщений, attachments, HTML email, CC/BCC.
- Не отправлять на произвольный номер / Telegram username без CRM-привязки.
- Не угадывать сторонний WhatsApp REST.
