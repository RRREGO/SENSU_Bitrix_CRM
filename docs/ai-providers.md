# Подключение AI-провайдеров

Пользователи с правом `manage_ai_providers` (или `settings.manage`) добавляют провайдеров в **Настройки → ИИ и модели**.

## Типы

- `anthropic` — Anthropic Messages API
- `openai` — OpenAI
- `openai_compatible` — OpenRouter, локальные LLM, корпоративные gateway
- `gemini` — Google Gemini
- `ollama` — локальный OpenAI-compatible endpoint

## Секреты

1. Задайте `SECRETS_MASTER_KEY` в окружении (не в БД).
2. API key шифруется (AES-256-GCM) в `ai_provider_secrets`.
3. После сохранения frontend получает только маску.

## Проверка и модели

- `POST /settings/ai/providers/:id/test` — проверка авторизации/URL
- `POST /settings/ai/providers/:id/sync-models` — список моделей (если API отдаёт)
- Ручное добавление: `POST /settings/ai/models`

## Выбор в чате

Иерархия: модель чата → проекта → пользователя → системный `CLAUDE_MODEL` / `ANTHROPIC_API_KEY`.

CRM tool-calling требует модели с `supportsTools` (или системный Anthropic). Модель без tools не переключается незаметно — пользователь видит ошибку.

## Прокси

Только системный: `LLM_PROXY_*` / `ANTHROPIC_PROXY`. Пользовательский выбор прокси отключён.

## Feature flags

`USER_AI_PROVIDERS_ENABLED`, `CHAT_MODEL_SELECTION_ENABLED`
