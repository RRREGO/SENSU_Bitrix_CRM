/**
 * AI provider operations: test, sync models.
 */

import {
  getAiProviderById,
  getProviderApiKey,
  listAiModels,
  recordProviderCheck,
  upsertAiModel,
  updateAiProvider,
} from "../../database/repositories/aiProvidersRepository.js";
import { getAdapterForProvider, listAnthropicModelsFromApi } from "./adapters.js";
import { ConnectionError, CONNECTION_ERROR_CODES } from "../errors.js";
import { isSecretsConfigured } from "../secretsService.js";

const SYSTEM_MODELS_CACHE_MS = 5 * 60 * 1000;
let systemModelsCache = { at: 0, models: null, error: null };

/**
 * Models available via env ANTHROPIC_API_KEY (legacy/system Claude).
 * Cached briefly to keep the chat model picker snappy.
 */
export async function listSystemAnthropicModels({ force = false } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return [];

  const now = Date.now();
  if (!force && systemModelsCache.models && now - systemModelsCache.at < SYSTEM_MODELS_CACHE_MS) {
    return systemModelsCache.models;
  }

  try {
    const models = await listAnthropicModelsFromApi({
      apiKey,
      baseUrl: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com",
      timeoutMs: Number(process.env.LLM_REQUEST_TIMEOUT_MS) || 20000,
    });
    systemModelsCache = { at: now, models, error: null };
    return models;
  } catch (error) {
    systemModelsCache = {
      at: now,
      models: systemModelsCache.models,
      error: error.message || String(error),
    };
    if (systemModelsCache.models?.length) return systemModelsCache.models;
    const fallbackName = process.env.CLAUDE_MODEL || "claude-opus-4-8";
    return [
      {
        apiModelName: fallbackName,
        displayName: fallbackName,
        supportsTools: true,
        capabilitiesSource: "env_fallback",
      },
    ];
  }
}

export async function testAiProvider(providerId, { modelName, actorUserId } = {}) {
  if (!isSecretsConfigured() && !getProviderApiKey(providerId)) {
    // key may still decrypt if master key set; if not configured at all:
  }
  if (!isSecretsConfigured()) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      "SECRETS_MASTER_KEY не задан — невозможно работать с сохранёнными ключами."
    );
  }
  const provider = getAiProviderById(providerId);
  if (!provider) {
    throw new ConnectionError(CONNECTION_ERROR_CODES.INVALID_CONFIGURATION, "Провайдер не найден.");
  }
  if (!provider.isEnabled) {
    throw new ConnectionError(CONNECTION_ERROR_CODES.MODEL_UNAVAILABLE, "Провайдер отключён.");
  }
  const adapter = getAdapterForProvider(provider);
  const result = await adapter.testConnection(provider, {
    modelName: modelName || undefined,
  });
  recordProviderCheck(providerId, {
    checkType: "connection",
    status: result.success ? "ok" : result.status || "error",
    latencyMs: result.latencyMs,
    result: {
      modelsCount: result.modelsCount,
      modelFound: result.modelFound,
      capabilities: result.capabilities,
    },
    errorCode: result.errorCode || null,
    actorUserId,
  });
  return result;
}

export async function syncAiProviderModels(providerId, { actorUserId } = {}) {
  const provider = getAiProviderById(providerId);
  if (!provider) {
    throw new ConnectionError(CONNECTION_ERROR_CODES.INVALID_CONFIGURATION, "Провайдер не найден.");
  }
  const adapter = getAdapterForProvider(provider);
  const remote = await adapter.listModels(provider);
  const synced = [];
  for (const m of remote) {
    const saved = upsertAiModel({
      providerId,
      apiModelName: m.apiModelName,
      displayName: m.displayName || m.apiModelName,
      contextWindow: m.contextWindow ?? null,
      maxOutputTokens: m.maxOutputTokens ?? null,
      supportsStreaming: m.supportsStreaming !== false,
      supportsTools: Boolean(m.supportsTools),
      supportsJsonMode: Boolean(m.supportsJsonMode),
      supportsVision: Boolean(m.supportsVision),
      supportsAudioInput: Boolean(m.supportsAudioInput),
      supportsAudioOutput: Boolean(m.supportsAudioOutput),
      capabilitiesSource: m.capabilitiesSource || "api",
      lastSuccessAt: new Date().toISOString(),
    });
    synced.push(saved);
  }
  recordProviderCheck(providerId, {
    checkType: "sync_models",
    status: "ok",
    result: { synced: synced.length },
    actorUserId,
  });
  return { success: true, synced: synced.length, models: listAiModels({ providerId }) };
}

export function ensureSystemAnthropicBootstrap() {
  // Optional: no auto-insert; env remains fallback via modelResolver.
  return { legacyConfigured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()) };
}
