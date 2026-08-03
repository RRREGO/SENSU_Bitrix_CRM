# План внедрения: прокси, промпты, AI-модели, голос, Wazzup/email

Дата: 2026-08-03  
Основание: `reports/ai-communications-feature-audit.md`

## Принципы

1. Расширять существующие модули, не создавать параллельный Hub / chat / Safety.
2. Env Anthropic + LLM proxy остаются system fallback.
3. Секреты — только через `SecretsService` (AES-256-GCM, master key из env).
4. Внешняя отправка — только Safety Executor → outbox.
5. Feature flags default = безопасный режим.

## Этапы

### Этап A — Фундамент (зависимости для всего)

| Работа | Детали |
| ------ | ------ |
| Миграция v15 | `proxy_profiles`, `ai_providers`, `ai_provider_secrets`, `ai_models`, `ai_provider_checks`, расширения `profiles` / `prompt_profile_versions` / `prompt_profile_assignments`, `smtp_accounts`, `voice_settings`, колонки chat/project model+prompt |
| `SecretsService` | encrypt/decrypt, mask, never log plaintext |
| `connections/errors.js` | унифицированные коды ошибок |
| `ProxyResolver` | none / system / profile → undici dispatcher |
| Feature flags | `CUSTOM_PROXY_ENABLED`, `PROMPT_PROFILES_ENABLED`, `USER_AI_PROVIDERS_ENABLED`, `CHAT_MODEL_SELECTION_ENABLED`, `VOICE_INPUT_ENABLED`, `VOICE_OUTPUT_ENABLED`, `WAZZUP_CHAT_SEND_ENABLED`, `EMAIL_SEND_ENABLED`, `EMAIL_DRY_RUN` |
| Permissions | `manage_ai_providers`, `use_ai_provider`, `manage_ai_models`, `select_chat_model`, `manage_prompt_profiles`, `assign_prompt_profiles`, `manage_proxy_profiles`, `use_proxy_profiles`, `use_voice_input`, `manage_communication_accounts`, `send_wazzup_messages`, `send_email_messages`, `view_communication_audit`, `approve_external_send` (+ aliases в существующих communication.* где уместно) |

### Этап B — Функция 4 (прокси)

- Repository + service + test connection (safe audit).
- API `/api/settings/proxy-profiles` (в стиле проекта: `/settings/proxy-profiles`).
- UI: Настройки → Прокси.
- Привязка proxy_profile_id к AI/SMTP/Wazzup clients через ProxyResolver (не глобальный env override).

### Этап C — Функция 5 (промпт)

- Расширить `profiles` полями: `base_instruction`, `response_language`, `response_style`, `formatting_rules`, `version`.
- Таблицы versions + assignments (user/project/chat).
- `PromptCompiler` централизует сборку; `contextBuilder` делегирует.
- UI: редактор, переменные, preview (полная system часть — только admin/settings.manage).

### Этап D — Функции 6–7 (провайдеры и модель в чате)

- Adapters: anthropic, openai, openai-compatible, gemini.
- Registry + sync models + test connection.
- `ModelResolver`: chat → project → user default → system env Anthropic.
- Интеграция в `chatAgent` / LLM client facade (не ломать tool loop).
- UI: Настройки → ИИ и модели; селектор в chat meta.
- Metadata сообщений: providerId, modelId, apiModelName, correlationId, streaming, tools, status.

### Этап E — Функция 8 (голос)

- `POST /voice/transcribe` (multipart), Speech adapter (OpenAI-compatible Whisper / Anthropic если недоступно — через выбранный STT provider).
- UI: mic у composer; без автоотправки.
- Опциональный TTS button если capability есть.
- Голосовой текст → тот же `/chat` pipeline.

### Этап F — Функция 9 (Wazzup + email)

- Chat UI «Отправить через» → prepare через существующие communication actions / messageService.
- SMTP accounts + `smtpEmailAdapter` в channelRegistry (canSend при флаге).
- Outbox worker: email transport.
- Dry-run default; real send за флагами + certification pattern где применимо.
- Settings → Каналы → Электронная почта.

### Этап G — Тесты и документация

- `scripts/test-ai-connections.js` (unit/integration mocks).
- Обновить `.env.example`, README, docs/*.md, итоговый report.

## Порядок миграций

1. v15_ai_communications_connections (все новые таблицы + ALTER)
2. Rollback не поддерживается runner'ом — только additive; документировать ручной rollback SQL.

## Backend endpoints (канон проекта без `/api` префикса)

```
GET/POST    /settings/proxy-profiles
GET/PATCH/DELETE /settings/proxy-profiles/:id
POST        /settings/proxy-profiles/:id/test

GET/POST/PATCH /profiles  (расширенные поля)
POST        /profiles/:id/duplicate
GET         /profiles/:id/versions
POST        /profiles/:id/versions/:vid/restore
POST        /profiles/preview

GET/POST    /settings/ai/providers
GET/PATCH/DELETE /settings/ai/providers/:id
POST        /settings/ai/providers/:id/test
POST        /settings/ai/providers/:id/sync-models
GET/POST/PATCH/DELETE /settings/ai/models[/:id]

PATCH       /chats/:id  (modelId / promptProfileId)
GET         /settings/ai/models/available  (для селектора чата)

POST        /voice/transcribe
POST        /voice/synthesize  (optional)

GET/POST    /settings/email/accounts
...
POST        /settings/email/accounts/:id/test
POST        /chat/external-send/prepare  (обёртка над Hub prepare)
```

## Frontend

Настройки: поднавигация ИИ / Промпты / Прокси / Голос / Каналы.  
Чат: model select, mic, external send menu, prompt indicator.

## Тесты (обязательный прогон)

```
npm run test:safety
npm run test:communications
npm run test:workspace
npm run test:access
node scripts/test-ai-connections.js
```

## Зависимости между этапами

A → B,C,D,E,F  
D зависит от B (proxy на провайдере)  
E зависит от D (speech provider из AI registry) или минимальный openai-compatible STT  
F зависит от B (SMTP proxy) и существующего Hub
