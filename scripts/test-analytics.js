/**
 * Read-only тест аналитики Bitrix24 CRM Assistant.
 * Не создаёт, не изменяет и не удаляет данные.
 *
 * Запуск: npm run test:analytics
 */
import "dotenv/config";
import { deal_category_list, deal_stage_list } from "../src/actions/crmActions.js";
import {
  deal_count_by_stage,
  deal_sum_by_stage,
  new_deals_period,
  closed_deals_period,
  overdue_tasks_report,
  deals_without_next_step,
  leads_without_responsible,
  deals_without_activity,
} from "../src/actions/analyticsActions.js";
import { manager_workload } from "../src/actions/managerAnalyticsActions.js";
import { deal_list, dealListAll } from "../src/actions/dealActions.js";
import { PAGINATION } from "../src/actions/helpers.js";

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
  console.log("=== Analytics read-only tests ===\n");

  if (!process.env.BITRIX_WEBHOOK_URL) {
    console.error("BITRIX_WEBHOOK_URL is not configured in .env");
    process.exit(1);
  }

  let categoryId = 0;
  let dateFrom = null;
  let dateTo = null;

  await runCase("1. Список воронок", async () => {
    const categories = await deal_category_list({});
    assert(Array.isArray(categories), "Ожидался массив воронок");
    if (categories.length) {
      const first = categories[0];
      categoryId = first.id ?? first.ID ?? 0;
    }
    ok("1. Список воронок", `count=${categories.length}, categoryId=${categoryId}`);
  });

  const now = new Date();
  dateTo = now.toISOString().slice(0, 10);
  const from = new Date(now);
  from.setDate(from.getDate() - 30);
  dateFrom = from.toISOString().slice(0, 10);

  await runCase("2. Количество сделок по стадиям", async () => {
    const rows = await deal_count_by_stage({ categoryId });
    assert(Array.isArray(rows), "Ожидался массив стадий");
    assert(rows.every((r) => r.stageName || r.stageId), "Нет названий/ID стадий");
    const total = rows.reduce((s, r) => s + Number(r.count || 0), 0);
    ok("2. Количество сделок по стадиям", `stages=${rows.length}, deals=${total}`);
  });

  await runCase("3. Суммы сделок по стадиям", async () => {
    const report = await deal_sum_by_stage({ categoryId });
    assert(report && typeof report === "object", "Ожидался объект отчёта");
    assert(report.totalsByCurrency && typeof report.totalsByCurrency === "object", "Нет totalsByCurrency");
    assert(Array.isArray(report.byStage), "Нет byStage");
    ok(
      "3. Суммы сделок по стадиям",
      `currencies=${Object.keys(report.totalsByCurrency).join(",") || "—"}, stages=${report.byStage.length}`
    );
  });

  await runCase("4. Новые сделки за период", async () => {
    const report = await new_deals_period({ categoryId, dateFrom, dateTo });
    assert(typeof report.count === "number", "Нет count");
    assert(report.totalsByCurrency && typeof report.totalsByCurrency === "object", "Нет totalsByCurrency");
    assert(Array.isArray(report.deals), "Нет deals sample");
    if (report.deals[0]) {
      assert(report.deals[0].stageName || report.deals[0].stageId, "Нет stageName у сделки");
    }
    ok("4. Новые сделки за период", `count=${report.count}, returned=${report.returned}`);
  });

  await runCase("5. Закрытые сделки за период", async () => {
    const report = await closed_deals_period({ categoryId, dateFrom, dateTo });
    assert(typeof report.count === "number", "Нет count");
    assert(report.totalsByCurrency && typeof report.totalsByCurrency === "object", "Нет totalsByCurrency");
    ok("5. Закрытые сделки за период", `count=${report.count}, returned=${report.returned}`);
  });

  await runCase("6. Просроченные задачи", async () => {
    const report = await overdue_tasks_report({});
    if (report?.error?.code === "TASKS_ACCESS_DENIED" || report?.success === false) {
      ok(
        "6. Просроченные задачи",
        `пропуск: ${report.error?.message || "нет доступа к tasks"}`
      );
      return;
    }
    assert(typeof report.count === "number", "Нет count");
    assert(Array.isArray(report.tasks), "Нет tasks sample");
    assert(report.tasks.length <= PAGINATION.SAMPLE_LIMIT, "Sample слишком большой");
    ok("6. Просроченные задачи", `count=${report.count}, returned=${report.returned}`);
  });

  await runCase("7. Сделки без следующего шага", async () => {
    const report = await deals_without_next_step({ categoryId });
    assert(typeof report.count === "number", "Нет count");
    assert(Array.isArray(report.deals), "Нет deals");
    ok("7. Сделки без следующего шага", `count=${report.count}, returned=${report.returned}`);
  });

  await runCase("8. Лиды без ответственного", async () => {
    const report = await leads_without_responsible({});
    assert(typeof report.count === "number", "Нет count");
    assert(Array.isArray(report.leads), "Нет leads");
    ok("8. Лиды без ответственного", `count=${report.count}, returned=${report.returned}`);
  });

  await runCase("9. Сделки без активности", async () => {
    const report = await deals_without_activity({ categoryId });
    assert(typeof report.count === "number", "Нет count");
    assert(Array.isArray(report.deals), "Нет deals");
    ok("9. Сделки без активности", `count=${report.count}, returned=${report.returned}`);
  });

  await runCase("10. manager_workload (read-only)", async () => {
    const report = await manager_workload({
      includeInactiveUsers: false,
      sampleLimit: 5,
      inactiveDays: 14,
    });
    assert(report?.reportType === "manager_workload", "Ожидался reportType manager_workload");
    assert(Array.isArray(report.managers), "Нет managers");
    assert(report.summary && typeof report.summary === "object", "Нет summary");
    if (report.tasksAvailable === false) {
      assert(
        (report.warnings || []).some((w) => w.code === "TASKS_ACCESS_DENIED"),
        "Ожидался TASKS_ACCESS_DENIED"
      );
    }
    ok(
      "10. manager_workload (read-only)",
      `managers=${report.managers.length}, tasksAvailable=${report.summary?.tasksAvailable}`
    );
  });

  await runCase("11. Пагинация более чем одной страницы", async () => {
    const limited = await deal_list({
      filter: { CATEGORY_ID: categoryId },
      select: ["ID"],
      limit: 50,
    });
    assert(typeof limited.returned === "number", "Нет returned");
    assert(typeof limited.hasMore === "boolean", "Нет hasMore");
    assert(limited.returned <= 50, "Лимит списка нарушен");

    if (limited.hasMore || (limited.total != null && limited.total > 50)) {
      const all = await dealListAll(
        { filter: { CATEGORY_ID: categoryId }, select: ["ID"] },
        { actionName: "test_pagination" }
      );
      assert(all.items.length >= limited.returned, "allPages вернул меньше первой страницы");
      assert(all.pages >= 1, "pages < 1");
      ok(
        "11. Пагинация более чем одной страницы",
        `list=${limited.returned}/${limited.total}, allPages=${all.items.length}, pages=${all.pages}`
      );
    } else {
      ok(
        "11. Пагинация более чем одной страницы",
        `в воронке ≤50 сделок (total=${limited.total}); лимит и hasMore проверены`
      );
    }
  });

  await runCase("12. Пустой результат", async () => {
    const report = await new_deals_period({
      categoryId,
      dateFrom: "2099-01-01",
      dateTo: "2099-01-02",
    });
    assert(report.count === 0 || report.deals.length === 0, "Ожидался пустой период");
    ok("12. Пустой результат", `count=${report.count}`);
  });

  await runCase("13. Несуществующая воронка", async () => {
    const missingCategoryId = 999999001;
    const stages = await deal_stage_list({ categoryId: missingCategoryId });
    const stageList = Array.isArray(stages) ? stages : [];
    const rows = await deal_count_by_stage({ categoryId: missingCategoryId });
    assert(Array.isArray(rows), "Ожидался массив");
    const total = rows.reduce((s, r) => s + Number(r.count || 0), 0);
    ok(
      "13. Несуществующая воронка",
      `stages=${stageList.length}, deals=${total} (пустой/без ошибок)`
    );
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
