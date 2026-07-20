# Runbook: сервер недоступен

## Симптомы

- nginx 502/504, `/health` не отвечает

## Диагностика

```bash
systemctl status bitrix-crm-assistant
journalctl -u bitrix-crm-assistant -n 100 --no-pager
curl -v http://127.0.0.1:3005/health
```

## Действия

1. Если `failed` — проверить `/etc/bitrix-crm-assistant/env`, права на `APP_DATA_DIR`
2. `systemctl restart bitrix-crm-assistant`
3. Если не стартует — production validator critical (см. `check:go-live`)
4. Включить maintenance если нужен window: `APP_MAINTENANCE_MODE=true`

## Эскалация

P1 если downtime > 15 мин. Зафиксировать releaseId и последние логи.
