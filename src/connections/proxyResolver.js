/**
 * Per-request proxy resolution.
 * User/UI proxy profiles are disabled — only system LLM proxy (LLM_PROXY_* / ANTHROPIC_PROXY) or none.
 */

import { Agent, fetch as undiciFetch } from "undici";
import { ConnectionError, CONNECTION_ERROR_CODES, mapNetworkErrorToConnectionCode } from "./errors.js";
import { getLlmFetchDispatcher, getLlmTransportConfig } from "../llm/transport.js";

/**
 * @param {{
 *   mode?: 'none'|'system'|'profile',
 *   proxyProfileId?: string|null,
 *   scope?: string,
 *   allowPrivateTargets?: boolean
 * }} opts
 * `profile` mode is ignored and mapped to `system` (admin-configured env proxy only).
 */
export function resolveProxy(opts = {}) {
  let mode = String(opts.mode || "system").toLowerCase();
  if (mode === "profile") {
    mode = "system";
  }

  if (mode === "none") {
    return { mode: "none", dispatcher: undefined, profileId: null, redacted: null };
  }

  const cfg = getLlmTransportConfig();
  const dispatcher = getLlmFetchDispatcher();
  return {
    mode: "system",
    dispatcher,
    profileId: null,
    redacted: cfg.proxyUrlRedacted,
    timeoutMs: cfg.timeoutMs,
  };
}

/**
 * Fetch via resolved proxy.
 */
export async function proxiedFetch(url, init = {}, proxyOpts = {}) {
  const resolved = resolveProxy(proxyOpts);
  try {
    // validate URL
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    throw new ConnectionError(CONNECTION_ERROR_CODES.INVALID_CONFIGURATION, "Некорректный URL.");
  }

  const dispatcher = resolved.dispatcher;
  const timeoutMs = Number(init.timeoutMs || resolved.timeoutMs || 15000);
  const controller = init.signal ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    return await undiciFetch(url, {
      ...init,
      signal: init.signal || controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
  } catch (error) {
    const code = mapNetworkErrorToConnectionCode(error);
    throw new ConnectionError(code, "Сетевой запрос через прокси не выполнен.", {
      proxyMode: resolved.mode,
      proxy: resolved.redacted,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** @deprecated User proxy profiles disabled — always reports disabled. */
export async function testProxyConnectivity(_proxyProfileId, { probeUrl } = {}) {
  return {
    success: false,
    status: "disabled",
    errorCode: CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
    latencyMs: 0,
    message: "Пользовательские прокси-профили отключены. Используйте LLM_PROXY_* / ANTHROPIC_PROXY.",
    probeUrl: probeUrl || null,
  };
}

export function getDirectAgent() {
  return new Agent();
}

/** Kept for tests / legacy callers — host/port validation without profile CRUD. */
export function validateProxyHostPort(host, port) {
  const h = String(host || "").trim();
  const p = Number(port);
  if (!h || h.length > 253) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      "Некорректный хост прокси."
    );
  }
  if (/[\s<>"']/.test(h) || h.includes("://")) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      "Хост прокси не должен содержать схему URL."
    );
  }
  if (!Number.isFinite(p) || p < 1 || p > 65535) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      "Порт прокси должен быть в диапазоне 1–65535."
    );
  }
  return { host: h, port: Math.floor(p) };
}
