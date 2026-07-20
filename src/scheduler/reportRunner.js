/**
 * Выполнение одного планового отчёта (read-only).
 */

import crypto from "crypto";
import { getScheduleById, touchScheduleRun } from "../database/repositories/schedulesRepository.js";
import {
  createRun,
  markRunRunning,
  completeRun,
  getLastSuccessfulRun,
  getRunById,
} from "../database/repositories/reportRunsRepository.js";
import { assertKnownReportType } from "./reportRegistry.js";
import { runRegisteredReport, maybeAttachNarrative } from "./reportBuilders.js";
import { buildIdempotencyKey, calculateNextRunAt } from "./scheduleCalculator.js";
import { acquireLock, releaseLock } from "./locks.js";
import { getSchedulerConfig, SchedulerError } from "./config.js";
import {
  notifyReportReady,
  notifyCriticalAlerts,
  notifyScheduleFailed,
  notifyWarning,
} from "./notificationService.js";

const ownerId = `scheduler-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;

let runningCount = 0;

export function getRunningJobsCount() {
  return runningCount;
}

export function getSchedulerOwnerId() {
  return ownerId;
}

/**
 * @param {string} scheduleId
 * @param {{ scheduledFor?: string, force?: boolean, retryOfRunId?: string }} options
 */
export async function executeScheduleRun(scheduleId, options = {}) {
  const cfg = getSchedulerConfig();
  const schedule = getScheduleById(scheduleId);
  if (!schedule) {
    throw new SchedulerError("SCHEDULE_NOT_FOUND", "Расписание не найдено.");
  }
  assertKnownReportType(schedule.reportType);

  if (runningCount >= cfg.maxConcurrentRuns && !options.force) {
    throw new SchedulerError(
      "SCHEDULER_BUSY",
      `Уже выполняется ${runningCount} отчёт(ов); лимит ${cfg.maxConcurrentRuns}.`
    );
  }

  const scheduledFor = options.scheduledFor || schedule.nextRunAt || new Date().toISOString();
  const idempotencyKey = options.retryOfRunId
    ? `${buildIdempotencyKey(scheduleId, scheduledFor)}:retry:${options.retryOfRunId}:${Date.now()}`
    : buildIdempotencyKey(scheduleId, scheduledFor);

  const lockKey = `report-type:${schedule.reportType}`;
  const lock = acquireLock(lockKey, ownerId, cfg.lockTtlSeconds);
  if (!lock.acquired) {
    throw new SchedulerError("LOCK_NOT_ACQUIRED", "Отчёт этого типа уже выполняется.", {
      lockKey,
    });
  }

  const { run, created } = createRun({
    scheduleId,
    scheduledFor,
    idempotencyKey,
    status: "queued",
    retryOfRunId: options.retryOfRunId || null,
  });

  if (!created && !options.retryOfRunId) {
    releaseLock(lockKey, ownerId);
    return { run, skipped: true, reason: "idempotent" };
  }

  runningCount += 1;
  const started = Date.now();
  markRunRunning(run.id);

  try {
    const previous = getLastSuccessfulRun(scheduleId);
    const previousMetrics = previous?.report?.metrics || previous?.report?.summary || null;

    const params = {
      ...schedule.params,
      alertRules: schedule.alertRules,
    };

    let report = await Promise.race([
      runRegisteredReport(schedule.reportType, params, previousMetrics),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new SchedulerError("REPORT_TIMEOUT", "Превышен timeout планового отчёта")),
          cfg.maxRuntimeSeconds * 1000
        )
      ),
    ]);

    const narrative = await maybeAttachNarrative(report, schedule.narrativeEnabled);
    report = narrative.report;
    const warnings = [...(report.warnings || [])];
    if (narrative.narrativeWarning) warnings.push(narrative.narrativeWarning);

    const status = report.partial || warnings.some((w) => w.code === "PARTIAL_REPORT")
      ? "partial"
      : "completed";

    const summaryText = [
      schedule.name,
      report.narrative || null,
      `Критических алертов: ${(report.criticalAlerts || []).length}`,
      report.partial ? "partial" : null,
    ]
      .filter(Boolean)
      .join("\n");

    const completed = completeRun(run.id, {
      status,
      report,
      summaryText,
      warnings,
      durationMs: Date.now() - started,
    });

    const nextRunAt = calculateNextRunAt(schedule, new Date());
    touchScheduleRun(scheduleId, {
      lastRunAt: new Date().toISOString(),
      nextRunAt,
    });

    notifyReportReady(completed, schedule, report);
    notifyCriticalAlerts(completed, schedule, report.criticalAlerts);
    for (const w of warnings.filter((x) => x.severity === "warning" || x.code === "REPORT_NARRATIVE_UNAVAILABLE")) {
      notifyWarning(completed, schedule, w);
    }

    console.log(
      `[Scheduler] run=${completed.id} type=${schedule.reportType} status=${status} durationMs=${completed.durationMs}`
    );

    return { run: completed, skipped: false };
  } catch (error) {
    const completed = completeRun(run.id, {
      status: "failed",
      error: { code: error.code || "SCHEDULE_FAILED", message: error.message },
      warnings: [],
      durationMs: Date.now() - started,
    });
    const nextRunAt = calculateNextRunAt(schedule, new Date());
    touchScheduleRun(scheduleId, {
      lastRunAt: new Date().toISOString(),
      nextRunAt,
    });
    notifyScheduleFailed(completed, schedule, error);
    console.warn(`[Scheduler] failed schedule=${scheduleId}: ${error.message}`);
    return { run: completed, skipped: false, failed: true };
  } finally {
    runningCount = Math.max(0, runningCount - 1);
    releaseLock(lockKey, ownerId);
  }
}

export async function retryFailedRun(runId) {
  const run = getRunById(runId);
  if (!run) throw new SchedulerError("RUN_NOT_FOUND", "Run не найден.");
  if (!["failed", "skipped"].includes(run.status) && run.status !== "partial") {
    // allow retry of failed primarily
  }
  return executeScheduleRun(run.scheduleId, {
    scheduledFor: run.scheduledFor,
    force: true,
    retryOfRunId: run.id,
  });
}
