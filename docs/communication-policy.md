# Политика коммуникации (Hub)

Единая точка: `evaluateSendPolicy(ctx)` в `src/communications/communicationPolicy.js`.  
Возвращает `{ allowed, code, message, details }`. Legacy `assertContactAllowed` остаётся для `client_message_send`.

## Коды блокировки

| code | Когда |
|------|--------|
| `COMMUNICATIONS_DISABLED` | `COMMUNICATIONS_ENABLED=false` |
| `AMBIGUOUS_CONTACT` | Несколько кандидатов CRM |
| `CONTACT_UNRESOLVED` | Нет сопоставления |
| `STATUS_SPAM` | Статус из `BITRIX_CONTACT_STATUS_SPAM_VALUES` |
| `STATUS_DONT_TOUCH` | `…_DO_NOT_CONTACT_VALUES` |
| `STATUS_PERSONAL` | «Личный» без `allowPersonal` + reason |
| `SUPPRESSION` | Активная запись suppression |
| `OPT_OUT` | Явный opt-out |
| `NO_ADDRESS` | Нет phone / chatId / username |
| `INACTIVE_CHANNEL` | Канал не active/authorized |
| `DAILY_LIMIT` | `COMMUNICATIONS_MAX_MESSAGES_PER_CONTACT_PER_DAY` |
| `QUIET_HOURS` | Окно / weekday запрета |
| `CAMPAIGN_STOPPED` | paused / cancelled / … |
| `SEQUENCE_DONE` | Enrollment уже остановлен |
| `IDEMPOTENCY_EXISTS` | Outbox уже sent/dry_run |
| `WABA_TEMPLATE_REQUIRED` | WABA вне окна без шаблона |
| `WABA_TEMPLATE_NOT_APPROVED` | Шаблон не approved |
| `CONGRATS_ONLY` | Статус «только поздравления», категория не birthday/holiday/personal_congratulation |
| `TELEGRAM_FIRST_CONTACT_FORBIDDEN` | Холодный Telegram без основания |
| `MAX_FIRST_CONTACT_FORBIDDEN` | Холодный MAX без основания |
| `MAX_CHAT_ID_REQUIRED` | MAX без известного chatId |
| `PLAN_HASH_MISMATCH` | Payload ≠ подтверждённый план |

## Статусы CRM (env)

```env
BITRIX_CONTACT_STATUS_FIELD=
BITRIX_CONTACT_STATUS_SPAM_VALUES=
BITRIX_CONTACT_STATUS_DO_NOT_CONTACT_VALUES=
BITRIX_CONTACT_STATUS_PERSONAL_VALUES=
BITRIX_CONTACT_STATUS_CONGRATS_ONLY_VALUES=
BITRIX_CONTACT_STATUS_NO_CONTACT_VALUES=
BITRIX_CONTACT_STATUS_WARMUP_VALUES=
BITRIX_CONTACT_STATUS_COMMUNICATION_VALUES=
```

Значения — ID enum из `contact_field_audit`, через запятую. Не хардкодить портальные ID в git.

## Telegram / MAX — основания первого контакта

`FIRST_CONTACT_GROUNDS`: `inbound`, `application`, `call`, `referral`, `manual_consent`, `active_dialog`.

Без валидного `firstContactGround` холодный старт в telegram/tgapi/max/maxbot запрещён.  
Для MAX дополнительно нужен `externalChatId` / `chatId` — **не телефон**.

## WABA (`wapi`)

Вне активного диалога требуется одобренный шаблон (`wabaTemplateId` + статус approved/active/ok).

## Congrats-only

Разрешённые категории шаблона: `birthday`, `holiday`, `personal_congratulation`.  
Продажи / warmup / newsletter — `CONGRATS_ONLY`.

## Quiet hours

```env
COMMUNICATIONS_DEFAULT_TIMEZONE=Asia/Almaty
COMMUNICATIONS_QUIET_HOURS_START=19:00
COMMUNICATIONS_QUIET_HOURS_END=09:00
COMMUNICATIONS_ALLOWED_WEEKDAYS=1,2,3,4,5
```

Окно overnight (start > end) поддерживается. День вне `ALLOWED_WEEKDAYS` тоже считается quiet.

## Suppression / opt-out

- Явный список suppression (reason + source).
- Фразы opt-out из `COMMUNICATION_OPT_OUT_PHRASES` на входящем → запись suppression и стоп цепочек.

## Dry-run

Даже при `allowed: true` outbox worker ставит `dry_run`, если `COMMUNICATIONS_DRY_RUN=true` или `COMMUNICATIONS_SEND_ENABLED=false`.
