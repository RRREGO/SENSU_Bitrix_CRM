# Access control

Режимы: `APP_ACCESS_MODE=local_only|authenticated`.

## local_only

Доступ только с `APP_ALLOWED_IPS` (по умолчанию localhost). Для API без сессии подставляется synthetic local principal (для разработки). Внешний IP → `APP_ACCESS_RESTRICTED`.

## authenticated

Требуется серверная сессия (cookie HttpOnly). Identity из frontend (`userId`/`role`) игнорируется.

## Bootstrap admin

При пустой `app_users` создаётся администратор из `APP_BOOTSTRAP_ADMIN_*`. Пустой пароль запрещён. Повторный старт не перезаписывает пароль. После создания: `must_change_password=true`, удалите пароль из `.env`.

## Backfill ownership

Для строк до v7 поля `*_by_user_id` / `owner_user_id` могут быть `null`. Новый код заполняет их из session principal.

## Communication gate

`COMMUNICATION_SEND_ENABLED=false` блокирует commit отправки (`COMMUNICATION_SEND_DISABLED`). Включать только после live smoke; в production override `COMMUNICATION_ALLOW_UNVERIFIED_SEND_DEV` запрещён.

См. также: [user-roles.md](./user-roles.md), [session-security.md](./session-security.md).

## Go-Live

- `GET /admin/go-live-readiness` — сводка готовности (session + `settings.view` / `audit.view`)
- `ROUTE_POLICIES` — явные политики для каждого API-маршрута; self-audit при старте
- `npm run test:go-live` / `npm run check:go-live` — см. [go-live-security.md](./go-live-security.md)
