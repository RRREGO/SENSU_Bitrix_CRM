/**
 * Disk / WAL / backup size monitoring.
 */

import fs from "fs";
import path from "path";
import { getDataDir, getBackupDir, getLogDir, getDefaultDatabasePath } from "../config/paths.js";
import { logger } from "./logger.js";
import { recordApplicationError } from "../database/repositories/applicationErrorsRepository.js";
import { setRuntimeMode, getOperationalModes } from "./operationalModes.js";
import { notifySystemFailure } from "../scheduler/notificationService.js";

function dirSizeBytes(dir) {
  try {
    let total = 0;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      total += st.isDirectory() ? dirSizeBytes(p) : st.size;
    }
    return total;
  } catch {
    return 0;
  }
}

function freePercent(targetPath) {
  // Node does not expose df portably; approximate via best-effort
  try {
    // Windows / Linux: use checked path existence only; return null if unknown
    if (!fs.existsSync(targetPath)) return null;
    return null;
  } catch {
    return null;
  }
}

export function getDiskSnapshot() {
  const dbPath = getDefaultDatabasePath();
  const walPath = `${dbPath}-wal`;
  const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
  return {
    dataDir: getDataDir(),
    databaseBytes: dbSize,
    walBytes: walSize,
    backupsBytes: dirSizeBytes(getBackupDir()),
    logsBytes: dirSizeBytes(getLogDir()),
    freePercent: freePercent(getDataDir()),
  };
}

export function evaluateDiskThresholds() {
  const snap = getDiskSnapshot();
  const dbWarnMb = Number(process.env.DATABASE_SIZE_WARNING_MB || 2048);
  const walWarnMb = Number(process.env.WAL_SIZE_WARNING_MB || 512);
  const warnFree = Number(process.env.DISK_WARNING_FREE_PERCENT || 15);
  const critFree = Number(process.env.DISK_CRITICAL_FREE_PERCENT || 5);
  const warnings = [];
  const critical = [];

  if (snap.databaseBytes > dbWarnMb * 1024 * 1024) {
    warnings.push({ code: "DATABASE_SIZE_WARNING", mb: Math.round(snap.databaseBytes / 1024 / 1024) });
  }
  if (snap.walBytes > walWarnMb * 1024 * 1024) {
    warnings.push({ code: "WAL_SIZE_WARNING", mb: Math.round(snap.walBytes / 1024 / 1024) });
  }
  if (snap.freePercent != null && snap.freePercent < warnFree) {
    warnings.push({ code: "DISK_WARNING_FREE", freePercent: snap.freePercent });
  }
  if (snap.freePercent != null && snap.freePercent < critFree) {
    critical.push({ code: "DISK_CRITICAL_FREE", freePercent: snap.freePercent });
  }

  for (const w of warnings) {
    logger.warn("disk.warning", w);
  }
  for (const c of critical) {
    logger.error("disk.critical", c);
    recordApplicationError({
      source: "database",
      errorCode: c.code,
      severity: "critical",
      messageSafe: "Критически мало места на диске.",
      details: c,
    });
    try {
      notifySystemFailure({
        title: "Мало места на диске",
        message: "Рекомендуется режим только чтения до освобождения места.",
        data: c,
      });
    } catch {
      /* ignore */
    }
    if (!getOperationalModes().readOnlyMode) {
      setRuntimeMode({ readOnlyMode: true }, { reason: "disk_critical", userId: "system" });
    }
  }
  return { snapshot: snap, warnings, critical };
}

let diskTimer = null;
export function startDiskMonitor() {
  diskTimer = setInterval(() => {
    try {
      evaluateDiskThresholds();
    } catch {
      /* ignore */
    }
  }, 15 * 60_000);
  diskTimer.unref?.();
}

export function stopDiskMonitor() {
  if (diskTimer) clearInterval(diskTimer);
  diskTimer = null;
}
