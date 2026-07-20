# Аудит CRM-контекста для Client Context / Meeting Workflow

Дата: 2026-07-14  
Портал: определяется из `BITRIX_WEBHOOK_URL` (секреты не публикуются).

## Метод проверки

- Код actions и REST-обёртки в репозитории.
- Уже проходившие аналитические/safety тесты (contact/lead/deal/activity lists).
- Опциональный probe: `scripts/probe-client-context-sources.js` (read-only).

Статусы:

| Статус | Значение |
|--------|----------|
| **available** | Фактически используется в коде и/или подтверждено тестами |
| **partial** | API есть, покрытие узкое / без канала |
| **unavailable** | Не интегрировано в приложении |
| **blocked_by_scope** | Ожидается отказ прав на части порталов |

## Сводка источников

| Источник | API | Сущность | Статус | Права webhook | Pagination | ПДн | В LLM | Ограничения |
|----------|-----|----------|--------|---------------|------------|-----|-------|-------------|
| Поля карточки | `crm.item.get` / `crm.*.get` | contact/lead/deal/company | **available** | CRM read | n/a | да (select allowlist) | да, sanitized | без phone/email/ИИН по умолчанию |
| Связанный контакт | поля `CONTACT_ID` + get | deal/lead | **available** | CRM read | n/a | да | summary | — |
| Связанная компания | `COMPANY_ID` + get | deal/lead/contact | **available** | CRM read | n/a | да | summary | реквизиты только по запросу |
| CRM-дела | `crm.activity.list` | все | **available** | CRM | start/next | тема/описание | да | TYPE_ID обобщённо |
| Задачи | `tasks.task.list` | UF_CRM_TASK | **partial** | tasks | start | да | да | часто `tasksAvailable=false` |
| Комментарии таймлайна | `crm.timeline.comment.list` | все | **available** | CRM | limit | да | да | нет полного history API |
| Email | activity TYPE=email | — | **partial** | CRM | list | да | только channel draft | отдельного REST нет |
| Открытые линии | `imopenlines.*` | — | **unavailable** | imopenlines | — | высокий | нет | не реализовано |
| WhatsApp | внешней/Wazzup UF | — | **unavailable** | интеграция | — | высокий | нет | только имена UF в noise |
| Telegram | UF / IM | — | **unavailable** | — | — | высокий | нет | — |
| Звонки | activity TYPE=call | — | **partial** | CRM / telephony | list | да | компактно | нет voximplant API |
| Расшифровки звонков | — | — | **unavailable** | — | — | высокий | нет | — |
| Документы | `disk.*` / файлы CRM | — | **unavailable** | disk | — | — | нет | HTML-протоколы локально |
| История стадий | `crm.stagehistory.list` | deal/lead | **unavailable** | CRM | — | низкий | нет | не подключено |
| Пользовательские поля | UF_* allowlist | contact/lead/deal | **partial** | CRM | — | зависит | методология из env | без secret UF |
| Связанные лиды/сделки | list filter | contact/company | **available** | CRM | pages | да | ids+titles | лимиты sample |

## Safety write (сохранение протокола / действий)

| Action | Подтверждение | Откат | Использование этапа |
|--------|---------------|-------|----------------------|
| `timeline_comment_add` | да | нет | сохранение протокола |
| `create_task` | да | conditional | следующие шаги |
| `activity_add` | да | нет | CRM-дело |
| `lead_update` / `deal_update` / `contact_update` | да | да | смена стадии/поля — только prepare |

## Итог

Для Client Context **достаточно**: карточка + relations + activities + timeline comments + tasks (если есть права).  
**Недостаточно** для полной коммуникационной истории: open lines, WhatsApp/Telegram message bodies, call transcripts, stage history.

Анализ на этом этапе строится с `partial: true` и warning `COMMUNICATIONS_SOURCE_UNAVAILABLE`, если communications недоступны.
