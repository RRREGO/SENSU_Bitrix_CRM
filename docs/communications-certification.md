# Сертификация каналов коммуникаций (v11)

Перед реальной отправкой через Communications Hub провайдер/канал должны пройти **сертификацию**. Dry-run и `COMMUNICATIONS_SEND_ENABLED=false` никогда не блокируются отсутствием cert.

Связанные документы: [communications.md](./communications.md), [communications-live-pilot.md](./communications-live-pilot.md), [communications-testing.md](./communications-testing.md).

## Уровни

| Уровень | Поле | Что проверяет | Нужно для |
|---------|------|---------------|-----------|
| connection | `connectionTestedAt` | API доступен, каналы видны, fingerprint | база |
| webhook | `webhookVerifiedAt` | Реальное событие в `communication_webhook_events` после старта cert | база |
| single | `singleSendVerifiedAt` | Prepare/live одиночного TEST-сообщения | одиночная отправка |
| delivery | `deliveryStatusVerifiedAt` | Webhook status `delivered` (**HTTP 200 / accepted ≠ delivered**) | подтверждение доставки |
| campaign | `campaignVerifiedAt` | Кампания ≤ `COMMUNICATION_CERTIFICATION_CAMPAIGN_MAX_RECIPIENTS` (default 3) | кампании |
| sequence | `sequenceVerifiedAt` + inbound | Inbound reply `TEST` + шаги цепочки | цепочки |

## Kill switches / env

| Переменная | Default | Смысл |
|------------|---------|--------|
| `COMMUNICATIONS_REQUIRE_CERTIFICATION` | `true` | Gate `assertSendCertified` при реальном send |
| `COMMUNICATION_CERTIFICATION_TTL_DAYS` | `90` | Срок жизни cert |
| `COMMUNICATION_CERTIFICATION_ALLOW_MOCK` | `false` | В production запрещает mock connection |
| `COMMUNICATION_CERTIFICATION_CAMPAIGN_MAX_RECIPIENTS` | `3` | Лимит получателей cert-кампании |
| `COMMUNICATION_TEST_CONTACT_ID` | — | Опциональный whitelist test contact |
| `COMMUNICATION_LIVE_CERTIFY` | unset | Включает `npm run certify:communications` |
| `COMMUNICATION_LIVE_TEST_ENABLED` | `false` | Live single_send шаг |

Deprecated: `COMMUNICATION_SEND_ENABLED` — используйте `COMMUNICATIONS_SEND_ENABLED`. При конфликте send принудительно off.

## API

- `GET /communications/certifications` — список + `emergencyStop`
- `POST /communications/certifications` — начать
- `POST /communications/certifications/:id/run` — `{ testType }`
- `POST /communications/certifications/:id/revoke`
- Emergency: `POST /admin/communications/emergency-stop` / `emergency-resume`

UI: Хаб → **Настройки** → «Сертификация каналов».

## Автотесты (mock only)

```bash
npm run test:communications:certification
```

≥65 сценариев без реального Wazzup. Live: [communications-live-pilot.md](./communications-live-pilot.md).

## Истечение / отзыв

Cert истекает по TTL, смене **account fingerprint**, смене provider contract snapshot или ручному revoke. После expire — real send блокируется (`CERTIFICATION_EXPIRED` / `NOT_CERTIFIED`).

Runbooks:

- [communication-provider-contract-changed.md](./runbooks/communication-provider-contract-changed.md)
- [communication-certification-expired.md](./runbooks/communication-certification-expired.md)
- [communication-campaign-stop.md](./runbooks/communication-campaign-stop.md)
