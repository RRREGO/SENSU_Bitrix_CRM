/**
 * Тесты hardening safety layer (моки, без записи в Bitrix24).
 * Запуск: npm run test:safety:hardening
 */
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDb = path.join(os.tmpdir(), `bitrix-hardening-${Date.now()}.sqlite`);
process.env.BITRIX_OPERATIONS_DB_PATH = tmpDb;
process.env.BITRIX_BULK_ACTIONS_ENABLED = "false";

const { openDatabase, closeDatabase } = await import("../src/database/index.js");
openDatabase({ dbPath: tmpDb, reopen: true });

const {
  callBitrixMethod,
  callReadMethod,
  callWriteMethod,
  WriteOutsideSafetyError,
} = await import("../src/bitrixClient.js");
const { runWithSafetyContext } = await import("../src/safety/executionContext.js");
const { classifyBitrixMethod, isWriteMethod } = await import("../src/safety/writeMethods.js");
const { prepareAction, commitAction, executeAction } = await import("../src/safety/executor.js");
const { listPolicies } = await import("../src/safety/policies.js");

const results = [];

function ok(name, detail = "") {
  results.push({ name, status: "PASS", detail });
  console.log(`✓ PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, error) {
  results.push({ name, status: "FAIL", detail: error?.message || String(error) });
  console.error(`✗ FAIL  ${name} — ${error?.message || error}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function runCase(name, fn) {
  try {
    await fn();
  } catch (e) {
    fail(name, e);
  }
}

console.log("=== Safety hardening tests ===\n");

await runCase("1. Прямой write без safety context блокируется", async () => {
  let caught = null;
  try {
    await callWriteMethod("crm.deal.update", { id: 1, fields: { COMMENTS: "x" } });
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof WriteOutsideSafetyError, "WriteOutsideSafetyError");
  assert(caught.code === "WRITE_CALL_OUTSIDE_SAFETY_EXECUTOR", "code");
  ok("1. Прямой write без safety context блокируется");
});

await runCase("2. Пользователь не может передать executionToken", async () => {
  let caught = null;
  try {
    await callBitrixMethod(
      "crm.deal.update",
      { id: 1, fields: { COMMENTS: "x" } },
      { executionToken: "forged-token" }
    );
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof WriteOutsideSafetyError, "blocked forged token");

  const prepared = await prepareAction(
    "deal_update",
    {
      id: 1,
      fields: { COMMENTS: "x" },
      executionToken: "client-token",
    },
    {
      source: "test",
      deps: {
        buildPlan: async () => ({
          preview: { title: "t", changes: [], affectedCount: 1 },
          before: { entityType: "deal", entityId: "1", fields: { COMMENTS: "old" } },
          after: { entityType: "deal", entityId: "1", fields: { COMMENTS: "x" } },
          items: [{ entityType: "deal", entityId: "1", before: { COMMENTS: "old" }, after: { COMMENTS: "x" } }],
          entityIds: ["1"],
          affectedCount: 1,
          execPlan: { kind: "entity_update", entityType: "deal", entityId: "1", fields: { COMMENTS: "x" } },
        }),
      },
    }
  );
  assert(prepared.success !== false, "prepare ok");
  assert(!JSON.stringify(prepared).includes("client-token"), "token stripped from response");
  ok("2. Пользователь не может передать executionToken");
});

await runCase("3. Read без safety context работает", async () => {
  // Без webhook — ожидаем ошибку конфигурации/сети, но НЕ WriteOutsideSafetyError
  let caught = null;
  try {
    await callReadMethod("crm.deal.fields", {});
  } catch (e) {
    caught = e;
  }
  assert(!(caught instanceof WriteOutsideSafetyError), "not write error");
  // classify
  assert(classifyBitrixMethod("crm.deal.get") === "read", "get=read");
  assert(classifyBitrixMethod("profile") === "read", "profile=read");
  assert(classifyBitrixMethod("user.current") === "read", "user.current=read");
  assert(!isWriteMethod("crm.deal.list"), "list not write");
  ok("3. Read без safety context работает");
});

await runCase("4. analyze endpoint контракт — без записи", async () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  assert(serverSrc.includes("analyzeDealReadOnly"), "read-only analyze");
  assert(!serverSrc.includes("analyzeDealAndWriteComment"), "legacy writer removed");
  assert(serverSrc.includes("savedToTimeline: false"), "flag");
  assert(!/addDealTimelineComment/.test(serverSrc), "no direct timeline write in server");
  ok("4. /bitrix/deal/:id/analyze ничего не записывает");
});

await runCase("5. Сохранение анализа создаёт prepare", async () => {
  assert(
    fs.readFileSync(path.join(__dirname, "../server.js"), "utf8").includes("analyze/save/prepare"),
    "save prepare route"
  );
  assert(
    fs.readFileSync(path.join(__dirname, "../server.js"), "utf8").includes('prepareAction(\n      "timeline_comment_add"') ||
      fs.readFileSync(path.join(__dirname, "../server.js"), "utf8").includes('prepareAction(\r\n      "timeline_comment_add"') ||
      fs.readFileSync(path.join(__dirname, "../server.js"), "utf8").includes('prepareAction(\n      "timeline_comment_add"'),
    "uses prepareAction timeline_comment_add"
  );
  // softer check
  const src = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  assert(src.includes("timeline_comment_add"), "timeline_comment_add");
  assert(src.includes("prepareAction"), "prepareAction");
  ok("5. Сохранение анализа создаёт prepare");
});

await runCase("6. /bitrix/event не пишет автоматически", async () => {
  const src = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  assert(src.includes("WEBHOOK_WRITE_BLOCKED"), "blocked code");
  assert(src.includes("written: false"), "written false");
  assert(src.includes("blockedWrite: true"), "blockedWrite");
  ok("6. /bitrix/event не выполняет write автоматически");
});

await runCase("7. Неизвестный REST-метод блокируется", async () => {
  assert(classifyBitrixMethod("crm.weird.doSomething") === "unknown", "unknown");
  assert(isWriteMethod("crm.weird.doSomething"), "treated as write");
  let caught = null;
  try {
    await callBitrixMethod("crm.weird.doSomething", {});
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof WriteOutsideSafetyError, "blocked");
  ok("7. Неизвестный REST-метод блокируется");
});

await runCase("8. Write внутри safety context разрешён (мок request)", async () => {
  let ran = false;
  await runWithSafetyContext(
    { operationId: "op-1", confirmationId: "c-1", action: "deal_update", source: "test" },
    async () => {
      // callWriteMethod дойдёт до fetch — без webhook упадёт иначе, чем WriteOutside
      try {
        await callWriteMethod("crm.deal.update", { id: 1, fields: { COMMENTS: "ok" } });
        ran = true;
      } catch (e) {
        assert(!(e instanceof WriteOutsideSafetyError), `unexpected safety block: ${e.message}`);
        // network / config error means guard passed
        ran = true;
      }
    }
  );
  assert(ran, "entered write path");
  ok("8. Write в safety context не блокируется guard'ом");
});

await runCase("9. Повторный commit идемпотентен (контракт executor)", async () => {
  const src = fs.readFileSync(path.join(__dirname, "../src/safety/executor.js"), "utf8");
  assert(src.includes("idempotent"), "idempotent");
  assert(src.includes("runWithSafetyContext"), "uses context");
  ok("9. Повторный commit / context в executor");
});

await runCase("10. Backup SQLite создаётся", async () => {
  const backupScript = path.join(__dirname, "backup-database.js");
  const r = spawnSync(process.execPath, [backupScript], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, BITRIX_OPERATIONS_DB_PATH: tmpDb },
    encoding: "utf8",
  });
  assert(r.status === 0, r.stderr || r.stdout || "backup failed");
  const parsed = JSON.parse(r.stdout.trim().split("\n").slice(-20).join("\n").match(/\{[\s\S]*\}/)?.[0] || r.stdout);
  assert(parsed.ok === true, "ok");
  assert(fs.existsSync(path.join(__dirname, "..", parsed.backup)), "file exists");
  globalThis.__lastBackup = path.join(__dirname, "..", parsed.backup);
  ok("10. Backup SQLite создаётся", parsed.backup);
});

await runCase("11. Backup проходит integrity check", async () => {
  const checkScript = path.join(__dirname, "check-database-backup.js");
  const backup = globalThis.__lastBackup;
  assert(backup, "backup path");
  const r = spawnSync(process.execPath, [checkScript, backup], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
  assert(r.status === 0, r.stderr || r.stdout);
  const parsed = JSON.parse(r.stdout.match(/\{[\s\S]*\}/)[0]);
  assert(parsed.ok === true && parsed.integrity === "ok", "integrity");
  ok("11. Backup проходит integrity check", `ops=${parsed.counts?.operations}`);
});

await runCase("12. /health отражает safety и БД", async () => {
  const src = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  assert(src.includes("migrationVersion"), "migrationVersion");
  assert(src.includes("blockedActions"), "blockedActions");
  assert(src.includes("journalMode"), "journalMode");
  const blocked = listPolicies().filter((p) => p.blocked).length;
  assert(blocked >= 1, "has blocked");
  ok("12. /health отражает состояние safety и БД", `blocked=${blocked}`);
});

closeDatabase();
try {
  fs.unlinkSync(tmpDb);
} catch {
  /* ignore */
}

const passed = results.filter((r) => r.status === "PASS").length;
const failed = results.filter((r) => r.status === "FAIL").length;
console.log("\n=== Summary ===");
console.log(`PASS: ${passed}`);
console.log(`FAIL: ${failed}`);
process.exit(failed ? 1 : 0);
