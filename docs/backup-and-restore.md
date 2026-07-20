# Backup и восстановление

## Ручной backup

```bash
npm run db:backup
npm run db:check-backup
```

Создаёт `operations-YYYYMMDD-HHMMSS.sqlite` в `APP_BACKUP_DIR` (better-sqlite3 backup API, учёт WAL).

## Автоматический backup

systemd timer `bitrix-crm-assistant-backup.timer` — ежедневно 02:30:

1. `scripts/backup-database.js`
2. `scripts/check-database-backup.js`
3. `scripts/backup-retention.js`

## Retention

- `BACKUP_RETENTION_DAILY=14` — хранить снимки за последние 14 дней
- `BACKUP_RETENTION_WEEKLY=8` — для более старых: по одному на неделю (8 недель)
- Новейший backup **никогда** не удаляется

```bash
npm run db:backup-retention
DRY_RUN=1 node scripts/backup-retention.js
```

## Restore drill

```bash
npm run db:restore-drill
```

Проверяет restore во временный файл + `integrity_check`. Не перезаписывает production DB.

## Восстановление на боевом хосте

1. Остановить сервис: `systemctl stop bitrix-crm-assistant`
2. Скопировать backup поверх `APP_DATABASE_PATH` (сохранить копию текущего файла)
3. `npm run db:check-backup` на восстановленном файле
4. Запустить сервис, проверить `/health/readiness`

**Откат релиза** (`deploy-release.sh`) не откатывает SQLite автоматически — только symlink кода.

См. runbook [backup-failed.md](./runbooks/backup-failed.md).
