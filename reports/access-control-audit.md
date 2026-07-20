# Аудит точек доступа (до этапа Auth/RBAC → целевое состояние)

Дата: 2026-07-14  
До этапа: почти все browser endpoints — `unsafe_missing_auth`.  
После этапа: статусы ниже (целевые).

| Метод | Путь | R/W | Данные | Было | Permission / режим | Anon | CSRF | Rate | Статус |
|-------|------|-----|--------|------|--------------------|------|------|------|--------|
| GET | `/health` | R | liveness | открыт | none | да | нет | API | `public_safe` (минимальный) |
| GET | `/health/details` | R | диагностика | — | `settings.view` | нет | нет | API | `authenticated` |
| POST | `/auth/login` | W | credentials | — | local/auth mode | да* | нет | login | `public_safe` |
| POST | `/auth/logout` | W | session | — | session | нет | да | API | `authenticated` |
| GET | `/auth/me` | R | identity | — | session | нет | нет | API | `authenticated` |
| GET | `/auth/csrf` | R | csrf | — | session | нет | нет | API | `authenticated` |
| POST | `/auth/change-password` | W | password | — | session | нет | да | login | `authenticated` |
| GET/POST | `/users*` | R/W | users | — | `users.manage` | нет | да* | API | `admin_only` |
| GET/PATCH | `/roles*` | R/W | roles | — | `roles.manage` | нет | да* | API | `admin_only` |
| POST | `/chat` | W | LLM/CRM | нет auth | `chats.manage.own` | нет | да | LLM | `authenticated` |
| POST | `/chat/confirm` | W | Safety | нет | `operations.confirm.*` | нет | да | write | `authenticated` |
| POST | `/bitrix/action` | R/W | Safety | нет | policy perms | нет | да | write | `authenticated` |
| GET | `/operations*` | R | audit | нет | `operations.view.*` | нет | нет | API | `authenticated` |
| POST | `/operations/*/cancel\|rollback*` | W | Safety | нет | confirm/rollback | нет | да | write | `authenticated` |
| * | `/message-drafts*` | R/W | drafts | нет | `communications.*` | нет | да* | API | `authenticated` |
| * | `/outbound-messages*` | R | outbound | нет | `communications.view.*` | нет | да* | API | `authenticated` |
| POST | `/communication-events/:channel` | W | delivery | token | service token | service | нет | webhook | `service_token` |
| POST | `/bitrix/event` | W | Bitrix | outbound token | service | service | нет | webhook | `service_token` |
| * | `/scheduled-reports*` | R/W | schedules | нет | `schedules.*` | нет | да* | API | `authenticated` |
| * | `/notifications*` | R/W | notifs | global read | `notifications.view` | нет | да* | API | `authenticated` |
| * | `/projects*`, `/chats*`, `/profiles*` | R/W | workspace | нет | projects/chats/profiles | нет | да* | API | `authenticated` |
| * | `/crm/context*` | R | PII-ish | нет | `crm.context.read` | нет | да* | API | `authenticated` |
| POST | `/test/claude` | W | LLM | нет | `settings.manage` / blocked prod | нет | да | LLM | `admin_only` / `blocked` |
| GET | static `/`, `/reports` | R | UI/HTML | открыт | local_only gate | зависит | нет | API | `local_only` или auth page |
| GET | `/bitrix/actions` | R | catalog | нет | authenticated | нет | нет | API | `authenticated` |
| GET | `/documents*`, `/reports/quick*` | R/W | docs | нет | `reports.*` | нет | да* | API | `authenticated` |

\* CSRF для state-changing browser requests.  
После этапа не должно остаться `unsafe_missing_auth`.

## local_only vs authenticated

- `APP_ACCESS_MODE=local_only`: IP allowlist; сессия опциональна для перехода, но write всё равно Safety; внешний IP → `APP_ACCESS_RESTRICTED`.
- `authenticated`: обязательная сессия на защищённых endpoints.
