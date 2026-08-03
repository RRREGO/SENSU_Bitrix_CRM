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
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  return {
    apiKey,
    model: process.env.CLAUDE_MODEL || "claude-opus-4-8",
  };
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
    throw new Error(`Claude network error: ${error.message}`);
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
    throw new Error(`Claude returned invalid JSON (HTTP ${response.status})`);
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
    throw new Error(`Claude API error (${response.status}): ${message}`);
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
    throw new Error("Claude returned empty or unexpected response format");
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
