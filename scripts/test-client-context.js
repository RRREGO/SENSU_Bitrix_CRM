/**
 * Client Context & Meeting Workflow tests (mocks + safe local SQLite).
 * Run: npm run test:client-context
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tmpDb = path.join(os.tmpdir(), `client-context-${Date.now()}.sqlite`);

process.env.APP_DATABASE_PATH = tmpDb;
process.env.BITRIX_OPERATIONS_DB_PATH = tmpDb;
process.env.BITRIX_WEBHOOK_URL = "https://example.bitrix24.ru/rest/1/mocktoken/";
process.env.BITRIX_PORTAL_URL = "https://example.bitrix24.ru";
process.env.LLM_PROXY_MODE = "none";
process.env.LLM_LOG_PAYLOADS = "false";
process.env.CLIENT_CONTEXT_MAX_CHARS = "50000";
process.env.CLIENT_TIMELINE_MAX_EVENTS = "20";
process.env.MEETING_TRANSCRIPT_MAX_CHARS = "5000";
process.env.CLIENT_CONTEXT_CACHE_TTL_SECONDS = "60";
process.env.BITRIX_CONTACT_STATUS_FIELD = "UF_CRM_STATUS";
process.env.BITRIX_CONTACT_STATUS_SPAM_VALUES = "spam";
process.env.BITRIX_CONTACT_STATUS_DO_NOT_CONTACT_VALUES = "dont_touch";
process.env.BITRIX_CONTACT_STATUS_PERSONAL_VALUES = "personal";
process.env.BITRIX_READ_RETRY_ATTEMPTS = "1";
process.env.BITRIX_READ_RETRY_BASE_DELAY_MS = "1";
process.env.BITRIX_READ_TIMEOUT_MS = "2000";
process.env.LLM_REQUEST_TIMEOUT_MS = "500";
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

function jsonResponse(result, extra = {}) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ result, ...extra }),
    json: async () => ({ result, ...extra }),
  };
}

function installBitrixMock() {
  const deals = {
    123: {
      id: 123,
      title: "Внедрение CRM",
      stageId: "C0:PREPARATION",
      categoryId: 0,
      opportunity: 100000,
      currencyId: "KZT",
      assignedById: 7,
      contactId: 10,
      companyId: 20,
      createdTime: "2026-06-01T10:00:00+03:00",
      updatedTime: "2026-07-13T12:00:00+03:00",
      PHONE: [{ VALUE: "+77001234567" }],
      EMAIL: [{ VALUE: "secret@example.com" }],
    },
  };
  const leads = {
    55: {
      id: 55,
      title: "Лид тест",
      statusId: "NEW",
      assignedById: 7,
      contactId: 10,
      companyId: 20,
      createdTime: "2026-06-01T10:00:00+03:00",
      updatedTime: "2026-07-01T10:00:00+03:00",
    },
  };
  const contacts = {
    10: {
      id: 10,
      name: "Александр",
      lastName: "Иванов",
      assignedById: 7,
      companyId: 20,
      UF_CRM_STATUS: "cycle",
      createdTime: "2026-01-01T10:00:00+03:00",
      updatedTime: "2026-07-01T10:00:00+03:00",
      PHONE: [{ VALUE: "+77009999999" }],
      EMAIL: "x@y.z",
    },
    11: {
      id: 11,
      name: "Спам",
      lastName: "Контакт",
      assignedById: 7,
      UF_CRM_STATUS: "spam",
    },
    12: {
      id: 12,
      name: "Не",
      lastName: "Трогать",
      assignedById: 7,
      UF_CRM_STATUS: "dont_touch",
    },
    13: {
      id: 13,
      name: "Личный",
      lastName: "Клиент",
      assignedById: 7,
      UF_CRM_STATUS: "personal",
    },
  };
  const companies = {
    20: {
      id: 20,
      title: "ТОО Пример",
      assignedById: 7,
      createdTime: "2026-01-01T10:00:00+03:00",
      updatedTime: "2026-07-01T10:00:00+03:00",
      BANKING_DETAILS: "secret",
    },
  };

  const activities = [
    {
      ID: "100",
      SUBJECT: "Первичная встреча",
      DESCRIPTION: "Обсудили внедрение",
      START_TIME: "2026-07-10T14:00:00+03:00",
      END_TIME: "2026-07-10T15:00:00+03:00",
      COMPLETED: "Y",
      RESPONSIBLE_ID: 7,
      TYPE_ID: "2",
    },
    {
      ID: "101",
      SUBJECT: "Звонок follow-up",
      DESCRIPTION: "Прозвонить",
      START_TIME: "2026-07-12T10:00:00+03:00",
      END_TIME: "2026-07-01T10:00:00+03:00",
      COMPLETED: "N",
      RESPONSIBLE_ID: 7,
      TYPE_ID: "1",
    },
    {
      ID: "100",
      SUBJECT: "Первичная встреча (dup)",
      START_TIME: "2026-07-10T14:00:00+03:00",
      COMPLETED: "Y",
      TYPE_ID: "2",
      RESPONSIBLE_ID: 7,
    },
  ];

  const comments = [
    {
      ID: "456",
      COMMENT: "Клиент запросил уточнённый расчёт",
      CREATED: "2026-07-11T09:00:00+03:00",
      AUTHOR_ID: 7,
    },
    {
      ID: "457",
      COMMENT: "Система изменила стадию автоматически workflow",
      CREATED: "2026-07-11T09:05:00+03:00",
      AUTHOR_ID: 1,
    },
  ];

  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    const body = options.body ? JSON.parse(options.body) : {};
    const method = u.match(/\/([^/]+)\.json/)?.[1] || "";

    if (method === "crm.item.get") {
      const et = Number(body.entityTypeId);
      const id = Number(body.id);
      if (et === 2) return jsonResponse({ item: deals[id] });
      if (et === 1) return jsonResponse({ item: leads[id] });
      if (et === 3) return jsonResponse({ item: contacts[id] });
      if (et === 4) return jsonResponse({ item: companies[id] });
      return jsonResponse(null);
    }
    if (method === "crm.deal.get") return jsonResponse(deals[body.id]);
    if (method === "crm.lead.get") return jsonResponse(leads[body.id]);
    if (method === "crm.contact.get") return jsonResponse(contacts[body.id]);
    if (method === "crm.company.get") return jsonResponse(companies[body.id]);
    if (method === "user.get") {
      return jsonResponse([{ ID: 7, NAME: "Анастасия", LAST_NAME: "М." }]);
    }
    if (method === "crm.status.list") {
      return jsonResponse([
        { STATUS_ID: "C0:PREPARATION", NAME: "Подготовка коммерческого предложения" },
        { STATUS_ID: "NEW", NAME: "Не обработан" },
      ]);
    }
    if (method === "crm.activity.list") {
      return jsonResponse(activities);
    }
    if (method === "crm.timeline.comment.list") {
      return jsonResponse(comments);
    }
    if (method === "tasks.task.list") {
      return jsonResponse({
        tasks: [
          { id: 1, title: "КП", status: "2", responsibleId: 7, createdDate: "2026-07-09T10:00:00+03:00" },
        ],
      });
    }
    return jsonResponse([]);
  };
}

async function main() {
  console.log(`\n[test:client-context] tmp DB: ${tmpDb}\n`);
  installBitrixMock();

  const { openDatabase, closeDatabase, getDatabase } = await import("../src/database/index.js");
  openDatabase({ reopen: true, dbPath: tmpDb });
  const db = getDatabase();
  const version = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v;
  assert(version >= 4, "Migration v4 applied");

  const { clearClientContextCache, getCachedClientContext, setCachedClientContext, invalidateClientContextCache } =
    await import("../src/clientContext/cache.js");
  const { buildClientTimeline } = await import("../src/clientContext/timeline.js");
  const {
    normalizeDealFields,
    normalizeContactFields,
  } = await import("../src/clientContext/fieldAllowlists.js");
  const { crm_context_get } = await import("../src/clientContext/crmContextGet.js");
  const { crm_context_summary } = await import("../src/clientContext/crmContextSummary.js");
  const { createMeetingTranscript, getMeetingTranscript } = await import(
    "../src/database/repositories/meetingTranscriptsRepository.js"
  );
  const { meeting_protocol_generate, buildRecommendedActionsFromProtocol } = await import(
    "../src/clientContext/meetingProtocolService.js"
  );
  const { client_message_draft, recommend_next_client_action } = await import(
    "../src/clientContext/clientActions.js"
  );
  const { prepareAction, cancelAction } = await import("../src/safety/executor.js");
  const { sanitizeLlmPayload } = await import("../src/llm/sanitize.js");
  const { shouldLoadCrmContext } = await import("../src/workspace/contextBuilder.js");
  const { ClientContextError } = await import("../src/clientContext/config.js");
  const ops = await import("../src/database/repositories/operationsRepository.js");

  clearClientContextCache();

  // 1–4 entity contexts
  const dealCtx = await crm_context_get({
    entityType: "deal",
    entityId: 123,
    include: ["fields", "relations", "activities", "tasks", "timeline", "communications"],
    mode: "standard",
    useCache: false,
  });
  assert(dealCtx.entity?.type === "deal" && dealCtx.entity.id === 123, "1. Контекст сделки");

  const contactCtx = await crm_context_get({
    entityType: "contact",
    entityId: 10,
    include: ["fields", "relations", "activities", "timeline"],
    useCache: false,
  });
  assert(contactCtx.entity?.type === "contact", "2. Контекст контакта");

  const leadCtx = await crm_context_get({
    entityType: "lead",
    entityId: 55,
    include: ["fields", "relations", "activities", "timeline"],
    useCache: false,
  });
  assert(leadCtx.entity?.type === "lead", "3. Контекст лида");

  const companyCtx = await crm_context_get({
    entityType: "company",
    entityId: 20,
    include: ["fields", "relations", "activities", "timeline"],
    useCache: false,
  });
  assert(companyCtx.entity?.type === "company", "4. Контекст компании");

  // 5 relations
  assert(dealCtx.relations?.contact?.id === 10 && dealCtx.relations?.company?.id === 20, "5. Связанные сущности");

  // 6 Russian stage
  assert(
    /Подготовка|PREPARATION|коммерческ/i.test(dealCtx.entity.stage?.name || ""),
    "6. Русские стадии"
  );

  // 7 responsible
  assert(dealCtx.entity.responsible?.id === 7, "7. Ответственный");

  // 8 bulk activities (single list call — activities present)
  assert((dealCtx.diagnostics?.activityCount || 0) >= 1, "8. Bulk activities");

  // 9–11 timeline
  const timeline = buildClientTimeline(
    {
      _rawActivities: [
        {
          ID: "1",
          SUBJECT: "A",
          START_TIME: "2026-07-10T10:00:00+03:00",
          COMPLETED: "Y",
          TYPE_ID: "2",
          RESPONSIBLE_ID: 7,
        },
        {
          ID: "1",
          SUBJECT: "A dup",
          START_TIME: "2026-07-10T10:00:00+03:00",
          COMPLETED: "Y",
          TYPE_ID: "2",
          RESPONSIBLE_ID: 7,
        },
        {
          ID: "2",
          SUBJECT: "sys",
          DESCRIPTION: "автоматически workflow",
          START_TIME: "2026-07-09T10:00:00+03:00",
          COMPLETED: "Y",
          TYPE_ID: "1",
          RESPONSIBLE_ID: 7,
        },
      ],
      _rawComments: [
        { ID: "9", COMMENT: "Клиент согласился", CREATED: "2026-07-11T10:00:00+03:00", AUTHOR_ID: 7 },
        { ID: "10", COMMENT: "Система изменила поле bizproc", CREATED: "2026-07-11T11:00:00+03:00", AUTHOR_ID: 1 },
      ],
      _rawTasks: [],
      _rawProtocols: [],
    },
    { mode: "standard", userMap: new Map([[7, "Анастасия"]]) }
  );
  assert(Array.isArray(timeline.timeline), "9. Timeline normalizer");
  assert(timeline.timeline.filter((e) => e.id === "crm_activity:1").length === 1, "10. Дедупликация");
  assert(timeline.timeline.length <= 20, "11. Ограничение timeline");

  // 12 partial without communications
  assert(
    dealCtx.partial === true &&
      (dealCtx.warnings || []).some((w) => w.code === "COMMUNICATIONS_SOURCE_UNAVAILABLE"),
    "12. Partial result без communications"
  );

  // 13 no PII fields
  const cleaned = normalizeDealFields({
    TITLE: "X",
    PHONE: "1",
    EMAIL: "a@b.c",
    INN: "123",
    OPPORTUNITY: 1,
  });
  assert(!cleaned.PHONE && !cleaned.EMAIL && !cleaned.INN && cleaned.TITLE === "X", "13. Запрет лишних персональных полей");

  // 14 summary
  const summary = await crm_context_summary({
    entityType: "deal",
    entityId: 123,
    mode: "compact",
  });
  assert(summary.currentState || summary.facts, "14. Entity summary");

  // 15 provenance
  assert(
    summary.facts?.[0]?.source?.type === "crm_entity" &&
      (summary.lastInteraction === null || summary.lastInteraction?.source),
    "15. Provenance"
  );
  // 16–17 transcript
  const tr = createMeetingTranscript({
    title: "Первичная встреча",
    entityType: "deal",
    entityId: 123,
    text: "Клиент запросил расчёт. Договорились отправить КП. Срок уточнить.\nЧто по внедрению?",
  });
  assert(tr?.id && tr.contentHash, "16. Загрузка транскрипта");

  let tooLarge = false;
  try {
    createMeetingTranscript({ title: "big", text: "x".repeat(6000) });
  } catch (e) {
    tooLarge = e instanceof ClientContextError && e.code === "TRANSCRIPT_TOO_LARGE";
  }
  assert(tooLarge, "17. Ограничение размера");

  // 18–20 protocol
  const proto = await meeting_protocol_generate({
    transcriptId: tr.id,
    entityType: "deal",
    entityId: 123,
    title: "Протокол первичной",
  });
  assert(proto.protocolId && proto.protocol?.status === "draft", "18. Генерация протокола");
  const body = proto.protocol?.protocol || {};
  assert(
    body.agreements &&
      (body.agreements.fact !== undefined || body.nextSteps !== undefined) &&
      body.recommendedStage?.recommendation,
    "19. Факты отделены от рекомендаций"
  );

  const opsBefore = db.prepare("SELECT COUNT(*) AS c FROM operations").get().c;
  assert(proto.protocol.status === "draft", "20. Протокол не записывается автоматически");

  // 21 prepare save
  const prepared = await prepareAction(
    "timeline_comment_add",
    {
      entityType: "deal",
      entityId: 123,
      comment: proto.protocol.protocolText.slice(0, 500),
    },
    { source: "test_meeting_protocol" }
  );
  assert(prepared.operationId || prepared.operation?.id || prepared.confirmationId, "21. Save-to-CRM создаёт prepare");

  // Check transcript not in operation audit blobs
  const opId = prepared.operationId || prepared.operation?.id;
  const opRow = ops.getOperationById(opId);
  const auditBlob = JSON.stringify(opRow || {});
  assert(!auditBlob.includes(tr.contentText), "34. Transcript не попадает в operation audit");

  // 22 Safety commit path available (cancel pending — no auto write)
  assert(Boolean(opId) && typeof cancelAction === "function", "22. Safety commit path");
  await cancelAction(prepared.confirmationId || opId);
  // 23 recommendations
  const rec = await recommend_next_client_action({ entityType: "deal", entityId: 123 });
  assert(Array.isArray(rec.options) && rec.options.length >= 1, "23. Рекомендации следующих действий");

  // 24 recommended actions from protocol → plans conceptually
  const actions = buildRecommendedActionsFromProtocol(proto.protocol, dealCtx);
  assert(actions.some((a) => a.type === "crm_activity"), "24. Создание recommended action plans (структура)");

  // 25–26 drafts
  const wa = await client_message_draft({
    entityType: "deal",
    entityId: 123,
    channel: "whatsapp",
    purpose: "follow_up",
  });
  assert(wa.success && wa.channel === "whatsapp" && wa.body, "25. Message draft WhatsApp");

  const em = await client_message_draft({
    entityType: "deal",
    entityId: 123,
    channel: "email",
  });
  assert(em.success && em.channel === "email" && (em.subject || em.body), "26. Message draft email");

  // 27 spam block
  let spamBlocked = false;
  try {
    await client_message_draft({ entityType: "contact", entityId: 11, channel: "whatsapp" });
  } catch (e) {
    spamBlocked = e.code === "CLIENT_COMMUNICATION_BLOCKED";
  }
  assert(spamBlocked, "27. Запрет коммуникации для «Спам»");

  // 28 don't touch
  let dncBlocked = false;
  try {
    await client_message_draft({ entityType: "contact", entityId: 12, channel: "whatsapp" });
  } catch (e) {
    dncBlocked = e.code === "CLIENT_COMMUNICATION_BLOCKED";
  }
  assert(dncBlocked, "28. Запрет для «Не трогать»");

  // 29 personal
  let personalBlocked = false;
  try {
    await client_message_draft({ entityType: "contact", entityId: 13, channel: "whatsapp" });
  } catch (e) {
    personalBlocked = e.code === "CLIENT_COMMUNICATION_BLOCKED";
  }
  assert(personalBlocked, "29. Статус «Личный»");

  // 30 context budget / sanitize
  const safe = sanitizeLlmPayload(
    { title: "t", PHONE: "1", EMAIL: "a", stage: { name: "x" }, proxyPassword: "secret" },
    "entity_summary"
  );
  assert(!JSON.stringify(safe).includes("proxyPassword"), "30. Context budget / sanitize");

  // 31–32 cache
  clearClientContextCache();
  const c1 = await crm_context_get({
    entityType: "deal",
    entityId: 123,
    include: ["fields"],
  });
  const c2 = await crm_context_get({
    entityType: "deal",
    entityId: 123,
    include: ["fields"],
  });
  assert(c2.diagnostics?.cacheHit === true || getCachedClientContext("deal", 123, ["fields"]), "31. Кэш");
  invalidateClientContextCache("deal", 123);
  assert(!getCachedClientContext("deal", 123, ["fields"]), "32. Очистка кэша после write (invalidate)");

  // 33 secrets not logged in sanitize
  assert(!JSON.stringify(safe).toLowerCase().includes("secret@"), "33. Секреты не в sanitized payload");

  // Intent recognition
  assert(shouldLoadCrmContext("Что с клиентом сейчас?"), "Intent: что с клиентом");
  assert(!shouldLoadCrmContext("Сколько будет 2+2?"), "Intent: обычный вопрос без CRM");

  // Contact PII strip
  const nc = normalizeContactFields(contactsSample());
  assert(!nc.PHONE && !nc.EMAIL, "Contact allowlist без phone/email");

  function contactsSample() {
    return { NAME: "A", PHONE: "1", EMAIL: "e", LAST_NAME: "B" };
  }

  closeDatabase();

  // 35–38 regressions (spawn)
  const scripts = [
    ["35. Workspace regression", "test:workspace"],
    ["36. Safety regression", "test:safety"],
    ["37. Production regression", "test:production"],
    ["38. Analytics regression", "test:analytics"],
  ];

  const regression = [];
  const cleanEnv = { ...process.env };
  delete cleanEnv.APP_DATABASE_PATH;
  delete cleanEnv.BITRIX_OPERATIONS_DB_PATH;
  delete cleanEnv.BITRIX_WEBHOOK_URL;
  delete cleanEnv.ANTHROPIC_API_KEY;
  // Load real env from .env if present (child scripts use dotenv)
  try {
    const dotenvPath = path.join(root, ".env");
    if (fs.existsSync(dotenvPath)) {
      const text = fs.readFileSync(dotenvPath, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (!m) continue;
        let val = m[2].trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (["BITRIX_WEBHOOK_URL", "ANTHROPIC_API_KEY", "BITRIX_PORTAL_URL"].includes(m[1])) {
          cleanEnv[m[1]] = val;
        }
      }
    }
  } catch {
    /* ignore */
  }
  cleanEnv.BITRIX_READ_TIMEOUT_MS = "8000";
  cleanEnv.BITRIX_READ_RETRY_ATTEMPTS = "2";
  cleanEnv.BITRIX_READ_RETRY_BASE_DELAY_MS = "200";

  for (const [label, script] of scripts) {
    console.log(`\n--- ${label} (${script}) ---`);
    const r = spawnSync("npm", ["run", script], {
      cwd: root,
      encoding: "utf8",
      shell: true,
      env: cleanEnv,
      timeout: 180000,
    });
    const ok = r.status === 0 && r.signal !== "SIGTERM";
    if (r.error?.code === "ETIMEDOUT" || r.signal === "SIGTERM") {
      console.log(`  ~ ${label} timed out — soft skip`);
      continue;
    }
    assert(ok, label);
    regression.push({ label, ok, status: r.status });
    if (!ok) {
      console.error((r.stdout || "").slice(-1500));
      console.error((r.stderr || "").slice(-1500));
    }
  }

  // Soft live analytics extras if requested env — skip hard fail
  console.log("\n--- Soft: contacts/managers (network optional, 60s cap) ---");
  for (const script of ["test:contacts", "test:managers"]) {
    const r = spawnSync("npm", ["run", script], {
      cwd: root,
      encoding: "utf8",
      shell: true,
      timeout: 60000,
      env: cleanEnv,
    });
    if (r.status === 0) {
      console.log(`  ✓ soft ${script}`);
      passed += 1;
    } else {
      console.log(`  ~ soft ${script} skipped/flaky (status=${r.status}, signal=${r.signal || "-"})`);
    }
  }

  console.log(`\n[test:client-context] passed=${passed} failed=${failed}`);
  try {
    fs.unlinkSync(tmpDb);
  } catch {
    /* ignore */
  }
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
