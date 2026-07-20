# Action authorization audit

Политики Safety расширены через `withAuthz` в `src/safety/policies.js`.

| Группа actions | Safety access | requiredPermissions | confirm | dataScope | Статус |
|----------------|---------------|---------------------|---------|-----------|--------|
| CRM get/list/analytics read | read | `crm.read.own` (default) / analytics overrides постепенно | — | crm_entity | `ok` |
| crm_context_* | read | `crm.context.read` | — | crm_entity | `ok` |
| client_message_draft | read | `communications.draft` | — | crm_entity | `ok` |
| client_message_send | write high | `communications.send` + `operations.prepare` | `operations.confirm.own` | crm_entity | `ok` |
| deal/lead/contact/task write | write | `operations.prepare` | `operations.confirm.own` | crm_entity | `ok` |
| destructive | destructive | `operations.prepare` | confirm.own | crm_entity | `ok` |
| structural blocked | blocked | settings.manage | — | none | `blocked` |
| Missing ACTION_POLICIES entry | — | — | — | — | `unsafe_missing_policy` (уже блокируется Safety) |

После `getActionPolicy` каждый action имеет `requiredPermissions` либо остаётся blocked. Отсутствие authz после enrichment невозможно для зарегистрированных политик.
