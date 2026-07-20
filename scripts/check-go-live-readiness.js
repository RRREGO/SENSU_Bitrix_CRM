/**
 * Go-Live readiness check (offline / DB-backed).
 * npm run check:go-live
 * Exit 0: ready OR non-production без critical для текущего env.
 * Exit 1: critical при APP_ENV=production.
 * Секреты не выводятся.
 */
import "dotenv/config";
import { openDatabase, closeDatabase } from "../src/database/index.js";
import { getGoLiveReadiness, getAppEnv } from "../src/config/productionValidator.js";

function sanitize(obj) {
  const blocked = /password|secret|token|key|hash|webhook|api_key/i;
  return JSON.parse(
    JSON.stringify(obj, (k, v) => {
      if (blocked.test(k)) return "[redacted]";
      if (typeof v === "string" && v.length > 200) return `${v.slice(0, 80)}…`;
      return v;
    })
  );
}

async function main() {
  const dbPath = process.env.APP_DATABASE_PATH || process.env.BITRIX_OPERATIONS_DB_PATH;
  if (dbPath) {
    openDatabase({ reopen: true, dbPath });
  } else {
    openDatabase({ reopen: true });
  }

  const env = getAppEnv();
  const readiness = getGoLiveReadiness();
  const payload = sanitize({
    env,
    ready: readiness.ready,
    critical: readiness.critical,
    warnings: readiness.warnings,
    checks: readiness.checks,
  });

  console.log(JSON.stringify(payload, null, 2));
  closeDatabase();

  const isProduction = env === "production";
  if (readiness.ready) {
    process.exit(0);
  }
  if (!isProduction && readiness.critical.length === 0) {
    process.exit(0);
  }
  if (isProduction && readiness.critical.length > 0) {
    process.exit(1);
  }
  // non-production with critical blockers for current env (e.g. local_only + non-loopback bind)
  process.exit(readiness.critical.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.code || e.message }));
  process.exit(1);
});
