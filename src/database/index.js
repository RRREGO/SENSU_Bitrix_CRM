import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { migrations } from "./migrations.js";
import { getDefaultDatabasePath, ensureAppDirs } from "../config/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.resolve(__dirname, "../../data/operations.sqlite");

let dbInstance = null;
let searchMode = "like";

function ensureDataDir(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function applyMigrations(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`);

  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((r) => r.version)
  );

  const insert = db.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;

    const run = db.transaction(() => {
      db.exec(migration.sql);
      insert.run(migration.version, migration.name, new Date().toISOString());
    });
    run();
    console.log(`[DB] Applied migration ${migration.version}: ${migration.name}`);
  }
}

/**
 * Открыть (или вернуть) SQLite БД safety layer.
 * @param {{ dbPath?: string, readonly?: boolean, reopen?: boolean }} [options]
 */
export function openDatabase(options = {}) {
  if (dbInstance && !options.reopen) {
    return dbInstance;
  }

  if (dbInstance && options.reopen) {
    try {
      dbInstance.close();
    } catch {
      /* ignore */
    }
    dbInstance = null;
  }

  try {
    ensureAppDirs();
  } catch {
    /* ignore */
  }

  const dbPath = options.dbPath || getDefaultDatabasePath() || DEFAULT_DB_PATH;
  ensureDataDir(dbPath);

  const db = new Database(dbPath, {
    readonly: Boolean(options.readonly),
    fileMustExist: Boolean(options.readonly),
  });

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  if (!options.readonly) {
    applyMigrations(db);
    ensureSearchIndex(db);
    try {
      import("./repositories/meetingProtocolsRepository.js")
        .then((m) => m.ensureDefaultProtocolTemplate())
        .catch(() => {});
      import("./repositories/schedulesRepository.js")
        .then((m) => m.seedDefaultSchedules())
        .catch(() => {});
    } catch {
      /* ignore */
    }
  }

  dbInstance = db;
  return db;
}

function ensureSearchIndex(db) {
  try {
    db.exec(`
CREATE VIRTUAL TABLE IF NOT EXISTS workspace_search USING fts5(
  entity_type,
  entity_id,
  title,
  body,
  project_name,
  crm_entity_type,
  crm_entity_id,
  tokenize = 'unicode61'
);
`);
    searchMode = "fts5";
    console.log("[DB] Search index: fts5");
  } catch (error) {
    searchMode = "like";
    console.warn(`[DB] FTS5 unavailable, using LIKE search: ${error.message}`);
  }
}

export function getSearchMode() {
  return searchMode;
}

export function getDatabase() {
  if (!dbInstance) {
    return openDatabase();
  }
  return dbInstance;
}

export function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function getDefaultDbPath() {
  return getDefaultDatabasePath();
}

export function getMigrationCompatibility(version) {
  const m = migrations.find((x) => x.version === version);
  if (!m) return null;
  return {
    version: m.version,
    name: m.name,
    backwardCompatibleFrom: m.backwardCompatibleFrom ?? Math.max(0, m.version - 1),
    description: m.description || m.name,
    destructive: Boolean(m.destructive),
  };
}
