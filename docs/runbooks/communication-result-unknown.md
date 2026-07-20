# Runbook: неизвестный результат отправки

## Симптомы

- `outbound_messages.status = verification_required`
- Неясно, доставлено ли сообщение клиенту

## Действия

1. **Не** повторять отправку автоматически (duplicate window)
2. Проверить канал в Bitrix / почте вручную
3. В UI Исходящие — подтвердить или отменить
4. `COMMUNICATION_SEND_ENABLED=false` до выяснения
5. Зафиксировать `operation_id`, `requestId`

## Профилактика

Live smoke перед `COMMUNICATION_SEND_ENABLED=true` в production.
