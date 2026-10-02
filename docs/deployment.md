# Развёртывание (pilot)

Краткое руководство по установке на Linux VPS с systemd + nginx.

## Требования

- Ubuntu 22.04+ / Debian 12+
- Node.js 20+
- nginx, systemd
- Пользователь `crmassistant` (не root)

## Каталоги

```text
/opt/bitrix-crm-assistant/
  releases/<release-id>/
  current -> releases/<release-id>
  previous -> releases/<older>
/var/lib/bitrix-crm-assistant/   # APP_DATA_DIR, SQLite
/var/log/bitrix-crm-assistant/   # APP_LOG_DIR (опционально)
/var/backups/bitrix-crm-assistant/  # APP_BACKUP_DIR
/etc/bitrix-crm-assistant/env    # EnvironmentFile
```

## Установка

1. Создать пользователя и каталоги:
   ```bash
   sudo useradd -r -m -d /var/lib/bitrix-crm-assistant crmassistant
   sudo mkdir -p /opt/bitrix-crm-assistant/releases /var/backups/bitrix-crm-assistant
   sudo chown -R crmassistant:crmassistant /opt/bitrix-crm-assistant /var/lib/bitrix-crm-assistant /var/backups/bitrix-crm-assistant
   ```

2. Скопировать релиз в `releases/<id>`, настроить `/etc/bitrix-crm-assistant/env` (см. `.env.example`).

3. Установить unit-файлы:
   ```bash
   sudo cp deploy/systemd/*.service deploy/systemd/*.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now bitrix-crm-assistant.service
   sudo systemctl enable --now bitrix-crm-assistant-backup.timer
   ```

4. nginx:
   - `deploy/nginx/bitrix-crm-assistant.locations.conf` → `/etc/nginx/snippets/`
   - `deploy/nginx/bitrix-crm-assistant.conf` → `/etc/nginx/sites-available/`, symlink в `sites-enabled`
   - канонический хост: `https://agent.goerp.pro`
   - SSL, `nginx -t && systemctl reload nginx`

## Перенос на поддомен `agent.goerp.pro`

1. Создать DNS `A`/`AAAA` для `agent.goerp.pro` на IP VPS.
2. На сервере из каталога релиза:
   ```bash
   sudo ./deploy/migrate-to-agent-subdomain.sh
   ```
   Скрипт ставит nginx-конфиги, выдаёт/подключает сертификат Let's Encrypt, пишет
   `APP_PUBLIC_ORIGIN` / `APP_ALLOWED_ORIGINS` в `/etc/bitrix-crm-assistant/env`,
   перезагружает nginx и сервис.
3. Вручную обновить внешние URL (Wazzup webhook, исходящие вебхуки Bitrix24, MAX при необходимости)
   на `https://agent.goerp.pro/...`.
4. Пока провайдеры ещё стучатся на корень, `goerp.pro` / `www.goerp.pro` продолжают
   проксировать тот же upstream (без `301` для POST). После смены вебхуков legacy-блок можно убрать.

## MCP для ChatGPT

Канонический адрес коннектора: `https://agent.goerp.pro/mcp`.
Аутентификация — OAuth этого же приложения. Включение по умолчанию;
`MCP_ENABLED=false` в EnvironmentFile выключает его. После выкладки nginx
нужен `location = /mcp` с `proxy_buffering off` (см. `deploy/nginx/`).

## Деплой нового релиза

```bash
DRY_RUN=1 ./deploy/deploy-release.sh <release-id>   # проверка
./deploy/deploy-release.sh <release-id>
```

Скрипт: `npm ci`, опционально `test:pilot`, backup, symlink switch, restart, readiness curl. При ошибке — откат symlink (без downgrade SQLite).

## Проверки

```bash
npm run test:pilot
npm run smoke:production   # только с PRODUCTION_SMOKE_TESTS_ENABLED=true
curl -s http://127.0.0.1:3005/health/readiness
```

См. [pilot-checklist.md](./pilot-checklist.md), [backup-and-restore.md](./backup-and-restore.md), [observability.md](./observability.md).

## Communications Hub

Перед включением реальной отправки на стенде задайте в EnvironmentFile только безопасные флаги: `COMMUNICATIONS_ENABLED`, `COMMUNICATIONS_DRY_RUN=true`, `COMMUNICATIONS_SEND_ENABLED=false`. Секреты Wazzup — только в env. Подробнее: [communications.md](./communications.md).
