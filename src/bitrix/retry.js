/**
 * Retry policy для Bitrix24 read-запросов.
 */

function intEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function getBitrixRetryConfig() {
  return {
    readAttempts: intEnv("BITRIX_READ_RETRY_ATTEMPTS", 3),
    readBaseDelayMs: intEnv("BITRIX_READ_RETRY_BASE_DELAY_MS", 500),
    readTimeoutMs: intEnv("BITRIX_READ_TIMEOUT_MS", 30000),
    readMaxTotalMs: intEnv("BITRIX_READ_RETRY_MAX_TOTAL_MS", 90000),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(base) {
  const spread = Math.floor(base * 0.3);
  return base + Math.floor(Math.random() * (spread * 2 + 1)) - spread;
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{
 *   attempts?: number,
 *   baseDelayMs?: number,
 *   timeoutMs?: number,
 *   maxTotalMs?: number,
 *   shouldRetry?: (error: any, attempt: number) => boolean,
 *   label?: string,
 *   onRetry?: (info: object) => void,
 * }} [options]
 */
export async function withRetry(fn, options = {}) {
  const cfg = getBitrixRetryConfig();
  const attempts = options.attempts ?? cfg.readAttempts;
  const baseDelayMs = options.baseDelayMs ?? cfg.readBaseDelayMs;
  const timeoutMs = options.timeoutMs ?? cfg.readTimeoutMs;
  const maxTotalMs = options.maxTotalMs ?? cfg.readMaxTotalMs;
  const shouldRetry = options.shouldRetry || (() => true);
  const label = options.label || "bitrix";
  const started = Date.now();

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (Date.now() - started > maxTotalMs) {
      const err = new Error(`${label}: overall retry budget exceeded`);
      err.name = "AbortError";
      throw err;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await fn(controller.signal);
      clearTimeout(timer);
      return result;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      const retry = attempt < attempts && shouldRetry(error, attempt);
      if (!retry) throw error;

      const delay = jitter(baseDelayMs * 2 ** (attempt - 1));
      options.onRetry?.({
        label,
        attempt,
        attempts,
        delayMs: delay,
        error: error?.message || String(error),
      });
      console.warn(
        `[BitrixRetry] ${label} attempt=${attempt}/${attempts} delayMs=${delay} error=${String(error?.message || error).slice(0, 160)}`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}
