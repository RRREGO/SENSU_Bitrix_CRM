/**
 * Конфигурация безопасного транспорта к LLM API.
 */

import fs from "fs";
import { ProxyAgent, fetch as undiciFetch, Agent } from "undici";

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

export function redactProxyUrl(url) {
  if (!url) return null;
  return String(url).replace(/:\/\/([^:/@]+):([^@/]+)@/g, "://$1:***@");
}

export function getLlmTransportConfig() {
  const allowInsecure = boolEnv("LLM_PROXY_ALLOW_INSECURE_TLS", false);
  const isDev = boolEnv("LLM_ALLOW_INSECURE_TLS_DEV", false) || process.env.NODE_ENV === "development";

  const proxyUrl =
    process.env.LLM_PROXY_URL?.trim() ||
    process.env.ANTHROPIC_PROXY?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    "";

  const rawMode = process.env.LLM_PROXY_MODE;
  const modeExplicit = rawMode != null && String(rawMode).trim() !== "";
  let mode = modeExplicit ? String(rawMode).trim().toLowerCase() : "";
  // ANTHROPIC_PROXY without LLM_PROXY_MODE used to be silently ignored (500 on
  // servers that cannot reach api.anthropic.com directly).
  if (!mode) {
    mode = proxyUrl ? "corporate" : "none";
  }

  const username = process.env.LLM_PROXY_USERNAME?.trim() || "";
  const password = process.env.LLM_PROXY_PASSWORD || "";
  const caPath = process.env.LLM_PROXY_CA_CERT_PATH?.trim() || "";
  const timeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS) || 60000;

  let resolvedProxyUrl = proxyUrl;
  if (proxyUrl && username && !/:\/\/[^/]+@/.test(proxyUrl)) {
    try {
      const u = new URL(proxyUrl);
      u.username = username;
      u.password = password;
      resolvedProxyUrl = u.toString();
    } catch {
      /* keep as-is */
    }
  }

  return {
    mode,
    configured: mode === "none" ? true : Boolean(resolvedProxyUrl),
    proxyUrl: resolvedProxyUrl,
    proxyUrlRedacted: redactProxyUrl(resolvedProxyUrl),
    caPath,
    allowInsecureTls: allowInsecure,
    isDev,
    timeoutMs,
    logPayloads: boolEnv("LLM_LOG_PAYLOADS", false),
    tlsVerification: !allowInsecure,
  };
}

export function assertLlmTransportSafeForBoot() {
  const cfg = getLlmTransportConfig();
  const allowed = new Set(["none", "corporate", "self_hosted"]);
  if (!allowed.has(cfg.mode)) {
    throw new Error(
      `LLM_PROXY_MODE="${cfg.mode}" недопустим. Разрешены: none, corporate, self_hosted.`
    );
  }
  if (cfg.allowInsecureTls && !cfg.isDev) {
    throw new Error(
      "LLM_PROXY_ALLOW_INSECURE_TLS=true запрещён вне development. Установите LLM_ALLOW_INSECURE_TLS_DEV=true только для локальной отладки."
    );
  }
  if ((cfg.mode === "corporate" || cfg.mode === "self_hosted") && !cfg.proxyUrl) {
    throw new Error(`LLM_PROXY_MODE=${cfg.mode} требует LLM_PROXY_URL (или ANTHROPIC_PROXY).`);
  }
  if (cfg.mode === "none" && cfg.proxyUrl) {
    console.warn(
      "[LLM] Прокси задан (ANTHROPIC_PROXY/LLM_PROXY_URL), но LLM_PROXY_MODE=none — запросы к Claude идут напрямую. Чтобы включить прокси, укажите LLM_PROXY_MODE=corporate."
    );
  }
  return cfg;
}

let cachedDispatcher = null;
let cachedKey = "";

export function getLlmFetchDispatcher() {
  const cfg = getLlmTransportConfig();
  if (cfg.mode === "none" || !cfg.proxyUrl) {
    return undefined;
  }

  const key = `${cfg.mode}|${cfg.proxyUrl}|${cfg.caPath}|${cfg.allowInsecureTls}`;
  if (cachedDispatcher && cachedKey === key) return cachedDispatcher;

  const connect = {};
  if (cfg.caPath && fs.existsSync(cfg.caPath)) {
    connect.ca = fs.readFileSync(cfg.caPath);
  }
  if (cfg.allowInsecureTls) {
    connect.rejectUnauthorized = false;
  }

  // SOCKS5 is plain TCP. Passing proxyTls (even {}) makes undici wrap the
  // proxy hop in TLS → OpenSSL "wrong version number".
  const isSocks = /^socks5h?:\/\//i.test(cfg.proxyUrl);
  const agentOpts = { uri: cfg.proxyUrl };
  if (Object.keys(connect).length > 0) {
    agentOpts.requestTls = connect;
    if (!isSocks) agentOpts.proxyTls = connect;
  }
  cachedDispatcher = new ProxyAgent(agentOpts);
  cachedKey = key;
  console.log(
    `[LLM] transport mode=${cfg.mode} proxy=${cfg.proxyUrlRedacted} tlsVerification=${cfg.tlsVerification}`
  );
  return cachedDispatcher;
}

export async function testLlmTransport() {
  const cfg = getLlmTransportConfig();
  const started = Date.now();
  const dispatcher = getLlmFetchDispatcher();
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      proxyMode: cfg.mode,
      configured: cfg.configured,
      tlsVerification: cfg.tlsVerification,
      error: { code: "ANTHROPIC_NOT_CONFIGURED", message: "ANTHROPIC_API_KEY не задан." },
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(cfg.timeoutMs, 20000));
    const response = await undiciFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || "claude-opus-4-8",
        max_tokens: 16,
        messages: [{ role: "user", content: "ping" }],
      }),
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - started;
    let providerOk = response.ok || response.status === 400;
    return {
      success: providerOk,
      connection: true,
      tls: cfg.tlsVerification,
      latencyMs,
      providerResponse: response.ok ? "ok" : `http_${response.status}`,
      proxyMode: cfg.mode,
      configured: cfg.configured,
      tlsVerification: cfg.tlsVerification,
    };
  } catch (error) {
    return {
      success: false,
      connection: false,
      tls: cfg.tlsVerification,
      latencyMs: Date.now() - started,
      providerResponse: "error",
      proxyMode: cfg.mode,
      configured: cfg.configured,
      tlsVerification: cfg.tlsVerification,
      error: { code: "LLM_TRANSPORT_FAILED", message: "Проверка транспорта не удалась." },
    };
  }
}
