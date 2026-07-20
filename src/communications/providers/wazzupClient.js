/**
 * Low-level Wazzup User API v3 HTTP client.
 * Bearer auth; redacts API key from errors; classifies 401/403/429/5xx/timeout.
 */

import { CommunicationError, getCommunicationsConfig } from "../config.js";

function redactSecrets(text, apiKey) {
  let out = String(text || "");
  if (apiKey && apiKey.length >= 8) {
    out = out.split(apiKey).join("[redacted]");
  }
  out = out.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  return out;
}

function classifyHttpError(status, body, retryAfter) {
  if (status === 401) {
    return new CommunicationError("WAZZUP_UNAUTHORIZED", "Wazzup API: неверный API key.", {
      status,
      retryable: false,
    });
  }
  if (status === 403) {
    return new CommunicationError("WAZZUP_FORBIDDEN", "Wazzup API: доступ запрещён.", {
      status,
      retryable: false,
    });
  }
  if (status === 429) {
    return new CommunicationError("WAZZUP_RATE_LIMITED", "Wazzup API: превышен лимит запросов.", {
      status,
      retryable: true,
      retryAfterSeconds: retryAfter,
    });
  }
  if (status >= 500) {
    return new CommunicationError("WAZZUP_SERVER_ERROR", "Wazzup API: временная ошибка сервера.", {
      status,
      retryable: true,
      providerError: body?.error || null,
    });
  }
  const code = body?.error || "WAZZUP_REQUEST_FAILED";
  const desc = body?.description || body?.message || `Wazzup API error ${status}`;
  const nonRetryable = [
    "repeatedCrmMessageId",
    "validationError",
    "BAD_CONTACT",
    "CHANNEL_REJECTED",
    "24_HOURS_EXCEEDED",
  ];
  return new CommunicationError(String(code).toUpperCase(), String(desc), {
    status,
    retryable: !nonRetryable.includes(body?.error),
    providerError: body?.error || null,
    providerData: body?.data ? "[omitted]" : undefined,
  });
}

export class WazzupClient {
  constructor(options = {}) {
    const cfg = getCommunicationsConfig();
    this.apiBase = (options.apiBase || cfg.wazzup.apiBase).replace(/\/$/, "");
    this.apiKey = options.apiKey ?? cfg.wazzup._apiKey;
    this.timeoutMs = options.timeoutMs || cfg.wazzup.requestTimeoutMs;
    this.fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
  }

  assertConfigured() {
    if (!this.apiKey) {
      throw new CommunicationError(
        "WAZZUP_NOT_CONFIGURED",
        "WAZZUP_API_KEY не задан. Ключ хранится только в env."
      );
    }
  }

  async request(method, path, { body, query } = {}) {
    this.assertConfigured();
    const url = new URL(`${this.apiBase}${path.startsWith("/") ? path : `/${path}`}`);
    if (query && typeof query === "object") {
      for (const [k, v] of Object.entries(query)) {
        if (v != null && v !== "") url.searchParams.set(k, String(v));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = Date.now();

    try {
      const headers = {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      };
      let payload;
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(body);
      }

      const res = await this.fetchImpl(url.toString(), {
        method,
        headers,
        body: payload,
        signal: controller.signal,
      });

      const text = await res.text();
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: redactSecrets(text.slice(0, 200), this.apiKey) };
        }
      }

      const durationMs = Date.now() - started;
      if (!res.ok) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const err = classifyHttpError(
          res.status,
          parsed,
          Number.isFinite(retryAfter) ? retryAfter : undefined
        );
        err.details = { ...err.details, durationMs, path };
        throw err;
      }

      return { data: parsed, status: res.status, durationMs };
    } catch (error) {
      if (error instanceof CommunicationError) throw error;
      if (error?.name === "AbortError") {
        throw new CommunicationError("WAZZUP_TIMEOUT", "Wazzup API: таймаут запроса.", {
          timeoutMs: this.timeoutMs,
          retryable: true,
          path,
        });
      }
      throw new CommunicationError(
        "WAZZUP_NETWORK_ERROR",
        redactSecrets(error.message || "Wazzup network error", this.apiKey),
        { retryable: true, path }
      );
    } finally {
      clearTimeout(timer);
    }
  }

  get(path, query) {
    return this.request("GET", path, { query });
  }

  post(path, body) {
    return this.request("POST", path, { body });
  }

  patch(path, body) {
    return this.request("PATCH", path, { body });
  }
}

export function createWazzupClient(options) {
  return new WazzupClient(options);
}
