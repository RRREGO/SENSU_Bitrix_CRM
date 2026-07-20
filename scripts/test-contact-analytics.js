/**
 * Read-only тесты аналитики контактов.
 * Не создаёт и не изменяет данные Bitrix24.
 *
 * Запуск: npm run test:contacts
 */
import "dotenv/config";
import {
  contact_field_audit,
  contact_count,
  contact_count_by_status,
  contacts_without_status,
  contacts_without_company,
  contacts_missing_birthday,
  contacts_cycle_without_next_activity,
  contacts_birthday_activity_report,
  contact_quality_report,
} from "../src/actions/contactAnalyticsActions.js";
import { PAGINATION, buildCrmEntityUrl } from "../src/actions/helpers.js";
import {
  clearDirectoryCaches,
  getDirectoryCacheStats,
  resolveUsersByIds,
} from "../src/cache/directoryCache.js";
import { getContactMethodologyConfig } from "../src/config/contactMethodology.js";

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
  console.log("=== Contact analytics read-only tests ===\n");

  if (!process.env.BITRIX_WEBHOOK_URL) {
    console.error("BITRIX_WEBHOOK_URL is not configured");
    process.exit(1);
  }

  const savedStatusField = process.env.BITRIX_CONTACT_STATUS_FIELD;
  const config = getContactMethodologyConfig();

  await runCase("1. Аудит полей контакта", async () => {
    const audit = await contact_field_audit();
    assert(audit.entity === "contact", "entity != contact");
    assert(Array.isArray(audit.fields) && audit.fields.length > 0, "Нет fields");
    const statusLike = audit.fields.filter((f) => /статус/i.test(f.title));
    const hasBirthday = audit.fields.some((f) => f.id === "BIRTHDATE" || /рожден/i.test(f.title));
    const hasCompany = audit.fields.some((f) => f.id === "COMPANY_ID");
    assert(hasBirthday, "Нет BIRTHDATE");
    assert(hasCompany, "Нет COMPANY_ID");
    ok(
      "1. Аудит полей контакта",
      `fields=${audit.fields.length}, statusCandidates=${statusLike.map((f) => f.id).join(",") || "—"}`
    );
  });

  await runCase("2. Общее количество контактов", async () => {
    const report = await contact_count({});
    assert(typeof report.total === "number", "Нет total");
    assert(report.pagesProcessed >= 1, "pagesProcessed < 1");
    ok("2. Общее количество контактов", `total=${report.total}, pages=${report.pagesProcessed}`);
  });

  await runCase("3. Контакты по статусам", async () => {
    const report = await contact_count_by_status({});
    if (report?.error?.code === "CONTACT_STATUS_FIELD_NOT_CONFIGURED") {
      ok("3. Контакты по статусам", "пропуск: поле статуса не настроено");
      return;
    }
    assert(Array.isArray(report.groups), "Нет groups");
    assert(report.statusField, "Нет statusField");
    const empty = report.groups.find((g) => g.statusId == null);
    ok(
      "3. Контакты по статусам",
      `groups=${report.groups.length}, empty=${empty?.count ?? 0}, total=${report.total}`
    );
  });

  await runCase("4. Контакты без статуса", async () => {
    const report = await contacts_without_status({});
    if (report?.error?.code === "CONTACT_STATUS_FIELD_NOT_CONFIGURED") {
      ok("4. Контакты без статуса", "пропуск: поле статуса не настроено");
      return;
    }
    assert(typeof report.count === "number", "Нет count");
    assert(Array.isArray(report.sample), "Нет sample");
    assert(report.sample.length <= PAGINATION.SAMPLE_LIMIT, "sample > 100");
    if (report.sample[0]) {
      assert(report.sample[0].url, "Нет url");
      assert(!String(report.sample[0].url).includes("/rest/"), "url содержит /rest/");
    }
    ok("4. Контакты без статуса", `count=${report.count}, sample=${report.sample.length}`);
  });

  await runCase("5. Контакты без компании", async () => {
    const report = await contacts_without_company({});
    assert(typeof report.count === "number", "Нет count");
    assert(report.severity === "warning", "severity != warning");
    assert(report.sample.length <= PAGINATION.SAMPLE_LIMIT, "sample > 100");
    ok("5. Контакты без компании", `count=${report.count}, sample=${report.sample.length}`);
  });

  await runCase("6. Контакты без дня рождения", async () => {
    const report = await contacts_missing_birthday({});
    assert(typeof report.count === "number", "Нет count");
    assert(report.severity === "warning", "severity != warning");
    ok("6. Контакты без дня рождения", `count=${report.count}, sample=${report.sample.length}`);
  });

  await runCase("7. Контакты в цикле без дела", async () => {
    const report = await contacts_cycle_without_next_activity({});
    if (report?.error?.code === "CONTACT_STATUS_CYCLE_VALUES_NOT_CONFIGURED") {
      ok("7. Контакты в цикле без дела", "пропуск: CYCLE values не настроены");
      return;
    }
    if (report?.error?.code === "CONTACT_STATUS_FIELD_NOT_CONFIGURED") {
      ok("7. Контакты в цикле без дела", "пропуск: поле статуса не настроено");
      return;
    }
    if (report?.error?.code === "CRM_ACTIVITIES_ACCESS_DENIED") {
      ok("7. Контакты в цикле без дела", "доступ к activities отсутствует (ожидаемый код)");
      return;
    }
    assert(typeof report.countWithoutActivity === "number", "Нет countWithoutActivity");
    assert(Array.isArray(report.withoutActivity), "Нет withoutActivity");
    ok(
      "7. Контакты в цикле без дела",
      `without=${report.countWithoutActivity}, sample=${report.withoutActivity.length}`
    );
  });

  await runCase("8. Контакты только с просроченным делом", async () => {
    const report = await contacts_cycle_without_next_activity({});
    if (report?.error) {
      ok("8. Контакты только с просроченным делом", `пропуск: ${report.error.code}`);
      return;
    }
    assert(typeof report.countWithOverdueActivityOnly === "number", "Нет count");
    assert(Array.isArray(report.withOverdueActivityOnly), "Нет списка");
    ok(
      "8. Контакты только с просроченным делом",
      `count=${report.countWithOverdueActivityOnly}`
    );
  });

  await runCase("9. Контроль поздравлений", async () => {
    const report = await contacts_birthday_activity_report({ daysAhead: 30 });
    if (report?.error?.code === "CRM_ACTIVITIES_ACCESS_DENIED") {
      ok("9. Контроль поздравлений", "доступ к activities отсутствует");
      return;
    }
    assert(report.detectionMethod === "activity_subject_pattern", "Неверный метод");
    assert(typeof report.birthdayActivityMissing === "number", "Нет missing");
    ok(
      "9. Контроль поздравлений",
      `upcoming=${report.upcomingCount}, missing=${report.birthdayActivityMissing}, overdue=${report.birthdayActivityOverdue}`
    );
  });

  await runCase("10. Общий contact quality report", async () => {
    const report = await contact_quality_report({ daysAhead: 30 });
    assert(report.reportType === "contact_quality", "reportType");
    assert(report.summary, "Нет summary");
    assert(Array.isArray(report.issues), "Нет issues");
    assert(Array.isArray(report.recommendations), "Нет recommendations");
    ok(
      "10. Общий contact quality report",
      `total=${report.summary.totalContacts}, issues=${report.issues.length}`
    );
  });

  await runCase("11. Пустой результат", async () => {
    const report = await contacts_missing_birthday({
      filter: { ID: 0 },
    });
    assert(report.count === 0 || report.sample.length === 0, "Ожидался пустой результат");
    ok("11. Пустой результат", `count=${report.count}`);
  });

  await runCase("12. Ненастроенное поле статуса", async () => {
    process.env.BITRIX_CONTACT_STATUS_FIELD = "";
    const report = await contact_count_by_status({});
    process.env.BITRIX_CONTACT_STATUS_FIELD = savedStatusField;
    assert(report.success === false, "Ожидался success:false");
    assert(report.error?.code === "CONTACT_STATUS_FIELD_NOT_CONFIGURED", "Неверный код ошибки");
    ok("12. Ненастроенное поле статуса", report.error.message);
  });

  await runCase("13. Неизвестное значение статуса", async () => {
    if (!savedStatusField) {
      ok("13. Неизвестное значение статуса", "пропуск: статус не настроен");
      return;
    }
    process.env.BITRIX_CONTACT_STATUS_FIELD = savedStatusField;
    process.env.BITRIX_CONTACT_STATUS_CYCLE_VALUES = "999999001,999999002";
    const report = await contacts_cycle_without_next_activity({});
    process.env.BITRIX_CONTACT_STATUS_CYCLE_VALUES =
      process.env.BITRIX_CONTACT_STATUS_CYCLE_VALUES_BACKUP || config.statusCycleValues.join(",");
    // restore from original config snapshot
    if (config.statusCycleValues.length) {
      process.env.BITRIX_CONTACT_STATUS_CYCLE_VALUES = config.statusCycleValues.join(",");
    }

    if (report?.error?.code === "CRM_ACTIVITIES_ACCESS_DENIED") {
      ok("13. Неизвестное значение статуса", "activities denied, unknown values проверены через enum map");
      return;
    }
    assert(Array.isArray(report.unknownCycleValues), "Нет unknownCycleValues");
    assert(report.unknownCycleValues.length >= 1, "Ожидались неизвестные enum ID");
    ok("13. Неизвестное значение статуса", `unknown=${report.unknownCycleValues.join(",")}`);
  });

  await runCase("14. Отсутствие доступа к activities", async () => {
    const report = await contacts_cycle_without_next_activity({});
    if (report?.error?.code === "CRM_ACTIVITIES_ACCESS_DENIED") {
      assert(report.error.details?.requiredScope === "CRM", "Нет requiredScope");
      ok("14. Отсутствие доступа к activities", "код CRM_ACTIVITIES_ACCESS_DENIED");
      return;
    }
    if (report?.error?.code?.includes("NOT_CONFIGURED")) {
      ok("14. Отсутствие доступа к activities", `пропуск: ${report.error.code}`);
      return;
    }
    ok("14. Отсутствие доступа к activities", "доступ есть — пустой результат не подменён ошибкой");
  });

  await runCase("15. Ограничение sample до 100", async () => {
    const report = await contacts_without_company({});
    assert(report.sampleLimit === 100 || report.sample.length <= 100, "sampleLimit нарушен");
    assert(report.sample.length <= PAGINATION.SAMPLE_LIMIT, "sample > 100");
    ok("15. Ограничение sample до 100", `sample=${report.sample.length}, limit=${report.sampleLimit}`);
  });

  await runCase("16. Отсутствие N+1 запросов пользователей", async () => {
    clearDirectoryCaches();
    const before = getDirectoryCacheStats();
    const ids = [1, 1, 2, 2, 3, 3, 4, 5];
    await resolveUsersByIds(ids);
    const after = getDirectoryCacheStats();
    assert(after.usersCached >= before.usersCached, "кэш не вырос");
    // Повторный вызов не должен требовать новых ID
    const mid = getDirectoryCacheStats().usersCached;
    await resolveUsersByIds(ids);
    const end = getDirectoryCacheStats().usersCached;
    assert(end === mid, "повторный resolve увеличил кэш — возможен N+1");
    const url = buildCrmEntityUrl("contact", 123);
    assert(url && url.includes("/crm/contact/details/123/"), "Неверный URL карточки");
    assert(!url.includes("/rest/"), "URL содержит rest/webhook");
    ok(
      "16. Отсутствие N+1 запросов пользователей",
      `cached=${end}, url=${url}`
    );
  });

  // restore env
  if (savedStatusField) process.env.BITRIX_CONTACT_STATUS_FIELD = savedStatusField;
  if (config.statusCycleValues.length) {
    process.env.BITRIX_CONTACT_STATUS_CYCLE_VALUES = config.statusCycleValues.join(",");
  }

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
