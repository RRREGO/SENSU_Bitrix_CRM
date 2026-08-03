/**
 * Speech-to-text via configured AI provider (OpenAI-compatible /audio/transcriptions).
 */

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { getConnectionsFeatureFlags } from "../config.js";
import { ConnectionError, CONNECTION_ERROR_CODES } from "../errors.js";
import { getUserAiSettings } from "../ai/modelResolver.js";
import { getAiProviderById, listAiProviders } from "../../database/repositories/aiProvidersRepository.js";
import { getAdapterForProvider } from "../ai/adapters.js";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function transcribeAudio({
  audioBase64,
  mimeType = "audio/webm",
  userId = null,
  language = null,
  durationSec = null,
} = {}) {
  const flags = getConnectionsFeatureFlags();
  if (!flags.voiceInputEnabled) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      "Голосовой ввод отключён (VOICE_INPUT_ENABLED=false)."
    );
  }

  const settings = getUserAiSettings(userId) || {};
  const maxDur = settings.voiceMaxDurationSec || 60;
  if (durationSec != null && Number(durationSec) > maxDur) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      `Превышена максимальная длительность записи (${maxDur} с).`
    );
  }

  if (!audioBase64) {
    throw new ConnectionError(CONNECTION_ERROR_CODES.INVALID_CONFIGURATION, "Аудио не передано.");
  }
  const buf = Buffer.from(String(audioBase64).replace(/^data:[^;]+;base64,/, ""), "base64");
  if (!buf.length) {
    throw new ConnectionError(CONNECTION_ERROR_CODES.INVALID_CONFIGURATION, "Пустое аудио.");
  }
  if (buf.length > MAX_AUDIO_BYTES) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      "Аудио превышает лимит 25 МБ."
    );
  }

  let provider = settings.speechProviderId ? getAiProviderById(settings.speechProviderId) : null;
  if (!provider) {
    provider =
      listAiProviders({ onlyEnabled: true }).find((p) =>
        ["openai", "openai_compatible", "ollama"].includes(p.providerType)
      ) || null;
  }
  if (!provider) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      "Не настроен провайдер распознавания речи (OpenAI-compatible)."
    );
  }

  const adapter = getAdapterForProvider(provider);
  if (typeof adapter.transcribe !== "function") {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.UNSUPPORTED_CAPABILITY,
      "Выбранный провайдер не поддерживает транскрипцию."
    );
  }

  const lang =
    settings.speechAutoDetect ? null : language || settings.speechLanguage || "ru";

  let tmpPath = null;
  try {
    if (settings.keepAudio) {
      tmpPath = path.join(os.tmpdir(), `voice-${crypto.randomUUID()}.webm`);
      fs.writeFileSync(tmpPath, buf);
    }

    const result = await adapter.transcribe(provider, {
      audioBuffer: buf,
      mimeType,
      language: lang,
      model: settings.speechModel || "whisper-1",
    });

    return {
      success: true,
      text: String(result.text || "").trim(),
      language: result.language || lang,
      providerId: provider.id,
      autoSend: false,
    };
  } finally {
    if (tmpPath && !settings.keepAudio) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    } else if (tmpPath && settings.keepAudio) {
      // keep until process ends — documented limitation; prefer delete after success
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }
  }
}
