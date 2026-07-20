# Аудит прямых write-вызовов Bitrix24

Дата: 2026-07-13  
Цель: убедиться, что изменяющие REST-вызовы не обходят safety executor.

Техническая защита: `callBitrixMethod` / `callWriteMethod` требуют `runWithSafetyContext` (executionToken в AsyncLocalStorage).

---

## Сводка

| Статус | Количество |
|--------|----------:|
| protected (через action + guard) | 40+ call sites |
| read_only | остальные list/get/fields |
| legacy_bypass (до исправления) | 2 |
| legacy_bypass (после) | **0** |
| unsafe (после) | **0** |
| test_only | live smoke / mocks |

---

## Legacy bypass (исправлено)

| Файл | Функция | Метод | Было | Стало | Статус |
|------|---------|-------|------|-------|--------|
| `server.js` | `analyzeDealAndWriteComment` | `crm.timeline.comment.add` через `addDealTimelineComment` | запись без confirm | удалено; analyze = read-only | `protected` |
| `server.js` | `POST /bitrix/event` | тот же путь | авто-запись в таймлайн | write заблокирован, recommendation | `blocked` |
| `src/bitrixClient.js` | `addDealTimelineComment` | `crm.timeline.comment.add` | публичный write helper | требует safety context | `protected` |

---

## Action handlers (write) — все через executor при commit

| Файл | Методы Bitrix24 | Через safety executor | Источник | Риск | Исправление | Статус |
|------|-----------------|----------------------|----------|------|-------------|--------|
| `timelineActions.js` | `crm.timeline.comment.add`, `crm.activity.add/update/delete` | да (commit + guard) | chat / `/bitrix/action` | medium–high | guard | `protected` |
| `dealActions.js` | `crm.item.update/delete`, `crm.deal.*`, `productrows.set` | да | chat / API | medium–critical | guard | `protected` |
| `leadActions.js` | `crm.item.*`, `productrows.set` | да | chat / API | medium–critical | guard | `protected` |
| `crmActions.js` | `crm.item.add`, `crm.deal.add`, category/status add/update/delete, `userfield.add` | да; structural **blocked** policy | chat / API | critical | policy + guard | `blocked` / `protected` |
| `taskActions.js` | `tasks.task.add/update/delete`, `task.commentitem.add`, `im.message.add` | да | chat / API | medium–high | guard | `protected` |
| `checklistActions.js` | checklist add/update/delete | да | chat / API | medium | guard | `protected` |
| `reminderActions.js` | `tasks.task.reminder.add` | да | chat / API | medium | guard | `protected` |
| `helpers.js` | `crm.item.add/update/delete` | да (вызывается из actions) | internal | medium | guard | `protected` |

---

## Read-only call sites

| Файл | Методы | Статус |
|------|--------|--------|
| `contactAnalyticsActions.js` | `crm.contact.fields`, list | `read_only` |
| `managerAnalyticsActions.js` | list/get через helpers | `read_only` |
| `analyticsActions.js` | list | `read_only` |
| `preview.js` (prepare) | `crm.item.get`, `tasks.task.get`, `crm.activity.get` | `read_only` |
| `directoryCache.js` | `user.get`, company list | `read_only` |
| `getDeal` | `crm.item.get` / `crm.deal.get` | `read_only` |
| `public/js/reports.js` | только read actions через `/bitrix/action` | `read_only` |

---

## Endpoints

| Endpoint | Было | Стало | Статус |
|----------|------|-------|--------|
| `POST /bitrix/deal/:id/analyze` | get + Claude + timeline write | get + Claude, `savedToTimeline: false` | `protected` |
| `POST /bitrix/deal/:id/analyze/save/prepare` | — | `prepareAction(timeline_comment_add)` | `protected` |
| `POST /bitrix/event` | auto analyze+write | log + `WEBHOOK_WRITE_BLOCKED` | `blocked` |
| `POST /bitrix/action` | safety executor | + strip client token | `protected` |
| `POST /chat`, `/chat/confirm` | executor | без изменений архитектуры | `protected` |

---

## Итог этапа

- `legacy_bypass`: **0**
- `unsafe`: **0**
- Прямой `callWriteMethod` вне `runWithSafetyContext` → `WRITE_CALL_OUTSIDE_SAFETY_EXECUTOR`
