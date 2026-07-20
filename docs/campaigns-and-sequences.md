# Кампании и цепочки касаний

## Кампания (разовый сегмент)

```text
draft → preview (planHash) → фраза подтверждения → running → outbox → pause/cancel
```

1. **Preview** считает сегмент, применяет политику, рендерит шаблон. **Провайдер не вызывается.**
2. Сохраняется immutable `plan` + `planHash` + фраза:

```text
ПОДТВЕРЖДАЮ РАССЫЛКУ N ПОЛУЧАТЕЛЯМ
```

где `N` = `allowedCount` после исключений.

3. **Start** проверяет фразу и опционально переданный `planHash`. Изменение плана (новый preview с другим текстом/списком) меняет hash → нужен новый confirm.
4. В outbox попадают только allowed recipients; исключённые (spam, suppression, no address…) — не в outbox.
5. **Pause** — статус кампании `paused`; worker отменяет pending/retry.
6. **Cancel** — `cancelled` + `cancelOutboxForCampaign`.

При `COMMUNICATIONS_DRY_RUN` / `SEND_ENABLED=false` jobs завершаются статусом `dry_run`, не `sent`.

## Сертификационные gates

При `COMMUNICATIONS_SEND_ENABLED=true` и `COMMUNICATIONS_REQUIRE_CERTIFICATION=true`:

| Действие | Требуемый уровень cert |
|----------|------------------------|
| Одиночная / outbox single | `single_send_verified` (+ не expired) |
| Старт кампании (real) | `campaign_verified` |
| Sequence step (real) | `sequence_verified` + `inbound_reply` |

Без cert — `NOT_CERTIFIED`. См. [communications-certification.md](./communications-certification.md).

## Цепочки (sequences)

Примеры:

| Тип | Идея |
|-----|------|
| Warmup | Несколько шагов с задержкой (дни/часы), канал WhatsApp/Telegram, категория `warmup` |
| Cycle | Повторные касания для «Цикл» CRM, категория `cycle` / `follow_up` |

Поток:

```text
sequence draft → steps → activate → enroll(contact) → processDueEnrollments → outbox
```

- Enroll создаёт enrollment `active` и (опционально) identity с `firstContactGround`.
- Due-runner ставит следующий шаг в outbox (с dry-run по флагам), **не** зовёт Wazzup напрямую.
- `COMMUNICATION_AUTO_CHANGE_CONTACT_STATUS=false` по умолчанию: completion может *предложить* статус, но не меняет CRM сам.

### Причины остановки enrollment

| status / reason | Источник |
|-----------------|----------|
| `stopped_by_reply` | Входящее сообщение / `stopContactSequences` |
| `stopped_by_status` | Политика spam / dont_touch / suppression |
| `stopped_by_suppression` | Suppression list |
| `stopped_manually` | UI / action stop |
| `completed` | Все шаги отработаны |
| `failed` | Ошибка шага |

## Связанные actions (Safety prepare)

- `communication_campaign_preview`
- `communication_campaign_start_prepare`
- `communication_campaign_pause_prepare` / `_cancel_prepare`
- `communication_sequence_enroll_prepare`
- `communication_enrollment_stop_prepare`

Нет action «напрямую вызвать Wazzup send».
