/**
 * Database restore drill: backup → copy restore → integrity + counts.
 * npm run db:restore-drill
 * Приложение не запускается. Секреты (password_hash, session_token_hash) не печатаются.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { openDatabase, closeDatabase, getDefaultDbPath } from "../src/database/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getSeconds())}`;
}

function countSafe(db, table) {
  try {
    return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get()?.c ?? 0;
  } catch {
    return null;
  }
}

async function ensureSourceDb() {
  const sourcePath =
    process.env.APP_DATABASE_PATH ||
    process.env.BITRIX_OPERATIONS_DB_PATH ||
    getDefaultDbPath();

  if (fs.existsSync(sourcePath)) {
    return sourcePath;
  }

  const tmpSource = path.join(os.tmpdir(), `restore-drill-src-${Date.now()}.sqlite`);
  process.env.APP_DATABASE_PATH = tmpSource;
  process.env.BITRIX_OPERATIONS_DB_PATH = tmpSource;
  openDatabase({ reopen: true, dbPath: tmpSource });
  closeDatabase();
  return tmpSource;
}

async function main() {
  const sourcePath = await ensureSourceDb();
  const drillDir = path.join(root, "backups", "drill");
  fs.mkdirSync(drillDir, { recursive: true });

  const backupPath = path.join(drillDir, `restore-drill-${stamp()}.sqlite`);
  const restorePath = path.join(os.tmpdir(), `restore-drill-restore-${Date.now()}.sqlite`);

  const srcDb = openDatabase({ reopen: true, dbPath: sourcePath });
  await srcDb.backup(backupPath);
  closeDatabase();

  fs.copyFileSync(backupPath, restorePath);

  const db = new Database(restorePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma("integrity_check", { simple: true });
    const migrationVersion = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v ?? null;

    const counts = {
      operations: countSafe(db, "operations"),
      app_users: countSafe(db, "app_users"),
      app_roles: countSafe(db, "app_roles"),
      user_sessions: countSafe(db, "user_sessions"),
      notifications: countSafe(db, "notifications"),
      notification_recipients: countSafe(db, "notification_recipients"),
      chats: countSafe(db, "chats"),
      projects: countSafe(db, "projects"),
    };

    const ok = integrity === "ok" && migrationVersion != null;
    console.log(
      JSON.stringify(
        {
          ok,
          integrity,
          migrationVersion,
          backup: path.relative(root, backupPath).replace(/\\/g, "/"),
          restore: path.relative(root, restorePath).replace(/\\/g, "/"),
          counts,
        },
        null,
        2
      )
    );

    if (!ok) process.exit(1);
  } finally {
    db.close();
    try {
      fs.unlinkSync(restorePath);
    } catch {
      /* keep backup for audit */
    }
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
