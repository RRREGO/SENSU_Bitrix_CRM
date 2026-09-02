/**
 * Тесты фильтра и разбивки лидов по стадиям (lead_count_by_stage).
 * Не ходит в живой Bitrix24 — мокает REST.
 *
 * Запуск: npm run test:lead-stage
 */
import { ENTITY_TYPE } from "../src/actions/helpers.js";

process.env.BITRIX_WEBHOOK_URL =
  process.env.BITRIX_WEBHOOK_URL || "https://example.bitrix24.ru/rest/1/testtoken/";

const {
  sanitizeBitrixFilter,
  normalizeItemFilter,
  normalizeItemSelect,
  extractLeadStatusId,
} = await import("../src/actions/helpers.js");

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

const STAGES = [
  { STATUS_ID: "NEW", NAME: "Не обработан", SORT: 10, SEMANTICS: "P" },
  { STATUS_ID: "IN_PROCESS", NAME: "В работе", SORT: 20, SEMANTICS: "P" },
  { STATUS_ID: "CONVERTED", NAME: "Качественный лид", SORT: 30, SEMANTICS: "S" },
  { STATUS_ID: "JUNK", NAME: "Некачественный лид", SORT: 40, SEMANTICS: "F" },
];

const COUNTS = {
  NEW: 12,
  IN_PROCESS: 30,
  CONVERTED: 100,
  JUNK: 66,
};

const bitrixCalls = [];

function jsonOk(payload) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  };
}

function installBitrixMock() {
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : {};
    const method = String(url).match(/\/([^/]+)\.json/)?.[1] || "";
    bitrixCalls.push({ method, body });

    if (method === "crm.status.list") {
      return jsonOk({ result: STAGES });
    }

    if (method === "crm.lead.list") {
      const filter = body.filter || {};
      const keys = Object.keys(filter);
      const semantic = keys.some((k) => /SEMANTIC/i.test(k));
      const badNotEqual = keys.some((k) => k.includes("≠") || k.startsWith("!="));
      if (semantic || badNotEqual) {
        return jsonOk({ result: [], total: 0 });
      }
      const statusId = filter.STATUS_ID;
      const total = COUNTS[statusId] ?? 0;
      return jsonOk({
        result: total ? [{ ID: 1, STATUS_ID: statusId }] : [],
        total,
      });
    }

    if (method === "crm.item.list") {
      return jsonOk({
        result: { items: [{ id: 1, stageId: "NEW" }] },
        total: 1,
      });
    }

    return jsonOk({ result: [], total: 0 });
  };
}

console.log("=== lead_count_by_stage / Bitrix filter ===\n");

console.log("sanitizeBitrixFilter");
{
  const neq = sanitizeBitrixFilter({ "≠STATUSID": "JUNK" });
  assert(neq["!STATUS_ID"] === "JUNK", "≠STATUSID → !STATUS_ID");
  assert(!Object.keys(neq).some((k) => k.includes("≠")), "ключ без ≠");

  const ne = sanitizeBitrixFilter({ "!=STATUS_ID": "CONVERTED" });
  assert(ne["!STATUS_ID"] === "CONVERTED", "!=STATUS_ID → !STATUS_ID");

  const compact = sanitizeBitrixFilter({ STATUSID: "NEW" });
  assert(compact.STATUS_ID === "NEW", "STATUSID → STATUS_ID");

  const entity = sanitizeBitrixFilter({ ENTITYID: "STATUS" });
  assert(entity.ENTITY_ID === "STATUS", "ENTITYID → ENTITY_ID");

  const already = sanitizeBitrixFilter({ "!STATUS_ID": "JUNK" });
  assert(already["!STATUS_ID"] === "JUNK", "!STATUS_ID сохраняется");

  const empty = sanitizeBitrixFilter({});
  assert(Object.keys(empty).length === 0, "пустой фильтр остаётся пустым");
}

console.log("\nnormalizeItemFilter (лиды)");
{
  const mapped = normalizeItemFilter({ STATUS_ID: "NEW" }, { entityTypeId: ENTITY_TYPE.LEAD });
  assert(mapped.stageId === "NEW", "для лидов STATUS_ID → stageId в crm.item.list");
  assert(mapped.statusId === undefined, "statusId не используется для стадий лида");

  const notEq = normalizeItemFilter({ "≠STATUSID": "JUNK" }, { entityTypeId: ENTITY_TYPE.LEAD });
  assert(notEq["!stageId"] === "JUNK", "≠STATUSID → !stageId для crm.item.list лидов");

  const select = normalizeItemSelect(["STATUS_ID", "ID"], { entityTypeId: ENTITY_TYPE.LEAD });
  assert(select.includes("stageId"), "select STATUS_ID → stageId");
  assert(select.includes("id"), "select ID → id");

  const deal = normalizeItemFilter({ STAGE_ID: "NEW" }, { entityTypeId: ENTITY_TYPE.DEAL });
  assert(deal.stageId === "NEW", "для сделок STAGE_ID → stageId");
}

console.log("\nextractLeadStatusId");
{
  assert(extractLeadStatusId({ STATUS_ID: "NEW" }) === "NEW", "legacy STATUS_ID");
  assert(extractLeadStatusId({ statusId: "IN_PROCESS" }) === "IN_PROCESS", "statusId");
  assert(extractLeadStatusId({ stageId: "CONVERTED" }) === "CONVERTED", "crm.item stageId");
  assert(extractLeadStatusId({ item: { STATUSID: "JUNK" } }) === "JUNK", "обёртка item + STATUSID");
}

console.log("\nlead_count_by_stage");
installBitrixMock();
const { lead_count_by_stage } = await import("../src/actions/analyticsActions.js");
const rows = await lead_count_by_stage();

const statusCall = bitrixCalls.find((c) => c.method === "crm.status.list");
assert(Boolean(statusCall), "вызывается crm.status.list");
assert(statusCall?.body?.filter?.ENTITY_ID === "STATUS", "ENTITY_ID=STATUS");

const itemCalls = bitrixCalls.filter((c) => c.method === "crm.item.list");
assert(itemCalls.length === 0, "crm.item.list не используется", `calls=${itemCalls.length}`);

const leadListCalls = bitrixCalls.filter((c) => c.method === "crm.lead.list");
assert(leadListCalls.length === STAGES.length, "отдельный crm.lead.list на каждую стадию", `calls=${leadListCalls.length}`);

for (const call of leadListCalls) {
  const filter = call.body.filter || {};
  const keys = Object.keys(filter);
  assert(keys.length === 1 && keys[0] === "STATUS_ID", "фильтр только STATUS_ID", JSON.stringify(filter));
  assert(!("STATUS_SEMANTIC_ID" in filter), "нет скрытого STATUS_SEMANTIC_ID");
  assert(!keys.some((k) => k.includes("≠") || k.startsWith("!=")), "нет операторов ≠ / !=");
}

assert(Array.isArray(rows) && rows.length === 4, "четыре стадии в результате");
const byId = Object.fromEntries(rows.map((r) => [r.stageId, r]));
assert(byId.NEW?.count === 12, "NEW=12");
assert(byId.IN_PROCESS?.count === 30, "IN_PROCESS=30");
assert(byId.CONVERTED?.count === 100, "CONVERTED не отсечён как закрытый");
assert(byId.JUNK?.count === 66, "JUNK не отсечён как закрытый");
assert(
  rows.reduce((s, r) => s + r.count, 0) === 208,
  "сумма по стадиям 208",
  `sum=${rows.reduce((s, r) => s + r.count, 0)}`
);
assert(byId.CONVERTED?.stageName === "Качественный лид", "имя стадии из crm.status.list");

console.log(`\n=== Итого: passed=${passed} failed=${failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
