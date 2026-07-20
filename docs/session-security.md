# Session security

- Cookie: `HttpOnly`, `SameSite=Strict`, `Secure` (production / `AUTH_COOKIE_SECURE`).
- В SQLite хранится только `session_token_hash` и `csrf_token_hash`.
- TTL + idle timeout; logout / disable / password change отзывают сессии.
- CSRF: заголовок `X-CSRF-Token` для POST/PATCH/PUT/DELETE; токен при login или `GET /auth/csrf` (rotate).
- CORS: только `APP_ALLOWED_ORIGINS`; без credentials + `*`.
- Rate limits: login / API / LLM / write.
- Headers: CSP, nosniff, Referrer-Policy, Permissions-Policy, frame deny, HSTS в production HTTPS.
- `X-Forwarded-For` учитывается только при `APP_TRUST_PROXY=true`.

Service webhooks (`/communication-events`, `/bitrix/event`) — отдельный principal, без session CSRF.

## Go-Live

- `AUTH_MAX_ACTIVE_SESSIONS_PER_USER` — при превышении отзываются старейшие активные сессии
- Frontend write только через `apiClient.js` + `X-CSRF-Token` — см. [frontend-csrf-audit](../reports/frontend-csrf-audit.md)
- `npm run test:go-live` проверяет CSRF coverage маршрутов и apiClient
