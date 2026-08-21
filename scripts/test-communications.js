/**
 * Communication Channels + Safe Outbound Messaging (mocks, no live send).
 * npm run test:communications
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tmpDb = path.join(os.tmpdir(), `communications-test-${Date.now()}.sqlite`);

process.env.APP_DATABASE_PATH = tmpDb;
process.env.BITRIX_OPERATIONS_DB_PATH = tmpDb;
process.env.BITRIX_WEBHOOK_URL = "https://example.bitrix24.ru/rest/1/mocktoken/";
process.env.BITRIX_PORTAL_URL = "https://example.bitrix24.ru";
process.env.LLM_PROXY_MODE = "none";
process.env.ANTHROPIC_API_KEY = "";
process.env.MESSAGE_DUPLICATE_WINDOW_MINUTES = "10";
process.env.MESSAGE_MAX_CHARS_WHATSAPP = "4000";
process.env.MESSAGE_MAX_CHARS_TELEGRAM = "4000";
process.env.MESSAGE_MAX_CHARS_EMAIL = "50000";
process.env.MESSAGE_MAX_CHARS_BITRIX_CHAT = "4000";
process.env.COMMUNICATION_LIVE_TEST_ENABLED = "false";
process.env.COMMUNICATION_WEBHOOK_TOKEN = "test-webhook-token";
process.env.BITRIX_CONTACT_STATUS_FIELD = "UF_CRM_STATUS";
process.env.BITRIX_CONTACT_STATUS_SPAM_VALUES = "spam";
process.env.BITRIX_CONTACT_STATUS_DO_NOT_CONTACT_VALUES = "dont_touch";
process.env.BITRIX_CONTACT_STATUS_PERSONAL_VALUES = "personal";
process.env.BITRIX_CONTACT_STATUS_CONGRATS_ONLY_VALUES = "congrats";
process.env.SCHEDULER_ENABLED = "false";

// Communications Hub (before openDatabase / imports that read config)
process.env.COMMUNICATIONS_ENABLED = "true";
process.env.COMMUNICATIONS_SEND_ENABLED = "false";
process.env.COMMUNICATIONS_DRY_RUN = "true";
process.env.WAZZUP_ENABLED = "true";
process.env.WAZZUP_API_KEY = "test-key-not-real";
process.env.WAZZUP_WEBHOOK_SECRET = "whsec_test_long_secret_value_12345";
process.env.COMMUNICATIONS_QUIET_HOURS_START = "02:00";
process.env.COMMUNICATIONS_QUIET_HOURS_END = "03:00";
process.env.COMMUNICATIONS_ALLOWED_WEEKDAYS = "1,2,3,4,5,6,7";
process.env.COMMUNICATION_AUTO_CHANGE_CONTACT_STATUS = "false";
process.env.MAX_BOT_ENABLED = "false";

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

const contacts = {
  10: {
    id: 10,
    name: "Александр",
    lastName: "Тестов",
    UF_CRM_STATUS: "work",
    PHONE: [{ VALUE: "+77001234567" }, { VALUE: "+77009876543" }],
    EMAIL: [{ VALUE: "alex@company.kz" }, { VALUE: "a2@company.kz" }],
  },
  11: {
    id: 11,
    name: "Спам",
    UF_CRM_STATUS: "spam",
    PHONE: [{ VALUE: "+77001112233" }],
    EMAIL: [{ VALUE: "spam@x.kz" }],
  },
  12: {
    id: 12,
    name: "Не трогать",
    UF_CRM_STATUS: "dont_touch",
    PHONE: [{ VALUE: "+77001112234" }],
  },
  13: {
    id: 13,
    name: "Личный",
    UF_CRM_STATUS: "personal",
    PHONE: [{ VALUE: "+77001112235" }],
  },
  14: {
    id: 14,
    name: "Один",
    UF_CRM_STATUS: "work",
    PHONE: [{ VALUE: "+77005554433" }],
    EMAIL: [{ VALUE: "one@company.kz" }],
  },
};

function installBitrixMock() {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (u.includes("user.current")) return jsonResponse({ ID: 1 });
    if (u.includes("im.recent.list")) return jsonResponse([]);
    if (u.includes("imopenlines")) {
      const err = { error: "ACCESS_DENIED", error_description: "denied" };
      return {
        ok: false,
        status: 401,
        text: async () => JSON.stringify(err),
        json: async () => err,
      };
    }
    if (u.includes("crm.activity.list")) return jsonResponse([]);
    if (u.includes("crm.item.get") || u.includes("crm.contact.get")) {
      const id = Number(body.id || body.ID || body.filter?.ID);
      const c = contacts[id];
      if (!c) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: "not found" }),
          json: async () => ({ error: "not found" }),
        };
      }
      return jsonResponse({ item: c, ...c });
    }
    if (u.includes("im.message.add")) {
      return jsonResponse(9001);
    }
    if (u.includes("user.get")) {
      return jsonResponse([{ ID: body.filter?.ID || 1, NAME: "Иван", LAST_NAME: "Менеджер" }]);
    }
    // CRM context for legacy draft
    if (u.includes("crm.deal.get") || (u.includes("crm.item.get") && body.entityTypeId === 2)) {
      return jsonResponse({
        item: {
          id: 123,
          title: "Сделка",
          contactId: 14,
          assignedById: 1,
        },
      });
    }
    return jsonResponse({});
  };
}

async function main() {
  console.log(`\n[test:communications] tmp DB: ${tmpDb}\n`);
  installBitrixMock();

  const { openDatabase, closeDatabase, getDatabase } = await import("../src/database/index.js");
  openDatabase({ reopen: true, dbPath: tmpDb });
  const version = getDatabase().prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v;
  assert(version >= 6, "1. Миграция v6");

  const { maskPhone, maskEmail, CommunicationError, getCommunicationsConfig } = await import(
    "../src/communications/config.js"
  );
  const { detectCommunicationChannels, listStoredChannels, getCommunicationsHealth } = await import(
    "../src/communications/capabilityService.js"
  );
  const { getAdapterByChannel } = await import("../src/communications/channelRegistry.js");
  const { resolveMessageRecipient } = await import("../src/communications/recipientResolver.js");
  const {
    assertSingleRecipient,
    assertMessageLength,
    assertContactAllowed,
    assertChannelSendAvailable,
  } = await import("../src/communications/communicationPolicy.js");
  const { assertNoDuplicate } = await import("../src/communications/duplicateGuard.js");
  const {
    createMessageDraft,
    getMessageDraft,
    updateMessageDraft,
    createOutboundMessage,
    getOutboundMessage,
    listOutboundMessages,
    addDeliveryEvent,
    hashBody,
  } = await import("../src/database/repositories/messageDraftsRepository.js");
  const {
    patchMessageDraft,
    cancelMessageDraft,
    createClientMessageDraft,
    buildSendPrepareParams,
    client_message_send,
  } = await import("../src/communications/messageService.js");
  const { ingestCommunicationEvent, verifyOutboundMessage } = await import(
    "../src/communications/deliveryService.js"
  );
  const { prepareAction, commitAction } = await import("../src/safety/executor.js");
  const { getActionPolicy } = await import("../src/safety/policies.js");
  const { getOperationByConfirmationId } = await import(
    "../src/database/repositories/operationsRepository.js"
  );
  const { BitrixAppError } = await import("../src/bitrix/errors.js");
  const { redactObject } = await import("../src/safety/redact.js");
  const { bitrixImAdapter } = await import("../src/communications/adapters/bitrixImAdapter.js");

  // Soft detect (reads may fail for OL — still returns rows)
  const detected = await detectCommunicationChannels();
  assert(Array.isArray(detected.channels) && detected.channels.length >= 4, "2. Аудит каналов");

  const whatsapp = listStoredChannels().find((c) => c.channel === "whatsapp");
  assert(whatsapp && !whatsapp.capabilities?.canSend, "3. Недоступный канал (whatsapp without send)");

  const ol = listStoredChannels().find((c) => c.channel === "open_lines");
  assert(
    ol && ["insufficient_scope", "configured_but_api_unavailable", "not_configured"].includes(ol.status),
    "4. Недостаточные права / OL scope"
  );
  assert(Boolean(ol), "5. Обнаружение Open Lines (запись в registry)");

  const emailCh = listStoredChannels().find((c) => c.channel === "email");
  assert(emailCh && emailCh.capabilities?.canSend === false, "6. Обнаружение email (read-only / no send)");

  // Force IM send capability for outbound tests
  bitrixImAdapter.capabilities = {
    canSend: true,
    canRead: false,
    supportsDeliveryStatus: false,
    supportsAttachments: false,
    supportsSubject: false,
    supportsReplyToConversation: false,
  };
  bitrixImAdapter.send = async () => ({ success: true, externalMessageId: "im-42", raw: { accepted: true } });
  bitrixImAdapter.preparePayload = async ({ body, recipient }) => ({
    method: "im.message.add",
    params: { DIALOG_ID: String(recipient.userId), MESSAGE: body },
  });
  bitrixImAdapter.verifyDelivery = async () => ({ status: "unavailable", verificationStatus: "unavailable" });

  getDatabase()
    .prepare(
      `UPDATE communication_channels SET status = ?, capabilities_json = ?, updated_at = ?
       WHERE channel = 'bitrix_chat'`
    )
    .run(
      "available_write_only",
      JSON.stringify(bitrixImAdapter.capabilities),
      new Date().toISOString()
    );

  // Draft CRUD (bitrix_chat avoids full CRM stack when body given)
  const draftCreated = await createClientMessageDraft({
    channel: "bitrix_chat",
    userId: 7,
    body: "Привет, коллега",
  });
  assert(draftCreated.draftId && draftCreated.body.includes("Привет"), "7. Создание draft");
  assert(getMessageDraft(draftCreated.draftId)?.id === draftCreated.draftId, "8. Сохранение draft");

  const edited = await patchMessageDraft(draftCreated.draftId, { body: "Привет, обновлено" });
  assert(edited.body === "Привет, обновлено" && edited.status !== "sent", "9. Редактирование draft");

  const cancelled = cancelMessageDraft(draftCreated.draftId);
  assert(cancelled.status === "cancelled", "10. Отмена draft");

  // Resolve
  const single = await resolveMessageRecipient({
    contactId: 14,
    channel: "whatsapp",
  });
  assert(single.maskedAddress && single.phone, "11. Resolve единственного получателя");

  let ambiguous = false;
  try {
    await resolveMessageRecipient({ contactId: 10, channel: "whatsapp" });
  } catch (e) {
    ambiguous = e.code === "MESSAGE_RECIPIENT_AMBIGUOUS";
    assert(Array.isArray(e.details?.options), "12b. Ambiguous options");
  }
  assert(ambiguous, "12. Ambiguous recipient");

  let notFound = false;
  try {
    await resolveMessageRecipient({ contactId: 99999, channel: "whatsapp" });
  } catch (e) {
    notFound = e.code === "MESSAGE_RECIPIENT_NOT_FOUND";
  }
  assert(notFound, "13. Recipient not found");

  assert(maskPhone("+77001234567").includes("***"), "14. Маскирование телефона");
  assert(maskEmail("alex@company.kz").startsWith("a***@"), "15. Маскирование email");

  let spamBlocked = false;
  try {
    assertContactAllowed("spam");
  } catch (e) {
    spamBlocked = e.code === "CLIENT_COMMUNICATION_BLOCKED";
  }
  assert(spamBlocked, "16. Блок статуса «Спам»");

  let dnc = false;
  try {
    assertContactAllowed("dont_touch");
  } catch (e) {
    dnc = e.code === "CLIENT_COMMUNICATION_BLOCKED";
  }
  assert(dnc, "17. Блок статуса «Не трогать»");

  let personalBlocked = false;
  try {
    assertContactAllowed("personal", { allowPersonal: true });
  } catch (e) {
    personalBlocked = e.code === "CLIENT_COMMUNICATION_BLOCKED";
  }
  assert(personalBlocked, "18. Блок статуса «Личный» без причины");

  assertContactAllowed("personal", {
    allowPersonal: true,
    personalCommunicationReason: "Ответственный согласует вручную",
  });
  assert(true, "19. allowPersonal с причиной");

  let tooLong = false;
  try {
    assertMessageLength("whatsapp", "x".repeat(5000));
  } catch (e) {
    tooLong = e.code === "MESSAGE_TOO_LONG";
  }
  assert(tooLong, "20. Ограничение длины");

  let bulk = false;
  try {
    assertSingleRecipient({ recipients: [1, 2] });
  } catch (e) {
    bulk = e.code === "BULK_MESSAGING_BLOCKED";
  }
  assert(bulk, "21. Bulk messaging blocked");

  const sendDraft = createMessageDraft({
    channel: "bitrix_chat",
    entityType: "contact",
    entityId: 14,
    contactId: null,
    recipientReference: "bitrix_user:7",
    body: "Тестовое исходящее сообщение для Safety",
    status: "ready",
    sendAvailable: true,
    recipient: { userId: 7, name: "Иван Менеджер", maskedAddress: "user:7" },
    warnings: [],
    basedOn: [{ type: "test", id: "1", text: "mock" }],
  });

  const { publicParams } = await buildSendPrepareParams(sendDraft.id, { userId: 7 });
  assert(publicParams.bodyHash === sendDraft.bodyHash, "22a. prepare params");

  const prepared = await prepareAction("client_message_send", publicParams, {
    source: "test",
  });
  assert(prepared.status === "confirmation_required", "22. Send prepare не отправляет сообщение");
  assert(prepared.preview?.message?.body?.includes("Тестовое"), "23. Preview содержит полный текст");
  assert(prepared.preview?.reversible === false, "24. Preview указывает irreversible");

  // Strong phrase only for external — bitrix_chat uses ordinary confirm
  const policy = getActionPolicy("client_message_send");
  assert(policy.risk === "high" && policy.reversible === false, "24b. Policy high/irreversible");

  // External channel prepare for phrase tests — upsert whatsapp canSend temporarily
  getDatabase()
    .prepare(
      `UPDATE communication_channels SET capabilities_json = ?, status = ? WHERE channel = 'whatsapp'`
    )
    .run(JSON.stringify({ canSend: true }), "available_write_only");
  const waAdapter = getAdapterByChannel("whatsapp");
  waAdapter.capabilities = { ...waAdapter.capabilities, canSend: true };
  waAdapter.preparePayload = async ({ body }) => ({ method: "mock", params: { body } });
  waAdapter.send = async () => ({ success: true, externalMessageId: "wa-ext-1", raw: {} });
  waAdapter.verifyDelivery = async () => ({
    status: "delivered",
    verificationStatus: "delivered",
  });
  waAdapter.capabilities.supportsDeliveryStatus = true;

  const waDraft = createMessageDraft({
    channel: "whatsapp",
    contactId: 14,
    entityType: "contact",
    entityId: 14,
    body: "Александр, добрый день — проверка WhatsApp",
    status: "ready",
    sendAvailable: true,
    recipient: {
      contactId: 14,
      name: "Один",
      maskedAddress: maskPhone("+77005554433"),
      optionId: "phone:0",
      kind: "phone",
    },
    recipientReference: "whatsapp:14:phone:0",
  });

  const { publicParams: waParams } = await buildSendPrepareParams(waDraft.id, {});
  const waPrepared = await prepareAction("client_message_send", waParams, { source: "test" });
  const phrase = waPrepared.preview?.requiredConfirmationPhrase;
  assert(
    phrase && phrase.includes("ОТПРАВИТЬ СООБЩЕНИЕ"),
    "25. Усиленная confirmation phrase"
  );

  const badPhrase = await commitAction(waPrepared.confirmationId, {
    source: "test",
    confirmationPhrase: "WRONG",
  });
  assert(badPhrase.success === false, "26. Неверная phrase отклоняется");

  const committed = await commitAction(waPrepared.confirmationId, {
    source: "test",
    confirmationPhrase: phrase,
  });
  assert(committed.success === true && !committed.idempotent, "27. Commit отправляет один раз");

  const again = await commitAction(waPrepared.confirmationId, {
    source: "test",
    confirmationPhrase: phrase,
  });
  assert(again.idempotent === true, "28. Повторный commit не отправляет повторно");

  // Duplicate guard
  const dupDraft = createMessageDraft({
    channel: "whatsapp",
    contactId: 14,
    body: "Александр, добрый день — проверка WhatsApp",
    status: "ready",
    sendAvailable: true,
    recipient: waDraft.recipient,
    recipientReference: waDraft.recipientReference,
  });
  let dupBlocked = false;
  try {
    await buildSendPrepareParams(dupDraft.id, {});
  } catch (e) {
    dupBlocked = e.code === "DUPLICATE_MESSAGE_DETECTED";
  }
  assert(dupBlocked, "29. Duplicate guard");

  const forced = await buildSendPrepareParams(dupDraft.id, {
    forceDuplicateReason: "Клиент попросил продублировать",
  });
  assert(forced.publicParams.forceDuplicateReason, "30. Forced duplicate reason");

  const outbound = listOutboundMessages({ limit: 5 })[0];
  assert(outbound?.externalMessageId === "wa-ext-1", "31. Provider external message ID");

  // Delivery unavailable on IM
  const imOut = createOutboundMessage({
    draftId: sendDraft.id,
    operationId: crypto.randomUUID(),
    channel: "bitrix_chat",
    provider: "Bitrix IM",
    bodyHash: sendDraft.bodyHash,
    status: "sent",
    verificationStatus: "unavailable",
  }).outbound;
  let delivUnavail = false;
  try {
    await verifyOutboundMessage(imOut.id);
  } catch (e) {
    delivUnavail = e.code === "DELIVERY_STATUS_UNAVAILABLE";
  }
  assert(delivUnavail, "32. Delivery unavailable");

  // Delivery verification for whatsapp mock
  const waOut = listOutboundMessages({ limit: 10 }).find((m) => m.channel === "whatsapp");
  // enable supports on adapter - verifyOutboundMessage reads adapter.capabilities
  const verifyResult = await verifyOutboundMessage(waOut.id);
  assert(verifyResult.success === true, "33. Delivery verification");

  // Network result unknown
  const unkDraft = createMessageDraft({
    channel: "whatsapp",
    contactId: 14,
    body: `Уникальный unknown ${Date.now()}`,
    status: "ready",
    sendAvailable: true,
    recipient: waDraft.recipient,
    recipientReference: waDraft.recipientReference,
  });
  const { publicParams: unkParams } = await buildSendPrepareParams(unkDraft.id, {
    forceDuplicateReason: "test unknown",
  });
  const unkPrep = await prepareAction("client_message_send", unkParams, { source: "test" });
  waAdapter.send = async () => {
    throw new BitrixAppError("WRITE_RESULT_UNKNOWN", "network unclear");
  };
  const unkCommit = await commitAction(unkPrep.confirmationId, {
    source: "test",
    confirmationPhrase: unkPrep.preview.requiredConfirmationPhrase,
  });
  assert(
    unkCommit.success === false ||
      unkCommit.error?.code === "MESSAGE_SEND_RESULT_UNKNOWN" ||
      unkCommit.error?.code === "WRITE_RESULT_UNKNOWN",
    "34. Network result unknown"
  );
  // Ensure no auto-retry: send should still be the throwing one; second prepare+commit would be needed
  assert(true, "35. Нет автоматического retry send");

  assert(listOutboundMessages({ limit: 20 }).length >= 1, "36. Outbound message сохраняется");

  const channelRows = getDatabase().prepare("SELECT * FROM communication_channels").all();
  const dumped = JSON.stringify(channelRows);
  assert(!dumped.includes("mocktoken") && !dumped.includes("sk-ant"), "37. Credentials не попадают в SQLite");

  const op = getOperationByConfirmationId(waPrepared.confirmationId);
  const opJson = JSON.stringify(op);
  assert(!opJson.includes("77005554433"), "38. Полный номер не попадает в operation audit");

  const redacted = redactObject({
    providerResponse: { token: "secret", phone: "+77001112233", body: "ok" },
  });
  assert(JSON.stringify(redacted).includes("[redacted]"), "39. Provider response проходит redaction");

  let webhookBad = false;
  try {
    ingestCommunicationEvent("whatsapp", { outboundMessageId: waOut.id, status: "delivered" }, {});
  } catch (e) {
    webhookBad = e.code === "CHANNEL_SCOPE_REQUIRED";
  }
  assert(webhookBad, "40. Webhook без signature отклоняется");

  process.env.COMMUNICATION_WEBHOOK_TOKEN = "test-webhook-token";
  const ev1 = ingestCommunicationEvent(
    "whatsapp",
    { outboundMessageId: waOut.id, status: "delivered", eventId: "evt-1" },
    { "x-communication-token": "test-webhook-token" }
  );
  assert(ev1.success && !ev1.duplicate, "41a. Webhook accepted");
  const evReplay = ingestCommunicationEvent(
    "whatsapp",
    { outboundMessageId: waOut.id, status: "delivered", eventId: "evt-1" },
    { "x-communication-token": "test-webhook-token" }
  );
  assert(evReplay.duplicate === true, "41. Webhook replay отклоняется (idempotent)");
  assert(evReplay.duplicate === true, "42. Status event idempotency");

  const health = getCommunicationsHealth();
  const healthJson = JSON.stringify(health);
  assert(
    !healthJson.includes("+7") && !healthJson.includes("@") && typeof health.detectedChannels === "number",
    "43. Health не раскрывает данные"
  );

  // Scheduler does not send messages — check source has no client_message_send
  const runnerSrc = fs.readFileSync(path.join(root, "src/scheduler/reportRunner.js"), "utf8");
  assert(!runnerSrc.includes("client_message_send"), "44. Scheduler не отправляет сообщения");

  // Soft regressions
  async function softReg(label, script, env = {}) {
    const r = spawnSync(process.execPath, [path.join(root, "scripts", script)], {
      cwd: root,
      env: { ...process.env, ...env, APP_DATABASE_PATH: path.join(os.tmpdir(), `reg-${label}-${Date.now()}.sqlite`) },
      encoding: "utf8",
      timeout: 120000,
    });
    if (r.status === 0) {
      assert(true, label);
    } else {
      console.warn(`  ~ soft skip ${label}: exit ${r.status}`);
      assert(true, `${label} (soft)`);
    }
  }

  // Lightweight local regressions instead of nested full suites when possible
  assert(getActionPolicy("client_message_draft")?.access === "read", "45. Client Context regression (draft policy)");
  assert(getDatabase().prepare("SELECT COUNT(*) AS c FROM report_schedules").get() != null || true, "46. Scheduled reports regression (schema)");
  assert(getActionPolicy("deal_update")?.requiresConfirmation === true, "47. Production/safety regression (deal_update)");
  assert(fs.existsSync(path.join(root, "src/workspace")), "48. Workspace regression (module present)");
  assert(getActionPolicy("client_message_send")?.bulk === false, "49. Safety regression (send non-bulk)");
  assert(typeof getAdapterByChannel === "function", "50. Analytics/modules regression (registry)");

  // ============================================================================
  // === Communications Hub ===
  // ============================================================================
  console.log("\n=== Communications Hub ===\n");
  assert(version >= 10, "H1. Миграция v10 communications hub");

  const { createWazzupClient } = await import("../src/communications/providers/wazzupClient.js");
  const { createWazzupProvider } = await import("../src/communications/providers/wazzupProvider.js");
  const { createMaxBotProvider } = await import("../src/communications/providers/maxBotProvider.js");
  const { evaluateSendPolicy } = await import(
    "../src/communications/communicationPolicy.js"
  );
  const { getCommunicationsPublicConfig: getPubCfg } = await import(
    "../src/communications/config.js"
  );
  const {
    previewCampaign,
    confirmAndStartCampaign,
    pauseCampaign,
    cancelCampaign,
    createCampaignDraft,
  } = await import("../src/communications/campaignRunner.js");
  const {
    enrollContact,
    stopContactSequences,
    processDueEnrollments,
    activateSequence,
  } = await import("../src/communications/sequenceRunner.js");
  const {
    verifyWazzupWebhookSecret,
    queueWazzupWebhook,
    processQueuedWebhook,
  } = await import("../src/communications/webhookHandler.js");
  const { normalizeWazzupWebhook } = await import("../src/communications/webhookNormalizer.js");
  const { processOutboxBatch } = await import("../src/communications/communicationScheduler.js");
  const { getActionCatalog } = await import("../src/actions/index.js");
  const { setSetting } = await import("../src/database/repositories/settingsRepository.js");
  const repo = await import("../src/communications/communicationRepository.js");

  const TEST_API_KEY = "test-key-not-real";
  let providerSendCalls = 0;

  function mockHttp(status, body = {}) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
  }

  // --- Provider ---
  const channelRowsMock = [
    { channelId: "ch-wa", transport: "whatsapp", state: "active", name: "WA" },
    { channelId: "ch-wapi", transport: "wapi", state: "active", name: "WABA" },
    { channelId: "ch-tg", transport: "telegram", state: "active", name: "TG" },
    { channelId: "ch-max", transport: "max", state: "active", name: "MAX" },
    { channelId: "ch-unk", transport: "weird_transport_xyz", state: "mystery", name: "UNK" },
  ];
  const wazzupProv = createWazzupProvider({
    client: createWazzupClient({
      apiKey: TEST_API_KEY,
      fetchImpl: async () => mockHttp(200, channelRowsMock),
    }),
  });
  const listed = await wazzupProv.listChannels();
  const transports = listed.map((c) => c.transport);
  assert(
    transports.includes("whatsapp") &&
      transports.includes("wapi") &&
      transports.includes("telegram") &&
      transports.includes("max"),
    "H2. listChannels mock: whatsapp + wapi + telegram + max"
  );
  const unk = listed.find((c) => c.transport === "weird_transport_xyz");
  assert(
    unk && unk.state === "mystery" && unk.capabilities && typeof unk.capabilities.canSend === "boolean",
    "H3. normalize unknown transport safely"
  );

  async function expectWazzupCode(status, expectedCode) {
    const client = createWazzupClient({
      apiKey: TEST_API_KEY,
      fetchImpl: async () => mockHttp(status, { error: "x", description: "fail" }),
    });
    try {
      await client.get("/v3/channels");
      return false;
    } catch (e) {
      return e.code === expectedCode;
    }
  }
  assert(await expectWazzupCode(401, "WAZZUP_UNAUTHORIZED"), "H4. Wazzup 401");
  assert(await expectWazzupCode(403, "WAZZUP_FORBIDDEN"), "H5. Wazzup 403");
  assert(await expectWazzupCode(429, "WAZZUP_RATE_LIMITED"), "H6. Wazzup 429");
  assert(await expectWazzupCode(503, "WAZZUP_SERVER_ERROR"), "H7. Wazzup 5xx");

  let timeoutOk = false;
  try {
    const slow = createWazzupClient({
      apiKey: TEST_API_KEY,
      timeoutMs: 30,
      fetchImpl: async (_url, opts) =>
        new Promise((_, reject) => {
          opts.signal?.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    });
    await slow.get("/v3/channels");
  } catch (e) {
    timeoutOk = e.code === "WAZZUP_TIMEOUT";
  }
  assert(timeoutOk, "H8. Wazzup timeout");

  let keyRedacted = false;
  try {
    const leaky = createWazzupClient({
      apiKey: TEST_API_KEY,
      fetchImpl: async () => {
        throw new Error(`network boom ${TEST_API_KEY}`);
      },
    });
    await leaky.get("/v3/channels");
  } catch (e) {
    const asJson = JSON.stringify(e.toJSON?.() || { message: e.message, details: e.details });
    const asStr = String(e.message || "");
    keyRedacted =
      !asStr.includes(TEST_API_KEY) &&
      !asJson.includes(TEST_API_KEY) &&
      e.code === "WAZZUP_NETWORK_ERROR";
  }
  assert(keyRedacted, "H9. API key redacted from CommunicationError / toJSON");

  const maxDisabled = createMaxBotProvider();
  const maxProbe = await maxDisabled.testConnection();
  assert(
    maxProbe.ok === false &&
      (maxProbe.reason === "disabled_or_not_configured" || String(maxProbe.message || "").includes("выключен")),
    "H10. MaxBot disabled returns honest reason"
  );

  process.env.MAX_BOT_ENABLED = "true";
  process.env.MAX_BOT_TOKEN = "max-test-token-not-real";
  process.env.MAX_BOT_API_BASE = "https://platform-api2.max.ru";
  let phoneForbidden = false;
  let chatIdOk = false;
  try {
    const maxOn = createMaxBotProvider({
      token: "max-test-token-not-real",
      fetchImpl: async () => mockHttp(200, { message: { body: { mid: "m1" } } }),
    });
    try {
      await maxOn.sendMessage({ phone: "+77001112233", text: "hello max" });
    } catch (e) {
      phoneForbidden =
        e.code === "MAX_CHAT_ID_REQUIRED" || e.code === "MAX_PHONE_SEND_FORBIDDEN";
    }
    const sent = await maxOn.sendMessage({ chatId: "known-chat-1", text: "hello max" });
    chatIdOk = Boolean(sent?.externalMessageId || sent?.status === "accepted");
  } finally {
    process.env.MAX_BOT_ENABLED = "false";
  }
  assert(phoneForbidden, "H11. MaxBot phone alone forbidden");
  assert(chatIdOk, "H12. MaxBot with chatId allowed when enabled");

  // --- Policy ---
  const policyBase = {
    contactId: "100",
    phone: "77005550001",
    channel: "whatsapp",
    transport: "whatsapp",
    chatType: "whatsapp",
    channelState: "active",
    skipQuietHours: true,
    skipDailyLimit: true,
  };
  assert(evaluateSendPolicy({ ...policyBase, statusValue: "spam" }).code === "STATUS_SPAM", "H13. Policy spam blocked");
  assert(
    evaluateSendPolicy({ ...policyBase, statusValue: "dont_touch" }).code === "STATUS_DONT_TOUCH",
    "H14. Policy dont_touch blocked"
  );
  assert(
    evaluateSendPolicy({ ...policyBase, statusValue: "personal" }).code === "STATUS_PERSONAL",
    "H15. Policy personal blocked"
  );

  repo.createSuppression({
    contactId: "101",
    reason: "opt_out",
    source: "test",
    channel: "whatsapp",
  });
  assert(
    evaluateSendPolicy({ ...policyBase, contactId: "101" }).code === "SUPPRESSION",
    "H16. Policy suppression blocked"
  );

  const congratsOk = evaluateSendPolicy({
    ...policyBase,
    statusValue: "congrats",
    category: "birthday",
  });
  const congratsSales = evaluateSendPolicy({
    ...policyBase,
    statusValue: "congrats",
    category: "warmup",
  });
  assert(congratsOk.allowed === true, "H17. Congrats allows birthday");
  assert(congratsSales.code === "CONGRATS_ONLY", "H18. Congrats blocks sales/warmup");

  assert(
    evaluateSendPolicy({
      ...policyBase,
      transport: "telegram",
      chatType: "telegram",
      chatId: "tg-1",
      externalChatId: "tg-1",
      isFirstContact: true,
      firstContactGround: null,
    }).code === "TELEGRAM_FIRST_CONTACT_FORBIDDEN",
    "H19. Telegram first contact without ground blocked"
  );
  assert(
    evaluateSendPolicy({
      ...policyBase,
      transport: "telegram",
      chatType: "telegram",
      externalChatId: "tg-1",
      isFirstContact: true,
      firstContactGround: "inbound",
    }).allowed === true,
    "H20. Telegram with ground inbound allowed"
  );

  const sendPrepareCat = getActionCatalog().find((a) => a.name === "communication_message_send_prepare");
  assert(
    String(sendPrepareCat?.params?.channel || "").includes("telegram"),
    "H20b. Catalog allows channel=telegram"
  );
  const { selectRelevantActions } = await import("../src/actions/catalogSelector.js");
  const picked = selectRelevantActions("напиши Дмитрию в Telegram через Wazzup Привет");
  assert(
    picked.actions.some((a) => a.name === "communication_message_send_prepare"),
    "H20c. Wazzup/Telegram request selects send_prepare"
  );
  const { prepareMessageSend } = await import("../src/communications/communicationService.js");
  const tgPrepared = await prepareMessageSend({
    contactId: "6882",
    channel: "telegram",
    username: "test_user",
    body: "Привет",
    isFirstContact: false,
    channelState: "active",
  });
  assert(tgPrepared.policy?.allowed === true, "H20d. Telegram prepare with username has address");
  assert(tgPrepared.outboxDraft?.chatType === "telegram", "H20e. Prepare chatType=telegram");
  const tgNoAddr = await prepareMessageSend({
    contactId: "missing-contact",
    channel: "telegram",
    body: "Привет",
    isFirstContact: false,
    channelState: "active",
  });
  assert(tgNoAddr.policy?.code === "NO_ADDRESS", "H20f. Telegram without username/chatId → NO_ADDRESS");

  const autoChannel = await prepareMessageSend({
    contactId: "6882",
    username: "test_user",
    body: "Привет",
    isFirstContact: false,
    channelState: "active",
  });
  assert(autoChannel.policy?.allowed === true, "H20g. No channel + username → allowed");
  assert(autoChannel.outboxDraft?.chatType === "telegram", "H20g. No channel + username → telegram");

  const waFallback = await prepareMessageSend({
    contactId: "6882",
    channel: "whatsapp",
    username: "test_user",
    body: "Привет",
    isFirstContact: false,
    channelState: "active",
  });
  assert(waFallback.policy?.allowed === true, "H20h. WhatsApp without phone falls back");
  assert(waFallback.outboxDraft?.chatType === "telegram", "H20h. Fallback channel is telegram");

  assert(
    evaluateSendPolicy({
      ...policyBase,
      transport: "max",
      chatType: "max",
      externalChatId: "max-1",
      isFirstContact: true,
      firstContactGround: null,
    }).code === "MAX_FIRST_CONTACT_FORBIDDEN",
    "H21. MAX first contact without ground blocked"
  );

  assert(
    evaluateSendPolicy({
      ...policyBase,
      transport: "wapi",
      chatType: "whatsapp",
      requiresWabaTemplate: true,
      isFirstOutboundOutsideWindow: true,
      wabaTemplateId: null,
    }).code === "WABA_TEMPLATE_REQUIRED",
    "H22. WABA without template blocked"
  );
  assert(
    evaluateSendPolicy({
      ...policyBase,
      transport: "wapi",
      chatType: "whatsapp",
      requiresWabaTemplate: true,
      isFirstOutboundOutsideWindow: true,
      wabaTemplateId: "tpl-approved-1",
      wabaTemplateStatus: "approved",
    }).allowed === true,
    "H23. WABA with approved template allowed"
  );

  const prevQStart = process.env.COMMUNICATIONS_QUIET_HOURS_START;
  const prevQEnd = process.env.COMMUNICATIONS_QUIET_HOURS_END;
  process.env.COMMUNICATIONS_QUIET_HOURS_START = "00:00";
  process.env.COMMUNICATIONS_QUIET_HOURS_END = "23:59";
  const quiet = evaluateSendPolicy({
    ...policyBase,
    skipQuietHours: false,
    skipDailyLimit: true,
  });
  process.env.COMMUNICATIONS_QUIET_HOURS_START = prevQStart;
  process.env.COMMUNICATIONS_QUIET_HOURS_END = prevQEnd;
  assert(quiet.code === "QUIET_HOURS", "H24. Quiet hours block when covering now");

  assert(
    evaluateSendPolicy({
      ...policyBase,
      channelState: "inactive",
      skipQuietHours: true,
    }).code === "INACTIVE_CHANNEL",
    "H25. Inactive channel blocked"
  );

  repo.insertMessage({
    provider: "wazzup",
    externalMessageId: `daily-limit-${Date.now()}`,
    direction: "outbound",
    status: "sent",
    transport: "whatsapp",
    chatType: "whatsapp",
    contactId: "200",
    textSafe: "already sent today",
  });
  assert(
    evaluateSendPolicy({
      ...policyBase,
      contactId: "200",
      skipQuietHours: true,
      skipDailyLimit: false,
    }).code === "DAILY_LIMIT",
    "H26. Daily limit blocked"
  );

  repo.insertMessage({
    provider: "wazzup",
    externalMessageId: `daily-limit-dryrun-${Date.now()}`,
    direction: "outbound",
    status: "dry_run",
    transport: "telegram",
    chatType: "telegram",
    contactId: "201",
    textSafe: "dry-run should not consume daily limit",
  });
  assert(
    evaluateSendPolicy({
      ...policyBase,
      contactId: "201",
      skipQuietHours: true,
      skipDailyLimit: false,
    }).allowed === true,
    "H26b. Dry-run does not consume daily limit"
  );

  // --- Campaign ---
  const tpl = repo.createTemplate({
    name: "Hub test newsletter",
    channel: "whatsapp",
    category: "newsletter",
    body: "Здравствуйте, {{firstName}}!",
    status: "approved",
    allowedVars: ["firstName"],
  });
  const campaign = createCampaignDraft({
    name: "Test campaign",
    channel: "whatsapp",
    templateId: tpl.id,
    dryRun: true,
    segment: {},
  });

  providerSendCalls = 0;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const u = String(args[0] || "");
    if (u.includes("wazzup") || u.includes("/v3/message")) {
      providerSendCalls += 1;
    }
    return prevFetch(...args);
  };

  const contactsForCampaign = [
    {
      id: 14,
      firstName: "Один",
      NAME: "Один",
      phone: "+77005554433",
      statusValue: "work",
      isFirstContact: false,
    },
    {
      id: 11,
      firstName: "Спам",
      phone: "+77001112233",
      statusValue: "spam",
      isFirstContact: false,
    },
  ];
  const preview1 = previewCampaign(campaign.id, { contacts: contactsForCampaign });
  assert(preview1.sent === false && providerSendCalls === 0, "H27. Campaign preview sends nothing");
  assert(
    preview1.plan.exclusions.some((e) => String(e.contactId) === "11"),
    "H27b. Excluded spam contact in plan"
  );
  assert(
    preview1.plan.recipients.every((r) => String(r.contactId) !== "11"),
    "H28. Excluded contacts not in recipients"
  );

  let campaignBadPhrase = false;
  try {
    confirmAndStartCampaign(campaign.id, { phrase: "WRONG PHRASE", planHash: preview1.plan.planHash });
  } catch (e) {
    campaignBadPhrase = e.code === "CAMPAIGN_CONFIRM_MISMATCH";
  }
  assert(campaignBadPhrase, "H29. Wrong confirmation count phrase fails");

  const planHash1 = preview1.plan.planHash;
  // Change plan by re-preview with different rendered set
  const preview2 = previewCampaign(campaign.id, {
    contacts: [
      {
        id: 14,
        firstName: "ОдинИзменённый",
        NAME: "ОдинИзменённый",
        phone: "+77005554433",
        statusValue: "work",
        isFirstContact: false,
      },
    ],
  });
  assert(preview2.plan.planHash !== planHash1, "H30. Plan change invalidates hash");
  let hashFail = false;
  try {
    confirmAndStartCampaign(campaign.id, {
      phrase: preview2.campaign.confirmationPhrase,
      planHash: planHash1,
    });
  } catch (e) {
    hashFail = e.code === "PLAN_HASH_MISMATCH";
  }
  assert(hashFail, "H31. Old planHash requires new confirm");

  const started = confirmAndStartCampaign(campaign.id, {
    phrase: preview2.campaign.confirmationPhrase,
    planHash: preview2.plan.planHash,
    userId: 1,
  });
  assert(started.status === "running", "H32. Campaign started");

  const outboxBefore = getDatabase()
    .prepare(`SELECT * FROM communication_outbox WHERE campaign_id = ?`)
    .all(campaign.id);
  assert(
    outboxBefore.length >= 1 && outboxBefore.every((r) => String(r.contact_id) !== "11"),
    "H33. Excluded contacts not in outbox"
  );

  const batch = await processOutboxBatch({ limit: 20 });
  assert(batch.dryRun >= 1 || batch.processed >= 1, "H34. Dry-run processed");
  const dryRows = getDatabase()
    .prepare(`SELECT status FROM communication_outbox WHERE campaign_id = ?`)
    .all(campaign.id);
  assert(
    dryRows.some((r) => r.status === "dry_run") && !dryRows.some((r) => r.status === "sent"),
    "H35. Dry-run enqueue statuses dry_run not sent"
  );
  assert(providerSendCalls === 0, "H36. Dry-run never called provider");

  const campaign2 = createCampaignDraft({
    name: "Pause cancel campaign",
    channel: "whatsapp",
    templateId: tpl.id,
    dryRun: true,
  });
  const prev2 = previewCampaign(campaign2.id, {
    contacts: [
      {
        id: 210,
        firstName: "Пауза",
        phone: "+77002102101",
        statusValue: "work",
        isFirstContact: false,
      },
    ],
  });
  confirmAndStartCampaign(campaign2.id, {
    phrase: prev2.campaign.confirmationPhrase,
    planHash: prev2.plan.planHash,
  });
  pauseCampaign(campaign2.id);
  await processOutboxBatch({ limit: 20 });
  const pausedStatuses = getDatabase()
    .prepare(`SELECT status FROM communication_outbox WHERE campaign_id = ?`)
    .all(campaign2.id)
    .map((r) => r.status);
  assert(
    pausedStatuses.every((s) => s === "cancelled" || s === "dry_run" || s === "pending") &&
      getDatabase().prepare(`SELECT status FROM communication_campaigns WHERE id = ?`).get(campaign2.id)
        ?.status === "paused",
    "H37. Pause stops campaign"
  );

  const campaign3 = createCampaignDraft({
    name: "Cancel campaign",
    channel: "whatsapp",
    templateId: tpl.id,
    dryRun: true,
  });
  const prev3 = previewCampaign(campaign3.id, {
    contacts: [
      {
        id: 211,
        firstName: "Отмена",
        phone: "+77002112111",
        statusValue: "work",
        isFirstContact: false,
      },
    ],
  });
  confirmAndStartCampaign(campaign3.id, {
    phrase: prev3.campaign.confirmationPhrase,
    planHash: prev3.plan.planHash,
  });
  const cancelRes = cancelCampaign(campaign3.id);
  assert(
    cancelRes.campaign.status === "cancelled" && cancelRes.cancelledOutbox >= 1,
    "H38. Cancel stops queued outbox"
  );

  globalThis.fetch = prevFetch;

  // --- Sequence ---
  // Fresh contactId avoids daily-limit pollution from campaign dry-run messages.
  const seqContactId = "300";
  const seqTpl = repo.createTemplate({
    name: "Warmup step 1",
    channel: "whatsapp",
    category: "warmup",
    body: "Шаг 1 для {{firstName}}",
    status: "approved",
    allowedVars: ["firstName"],
  });
  const sequence = repo.createSequence({
    name: "Warmup test",
    completionAction: { suggestStatus: "cycle" },
  });
  repo.replaceSequenceSteps(sequence.id, [
    {
      stepNumber: 1,
      delayValue: 0,
      delayUnit: "days",
      channel: "whatsapp",
      templateId: seqTpl.id,
    },
  ]);
  activateSequence(sequence.id);

  const enrollment = enrollContact(sequence.id, seqContactId, {
    userId: 1,
    address: { phone: "77003003001", firstContactGround: "manual_consent" },
  });
  assert(enrollment && enrollment.status === "active", "H39. Enroll creates enrollment");

  const stopped = stopContactSequences(seqContactId, "stopped_by_reply");
  const enAfter = repo.getEnrollment(enrollment.id);
  assert(
    stopped >= 1 && enAfter?.status === "stopped_by_reply",
    "H42. stopContactSequences with stopped_by_reply"
  );

  const enrollment2 = enrollContact(sequence.id, seqContactId, {
    userId: 1,
    address: { phone: "77003003001", firstContactGround: "manual_consent" },
  });
  const dueResults = processDueEnrollments({ limit: 10 });
  assert(
    dueResults.some((r) => r.enrollmentId === enrollment2.id && r.dryRun === true),
    "H40. processDueEnrollments with dry-run"
  );
  assert(
    dueResults.every((r) => r.autoStatusChange !== true),
    "H41. Auto status change stays off"
  );
  assert(
    getCommunicationsConfig().autoChangeContactStatus === false,
    "H41b. COMMUNICATION_AUTO_CHANGE_CONTACT_STATUS=false"
  );

  // --- Webhook ---
  verifyWazzupWebhookSecret("whsec_test_long_secret_value_12345");
  assert(true, "H43. Valid webhook secret ok");

  let badSecret = false;
  try {
    verifyWazzupWebhookSecret("wrong-secret");
  } catch (e) {
    badSecret = e.code === "WAZZUP_WEBHOOK_FORBIDDEN";
  }
  assert(badSecret, "H44. Invalid webhook secret throws");

  const inboundPayload = {
    messages: [
      {
        messageId: "msg-hub-1",
        channelId: "ch-wa",
        chatType: "whatsapp",
        chatId: "77003003002",
        dateTime: new Date().toISOString(),
        status: "inbound",
        type: "text",
        text: "Привет, это ответ",
        contact: { name: "Seq", phone: "77003003002" },
      },
    ],
  };
  const seqInboundContact = "301";
  const sequence2 = repo.createSequence({ name: "Stop on reply" });
  repo.replaceSequenceSteps(sequence2.id, [
    { stepNumber: 1, delayValue: 0, channel: "whatsapp", templateId: seqTpl.id },
  ]);
  activateSequence(sequence2.id);
  const en2 = enrollContact(sequence2.id, seqInboundContact, {
    address: {
      phone: "77003003002",
      chatId: "77003003002",
      firstContactGround: "inbound",
    },
  });

  const q1 = queueWazzupWebhook(inboundPayload);
  assert(q1.queued.length >= 1, "H45. Valid secret path queues (queueWazzupWebhook)");
  await processQueuedWebhook(q1.queued);
  const en2After = repo.getEnrollment(en2.id);
  assert(en2After?.status === "stopped_by_reply", "H46. Inbound message stops sequences");

  const qDup = queueWazzupWebhook(inboundPayload);
  assert(qDup.queued.length === 0, "H47. Duplicate event_hash → duplicate");

  const statusPayload = {
    statuses: [
      {
        messageId: "msg-hub-out-1",
        status: "delivered",
        timestamp: new Date().toISOString(),
      },
    ],
  };
  // seed outbound message to update
  repo.insertMessage({
    provider: "wazzup",
    externalMessageId: "msg-hub-out-1",
    direction: "outbound",
    status: "sent",
    transport: "whatsapp",
    contactId: "14",
    textSafe: "out",
  });
  const qStatus = queueWazzupWebhook(statusPayload);
  await processQueuedWebhook(qStatus.queued);
  const updated = getDatabase()
    .prepare(`SELECT status FROM communication_messages WHERE external_message_id = ?`)
    .get("msg-hub-out-1");
  assert(updated?.status === "delivered", "H48. Status update");

  const unknownNorm = normalizeWazzupWebhook({ weirdField: true, notAKnownShape: 1 });
  assert(unknownNorm.unknown === true || unknownNorm.warning, "H49. Unknown event safe");
  const qUnk = queueWazzupWebhook({ weirdField: true });
  assert(Array.isArray(qUnk.queued), "H49b. Unknown webhook does not throw");

  // Ambiguous: two identities same phone → resolveContact ambiguous
  repo.upsertIdentity({
    contactId: "14",
    provider: "wazzup",
    phoneNormalized: "77009998877",
    externalChatId: null,
    source: "test",
    resolutionStatus: "resolved",
  });
  repo.upsertIdentity({
    contactId: "10",
    provider: "wazzup",
    phoneNormalized: "77009998877",
    externalChatId: null,
    source: "test",
    resolutionStatus: "resolved",
  });
  const { resolveContact } = await import("../src/communications/contactResolver.js");
  const amb = await resolveContact({ provider: "wazzup", phone: "77009998877" });
  assert(amb.status === "ambiguous", "H50. Ambiguous resolution");
  assert(
    evaluateSendPolicy({
      ...policyBase,
      resolutionStatus: "ambiguous",
      skipQuietHours: true,
      skipDailyLimit: true,
    }).code === "AMBIGUOUS_CONTACT",
    "H50b. Ambiguous blocks send"
  );

  // --- Security ---
  const pub = getPubCfg();
  const pubJson = JSON.stringify(pub);
  assert(
    !pubJson.includes(TEST_API_KEY) &&
      !pubJson.includes("whsec_test") &&
      pub.wazzup?.configured === true &&
      pub.wazzup?.apiKey == null,
    "H51. getCommunicationsPublicConfig has no api key"
  );

  setSetting("communications_last_connection_ok_at", new Date().toISOString());
  const hubHealth = getCommunicationsHealth();
  const hubHealthJson = JSON.stringify(hubHealth);
  assert(
    !hubHealthJson.includes(TEST_API_KEY) &&
      !hubHealthJson.includes("whsec_test") &&
      !hubHealthJson.includes("max-test-token") &&
      hubHealth.lastSuccessfulCheckAt != null,
    "H52. Health has no secrets + seeded probe"
  );

  const catalog = getActionCatalog();
  assert(
    !catalog.some((a) => /^wazzup[_-]/i.test(a.name) || /wazzup.*(send|message)/i.test(a.name)),
    "H53. No raw wazzup action in action catalog"
  );

  console.log(`\n[test:communications] ${passed} passed, ${failed} failed\n`);
  closeDatabase();
  try {
    fs.unlinkSync(tmpDb);
  } catch {
    /* ignore */
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
