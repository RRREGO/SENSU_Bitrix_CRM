# Deployment Readiness Audit

Аудит компонентов pilot deployment. Статусы: `ready` | `partial` | `missing`. **unsafe** — нет.

| Компонент | Статус | Примечание |
|-----------|--------|------------|
| paths.js (APP_*_DIR) | ready | getDataDir, getLogDir, getBackupDir, release metadata |
| Migration v9_pilot_operations | ready | application_errors, release_id columns |
| Structured logger + redaction | ready | JSON/text, LOG_TO_FILE, journald preferred |
| Request ID middleware | ready | X-Request-Id, metrics hook |
| Metrics service | ready | /admin/system/metrics |
| Readiness probes | ready | /health/readiness, migration ≥ 9 |
| Operational modes / kill switches | ready | BITRIX_WRITE, read-only, maintenance |
| application_errors journal | ready | list/resolve API |
| Graceful shutdown | ready | TimeoutStopSec=35, SHUTTING_DOWN |
| systemd unit (non-root) | ready | deploy/systemd/bitrix-crm-assistant.service |
| systemd backup timer | ready | daily backup + check + retention |
| nginx reverse proxy | ready | HTTPS, limits, deny sensitive paths |
| logrotate | ready | optional, APP_LOG_DIR |
| deploy-release.sh | ready | symlink, rollback, DRY_RUN, no sqlite downgrade |
| backup-database.js | ready | stamp(), WAL-aware backup |
| backup-retention.js | ready | daily/weekly retention |
| run-production-smoke-tests.js | ready | opt-in PRODUCTION_SMOKE_TESTS_ENABLED |
| test-pilot-operations.js | ready | npm run test:pilot |
| Frontend System tab | ready | settings.view + audit.view |
| Route policies /admin/system/* | ready | session + permissions |
| Documentation (pilot) | ready | deployment, observability, runbooks |
| Go-live security (v8) | ready | test:go-live regression |
| BITRIX_WRITE assertWritesAllowed | ready | commitAction gate |

## Команды проверки

```bash
npm run test:pilot
npm run test:go-live
npm run check:go-live
```

## Остаточные риски (не unsafe)

- Bitrix/LLM — soft dependency (readiness warning only)
- Single-process rate limits — in-memory
- Manual SQLite restore — операторский runbook

Обновлено: pilot deployment closure.
