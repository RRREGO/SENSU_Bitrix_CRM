# Интеграция Wazzup

Wazzup User API v3 — основной провайдер Communications Hub. Ключ и webhook-секрет **только в env**, никогда в SQLite / UI / логи / health.

Документация API: [Wazzup User API](https://wazzup24.com/docs) (актуальные поля смотрите в кабинете Wazzup).

## Создание интеграции

1. В кабинете Wazzup создайте **API-интеграцию** (User API).
2. Скопируйте **API key** → `WAZZUP_API_KEY` (длинная случайная строка).
3. Сгенерируйте длинный секрет для URL webhook → `WAZZUP_WEBHOOK_SECRET` (не коммитьте; пример формата: `whsec_…`, не боевой ключ).
4. Укажите webhook URI приложения:

```text
https://<ваш-хост>/webhooks/wazzup/<WAZZUP_WEBHOOK_SECRET>
```

Секрет в path сверяется constant-time. Нелогируемый.

5. Подписки (через UI «Тест / Sync» или `PATCH /v3/webhooks`):

| Событие | Рекомендация |
|---------|--------------|
| `messagesAndStatuses` | **Вкл** — сообщения и статусы доставки |
| `channelsUpdates` | **Вкл** — смена state канала |
| `contactsAndDealsCreation` | по необходимости |
| `templateStatus` | для WABA-шаблонов |

Тестовый ping Wazzup `{ "test": true }` отвечает 200 без записи бизнес-данных.

## Сертификация перед send

1. Sync каналов (`POST /communications/channels/sync` или UI).
2. Создать cert (`POST /communications/certifications` или UI «Сертификация каналов»).
3. Шаг **connection** (mock только non-prod при `COMMUNICATION_CERTIFICATION_ALLOW_MOCK`).
4. Дождаться реального webhook → шаг **webhook**.
5. Далее single / delivery / campaign / sequence по [communications-certification.md](./communications-certification.md).
6. Live driver: `COMMUNICATION_LIVE_CERTIFY=true npm run certify:communications -- … --confirm`.

## Env

```env
WAZZUP_ENABLED=true
WAZZUP_API_BASE=https://api.wazzup24.com
WAZZUP_API_KEY=
WAZZUP_WEBHOOK_SECRET=
WAZZUP_REQUEST_TIMEOUT_MS=15000
```

## Endpoints, которые использует приложение

| Метод | Путь | Назначение |
|-------|------|------------|
| GET | `/v3/channels` | Список каналов, тест соединения |
| POST | `/v3/message` | Отправка (`crmMessageId` = идемпотентность) |
| GET | `/v3/templates/whatsapp` | WABA-шаблоны |
| PATCH | `/v3/webhooks` | Подписка на события |

Ошибки классифицируются: 401 / 403 / 429 / 5xx / timeout. API key **редактируется** из текста ошибок.

## Состояния каналов

Из ответа `/v3/channels` (поле `state` / `status`) нормализуются примерно так:

| Состояние | Смысл |
|-----------|--------|
| `active` / `authorized` / `ok` / `ready` | Можно слать (при прочих политике) |
| `unauthorized` / QR | Нужна авторизация в Wazzup |
| `inactive` / `disabled` | Политика `INACTIVE_CHANNEL` |

Неизвестный transport не роняет sync: сохраняется как есть с безопасными capabilities.

## Транспорты

Типичные значения: `whatsapp`, `wapi` (WABA), `telegram`, `tgapi`, `viber`, `instagram`, `max`, `maxbot`.

### MAX через Wazzup

Если в `/v3/channels` есть transport `max` / `maxbot` — используйте **Wazzup**.  
Прямой `MaxBotProvider` (`MAX_BOT_ENABLED`) выключен по умолчанию и шлёт **только** в известный `chatId` (не по номеру телефона).

## Безопасность

- Не кладите key/secret в `app_settings` или payload аудита.
- `getCommunicationsPublicConfig()` отдаёт только `configured: true/false`.
- В action catalog нет «сырых» wazzup-actions — только Hub prepare/list.
