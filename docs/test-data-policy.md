# Политика тестовых данных (pilot)

## Принципы

1. **Пилот** — реальный портал Bitrix24 с ограниченной группой пользователей.
2. Тестовые сущности CRM помечаются в названии префиксом `[PILOT]` или отдельной воронкой.
3. Не использовать production переписку клиентов для отладки LLM payload logging.
4. `LLM_LOG_PAYLOADS=false` всегда в production.

## Запрещено в pilot

- Массовые bulk-actions (`BITRIX_BULK_ACTIONS_ENABLED=false`)
- Автоотправка сообщений без live smoke (`COMMUNICATION_SEND_ENABLED=false`)
- Хранение паролей/bootstrap в git или логах

## Рекомендуется

- Отдельный bootstrap admin + роли manager/viewer для пилотной группы
- `npm run test:pilot` и `test:go-live` перед каждым деплоем
- Restore drill раз в месяц
- Удаление тестовых сделок/контактов после завершения пилота — вручную в Bitrix

## Smoke на production

```bash
PRODUCTION_SMOKE_TESTS_ENABLED=true SMOKE_BASE_URL=https://crm.example.com npm run smoke:production
```

Опционально: `SMOKE_LOGIN_USERNAME` / `SMOKE_LOGIN_PASSWORD` для проверки auth.
