# Runbook: LLM недоступен

## Симптомы

- Ошибки Claude/proxy, `LLM_DISABLED` или timeouts в метриках

## Действия

1. Проверить `LLM_PROXY_MODE`, `LLM_PROXY_URL` / `ANTHROPIC_PROXY`, CA cert. На VPS в РФ/КЗ нужен `LLM_PROXY_MODE=corporate`, иначе прокси игнорируется и чат даёт 500.
2. `LLM_ENABLED=false` — отключить LLM, числовая аналитика работает
3. Проверить corporate proxy / firewall
4. Не включать `LLM_LOG_PAYLOADS` для диагностики в production

## Восстановление

После fix proxy — `LLM_ENABLED=true`, smoke-запрос через чат (read-only action).
