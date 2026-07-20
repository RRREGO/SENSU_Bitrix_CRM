/**
 * Конфиг планировщика плановых отчётов.
 */

function intEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function boolEnv(name, fallback) {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(v));
}

export function getSchedulerConfig() {
  return {
    enabled: boolEnv("SCHEDULER_ENABLED", true),
    timezone: (process.env.APP_TIMEZONE || "Asia/Almaty").trim() || "Asia/Almaty",
    pollIntervalSeconds: intEnv("SCHEDULER_POLL_INTERVAL_SECONDS", 30),
    lockTtlSeconds: intEnv("SCHEDULER_LOCK_TTL_SECONDS", 600),
    maxRuntimeSeconds: intEnv("SCHEDULED_REPORT_MAX_RUNTIME_SECONDS", 600),
    maxConcurrentRuns: intEnv("SCHEDULER_MAX_CONCURRENT_RUNS", 1),
    minIntervalMinutes: intEnv("SCHEDULED_REPORT_MIN_INTERVAL_MINUTES", 15),
    misfireGraceMinutes: intEnv("SCHEDULED_REPORT_MISFIRE_GRACE_MINUTES", 120),
  };
}

export class SchedulerError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "SchedulerError";
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
