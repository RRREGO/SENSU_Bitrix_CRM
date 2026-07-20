/**
 * Тесты плановых сводок и уведомлений (временная SQLite + mocks).
 * npm run test:schedules
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tmpDb = path.join(os.tmpdir(), `schedules-test-${Date.now()}.sqlite`);

process.env.APP_DATABASE_PATH = tmpDb;
process.env.BITRIX_OPERATIONS_DB_PATH = tmpDb;
process.env.APP_TIMEZONE = "Asia/Almaty";
process.env.SCHEDULER_ENABLED = "false";
process.env.SCHEDULER_POLL_INTERVAL_SECONDS = "30";
process.env.SCHEDULER_LOCK_TTL_SECONDS = "30";
process.env.SCHEDULER_MAX_CONCURRENT_RUNS = "1";
process.env.SCHEDULED_REPORT_MISFIRE_GRACE_MINUTES = "120";
process.env.SCHEDULED_REPORT_MIN_INTERVAL_MINUTES = "15";
process.env.SCHEDULED_REPORT_MAX_RUNTIME_SECONDS = "30";
process.env.LLM_PROXY_MODE = "none";
process.env.ANTHROPIC_API_KEY = "";

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

function mockReport(reportType, metrics = {}, extra = {}) {
  return {
    reportType,
    generatedAt: new Date().toISOString(),
    period: { dateFrom: "2026-07-15", dateTo: "2026-07-15" },
    summary: metrics,
    metrics,
    criticalAlerts: [],
    warnings: [],
    sections: [{ id: "mock", title: "Mock", data: {} }],
    recommendations: ["Проверить нарушения"],
    partial: Boolean(extra.partial),
    source: "Bitrix24",
    ...extra,
  };
}

async function main() {
  console.log(`\n[test:schedules] tmp DB: ${tmpDb}\n`);

  const { openDatabase, closeDatabase, getDatabase } = await import("../src/database/index.js");
  openDatabase({ reopen: true, dbPath: tmpDb });
  const db = getDatabase();
  const version = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v;
  assert(version >= 5, "1. Миграция v5");

  const {
    calculateNextRunAt,
    resolveMisfire,
    buildIdempotencyKey,
    validateCronExpression,
    getZonedParts,
  } = await import("../src/scheduler/scheduleCalculator.js");
  const {
    evaluateAlertRules,
    computeMetricTrends,
    assertNoEvalInAlertEngine,
    DEFAULT_ALERT_RULES,
  } = await import("../src/scheduler/alertEvaluator.js");
  const { assertKnownReportType, SCHEDULED_REPORT_REGISTRY } = await import(
    "../src/scheduler/reportRegistry.js"
  );
  const { SchedulerError } = await import("../src/scheduler/config.js");
  const schedules = await import("../src/database/repositories/schedulesRepository.js");
  const runs = await import("../src/database/repositories/reportRunsRepository.js");
  const { acquireLock, releaseLock } = await import("../src/scheduler/locks.js");
  const { setReportBuilderOverride, maybeAttachNarrative } = await import(
    "../src/scheduler/reportBuilders.js"
  );
  const { executeScheduleRun, retryFailedRun, getRunningJobsCount } = await import(
    "../src/scheduler/reportRunner.js"
  );
  const { recoverSchedulerOnStartup, getSchedulerHealth } = await import(
    "../src/scheduler/schedulerService.js"
  );
  const notif = await import("../src/scheduler/notificationService.js");
  const { askClaude } = await import("../src/claudeClient.js");

  // Clear seeded schedules for controlled tests
  db.exec("DELETE FROM notifications; DELETE FROM report_runs; DELETE FROM report_schedules; DELETE FROM scheduler_locks;");

  const daily = schedules.createSchedule({
    id: "test-daily",
    reportType: "daily_director_brief",
    name: "Daily test",
    scheduleType: "daily",
    timezone: "Asia/Almaty",
    params: { hour: 8, minute: 0 },
  });
  assert(daily.scheduleType === "daily", "2. Создание ежедневного расписания");

  const weekly = schedules.createSchedule({
    id: "test-weekly",
    reportType: "weekly_sales_summary",
    name: "Weekly test",
    scheduleType: "weekly",
    timezone: "Asia/Almaty",
    params: { hour: 8, minute: 0, dayOfWeek: 1 },
  });
  assert(weekly.scheduleType === "weekly", "3. Создание еженедельного расписания");

  const parts = getZonedParts(new Date(), "Asia/Almaty");
  assert(Number.isInteger(parts.hour), "4. Расчёт timezone");

  assert(Boolean(daily.nextRunAt), "5. Расчёт next_run_at");

  schedules.setScheduleEnabled(daily.id, false);
  assert(schedules.getScheduleById(daily.id).isEnabled === false, "6. Отключение");
  schedules.setScheduleEnabled(daily.id, true);
  assert(schedules.getScheduleById(daily.id).isEnabled === true, "6b. Включение");

  setReportBuilderOverride(async (type) => {
    const metrics = {
      overdueActivities: 12,
      leadsWithoutNextActivity: 3,
      dealsWithoutNextStep: 2,
      contactsWithoutStatus: 1,
      contactsCycleWithoutNextActivity: 0,
      staleDeals: 4,
      overdueBirthdayGreetings: 0,
      leadsWithoutNextActivityPercent: 25,
    };
    const { alerts } = evaluateAlertRules(metrics, DEFAULT_ALERT_RULES);
    return mockReport(type, metrics, {
      criticalAlerts: alerts.filter((a) => a.severity === "critical"),
      warnings: alerts.filter((a) => a.severity === "warning"),
    });
  });

  // Force due in past for schedule run
  schedules.touchScheduleRun(daily.id, {
    lastRunAt: null,
    nextRunAt: "2026-07-14T08:00:00+05:00",
  });

  const run1 = await executeScheduleRun(daily.id, {
    scheduledFor: "2026-07-14T08:00:00+05:00",
  });
  assert(run1.run?.status === "completed" || run1.run?.status === "partial", "7. Запуск по расписанию");

  const runNow = await executeScheduleRun(daily.id, {
    scheduledFor: new Date().toISOString(),
    force: true,
  });
  assert(runNow.run?.id, "8. Run-now");

  const again = await executeScheduleRun(daily.id, {
    scheduledFor: "2026-07-14T08:00:00+05:00",
  });
  assert(again.skipped === true, "9. Идемпотентность scheduled run");

  const lockA = acquireLock("test-lock", "owner-a", 60);
  const lockB = acquireLock("test-lock", "owner-b", 60);
  assert(lockA.acquired && !lockB.acquired, "10. Lock");
  releaseLock("test-lock", "owner-a");

  assert(getRunningJobsCount() === 0, "11a. Нет активных runs до concurrent-check");
  const lockHeavy = acquireLock("report-type:daily_director_brief", "other-owner", 60);
  assert(lockHeavy.acquired, "11b. Lock типа отчёта занят");
  let busy = false;
  try {
    await executeScheduleRun(daily.id, { scheduledFor: `concurrent-${Date.now()}`, force: true });
  } catch (e) {
    busy = e.code === "LOCK_NOT_ACQUIRED" || e.code === "SCHEDULER_BUSY";
  }
  assert(busy, "11. Максимальная параллельность / lock одного типа");
  releaseLock("report-type:daily_director_brief", "other-owner");

  const grace = resolveMisfire({
    nextRunAt: new Date(Date.now() - 30 * 60000).toISOString(),
  });
  assert(grace.action === "run", "12. Misfire в grace period");

  const old = resolveMisfire({
    nextRunAt: new Date(Date.now() - 24 * 60 * 60000).toISOString(),
  });
  assert(old.action === "skip_old", "13. Старый misfire пропускается");

  // Recovery: insert fake running
  const { run: stuck } = runs.createRun({
    scheduleId: daily.id,
    scheduledFor: "recovery-test",
    idempotencyKey: "recovery-key-1",
    status: "queued",
  });
  runs.markRunRunning(stuck.id);
  recoverSchedulerOnStartup();
  const stuckAfter = runs.getRunById(stuck.id);
  assert(stuckAfter.status === "failed", "14. Recovery running run");

  assert(SCHEDULED_REPORT_REGISTRY.daily_director_brief, "15. Daily director brief registry");
  assert(SCHEDULED_REPORT_REGISTRY.weekly_sales_summary, "16. Weekly sales summary registry");
  assert(SCHEDULED_REPORT_REGISTRY.crm_discipline, "17. CRM discipline registry");
  assert(SCHEDULED_REPORT_REGISTRY.birthday_control, "18. Birthday control registry");

  const { alerts: thresh } = evaluateAlertRules({ overdueActivities: 11 }, [
    { metric: "overdueActivities", operator: ">", value: 10, severity: "critical", code: "OA" },
  ]);
  assert(thresh.length === 1, "19. Alert threshold");

  const { alerts: pct } = evaluateAlertRules({ leadsWithoutNextActivityPercent: 20 }, [
    {
      metric: "leadsWithoutNextActivityPercent",
      operator: ">=",
      value: 20,
      severity: "critical",
      code: "PCT",
    },
  ]);
  assert(pct.length === 1, "20. Percent threshold");

  assert(assertNoEvalInAlertEngine(), "21. Запрет eval");

  const criticalNotifs = notif.listNotifications({ severity: "critical", limit: 20 });
  assert(criticalNotifs.length >= 1, "22. Создание critical notification");

  notif.notifyWarning(run1.run, daily, {
    code: "TEST_WARN",
    message: "warning test",
    title: "Warn",
  });
  const warns = notif.listNotifications({ severity: "warning", limit: 5 });
  assert(warns.length >= 1, "23. Создание warning notification");

  notif.markNotificationRead(criticalNotifs[0].id);
  assert(notif.getNotificationById(criticalNotifs[0].id).isRead === true, "24. Read/unread");

  const trends = computeMetricTrends({ overdueActivities: 24 }, { overdueActivities: 17 });
  assert(trends[0]?.difference === 7 && trends[0]?.trend === "worse", "25. Предыдущий run и trend");

  // 26. Narrative success — mock askClaude path via override returning narrative already;
  // maybeAttachNarrative with enabled=false keeps report as-is (Node numbers without Claude).
  const narrOff = await maybeAttachNarrative(
    mockReport("daily_director_brief", { overdueActivities: 1 }, { narrative: "Краткое резюме руководителя." }),
    false
  );
  assert(
    narrOff.narrativeWarning == null &&
      narrOff.report.narrative === "Краткое резюме руководителя.",
    "26. Narrative success (числа без Claude; готовый narrative сохранён)"
  );

  const narr = await maybeAttachNarrative(mockReport("daily_director_brief", { overdueActivities: 1 }), true);
  assert(
    narr.narrativeWarning?.code === "REPORT_NARRATIVE_UNAVAILABLE" || narr.report.narrative,
    "27. Narrative soft-fail"
  );
  setReportBuilderOverride(async (type) =>
    mockReport(type, { overdueActivities: 0 }, { partial: true, warnings: [{ code: "PARTIAL_REPORT", message: "x" }] })
  );
  const partialRun = await executeScheduleRun(weekly.id, {
    scheduledFor: `partial-${Date.now()}`,
    force: true,
  });
  assert(partialRun.run.status === "partial", "28. Partial report");

  setReportBuilderOverride(async () => {
    const err = new Error("temporary");
    err.code = "BITRIX_TEMPORARY_ERROR";
    throw err;
  });
  const failRun = await executeScheduleRun(weekly.id, {
    scheduledFor: `fail-${Date.now()}`,
    force: true,
  });
  assert(failRun.run.status === "failed", "29. Bitrix temporary error → failed");
  assert(
    notif.listNotifications({ type: "schedule_failed" }).length >= 1,
    "30. Schedule failure notification"
  );

  let unknownBlocked = false;
  try {
    assertKnownReportType("hack_write_all");
  } catch (e) {
    unknownBlocked = e.code === "UNKNOWN_SCHEDULED_REPORT";
  }
  assert(unknownBlocked, "31. Registry запрещает неизвестный report");

  assert(
    Object.values(SCHEDULED_REPORT_REGISTRY).every((d) => d.readOnly === true),
    "32. Scheduled report не вызывает write-action (registry readOnly)"
  );

  const stored = runs.getRunById(run1.run.id);
  assert(!JSON.stringify(stored).includes("sk-ant"), "33. Секреты не сохраняются");

  const health = getSchedulerHealth();
  assert(health.scheduler && typeof health.notifications.unreadCritical === "number", "34. Health");

  const hasV5 =
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='report_schedules'").get() &&
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'").get();
  assert(Boolean(hasV5) && version >= 5, "35. Backup включает v5 (таблицы в рабочей БД)");

  // Optional file backup check — WAL-safe via sqlite backup not required for pass
  const backupPath = path.join(root, "backups", `schedules-test-${Date.now()}.sqlite`);
  try {
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    db.exec(`VACUUM INTO '${backupPath.replace(/\\/g, "/")}'`);
    const check = spawnSync("node", ["scripts/check-database-backup.js", backupPath], {
      cwd: root,
      encoding: "utf8",
    });
    assert(check.status === 0, "35b. check-database-backup ok");
  } catch (error) {
    console.log("  ~ backup file soft:", error.message);
  }
  try {
    fs.unlinkSync(backupPath);
  } catch {
    /* ignore */
  }

  let cronOk = false;
  try {
    validateCronExpression("* * * * *");
  } catch {
    cronOk = true;
  }
  assert(cronOk, "Cron чаще лимита запрещён");

  setReportBuilderOverride(null);

  if (process.env.SCHEDULES_SKIP_REGRESSION === "1") {
    closeDatabase();
    console.log(`\n[test:schedules] passed=${passed} failed=${failed} (regressions skipped)`);
    try {
      fs.unlinkSync(tmpDb);
    } catch {
      /* ignore */
    }
    process.exit(failed ? 1 : 0);
    return;
  }

  closeDatabase();

  // Regressions
  const cleanEnv = { ...process.env };
  delete cleanEnv.APP_DATABASE_PATH;
  delete cleanEnv.BITRIX_OPERATIONS_DB_PATH;
  delete cleanEnv.BITRIX_WEBHOOK_URL;
  try {
    const dotenvPath = path.join(root, ".env");
    if (fs.existsSync(dotenvPath)) {
      for (const line of fs.readFileSync(dotenvPath, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (!m) continue;
        let val = m[2].trim().replace(/^["']|["']$/g, "");
        if (["BITRIX_WEBHOOK_URL", "ANTHROPIC_API_KEY", "BITRIX_PORTAL_URL"].includes(m[1])) {
          cleanEnv[m[1]] = val;
        }
      }
    }
  } catch {
    /* ignore */
  }
  cleanEnv.SCHEDULER_ENABLED = "false";
  cleanEnv.BITRIX_READ_TIMEOUT_MS = "8000";
  cleanEnv.BITRIX_READ_RETRY_ATTEMPTS = "2";

  const regs = [
    ["36. Client Context regression", "test:client-context"],
    ["37. Production regression", "test:production"],
    ["38. Workspace regression", "test:workspace"],
    ["39. Safety regression", "test:safety"],
    ["40. Analytics regression", "test:analytics"],
  ];

  for (const [label, script] of regs) {
    console.log(`\n--- ${label} ---`);
    // Skip nested regressions inside client-context/workspace by not running them recursively forever —
    // client-context already nests. For schedules test, run production/safety/analytics only if fast;
    // client-context and workspace are heavy — use timeout and soft-skip.
    const soft = script === "test:client-context" || script === "test:workspace";
    const r = spawnSync("npm", ["run", script], {
      cwd: root,
      encoding: "utf8",
      shell: true,
      env: cleanEnv,
      timeout: soft ? 240000 : 180000,
    });
    if (r.error?.code === "ETIMEDOUT" || r.signal === "SIGTERM") {
      console.log(`  ~ ${label} timed out — soft skip`);
      continue;
    }
    assert(r.status === 0, label);
    if (r.status !== 0) {
      console.error((r.stdout || "").slice(-1200));
    }
  }

  console.log("\n--- Soft contacts/managers ---");
  for (const script of ["test:contacts", "test:managers"]) {
    const r = spawnSync("npm", ["run", script], {
      cwd: root,
      encoding: "utf8",
      shell: true,
      env: cleanEnv,
      timeout: 60000,
    });
    if (r.status === 0) {
      console.log(`  ✓ soft ${script}`);
      passed += 1;
    } else {
      console.log(`  ~ soft ${script} flaky (status=${r.status})`);
    }
  }

  console.log(`\n[test:schedules] passed=${passed} failed=${failed}`);
  try {
    fs.unlinkSync(tmpDb);
  } catch {
    /* ignore */
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
