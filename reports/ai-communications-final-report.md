# Итоговый отчёт: AI-подключения, прокси, промпты, голос, Wazzup/email

Дата: 2026-08-03  
Проект: `bitrix-claude-local-bridge`

Аудит: [ai-communications-feature-audit.md](./ai-communications-feature-audit.md)  
План: [ai-communications-implementation-plan.md](./ai-communications-implementation-plan.md)

## 1. Что было обнаружено

| Функция | Было |
| ------- | ---- |
| 4. Прокси | Частично: env LLM proxy (`LLM_PROXY_*`, `ANTHROPIC_PROXY`) |
| 5. Профиль промпта | Частично: `profiles` + project instruction + contextBuilder |
| 6. AI providers UI/API | Отсутствовало (только Anthropic env) |
| 7. Выбор модели в чате | Частично: `chats.model_name`, без UI/реестра |
| 8. Голос | Отсутствовало (только text transcript встреч) |
| 9. Wazzup | Реализовано (Hub + Safety + outbox + dry-run) |
| 9. Email send | Частично: draft only, SMTP отсутствовал |

Переиспользованы: Safety Executor, Communications Hub/outbox, profiles, contextBuilder→PromptCompiler, redact/audit, RBAC/CSRF, undici ProxyAgent, feature-flag pattern.

## 2. Что реализовано

### 4. Пользовательский прокси
- Таблица `proxy_profiles`, CRUD API, UI «Настройки → Прокси»
- `ProxyResolver` (none/system/profile), тест без утечки пароля
- Привязка к AI-провайдерам через `proxyMode` / `proxyProfileId`

### 5. Базовый профиль промпта
- Расширены `profiles` + `prompt_profile_versions` + assignments
- `PromptCompiler` с жёсткой иерархией 1–8
- Preview, duplicate, versions/restore, переменные `{{...}}`
- UI вкладка «Профили промптов»

### 6–7. AI-провайдеры и модель в чате
- `ai_providers` / secrets / models / checks
- Adapters: anthropic, openai, openai_compatible, gemini, ollama
- Test + sync-models; селектор модели в чате; metadata сообщений
- Системный Anthropic остаётся fallback; модели без tools блокируются для CRM-чата явно

### 8. Голосовое управление
- Кнопка микрофона → `/voice/transcribe` → текст в input (без автоотправки)
- Настройки голоса; STT через OpenAI-compatible Whisper API
- Permissions-Policy: `microphone=(self)`

### 9. Wazzup + email
- Chat menu «Отправить через» → prepare через Hub
- SMTP accounts + provider `smtp` в outbox worker
- `EMAIL_SEND_ENABLED` / `EMAIL_DRY_RUN` (default dry-run)
- Wazzup certification gates сохранены; email использует собственные флаги

## 3. Изменённые / новые ключевые файлы

| Путь | Назначение |
| ---- | ---------- |
| `src/database/migrations.js` | Миграция v15 |
| `src/connections/**` | Secrets, proxy, AI, prompts, speech, routes |
| `src/database/repositories/{proxy,ai,smtp,profiles}*` | Persistence |
| `src/workspace/contextBuilder.js` | PromptCompiler |
| `src/chatAgent.js` / `claudeClient.js` | Модель + metadata |
| `src/communications/providers/{index,smtpProvider}.js` | SMTP Hub provider |
| `src/communications/communicationScheduler.js` | Email dry-run/send path |
| `src/auth/{permissions,routePolicies,middleware}.js` | RBAC + mic + routes |
| `public/{index.html,app.js,js/chat.js,js/settingsExtended.js,styles.css}` | UI |
| `scripts/test-ai-connections.js` | Тесты |
| `docs/*.md`, `.env.example`, `README.md` | Документация |
| `reports/ai-communications-*.md` | Аудит и план |

## 4. Миграции

- **v15** `v15_ai_communications_connections`
- Таблицы: `proxy_profiles`, `prompt_profile_versions`, `prompt_profile_assignments`, `ai_providers`, `ai_provider_secrets`, `ai_models`, `ai_provider_checks`, `smtp_accounts`, `user_ai_settings`
- ALTER: `profiles` (base_instruction, language, style, formatting, version), `chats` (ai_model_id, ai_provider_id, prompt_profile_id), `projects` (default_ai_model_id, default_prompt_profile_id)
- Индексы на owner/active/provider/model lookups
- Старые миграции не изменялись

## 5. Переменные окружения

| Имя | Назначение | Default | Обязательность |
| --- | ---------- | ------- | -------------- |
| `SECRETS_MASTER_KEY` | Шифрование секретов | — | Для сохранения ключей/паролей |
| `CUSTOM_PROXY_ENABLED` | UI/API прокси | true | нет |
| `PROMPT_PROFILES_ENABLED` | PromptCompiler path | true | нет |
| `USER_AI_PROVIDERS_ENABLED` | DB providers | true | нет |
| `CHAT_MODEL_SELECTION_ENABLED` | Селектор модели | true | нет |
| `VOICE_INPUT_ENABLED` | STT | true | нет |
| `VOICE_OUTPUT_ENABLED` | TTS | false | нет |
| `WAZZUP_CHAT_SEND_ENABLED` | Send из чата | true | нет |
| `EMAIL_SEND_ENABLED` | Реальный SMTP | false | нет |
| `EMAIL_DRY_RUN` | Dry-run email | true | нет |

Сохранены: `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `LLM_PROXY_*`, `COMMUNICATIONS_*`.

## 6. API (новые)

- Proxy: `GET/POST/PATCH/DELETE /settings/proxy-profiles`, `POST .../test`
- AI: `/settings/ai/providers`, `.../test`, `.../sync-models`, `/settings/ai/models`, `/settings/ai/models/available`, `/settings/ai/user`
- Prompt: `/profiles/variables`, `/profiles/preview`, `/profiles/:id/duplicate|versions|assign`
- Voice: `POST /voice/transcribe`
- Email: `/settings/email/accounts`, `.../test`
- Chat: `GET /chats/:id/ai-resolution`, `POST /chat/external-send/prepare`

## 7. Интерфейс

- Настройки: поднавигация Промпты / ИИ / Прокси / Голос / Email
- Чат: селектор модели, индикатор промпта, меню внешней отправки, микрофон

## 8. Безопасность

- Шифрование секретов: да (`SecretsService`)
- Redaction логов: да (существующий + ConnectionError)
- RBAC: новые permissions + aliases
- CSRF: state-changing routes с `csrf: true`
- Safety Executor: внешняя отправка через prepare/confirm/outbox
- Dry-run: email и communications по умолчанию
- Idempotency: Hub outbox keys

## 9. Тесты

| Команда | Результат |
| ------- | --------- |
| `npm run test:ai-connections` | **8/8 PASS** |
| `npm run test:safety` | **31/31 PASS** |
| `npm run test:communications` | **111/111 PASS** |
| `npm run test:workspace` | основные кейсы PASS (включая context после PromptCompiler); полный прогон с nested suites долгий |
| `npm run test:access` | 50+ PASS; завершение soft-regression зависло в среде (не связано с падением assert) |
| lint / typecheck | Нет отдельного toolchain в проекте (чистый JS) |
| frontend/backend build | Отдельного bundler нет; Express + static `public/` |

## 10. Ограничения

- SMTP: исходящая почта; **нет IMAP**, нет гарантированных delivered/read
- STARTTLS send — упрощённый клиент; для production предпочтителен порт 465/TLS
- Non-Anthropic tool loop для CRM: требуется явный `supportsTools`; полный OpenAI tools loop в chatAgent не дублирует весь Anthropic path
- Anthropic sync-models часто пуст (API) — ручное добавление моделей
- Голос: нужен OpenAI-compatible STT endpoint; браузерные ограничения MediaRecorder
- Реальная отправка Wazzup/email требует credentials + снятие dry-run + (для Wazzup) certification
- External send из чата готовит preview; commit — через существующий Safety/operations UX

## 11. Ручной чек-лист

1. Задать `SECRETS_MASTER_KEY` в `.env`
2. Создать прокси-профиль → «Проверить прокси»
3. Создать/обновить профиль промпта → предпросмотр
4. Подключить AI-провайдера → «Проверить» → sync/manual models
5. Выбрать модель в чате → отправить сообщение
6. Записать голос → проверить текст в поле → отправить вручную → подтверждение CRM как обычно
7. Wazzup dry-run из чата / Hub
8. SMTP аккаунт → «Проверить подключение» (без письма)
9. Email dry-run → при необходимости `EMAIL_SEND_ENABLED=true` + `EMAIL_DRY_RUN=false` на тесте
10. Проверить outbox и аудит; убедиться, что в логах нет паролей/ключей
