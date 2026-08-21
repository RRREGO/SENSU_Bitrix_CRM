/**
 * Клиент для Anthropic Claude Messages API.
 */

import { fetch as undiciFetch } from "undici";
import {
  assertLlmTransportSafeForBoot,
  getLlmFetchDispatcher,
  getLlmTransportConfig,
} from "./llm/transport.js";
import { logLlmRequest, estimateJsonChars } from "./llm/logging.js";
import {
  ConnectionError,
  CONNECTION_ERROR_CODES,
  mapHttpStatusToConnectionCode,
  mapNetworkErrorToConnectionCode,
} from "./connections/errors.js";

let bootChecked = false;

function ensureTransportBoot() {
  if (!bootChecked) {
    assertLlmTransportSafeForBoot();
    bootChecked = true;
  }
}

function getClaudeConfig() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      "ANTHROPIC_API_KEY не задан. Укажите ключ Claude API в окружении."
    );
  }

  return {
    apiKey,
    model: process.env.CLAUDE_MODEL || "claude-opus-4-8",
  };
}

function unusedProxyHint(cfg) {
  if (cfg?.mode === "none" && cfg.proxyUrl) {
    return " Прокси в окружении задан, но LLM_PROXY_MODE=none — он не используется. Укажите LLM_PROXY_MODE=corporate.";
  }
  return "";
}

function describeClaudeNetworkError(error, cfg) {
  const cause = error?.cause || {};
  const raw = [error?.message, cause.message, cause.code, error?.code].filter(Boolean).join(" ");
  const hint = unusedProxyHint(cfg);
  if (cfg?.mode !== "none" && cfg?.proxyUrl) {
    if (/wrong version number|tls_validate_record_header/i.test(raw)) {
      return (
        "Прокси SOCKS5 получил TLS-запрос и отклонил его. В ANTHROPIC_PROXY должен быть адрес вида socks5://хост:порт." +
        hint
      );
    }
    if (/407|proxy authentication required|cancelled/i.test(raw) || cause.code === 0) {
      return (
        "Прокси отклонил авторизацию (HTTP 407). Проверьте логин и пароль прокси и добавьте IP сервера в кабинете провайдера." +
        hint
      );
    }
    const detail = cause.message && cause.message !== error.message ? ` ${cause.message}` : "";
    return `Не удалось связаться с Claude API через прокси (${error.message}.${detail})` + hint;
  }
  return `Не удалось связаться с Claude API (${error.message}).` + hint;
}

async function requestClaude(body) {
  ensureTransportBoot();
  const { apiKey, model } = getClaudeConfig();
  const cfg = getLlmTransportConfig();
  const dispatcher = getLlmFetchDispatcher();
  const started = Date.now();
  const requestChars = estimateJsonChars(body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  let response;
  try {
    response = await undiciFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
  } catch (error) {
    clearTimeout(timer);
    logLlmRequest({
      model,
      requestChars,
      responseChars: 0,
      durationMs: Date.now() - started,
      status: "network_error",
    });
    const code = mapNetworkErrorToConnectionCode(error);
    throw new ConnectionError(code, describeClaudeNetworkError(error, cfg), {
      cause: error.message,
      causeDetail: error?.cause?.message || null,
    });
  }
  clearTimeout(timer);

  let data;
  try {
    data = await response.json();
  } catch {
    logLlmRequest({
      model,
      requestChars,
      responseChars: 0,
      durationMs: Date.now() - started,
      status: "invalid_json",
    });
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      `Claude вернул некорректный ответ (HTTP ${response.status}).`,
      { httpStatus: response.status }
    );
  }

  const responseChars = estimateJsonChars(data);

  if (!response.ok) {
    const type = data?.error?.type || "api_error";
    const message = data?.error?.message || `HTTP ${response.status}`;
    logLlmRequest({
      model,
      requestChars,
      responseChars,
      durationMs: Date.now() - started,
      status: `http_${response.status}`,
      payload: cfg.logPayloads ? { type, message } : null,
    });
    console.error(`Ошибка Claude: status=${response.status}, type=${type}`);
    const code = mapHttpStatusToConnectionCode(response.status);
    const userMessage =
      response.status === 401 || response.status === 403
        ? "Claude API отклонил ключ. Проверьте ANTHROPIC_API_KEY."
        : response.status === 429
          ? "Claude API: слишком много запросов. Повторите позже."
          : `Claude API ошибка (${response.status}): ${message}`;
    throw new ConnectionError(code, userMessage, {
      httpStatus: response.status,
      type,
    });
  }

  logLlmRequest({
    model: body.model || model,
    requestChars,
    responseChars,
    durationMs: Date.now() - started,
    status: "success",
    payload: cfg.logPayloads ? { systemChars: String(body.system || "").length } : null,
  });

  return data;
}

export async function askClaude({ systemPrompt, userPrompt }) {
  const { model } = getClaudeConfig();

  const data = await requestClaude({
    model,
    max_tokens: 1200,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
  });

  const text = extractTextFromClaudeResponse(data);
  if (!text) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.EXTERNAL_SERVICE_ERROR,
      "Claude вернул пустой или неожиданный ответ."
    );
  }

  return text;
}

export async function callClaudeWithTools({
  systemPrompt,
  messages,
  tools,
  toolChoice = { type: "auto" },
  maxTokens = 2048,
  model: modelOverride = null,
}) {
  const { model } = getClaudeConfig();

  return requestClaude({
    model: modelOverride || model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
    tools,
    tool_choice: toolChoice,
  });
}

export function extractTextFromClaudeResponse(data) {
  if (!data?.content || !Array.isArray(data.content)) {
    return "";
  }

  const parts = data.content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text.trim())
    .filter(Boolean);

  return parts.join("\n\n").trim();
}

export function extractToolUseBlocks(data) {
  if (!data?.content || !Array.isArray(data.content)) {
    return [];
  }

  return data.content.filter((block) => block?.type === "tool_use");
}

export function getAssistantContent(data) {
  return data?.content || [];
}
