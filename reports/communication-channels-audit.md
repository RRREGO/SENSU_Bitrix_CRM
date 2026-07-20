# Аудит каналов коммуникации Bitrix24

Дата: 2026-07-14  
Метод: код приложения + read-only probe через REST (без тестовой отправки).  
Секреты webhook не публикуются.

## Статусы

| Статус | Значение |
|--------|----------|
| `available_read_write` | Чтение и безопасная отправка через REST доступны |
| `available_write_only` | Отправка возможна, история канала не читается |
| `available_read_only` | Только наблюдение (дела/timeline), без send API |
| `configured_but_api_unavailable` | Интеграция может быть на портале, REST send для webhook не подтверждён |
| `not_configured` | В приложении/портале канал не найден |
| `insufficient_scope` | Метод есть, прав webhook недостаточно |
| `provider_specific` | Нужен сторонний API провайдера, не REST Bitrix |
| `unsupported` | Не поддерживается на этом этапе |

## Сводка каналов

| Канал | Провайдер | Подключение | REST | Права | Read | Send | Delivery | External ID | Статус |
|-------|-----------|-------------|------|-------|------|------|----------|-------------|--------|
| WhatsApp | Open Lines / внешний коннектор | Контакт-центр Bitrix или Wazzup/иные UF | `imopenlines.*`, `imconnector.*` (если scope) | imopenlines + CRM | нет в приложении | **не подтверждена** без live detect | зависит от коннектора | зависит | `configured_but_api_unavailable` или `not_configured` |
| Telegram | Open Lines / коннектор | Контакт-центр | то же | imopenlines | нет | **не подтверждена** | редко | редко | `configured_but_api_unavailable` / `not_configured` |
| Open Lines | Bitrix OL | Линия CRM | `imopenlines.config.list.get`, `imopenlines.crm.message.add` (документация) | Open Lines | partial | только если detect=canSend | partial | possible | после detect |
| Email | CRM activity / почта | Почтовый ящик CRM | `crm.activity.add` TYPE email **не гарантирует SMTP-отправку** | CRM | activity list | **draft-only**, если нет безопасного send | нет | нет | `available_read_only` / `sendAvailable:false` |
| Внутренний чат Bitrix | Bitrix IM | Пользователи портала | `im.message.add` | Чат и уведомления | нет (история IM) | **да**, если scope IM (см. `send_chat_message`) | приём запроса ≠ delivered | message id | `available_write_only` при scope |
| CRM communications | FM PHONE/EMAIL | Карточка контакта | `crm.contact.get` / item.get | CRM | да (masked) | нет | — | — | `available_read_only` (для resolve) |

## Детали по каналам

### WhatsApp
- Обнаружение: через Open Lines connectors / `imconnector` list; сторонние провайдеры (Wazzup и т.п.) часто **не** отдают send через входящий webhook Bitrix.
- Не угадывать REST стороннего провайдера (`provider_specific`).
- Отправка только в уже привязанный диалог/коннектор контакта, не на произвольный номер.

### Telegram
- Аналогично WhatsApp через OL.
- Запрет отправки на username без CRM-привязки.

### Open Lines
- Read-методы detect: `imopenlines.config.list.get` (или аналог) — soft fail → `insufficient_scope` / `not_configured`.
- Send: только после подтверждения метода на текущем портале capability `canSend`.

### Email
- Создание email-activity ≠ отправка письма.
- На этапе: draft + copy; SMTP credentials не внедряются.
- Subject обязателен при подготовке отправки, если канал станет sendable позже.

### Внутренний чат Bitrix24
- Уже есть write-path `im.message.add` (`send_chat_message`).
- Для клиентских сообщений канал отдельный: получатель = user Bitrix, не контакт CRM.
- Preview: «Внутренний чат»; откат невозможен.

## ПДн
Телефоны/email: только маскированные в UI/preview/audit. Полный адрес — только для adapter payload в memory при commit, не в `outbound_messages` и не в operation params без redact.

## Итог для реализации
- Capability registry + adapters; send только при `canSend`.
- WhatsApp/Telegram/OL: detect-first, по умолчанию без фиктивной отправки.
- Email: draft-only до безопасного API.
- Internal IM: единственный канал с разумной вероятностью `canSend` на типовом webhook с правом «Чат».
