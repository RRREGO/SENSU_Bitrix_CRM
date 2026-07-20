# Go-Live checklist

Чеклист перед переключением на production.

## Конфигурация

- [ ] `APP_ENV=production`
- [ ] `APP_ACCESS_MODE=authenticated`
- [ ] `APP_BIND_HOST` — только нужный интерфейс (за reverse proxy — loopback или внутренняя сеть)
- [ ] `APP_ALLOWED_ORIGINS` — HTTPS origin фронта
- [ ] `APP_PUBLIC_ORIGIN` и `APP_TRUSTED_PROXY_CIDRS` — если `APP_TRUST_PROXY=true`
- [ ] `AUTH_COOKIE_SECURE=true`
- [ ] `AUTH_MAX_ACTIVE_SESSIONS_PER_USER` — лимит параллельных сессий (по умолчанию 5)
- [ ] Bootstrap admin создан; `APP_BOOTSTRAP_ADMIN_PASSWORD` удалён из `.env`
- [ ] `COMMUNICATIONS_SEND_ENABLED=false` до прохождения live smoke / certification
- [ ] Provider/channel certification актуальна (`npm run test:communications:certification` зелёный; live — [communications-live-pilot.md](./communications-live-pilot.md))
- [ ] `COMMUNICATION_LIVE_TEST_MAX_AGE_DAYS` — срок действия smoke (по умолчанию 90)

## Тесты и аудит

- [ ] `npm run test:go-live` — зелёный
- [ ] `npm run test:pilot` — зелёный (pilot deployment)
- [ ] `npm run test:access` — зелёный
- [ ] `npm run test:production` — зелёный
- [ ] `npm run check:go-live` — `ready: true` или нет critical в production
- [ ] `npm run db:backup` + `npm run db:check-backup`
- [ ] `npm run db:restore-drill` — restore drill успешен
- [ ] Отчёты: [frontend-csrf-audit](../reports/frontend-csrf-audit.md), [route-access-policy-audit](../reports/route-access-policy-audit.md), [data-scope-audit](../reports/data-scope-audit.md)

## Runtime

- [ ] `GET /health` — зелёный
- [ ] `GET /admin/go-live-readiness` — без critical (под сессией admin)
- [ ] Route policy self-audit при старте — нет missing routes в production
- [ ] Один production instance на SQLite (instance lock)

## Документация

- [go-live-security.md](./go-live-security.md)
- [production-checklist.md](./production-checklist.md)
- [pilot-checklist.md](./pilot-checklist.md)
