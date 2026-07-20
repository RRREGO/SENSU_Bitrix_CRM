# Runbook: backup failed

## Симптомы

- `bitrix-crm-assistant-backup.service` failed
- Нет свежих файлов в `APP_BACKUP_DIR`

## Диагностика

```bash
systemctl status bitrix-crm-assistant-backup.service
journalctl -u bitrix-crm-assistant-backup -n 50
npm run db:backup   # ручной запуск
```

## Действия

1. Проверить место на диске (`GET /admin/system/disk`)
2. Права `crmassistant` на backup dir
3. SQLite не заблокирован (backup через better-sqlite3 API)
4. После успеха — `npm run db:check-backup`
5. P2 если > 24ч без backup
