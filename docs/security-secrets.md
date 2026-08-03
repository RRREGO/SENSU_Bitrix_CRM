# Секреты и шифрование

## Master key

`SECRETS_MASTER_KEY` или `APP_SECRETS_MASTER_KEY` — только env.

- 64 hex-символа → raw AES key  
- иначе → scrypt с фиксированной солью приложения  

Ключ **не** хранится в SQLite.

## Что шифруется

- пароли прокси  
- API keys AI-провайдеров  
- SMTP passwords  

Формат: `v1:<iv_b64>:<tag_b64>:<cipher_b64>` (AES-256-GCM).

## Запреты

- секреты в `app_settings`  
- возврат plaintext во frontend после сохранения  
- логирование Authorization / паролей / полных proxy URL с credentials  
- экспорт настроек с секретами  

См. также `src/safety/redact.js` и observability logger.
