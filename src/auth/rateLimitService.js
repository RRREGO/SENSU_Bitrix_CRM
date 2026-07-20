/**
 * Простые in-memory rate limits (достаточно для single-node).
 */

import { AuthError, getAuthConfig } from "./config.js";

const buckets = new Map();

function key(parts) {
  return parts.filter(Boolean).join("|");
}

function take(bucketKey, limit, windowMs) {
  const now = Date.now();
  let entry = buckets.get(bucketKey);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    buckets.set(bucketKey, entry);
  }
  entry.count += 1;
  return entry.count <= limit;
}

export function assertLoginRateLimit(ipHash) {
  const cfg = getAuthConfig();
  const windowMs = cfg.loginWindowMinutes * 60_000;
  const lockKey = key(["login-lock", ipHash]);
  const lock = buckets.get(lockKey);
  if (lock && lock.resetAt > Date.now()) {
    throw new AuthError("LOGIN_RATE_LIMITED", "Слишком много попыток входа. Попробуйте позже.");
  }
  const ok = take(key(["login", ipHash]), cfg.loginMaxAttempts, windowMs);
  if (!ok) {
    buckets.set(lockKey, {
      count: 1,
      resetAt: Date.now() + cfg.loginLockMinutes * 60_000,
    });
    throw new AuthError("LOGIN_RATE_LIMITED", "Слишком много попыток входа. Попробуйте позже.");
  }
}

export function assertApiRateLimit({ userId, sessionId, ipHash }, kind = "api") {
  const cfg = getAuthConfig();
  const limit =
    kind === "llm"
      ? cfg.llmRatePerMinute
      : kind === "write"
        ? cfg.writeRatePerMinute
        : cfg.apiRatePerMinute;
  const ok = take(key([kind, userId || sessionId || ipHash || "anon"]), limit, 60_000);
  if (!ok) {
    throw new AuthError("LOGIN_RATE_LIMITED", "Превышен лимит запросов. Повторите позже.");
  }
}

/** For tests */
export function _resetRateLimits() {
  buckets.clear();
}
