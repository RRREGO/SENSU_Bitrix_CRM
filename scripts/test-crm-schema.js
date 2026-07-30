/**
 * CRM schema registry tests (tmp SQLite, mocked Bitrix reads).
 * npm run test:crm-schema
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tmpDb = path.join(os.tmpdir(), `crm-schema-test-${Date.now()}.sqlite`);

process.env.APP_DATABASE_PATH = tmpDb;
process.env.BITRIX_OPERATIONS_DB_PATH = tmpDb;
process.env.APP_ACCESS_MODE = "authenticated";
process.env.CRM_SCHEMA_CONFIG_DIR = path.join(root, "config", "crm");
process.env.SCHEDULER_ENABLED = "false";
process.env.COMMUNICATION_SEND_ENABLED = "false";
process.env.NODE_ENV = "test";

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

async function main() {
  console.log(`\n[test:crm-schema] tmp DB: ${tmpDb}\n`);

  const { openDatabase, closeDatabase, getDatabase } = await import(
    "../src/database/index.js"
  );
  openDatabase({ reopen: true, dbPath: tmpDb });

  const version = getDatabase()
    .prepare("SELECT MAX(version) AS v FROM schema_migrations")
    .get()?.v;
  assert(version >= 14, "16. Миграция v14 применена (обратная совместимость)");

  const tables = [
    "crm_schema_snapshots",
    "crm_field_definitions",
    "crm_field_enum_values",
    "crm_pipeline_definitions",
    "crm_stage_definitions",
    "crm_stage_requirements",
    "crm_stage_mappings",
    "crm_process_rules",
  ];
  for (const t of tables) {
    const row = getDatabase()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(t);
    assert(Boolean(row), `таблица ${t} существует`);
  }

  const {
    importAllSeedConfigs,
    loadSeedSchema,
    calculateSchemaHash,
    saveSnapshot,
    capturePortalSchema,
  } = await import("../src/crmSchema/snapshotService.js");
  const { SOURCE_TYPES } = await import("../src/crmSchema/configLoader.js");
  const { compareSnapshots } = await import("../src/crmSchema/diffService.js");
  const {
    mapStageBetweenPortals,
    mapEnumValueBetweenPortals,
  } = await import("../src/crmSchema/processKnowledgeService.js");
  const repo = await import("../src/database/repositories/crmSchemaRepository.js");
  const { redactObject } = await import("../src/safety/redact.js");

  // 1. Import seed configs
  const import1 = importAllSeedConfigs();
  const twiga = import1.find((r) => r.sourceType === SOURCE_TYPES.EXCEL_TWIGA);
  const sensu = import1.find((r) => r.sourceType === SOURCE_TYPES.EXCEL_SENSU);
  assert(twiga?.created === true && twiga.snapshotId, "1. Импорт seed TWIGA");
  assert(sensu?.created === true && sensu.snapshotId, "1b. Импорт seed SENSU");

  const twigaFields = repo.listFields({ snapshotId: twiga.snapshotId });
  assert(twigaFields.length >= 40, "1c. TWIGA fields загружены");
  const sensuStages = repo.listStages({
    snapshotId: sensu.snapshotId,
    entityType: "lead",
  });
  assert(
    sensuStages.some((s) => s.stageName === "Готовность ко встрече"),
    "1d. SENSU lead stages импортированы"
  );

  // 2. Idempotent import
  const import2 = importAllSeedConfigs();
  const twiga2 = import2.find((r) => r.sourceType === SOURCE_TYPES.EXCEL_TWIGA);
  assert(twiga2?.created === false, "2. Идемпотентность импорта TWIGA");
  assert(twiga2.snapshotId === twiga.snapshotId, "2b. Тот же snapshot id");

  // 3. Snapshot versioning
  const payload = loadSeedSchema(SOURCE_TYPES.EXCEL_TWIGA);
  const hash1 = calculateSchemaHash(payload);
  const forced = saveSnapshot(
    { ...payload, schemaVersion: "twiga-forced-v2" },
    { forceNew: true }
  );
  assert(forced.created === true, "3. Версионирование snapshot (forceNew)");
  assert(forced.snapshot.id !== twiga.snapshotId, "3b. Новый snapshot id");
  assert(forced.contentHash === hash1, "3c. Hash стабилен при том же содержимом");

  // Build mutated snapshot for diff tests
  const mutated = {
    ...payload,
    portalKey: "twiga",
    sourceType: "excel_twiga",
    schemaVersion: "twiga-mutated",
    fields: payload.fields
      .filter((f) => f.fieldCode !== "UF_CRM_1727864870")
      .map((f) => {
        if (f.fieldCode === "OPPORTUNITY") {
          return { ...f, dataType: "string" };
        }
        if (f.fieldCode === "UF_CRM_64FA17C1E8AD3") {
          return {
            ...f,
            enums: (f.enums || []).map((e) =>
              e.enumId === "401" ? { ...e, value: "Sens Renamed" } : e
            ),
          };
        }
        return f;
      }),
    pipelines: payload.pipelines.map((p) => {
      if (p.entityType !== "deal") return p;
      return {
        ...p,
        stages: (p.stages || []).filter((s) => s.stageId !== "PREPARATION"),
      };
    }),
  };
  const mutatedSaved = saveSnapshot(mutated, { forceNew: true });

  // 4. Schema compare
  const diff = compareSnapshots(twiga.snapshotId, mutatedSaved.snapshot.id);
  assert(diff.summary != null, "4. Сравнение схем возвращает summary");

  // 5. Missing field
  assert(
    diff.missingFields.some((x) => x.fieldCode === "UF_CRM_1727864870"),
    "5. Обнаружение отсутствующего поля"
  );

  // 6. Changed type
  assert(
    diff.changedTypes.some((x) => x.fieldCode === "OPPORTUNITY"),
    "6. Обнаружение изменения типа"
  );

  // 7. Changed enum
  assert(
    diff.changedEnums.some((x) => x.fieldCode === "UF_CRM_64FA17C1E8AD3"),
    "7. Обнаружение изменения enum"
  );

  // 8. Missing stage
  assert(
    diff.missingStages.some((x) => x.stageId === "PREPARATION"),
    "8. Обнаружение отсутствующей стадии"
  );

  // 9. Different market enum IDs across entities
  const marketDeal = repo.listEnumsByCanonical({
    snapshotId: twiga.snapshotId,
    portalKey: "twiga",
    entityType: "deal",
    canonicalKey: "market",
  });
  const marketLead = repo.listEnumsByCanonical({
    snapshotId: twiga.snapshotId,
    portalKey: "twiga",
    entityType: "lead",
    canonicalKey: "market",
  });
  const dealIds = new Set(marketDeal.map((e) => e.enumId));
  const leadIds = new Set(marketLead.map((e) => e.enumId));
  const overlap = [...dealIds].filter((id) => leadIds.has(id));
  assert(marketDeal.length > 0 && marketLead.length > 0, "9a. Market enums существуют");
  assert(overlap.length === 0, "9. Различающиеся ID одинакового рынка в разных сущностях");

  const mapped = mapEnumValueBetweenPortals({
    canonicalKey: "market",
    canonicalValue: "market.ru",
    sourcePortal: "twiga",
    sourceEntityType: "deal",
    sourceEnumId: "101",
    targetPortal: "twiga",
    targetEntityType: "lead",
  });
  assert(mapped.found && mapped.target.enumId === "201", "9b. Mapping market через canonical_value");

  // 10. Stage mapping SENSU ↔ TWIGA
  const stageMap = mapStageBetweenPortals({
    sourcePortal: "sensu",
    sourceStageId: "SENSU_L_TARGET",
    targetPortal: "twiga",
  });
  assert(
    stageMap.found &&
      stageMap.targetStageId === "NEW" &&
      stageMap.verificationStatus === "draft",
    "10. Mapping стадий SENSU и TWIGA (draft)"
  );

  // 11. RBAC for snapshot capture
  const { ensureSystemRoles, hasPermission, loadUserPrincipal } = await import(
    "../src/auth/authorizationService.js"
  );
  const { bootstrapAdminIfNeeded } = await import("../src/auth/bootstrapAdmin.js");
  process.env.APP_BOOTSTRAP_ADMIN_USERNAME = "admin";
  process.env.APP_BOOTSTRAP_ADMIN_PASSWORD = "Str0ng!CrmSchema#99";
  process.env.APP_BOOTSTRAP_ADMIN_DISPLAY_NAME = "Admin";
  ensureSystemRoles();
  await bootstrapAdminIfNeeded();

  const adminUser = getDatabase()
    .prepare("SELECT * FROM app_users WHERE username = ?")
    .get("admin");
  const adminPrincipal = loadUserPrincipal(adminUser.id);
  assert(
    hasPermission(adminPrincipal, "crm.schema.capture"),
    "11. Админ имеет crm.schema.capture"
  );

  // Create viewer-like principal without capture
  const viewerRole = getDatabase()
    .prepare("SELECT * FROM app_roles WHERE code = ?")
    .get("viewer");
  const viewerPerms = new Set(
    getDatabase()
      .prepare("SELECT permission FROM role_permissions WHERE role_id = ?")
      .all(viewerRole.id)
      .map((r) => r.permission)
  );
  assert(
    !viewerPerms.has("crm.schema.capture"),
    "11b. Viewer не имеет crm.schema.capture"
  );
  assert(
    hasPermission(adminPrincipal, "crm.schema.read"),
    "11c. Админ имеет crm.schema.read"
  );

  // 12. No Bitrix write calls during capture
  const { isWriteMethod } = await import("../src/safety/writeMethods.js");
  const captureMethods = [
    "crm.item.fields",
    "crm.lead.fields",
    "crm.deal.fields",
    "crm.contact.fields",
    "crm.company.fields",
    "crm.category.list",
    "crm.status.list",
  ];
  assert(
    captureMethods.every((m) => !isWriteMethod(m)),
    "12. Capture methods классифицированы как read (нет write)"
  );

  const writeCalls = [];
  const readCalls = [];
  const mockApi = {
    callReadMethod: async (method, params) => {
      if (isWriteMethod(method)) {
        writeCalls.push(method);
        throw new Error(`Unexpected write: ${method}`);
      }
      readCalls.push(method);
      return mockBitrixRead(method, params);
    },
    callBitrixMethodFull: async (method, params) => {
      if (isWriteMethod(method)) {
        writeCalls.push(method);
        throw new Error(`Unexpected write: ${method}`);
      }
      readCalls.push(method);
      const result = mockBitrixRead(method, params);
      return {
        result,
        next: null,
        total: Array.isArray(result) ? result.length : null,
      };
    },
    callWriteMethod: async (method) => {
      writeCalls.push(method);
      throw new Error(`Unexpected write: ${method}`);
    },
  };

  const captured = await capturePortalSchema("sensu-test", { bitrixApi: mockApi });
  assert(captured.created === true, "12b. Live capture создаёт snapshot");
  assert(writeCalls.length === 0, "12c. Отсутствие любых Bitrix write calls");
  assert(readCalls.length > 0, "12d. Были read calls");
  assert(
    !readCalls.some((m) => isWriteMethod(m)),
    "12e. Среди вызовов нет write-методов"
  );

  // 13. Webhook/token redaction in logs/metadata
  const redacted = redactObject({
    BITRIX_WEBHOOK_URL: "https://example.bitrix24.ru/rest/1/abcsecrettoken/",
    token: "secret-token-value",
    portalKey: "sensu",
    nested: { apiKey: "sk-ant-xxx", ok: true },
  });
  assert(
    redacted.BITRIX_WEBHOOK_URL === "[redacted]" &&
      redacted.token === "[redacted]" &&
      redacted.nested.apiKey === "[redacted]" &&
      redacted.portalKey === "sensu",
    "13. Редактирование webhook/token в объектах отчёта"
  );

  // 14. Pagination support (fetchAllPages + status list mock with next)
  const { fetchAllPages } = await import("../src/actions/helpers.js");
  let pageStarts = [];
  const paged = await fetchAllPages({
    actionName: "test-pagination",
    maxPages: 10,
    fetchPage: async (start) => {
      pageStarts.push(start);
      if (start === 0) {
        return {
          items: Array.from({ length: 50 }, (_, i) => ({ ID: i + 1 })),
          next: 50,
          total: 75,
        };
      }
      return {
        items: Array.from({ length: 25 }, (_, i) => ({ ID: 51 + i })),
        next: null,
        total: 75,
      };
    },
  });
  assert(pageStarts.includes(0) && pageStarts.includes(50), "14. Пагинация (несколько страниц)");
  assert(paged.items.length === 75, "14b. Все элементы собраны");

  // 15. Multiple deal categories
  writeCalls.length = 0;
  readCalls.length = 0;
  const multiApi = {
    callReadMethod: async (method, params) => {
      if (isWriteMethod(method)) {
        writeCalls.push(method);
        throw new Error(`Unexpected write: ${method}`);
      }
      readCalls.push(method);
      return mockBitrixReadMultiCategory(method, params);
    },
    callBitrixMethodFull: async (method, params) => {
      if (isWriteMethod(method)) {
        writeCalls.push(method);
        throw new Error(`Unexpected write: ${method}`);
      }
      readCalls.push(method);
      const result = mockBitrixReadMultiCategory(method, params);
      return {
        result,
        next: null,
        total: Array.isArray(result) ? result.length : null,
      };
    },
  };
  const multi = await capturePortalSchema("sensu-multi", { bitrixApi: multiApi });
  const pipelines = repo.listPipelines({
    snapshotId: multi.snapshot.id,
    entityType: "deal",
  });
  assert(pipelines.length >= 2, "15. Работа с несколькими deal categories");
  assert(writeCalls.length === 0, "15b. Multi-category capture без write");

  // BI compatibility note
  const biDiff = compareSnapshots(twiga.snapshotId, sensu.snapshotId);
  assert(
    biDiff.biCompatibility != null && biDiff.summary.biCompatibilityProblems >= 0,
    "BI compatibility diff доступен"
  );

  console.log(`\n[test:crm-schema] passed=${passed} failed=${failed}\n`);
  try {
    closeDatabase();
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(tmpDb);
  } catch {
    /* ignore */
  }

  if (failed > 0) process.exit(1);
}

function mockBitrixRead(method, params = {}) {
  if (method === "crm.item.fields" || method.endsWith(".fields")) {
    return {
      fields: {
        ID: { type: "integer", isRequired: true, isReadOnly: true, title: "ID" },
        TITLE: { type: "string", title: "Title" },
        UF_CRM_TEST: {
          type: "enumeration",
          userTypeId: "enumeration",
          title: "Test enum",
          items: [
            { ID: "1", VALUE: "A", SORT: 10 },
            { ID: "2", VALUE: "B", SORT: 20 },
          ],
        },
      },
    };
  }
  if (method === "crm.category.list") {
    return { categories: [{ id: 0, name: "General", isDefault: true }] };
  }
  if (method === "crm.status.list") {
    const entityId = params.filter?.ENTITY_ID;
    if (entityId === "STATUS") {
      return [
        { STATUS_ID: "NEW", NAME: "Target", SORT: 10, SEMANTICS: null },
        { STATUS_ID: "CONVERTED", NAME: "Успешный лид", SORT: 20, SEMANTICS: "S" },
      ];
    }
    return [
      { STATUS_ID: "NEW", NAME: "NDA", SORT: 10 },
      { STATUS_ID: "WON", NAME: "Контракт на проект", SORT: 20, SEMANTICS: "S" },
      { STATUS_ID: "LOSE", NAME: "Сделка провалена", SORT: 30, SEMANTICS: "F" },
    ];
  }
  return {};
}

function mockBitrixReadMultiCategory(method, params = {}) {
  if (method === "crm.category.list") {
    return {
      categories: [
        { id: 0, name: "Main", isDefault: true },
        { id: 5, name: "Secondary", isDefault: false },
      ],
    };
  }
  if (method === "crm.status.list") {
    const entityId = params.filter?.ENTITY_ID || "";
    if (String(entityId).includes("5")) {
      return [
        { STATUS_ID: "C5:NEW", NAME: "Cat5 New", SORT: 10 },
        { STATUS_ID: "C5:WON", NAME: "Cat5 Won", SORT: 20, SEMANTICS: "S" },
      ];
    }
    return mockBitrixRead(method, params);
  }
  return mockBitrixRead(method, params);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
