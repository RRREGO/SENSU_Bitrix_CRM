# Плановые сводки (Scheduled Reports)

Read-only отчёты по расписанию с сохранением в SQLite и уведомлениями внутри приложения.

См. также: [notification-center.md](./notification-center.md), аудит: `reports/scheduled-reports-audit.md`.

## Пресеты

| ID | Описание | По умолчанию |
|----|----------|--------------|
| `daily_director_brief` | Сводка руководителя на базе `crm_discipline_report` + ДР | ежедневно 08:00 |
| `weekly_sales_summary` | Неделя: дисциплина + new/closed deals + stale | пн 08:00 |
| `crm_discipline` | Дисциплина CRM | ежедневно |
| `birthday_control` | Контроль дней рождения | ежедневно |

Timezone: `APP_TIMEZONE` (по умолчанию `Asia/Almaty`). Системная TZ сервера не используется.

## Идемпотентность

Ключ: `scheduleId:scheduledFor`. Повтор не создаёт второй отчёт.

## Recovery

При старте `running` с истёкшим lock → `failed` + notification. Автоповтор не выполняется — только ручной `retry`.

## Misfire

Если пропуск ≤ `SCHEDULED_REPORT_MISFIRE_GRACE_MINUTES` (120) — один догон. Старые пропуски не проигрываются пачкой.

## Алерты

Пороги без `eval` (`>`, `>=`, `<`, `<=`, `==`, `!=`). Narrative через Claude опционален и не влияет на алерты.

## API

```text
GET/POST /scheduled-reports
PATCH /scheduled-reports/:id
POST .../enable|disable|run-now
GET .../runs
GET /scheduled-report-runs/:id
POST .../retry
```

## Безопасность

Только allowlist registry. Без write-actions Bitrix24. Без email/Telegram/WhatsApp на этом этапе.

## Тесты

```bash
npm run test:schedules
```
