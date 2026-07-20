/**
 * Liveness / readiness helpers.
 */

import { getDatabase } from "../database/index.js";
import { ROUTE_POLICIES } from "../auth/routePolicies.js";
import { ACTION_POLICIES, getActionPolicy } from "../safety/policies.js";
import { validateProductionConfig, getAppEnv } from "../config/productionValidator.js";
import { getOperationalModes } from "./operationalModes.js";
import { isSchedulerRunning } from "../scheduler/schedulerService.js";
import { isShuttingDown } from "./shutdown.js";
import { getCommunicationsConfig } from "../communications/config.js";
import {
  getEmergencyStopState,
} from "../communications/certification/certificationService.js";
import { certificationSummary } from "../communications/certification/certificationRepository.js";
import { getOutboxHealth } from "../communications/communicationScheduler.js";

export function getReadinessReport() {
  const critical = [];
  const warnings = [];

  if (isShuttingDown()) {
    critical.push({ code: "SHUTTING_DOWN", message: "Процесс завершается." });
  }

  try {
    const db = getDatabase();
    db.prepare("SELECT 1").get();
    const version = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v;
    if (!version || version < 11) {
      critical.push({
        code: "MIGRATIONS_INCOMPLETE",
        message: `Ожидается migration >= 11, сейчас ${version}`,
      });
    }
  } catch (error) {
    critical.push({ code: "DATABASE_UNAVAILABLE", message: error.message });
  }

  try {
    const lock = getDatabase()
      .prepare("SELECT value_json FROM app_settings WHERE key = 'application_instance_lock'")
      .get();
    if (!lock && getAppEnv() === "production") {
      warnings.push({ code: "INSTANCE_LOCK_MISSING", message: "Instance lock отсутствует." });
    }
  } catch {
    warnings.push({ code: "INSTANCE_LOCK_CHECK_FAILED", message: "Не удалось проверить instance lock." });
  }

  const validation = validateProductionConfig();
  for (const c of validation.critical) critical.push(c);
  for (const w of validation.warnings) warnings.push(w);

  if (!ROUTE_POLICIES.length) {
    critical.push({ code: "ROUTE_POLICIES_MISSING", message: "Route policies пусты." });
  }
  if (Object.keys(ACTION_POLICIES || {}).length < 10) {
    critical.push({ code: "SAFETY_POLICIES_MISSING", message: "Safety policies не загружены." });
  }
  const sample = getActionPolicy("deal_update");
  if (!sample?.requiredPermissions?.length) {
    critical.push({
      code: "AUTHORIZATION_POLICIES_MISSING",
      message: "Authorization permissions не обогащены.",
    });
  }

  const modes = getOperationalModes();
  if (modes.maintenanceMode) {
    warnings.push({ code: "MAINTENANCE_MODE", message: "Режим обслуживания." });
  }
  if (modes.schedulerEnabled && !isSchedulerRunning() && getAppEnv() === "production") {
    warnings.push({ code: "SCHEDULER_NOT_RUNNING", message: "Scheduler не запущен." });
  }

  try {
    const cfg = getCommunicationsConfig();
    const cert = certificationSummary();
    const emergency = getEmergencyStopState();
    const outbox = getOutboxHealth();

    if (cfg.flagsConflict) {
      critical.push({
        code: "COMMUNICATION_FLAGS_CONFLICT",
        message: "Конфликт COMMUNICATIONS_SEND_ENABLED и COMMUNICATION_SEND_ENABLED.",
      });
    }
    if (emergency.active) {
      warnings.push({
        code: "COMMUNICATIONS_EMERGENCY_STOP",
        message: emergency.reason || "Аварийная остановка коммуникаций.",
      });
    }
    // Production may be ready with send disabled. If send is on — certification required.
    if (cfg.sendEnabled && !cfg.dryRun && cfg.requireCertification && cert.singleCertified < 1) {
      critical.push({
        code: "COMMUNICATION_CERTIFICATION_REQUIRED",
        message: "Send включён без single-send certification.",
      });
    }
    if (cert.contractChanges > 0) {
      warnings.push({
        code: "PROVIDER_CONTRACT_CHANGED",
        message: `Обнаружены изменения provider contract: ${cert.contractChanges}`,
      });
    }
    if (outbox.pending > 500) {
      warnings.push({
        code: "OUTBOX_BACKLOG",
        message: `Большой backlog outbox: ${outbox.pending}`,
      });
    }
  } catch {
    /* hub/cert tables may be absent during partial boot */
  }

  warnings.push({
    code: "EXTERNAL_DEPS_SOFT",
    message: "Bitrix/LLM проверяются probes и не блокируют readiness по умолчанию.",
  });

  return {
    ready: critical.length === 0,
    critical,
    warnings,
    checks: {
      database: !critical.some((c) => c.code === "DATABASE_UNAVAILABLE"),
      migrations: !critical.some((c) => c.code === "MIGRATIONS_INCOMPLETE"),
      productionConfig: validation.ok || getAppEnv() !== "production",
      routePolicies: ROUTE_POLICIES.length > 0,
      safetyPolicies: Object.keys(ACTION_POLICIES || {}).length >= 10,
      authorizationPolicies: Boolean(sample?.requiredPermissions?.length),
      scheduler: modes.schedulerEnabled ? isSchedulerRunning() : true,
    },
  };
}
