/**
 * Live smoke-тест safety layer на одной тестовой CRM-сущности.
 *
 * НЕ запускается без явных параметров и флага окружения.
 *
 * Пример:
 *   BITRIX_LIVE_SAFETY_TEST_ENABLED=true node scripts/smoke-test-safety-live.js --entity deal --id 123 --field COMMENTS
 *
 * Опционально: --test-conflict
 */
import "dotenv/config";
import readline from "readline";
import { openDatabase, closeDatabase } from "../src/database/index.js";
import { callReadMethod } from "../src/bitrixClient.js";
import { prepareAction, commitAction, prepareRollback, commitRollback } from "../src/safety/executor.js";
import { getOperationEvents, getOperationById } from "../src/database/repositories/operationsRepository.js";
import { ENTITY_TYPE } from "../src/actions/helpers.js";

const ALLOWED_FIELDS = new Set(["COMMENTS", "UF_CRM_TEST", "SOURCE_DESCRIPTION"]);

function parseArgs(argv) {
  const out = { entity: null, id: null, field: null, testConflict: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--entity") out.entity = argv[++i];
    else if (a === "--id") out.id = argv[++i];
    else if (a === "--field") out.field = argv[++i];
    else if (a === "--test-conflict") out.testConflict = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function fetchEntity(entity, id) {
  const map = {
    deal: { typeId: ENTITY_TYPE.DEAL, legacy: "crm.deal.get" },
    lead: { typeId: ENTITY_TYPE.LEAD, legacy: "crm.lead.get" },
    contact: { typeId: ENTITY_TYPE.CONTACT, legacy: "crm.contact.get" },
  };
  const cfg = map[entity];
  if (!cfg) throw new Error(`Unsupported entity: ${entity}`);
  try {
    const result = await callReadMethod("crm.item.get", {
      entityTypeId: cfg.typeId,
      id: Number(id),
    });
    return result?.item || result;
  } catch {
    return callReadMethod(cfg.legacy, { id: Number(id) });
  }
}

function getField(entity, field) {
  if (!entity) return undefined;
  return entity[field] ?? entity[field.toUpperCase()] ?? entity[field.toLowerCase()];
}

function actionNameFor(entity) {
  if (entity === "deal") return "deal_update";
  if (entity === "lead") return "lead_update";
  if (entity === "contact") return "contact_update";
  throw new Error("unsupported");
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.entity || !args.id || !args.field) {
    console.log(`Usage:
  BITRIX_LIVE_SAFETY_TEST_ENABLED=true node scripts/smoke-test-safety-live.js --entity deal --id 123 --field COMMENTS [--test-conflict]

Allowed fields: ${[...ALLOWED_FIELDS].join(", ")}
Forbidden: STAGE_ID, ASSIGNED_BY_ID, OPPORTUNITY, links, delete, create, bulk.`);
    process.exit(args.help ? 0 : 1);
  }

  if (process.env.BITRIX_LIVE_SAFETY_TEST_ENABLED !== "true") {
    console.error("Set BITRIX_LIVE_SAFETY_TEST_ENABLED=true to run this script.");
    process.exit(1);
  }

  if (!ALLOWED_FIELDS.has(args.field)) {
    console.error(`Field ${args.field} is not in allowlist.`);
    process.exit(1);
  }

  for (const banned of ["STAGE_ID", "ASSIGNED_BY_ID", "OPPORTUNITY", "CATEGORY_ID", "CONTACT_ID", "COMPANY_ID"]) {
    if (args.field.toUpperCase() === banned) {
      console.error(`Field ${args.field} is forbidden for live smoke.`);
      process.exit(1);
    }
  }

  openDatabase();

  const entity = await fetchEntity(args.entity, args.id);
  const beforeValue = getField(entity, args.field);
  const title = entity?.TITLE || entity?.title || `${args.entity}#${args.id}`;

  console.log("=== Live safety smoke ===");
  console.log(`Entity: ${args.entity}`);
  console.log(`ID: ${args.id}`);
  console.log(`Title: ${title}`);
  console.log(`Field: ${args.field}`);
  console.log(`Current value: ${JSON.stringify(beforeValue)}`);

  const confirm = await ask('Type YES to continue: ');
  if (confirm.trim() !== "YES") {
    console.log("Aborted.");
    closeDatabase();
    process.exit(0);
  }

  const marker = `[safety-smoke ${new Date().toISOString()}]`;
  const action = actionNameFor(args.entity);

  const prepared = await prepareAction(
    action,
    { id: Number(args.id), fields: { [args.field]: marker } },
    { source: "live_smoke" }
  );

  if (!prepared.success && prepared.status !== "confirmation_required") {
    console.error("Prepare failed:", prepared);
    closeDatabase();
    process.exit(1);
  }

  const mid = await fetchEntity(args.entity, args.id);
  if (JSON.stringify(getField(mid, args.field)) !== JSON.stringify(beforeValue)) {
    console.error("FAIL: value changed during prepare");
    closeDatabase();
    process.exit(1);
  }
  console.log("OK: prepare did not change CRM");

  if (args.testConflict) {
    console.log("Change the field manually in Bitrix24 UI now.");
    await ask("Press Enter after manual change...");
    const conflictCommit = await commitAction(prepared.confirmationId, { source: "live_smoke" });
    if (conflictCommit.error?.code !== "OPERATION_STATE_CHANGED") {
      console.error("FAIL: expected OPERATION_STATE_CHANGED", conflictCommit);
      closeDatabase();
      process.exit(1);
    }
    const afterConflict = await fetchEntity(args.entity, args.id);
    console.log("OK: conflict stopped commit; current=", getField(afterConflict, args.field));
    closeDatabase();
    process.exit(0);
  }

  const committed = await commitAction(prepared.confirmationId, { source: "live_smoke" });
  if (!committed.success) {
    console.error("Commit failed:", committed);
    closeDatabase();
    process.exit(1);
  }

  const afterCommit = await fetchEntity(args.entity, args.id);
  if (getField(afterCommit, args.field) !== marker) {
    console.error("FAIL: value not updated after commit");
    closeDatabase();
    process.exit(1);
  }
  console.log("OK: commit applied");

  const second = await commitAction(prepared.confirmationId, { source: "live_smoke" });
  if (!second.idempotent) {
    console.error("FAIL: second commit not idempotent", second);
    closeDatabase();
    process.exit(1);
  }
  console.log("OK: second commit idempotent");

  const rbPrep = await prepareRollback(committed.operationId, { source: "live_smoke" });
  if (!rbPrep.success && rbPrep.status !== "confirmation_required") {
    console.error("Rollback prepare failed:", rbPrep);
    closeDatabase();
    process.exit(1);
  }

  const rbCommit = await commitRollback(rbPrep.confirmationId, { source: "live_smoke" });
  if (!rbCommit.success) {
    console.error("Rollback commit failed:", rbCommit);
    closeDatabase();
    process.exit(1);
  }

  const restored = await fetchEntity(args.entity, args.id);
  if (JSON.stringify(getField(restored, args.field)) !== JSON.stringify(beforeValue)) {
    console.error("FAIL: value not restored", {
      expected: beforeValue,
      actual: getField(restored, args.field),
    });
    closeDatabase();
    process.exit(1);
  }
  console.log("OK: rollback restored original value");

  const events = getOperationEvents(committed.operationId);
  const types = events.map((e) => e.eventType);
  console.log("Events:", types.join(", "));
  if (!types.includes("completed") && !types.includes("rolled_back")) {
    // original may have rolled_back status
    const op = getOperationById(committed.operationId);
    console.log("Operation status:", op?.status);
  }

  console.log("=== LIVE SMOKE PASSED ===");
  closeDatabase();
}

main().catch((error) => {
  console.error(error);
  try {
    closeDatabase();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
