# Голосовое управление

Кнопка **Микрофон** в composer чата.

## Сценарий

1. Запись в браузере (MediaRecorder)  
2. `POST /voice/transcribe` (base64 audio)  
3. STT через OpenAI-compatible `/audio/transcriptions`  
4. Текст в поле ввода  
5. Пользователь сам нажимает «Отправить»

Автоотправка отключена. Голосовая CRM-команда идёт в тот же `/chat` → Safety Executor.

## Настройки

**Настройки → Голос**: провайдер STT, модель, язык, макс. длительность.

Аудио по умолчанию не сохраняется.

## Flags

`VOICE_INPUT_ENABLED`, `VOICE_OUTPUT_ENABLED` (TTS опционально, по умолчанию выкл.)

## Ограничения браузера

Нужен HTTPS или localhost; пользователь должен выдать permission микрофона. `Permissions-Policy` разрешает `microphone=(self)`.
