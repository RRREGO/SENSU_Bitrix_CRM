# Runbook: operation recovery required

## Симптомы

- Операции в статусе `executing` или `verification_required` после рестарта
- `safety.recoveryRequired` > 0 в метриках

## Действия

1. `GET /operations/pending` и `/operations` — список
2. Для каждой операции: проверить Bitrix фактическое состояние
3. Использовать UI История / API cancel или rollback prepare
4. Не повторять commit без проверки `confirmationId`
5. Записать инцидент в `application_errors` если нужен follow-up

## Профилактика

Graceful shutdown (`TimeoutStopSec=35`), один instance, backup перед деплоем.
