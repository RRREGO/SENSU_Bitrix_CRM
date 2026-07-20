# Тестирование Communications Hub

## Автотесты

```bash
npm run test:communications
npm run test:communications:certification
```

Скрипт `scripts/test-communications.js`:

1. Legacy Bitrix outbound (~50 asserts) — drafts, Safety `client_message_send`, duplicate guard.
2. Секция **`=== Communications Hub ===`** — provider mocks, policy, campaign, sequence, webhook, security.

Скрипт `scripts/test-communications-certification.js` (v11, mock-only, ≥65 asserts):

- миграция v11, flags conflict, fingerprint/contract
- runner steps (connection/webhook/dry-run/single/delivery/campaign/sequence)
- webhook idempotency/replay, gates, emergency, outbox lease, quiet hours
- **без** реального Wazzup; live — отдельно: `npm run certify:communications` (нужен `COMMUNICATION_LIVE_CERTIFY=true`)

Использует временную SQLite (`APP_DATABASE_PATH` во временном каталоге), миграции до **v11**.  
Wazzup **никогда** не вызывается по сети: `fetch` / `fetchImpl` мокаются.

Перед открытием БД выставляются:

```env
COMMUNICATIONS_ENABLED=true
COMMUNICATIONS_SEND_ENABLED=false
COMMUNICATIONS_DRY_RUN=true
WAZZUP_ENABLED=true
WAZZUP_API_KEY=test-key-not-real
WAZZUP_WEBHOOK_SECRET=whsec_test_long_secret_value_12345
COMMUNICATIONS_QUIET_HOURS_START=02:00
COMMUNICATIONS_QUIET_HOURS_END=03:00
```

Quiet hours 02–03 — чтобы дневной прогон legacy не блокировался; отдельный assert временно расширяет окно на «сейчас».

## Dry-run checklist (ручной)

- [ ] `COMMUNICATIONS_ENABLED=true`, `SEND_ENABLED=false`, `DRY_RUN=true`
- [ ] Sync каналов в UI — видны transports без ошибок
- [ ] Preview кампании: samples есть, `sent: false`, в логах нет `provider.request` к Wazzup
- [ ] Подтверждение → outbox status `dry_run` / `pending`→`dry_run`
- [ ] Цепочка enroll + due → outbox dry_run
- [ ] Webhook test ping с секретом → 200
- [ ] Health / settings: нет API key и phone в JSON

## Как не слать по-настоящему

1. Не ставьте `COMMUNICATIONS_SEND_ENABLED=true` без явной необходимости.
2. Держите `COMMUNICATIONS_DRY_RUN=true` на стейджинге.
3. Не подставляйте боевой `WAZZUP_API_KEY` в локальный `.env` для прогона suite.
4. Live smoke legacy (`COMMUNICATION_LIVE_TEST_ENABLED`) — отдельный скрипт, **не** входит в `test:communications`.
5. Live certification — `COMMUNICATION_LIVE_CERTIFY=true npm run certify:communications` ([communications-live-pilot.md](./communications-live-pilot.md)).

## Отладка падений

- Смотрите номер assert (`H27`, `H46`…) в выводе.
- При `DAILY_LIMIT` в кампаниях используйте разные contactId (лимит по умолчанию 1/день).
- При `PLAN_HASH_MISMATCH` — повторите preview перед confirm.
