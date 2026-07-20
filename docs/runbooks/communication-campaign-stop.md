# Runbook: остановка кампании

## Быстрая пауза одной кампании

```text
POST /communications/campaigns/:id/pause
```

(permission `communications.manage`). UI: Хаб → Кампании → **Пауза**.

Возобновление: `POST /communications/campaigns/:id/resume`.

Pending/retry outbox для кампании перестаёт отправляться по политике `CAMPAIGN_STOPPED`.

## Полная отмена

```text
POST /communications/campaigns/:id/cancel
```

(или Safety prepare `communication_campaign_cancel_prepare`).

## Глобальная авария (все каналы)

```text
POST /admin/communications/emergency-stop
Body: { "confirmationPhrase": "<фраза EMERGENCY_STOP>", "reason": "..." }
```

Снятие:

```text
POST /admin/communications/emergency-resume
Body: { "confirmationPhrase": "<фраза EMERGENCY_RESUME>" }
```

permission: `settings.manage`.

## Проверки после остановки

- [ ] Статус кампании `paused` / `cancelled`
- [ ] Outbox: нет новых `sent` для campaign_id
- [ ] Emergency banner в UI Настройки (если emergency)
- [ ] Аудит / лог действия зафиксирован
