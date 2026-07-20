# Frontend CSRF audit

Дата: go-live security closure.

## Правило

Все state-changing запросы из браузера — только через `public/apiClient.js` с заголовком `X-CSRF-Token` для `POST` / `PUT` / `PATCH` / `DELETE`.

## Статус `fetch(` в public/

| Файл | `fetch(` | Статус |
|------|----------|--------|
| `public/apiClient.js` | да (единственный разрешённый) | csrf_protected |
| `public/js/auth.js` | нет | apiClient |
| `public/js/chat.js` | нет | apiClient |
| `public/js/workspace.js` | нет | apiClient |
| `public/js/reports.js` | нет | apiClient |
| `public/js/documents.js` | нет | apiClient |
| `public/js/history.js` | нет | apiClient |
| `public/js/notifications.js` | нет | apiClient |
| `public/js/schedules.js` | нет | apiClient |
| `public/js/outbound.js` | нет | apiClient |
| `public/js/meetings.js` | нет | apiClient |
| `public/js/settings.js` | нет | apiClient |
| `public/js/utils.js` | нет | — |
| `public/js/dateUtils.js` | нет | — |
| `public/js/reportHistory.js` | нет | apiClient |
| `public/app.js` | нет | apiClient |

## apiClient write coverage

- `STATE = { POST, PUT, PATCH, DELETE }`
- Авто-refresh CSRF при `CSRF_VALIDATION_FAILED`
- Экспорты: `apiGet`, `apiPost`, `apiPatch`, `apiPut`, `apiDelete`

Проверка: `npm run test:go-live` (assertions 2, 3, 19).
