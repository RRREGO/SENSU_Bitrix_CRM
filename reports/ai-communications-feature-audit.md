# Аудит: AI-подключения, прокси, промпты, голос, Wazzup/email

Дата: 2026-08-03  
Проект: `bitrix-claude-local-bridge`  
Стек: Node.js 20+, Express, SQLite (WAL), undici, vanilla JS frontend

## Сводная таблица

| Функция | Реализовано | Частично | Отсутствует | Где находится | Что требуется |
| ------- | ----------: | -------: | ----------: | ------------- | ------------- |
| 4. Пользовательский прокси | | да | | `src/llm/transport.js`, env `LLM_PROXY_*` / `ANTHROPIC_PROXY` | Профили в БД, UI «Настройки → Прокси», ProxyResolver per-client, тест без утечки секретов |
| 5. Базовый профиль промпта | | да | | `profiles`, UI «Базовый профиль», `contextBuilder.js`, `toolDefinitions.js` | PromptCompiler с жёсткой иерархией, версии, переменные, preview, chat/project assignments |
| 6. Подключение моделей по API | | | да | Только Anthropic через env (`claudeClient.js`) | Реестр провайдеров/моделей, шифрование ключей, adapters, sync/test API |
| 7. Выбор модели в чате | | да | | `chats.model_name` (пишется из env), без UI | Селектор в чате, иерархия chat→project→user→system, metadata сообщений |
| 8. Голосовое управление | | | да | `meeting_transcripts` — только текстовая вставка | Mic → STT → поле ввода (без автоотправки), speech adapter |
| 9a. Отправка Wazzup | да | | | Communications Hub, outbox, Safety, certification, dry-run | Кнопка «Отправить через» в чате поверх существующего Hub |
| 9b. Отправка email | | да | | Draft (`client_message_draft`), `bitrixEmailAdapter` send=off | SMTP-аккаунты, adapter в Hub, Safety+outbox, UI каналов |
| Safety Executor | да | | | `src/safety/executor.js`, confirmation tokens | Внешние send только через него |
| RBAC / CSRF | да | | | `permissions.js`, `routePolicies.js`, CSRF middleware | Новые permissions для AI/proxy/voice/send |
| Secrets storage | | да | | Запрет секретов в `app_settings`; ключи только в env | `SecretsService` + encrypted columns |
| Feature flags (comms) | да | | | `COMMUNICATIONS_*`, conflict → safe mode | Доп. флаги CUSTOM_PROXY / AI / VOICE / EMAIL |
| Аудит / redact | да | | | `operation_events`, `redact.js`, logger | Расширить события без секретов |

---

## Архитектура чат-модуля

1. UI: `public/js/chat.js` + `public/index.html` (composer, confirmation panel).
2. HTTP: `POST /chat`, `POST /chat/confirm` (`server.js`).
3. Агент: `src/chatAgent.js` — сессия в памяти, tool loop Anthropic Messages API.
4. Контекст: `src/workspace/contextBuilder.js` собирает system prompt + history.
5. Tools: `run_bitrix_action` → action registry → Safety Executor для write.
6. Persistence: `chats`, `messages` (plain text only; metadata_json).

## Выбор модели сейчас

- Единственный источник: `process.env.CLAUDE_MODEL` (default `claude-opus-4-8`).
- При создании чата `model_name` копируется из env; UI смены нет.
- `claudeClient.js` всегда бьёт в `api.anthropic.com` с `ANTHROPIC_API_KEY`.

## Формирование system prompt

Порядок в `contextBuilder.js` (фактически):

1. Safety block (жёсткий текст).
2. `buildChatSystemPrompt` = baseRules + релевантный action catalog (+ discovery hint).
3. Блок активного `profiles` (или profile проекта).
4. Инструкция проекта.
5. Файлы проекта / summary / CRM bindings / CRM context (с бюджетом и обрезкой).

Отдельного PromptCompiler нет; иерархия близка к ТЗ, но без версий, переменных `{{...}}` и chat-level prompt assignment. Пользовательский профиль не может снять safety-блок (он выше), но нет явной защиты от «инструкций игнорировать правила» на уровне компилятора.

## Провайдеры ИИ

Поддерживается только Anthropic Messages API. OpenAI / Gemini / Ollama / OpenAI-compatible — отсутствуют.

## Хранение секретов

- API keys / proxy passwords / webhooks — только env.
- `settingsRepository` запрещает ключи с `API_KEY|PASSWORD|TOKEN|SECRET|PROXY`.
- Redaction в логах и audit (`redact.js`, observability logger).
- Шифрования секретов в SQLite нет.

## Wazzup

Полноценный Communications Hub:

- `providers/wazzupProvider.js`, client, webhooks
- channels, threads, templates, campaigns, sequences
- `communication_outbox` + worker/scheduler
- certification, provider snapshots
- policies: quiet hours, spam, notouch, consent
- dry-run / send flags с conflict → send off + dry-run on
- LLM actions: `communication_message_send_prepare` → Safety → outbox

В чате нет удобного UX «Отправить через Wazzup»; сценарий идёт через actions / раздел Коммуникации.

## Email

- Черновики: `client_message_draft` channel=email.
- Legacy adapter `bitrix_email`: detect read-only, send явно отключён.
- SMTP исходящей почты нет.
- Notification center намеренно не шлёт email наружу.

## Safety Executor и внешние операции

Write/send готовятся через prepare → confirmation token / phrase → commit → executor.  
Communications: на `__execute` только enqueue outbox, не прямой provider.send.  
Требование ТЗ соблюдено существующей архитектурой — новые send (SMTP) должны идти тем же путём.

## Что переиспользовать

| Компонент | Использование |
| --------- | ------------- |
| `llm/transport.js` ProxyAgent | Основа ProxyResolver |
| `profiles` + UI | Расширить до prompt profiles |
| `contextBuilder` | Обернуть PromptCompiler |
| `claudeClient` | Стать AnthropicAdapter + legacy fallback |
| Communications Hub / outbox / Safety | Wazzup send + новый SMTP provider |
| `redact.js`, audit operations | Все новые проверки/отправки |
| RBAC + routePolicies + CSRF | Новые endpoints |
| Feature flag pattern из `communications/config.js` | Новые флаги AI/proxy/voice/email |
| `chats.model_name`, `messages.metadata_json` | Выбор модели и метаданные ответа |

## Конфликты и техдолг

1. Жёсткая привязка chatAgent → Anthropic tool schema; multi-provider потребует нормализации tool calling.
2. Два параллельных outbound пути: legacy `outbound_messages` (client context) и Hub `communication_outbox` — email лучше вести в Hub.
3. Env-прокси LLM глобален для Claude; нельзя смешивать с пользовательскими профилями без явного resolver per-request.
4. `profiles` уже называется «Базовый профиль» — дублировать `prompt_profiles` опасно; расширять существующее.
5. `bitrixEmailAdapter` заглушка send — заменить/дополнить SMTP-адаптером, не вторым Hub.
6. Нет typecheck/lint toolchain (чистый JS) — тесты через `scripts/test-*.js`.

## Риски обратной совместимости

- Сохранение `ANTHROPIC_API_KEY` + `CLAUDE_MODEL` + `LLM_PROXY_*` как system default.
- Не удалять `COMMUNICATION_SEND_ENABLED` alias.
- Не ломать существующие `/profiles` API.
- Миграции только additive (следующая версия 15+).
- Feature flags по умолчанию безопасны: email dry-run on, real send off, user providers opt-in.
