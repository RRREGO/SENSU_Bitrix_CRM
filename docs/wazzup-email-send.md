# Отправка через Wazzup и email

## Wazzup

Используется существующий Communications Hub (channels, outbox, policies, certification, dry-run).

Из чата: меню **Ещё → Отправить через Wazzup** → `POST /chat/external-send/prepare` → preview → подтверждение через Safety / operation confirm → outbox.

Flag: `WAZZUP_CHAT_SEND_ENABLED` (+ канонические `COMMUNICATIONS_*`).

## Email (SMTP)

**Настройки → Электронная почта**: SMTP-аккаунты.

- Пароль шифруется  
- Проверка соединения без отправки письма  
- Провайдер Hub `smtp`  
- Реальная отправка: `EMAIL_SEND_ENABLED=true` и `EMAIL_DRY_RUN=false`  
- По умолчанию dry-run  

HTML очищается от script/on*=/javascript:.

IMAP и delivery/read tracking не реализованы.

## Подтверждение

ИИ не может подтвердить отправку сам. Схема: draft → policy → confirmation token → outbox → worker.
