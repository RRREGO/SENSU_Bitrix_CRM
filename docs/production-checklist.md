# Production checklist

Перед работой с реальной клиентской перепиской:

- [ ] `.env` не в git; секреты только локально / vault
- [ ] `LLM_PROXY_MODE=none|corporate|self_hosted` — публичный proxy не используется
- [ ] `LLM_PROXY_ALLOW_INSECURE_TLS=false`
- [ ] `LLM_LOG_PAYLOADS=false`
- [ ] Backup SQLite: `npm run db:backup`
- [ ] Проверка backup: `npm run db:check-backup`
- [ ] `npm run test:safety` — зелёный
- [ ] `npm run test:safety:hardening` — зелёный
- [ ] `npm run test:production` — зелёный
- [ ] Live smoke-test (opt-in) пройден на портале
- [ ] Bitrix webhook с минимально необходимыми правами
- [ ] `BITRIX_BULK_ACTIONS_ENABLED=false`
- [ ] Blocked actions / policies проверены
- [ ] `GET /operations/pending` показывает pending после рестарта
- [ ] `APP_ACCESS_MODE` выбран (`local_only` до публикации / `authenticated` для go-live)
- [ ] Bootstrap admin создан; пароль удалён из `.env`; смена пароля выполнена
- [ ] `COMMUNICATION_SEND_ENABLED=false` до live smoke
- [ ] `GET /health` зелёный (`database`, `recovery`, `llmTransport`, `communications`)
- [ ] Каналы: `POST /communication-channels/detect` (read-only); send только при `canSend`
- [ ] `COMMUNICATION_LIVE_TEST_ENABLED=false` в проде; live smoke только вручную
- [ ] Action catalog укладывается в `ACTION_CATALOG_MAX_CHARS`
- [ ] Документация VPS: [secure-llm-transport.md](./secure-llm-transport.md)

## Pilot deployment

- [ ] `npm run test:pilot` — зелёный
- [ ] systemd + nginx + backup timer (см. [deployment.md](./deployment.md))
- [ ] `GET /health/readiness` на боевом URL
- [ ] Вкладка **Система** для admin

## Go-Live security closure

- [ ] `APP_ENV=production` только на боевом хосте
- [ ] `npm run test:go-live` — зелёный (29 assertions)
- [ ] `npm run check:go-live` — без critical в production
- [ ] `npm run db:restore-drill` — restore drill
- [ ] `GET /admin/go-live-readiness` — проверка перед cutover
- [ ] Чеклист: [go-live-checklist.md](./go-live-checklist.md), [go-live-security.md](./go-live-security.md), [pilot-checklist.md](./pilot-checklist.md)
