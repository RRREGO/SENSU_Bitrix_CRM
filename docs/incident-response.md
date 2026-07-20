# Реагирование на инциденты

## Классификация

| Severity | Примеры |
|----------|---------|
| P1 | Сервер недоступен, DB corrupt, утечка доступа |
| P2 | Bitrix/LLM недоступны, backup failed, disk low |
| P3 | Отдельная операция recovery, unknown communication result |

## Первые шаги

1. Проверить `/health` и `/health/readiness`
2. `journalctl -u bitrix-crm-assistant -n 200`
3. Вкладка **Система** или `GET /admin/system/status`
4. `GET /admin/errors?unresolved=true`

## Kill switches (env / runtime)

- `APP_MAINTENANCE_MODE=true` — обслуживание (503 для пользователей)
- `APP_READ_ONLY_MODE=true` — запрет записи
- `BITRIX_WRITE_ENABLED=false` — запрет commit в Bitrix
- `LLM_ENABLED=false` — отключить Claude (аналитика без LLM работает)
- `COMMUNICATION_SEND_ENABLED=false` — запрет отправки

Runtime API: `POST /admin/system/read-only/enable`, `maintenance/enable` (требует `settings.manage`).

## Runbooks

- [server-down.md](./runbooks/server-down.md)
- [database-error.md](./runbooks/database-error.md)
- [bitrix-unavailable.md](./runbooks/bitrix-unavailable.md)
- [llm-unavailable.md](./runbooks/llm-unavailable.md)
- [operation-recovery-required.md](./runbooks/operation-recovery-required.md)
- [communication-result-unknown.md](./runbooks/communication-result-unknown.md)
- [backup-failed.md](./runbooks/backup-failed.md)
- [disk-space-low.md](./runbooks/disk-space-low.md)
- [rollback-release.md](./runbooks/rollback-release.md)
- [user-access-incident.md](./runbooks/user-access-incident.md)

## Эскалация

Зафиксировать `requestId`, время, releaseId (`APP_RELEASE_ID`). После устранения — resolve в журнале ошибок.
