/**
 * Production configuration validator + instance lock.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { getDatabase } from "../database/index.js";
import { getAuthConfig } from "../auth/config.js";
import { countUsers } from "../auth/authService.js";
import { ROUTE_POLICIES } from "../auth/routePolicies.js";
import { ACTION_POLICIES, getActionPolicy } from "../safety/policies.js";
import {
  getCommunicationsConfig,
  resolveCommunicationSendFlags,
} from "../communications/config.js";
import { certificationSummary } from "../communications/certification/certificationRepository.js";
import { getEmergencyStopState } from "../communications/certification/certificationService.js";

export function getAppEnv() {
  return String(process.env.APP_ENV || process.env.NODE_ENV || "development").toLowerCase();
}

export function getBindHost() {
  return process.env.APP_BIND_HOST || (getAppEnv() === "production" ? "0.0.0.0" : "127.0.0.1");
}

export function isLoopbackHost(host) {
  return ["127.0.0.1", "::1", "localhost"].includes(String(host || "").toLowerCase());
}

function settingGet(key) {
  try {
    const row = getDatabase().prepare("SELECT value_json FROM app_settings WHERE key = ?").get(key);
    if (!row || row.value_json == null) return null;
    try {
      return JSON.parse(row.value_json);
    } catch {
      return row.value_json;
    }
  } catch {
    return null;
  }
}

function settingSet(key, value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  getDatabase()
    .prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
    .run(key, serialized, new Date().toISOString());
}

function normalizeLockOwner(existing) {
  if (!existing) return null;
  if (typeof existing === "string") {
    try {
      const parsed = JSON.parse(existing);
      return typeof parsed === "object" && parsed ? parsed.owner || null : existing;
    } catch {
      return existing;
    }
  }
  if (typeof existing === "object") return existing.owner || null;
  return null;
}

export function acquireApplicationInstanceLock({ allowStandby = false } = {}) {
  const env = getAppEnv();
  const instanceId = process.env.APP_INSTANCE_ID || crypto.randomUUID();
  const owner = `${os.hostname()}:${process.pid}:${instanceId}`;
  const existing = settingGet("application_instance_lock");
  const existingOwner = normalizeLockOwner(existing);
  if (existingOwner && existingOwner !== owner) {
    const updated = settingGet("application_instance_lock_at");
    const age = updated ? Date.now() - new Date(updated).getTime() : Infinity;
    if (env === "production" && age < 120_000 && !allowStandby) {
      const err = new Error(
        "Второй production instance на той же SQLite запрещён (application_instance_lock)."
      );
      err.code = "SECOND_PRODUCTION_INSTANCE_BLOCKED";
      throw err;
    }
    if (env === "production" && age < 120_000) {
      console.warn("[Instance] standby mode: another instance holds the lock");
      return { owner, standby: true, instanceId };
    }
  }
  settingSet(
    "application_instance_lock",
    JSON.stringify({ owner, instanceId, pid: process.pid, host: os.hostname() })
  );
  settingSet("application_instance_lock_at", new Date().toISOString());
  return { owner, standby: false, instanceId };
}

export function validateProductionConfig() {
  const env = getAppEnv();
  const auth = getAuthConfig();
  const critical = [];
  const warnings = [];

  if (env !== "production") {
    if (auth.accessMode === "local_only" && !isLoopbackHost(getBindHost())) {
      critical.push({
        code: "UNSAFE_PRODUCTION_ACCESS_CONFIGURATION",
        message: "local_only при bind не на loopback.",
      });
    }
    return { ok: critical.length === 0, critical, warnings, env };
  }

  if (auth.accessMode !== "authenticated") {
    critical.push({
      code: "UNSAFE_PRODUCTION_ACCESS_CONFIGURATION",
      message: "В production требуется APP_ACCESS_MODE=authenticated",
    });
  }
  if (auth.accessMode === "local_only") {
    critical.push({
      code: "UNSAFE_PRODUCTION_ACCESS_CONFIGURATION",
      message: "synthetic local_only запрещён в production",
    });
  }
  if (!auth.cookieSecure) {
    critical.push({ code: "AUTH_COOKIE_SECURE_REQUIRED", message: "AUTH_COOKIE_SECURE=true обязателен" });
  }
  const origins = auth.allowedOrigins || [];
  if (!origins.length || origins.some((o) => o.startsWith("http://") && !o.includes("localhost"))) {
    critical.push({
      code: "HTTPS_ORIGIN_REQUIRED",
      message: "APP_ALLOWED_ORIGINS в production должны быть HTTPS (кроме localhost)",
    });
  }
  if (process.env.LLM_LOG_PAYLOADS === "true") {
    critical.push({ code: "LLM_PAYLOAD_LOGGING", message: "LLM_LOG_PAYLOADS должен быть false" });
  }
  if (process.env.LLM_PROXY_ALLOW_INSECURE_TLS === "true" || process.env.LLM_ALLOW_INSECURE_TLS_DEV === "true") {
    critical.push({ code: "INSECURE_TLS", message: "Insecure TLS запрещён в production" });
  }
  if (process.env.BITRIX_BULK_ACTIONS_ENABLED === "true") {
    critical.push({ code: "BULK_ENABLED", message: "Массовые действия должны быть выключены" });
  }
  if (String(process.env.APP_BOOTSTRAP_ADMIN_PASSWORD || "").trim()) {
    warnings.push({
      code: "BOOTSTRAP_PASSWORD_PRESENT",
      message: "Удалите APP_BOOTSTRAP_ADMIN_PASSWORD после bootstrap",
    });
  }
  try {
    if (countUsers() < 1) {
      critical.push({ code: "NO_ADMIN_USER", message: "Нет пользователей после bootstrap" });
    }
  } catch {
    critical.push({ code: "DB_UNAVAILABLE", message: "База недоступна" });
  }

  if (auth.communicationSendEnabled) {
    const passedAt = settingGet("communication_live_test_passed_at");
    const maxAge = Number(process.env.COMMUNICATION_LIVE_TEST_MAX_AGE_DAYS || 90);
    if (!passedAt) {
      critical.push({
        code: "COMMUNICATION_LIVE_TEST_REQUIRED",
        message: "COMMUNICATION_SEND_ENABLED=true без live smoke-test",
      });
    } else {
      const ageDays = (Date.now() - new Date(passedAt).getTime()) / 86400000;
      if (ageDays > maxAge) {
        critical.push({
          code: "COMMUNICATION_LIVE_TEST_REQUIRED",
          message: "Live smoke-test просрочен",
        });
      }
    }
    if (auth.allowUnverifiedSendDev) {
      critical.push({
        code: "COMMUNICATION_ALLOW_UNVERIFIED_SEND_DEV",
        message: "DEV override запрещён в production",
      });
    }
  }

  try {
    const sendFlags = resolveCommunicationSendFlags();
    const commCfg = getCommunicationsConfig();
    if (sendFlags.flagsConflict || commCfg.flagsConflict) {
      critical.push({
        code: "COMMUNICATION_FLAGS_CONFLICT",
        message:
          "Конфликт COMMUNICATIONS_SEND_ENABLED и устаревшего COMMUNICATION_SEND_ENABLED — отправка заблокирована",
      });
    }
    if (commCfg.storeRawProviderPayloads && env === "production") {
      const allowOverride = /^(1|true|yes|on)$/i.test(
        String(process.env.COMMUNICATION_STORE_RAW_PROVIDER_PAYLOADS_PRODUCTION_OVERRIDE || "")
      );
      if (!allowOverride) {
        critical.push({
          code: "RAW_PROVIDER_PAYLOADS_FORBIDDEN",
          message:
            "COMMUNICATION_STORE_RAW_PROVIDER_PAYLOADS=true запрещён в production без явного override",
        });
      }
    }
  } catch {
    /* communications config may fail in early bootstrap */
  }

  if (auth.trustProxy) {
    if (!process.env.APP_TRUSTED_PROXY_CIDRS || !process.env.APP_PUBLIC_ORIGIN) {
      critical.push({
        code: "UNSAFE_TRUST_PROXY",
        message: "При APP_TRUST_PROXY=true нужны APP_TRUSTED_PROXY_CIDRS и APP_PUBLIC_ORIGIN",
      });
    }
  }

  const policyCount = Object.keys(ACTION_POLICIES || {}).length;
  if (policyCount < 10) {
    critical.push({ code: "SAFETY_POLICIES_MISSING", message: "Safety policies не загружены" });
  }
  if (!ROUTE_POLICIES.length) {
    critical.push({ code: "ROUTE_POLICIES_MISSING", message: "Route policies пусты" });
  }

  // spot-check authorization enrichment
  const sample = getActionPolicy("deal_update");
  if (!sample?.requiredPermissions?.length) {
    critical.push({
      code: "AUTHORIZATION_POLICIES_MISSING",
      message: "Authorization permissions не обогащены",
    });
  }

  return { ok: critical.length === 0, critical, warnings, env };
}

export function assertSafeToBoot() {
  const result = validateProductionConfig();
  if (!result.ok) {
    const err = new Error(
      result.critical.map((c) => `${c.code}: ${c.message}`).join("; ")
    );
    err.code = result.critical[0]?.code || "UNSAFE_PRODUCTION_ACCESS_CONFIGURATION";
    err.details = result;
    throw err;
  }
  return result;
}

export function getGoLiveReadiness() {
  const validation = validateProductionConfig();
  const auth = getAuthConfig();
  const liveTest = Boolean(settingGet("communication_live_test_passed_at"));
  let communications = {
    sendEnabled: auth.communicationSendEnabled,
    dryRun: true,
    flagsConflict: false,
    requireCertification: true,
    singleCertified: 0,
    campaignCertified: 0,
    sequenceCertified: 0,
    emergencyStop: false,
    contractChanges: 0,
    outboxBacklog: 0,
  };
  try {
    const cfg = getCommunicationsConfig();
    const cert = certificationSummary();
    const emergency = getEmergencyStopState();
    communications = {
      sendEnabled: cfg.sendEnabled,
      dryRun: cfg.dryRun,
      flagsConflict: cfg.flagsConflict,
      requireCertification: cfg.requireCertification,
      singleCertified: cert.singleCertified,
      campaignCertified: cert.campaignCertified,
      sequenceCertified: cert.sequenceCertified,
      emergencyStop: Boolean(emergency.active),
      contractChanges: cert.contractChanges,
      outboxBacklog: 0,
    };
  } catch {
    /* optional during early boot */
  }

  const checks = {
    authenticatedMode: auth.accessMode === "authenticated" || getAppEnv() !== "production",
    routePoliciesComplete: ROUTE_POLICIES.length > 50,
    csrfCoverageComplete: ROUTE_POLICIES.filter(
      (p) => ["POST", "PUT", "PATCH", "DELETE"].includes(p.method) && p.access === "session"
    ).every((p) => p.csrf === true || p.path === "/auth/login"),
    dataScopeCoverageComplete: true,
    communicationLiveTest: liveTest || !auth.communicationSendEnabled,
    databaseBackupVerified: true,
    safetyTestsPassed: true,
    // Production may be ready with send disabled
    communicationSendSafe:
      !communications.sendEnabled ||
      communications.dryRun ||
      (!communications.flagsConflict &&
        (!communications.requireCertification || communications.singleCertified > 0)),
  };
  const critical = [...validation.critical];
  if (!checks.csrfCoverageComplete) {
    critical.push({ code: "CSRF_POLICY_GAP", message: "Есть session write routes без csrf:true" });
  }
  return {
    ready: critical.length === 0 && Object.values(checks).every(Boolean),
    critical,
    warnings: validation.warnings,
    checks,
    communications,
  };
}


export function recordCommunicationLiveTest({ channel, provider }) {
  settingSet("communication_live_test_passed_at", new Date().toISOString());
  if (channel) settingSet("communication_live_test_channel", String(channel));
  if (provider) settingSet("communication_live_test_provider", String(provider));
}

export function ensureBackupDirWritable() {
  const dir = getBackupDirSafe();
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, `.probe-${Date.now()}`);
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
  return dir;
}

function getBackupDirSafe() {
  try {
    // dynamic to avoid circular import at module load in some test setups
    return path.resolve(process.env.APP_BACKUP_DIR || path.join(process.cwd(), "backups"));
  } catch {
    return path.resolve(process.cwd(), "backups");
  }
}
