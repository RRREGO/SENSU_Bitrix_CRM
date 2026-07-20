# Communications Hub

Единый хаб исходящих и входящих сообщений через Wazzup (WhatsApp / WABA / Telegram / MAX и др.) с кампаниями, цепочками касаний и политикой отправки. Наследует принципы Safety Layer: **preview → подтверждение → outbox**; реальная отправка только при явных kill-switch флагах.

Сосуществует с legacy-потоком «Исходящие» (`client_message_send` через Bitrix IM / адаптеры). См. [safe-outbound-messaging.md](./safe-outbound-messaging.md).

## Документы

| Тема | Файл |
|------|------|
| Интеграция Wazzup | [wazzup-integration.md](./wazzup-integration.md) |
| Политика отправки | [communication-policy.md](./communication-policy.md) |
| Кампании и цепочки | [campaigns-and-sequences.md](./campaigns-and-sequences.md) |
| Сертификация каналов (v11) | [communications-certification.md](./communications-certification.md) |
| Live-пилот сертификации | [communications-live-pilot.md](./communications-live-pilot.md) |
| Тестирование | [communications-testing.md](./communications-testing.md) |

## Kill switches (по умолчанию всё выключено)

| Переменная | Смысл | Default |
|------------|--------|---------|
| `COMMUNICATIONS_ENABLED` | Включает Hub API / UI / worker | `false` |
| `COMMUNICATIONS_SEND_ENABLED` | Разрешает реальный вызов провайдера | `false` |
| `COMMUNICATIONS_DRY_RUN` | Outbox пишет `dry_run`, без HTTP к Wazzup | `true` |

Дополнительно:

- `WAZZUP_ENABLED` + `WAZZUP_API_KEY` — провайдер Wazzup
- `MAX_BOT_ENABLED` — официальный MAX Bot API (**выключен**; предпочтителен transport `max`/`maxbot` через Wazzup)
- `COMMUNICATION_AUTO_*` — автокомментарий / автосмена статуса / автодело (**все `false`**)

После апгрейда сервер **не** начинает слать сообщения сам — нужны явные флаги и подтверждение.

## Этапы включения

1. **Миграция** — schema `v11_communications_certification` (поверх v10 Hub).
2. **Конфиг env** — `COMMUNICATIONS_ENABLED=true`, `DRY_RUN=true`, `SEND_ENABLED=false`.
3. **Wazzup** — API key + webhook URI с секретом; синхронизация каналов в UI.
4. **Сертификация** — [communications-certification.md](./communications-certification.md); `npm run test:communications:certification`.
5. **Проверка** — `npm run test:communications`, ручной preview кампании / сообщение в dry-run.
6. **Пилот** — [communications-live-pilot.md](./communications-live-pilot.md) + checklist; `SEND_ENABLED=true` кратко и под контролем.
7. **Production** — quiet hours, лимиты, suppression, мониторинг health / очереди.

## Вкладки UI («Хаб»)

| Вкладка | Назначение |
|---------|------------|
| Обзор | Статус провайдера, каналы, очередь, активные кампании/цепочки |
| Диалоги | Threads, входящие/исходящие, черновик ответа |
| Кампании | Сегмент → preview → фраза подтверждения → outbox |
| Цепочки | Warmup / cycle sequences, enroll / stop |
| Шаблоны | Тела сообщений и категории (birthday, warmup…) |
| Доставка | Отчёты статусов без выдуманных read |
| Настройки | Публичный конфиг (без секретов), тест соединения, sync каналов, **сертификация каналов** |

## Структура кода

```text
src/communications/
  config.js                 # env, publicConfig, CommunicationError
  capabilityService.js      # legacy detect + health block
  communicationPolicy.js    # evaluateSendPolicy / campaign policy
  communicationService.js   # overview, prepare, enqueue
  communicationScheduler.js # outbox worker (dry-run / send)
  campaignRunner.js
  sequenceRunner.js
  webhookHandler.js
  providers/                # wazzup + max_bot
  routes.js
```

## Health

Блок communications в `/health` / system metrics: `enabled`, `sendEnabled`, `dryRun`, `configured`, `queue`, `lastSuccessfulCheckAt` (из `app_settings`, **без** API key).
