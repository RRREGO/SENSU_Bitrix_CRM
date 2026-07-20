# Runbook: Bitrix24 недоступен

## Симптомы

- Ошибки чтения CRM, таймауты, rate limit
- `bitrix.lastReadStatus` неуспешен в `/admin/system/status`

## Действия

1. Проверить `BITRIX_WEBHOOK_URL` и доступность портала
2. Read-only режим уже работает — UI показывает кэш/workspace
3. При длительном outage: `APP_READ_ONLY_MODE=true` (опционально)
4. `BITRIX_WRITE_ENABLED=false` если нужно запретить commit
5. Дождаться восстановления Bitrix; retry настроен (`BITRIX_READ_RETRY_*`)

## Примечание

Readiness **не** падает из-за Bitrix (soft dependency).
