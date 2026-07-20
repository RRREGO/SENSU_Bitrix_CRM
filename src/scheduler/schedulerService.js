/**
 * Планировщик плановых read-only отчётов.
 */

import crypto from "crypto";
import { getSchedulerConfig } from "./config.js";
import { resolveMisfire, calculateNextRunAt } from "./scheduleCalculator.js";
import { listSchedules, touchScheduleRun, seedDefaultSchedules, getScheduleById } from "../database/repositories/schedulesRepository.js";
import { listRunningRuns, completeRun } from "../database/repositories/reportRunsRepository.js";
import { acquireLock, releaseLock, getLock, isLockExpired } from "./locks.js";
import { executeScheduleRun, getRunningJobsCount, getSchedulerOwnerId } from "./reportRunner.js";
import { notifyScheduleFailed } from "./notificationService.js";
import { getUnreadCount } from "../database/repositories/notificationsRepository.js";

let timer = null;
let started = false;
let tickInProgress = false;

export function isSchedulerRunning() {
  return started && timer != null;
}

export function getSchedulerHealth() {
  const cfg = getSchedulerConfig();
  let activeSchedules = 0;
  let nextRunAt = null;
  try {
    const enabled = listSchedules({ enabledOnly: true });
    activeSchedules = enabled.length;
    nextRunAt = enabled
      .map((s) => s.nextRunAt)
      .filter(Boolean)
      .sort()[0] || null;
  } catch {
    /* migration not applied yet */
  }
  let unreadCritical = 0;
  try {
    unreadCritical = getUnreadCount().unreadCritical;
  } catch {
    /* ignore */
  }
  return {
    scheduler: {
      enabled: cfg.enabled,
      running: isSchedulerRunning(),
      activeSchedules,
      runningJobs: getRunningJobsCount(),
      nextRunAt,
      timezone: cfg.timezone,
    },
    notifications: {
      unreadCritical,
    },
  };
}

/** Истёкшие running → failed, без автоповтора */
export function recoverSchedulerOnStartup() {
  const cfg = getSchedulerConfig();
  try {
    seedDefaultSchedules();
  } catch (error) {
    console.warn("[Scheduler] seed failed:", error.message);
  }

  const running = listRunningRuns();
  for (const run of running) {
    const lock = getLock(`report-run:${run.id}`) || getLock(`report-type:${getScheduleById(run.scheduleId)?.reportType}`);
    if (!lock || isLockExpired(lock)) {
      completeRun(run.id, {
        status: "failed",
        error: {
          code: "RECOVERY_REQUIRED",
          message: "Run прерван рестартом сервера. Автоповтор не выполнен — используйте retry вручную.",
        },
        durationMs: null,
      });
      const schedule = getScheduleById(run.scheduleId);
      notifyScheduleFailed(run, schedule || { id: run.scheduleId, name: "schedule" }, {
        code: "RECOVERY_REQUIRED",
        message: "Плановый отчёт прерван при рестарте.",
      });
      if (schedule) {
        touchScheduleRun(schedule.id, {
          lastRunAt: new Date().toISOString(),
          nextRunAt: calculateNextRunAt(schedule, new Date()),
        });
      }
      console.warn(`[Scheduler] recovered interrupted run=${run.id} → failed`);
    }
  }

  // Recalc next for enabled schedules without next_run_at
  for (const s of listSchedules({ enabledOnly: true })) {
    if (!s.nextRunAt) {
      touchScheduleRun(s.id, {
        lastRunAt: s.lastRunAt,
        nextRunAt: calculateNextRunAt(s, new Date()),
      });
    }
  }

  return { recovered: running.length, enabled: cfg.enabled };
}

async function tick() {
  if (tickInProgress) return;
  const cfg = getSchedulerConfig();
  if (!cfg.enabled) return;

  const tickLock = acquireLock("scheduler:tick", getSchedulerOwnerId(), cfg.pollIntervalSeconds + 5);
  if (!tickLock.acquired) return;

  tickInProgress = true;
  try {
    const due = listSchedules({ enabledOnly: true });
    for (const schedule of due) {
      if (getRunningJobsCount() >= cfg.maxConcurrentRuns) break;

      const misfire = resolveMisfire(schedule);
      if (misfire.action === "wait") continue;

      if (misfire.action === "skip_old") {
        console.log(
          `[Scheduler] skip old misfire schedule=${schedule.id} delayMin=${Math.round(misfire.delayMin)}`
        );
        touchScheduleRun(schedule.id, {
          lastRunAt: schedule.lastRunAt,
          nextRunAt: calculateNextRunAt(schedule, new Date()),
        });
        continue;
      }

      if (misfire.action === "run" || misfire.action === "skip") {
        if (misfire.action === "skip" && misfire.reason === "no_next") {
          touchScheduleRun(schedule.id, {
            lastRunAt: schedule.lastRunAt,
            nextRunAt: calculateNextRunAt(schedule, new Date()),
          });
          continue;
        }
      }

      if (misfire.action !== "run") continue;

      try {
        await executeScheduleRun(schedule.id, { scheduledFor: misfire.scheduledFor });
      } catch (error) {
        if (error.code === "SCHEDULER_BUSY" || error.code === "LOCK_NOT_ACQUIRED") {
          console.log(`[Scheduler] defer ${schedule.id}: ${error.code}`);
          continue;
        }
        console.warn(`[Scheduler] tick error ${schedule.id}:`, error.message);
      }
    }
  } finally {
    tickInProgress = false;
    releaseLock("scheduler:tick", getSchedulerOwnerId());
  }
}

export function startScheduler() {
  const cfg = getSchedulerConfig();
  if (!cfg.enabled) {
    console.log("[Scheduler] disabled (SCHEDULER_ENABLED=false)");
    return { started: false };
  }
  if (started) return { started: true, already: true };

  recoverSchedulerOnStartup();
  timer = setInterval(() => {
    tick().catch((e) => console.warn("[Scheduler] tick failed:", e.message));
  }, cfg.pollIntervalSeconds * 1000);
  if (typeof timer.unref === "function") timer.unref();
  started = true;
  console.log(
    `[Scheduler] started tz=${cfg.timezone} poll=${cfg.pollIntervalSeconds}s owner=${getSchedulerOwnerId()}`
  );
  // Immediate catch-up tick
  tick().catch(() => {});
  return { started: true };
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
