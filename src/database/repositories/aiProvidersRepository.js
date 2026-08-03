import crypto from "crypto";
import { getDatabase } from "../index.js";
import { WorkspaceError } from "../../workspace/config.js";
import { encryptSecret, decryptSecret, secretMeta, maskSecret } from "../../connections/secretsService.js";
import { ConnectionError, CONNECTION_ERROR_CODES } from "../../connections/errors.js";

function uid() {
  return crypto.randomUUID();
}
function now() {
  return new Date().toISOString();
}

const PROVIDER_TYPES = new Set(["openai", "openai_compatible", "anthropic", "gemini", "ollama"]);

const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "cookie",
  "x-csrf-token",
  "x-internal-token",
  "authorization",
]);

export function validateExtraHeaders(headers) {
  const src = headers && typeof headers === "object" ? headers : {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    const key = String(k).trim();
    if (!key || FORBIDDEN_HEADERS.has(key.toLowerCase())) {
      throw new ConnectionError(
        CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
        `Заголовок «${key}» запрещён.`
      );
    }
    if (typeof v !== "string" || v.length > 2000) {
      throw new ConnectionError(
        CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
        `Некорректное значение заголовка «${key}».`
      );
    }
    out[key] = v;
  }
  return out;
}

function mapProvider(row) {
  if (!row) return null;
  let extraHeaders = {};
  try {
    extraHeaders = JSON.parse(row.extra_headers_json || "{}");
  } catch {
    extraHeaders = {};
  }
  const secretRow = getDatabase()
    .prepare("SELECT api_key_encrypted FROM ai_provider_secrets WHERE provider_id = ?")
    .get(row.id);
  const hasKey = Boolean(secretRow?.api_key_encrypted);
  let mask = null;
  if (hasKey) {
    try {
      mask = maskSecret(decryptSecret(secretRow.api_key_encrypted), 4);
    } catch {
      mask = "********";
    }
  }
  return {
    id: row.id,
    ownerUserId: row.owner_user_id || null,
    name: row.name,
    providerType: row.provider_type,
    baseUrl: row.base_url || null,
    organizationId: row.organization_id || null,
    projectId: row.project_id || null,
    extraHeaders,
    proxyMode: row.proxy_mode || "system",
    proxyProfileId: row.proxy_profile_id || null,
    timeoutMs: row.timeout_ms,
    maxRetries: row.max_retries,
    isEnabled: Boolean(row.is_enabled),
    allowUsers: Boolean(row.allow_users),
    defaultModelId: row.default_model_id || null,
    lastCheckAt: row.last_check_at || null,
    lastCheckStatus: row.last_check_status || null,
    apiKey: secretMeta(hasKey, mask),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getProviderApiKey(providerId) {
  const row = getDatabase()
    .prepare("SELECT api_key_encrypted FROM ai_provider_secrets WHERE provider_id = ?")
    .get(providerId);
  if (!row?.api_key_encrypted) return null;
  return decryptSecret(row.api_key_encrypted);
}

export function listAiProviders({ onlyEnabled = false } = {}) {
  const sql = onlyEnabled
    ? "SELECT * FROM ai_providers WHERE is_enabled = 1 ORDER BY updated_at DESC"
    : "SELECT * FROM ai_providers ORDER BY is_enabled DESC, updated_at DESC";
  return getDatabase().prepare(sql).all().map(mapProvider);
}

export function getAiProviderById(id) {
  return mapProvider(getDatabase().prepare("SELECT * FROM ai_providers WHERE id = ?").get(id));
}

export function createAiProvider(data = {}, actorUserId = null) {
  const type = String(data.providerType || "").toLowerCase();
  if (!PROVIDER_TYPES.has(type)) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      "Тип провайдера: openai, openai_compatible, anthropic, gemini, ollama."
    );
  }
  if (!data.apiKey) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      "API key обязателен."
    );
  }
  const extraHeaders = validateExtraHeaders(data.extraHeaders);
  const id = uid();
  const ts = now();
  const db = getDatabase();
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO ai_providers (
        id, owner_user_id, name, provider_type, base_url, organization_id, project_id,
        extra_headers_json, proxy_mode, proxy_profile_id, timeout_ms, max_retries,
        is_enabled, allow_users, default_model_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      data.ownerUserId || actorUserId || null,
      String(data.name || type).slice(0, 120),
      type,
      data.baseUrl || defaultBaseUrl(type),
      data.organizationId || null,
      data.projectId || null,
      JSON.stringify(extraHeaders),
      data.proxyMode || "system",
      data.proxyProfileId || null,
      Number(data.timeoutMs) > 0 ? Math.floor(Number(data.timeoutMs)) : 60000,
      Number.isFinite(Number(data.maxRetries)) ? Math.floor(Number(data.maxRetries)) : 2,
      data.isEnabled === false ? 0 : 1,
      data.allowUsers === false ? 0 : 1,
      null,
      ts,
      ts
    );
    db.prepare(
      `INSERT INTO ai_provider_secrets (provider_id, api_key_encrypted, updated_at) VALUES (?, ?, ?)`
    ).run(id, encryptSecret(data.apiKey), ts);
  });
  try {
    run();
  } catch (error) {
    if (error instanceof ConnectionError) throw error;
    throw new WorkspaceError("DATABASE_WRITE_FAILED", error.message);
  }
  return getAiProviderById(id);
}

function defaultBaseUrl(type) {
  if (type === "openai") return "https://api.openai.com/v1";
  if (type === "anthropic") return "https://api.anthropic.com";
  if (type === "gemini") return "https://generativelanguage.googleapis.com/v1beta";
  if (type === "ollama") return "http://127.0.0.1:11434/v1";
  return "";
}

export function updateAiProvider(id, patch = {}) {
  const current = getDatabase().prepare("SELECT * FROM ai_providers WHERE id = ?").get(id);
  if (!current) return null;
  const extraHeaders =
    patch.extraHeaders != null
      ? validateExtraHeaders(patch.extraHeaders)
      : JSON.parse(current.extra_headers_json || "{}");
  const ts = now();
  const db = getDatabase();
  const run = db.transaction(() => {
    db.prepare(
      `UPDATE ai_providers SET
        name = ?, base_url = ?, organization_id = ?, project_id = ?,
        extra_headers_json = ?, proxy_mode = ?, proxy_profile_id = ?,
        timeout_ms = ?, max_retries = ?, is_enabled = ?, allow_users = ?,
        default_model_id = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      patch.name != null ? String(patch.name).slice(0, 120) : current.name,
      patch.baseUrl != null ? patch.baseUrl : current.base_url,
      patch.organizationId !== undefined ? patch.organizationId : current.organization_id,
      patch.projectId !== undefined ? patch.projectId : current.project_id,
      JSON.stringify(extraHeaders),
      patch.proxyMode != null ? patch.proxyMode : current.proxy_mode,
      patch.proxyProfileId !== undefined ? patch.proxyProfileId : current.proxy_profile_id,
      patch.timeoutMs != null ? Math.floor(Number(patch.timeoutMs)) : current.timeout_ms,
      patch.maxRetries != null ? Math.floor(Number(patch.maxRetries)) : current.max_retries,
      patch.isEnabled === false ? 0 : patch.isEnabled === true ? 1 : current.is_enabled,
      patch.allowUsers === false ? 0 : patch.allowUsers === true ? 1 : current.allow_users,
      patch.defaultModelId !== undefined ? patch.defaultModelId : current.default_model_id,
      ts,
      id
    );
    if (patch.apiKey) {
      db.prepare(
        `INSERT INTO ai_provider_secrets (provider_id, api_key_encrypted, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(provider_id) DO UPDATE SET api_key_encrypted = excluded.api_key_encrypted, updated_at = excluded.updated_at`
      ).run(id, encryptSecret(patch.apiKey), ts);
    }
  });
  run();
  return getAiProviderById(id);
}

export function deleteAiProvider(id) {
  const db = getDatabase();
  const run = db.transaction(() => {
    db.prepare("DELETE FROM ai_provider_checks WHERE provider_id = ?").run(id);
    db.prepare("DELETE FROM ai_models WHERE provider_id = ?").run(id);
    db.prepare("DELETE FROM ai_provider_secrets WHERE provider_id = ?").run(id);
    db.prepare("DELETE FROM ai_providers WHERE id = ?").run(id);
  });
  run();
  return true;
}

export function recordProviderCheck(providerId, data = {}) {
  const id = uid();
  getDatabase()
    .prepare(
      `INSERT INTO ai_provider_checks (
        id, provider_id, check_type, status, latency_ms, result_json, error_code, actor_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      providerId,
      data.checkType || "connection",
      data.status || "unknown",
      data.latencyMs ?? null,
      JSON.stringify(data.result || {}),
      data.errorCode || null,
      data.actorUserId || null,
      now()
    );
  getDatabase()
    .prepare(
      `UPDATE ai_providers SET last_check_at = ?, last_check_status = ?, updated_at = ? WHERE id = ?`
    )
    .run(now(), data.status || "unknown", now(), providerId);
  return id;
}

function mapModel(row) {
  if (!row) return null;
  return {
    id: row.id,
    providerId: row.provider_id,
    apiModelName: row.api_model_name,
    displayName: row.display_name,
    contextWindow: row.context_window,
    maxOutputTokens: row.max_output_tokens,
    supportsStreaming: Boolean(row.supports_streaming),
    supportsTools: Boolean(row.supports_tools),
    supportsJsonMode: Boolean(row.supports_json_mode),
    supportsVision: Boolean(row.supports_vision),
    supportsAudioInput: Boolean(row.supports_audio_input),
    supportsAudioOutput: Boolean(row.supports_audio_output),
    isActive: Boolean(row.is_active),
    priority: row.priority,
    costInput: row.cost_input,
    costOutput: row.cost_output,
    lastSuccessAt: row.last_success_at,
    capabilitiesSource: row.capabilities_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAiModels({ providerId, onlyActive = false } = {}) {
  const db = getDatabase();
  let rows;
  if (providerId && onlyActive) {
    rows = db
      .prepare(
        `SELECT * FROM ai_models WHERE provider_id = ? AND is_active = 1 ORDER BY priority ASC, display_name`
      )
      .all(providerId);
  } else if (providerId) {
    rows = db
      .prepare(`SELECT * FROM ai_models WHERE provider_id = ? ORDER BY priority ASC, display_name`)
      .all(providerId);
  } else if (onlyActive) {
    rows = db
      .prepare(`SELECT * FROM ai_models WHERE is_active = 1 ORDER BY priority ASC, display_name`)
      .all();
  } else {
    rows = db.prepare(`SELECT * FROM ai_models ORDER BY priority ASC, display_name`).all();
  }
  return rows.map(mapModel);
}

export function getAiModelById(id) {
  return mapModel(getDatabase().prepare("SELECT * FROM ai_models WHERE id = ?").get(id));
}

export function upsertAiModel(data = {}) {
  const existing = getDatabase()
    .prepare(`SELECT * FROM ai_models WHERE provider_id = ? AND api_model_name = ?`)
    .get(data.providerId, data.apiModelName);
  const ts = now();
  if (existing) {
    getDatabase()
      .prepare(
        `UPDATE ai_models SET
          display_name = ?, context_window = ?, max_output_tokens = ?,
          supports_streaming = ?, supports_tools = ?, supports_json_mode = ?,
          supports_vision = ?, supports_audio_input = ?, supports_audio_output = ?,
          is_active = ?, priority = ?, cost_input = ?, cost_output = ?,
          capabilities_source = ?, last_success_at = COALESCE(?, last_success_at), updated_at = ?
         WHERE id = ?`
      )
      .run(
        data.displayName || existing.display_name,
        data.contextWindow ?? existing.context_window,
        data.maxOutputTokens ?? existing.max_output_tokens,
        data.supportsStreaming === false ? 0 : data.supportsStreaming === true ? 1 : existing.supports_streaming,
        data.supportsTools === false ? 0 : data.supportsTools === true ? 1 : existing.supports_tools,
        data.supportsJsonMode === false ? 0 : data.supportsJsonMode === true ? 1 : existing.supports_json_mode,
        data.supportsVision === false ? 0 : data.supportsVision === true ? 1 : existing.supports_vision,
        data.supportsAudioInput === false ? 0 : data.supportsAudioInput === true ? 1 : existing.supports_audio_input,
        data.supportsAudioOutput === false ? 0 : data.supportsAudioOutput === true ? 1 : existing.supports_audio_output,
        data.isActive === false ? 0 : data.isActive === true ? 1 : existing.is_active,
        data.priority ?? existing.priority,
        data.costInput ?? existing.cost_input,
        data.costOutput ?? existing.cost_output,
        data.capabilitiesSource || existing.capabilities_source,
        data.lastSuccessAt || null,
        ts,
        existing.id
      );
    return getAiModelById(existing.id);
  }
  const id = uid();
  getDatabase()
    .prepare(
      `INSERT INTO ai_models (
        id, provider_id, api_model_name, display_name, context_window, max_output_tokens,
        supports_streaming, supports_tools, supports_json_mode, supports_vision,
        supports_audio_input, supports_audio_output, is_active, priority,
        cost_input, cost_output, capabilities_source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      data.providerId,
      data.apiModelName,
      data.displayName || data.apiModelName,
      data.contextWindow ?? null,
      data.maxOutputTokens ?? null,
      data.supportsStreaming === false ? 0 : 1,
      data.supportsTools ? 1 : 0,
      data.supportsJsonMode ? 1 : 0,
      data.supportsVision ? 1 : 0,
      data.supportsAudioInput ? 1 : 0,
      data.supportsAudioOutput ? 1 : 0,
      data.isActive === false ? 0 : 1,
      data.priority ?? 100,
      data.costInput ?? null,
      data.costOutput ?? null,
      data.capabilitiesSource || "manual",
      ts,
      ts
    );
  return getAiModelById(id);
}

export function updateAiModel(id, patch = {}) {
  const current = getDatabase().prepare("SELECT * FROM ai_models WHERE id = ?").get(id);
  if (!current) return null;
  getDatabase()
    .prepare(
      `UPDATE ai_models SET
        display_name = ?, context_window = ?, max_output_tokens = ?,
        supports_streaming = ?, supports_tools = ?, supports_json_mode = ?,
        supports_vision = ?, supports_audio_input = ?, supports_audio_output = ?,
        is_active = ?, priority = ?, cost_input = ?, cost_output = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.displayName ?? current.display_name,
      patch.contextWindow !== undefined ? patch.contextWindow : current.context_window,
      patch.maxOutputTokens !== undefined ? patch.maxOutputTokens : current.max_output_tokens,
      patch.supportsStreaming === false ? 0 : patch.supportsStreaming === true ? 1 : current.supports_streaming,
      patch.supportsTools === false ? 0 : patch.supportsTools === true ? 1 : current.supports_tools,
      patch.supportsJsonMode === false ? 0 : patch.supportsJsonMode === true ? 1 : current.supports_json_mode,
      patch.supportsVision === false ? 0 : patch.supportsVision === true ? 1 : current.supports_vision,
      patch.supportsAudioInput === false ? 0 : patch.supportsAudioInput === true ? 1 : current.supports_audio_input,
      patch.supportsAudioOutput === false ? 0 : patch.supportsAudioOutput === true ? 1 : current.supports_audio_output,
      patch.isActive === false ? 0 : patch.isActive === true ? 1 : current.is_active,
      patch.priority ?? current.priority,
      patch.costInput !== undefined ? patch.costInput : current.cost_input,
      patch.costOutput !== undefined ? patch.costOutput : current.cost_output,
      now(),
      id
    );
  return getAiModelById(id);
}

export function deleteAiModel(id) {
  return getDatabase().prepare("DELETE FROM ai_models WHERE id = ?").run(id).changes > 0;
}

export function markModelSuccess(id) {
  getDatabase()
    .prepare(`UPDATE ai_models SET last_success_at = ?, updated_at = ? WHERE id = ?`)
    .run(now(), now(), id);
}
