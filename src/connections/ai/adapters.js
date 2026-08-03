/**
 * AI provider adapters — unified chat/completions + listModels + test.
 */

import { proxiedFetch } from "../proxyResolver.js";
import {
  ConnectionError,
  CONNECTION_ERROR_CODES,
  mapHttpStatusToConnectionCode,
  mapNetworkErrorToConnectionCode,
} from "../errors.js";
import { getProviderApiKey, getAiProviderById } from "../../database/repositories/aiProvidersRepository.js";

/** Proxy is server-admin only via LLM_PROXY_* / ANTHROPIC_PROXY — never per-user profiles. */
function proxyOptsForProvider(_provider) {
  return { mode: "system" };
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function throwFromResponse(response, data) {
  const code = mapHttpStatusToConnectionCode(response.status);
  const msg =
    data?.error?.message ||
    data?.message ||
    `Провайдер вернул HTTP ${response.status}`;
  throw new ConnectionError(code, msg, { httpStatus: response.status });
}

/** OpenAI + OpenAI-compatible + Ollama */
export const openaiCompatibleAdapter = {
  id: "openai_compatible",
  async listModels(provider) {
    const apiKey = getProviderApiKey(provider.id);
    const base = String(provider.baseUrl || "").replace(/\/$/, "");
    if (!base) {
      throw new ConnectionError(
        CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
        "Base URL обязателен для OpenAI-compatible."
      );
    }
    const res = await proxiedFetch(
      `${base}/models`,
      {
        method: "GET",
        headers: {
          authorization: apiKey ? `Bearer ${apiKey}` : "",
          ...(provider.extraHeaders || {}),
        },
        timeoutMs: provider.timeoutMs,
      },
      proxyOptsForProvider(provider)
    );
    const data = await readJsonSafe(res);
    if (!res.ok) throwFromResponse(res, data);
    const models = Array.isArray(data?.data) ? data.data : [];
    return models.map((m) => ({
      apiModelName: m.id,
      displayName: m.id,
      capabilitiesSource: "api",
      // Do not invent capabilities from name
      supportsStreaming: true,
      supportsTools: false,
      supportsJsonMode: false,
      supportsVision: false,
      supportsAudioInput: false,
      supportsAudioOutput: false,
    }));
  },

  async testConnection(provider, { modelName } = {}) {
    const started = Date.now();
    try {
      const models = await this.listModels(provider);
      let modelOk = true;
      if (modelName) {
        modelOk = models.some((m) => m.apiModelName === modelName);
      }
      return {
        success: modelOk,
        latencyMs: Date.now() - started,
        modelsCount: models.length,
        modelFound: modelOk,
        capabilities: { listModels: true },
        status: modelOk ? "ok" : "model_not_found",
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - started,
        status: "error",
        errorCode: error.code || mapNetworkErrorToConnectionCode(error),
        message: error.message,
      };
    }
  },

  async chat(provider, { model, messages, system, tools, maxTokens = 4096 }) {
    const apiKey = getProviderApiKey(provider.id);
    const base = String(provider.baseUrl || "").replace(/\/$/, "");
    const openaiMessages = [];
    if (system) openaiMessages.push({ role: "system", content: system });
    for (const m of messages || []) {
      openaiMessages.push({ role: m.role, content: m.content });
    }
    const body = {
      model,
      messages: openaiMessages,
      max_tokens: maxTokens,
    };
    if (tools?.length) {
      body.tools = tools;
    }
    const res = await proxiedFetch(
      `${base}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          ...(provider.organizationId ? { "OpenAI-Organization": provider.organizationId } : {}),
          ...(provider.extraHeaders || {}),
        },
        body: JSON.stringify(body),
        timeoutMs: provider.timeoutMs,
      },
      proxyOptsForProvider(provider)
    );
    const data = await readJsonSafe(res);
    if (!res.ok) throwFromResponse(res, data);
    const choice = data?.choices?.[0];
    return {
      provider: "openai_compatible",
      text: choice?.message?.content || "",
      toolCalls: choice?.message?.tool_calls || null,
      raw: data,
      finishReason: choice?.finish_reason,
    };
  },

  async transcribe(provider, { audioBuffer, mimeType, language, model }) {
    const apiKey = getProviderApiKey(provider.id);
    const base = String(provider.baseUrl || "").replace(/\/$/, "");
    const form = new FormData();
    const blob = new Blob([audioBuffer], { type: mimeType || "audio/webm" });
    form.append("file", blob, "audio.webm");
    form.append("model", model || "whisper-1");
    if (language) form.append("language", language);

    const res = await proxiedFetch(
      `${base}/audio/transcriptions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          ...(provider.extraHeaders || {}),
        },
        body: form,
        timeoutMs: provider.timeoutMs || 60000,
      },
      proxyOptsForProvider(provider)
    );
    const data = await readJsonSafe(res);
    if (!res.ok) throwFromResponse(res, data);
    return { text: data?.text || "", language: data?.language || language || null };
  },
};

export const openaiAdapter = {
  ...openaiCompatibleAdapter,
  id: "openai",
};

export const anthropicAdapter = {
  id: "anthropic",
  async listModels(provider) {
    // Anthropic does not expose a stable public models list for all keys — return empty for sync;
    // user adds models manually or uses configured default.
    return [];
  },

  async testConnection(provider, { modelName } = {}) {
    const started = Date.now();
    const apiKey = getProviderApiKey(provider.id);
    const base = String(provider.baseUrl || "https://api.anthropic.com").replace(/\/$/, "");
    const model = modelName || "claude-sonnet-4-5";
    try {
      const res = await proxiedFetch(
        `${base}/v1/messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            ...(provider.extraHeaders || {}),
          },
          body: JSON.stringify({
            model,
            max_tokens: 16,
            messages: [{ role: "user", content: "ping" }],
          }),
          timeoutMs: Math.min(provider.timeoutMs || 20000, 20000),
        },
        proxyOptsForProvider(provider)
      );
      const data = await readJsonSafe(res);
      const ok = res.ok || res.status === 400;
      if (!ok) throwFromResponse(res, data);
      return {
        success: true,
        latencyMs: Date.now() - started,
        status: "ok",
        capabilities: { listModels: false, messages: true, tools: true },
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - started,
        status: "error",
        errorCode: error.code || mapNetworkErrorToConnectionCode(error),
        message: error.message,
      };
    }
  },

  async chat(provider, { model, messages, system, tools, maxTokens = 4096 }) {
    const apiKey = getProviderApiKey(provider.id);
    const base = String(provider.baseUrl || "https://api.anthropic.com").replace(/\/$/, "");
    const body = {
      model,
      max_tokens: maxTokens,
      system,
      messages,
    };
    if (tools?.length) {
      body.tools = tools;
    }
    const res = await proxiedFetch(
      `${base}/v1/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          ...(provider.extraHeaders || {}),
        },
        body: JSON.stringify(body),
        timeoutMs: provider.timeoutMs,
      },
      proxyOptsForProvider(provider)
    );
    const data = await readJsonSafe(res);
    if (!res.ok) throwFromResponse(res, data);
    return {
      provider: "anthropic",
      content: data.content,
      stopReason: data.stop_reason,
      raw: data,
    };
  },
};

export const geminiAdapter = {
  id: "gemini",
  async listModels(provider) {
    const apiKey = getProviderApiKey(provider.id);
    const base = String(provider.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(
      /\/$/,
      ""
    );
    const res = await proxiedFetch(
      `${base}/models?key=${encodeURIComponent(apiKey)}`,
      { method: "GET", timeoutMs: provider.timeoutMs },
      proxyOptsForProvider(provider)
    );
    const data = await readJsonSafe(res);
    if (!res.ok) throwFromResponse(res, data);
    const models = Array.isArray(data?.models) ? data.models : [];
    return models
      .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => ({
        apiModelName: String(m.name || "").replace(/^models\//, ""),
        displayName: m.displayName || m.name,
        capabilitiesSource: "api",
        supportsStreaming: true,
        supportsTools: Boolean(m.supportedGenerationMethods?.includes?.("generateContent")),
        contextWindow: m.inputTokenLimit || null,
        maxOutputTokens: m.outputTokenLimit || null,
      }));
  },

  async testConnection(provider, { modelName } = {}) {
    const started = Date.now();
    try {
      const models = await this.listModels(provider);
      const modelOk = modelName ? models.some((m) => m.apiModelName === modelName) : models.length > 0;
      return {
        success: modelOk,
        latencyMs: Date.now() - started,
        modelsCount: models.length,
        status: modelOk ? "ok" : "model_not_found",
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - started,
        status: "error",
        errorCode: error.code || mapNetworkErrorToConnectionCode(error),
        message: error.message,
      };
    }
  },

  async chat(provider, { model, messages, system, maxTokens = 4096 }) {
    const apiKey = getProviderApiKey(provider.id);
    const base = String(provider.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(
      /\/$/,
      ""
    );
    const contents = (messages || []).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    const body = {
      contents,
      generationConfig: { maxOutputTokens: maxTokens },
    };
    if (system) {
      body.systemInstruction = { parts: [{ text: system }] };
    }
    const res = await proxiedFetch(
      `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...(provider.extraHeaders || {}) },
        body: JSON.stringify(body),
        timeoutMs: provider.timeoutMs,
      },
      proxyOptsForProvider(provider)
    );
    const data = await readJsonSafe(res);
    if (!res.ok) throwFromResponse(res, data);
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    return { provider: "gemini", text, raw: data };
  },
};

const ADAPTERS = {
  openai: openaiAdapter,
  openai_compatible: openaiCompatibleAdapter,
  ollama: openaiCompatibleAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
};

export function getAdapterForProvider(provider) {
  const type = provider?.providerType || provider;
  const adapter = ADAPTERS[type];
  if (!adapter) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      `Неизвестный тип провайдера: ${type}`
    );
  }
  return adapter;
}

export function getAdapterByProviderId(providerId) {
  const provider = getAiProviderById(providerId);
  if (!provider) {
    throw new ConnectionError(CONNECTION_ERROR_CODES.INVALID_CONFIGURATION, "Провайдер не найден.");
  }
  return { provider, adapter: getAdapterForProvider(provider) };
}
