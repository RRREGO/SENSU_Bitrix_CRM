# Live-пилот сертификаций коммуникаций

Живые шаги (single_send / реальный webhook / delivery) **выключены по умолчанию**. Юнит-suite `test:communications:certification` никогда не зовёт Wazzup.

## Включение

```bash
# 1. Только test-контакт с маркером [CRM ASSISTANT TEST]
# 2. Env:
COMMUNICATION_LIVE_CERTIFY=true
COMMUNICATION_LIVE_TEST_ENABLED=true
COMMUNICATIONS_ENABLED=true
COMMUNICATIONS_SEND_ENABLED=true
COMMUNICATIONS_DRY_RUN=false
COMMUNICATION_TEST_CONTACT_ID=<id>
# WAZZUP_API_KEY / WAZZUP_WEBHOOK_SECRET только из .env — не CLI

COMMUNICATION_LIVE_CERTIFY=true npm run certify:communications -- \
  --provider wazzup --channel whatsapp --transport-id <id> \
  --test-contact-id <id> --steps connection,webhook --confirm
```

Без `COMMUNICATION_LIVE_CERTIFY=true` скрипт сразу выходит с ошибкой.

## Порядок шагов

1. `connection` (+ sync каналов) — fingerprint
2. Убедиться, что webhook доставляет события в CRM Assistant
3. `webhook` — событие после `created_at` сертификации
4. `single_send` (live) — только TEST-контакт
5. Дождаться status webhook → `delivery`
6. При необходимости `campaign` (≤3) / `inbound_reply` + `sequence`

## Чеклист безопасности

- [ ] Не production-клиенты в сегменте
- [ ] Emergency stop известен (`POST /admin/communications/emergency-stop`)
- [ ] После пилота снова `COMMUNICATIONS_SEND_ENABLED=false` или dry-run
- [ ] Cert виден в UI «Сертификация каналов» и не expired

См. [communications-certification.md](./communications-certification.md), [pilot-checklist.md](./pilot-checklist.md).
