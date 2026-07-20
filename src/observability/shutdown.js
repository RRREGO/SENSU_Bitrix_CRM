/**
 * Graceful shutdown: stop HTTP, scheduler, close DB, release instance lock.
 */

import { logger } from "./logger.js";
import { stopScheduler } from "../scheduler/schedulerService.js";
import { closeDatabase } from "../database/index.js";
import { getDatabase } from "../database/index.js";

let shuttingDown = false;
let httpServer = null;
let instanceLockOwner = null;

export function isShuttingDown() {
  return shuttingDown;
}

export function registerHttpServer(server) {
  httpServer = server;
}

export function registerInstanceLock(lock) {
  instanceLockOwner = lock;
}

export function releaseApplicationInstanceLock() {
  try {
    const db = getDatabase();
    const existing = db.prepare("SELECT value_json FROM app_settings WHERE key = ?").get(
      "application_instance_lock"
    );
    if (!existing) return;
    let parsed;
    try {
      parsed = JSON.parse(existing.value_json);
    } catch {
      parsed = null;
    }
    if (
      instanceLockOwner?.instanceId &&
      parsed?.instanceId &&
      parsed.instanceId !== instanceLockOwner.instanceId
    ) {
      return;
    }
    db.prepare("DELETE FROM app_settings WHERE key = ?").run("application_instance_lock");
    db.prepare("DELETE FROM app_settings WHERE key = ?").run("application_instance_lock_at");
  } catch (error) {
    logger.warn("shutdown.lock_release_failed", { message: error.message });
  }
}

export async function gracefulShutdown(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  const timeoutSec = Number(process.env.APP_SHUTDOWN_TIMEOUT_SECONDS || 30);
  logger.info("shutdown.started", { signal, timeoutSec });

  const forceTimer = setTimeout(() => {
    logger.fatal("shutdown.timeout", { timeoutSec });
    process.exit(1);
  }, timeoutSec * 1000);
  forceTimer.unref?.();

  try {
    if (httpServer) {
      await new Promise((resolve) => {
        httpServer.close(() => resolve());
        setTimeout(resolve, Math.min(10_000, timeoutSec * 1000));
      });
      logger.info("shutdown.http_closed");
    }

    stopScheduler();
    logger.info("shutdown.scheduler_stopped");

    try {
      const { stopHealthProbes } = await import("./healthProbes.js");
      stopHealthProbes();
      const { stopDiskMonitor } = await import("./diskMonitor.js");
      stopDiskMonitor();
    } catch {
      /* ignore */
    }

    // Do not interrupt in-flight writes — executor marks them; recovery handles executing
    releaseApplicationInstanceLock();
    logger.info("shutdown.lock_released");

    closeDatabase();
    logger.info("shutdown.database_closed");
  } catch (error) {
    logger.error("shutdown.error", { message: error.message });
  } finally {
    clearTimeout(forceTimer);
    logger.info("shutdown.completed");
    process.exit(0);
  }
}

export function installProcessHandlers() {
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGHUP", async () => {
    try {
      const { reopenLogFile } = await import("./logger.js");
      reopenLogFile();
      logger.info("logger.reopened");
    } catch {
      /* ignore */
    }
  });
  process.on("uncaughtException", (error) => {
    logger.fatal("process.uncaught_exception", { message: error.message });
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("process.unhandled_rejection", {
      message: reason instanceof Error ? reason.message : String(reason),
    });
  });
}
