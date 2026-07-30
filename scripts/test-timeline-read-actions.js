/**
 * Unit/integration tests для read-only actions:
 * - stagehistory_list (crm.stagehistory.list)
 * - timeline_comment_list (crm.timeline.comment.list)
 *
 * Запуск: npm run test:timeline-read
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDb = path.join(os.tmpdir(), `timeline-read-test-${Date.now()}.sqlite`);
const WEBHOOK_SECRET = "supersecretwebhooktoken123";
const WEBHOOK_URL = `https://example.bitrix24.ru/rest/1/${WEBHOOK_SECRET}/`;

process.env.BITRIX_OPERATIONS_DB_PATH = tmpDb;
process.env.BITRIX_WEBHOOK_URL = WEBHOOK_URL;
process.env.BITRIX_BULK_ACTIONS_ENABLED = "false";

const logs = [];
const originalLog = console.log;
const originalWarn = console.warn;

console.log = (...args) => {
  logs.push(args.join(" "));
  originalLog(...args);
};
console.warn = (...args) => {
  logs.push(args.join(" "));
  originalWarn(...args);
};

let passed = 0;
let failed = 0;

function assert(cond, name, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const bitrixCalls = [];

function installBitrixMock() {
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : {};
    bitrixCalls.push({ url, body });
    const method = String(url).match(/\/([^/]+)\.json/)?.[1] || "";

    if (method === "crm.timeline.comment.list") {
      const filter = body.filter || {};
      const entityId = filter.ENTITY_ID ?? filter.OWNER_ID;
      if (entityId === 999) {
        return {
          ok: false,
          status: 403,
          text: async () =>
            JSON.stringify({ error: "ACCESS_DENIED", error_description: "Access denied" }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            result: [
              { ID: 1, COMMENT: "Первый комментарий", AUTHOR_ID: 7 },
              { ID: 2, COMMENT: "Второй комментарий", AUTHOR_ID: 8 },
            ],
            next: 50,
            total: 2,
          }),
      };
    }

    if (method === "crm.stagehistory.list") {
      if (body.entityTypeId === 2 && body.filter?.OWNER_ID === 123) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              result: {
                items: [
                  { ID: 10, STAGE_ID: "NEW", CREATED_TIME: "2026-01-01T10:00:00+03:00" },
                  { ID: 11, STAGE_ID: "PREPARATION", CREATED_TIME: "2026-01-05T10:00:00+03:00" },
                ],
              },
              total: 2,
            }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ result: { items: [] }, total: 0 }),
      };
    }

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result: [] }),
    };
  };
}

async function main() {
  console.log(`\n[test:timeline-read] tmp DB: ${tmpDb}\n`);

  const { openDatabase, closeDatabase } = await import("../src/database/index.js");
  openDatabase({ dbPath: tmpDb });

  installBitrixMock();

  const { getActionCatalog, getActionHandler } = await import("../src/actions/index.js");
  const { getActionPolicy } = await import("../src/safety/policies.js");
  const { classifyBitrixMethod } = await import("../src/safety/writeMethods.js");
  const { executeAction } = await import("../src/safety/executor.js");
  const { isReadOnlyAction } = await import("../src/actionSafety.js");
  const { selectRelevantActions } = await import("../src/actions/catalogSelector.js");
  const { redactObject } = await import("../src/safety/redact.js");
  const {
    timeline_comment_list,
    stagehistory_list,
    normalizeTimelineCommentParams,
    normalizeStageHistoryParams,
  } = await import("../src/actions/timelineActions.js");
  const { BitrixAppError } = await import("../src/bitrix/errors.js");

  const catalog = getActionCatalog();
  const stageEntry = catalog.find((a) => a.name === "stagehistory_list");
  const commentEntry = catalog.find((a) => a.name === "timeline_comment_list");

  assert(Boolean(stageEntry), "каталог содержит stagehistory_list");
  assert(stageEntry?.aliases?.includes("crm.stagehistory.list"), "alias crm.stagehistory.list");
  assert(Boolean(commentEntry), "каталог содержит timeline_comment_list");
  assert(
    commentEntry?.userScenarios?.includes("Покажи комментарии сделки 123"),
    "сценарий комментариев сделки"
  );
  assert(
    stageEntry?.userScenarios?.includes("Покажи историю стадий сделки 123"),
    "сценарий истории стадий"
  );

  assert(isReadOnlyAction("stagehistory_list"), "stagehistory_list read-only");
  assert(isReadOnlyAction("timeline_comment_list"), "timeline_comment_list read-only");
  assert(getActionPolicy("stagehistory_list")?.requiresConfirmation === false, "без confirmation");
  assert(getActionPolicy("timeline_comment_list")?.requiresConfirmation === false, "без confirmation comment");

  assert(classifyBitrixMethod("crm.stagehistory.list") === "read", "REST stagehistory read");
  assert(classifyBitrixMethod("crm.timeline.comment.list") === "read", "REST comment list read");

  // Нормализация параметров
  const commentNorm = normalizeTimelineCommentParams({
    entityType: "deal",
    entityId: "123",
    start: "0",
  });
  assert(commentNorm.filter.ENTITY_TYPE === "deal", "ENTITY_TYPE deal");
  assert(commentNorm.filter.ENTITY_ID === 123, "ENTITY_ID число");
  assert(commentNorm.start === 0, "start неотрицательный");

  const stageNorm = normalizeStageHistoryParams({
    entityType: "deal",
    entityId: 123,
    start: 0,
  });
  assert(stageNorm.entityTypeId === 2, "entityTypeId для deal = 2");
  assert(stageNorm.filter.OWNER_ID === 123, "OWNER_ID положительный");

  let invalid = false;
  try {
    normalizeTimelineCommentParams({ entityType: "deal", entityId: -1 });
  } catch {
    invalid = true;
  }
  assert(invalid, "ENTITY_ID отрицательный отклоняется");

  invalid = false;
  try {
    normalizeTimelineCommentParams({ entityType: "unknown", entityId: 1 });
  } catch {
    invalid = true;
  }
  assert(invalid, "неизвестный ENTITY_TYPE отклоняется");

  // Передача параметров в Bitrix
  bitrixCalls.length = 0;
  logs.length = 0;
  const commentResult = await timeline_comment_list({
    entityType: "deal",
    entityId: 123,
    select: ["ID", "COMMENT"],
    start: 0,
  });
  assert(Array.isArray(commentResult.items), "timeline_comment_list возвращает items");
  assert(commentResult.items.length === 2, "получены комментарии");
  const commentCall = bitrixCalls.find((c) => c.url.includes("crm.timeline.comment.list"));
  assert(commentCall?.body?.filter?.ENTITY_ID === 123, "ENTITY_ID передан в Bitrix");
  assert(commentCall?.body?.filter?.ENTITY_TYPE === "deal", "ENTITY_TYPE передан в Bitrix");
  assert(commentCall?.body?.select?.includes("COMMENT"), "select передан");

  bitrixCalls.length = 0;
  const stageResult = await stagehistory_list({
    entityType: "deal",
    entityId: 123,
    order: { ID: "ASC" },
  });
  assert(stageResult.items?.length === 2, "stagehistory_list возвращает историю");
  const stageCall = bitrixCalls.find((c) => c.url.includes("crm.stagehistory.list"));
  assert(stageCall?.body?.entityTypeId === 2, "entityTypeId передан");
  assert(stageCall?.body?.filter?.OWNER_ID === 123, "OWNER_ID передан");

  // executeAction без confirmation
  const execStage = await executeAction(
    "stagehistory_list",
    { entityType: "deal", entityId: 123 },
    {
      source: "test",
      deps: {
        runHandler: getActionHandler("stagehistory_list"),
      },
    }
  );
  assert(execStage.status === "completed", "executeAction stagehistory completed");
  assert(!execStage.confirmationId, "нет confirmationId");

  // Ошибки Bitrix нормализуются
  let bitrixError = null;
  try {
    await timeline_comment_list({ entityType: "deal", entityId: 999 });
  } catch (error) {
    bitrixError = error;
  }
  assert(bitrixError instanceof BitrixAppError, "ошибка Bitrix нормализована");
  assert(bitrixError.code === "BITRIX_ACCESS_DENIED", "код ACCESS_DENIED");

  // Секрет вебхука не попадает в логи
  const allLogs = logs.join("\n");
  assert(!allLogs.includes(WEBHOOK_SECRET), "секрет не в console.log/warn");
  const redacted = redactObject({ BITRIX_WEBHOOK_URL: WEBHOOK_URL });
  assert(redacted.BITRIX_WEBHOOK_URL === "[redacted]", "redact скрывает webhook URL");

  // Подбор actions по русским сценариям
  const stagePick = selectRelevantActions("Покажи историю стадий сделки 123");
  assert(
    stagePick.actions.some((a) => a.name === "stagehistory_list"),
    "сценарий истории стадий подбирает action"
  );
  const commentPick = selectRelevantActions("Что менеджеры писали в таймлайне лида 456");
  assert(
    commentPick.actions.some((a) => a.name === "timeline_comment_list"),
    "сценарий таймлайна подбирает action"
  );

  // Integration (live Bitrix) — опционально
  if (process.env.RUN_LIVE_BITRIX_TESTS === "1" && process.env.BITRIX_WEBHOOK_URL?.includes("bitrix")) {
    console.log("\n  [live] проверка реального Bitrix24...");
    const liveStage = await stagehistory_list({ entityType: "deal", entityId: 1, limit: 5 });
    assert(liveStage.items != null, "live stagehistory_list");
  } else {
    console.log("  (live Bitrix пропущен — задайте RUN_LIVE_BITRIX_TESTS=1 для интеграции)");
  }

  closeDatabase();
  try {
    fs.unlinkSync(tmpDb);
  } catch {
    // ignore
  }

  console.log(`\n=== Итого: passed=${passed} failed=${failed} ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
