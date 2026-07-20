import { getDatabase } from "../index.js";
import { WorkspaceError } from "../../workspace/config.js";
import { redactObject } from "../../safety/redact.js";

function now() {
  return new Date().toISOString();
}

const FORBIDDEN_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "BITRIX_WEBHOOK_URL",
  "ANTHROPIC_PROXY",
  "executionToken",
  "proxyPassword",
]);

export function getSetting(key, fallback = null) {
  const row = getDatabase().prepare("SELECT value_json FROM app_settings WHERE key = ?").get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return fallback;
  }
}

export function setSetting(key, value) {
  if (FORBIDDEN_KEYS.has(key) || /API_KEY|WEBHOOK|PASSWORD|TOKEN|SECRET|PROXY/i.test(key)) {
    throw new WorkspaceError(
      "DATABASE_WRITE_FAILED",
      "Секреты нельзя сохранять в app_settings."
    );
  }

  const safe = redactObject(value);
  try {
    getDatabase()
      .prepare(
        `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(safe), now());
  } catch (error) {
    throw new WorkspaceError("DATABASE_WRITE_FAILED", error.message);
  }
  return getSetting(key);
}

export function listSettings() {
  return getDatabase()
    .prepare("SELECT key, value_json, updated_at FROM app_settings ORDER BY key")
    .all()
    .map((row) => ({
      key: row.key,
      value: JSON.parse(row.value_json),
      updatedAt: row.updated_at,
    }));
}
