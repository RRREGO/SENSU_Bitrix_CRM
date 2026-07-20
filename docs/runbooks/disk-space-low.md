# Runbook: мало места на диске

## Симптомы

- `disk.status = warning|critical` в `/admin/system/status`
- Backup/логи падают с ENOSPC

## Действия

1. `df -h` на томах data/log/backup
2. `npm run db:backup-retention` — prune старых backup
3. journalctl vacuum / logrotate
4. WAL checkpoint: остановить сервис, backup, при необходимости VACUUM (осторожно)
5. Расширить том или перенести `APP_BACKUP_DIR`

## Пороги

Настраиваются через `DISK_WARNING_FREE_PERCENT`, `DISK_CRITICAL_FREE_PERCENT` (см. `.env.example`).
