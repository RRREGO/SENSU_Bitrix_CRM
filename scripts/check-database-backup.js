/**
 * Проверка backup SQLite (read-only).
 * Запуск: node scripts/check-database-backup.js [path]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function latestBackup() {
  const dir = path.join(root, "backups");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sqlite"))
    .map((f) => ({
      name: f,
      path: path.join(dir, f),
      mtime: fs.statSync(path.join(dir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0]?.path || null;
}

function main() {
  const backupPath = process.argv[2] || latestBackup();
  if (!backupPath || !fs.existsSync(backupPath)) {
    console.error("Backup не найден. Сначала выполните: npm run db:backup");
    process.exit(1);
  }

  const db = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma("integrity_check", { simple: true });
    const journalMode = String(db.pragma("journal_mode", { simple: true }) || "");

    let migrationVersion = null;
    let workspaceCounts = {};
    let operations = 0;
    let events = 0;
    let items = 0;

    try {
      migrationVersion = db
        .prepare("SELECT MAX(version) AS v FROM schema_migrations")
        .get()?.v;
      operations = db.prepare("SELECT COUNT(*) AS c FROM operations").get()?.c ?? 0;
      events = db.prepare("SELECT COUNT(*) AS c FROM operation_events").get()?.c ?? 0;
      items = db.prepare("SELECT COUNT(*) AS c FROM operation_items").get()?.c ?? 0;

      const countSafe = (table) => {
        try {
          return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get()?.c ?? 0;
        } catch {
          return null;
        }
      };

      workspaceCounts = {
        profiles: countSafe("profiles"),
        projects: countSafe("projects"),
        project_files: countSafe("project_files"),
        chats: countSafe("chats"),
        messages: countSafe("messages"),
        chat_summaries: countSafe("chat_summaries"),
        report_schedules: countSafe("report_schedules"),
        report_runs: countSafe("report_runs"),
        notifications: countSafe("notifications"),
        notification_recipients: countSafe("notification_recipients"),
        app_users: countSafe("app_users"),
        app_roles: countSafe("app_roles"),
        role_permissions: countSafe("role_permissions"),
        user_sessions: countSafe("user_sessions"),
        auth_events: countSafe("auth_events"),
        project_members: countSafe("project_members"),
      };

      const requiredV7 = [
        "app_users",
        "app_roles",
        "role_permissions",
        "user_sessions",
        "auth_events",
        "project_members",
        "notification_recipients",
      ];
      const missingV7 = requiredV7.filter((t) => workspaceCounts[t] == null);
      if (missingV7.length) {
        console.error("Backup missing v7 tables:", missingV7.join(", "));
        process.exit(1);
      }
    } catch (error) {
      console.error("Ошибка чтения таблиц:", error.message);
      process.exit(1);
    }

    const ok = integrity === "ok";
    console.log(
      JSON.stringify(
        {
          ok,
          backup: path.relative(root, backupPath).replace(/\\/g, "/"),
          integrity,
          journalMode,
          migrationVersion,
          counts: {
            operations,
            operation_items: items,
            operation_events: events,
            ...workspaceCounts,
          },
        },
        null,
        2
      )
    );
    process.exit(ok ? 0 : 1);
  } finally {
    db.close();
  }
}

main();
