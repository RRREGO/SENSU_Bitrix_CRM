# Безопасный транспорт к LLM API

Рекомендуемая схема для работы с клиентскими данными:

```text
Bitrix CRM Assistant (локальная/корпоративная сеть)
        │
        │ HTTPS CONNECT
        ▼
Собственный VPS-прокси (только ваш)
        │
        │ HTTPS
        ▼
Anthropic API
```

## Режимы

| `LLM_PROXY_MODE` | Назначение |
|------------------|------------|
| `none` | Прямое соединение с Anthropic (если сеть позволяет) |
| `corporate` | Корпоративный HTTPS-прокси |
| `self_hosted` | Собственный VPS как CONNECT/HTTPS proxy |

Если `ANTHROPIC_PROXY` / `LLM_PROXY_URL` задан, а `LLM_PROXY_MODE` не указан, режим становится `corporate`. Явный `LLM_PROXY_MODE=none` по-прежнему идёт напрямую и игнорирует прокси.

Публичный «случайный» proxy не поддерживается.

## Требования к VPS

- Доступ только с IP сервера приложения (firewall / allowlist).
- Отдельный пользователь ОС, без root для сервиса proxy.
- Регулярные обновления ОС.
- TLS включён; verification на стороне приложения включена.
- Access/body logs отключены или только метаданные (без содержимого запросов).
- Ротация credentials; fail2ban / rate limit на вход.
- Запрет open proxy (нельзя использовать без auth из интернета).
- Мониторинг диска и сервиса.
- Нет кеширования тел запросов.
- Способ быстро отключить proxy (`LLM_PROXY_MODE=none` или смена URL).

## Конфигурация приложения

```env
LLM_PROXY_MODE=self_hosted
LLM_PROXY_URL=https://proxy.example:8443
LLM_PROXY_USERNAME=app
LLM_PROXY_PASSWORD=
LLM_PROXY_CA_CERT_PATH=/path/to/ca.pem
LLM_PROXY_ALLOW_INSECURE_TLS=false
LLM_LOG_PAYLOADS=false
```

Не храните пароль в SQLite и не передавайте его через frontend.  
Проверка: `POST /settings/llm-transport/test`.

## Что не логировать

- system prompt, сообщения, project files, CRM fields, tool results, переписку.

Логировать: provider, model, requestChars, responseChars, durationMs, proxyMode, status.
