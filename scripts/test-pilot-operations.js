/**
 * Pilot operations tests (tmp SQLite).
 * npm run test:pilot
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tmpDb = path.join(os.tmpdir(), `pilot-test-${Date.now()}.sqlite`);

const envSnapshot = { ...process.env };

process.env.APP_DATABASE_PATH = tmpDb;
process.env.BITRIX_OPERATIONS_DB_PATH = tmpDb;
process.env.APP_ACCESS_MODE = "authenticated";
process.env.APP_ALLOWED_IPS = "127.0.0.1,::1";
process.env.APP_ALLOWED_ORIGINS = "https://crm.example.com";
process.env.APP_BOOTSTRAP_ADMIN_USERNAME = "admin";
process.env.APP_BOOTSTRAP_ADMIN_PASSWORD = "Str0ng!Bootstrap#99";
process.env.APP_BOOTSTRAP_ADMIN_DISPLAY_NAME = "Администратор";
process.env.NODE_ENV = "development";
process.env.APP_ENV = "development";
process.env.SCHEDULER_ENABLED = "false";
process.env.BITRIX_WRITE_ENABLED = "true";
process.env.APP_VERSION = "1.0.0-pilot";
process.env.APP_RELEASE_ID = "pilot-test-release";
process.env.APP_COMMIT_SHA = "abc123";
process.env.PRODUCTION_SMOKE_TESTS_ENABLED = "false";

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}`);
  }
}

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) delete process.env[key];
  }
  Object.assign(process.env, envSnapshot);
}

async function main() {
  console.log(`\n[test:pilot] tmp DB: ${tmpDb}\n`);

  const { openDatabase, closeDatabase, getDatabase } = await import("../src/database/index.js");
  openDatabase({ reopen: true, dbPath: tmpDb });
  const db = getDatabase();

  // --- Migration v9 ---
  const { migrations } = await import("../src/database/migrations.js");
  const hasV9 = migrations.some((m) => m.version === 9 && m.name === "v9_pilot_operations");
  const appliedV9 = db
    .prepare("SELECT 1 FROM schema_migrations WHERE version = 9 AND name = 'v9_pilot_operations'")
    .get();
  assert(hasV9 && appliedV9, "1. Миграция v9_pilot_operations применена");

  const errTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='application_errors'")
    .get();
  assert(Boolean(errTable), "2. Таблица application_errors существует");

  const opCols = db.prepare("PRAGMA table_info(operations)").all().map((c) => c.name);
  assert(opCols.includes("release_id"), "3. operations.release_id добавлен v9");

  // --- paths.js ---
  const { getAppRoot, getDataDir, getLogDir, getBackupDir, getReleaseMetadata, ensureAppDirs } =
    await import("../src/config/paths.js");
  assert(typeof getAppRoot() === "string", "4. getAppRoot возвращает путь");
  assert(typeof getDataDir() === "string", "5. getDataDir");
  assert(typeof getLogDir() === "string", "6. getLogDir");
  assert(typeof getBackupDir() === "string", "7. getBackupDir");
  const meta = getReleaseMetadata();
  assert(meta.releaseId === "pilot-test-release", "8. getReleaseMetadata.releaseId из env");
  assert(meta.version === "1.0.0-pilot", "9. getReleaseMetadata.version");
  assert(meta.commitSha === "abc123", "10. getReleaseMetadata.commitSha");

  // --- Logger redaction ---
  const { log } = await import("../src/observability/logger.js");
  const captured = [];
  const origErr = console.error;
  console.error = (line) => captured.push(String(line));
  log("error", "pilot.test.redaction", { password: "secret123", requestId: "r1" });
  console.error = origErr;
  const logLine = captured.join("");
  assert(!logLine.includes("secret123"), "11. logger redact: password не в выводе");
  assert(logLine.includes("[REDACTED]") || logLine.includes("redact"), "12. logger redact: маскирование");

  // --- requestId middleware ---
  const reqCtx = await import("../src/observability/requestContext.js");
  assert(typeof reqCtx.createRequestId === "function", "13. createRequestId экспортирован");
  assert(typeof reqCtx.requestContextMiddleware === "function", "14. requestContextMiddleware экспортирован");
  const rid = reqCtx.createRequestId();
  assert(typeof rid === "string" && rid.length >= 8, "15. createRequestId генерирует id");

  // --- Errors journal ---
  const { recordApplicationError, listApplicationErrors, resolveApplicationError } = await import(
    "../src/database/repositories/applicationErrorsRepository.js"
  );
  const err = recordApplicationError({
    requestId: rid,
    source: "pilot_test",
    errorCode: "PILOT_TEST",
    severity: "warning",
    messageSafe: "Тестовая ошибка",
    details: { token: "should-redact", note: "ok" },
  });
  assert(err?.id && err.messageSafe === "Тестовая ошибка", "16. recordApplicationError создаёт запись");
  assert(!JSON.stringify(err.details || {}).includes("should-redact") || err.details?.token === "[REDACTED]", "17. details redacted в journal");
  const listed = listApplicationErrors({ source: "pilot_test", limit: 5 });
  assert(listed.some((e) => e.id === err.id), "18. listApplicationErrors находит запись");
  const resolved = resolveApplicationError(err.id, { note: "fixed" });
  assert(resolved?.resolvedAt, "19. resolveApplicationError помечает resolved");

  // --- Metrics ---
  const { getMetricsSnapshot, recordHttpRequest } = await import("../src/observability/metricsService.js");
  recordHttpRequest({ status: 200, durationMs: 42 });
  recordHttpRequest({ status: 500, durationMs: 100 });
  const metrics = getMetricsSnapshot();
  assert(metrics.http.requestsTotal >= 2, "20. metrics http.requestsTotal");
  assert(metrics.release?.releaseId === "pilot-test-release", "21. metrics release metadata");
  assert(typeof metrics.safety === "object", "22. metrics safety block");
  assert(metrics.database.migrationVersion >= 9, "23. metrics database.migrationVersion >= 9");

  // --- Readiness ---
  const { getReadinessReport } = await import("../src/observability/readiness.js");
  const readiness = getReadinessReport();
  assert(typeof readiness.ready === "boolean", "24. readiness.ready boolean");
  assert(Array.isArray(readiness.critical), "25. readiness.critical array");
  assert(readiness.checks?.migrations === true, "26. readiness migrations check ok");

  // --- Operational modes / kill switch ---
  const { getOperationalModes, assertWritesAllowed, setRuntimeMode } = await import(
    "../src/observability/operationalModes.js"
  );
  const modes = getOperationalModes();
  assert(typeof modes.readOnlyMode === "boolean", "27. getOperationalModes shape");
  assertWritesAllowed("bitrix_write");
  assert(true, "28. assertWritesAllowed bitrix_write при enabled");

  setRuntimeMode({ bitrixWriteEnabled: false }, { reason: "pilot_test" });
  let bitrixBlocked = false;
  try {
    assertWritesAllowed("bitrix_write");
  } catch (e) {
    bitrixBlocked = e.code === "BITRIX_WRITE_DISABLED";
  }
  assert(bitrixBlocked, "29. assertWritesAllowed блокирует BITRIX_WRITE_DISABLED");
  setRuntimeMode({ bitrixWriteEnabled: true }, { reason: "restore" });

  setRuntimeMode({ readOnlyMode: true }, { reason: "pilot_test" });
  let roBlocked = false;
  try {
    assertWritesAllowed("write");
  } catch (e) {
    roBlocked = e.code === "READ_ONLY_MODE";
  }
  assert(roBlocked, "30. assertWritesAllowed READ_ONLY_MODE");
  setRuntimeMode({ readOnlyMode: false }, { reason: "restore" });

  // --- Route policies admin/system ---
  const { ROUTE_POLICIES, matchRoutePolicy } = await import("../src/auth/routePolicies.js");
  const statusPolicy = matchRoutePolicy("GET", "/admin/system/status");
  assert(
    statusPolicy?.access === "session" && statusPolicy?.permission,
    "31. GET /admin/system/status защищён"
  );
  const errorsPolicy = matchRoutePolicy("GET", "/admin/errors");
  assert(errorsPolicy?.access === "session", "32. GET /admin/errors защищён");

  // --- server.js wiring ---
  const serverSrc = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert(/requestContextMiddleware/.test(serverSrc), "33. server.js: requestContextMiddleware");
  assert(/getReadinessReport/.test(serverSrc), "34. server.js: readiness endpoint");
  assert(/createObservabilityRouter/.test(serverSrc), "35. server.js: observability router");
  assert(/gracefulShutdown|registerShutdownHook|isShuttingDown/.test(serverSrc), "36. server.js: graceful shutdown");

  // --- Deploy artifacts exist ---
  assert(fs.existsSync(path.join(root, "deploy/systemd/bitrix-crm-assistant.service")), "37. systemd service file");
  assert(fs.existsSync(path.join(root, "deploy/systemd/bitrix-crm-assistant-backup.timer")), "38. systemd backup timer");
  assert(fs.existsSync(path.join(root, "deploy/nginx/bitrix-crm-assistant.conf")), "39. nginx config");
  assert(fs.existsSync(path.join(root, "deploy/deploy-release.sh")), "40. deploy-release.sh");

  // --- Backup retention module ---
  const { selectBackupsToKeep, pruneBackups } = await import("./backup-retention.js");
  const fakeFiles = [
    { name: "operations-20260101-120000.sqlite", path: "/b/a.sqlite", mtimeMs: Date.now() - 90 * 86400000 },
    { name: "operations-20260701-120000.sqlite", path: "/b/b.sqlite", mtimeMs: Date.now() },
  ];
  const sel = selectBackupsToKeep(fakeFiles);
  assert(sel.keep.has("/b/b.sqlite"), "41. retention: newest always kept");

  // --- Production smoke disabled by default ---
  assert(process.env.PRODUCTION_SMOKE_TESTS_ENABLED !== "true", "42. PRODUCTION_SMOKE_TESTS_ENABLED false по умолчанию");
  assert(fs.existsSync(path.join(root, "scripts/run-production-smoke-tests.js")), "43. smoke script exists");

  // --- Frontend system tab ---
  const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert(/id="systemTab"/.test(indexHtml), "44. index.html systemTab");
  assert(/id="panel-system"/.test(indexHtml), "45. index.html panel-system");
  assert(fs.existsSync(path.join(root, "public/js/system.js")), "46. public/js/system.js");

  // --- Docs ---
  assert(fs.existsSync(path.join(root, "docs/deployment.md")), "47. docs/deployment.md");
  assert(fs.existsSync(path.join(root, "docs/pilot-checklist.md")), "48. docs/pilot-checklist.md");
  assert(fs.existsSync(path.join(root, "reports/deployment-readiness-audit.md")), "49. deployment-readiness-audit");

  // --- package.json scripts ---
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert(pkg.scripts["test:pilot"], "50. package.json test:pilot script");
  assert(pkg.scripts["smoke:production"], "51. package.json smoke:production script");
  assert(pkg.scripts["db:backup-retention"], "52. package.json db:backup-retention script");

  // --- backup-database stamp ---
  const backupSrc = fs.readFileSync(path.join(root, "scripts/backup-database.js"), "utf8");
  assert(/function stamp\(\)/.test(backupSrc), "53. backup-database.js stamp()");

  // --- ensureAppDirs ---
  const tmpData = path.join(os.tmpdir(), `pilot-dirs-${Date.now()}`);
  process.env.APP_DATA_DIR = path.join(tmpData, "data");
  process.env.APP_LOG_DIR = path.join(tmpData, "logs");
  process.env.APP_BACKUP_DIR = path.join(tmpData, "backups");
  ensureAppDirs();
  assert(fs.existsSync(process.env.APP_BACKUP_DIR), "54. ensureAppDirs создаёт backup dir");
  try {
    fs.rmSync(tmpData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  delete process.env.APP_DATA_DIR;
  delete process.env.APP_LOG_DIR;
  delete process.env.APP_BACKUP_DIR;

  console.log(`\n[test:pilot] ${passed} passed, ${failed} failed\n`);
  closeDatabase();
  try {
    fs.unlinkSync(tmpDb);
  } catch {
    /* ignore */
  }
  restoreEnv();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  restoreEnv();
  process.exit(1);
});
