# Runbook: истекла сертификация канала

## Симптомы

- `CERTIFICATION_EXPIRED` / `NOT_CERTIFIED` на real send
- В UI «Сертификация каналов»: статус expired, expires_at в прошлом
- Fingerprint / contract change мог проставить expire раньше TTL

## Действия

1. Проверьте `GET /communications/certifications` и `lastError`.
2. Если причина — TTL: перезапустите уровни (connection → … → нужный level).
3. Если fingerprint/contract: см. [communication-provider-contract-changed.md](./communication-provider-contract-changed.md).
4. Для live-ступеней: [communications-live-pilot.md](../communications-live-pilot.md).
5. Убедитесь `COMMUNICATIONS_REQUIRE_CERTIFICATION=true` по-прежнему нужен для go-live.
6. Кампании/цепочки не стартовать, пока нет активного cert нужного уровня.

## Временный обход (только staging)

`COMMUNICATIONS_REQUIRE_CERTIFICATION=false` — **не** для production без эскалации.

## Связанное

- [communications-certification.md](../communications-certification.md)
- [go-live-checklist.md](../go-live-checklist.md)
