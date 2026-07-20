# Runbook: изменился контракт провайдера

## Симптомы

- Cert status → `expired`, `lastError.code = PROVIDER_CONTRACT_CHANGED` / `FINGERPRINT_CHANGED`
- Real send: `CERTIFICATION_EXPIRED` / `NOT_CERTIFIED`
- Health / settings показывают протухшую сертификацию

## Причины

- Добавились/пропали каналы, сменился transport или capabilities
- Сменился account / environment fingerprint
- Апгрейд API / срез snapshot в `communication_provider_snapshots`

## Действия

1. **Не** включайте send «в обход» — сначала поймите diff.
2. `GET /communications/provider-contract` (или refresh) — сравните last snapshot.
3. При необходимости emergency-stop если идут ошибочные кампании.
4. Перезапустите сертификацию: `POST /communications/certifications` → connection → webhook → нужные уровни.
5. Live только через [communications-live-pilot.md](../communications-live-pilot.md).
6. Обновите runbook-заметки: что изменилось в Wazzup / транспорте.

## Не делать

- Ставить `COMMUNICATIONS_REQUIRE_CERTIFICATION=false` в production без письменного решения
- Подмешивать mock connection в production (`COMMUNICATION_CERTIFICATION_ALLOW_MOCK`)
