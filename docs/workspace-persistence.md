# Workspace Persistence (SQLite v2)

Постоянное хранение пользовательской части CRM Assistant в **той же** SQLite, что и Safety Layer.

## Важно

- Несколько диалогов переживают перезапуск сервера.
- Проекты с инструкцией и файлами `.md` / `.txt`.
- Глобальный базовый профиль.
- Поиск по чатам, сообщениям и проектам.
- Сводки длинных диалогов и бюджет контекста для Claude.

## База данных

Путь:

```env
APP_DATABASE_PATH=data/operations.sqlite
```

Если переменная не задана, используется `BITRIX_OPERATIONS_DB_PATH` или `data/operations.sqlite`.

Файл БД **не переименовывается** автоматически. Таблицы Safety Layer (`operations`, `operation_items`, `operation_events`, `schema_migrations`) сохраняются.

### Миграция

- `v1` — operations / safety
- `v2` (`v2_user_workspace`) — profiles, projects, project_files, chats, messages, chat_summaries, app_settings
- `v3` (`v3_production_hardening`) — chat/message/project ids на operations
- `v4` (`v4_client_context`) — meeting_transcripts, meeting_protocol_templates, meeting_protocols
- `v12` — pins for chats/projects
- `v13` (`v13_project_workspace_ux`) — `color_key`, `sort_order`, `crm_bindings_json` on projects; API aliases `lastActivityAt`

См. [client-context.md](./client-context.md) и [meeting-workflow.md](./meeting-workflow.md).

Опционально создаётся FTS5-индекс `workspace_search`. Если FTS5 недоступен, поиск работает через `LIKE` с предупреждением в логе.

## Таблицы

| Таблица | Назначение |
|--------|------------|
| `profiles` | Базовые профили (активен один) |
| `projects` | Проекты и инструкции |
| `project_files` | Текст `.md`/`.txt` в SQLite |
| `chats` | Диалоги, статус, CRM-привязка, `session_id` |
| `messages` | Только безопасный plain text |
| `chat_summaries` | Сводки старой части диалога |
| `app_settings` | Несекретные настройки |

## Что нельзя сохранять в messages

- `tool_use` / `tool_result`
- execution token, API keys, webhook URL
- сырые ответы Bitrix24

Сохраняются: текст пользователя, финальный ответ ассистента, preview подтверждения, безопасный operation result, ошибки без секретов.

Технические tool-блоки живут только в runtime-кэше одного запроса Claude.

## Базовый профиль

Настройки → Базовый профиль. Применяется ко всем чатам. Приоритет:

1. Safety policy  
2. Системные правила приложения  
3. Базовый профиль  
4. Инструкция проекта  
5. Текущий запрос пользователя  

Проектная инструкция не может отключить подтверждения или обойти Safety Layer.

## Проекты и файлы

- `.md` / `.txt`, UTF-8
- до 2 МБ на файл, до 50 файлов на проект
- проверка расширения/MIME, нормализация имени, защита от path traversal
- hash содержимого

## Чаты и API

| Метод | Путь | Описание |
|-------|------|----------|
| GET/POST | `/chats` | Список / создание |
| GET/PATCH/DELETE | `/chats/:id` | Метаданные / правка / архив |
| GET | `/chats/:id/messages` | Пагинация `beforeId`, `limit` |
| POST | `/chats/:id/restore` | Из архива |
| GET/POST/PATCH | `/projects` … | Проекты |
| GET/POST/DELETE | `/projects/:id/files` | Файлы |
| GET/POST/PATCH | `/profiles` … | Профили |
| GET | `/search?q=` | Поиск |
| POST | `/chat` | `{ chatId, message }` (+ `sessionId`) |
| POST | `/chat/confirm` | Подтверждение |
| POST | `/chat/reset` | Новый чат, без физического удаления |

`/chat/reset` закрывает runtime-контекст и создаёт новый `chatId`. История старого чата остаётся в SQLite.

## Контекст Claude

Сервис `buildConversationContext`:

системный prompt → Safety → профиль → инструкция проекта → релевантные файлы → summary → последние сообщения → текущий запрос.

Параметры:

```env
CHAT_RECENT_MESSAGES_LIMIT=30
CHAT_CONTEXT_MAX_CHARS=120000
PROJECT_CONTEXT_MAX_CHARS=80000
CHAT_AUTO_SUMMARY_ENABLED=true
CHAT_AUTO_SUMMARY_THRESHOLD_MESSAGES=40
```

При ошибке summary чат продолжает работу с усечением recent messages.

## CRM-привязка

Поля чата: `crm_entity_type`, `crm_entity_id` (`contact` / `lead` / `deal` / `company`).
Карточка Bitrix не подгружается автоматически при каждом открытии чата.

## Миграция с RAM

Старая история в оперативной памяти **не импортируется** после перезапуска. Новые сообщения пишутся только в SQLite. `sessionId` на переходный период сопоставляется с `chats.session_id`.

Pending write-операции после рестарта восстанавливаются из таблицы `operations` (см. [production-hardening.md](./production-hardening.md)).

## Backup / Health

```bash
npm run db:backup
npm run db:check-backup
```

Проверка считает operations + profiles/projects/chats/messages/… без вывода текстов сообщений.

`/health` возвращает `database.migrationVersion` и `workspace.search` (`fts5` | `like`).

## Тесты

```bash
npm run test:workspace
```

Использует временную SQLite и включает регрессию safety/analytics.

## Ограничения

- Один активный профиль
- Только Markdown/TXT (без PDF/DOCX/XLSX)
- Нет embeddings / vector DB
- Подтверждения живут в runtime до перезапуска процесса
- Нет многопользовательской авторизации
