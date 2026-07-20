# Runbook: откат релиза

## Когда

- `/health/readiness` failed после деплоя
- Критический баг в новой версии

## Действия

```bash
# Symlink на previous (deploy-release.sh создаёт previous)
sudo ln -sfn /opt/bitrix-crm-assistant/previous /opt/bitrix-crm-assistant/current
sudo systemctl restart bitrix-crm-assistant
curl -s http://127.0.0.1:3005/health/readiness
```

Или: `./deploy/deploy-release.sh <previous-release-id>` с известным good release.

## Важно

- **SQLite не откатывается** автоматически — схема только вперёд (v9+)
- Если новая миграция уже применена — откат кода на старую версию может быть несовместим
- Перед деплоем всегда `npm run db:backup`
