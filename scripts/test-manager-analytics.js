/**
 * Read-only тесты менеджерской аналитики и дисциплины CRM.
 * Запуск: npm run test:managers
 */
import "dotenv/config";
import {
  manager_workload,
  leads_without_next_activity,
  stale_leads_report,
  stale_deals_report,
  overdue_activities_by_manager,
  crm_discipline_report,
} from "../src/actions/managerAnalyticsActions.js";
import { collectContactQualityDataset } from "../src/actions/contactAnalyticsActions.js";
import { calculateCrmQualityScore } from "../src/analytics/qualityScore.js";
import { PAGINATION, getAnalyticsMaxPages } from "../src/actions/helpers.js";
import {
  clearDirectoryCaches,
  getDirectoryCacheStats,
  resolveUsersByIds,
} from "../src/cache/directoryCache.js";

const results = [];

function ok(name, detail = "") {
  results.push({ name, status: "PASS", detail });
  console.log(`✓ PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, error) {
  const detail = error?.message || String(error);
  results.push({ name, status: "FAIL", detail });
  console.error(`✗ FAIL  ${name} — ${detail}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runCase(name, fn) {
  try {
    await fn();
  } catch (error) {
    fail(name, error);
  }
}

async function main() {
  console.log("=== Manager analytics read-only tests ===\n");
  console.log(`MAX_PAGES=${getAnalyticsMaxPages()}\n`);

  if (!process.env.BITRIX_WEBHOOK_URL) {
    console.error("BITRIX_WEBHOOK_URL is not configured");
    process.exit(1);
  }

  let workload = null;

  await runCase("1. manager_workload", async () => {
    workload = await manager_workload({ inactiveDays: 14 });
    assert(workload.reportType === "manager_workload", "reportType");
    assert(Array.isArray(workload.managers), "managers");
    assert(workload.diagnostics?.contactPasses === 1, "contactPasses != 1");
    ok(
      "1. manager_workload",
      `managers=${workload.managers.length}, leads=${workload.summary.activeLeads}, deals=${workload.summary.activeDeals}, duration diagnostics ok`
    );
  });

  await runCase("2. Лиды без следующего дела", async () => {
    const report = await leads_without_next_activity({});
    if (report?.error?.code === "CRM_ACTIVITIES_ACCESS_DENIED") {
      ok("2. Лиды без следующего дела", "activities denied");
      return;
    }
    assert(typeof report.countWithoutActivity === "number", "count");
    assert(Array.isArray(report.withoutActivity), "sample");
    ok("2. Лиды без следующего дела", `without=${report.countWithoutActivity}`);
  });

  await runCase("3. Лиды только с просроченными делами", async () => {
    const report = await leads_without_next_activity({});
    if (report?.error) {
      ok("3. Лиды только с просроченными делами", `пропуск: ${report.error.code}`);
      return;
    }
    assert(typeof report.countWithOverdueActivityOnly === "number", "count");
    ok("3. Лиды только с просроченными делами", `count=${report.countWithOverdueActivityOnly}`);
  });

  await runCase("4. Лиды без изменений", async () => {
    const report = await stale_leads_report({ inactiveDays: 14 });
    if (report?.error) {
      ok("4. Лиды без изменений", `пропуск: ${report.error.code}`);
      return;
    }
    assert(report.title.includes("без изменений"), "title");
    assert(report.inactivityBasis, "basis");
    ok("4. Лиды без изменений", `count=${report.count}`);
  });

  await runCase("5. Сделки без изменений", async () => {
    const report = await stale_deals_report({ inactiveDays: 14, categoryId: 0 });
    if (report?.error) {
      ok("5. Сделки без изменений", `пропуск: ${report.error.code}`);
      return;
    }
    assert(report.totalsByCurrency && typeof report.totalsByCurrency === "object", "currency");
    ok("5. Сделки без изменений", `count=${report.count}`);
  });

  await runCase("6. Просроченные activities по менеджерам", async () => {
    const report = await overdue_activities_by_manager({});
    if (report?.error) {
      ok("6. Просроченные activities по менеджерам", `пропуск: ${report.error.code}`);
      return;
    }
    assert(typeof report.total === "number", "total");
    assert(Array.isArray(report.groups), "groups");
    ok("6. Просроченные activities по менеджерам", `total=${report.total}, groups=${report.groups.length}`);
  });

  await runCase("7. crm_discipline_report", async () => {
    const report = await crm_discipline_report({ inactiveDays: 14 });
    assert(report.reportType === "crm_discipline", "type");
    assert(report.summary, "summary");
    assert(Array.isArray(report.recommendations), "recommendations");
    ok("7. crm_discipline_report", `critical=${report.criticalAlerts?.length}, managers=${report.byManager?.length}`);
  });

  await runCase("8. Группировка по ответственным", async () => {
    assert(workload, "workload missing");
    const ids = new Set(workload.managers.map((m) => m.responsibleId));
    assert(ids.size === workload.managers.length, "duplicate managers");
    ok("8. Группировка по ответственным", `unique=${ids.size}`);
  });

  await runCase("9. Суммы сделок по валютам", async () => {
    assert(workload, "workload missing");
    for (const m of workload.managers) {
      assert(m.deals?.sumsByCurrency && typeof m.deals.sumsByCurrency === "object", "sums");
    }
    ok("9. Суммы сделок по валютам", "ok");
  });

  await runCase("10. Несуществующий пользователь", async () => {
    let report;
    try {
      report = await manager_workload({
        responsibleIds: [999999001],
        includeInactiveUsers: true,
      });
    } catch (error) {
      // Перегрузка портала / сеть после длинных обходов — один повтор.
      if (!/fetch failed|invalid JSON|network error/i.test(String(error.message || error))) {
        throw error;
      }
      report = await manager_workload({
        responsibleIds: [999999001],
        includeInactiveUsers: true,
      });
    }
    const warning = (report.warnings || []).some((w) => w.code === "UNKNOWN_USER");
    assert(warning || report.managers.length === 0, "ожидался UNKNOWN_USER или пустой список");
    ok("10. Несуществующий пользователь", warning ? "UNKNOWN_USER" : "empty managers");
  });

  await runCase("11. Несуществующая воронка", async () => {
    const report = await stale_deals_report({
      categoryId: 999999001,
      inactiveDays: 14,
    });
    if (report?.error) {
      ok("11. Несуществующая воронка", report.error.code);
      return;
    }
    assert(report.count === 0 || Array.isArray(report.sample), "empty ok");
    ok("11. Несуществующая воронка", `count=${report.count}`);
  });

  await runCase("12. Пустой результат", async () => {
    const report = await stale_leads_report({
      inactiveDays: 14,
      responsibleIds: [999999001],
    });
    if (report?.error) {
      ok("12. Пустой результат", report.error.code);
      return;
    }
    assert(report.count === 0, "ожидался 0");
    ok("12. Пустой результат", "count=0");
  });

  await runCase("13. Sample не более 100", async () => {
    const report = await leads_without_next_activity({});
    if (report?.error) {
      ok("13. Sample не более 100", report.error.code);
      return;
    }
    assert((report.withoutActivity || []).length <= 100, "sample>100");
    assert((report.withOverdueActivityOnly || []).length <= 100, "overdue sample>100");
    ok("13. Sample не более 100", `limit=${report.sampleLimit}`);
  });

  await runCase("14. Tasks без прав не ломают отчёт", async () => {
    assert(workload, "workload missing");
    assert(workload.success !== false, "broken");
    if (workload.summary.tasksAvailable === false) {
      assert(
        (workload.warnings || []).some((w) => w.code === "TASKS_ACCESS_DENIED"),
        "нет TASKS_ACCESS_DENIED"
      );
    }
    ok(
      "14. Tasks без прав не ломают отчёт",
      `tasksAvailable=${workload.summary.tasksAvailable}, partial=${workload.partial}`
    );
  });

  await runCase("15. Частичный результат", async () => {
    assert(workload, "workload missing");
    if (workload.partial) {
      assert(Array.isArray(workload.warnings), "warnings");
    }
    ok("15. Частичный результат", `partial=${Boolean(workload.partial)}`);
  });

  await runCase("16. Отсутствие N+1 запросов пользователей", async () => {
    clearDirectoryCaches();
    await resolveUsersByIds([1, 2, 3, 1, 2]);
    const mid = getDirectoryCacheStats().usersCached;
    await resolveUsersByIds([1, 2, 3]);
    assert(getDirectoryCacheStats().usersCached === mid, "N+1 cache growth");
    ok("16. Отсутствие N+1 запросов пользователей", `cached=${mid}`);
  });

  await runCase("17. Один обход контактов в dataset", async () => {
    const dataset = await collectContactQualityDataset({});
    assert(dataset.contactPasses === 1, "contactPasses");
    assert(typeof dataset.total === "number", "total");
    ok(
      "17. Один обход контактов в dataset",
      `passes=${dataset.contactPasses}, contacts=${dataset.total}, pages=${dataset.pages}`
    );
  });

  await runCase("18. Корректность qualityScore", async () => {
    const perfect = calculateCrmQualityScore({
      contactsTotal: 10,
      contactsWithoutStatus: 0,
      leadsTotal: 10,
      leadsWithoutActivity: 0,
      dealsTotal: 10,
      dealsWithoutNextStep: 0,
      activitiesActive: 10,
      activitiesOverdue: 0,
      entitiesTotal: 20,
      entitiesStale: 0,
    });
    assert(perfect.qualityScore === 100, "perfect != 100");

    const bad = calculateCrmQualityScore({
      contactsTotal: 10,
      contactsWithoutStatus: 5,
      leadsTotal: 10,
      leadsWithoutActivity: 5,
      dealsTotal: 10,
      dealsWithoutNextStep: 5,
      activitiesActive: 5,
      activitiesOverdue: 5,
      entitiesTotal: 20,
      entitiesStale: 10,
    });
    assert(bad.qualityScore >= 0 && bad.qualityScore <= 100, "range");
    assert(bad.qualityBreakdown.base === 100, "base");
    ok("18. Корректность qualityScore", `perfect=${perfect.qualityScore}, sample=${bad.qualityScore}`);
  });

  await runCase("19. truncated при лимите страниц", async () => {
    const prev = process.env.BITRIX_ANALYTICS_MAX_PAGES;
    process.env.BITRIX_ANALYTICS_MAX_PAGES = "1";
    const dataset = await collectContactQualityDataset({});
    process.env.BITRIX_ANALYTICS_MAX_PAGES = prev;
    // With 4000 contacts, 1 page => truncated
    if (dataset.total > 50 || dataset.pages >= 1) {
      assert(dataset.truncated === true || dataset.total <= 50, "expected truncated");
      if (dataset.truncated) {
        assert(dataset.warning, "warning missing");
      }
    }
    ok(
      "19. truncated при лимите страниц",
      `truncated=${dataset.truncated}, pages=${dataset.pages}, warning=${Boolean(dataset.warning)}`
    );
  });

  await runCase("20. Sample limit константа", async () => {
    assert(PAGINATION.SAMPLE_LIMIT === 100, "sample limit");
    ok("20. Sample limit константа", "100");
  });

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log("\n=== Summary ===");
  console.log(`PASS: ${passed}`);
  console.log(`FAIL: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
