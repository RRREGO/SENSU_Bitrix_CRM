/**
 * Prune old SQLite backups. Keeps BACKUP_RETENTION_DAILY recent days
 * and BACKUP_RETENTION_WEEKLY weekly snapshots beyond that.
 * Never deletes the newest backup file.
 * npm run db:backup-retention
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getBackupDir } from "../src/config/paths.js";

const DAILY = Math.max(1, Number(process.env.BACKUP_RETENTION_DAILY) || 14);
const WEEKLY = Math.max(1, Number(process.env.BACKUP_RETENTION_WEEKLY) || 8);

function parseBackupDate(filename) {
  const m = filename.match(/operations-(\d{4})(\d{2})(\d{2})-/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function isoWeekKey(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function daysBetween(dateStr, todayStr) {
  const a = new Date(`${dateStr}T00:00:00Z`);
  const b = new Date(`${todayStr}T00:00:00Z`);
  return Math.floor((b - a) / 86400000);
}

export function selectBackupsToKeep(files, { daily = DAILY, weekly = WEEKLY, today = new Date() } = {}) {
  if (!files.length) return { keep: new Set(), delete: [] };

  const sorted = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const keep = new Set();
  const todayStr = today.toISOString().slice(0, 10);

  // Always keep newest
  keep.add(sorted[0].path);

  const byDate = new Map();
  for (const f of sorted) {
    const date = parseBackupDate(f.name) || new Date(f.mtimeMs).toISOString().slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, f);
    else if (f.mtimeMs > byDate.get(date).mtimeMs) byDate.set(date, f);
  }

  const dates = [...byDate.keys()].sort().reverse();
  const dailyDates = new Set(dates.filter((d) => daysBetween(d, todayStr) < daily));
  for (const d of dailyDates) keep.add(byDate.get(d).path);

  const weeklyKept = new Set();
  for (const d of dates) {
    if (dailyDates.has(d)) continue;
    const wk = isoWeekKey(d);
    if (weeklyKept.size >= weekly) continue;
    if (!weeklyKept.has(wk)) {
      weeklyKept.add(wk);
      keep.add(byDate.get(d).path);
    }
  }

  const toDelete = sorted.filter((f) => !keep.has(f.path)).map((f) => f.path);
  return { keep, delete: toDelete };
}

export function pruneBackups({ dryRun = false } = {}) {
  const dir = getBackupDir();
  if (!fs.existsSync(dir)) {
    return { ok: true, kept: 0, deleted: 0, skipped: true, reason: "backup_dir_missing" };
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sqlite"))
    .map((f) => {
      const full = path.join(dir, f);
      return { name: f, path: full, mtimeMs: fs.statSync(full).mtimeMs };
    });

  const { keep, delete: toDelete } = selectBackupsToKeep(files);
  let deleted = 0;

  for (const p of toDelete) {
    if (!dryRun) fs.unlinkSync(p);
    deleted += 1;
  }

  return {
    ok: true,
    backupDir: dir,
    total: files.length,
    kept: keep.size,
    deleted,
    dryRun,
    retention: { daily: DAILY, weekly: WEEKLY },
  };
}

function main() {
  const dryRun = process.env.DRY_RUN === "1";
  const result = pruneBackups({ dryRun });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main();
