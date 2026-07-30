/**
 * Unit/integration tests for deal creation flow.
 * Run: npm run test:deal-create
 */
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDb = path.join(os.tmpdir(), `bitrix-deal-create-test-${Date.now()}.sqlite`);
process.env.BITRIX_OPERATIONS_DB_PATH = tmpDb;
process.env.BITRIX_CONFIRMATION_TTL_MINUTES = "15";

const { openDatabase, closeDatabase } = await import("../src/database/index.js");
openDatabase({ dbPath: tmpDb });

import { getDealStageEntityId, isNil, hasPresentValue } from "../src/actions/helpers.js";
import { pickInitialDealStage } from "../src/deals/dealCreateStages.js";
import { resolveAssigneeFromUsers } from "../src/deals/dealCreateEmployees.js";
import {
  listRequiredWritableDealFields,
  validateDealRequiredFields,
  buildDealCreateFields,
} from "../src/deals/dealCreateFields.js";
import { resolveDealCategoryId } from "../src/deals/dealCreateService.js";
import { maskBitrixWebhookUrl } from "../src/bitrixClient.js";
import { getActionPolicy } from "../src/safety/policies.js";
import { prepareAction, commitAction, cancelAction } from "../src/safety/executor.js";
import { WriteOutsideSafetyError } from "../src/safety/executionContext.js";
import { callWriteMethod } from "../src/bitrixClient.js";

const results = [];

function ok(name, detail = "") {
  results.push({ name, status: "PASS", detail });
  console.log(`✓ PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, error) {
  results.push({ name, status: "FAIL", detail: error?.message || String(error) });
  console.error(`✗ FAIL  ${name} — ${error?.message || error}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runCase(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (error) {
    fail(name, error);
  }
}

// --- Test 1: categoryId 0 ---
await runCase("1. Общая воронка categoryId=0", () => {
  assert(!isNil(0), "0 is not nil");
  assert(getDealStageEntityId(0) === "DEAL_STAGE", "stage entity");
  const id = resolveDealCategoryId([{ id: 0, name: "Общая", isDefault: true }], {});
  assert(id === 0, "resolved category");
});

// --- Test 2: custom stage string ---
await runCase("2. Пользовательская стадия UC_CFQ2RN", () => {
  const stageId = pickInitialDealStage(
    [{ STATUS_ID: "UC_CFQ2RN", SORT: 10, SEMANTICS: "P" }],
    { preferredStageId: "UC_CFQ2RN" }
  );
  assert(stageId === "UC_CFQ2RN", "stage string");
  assert(typeof stageId === "string", "type string");
});

// --- Test 3: category 2 ---
await runCase("3. Воронка categoryId=2", () => {
  assert(getDealStageEntityId(2) === "DEAL_STAGE_2", "entity id");
});

// --- Test 4: single employee ---
await runCase("4. Один найденный сотрудник", () => {
  const r = resolveAssigneeFromUsers([
    { ID: "1428", NAME: "Valentina", LAST_NAME: "Rodionova" },
  ]);
  assert(r.status === "resolved", "resolved");
  assert(r.assignedById === 1428, "id");
  const fields = buildDealCreateFields(
    { title: "Тест" },
    { categoryId: 0, stageId: "NEW", assignedById: r.assignedById }
  );
  assert(fields.ASSIGNED_BY_ID === 1428, "payload assignee");
});

// --- Test 5: multiple employees ---
await runCase("5. Несколько сотрудников", () => {
  const r = resolveAssigneeFromUsers([
    { ID: "1", NAME: "A", LAST_NAME: "Rodionova" },
    { ID: "2", NAME: "B", LAST_NAME: "Rodionova" },
  ]);
  assert(r.status === "ambiguous", "ambiguous");
  assert(r.candidates.length === 2, "candidates");
});

// --- Test 6: required field missing ---
await runCase("6. Не заполнено обязательное поле", () => {
  const meta = {
    TITLE: { isRequired: true, isReadOnly: false, formLabel: "Название" },
    UF_REQ: { isRequired: true, isReadOnly: false, formLabel: "Обязательное UF" },
  };
  const required = listRequiredWritableDealFields(meta);
  assert(required.some((f) => f.code === "UF_REQ"), "found required");
  const fields = buildDealCreateFields(
    { title: "X" },
    { categoryId: 0, stageId: "NEW", assignedById: 1 }
  );
  const v = validateDealRequiredFields(fields, required);
  assert(v.ok === false, "not ok");
  assert(v.missing.some((m) => m.code === "UF_REQ"), "missing uf");
});

// --- Test 7: policies read vs write ---
await runCase("7. Одно подтверждение (политики)", () => {
  assert(getActionPolicy("deal_create_prepare")?.requiresConfirmation === false, "prepare read");
  assert(getActionPolicy("search_users")?.requiresConfirmation === false, "search read");
  assert(getActionPolicy("deal_category_list")?.requiresConfirmation === false, "category read");
  assert(getActionPolicy("deal_stage_list")?.requiresConfirmation === false, "stage read");
  assert(getActionPolicy("deal_fields")?.requiresConfirmation === false, "fields read");
  assert(getActionPolicy("create_deal")?.requiresConfirmation === true, "create confirm");
});

// --- Test 8: payload shape ---
await runCase("8. Успешный payload", () => {
  const fields = buildDealCreateFields(
    { title: "Тест ИИ" },
    { categoryId: 0, stageId: "UC_CFQ2RN", assignedById: 1428 }
  );
  assert(fields.TITLE === "Тест ИИ", "title");
  assert(fields.CATEGORY_ID === 0, "category 0");
  assert(fields.STAGE_ID === "UC_CFQ2RN", "stage");
  assert(fields.ASSIGNED_BY_ID === 1428, "assignee");
});

// --- Test 9: cancel does not write ---
await runCase("9. Отказ пользователя", async () => {
  let writeCalls = 0;
  const prepared = await prepareAction(
    "create_deal",
    {
      title: "Cancel test",
      categoryId: 0,
      stageId: "NEW",
      assignedById: 1,
    },
    {
      source: "test",
      sessionId: "deal-create-test",
      deps: {
        buildPlan: async () => ({
          preview: { title: "t", changes: [], affectedCount: 1 },
          before: { entityType: "deal", entityId: null, fields: {} },
          after: { entityType: "deal", entityId: null, fields: { TITLE: "Cancel test" } },
          items: [{ entityType: "deal", entityId: null, before: {}, after: {} }],
          entityIds: [],
          affectedCount: 1,
          execPlan: { kind: "entity_create", entityType: "deal", fields: { TITLE: "Cancel test" } },
        }),
        runHandler: async () => {
          writeCalls += 1;
          return { id: 1 };
        },
      },
    }
  );
  assert(prepared.status === "confirmation_required", "prepared");
  await cancelAction(prepared.confirmationId, { source: "test", sessionId: "deal-create-test" });
  assert(writeCalls === 0, "no write");
});

// --- Test 10: Bitrix error surfaces (mock) ---
await runCase("10. Ошибка Bitrix24 (mock)", async () => {
  const deps = {
    buildPlan: async () => ({
      preview: { title: "t", changes: [], affectedCount: 1 },
      before: { entityType: "deal", entityId: null, fields: {} },
      after: { entityType: "deal", entityId: null, fields: {} },
      items: [{ entityType: "deal", entityId: null, before: {}, after: {} }],
      entityIds: [],
      affectedCount: 1,
      execPlan: { kind: "entity_create", entityType: "deal", fields: { TITLE: "Err" } },
    }),
    runHandler: async () => {
      const err = new Error("Bitrix denied");
      err.code = "BITRIX_DENIED";
      throw err;
    },
  };
  const prepared = await prepareAction(
    "create_deal",
    { title: "Err", categoryId: 0, stageId: "NEW", assignedById: 1 },
    {
      source: "test",
      sessionId: "deal-create-test-2",
      deps,
    }
  );
  const committed = await commitAction(prepared.confirmationId, {
    source: "test",
    sessionId: "deal-create-test-2",
    deps,
  });
  assert(committed.success === false, "failed commit");
});

// --- Test 11: Safety executor blocks direct write ---
await runCase("11. Safety Executor блокирует прямой write", async () => {
  let blocked = false;
  try {
    await callWriteMethod("crm.deal.add", { fields: { TITLE: "x" } });
  } catch (error) {
    blocked = error instanceof WriteOutsideSafetyError;
  }
  assert(blocked, "blocked outside safety");
});

// --- Test 12: webhook masking ---
await runCase("12. Маскирование вебхука", () => {
  const masked = maskBitrixWebhookUrl(
    "https://portal.bitrix24.ru/rest/1/secret-token-xyz/crm.deal.add.json"
  );
  assert(!masked.includes("secret-token-xyz"), "token hidden");
  assert(masked.includes("***"), "masked");
  assert(masked.includes("crm.deal.add"), "method visible");
});

// --- hasPresentValue edge cases ---
await runCase("CATEGORY_ID=0 в hasPresentValue", () => {
  assert(hasPresentValue(0), "zero is present");
  assert(!hasPresentValue(null), "null");
});

const failed = results.filter((r) => r.status === "FAIL");
console.log(`\nИтого: ${results.length - failed.length}/${results.length} passed`);
closeDatabase();
try {
  fs.unlinkSync(tmpDb);
} catch {
  /* ignore */
}
if (failed.length) {
  process.exit(1);
}
