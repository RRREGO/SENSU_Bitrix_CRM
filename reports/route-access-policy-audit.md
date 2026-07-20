# Route access policy audit

Дата: go-live security closure.

## Источник

`src/auth/routePolicies.js` — явные политики `method + path + access + permission + csrf`.

## Self-audit при старте

`auditRoutePolicies(app, { isProduction })` в `server.js`:

- Сопоставляет зарегистрированные Express-маршруты с `ROUTE_POLICIES`
- В **production** отсутствие политики → `UNSAFE_PRODUCTION_ACCESS_CONFIGURATION` (fail-fast)
- В development — `console.warn` со списком missing (до 20)

## CSRF coverage

Все session write (`POST`/`PUT`/`PATCH`/`DELETE`) имеют `csrf: true`, кроме `POST /auth/login`.

Внутренняя проверка `csrfGaps` в `auditRoutePolicies` — пустой список.

## Go-live readiness

`GET /admin/go-live-readiness`:

- `access: session`
- `permission: ["settings.view", "audit.view"]`
- `csrf: false` (read-only)

## Проверка

`npm run test:go-live` — assertions 1, 18; `npm run check:go-live` — `checks.routePoliciesComplete`, `checks.csrfCoverageComplete`.
