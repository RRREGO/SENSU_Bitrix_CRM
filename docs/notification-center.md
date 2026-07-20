# Центр уведомлений

Внутриприложенные уведомления по плановым отчётам.

## Типы

- `report_ready` / `partial_report`
- `critical_alert`
- `warning`
- `schedule_failed`

Severity: `info` | `warning` | `critical`.

## API

```text
GET  /notifications
GET  /notifications/unread-count
POST /notifications/:id/read
POST /notifications/read-all
```

Фильтры: `severity`, `isRead`, `type`, `scheduleId`, период.

## UI

Вкладка **Уведомления**: список, счётчик непрочитанных, открытие связанного run, отметить прочитанным.

Доставка только в UI. Email / Telegram / WhatsApp / push — не реализованы.

## Per-user recipients (v7+)

- `notification_recipients` — строка на пользователя; UI читает только свои
- `markNotificationReadForUser` / `markAllNotificationsReadForUser` — не затрагивают чужие строки
- `backfillNotificationRecipients` — для legacy без дубликатов

Проверка: `npm run test:go-live` assertions 10–13.
