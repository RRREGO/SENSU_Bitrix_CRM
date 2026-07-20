/**
 * Production / shared paths. Local defaults keep working without APP_*_DIR.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

export function getAppRoot() {
  return process.env.APP_ROOT ? path.resolve(process.env.APP_ROOT) : ROOT;
}

export function getDataDir() {
  if (process.env.APP_DATA_DIR) return path.resolve(process.env.APP_DATA_DIR);
  return path.join(getAppRoot(), "data");
}

export function getLogDir() {
  if (process.env.APP_LOG_DIR) return path.resolve(process.env.APP_LOG_DIR);
  return path.join(getAppRoot(), "logs");
}

export function getBackupDir() {
  if (process.env.APP_BACKUP_DIR) return path.resolve(process.env.APP_BACKUP_DIR);
  return path.join(getAppRoot(), "backups");
}

export function getDefaultDatabasePath() {
  if (process.env.APP_DATABASE_PATH) return path.resolve(process.env.APP_DATABASE_PATH);
  if (process.env.BITRIX_OPERATIONS_DB_PATH) return path.resolve(process.env.BITRIX_OPERATIONS_DB_PATH);
  return path.join(getDataDir(), "operations.sqlite");
}

export function getReleaseMetadata() {
  return {
    version: process.env.APP_VERSION || "0.0.0-dev",
    releaseId: process.env.APP_RELEASE_ID || process.env.APP_VERSION || "local",
    commitSha: process.env.APP_COMMIT_SHA || null,
    buildTime: process.env.APP_BUILD_TIME || null,
  };
}

export function ensureAppDirs() {
  for (const dir of [getDataDir(), getLogDir(), getBackupDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function checkEnvFilePermissions(envPath) {
  if (process.platform === "win32") return { ok: true };
  try {
    if (!envPath || !fs.existsSync(envPath)) return { ok: true, skipped: true };
    const mode = fs.statSync(envPath).mode & 0o777;
    // world/group readable is too open for secrets
    if (mode & 0o077) {
      return {
        ok: false,
        code: "ENV_FILE_PERMISSIONS_TOO_OPEN",
        mode: mode.toString(8),
        message: `.env permissions ${mode.toString(8)} too open; use 600`,
      };
    }
    return { ok: true, mode: mode.toString(8) };
  } catch (error) {
    return { ok: true, skipped: true, error: error.message };
  }
}
