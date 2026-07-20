# Runbook: ошибка базы данных

## Симптомы

- `/health/readiness` → `DATABASE_UNAVAILABLE` или `MIGRATIONS_INCOMPLETE`
- SQLite locked / corrupt

## Диагностика

```bash
npm run db:check-backup
ls -la $APP_DATA_DIR
journalctl -u bitrix-crm-assistant | grep -i sqlite
```

## Действия

1. Остановить сервис (один instance на SQLite!)
2. Проверить свободное место на диске
3. Восстановить из последнего backup (см. [backup-and-restore.md](../backup-and-restore.md))
4. `npm run db:restore-drill` на копии перед prod restore
5. Запустить, проверить migration version ≥ 9

## Не делать

- Запускать два production процесса на одной БД
- Автоматический downgrade миграций при rollback релиза
