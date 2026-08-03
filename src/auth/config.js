/**
 * Конфигурация доступа и аутентификации.
 */

import { resolveCommunicationSendFlags } from "../communications/config.js";

function boolEnv(name, fallback = false) {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(v));
}

function intEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function listEnv(name, fallback = []) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getAuthConfig() {
  const mode = String(process.env.APP_ACCESS_MODE || "local_only").toLowerCase();
  const appEnv = String(process.env.APP_ENV || process.env.NODE_ENV || "development").toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV || "development").toLowerCase();
  const isProduction = appEnv === "production" || nodeEnv === "production";
  const publicOrigin = (process.env.APP_PUBLIC_ORIGIN || "").trim();
  const port = String(process.env.PORT || 3005).trim() || "3005";
  const loopbackOrigins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
  const allowedOrigins = listEnv(
    "APP_ALLOWED_ORIGINS",
    publicOrigin ? [publicOrigin, ...loopbackOrigins] : loopbackOrigins
  );
  if (publicOrigin && !allowedOrigins.includes(publicOrigin)) {
    allowedOrigins.push(publicOrigin);
  }
  for (const origin of loopbackOrigins) {
    if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin);
  }
  const sendFlags = resolveCommunicationSendFlags();
  return {
    appEnv,
    accessMode: mode === "authenticated" ? "authenticated" : "local_only",
    allowedIps: listEnv("APP_ALLOWED_IPS", ["127.0.0.1", "::1"]),
    allowedOrigins,
    publicOrigin,
    trustedProxyCidrs: listEnv("APP_TRUSTED_PROXY_CIDRS", []),
    trustProxy: boolEnv("APP_TRUST_PROXY", false),
    bindHost: process.env.APP_BIND_HOST || (isProduction ? "0.0.0.0" : "127.0.0.1"),
    isProduction,
    cookieName: process.env.AUTH_COOKIE_NAME || "crm_assistant_session",
    cookieSecure: boolEnv("AUTH_COOKIE_SECURE", isProduction),
    sessionTtlHours: intEnv("AUTH_SESSION_TTL_HOURS", 12),
    sessionIdleMinutes: intEnv("AUTH_SESSION_IDLE_MINUTES", 120),
    maxActiveSessionsPerUser: intEnv("AUTH_MAX_ACTIVE_SESSIONS_PER_USER", 5),
    lastSeenMinIntervalSeconds: intEnv("AUTH_LAST_SEEN_MIN_INTERVAL_SECONDS", 60),
    passwordMinLength: intEnv("AUTH_PASSWORD_MIN_LENGTH", 12),
    passwordRequireComplexity: boolEnv("AUTH_PASSWORD_REQUIRE_COMPLEXITY", true),
    loginMaxAttempts: intEnv("AUTH_LOGIN_MAX_ATTEMPTS", 5),
    loginWindowMinutes: intEnv("AUTH_LOGIN_WINDOW_MINUTES", 15),
    loginLockMinutes: intEnv("AUTH_LOGIN_LOCK_MINUTES", 15),
    apiRatePerMinute: intEnv("API_RATE_LIMIT_REQUESTS_PER_MINUTE", 120),
    llmRatePerMinute: intEnv("LLM_RATE_LIMIT_REQUESTS_PER_MINUTE", 20),
    writeRatePerMinute: intEnv("WRITE_RATE_LIMIT_REQUESTS_PER_MINUTE", 30),
    requireSeparateApproverCritical: boolEnv("AUTH_REQUIRE_SEPARATE_APPROVER_FOR_CRITICAL", false),
    requireSeparateApproverExternalMessages: boolEnv(
      "AUTH_REQUIRE_SEPARATE_APPROVER_FOR_EXTERNAL_MESSAGES",
      false
    ),
    communicationSendEnabled: sendFlags.sendEnabled,
    allowUnverifiedSendDev: boolEnv("COMMUNICATION_ALLOW_UNVERIFIED_SEND_DEV", false),
    communicationLiveTestMaxAgeDays: intEnv("COMMUNICATION_LIVE_TEST_MAX_AGE_DAYS", 90),
    bootstrapUsername: (process.env.APP_BOOTSTRAP_ADMIN_USERNAME || "admin").trim(),
    bootstrapPassword: process.env.APP_BOOTSTRAP_ADMIN_PASSWORD || "",
    bootstrapDisplayName:
      process.env.APP_BOOTSTRAP_ADMIN_DISPLAY_NAME || "Администратор",
  };
}

export class AuthError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export const SYSTEM_SCHEDULER = {
  principal: "system:scheduler",
  userId: null,
  displayName: "System Scheduler",
  role: "system",
  permissions: new Set([
    "reports.run",
    "schedules.view",
    "notifications.view",
  ]),
};

export const SYSTEM_SERVICE = {
  principal: "system:service_webhook",
  userId: null,
  displayName: "Service Webhook",
  role: "system",
  permissions: new Set(["communications.view.all"]),
};
