/**
 * Snapshot SQLite с учётом WAL (better-sqlite3 backup API).
 * Запуск: npm run db:backup
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { openDatabase, closeDatabase, getDefaultDbPath } from "../src/database/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function main() {
  const { getBackupDir } = await import("../src/config/paths.js");
  const backupsDir = getBackupDir();
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const sourcePath = process.env.APP_DATABASE_PATH || process.env.BITRIX_OPERATIONS_DB_PATH || getDefaultDbPath();
  const destPath = path.join(backupsDir, `operations-${stamp()}.sqlite`);

  if (fs.existsSync(destPath)) {
    console.error(`Файл уже существует: ${destPath}`);
    process.exit(1);
  }

  const db = openDatabase({ dbPath: sourcePath, reopen: true });

  // Корректный snapshot с учётом WAL
  await db.backup(destPath);

  closeDatabase();

  const stat = fs.statSync(destPath);
  console.log(
    JSON.stringify(
      {
        ok: true,
        backup: path.relative(root, destPath).replace(/\\/g, "/"),
        bytes: stat.size,
        createdAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
