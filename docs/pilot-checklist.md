# Pilot checklist

Чеклист перед пилотным запуском на VPS.

## Инфраструктура

- [ ] Пользователь `crmassistant`, не root
- [ ] systemd unit + backup timer установлены
- [ ] nginx HTTPS, `client_max_body_size 4m`, proxy timeouts 300s
- [ ] `.env` в `/etc/bitrix-crm-assistant/env`, права 600
- [ ] `APP_DATA_DIR`, `APP_LOG_DIR`, `APP_BACKUP_DIR` на отдельных томах

## Конфигурация

- [ ] `APP_ENV=production`
- [ ] `APP_ACCESS_MODE=authenticated`
- [ ] `APP_BIND_HOST=127.0.0.1` (за nginx)
- [ ] `APP_ALLOWED_ORIGINS` — HTTPS origin
- [ ] `AUTH_COOKIE_SECURE=true`
- [ ] `APP_VERSION`, `APP_RELEASE_ID`, `APP_COMMIT_SHA` заданы

## Тесты

- [ ] `npm run test:go-live` — зелёный
- [ ] `npm run test:pilot` — зелёный (~54 assertions)
- [ ] `npm run db:backup` + `db:check-backup` + `db:restore-drill`
- [ ] `PRODUCTION_SMOKE_TESTS_ENABLED=true npm run smoke:production` (на staging/prod URL)

## Observability

- [ ] `/health/readiness` — ready
- [ ] `GET /admin/system/status` — без секретов
- [ ] Вкладка **Система** видна admin (settings.view + audit.view)
- [ ] journald / logrotate настроены

## Безопасность

- [ ] `COMMUNICATIONS_SEND_ENABLED=false` (и не полагаться на deprecated `COMMUNICATION_SEND_ENABLED`) до live smoke
- [ ] Сертификация каналов пройдена / актуальна — [communications-certification.md](./communications-certification.md) перед любым live send
- [ ] `BITRIX_BULK_ACTIONS_ENABLED=false`
- [ ] nginx deny `.env`, `*.sqlite`, `/backups/`
- [ ] limit_req на login и webhooks

## Документация

- [deployment.md](./deployment.md)
- [observability.md](./observability.md)
- [backup-and-restore.md](./backup-and-restore.md)
- [test-data-policy.md](./test-data-policy.md)
- [go-live-checklist.md](./go-live-checklist.md)
