/**
 * Resolve which AI model to use for a chat turn.
 * Hierarchy: chat → project → user default → system env Anthropic.
 */

import {
  getAiModelById,
  getAiProviderById,
  listAiModels,
  listAiProviders,
} from "../../database/repositories/aiProvidersRepository.js";
import { getDatabase } from "../../database/index.js";
import { getConnectionsFeatureFlags } from "../config.js";
import { ConnectionError, CONNECTION_ERROR_CODES } from "../errors.js";

/** Chat/project selection id for env-based Anthropic models (`system:claude-…`). */
export const SYSTEM_MODEL_ID_PREFIX = "system:";

export function isSystemModelSelectionId(id) {
  return typeof id === "string" && id.startsWith(SYSTEM_MODEL_ID_PREFIX) && id.length > SYSTEM_MODEL_ID_PREFIX.length;
}

export function parseSystemModelSelectionId(id) {
  if (!isSystemModelSelectionId(id)) return null;
  return id.slice(SYSTEM_MODEL_ID_PREFIX.length);
}

export function systemModelSelectionId(apiModelName) {
  if (!apiModelName) return null;
  return `${SYSTEM_MODEL_ID_PREFIX}${apiModelName}`;
}

function resolveSystemModelSelection(selectionId, source, warnings) {
  const apiModelName = parseSystemModelSelectionId(selectionId);
  if (!apiModelName) return null;
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    warnings.push(`Системный Anthropic не настроен (${source}).`);
    return null;
  }
  return {
    source,
    model: {
      id: selectionId,
      apiModelName,
      displayName: apiModelName,
      supportsTools: true,
      supportsVision: true,
      isActive: true,
    },
    provider: null,
    apiModelName,
    useLegacyAnthropic: true,
    warnings,
  };
}

export function getUserAiSettings(userId) {
  if (!userId) return null;
  const row = getDatabase().prepare("SELECT * FROM user_ai_settings WHERE user_id = ?").get(userId);
  if (!row) return null;
  return {
    userId: row.user_id,
    defaultModelId: row.default_model_id,
    defaultProviderId: row.default_provider_id,
    defaultPromptProfileId: row.default_prompt_profile_id,
    speechProviderId: row.speech_provider_id,
    speechModel: row.speech_model,
    speechLanguage: row.speech_language,
    speechAutoDetect: Boolean(row.speech_auto_detect),
    voiceMaxDurationSec: row.voice_max_duration_sec,
    keepAudio: Boolean(row.keep_audio),
    ttsEnabled: Boolean(row.tts_enabled),
    allowModelFallback: Boolean(row.allow_model_fallback),
  };
}

export function upsertUserAiSettings(userId, patch = {}) {
  const ts = new Date().toISOString();
  const cur = getUserAiSettings(userId) || {};
  getDatabase()
    .prepare(
      `INSERT INTO user_ai_settings (
        user_id, default_model_id, default_provider_id, default_prompt_profile_id,
        speech_provider_id, speech_model, speech_language, speech_auto_detect,
        voice_max_duration_sec, keep_audio, tts_enabled, allow_model_fallback, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        default_model_id = excluded.default_model_id,
        default_provider_id = excluded.default_provider_id,
        default_prompt_profile_id = excluded.default_prompt_profile_id,
        speech_provider_id = excluded.speech_provider_id,
        speech_model = excluded.speech_model,
        speech_language = excluded.speech_language,
        speech_auto_detect = excluded.speech_auto_detect,
        voice_max_duration_sec = excluded.voice_max_duration_sec,
        keep_audio = excluded.keep_audio,
        tts_enabled = excluded.tts_enabled,
        allow_model_fallback = excluded.allow_model_fallback,
        updated_at = excluded.updated_at`
    )
    .run(
      userId,
      patch.defaultModelId !== undefined ? patch.defaultModelId : cur.defaultModelId || null,
      patch.defaultProviderId !== undefined ? patch.defaultProviderId : cur.defaultProviderId || null,
      patch.defaultPromptProfileId !== undefined
        ? patch.defaultPromptProfileId
        : cur.defaultPromptProfileId || null,
      patch.speechProviderId !== undefined ? patch.speechProviderId : cur.speechProviderId || null,
      patch.speechModel !== undefined ? patch.speechModel : cur.speechModel || null,
      patch.speechLanguage !== undefined ? patch.speechLanguage : cur.speechLanguage || "ru",
      (patch.speechAutoDetect !== undefined ? patch.speechAutoDetect : cur.speechAutoDetect) ? 1 : 0,
      patch.voiceMaxDurationSec !== undefined
        ? patch.voiceMaxDurationSec
        : cur.voiceMaxDurationSec || 60,
      (patch.keepAudio !== undefined ? patch.keepAudio : cur.keepAudio) ? 1 : 0,
      (patch.ttsEnabled !== undefined ? patch.ttsEnabled : cur.ttsEnabled) ? 1 : 0,
      (patch.allowModelFallback !== undefined ? patch.allowModelFallback : cur.allowModelFallback)
        ? 1
        : 0,
      ts
    );
  return getUserAiSettings(userId);
}

/**
 * @returns {{
 *   source: string,
 *   model: object|null,
 *   provider: object|null,
 *   apiModelName: string,
 *   useLegacyAnthropic: boolean,
 *   warnings: string[]
 * }}
 */
export function resolveChatModel({ chat = null, project = null, userId = null, requireTools = true } = {}) {
  const flags = getConnectionsFeatureFlags();
  const warnings = [];

  const tryModelId = (id, source) => {
    if (!id) return null;
    const systemHit = resolveSystemModelSelection(id, source, warnings);
    if (systemHit) return systemHit;
    const model = getAiModelById(id);
    if (!model || !model.isActive) {
      warnings.push(`Модель ${id} недоступна (${source}).`);
      return null;
    }
    const provider = getAiProviderById(model.providerId);
    if (!provider || !provider.isEnabled) {
      warnings.push(`Провайдер модели отключён (${source}).`);
      return null;
    }
    if (!provider.allowUsers && source !== "system") {
      warnings.push(`Провайдер недоступен пользователям (${source}).`);
      return null;
    }
    if (requireTools && !model.supportsTools && provider.providerType !== "anthropic") {
      warnings.push(
        `Модель «${model.displayName}» не заявлена с поддержкой tools. CRM-действия могут быть недоступны.`
      );
    }
    return { source, model, provider, apiModelName: model.apiModelName, useLegacyAnthropic: false, warnings };
  };

  if (flags.chatModelSelectionEnabled || flags.userAiProvidersEnabled) {
    const chatHit = tryModelId(chat?.aiModelId || null, "chat");
    if (chatHit) return chatHit;

    const projectHit = tryModelId(project?.defaultAiModelId || null, "project");
    if (projectHit) return projectHit;

    const userSettings = getUserAiSettings(userId);
    const userHit = tryModelId(userSettings?.defaultModelId || null, "user");
    if (userHit) return userHit;

    // First enabled anthropic-like DB provider default
    const providers = listAiProviders({ onlyEnabled: true });
    for (const p of providers) {
      if (p.defaultModelId) {
        const hit = tryModelId(p.defaultModelId, "provider_default");
        if (hit) return hit;
      }
      const models = listAiModels({ providerId: p.id, onlyActive: true });
      if (models[0]) {
        const hit = tryModelId(models[0].id, "provider_first");
        if (hit) return hit;
      }
    }
  }

  // System legacy Anthropic
  return {
    source: "system",
    model: null,
    provider: null,
    apiModelName: process.env.CLAUDE_MODEL || "claude-opus-4-8",
    useLegacyAnthropic: true,
    warnings,
  };
}

export function validateModelCapabilities(model, needs = {}) {
  const issues = [];
  if (!model) return issues;
  if (needs.tools && !model.supportsTools) {
    issues.push({
      code: CONNECTION_ERROR_CODES.UNSUPPORTED_CAPABILITY,
      message: "Выбранная модель не поддерживает tools/function calling.",
    });
  }
  if (needs.vision && !model.supportsVision) {
    issues.push({
      code: CONNECTION_ERROR_CODES.UNSUPPORTED_CAPABILITY,
      message: "Выбранная модель не поддерживает изображения (vision).",
    });
  }
  if (needs.audio && !model.supportsAudioInput) {
    issues.push({
      code: CONNECTION_ERROR_CODES.UNSUPPORTED_CAPABILITY,
      message: "Выбранная модель не поддерживает аудиовход.",
    });
  }
  if (needs.minContext && model.contextWindow && model.contextWindow < needs.minContext) {
    issues.push({
      code: CONNECTION_ERROR_CODES.UNSUPPORTED_CAPABILITY,
      message: `Контекстное окно модели (${model.contextWindow}) меньше требуемого (${needs.minContext}).`,
    });
  }
  return issues;
}

export function listModelsGroupedForChat(userId) {
  const providers = listAiProviders({ onlyEnabled: true }).filter((p) => p.allowUsers);
  return providers.map((p) => ({
    providerId: p.id,
    providerName: p.name,
    providerType: p.providerType,
    models: listAiModels({ providerId: p.id, onlyActive: true }).map((m) => ({
      id: m.id,
      displayName: m.displayName,
      apiModelName: m.apiModelName,
      supportsTools: m.supportsTools,
      supportsVision: m.supportsVision,
      supportsAudioInput: m.supportsAudioInput,
      contextWindow: m.contextWindow,
    })),
  }));
}
