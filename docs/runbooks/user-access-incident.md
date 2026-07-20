# Runbook: инцидент доступа пользователя

## Симптомы

- Подозрение на компрометацию учётки
- Несанкционированные операции в audit
- Утечка сессии

## Действия

1. Отключить пользователя: `PATCH /users/:id` → `isActive: false` (users.manage)
2. Revoke sessions — смена пароля пользователя принудительно
3. Проверить `auth_events` и `operations` по `user_id`
4. При массовом инциденте: `APP_MAINTENANCE_MODE=true`, ротация `AUTH_COOKIE` path/name не требуется — revoke sessions
5. Сменить bootstrap/скомпрометированные пароли
6. Проверить CSRF и origin (`APP_ALLOWED_ORIGINS`)

## Профилактика

`AUTH_MAX_ACTIVE_SESSIONS_PER_USER`, secure cookie, HTTPS only.
