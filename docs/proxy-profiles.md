# Прокси (только системный)

Пользовательский выбор и CRUD прокси-профилей **отключены**.

Прокси для LLM / AI-провайдеров задаёт администратор в окружении сервера:

- `LLM_PROXY_MODE` — `none` | `corporate` | `self_hosted`
- `LLM_PROXY_URL`, `LLM_PROXY_USERNAME`, `LLM_PROXY_PASSWORD`
- `ANTHROPIC_PROXY` (альтернатива / legacy)

См. [secure-llm-transport.md](./secure-llm-transport.md).

AI-провайдеры из UI всегда ходят через системный транспорт (`mode: system`). Поля `proxyMode` / `proxyProfileId` в API игнорируются.

Эндпоинты `/settings/proxy-profiles*` отвечают `410` с кодом `PROXY_PROFILES_DISABLED`.

Флаг `CUSTOM_PROXY_ENABLED` по умолчанию `false` (legacy, UI/API профилей не включает).
