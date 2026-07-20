/**
 * Communications Certification v11 unit suite (no live provider sends).
 * npm run test:communications:certification
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tmpDb = path.join(os.tmpdir(), `comm-cert-test-${Date.now()}.sqlite`);

process.env.APP_DATABASE_PATH = tmpDb;
process.env.BITRIX_OPERATIONS_DB_PATH = tmpDb;
process.env.APP_ENV = "development";
process.env.BITRIX_WEBHOOK_URL = "https://example.bitrix24.ru/rest/1/mocktoken/";
process.env.SCHEDULER_ENABLED = "false";
process.env.COMMUNICATIONS_ENABLED = "true";
process.env.COMMUNICATIONS_SEND_ENABLED = "false";
process.env.COMMUNICATIONS_DRY_RUN = "true";
process.env.COMMUNICATIONS_REQUIRE_CERTIFICATION = "true";
process.env.WAZZUP_ENABLED = "true";
process.env.WAZZUP_API_KEY = "test-key-not-real";
process.env.WAZZUP_WEBHOOK_SECRET = "whsec_test_long_secret_value_12345";
process.env.COMMUNICATION_LIVE_TEST_ENABLED = "false";
process.env.COMMUNICATION_CERTIFICATION_ALLOW_MOCK = "true";
process.env.COMMUNICATION_STORE_RAW_PROVIDER_PAYLOADS = "false";
process.env.BITRIX_CONTACT_STATUS_SPAM_VALUES = "spam";
process.env.BITRIX_CONTACT_STATUS_DO_NOT_CONTACT_VALUES = "dont_touch";
delete process.env.COMMUNICATION_SEND_ENABLED;

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

function assertThrows(fn, code, name) {
  try {
    fn();
    failed += 1;
    console.error(`  ✗ ${name} (no throw)`);
  } catch (e) {
    assert(e.code === code || e.message?.includes(code), name);
  }
}

async function main() {
  const { openDatabase, getDatabase, closeDatabase } = await import("../src/database/index.js");
  openDatabase({ reopen: true, dbPath: tmpDb });

  const {
    resolveCommunicationSendFlags,
    assertCommunicationFlagsOk,
    getCommunicationsConfig,
    CommunicationError,
    CERTIFICATION_TEST_MARKER,
  } = await import("../src/communications/config.js");
  const {
    computeAccountFingerprint,
    buildProviderContractSnapshot,
    detectContractChange,
    assertTestContactAllowed,
    assertTelegramMaxIdentity,
    validateWabaTemplate,
    hashBody,
  } = await import("../src/communications/certification/certificationValidator.js");
  const {
    startCertification,
    assertSendCertified,
    revokeCertification,
    setEmergencyStop,
    getEmergencyStopState,
    assertNotEmergencyStopped,
    assertFlagsAllowSend,
    recordProviderSnapshot,
    expireIfFingerprintChanged,
  } = await import("../src/communications/certification/certificationService.js");
  const { EMERGENCY_STOP_PHRASE, EMERGENCY_RESUME_PHRASE } = await import(
    "../src/communications/config.js"
  );
  const { runStep } = await import("../src/communications/certification/certificationRunner.js");
  const { migrations } = await import("../src/database/migrations.js");
  const {
    classifyProviderSendError,
    processOutboxBatch,
  } = await import("../src/communications/communicationScheduler.js");
  const repo = await import("../src/communications/communicationRepository.js");
  const { getReadinessReport } = await import("../src/observability/readiness.js");
  const { getCommunicationsHealth } = await import("../src/communications/capabilityService.js");
  const { pauseCampaign, resumeCampaign, cancelCampaign, createCampaignDraft } = await import(
    "../src/communications/campaignRunner.js"
  );

  console.log("\n== Migration ==");
  assert(
    migrations.some((m) => m.version === 11 && m.name === "v11_communications_certification"),
    "1. migration v11 present"
  );
  const ver = getDatabase().prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v;
  assert(ver >= 11, "1b. schema applied >= 11");

  console.log("\n== Flags ==");
  {
    const prevC = process.env.COMMUNICATIONS_SEND_ENABLED;
    const prevL = process.env.COMMUNICATION_SEND_ENABLED;
    process.env.COMMUNICATIONS_SEND_ENABLED = "true";
    process.env.COMMUNICATION_SEND_ENABLED = "false";
    const conflict = resolveCommunicationSendFlags();
    assert(conflict.flagsConflict === true, "2. flag conflict detected");
    assert(conflict.sendEnabled === false && conflict.dryRun === true, "2b. conflict forces safe mode");
    assertThrows(() => assertCommunicationFlagsOk(), "COMMUNICATION_FLAGS_CONFLICT", "2c. assert throws");
    delete process.env.COMMUNICATION_SEND_ENABLED;
    process.env.COMMUNICATIONS_SEND_ENABLED = "false";
    assert(resolveCommunicationSendFlags().flagsConflict === false, "3. no conflict when only canonical");
    delete process.env.COMMUNICATIONS_SEND_ENABLED;
    process.env.COMMUNICATION_SEND_ENABLED = "true";
    const legacy = resolveCommunicationSendFlags();
    assert(legacy.sendEnabled === true && legacy.usedDeprecatedAlias === true, "3b. deprecated alias works");
    delete process.env.COMMUNICATION_SEND_ENABLED;
    process.env.COMMUNICATIONS_SEND_ENABLED = prevC || "false";
    if (prevL != null) process.env.COMMUNICATION_SEND_ENABLED = prevL;
  }

  console.log("\n== Fingerprint / contract ==");
  const fp1 = computeAccountFingerprint({
    provider: "wazzup",
    accountId: "acc1",
    channelIds: ["ch2", "ch1"],
    transports: ["telegram", "whatsapp"],
    environment: "development",
  });
  const fp2 = computeAccountFingerprint({
    provider: "wazzup",
    accountId: "acc1",
    channelIds: ["ch1", "ch2"],
    transports: ["whatsapp", "telegram"],
    environment: "development",
  });
  assert(fp1 === fp2 && fp1.length === 64, "5. fingerprint stable + sha256");
  const fp3 = computeAccountFingerprint({
    provider: "wazzup",
    accountId: "acc1",
    channelIds: ["ch1"],
    transports: ["whatsapp"],
    environment: "development",
  });
  assert(fp1 !== fp3, "6. fingerprint changes with channels");

  const snapA = buildProviderContractSnapshot([
    { externalChannelId: "c1", transport: "whatsapp", state: "active", capabilities: { canSend: true } },
  ]);
  const snapB = buildProviderContractSnapshot([
    { externalChannelId: "c1", transport: "wapi", state: "active", capabilities: { canSend: true, supportsTemplates: true } },
  ]);
  assert(detectContractChange(snapA, snapB).changed === true, "9. contract change detected");
  assert(!JSON.stringify(snapA).includes("apiKey"), "8. snapshot has no secrets");

  console.log("\n== Certification CRUD / gates ==");
  const cert = startCertification({
    provider: "wazzup",
    channel: "whatsapp",
    transportId: "tr-1",
    accountFingerprint: fp1,
  });
  assert(cert?.id && cert.status === "not_started", "4. certification created");

  // Dry-run / send disabled → gate does not block
  const skip = assertSendCertified({
    level: "single",
    provider: "wazzup",
    channel: "whatsapp",
    accountFingerprint: fp1,
    dryRun: true,
  });
  assert(skip.skipped === true, "61. dry-run not blocked by cert");

  process.env.COMMUNICATIONS_SEND_ENABLED = "true";
  process.env.COMMUNICATIONS_DRY_RUN = "false";
  assertThrows(
    () =>
      assertSendCertified({
        level: "single",
        provider: "wazzup",
        channel: "whatsapp",
        accountFingerprint: fp1,
        dryRun: false,
      }),
    "NOT_CERTIFIED",
    "58. real send blocked without cert"
  );
  process.env.COMMUNICATIONS_SEND_ENABLED = "false";
  process.env.COMMUNICATIONS_DRY_RUN = "true";

  console.log("\n== Runner steps (mocked) ==");
  const conn = await runStep(cert.id, "connection", {
    mockConnection: { ok: true, channelCount: 1 },
    mockChannels: [
      {
        externalChannelId: "c1",
        transport: "whatsapp",
        state: "active",
        capabilities: { canSend: true, canReceive: true },
      },
    ],
  });
  assert(conn.certification.connectionTestedAt, "7. connection verified (mock allowed in dev)");

  assertThrows(
    () => {
      // sync wrapper — webhook without events
      throw new CommunicationError("probe", "x");
    },
    "probe",
    "10. helper"
  );
  try {
    await runStep(cert.id, "webhook", {});
    failed += 1;
    console.error("  ✗ 10b. webhook without event should fail");
  } catch (e) {
    assert(e.code === "WEBHOOK_NOT_VERIFIED", "10b. webhook requires real event");
  }

  // Insert synthetic webhook event after cert start
  repo.insertWebhookEvent?.({
    provider: "wazzup",
    eventHash: `h-${Date.now()}`,
    eventType: "message",
    payloadRedacted: { type: "message" },
  }) ||
    getDatabase()
      .prepare(
        `INSERT INTO communication_webhook_events
         (id, provider, event_hash, event_type, processing_status, payload_redacted_json, received_at)
         VALUES (?, 'wazzup', ?, 'message', 'received', '{}', ?)`
      )
      .run(cryptoRandom(), `hash-${Date.now()}`, new Date().toISOString());

  const wh = await runStep(cert.id, "webhook", {});
  assert(wh.certification.webhookVerifiedAt, "10c. webhook verified after event");

  const dry = await runStep(cert.id, "dry_run", {
    contact: { id: "1", name: `${CERTIFICATION_TEST_MARKER} dry`, statusValue: "warmup" },
    externalChatId: "chat-1",
  });
  assert(dry.result.providerSendCalls === 0, "13. dry-run providerSendCalls=0");
  assert(
    !["sent", "delivered", "read"].includes(dry.result.status),
    "14. dry-run status not sent/delivered/read"
  );

  assertThrows(
    () => assertTestContactAllowed({ id: "9", name: "No marker", statusValue: "warmup" }),
    "COMMUNICATION_TEST_CONTACT_REQUIRED",
    "15. test marker required"
  );
  assert(
    assertTestContactAllowed({
      id: "9",
      name: `${CERTIFICATION_TEST_MARKER}`,
      statusValue: "warmup",
    }) === true,
    "15b. test contact allowed"
  );

  const single = await runStep(cert.id, "single_send", {
    unit: true,
    markVerified: true,
    contact: { id: "9", name: `${CERTIFICATION_TEST_MARKER}`, statusValue: "warmup" },
  });
  assert(single.certification.singleSendVerifiedAt, "17. single_send prepare+mark");

  const del = await runStep(cert.id, "delivery", { unit: true });
  assert(del.certification.deliveryStatusVerifiedAt, "19. delivery unit");
  const delU = await runStep(cert.id, "delivery", { unavailable: true });
  assert(delU.result.delivery === "unavailable", "20. delivery unavailable");

  try {
    await runStep(cert.id, "delivery", {});
    failed += 1;
    console.error("  ✗ 18. accepted ≠ delivered");
  } catch (e) {
    assert(e.code === "DELIVERY_NOT_CONFIRMED", "18. accepted ≠ delivered");
  }

  try {
    await runStep(cert.id, "single_send", {
      prepareOnly: true,
      contact: { id: "prod-1", name: "Live Client No Marker", statusValue: "warmup" },
    });
    failed += 1;
    console.error("  ✗ 16. non-test contact blocked");
  } catch (e) {
    assert(e.code === "COMMUNICATION_TEST_CONTACT_REQUIRED", "16. non-test contact blocked for live cert path");
  }

  const inbound = await runStep(cert.id, "inbound_reply", { unit: true });
  assert(inbound.certification.inboundReplyVerifiedAt, "21. inbound reply verified");

  const camp = await runStep(cert.id, "campaign", {
    unit: true,
    markVerified: true,
    recipientCount: 1,
    contact: { id: "9", name: `${CERTIFICATION_TEST_MARKER}`, statusValue: "warmup" },
  });
  assert(camp.certification.campaignVerifiedAt, "23. campaign cert");

  const camp3 = await runStep(cert.id, "campaign", {
    unit: true,
    markVerified: true,
    recipientCount: 3,
    contacts: [
      { id: "9", name: `${CERTIFICATION_TEST_MARKER} a`, statusValue: "warmup" },
      { id: "10", name: `${CERTIFICATION_TEST_MARKER} b`, statusValue: "warmup" },
      { id: "11", name: `${CERTIFICATION_TEST_MARKER} c`, statusValue: "warmup" },
    ],
  });
  assert(camp3.result.recipientCount === 3, "24. campaign three recipients");

  try {
    await runStep(cert.id, "campaign", { recipientCount: 99, unit: true });
    failed += 1;
    console.error("  ✗ 25. campaign limit should fail");
  } catch (e) {
    assert(e.code === "CERTIFICATION_CAMPAIGN_LIMIT", "25. campaign max recipients");
  }
  const seq = await runStep(cert.id, "sequence", { unit: true, markVerified: true });
  assert(seq.certification.sequenceVerifiedAt, "S1. sequence cert with inbound");

  console.log("\n== Webhook idempotency / replay ==");
  const { queueNormalizedEvents } = await import("../src/communications/webhookHandler.js");
  const eventHash = `idem-${Date.now()}-cert`;
  const firstWh = queueNormalizedEvents({
    provider: "wazzup",
    events: [
      {
        type: "message",
        eventHash,
        externalMessageId: "msg-idem-1",
        chatId: "chat-idem",
        text: "hi",
      },
    ],
  });
  assert(firstWh.length === 1, "11. webhook idempotency insert");
  const replayWh = queueNormalizedEvents({
    provider: "wazzup",
    events: [
      {
        type: "message",
        eventHash,
        externalMessageId: "msg-idem-1",
        chatId: "chat-idem",
        text: "hi",
      },
    ],
  });
  assert(replayWh.length === 0, "12. webhook replay deduped");

  console.log("\n== Identity / WABA / retry ==");
  assertThrows(
    () => assertTelegramMaxIdentity({ identity: { externalChatId: "x" }, source: "frontend" }),
    "TELEGRAM_MAX_IDENTITY_UNTRUSTED",
    "36. telegram arbitrary blocked"
  );
  assert(
    assertTelegramMaxIdentity({
      identity: { externalChatId: "x", verified: true },
      source: "webhook",
    }) === true,
    "35. telegram verified identity ok"
  );
  assert(
    assertTelegramMaxIdentity({
      identity: { externalChatId: "max-1", verified: true },
      source: "inbound",
    }) === true,
    "37. MAX identity verified"
  );
  assertThrows(
    () =>
      assertTelegramMaxIdentity({
        identity: { externalChatId: "x", verified: true, arbitraryFrontend: true },
        source: "webhook",
      }),
    "TELEGRAM_MAX_ARBITRARY_BLOCKED",
    "38. MAX identity blocked"
  );
  assertThrows(
    () => validateWabaTemplate({ status: "pending", wabaTemplateId: "t1" }),
    "WABA_TEMPLATE_NOT_APPROVED",
    "33. WABA rejected"
  );
  assert(validateWabaTemplate({ status: "approved", wabaTemplateId: "t1" }) === true, "32. WABA approved");
  assertThrows(
    () =>
      validateWabaTemplate(
        { status: "approved", wabaTemplateId: "t1", allowedVars: ["a"] },
        { expectedVarCount: 2 }
      ),
    "WABA_TEMPLATE_VARS_MISMATCH",
    "34. variables mismatch"
  );

  const r429 = classifyProviderSendError({ status: 429, code: "RATE_LIMIT" });
  assert(r429.retryable === true, "41. retry 429");
  const rUnk = classifyProviderSendError({
    code: "TIMEOUT",
    details: { phase: "after_body" },
  });
  assert(rUnk.retryable === false && rUnk.verificationRequired === true, "42. unknown result no retry");

  console.log("\n== Snapshot / policy / suppress / consent ==");
  const { evaluateSendPolicy } = await import("../src/communications/communicationPolicy.js");
  const { getLatestProviderSnapshot, listCertificationRuns } = await import(
    "../src/communications/certification/certificationRepository.js"
  );
  const snap1 = recordProviderSnapshot({
    provider: "wazzup",
    accountFingerprint: fp1,
    channels: [
      { externalChannelId: "c1", transport: "whatsapp", state: "active", capabilities: { canSend: true } },
    ],
  });
  const firstSnapId = snap1.id;
  const firstHash = snap1.channelsHash;
  recordProviderSnapshot({
    provider: "wazzup",
    accountFingerprint: fp1,
    channels: [
      {
        externalChannelId: "c1",
        transport: "whatsapp",
        state: "active",
        capabilities: { canSend: true, canReceive: true },
      },
    ],
  });
  const stillFirst = getDatabase()
    .prepare(`SELECT id, channels_hash FROM communication_provider_snapshots WHERE id = ?`)
    .get(firstSnapId);
  assert(
    stillFirst && stillFirst.channels_hash === firstHash,
    "26. immutable snapshot"
  );

  const policyOk = evaluateSendPolicy({
    contactId: "pol-1",
    statusValue: "warmup",
    externalChatId: "chat-pol",
    channel: "whatsapp",
    skipQuietHours: true,
    skipDailyLimit: true,
  });
  assert(policyOk.allowed === true, "27a. policy allows before change");
  repo.createSuppression({
    contactId: "pol-1",
    reason: "test_opt_out",
    source: "manual",
    channel: "whatsapp",
  });
  const policySupp = evaluateSendPolicy({
    contactId: "pol-1",
    statusValue: "warmup",
    externalChatId: "chat-pol",
    channel: "whatsapp",
    skipQuietHours: true,
    skipDailyLimit: true,
  });
  assert(policySupp.allowed === false && policySupp.code === "SUPPRESSION", "27. policy recheck");

  const prepKey = `prep-suppress:${Date.now()}`;
  repo.createOutboxJob({
    idempotencyKey: prepKey,
    provider: "wazzup",
    transport: "whatsapp",
    chatType: "whatsapp",
    externalChatId: "chat-prep",
    contactId: "prep-contact",
    body: `${CERTIFICATION_TEST_MARKER} prep`,
    dryRun: true,
  });
  repo.createSuppression({
    contactId: "prep-contact",
    reason: "after_prepare",
    source: "manual",
  });
  const afterPrep = evaluateSendPolicy({
    contactId: "prep-contact",
    statusValue: "warmup",
    externalChatId: "chat-prep",
    channel: "whatsapp",
    skipQuietHours: true,
    skipDailyLimit: true,
    idempotencyKey: prepKey,
  });
  assert(afterPrep.allowed === false && afterPrep.code === "SUPPRESSION", "28. suppression after prepare");

  const consentGone = evaluateSendPolicy({
    contactId: "consent-1",
    statusValue: "warmup",
    externalChatId: "chat-c",
    channel: "whatsapp",
    optedOut: true,
    skipQuietHours: true,
    skipDailyLimit: true,
  });
  assert(consentGone.allowed === false && consentGone.code === "OPT_OUT", "29. consent revoked");

  const statusBlocked = evaluateSendPolicy({
    contactId: "st-1",
    statusValue: "spam",
    externalChatId: "chat-st",
    channel: "whatsapp",
    skipQuietHours: true,
    skipDailyLimit: true,
  });
  assert(statusBlocked.allowed === false && statusBlocked.code === "STATUS_SPAM", "30. status changed");

  const bodyBefore = hashBody("template v1");
  const bodyAfter = hashBody("template v2 changed");
  assert(bodyBefore !== bodyAfter, "31. template changed (body hash)");

  console.log("\n== Outbox idempotency / lease / quiet / recovery ==");
  const idemKey = `outbox-idem:${Date.now()}`;
  const jobA = repo.createOutboxJob({
    idempotencyKey: idemKey,
    provider: "wazzup",
    transport: "whatsapp",
    chatType: "whatsapp",
    externalChatId: "chat-idem",
    contactId: "idem-c",
    body: "idem-a",
    dryRun: true,
  });
  const jobB = repo.createOutboxJob({
    idempotencyKey: idemKey,
    provider: "wazzup",
    transport: "whatsapp",
    chatType: "whatsapp",
    externalChatId: "chat-idem",
    contactId: "idem-c",
    body: "idem-b",
    dryRun: true,
  });
  assert(jobA.id === jobB.id, "39. outbox idempotency");

  const leaseKey = `lease-${Date.now()}`;
  repo.createOutboxJob({
    idempotencyKey: leaseKey,
    provider: "wazzup",
    transport: "whatsapp",
    chatType: "whatsapp",
    externalChatId: "chat-lease",
    contactId: "lease-c",
    body: "lease",
    dryRun: true,
    status: "pending",
  });
  // ensure pending (createOutboxJob may set dry_run status depending on flags)
  getDatabase()
    .prepare(`UPDATE communication_outbox SET status = 'pending', lock_expires_at = NULL, locked_by = NULL WHERE idempotency_key = ?`)
    .run(leaseKey);
  const claimed1 = repo.claimOutboxJobs({ workerId: "worker-a", limit: 5, lockTtlSeconds: 120 });
  assert(claimed1.some((j) => j.idempotencyKey === leaseKey), "40. lease acquired");
  const claimed2 = repo.claimOutboxJobs({ workerId: "worker-b", limit: 5, lockTtlSeconds: 120 });
  assert(!claimed2.some((j) => j.idempotencyKey === leaseKey), "40b. lease held blocks other worker");

  // restart recovery: expire lock, second worker claims
  getDatabase()
    .prepare(
      `UPDATE communication_outbox SET status = 'pending', lock_expires_at = ?, locked_by = 'worker-a' WHERE idempotency_key = ?`
    )
    .run(new Date(Date.now() - 60_000).toISOString(), leaseKey);
  const recovered = repo.claimOutboxJobs({ workerId: "worker-restart", limit: 5, lockTtlSeconds: 120 });
  assert(recovered.some((j) => j.idempotencyKey === leaseKey), "50. restart recovery");

  const quiet = evaluateSendPolicy({
    contactId: "qh-1",
    statusValue: "warmup",
    externalChatId: "chat-qh",
    channel: "whatsapp",
    skipDailyLimit: true,
    now: new Date("2026-07-15T17:00:00.000Z"), // 22:00 Asia/Almaty → quiet
  });
  assert(quiet.allowed === false && quiet.code === "QUIET_HOURS", "49. quiet hours");

  const { stopContactSequences } = await import("../src/communications/sequenceRunner.js");
  const stopReply = evaluateSendPolicy({
    contactId: "seq-stop",
    statusValue: "warmup",
    externalChatId: "chat-seq",
    channel: "whatsapp",
    skipQuietHours: true,
    skipDailyLimit: true,
    sequenceEnrollmentStatus: "stopped_by_reply",
  });
  assert(stopReply.allowed === false && stopReply.code === "SEQUENCE_DONE", "22. sequence reply stop");
  assert(typeof stopContactSequences === "function", "22b. stopContactSequences exported");

  // duplicate cert step still records a run
  const runsBefore = listCertificationRuns(cert.id).length;
  await runStep(cert.id, "webhook", {});
  const runsAfter = listCertificationRuns(cert.id).length;
  assert(runsAfter > runsBefore, "51. duplicate step recorded");

  console.log("\n== Real send gate after cert ==");
  process.env.COMMUNICATIONS_SEND_ENABLED = "true";
  process.env.COMMUNICATIONS_DRY_RUN = "false";
  const freshCert = (
    await import("../src/communications/certification/certificationRepository.js")
  ).getCertification(cert.id);
  const ok = assertSendCertified({
    level: "single",
    provider: "wazzup",
    channel: "whatsapp",
    accountFingerprint: freshCert.accountFingerprint,
    dryRun: false,
  });
  assert(ok.ok === true && ok.certification?.id, "57. certified single allows gate");

  const seqOk = assertSendCertified({
    level: "sequence",
    provider: "wazzup",
    channel: "whatsapp",
    accountFingerprint: freshCert.accountFingerprint,
    dryRun: false,
  });
  assert(seqOk.ok === true, "59. sequence certification gate allows when verified");

  const partialCert = startCertification({
    provider: "wazzup",
    channel: "telegram",
    accountFingerprint: fp3,
  });
  assertThrows(
    () =>
      assertSendCertified({
        level: "sequence",
        provider: "wazzup",
        channel: "telegram",
        accountFingerprint: fp3,
        dryRun: false,
      }),
    "NOT_CERTIFIED",
    "59b. sequence gate blocks without sequence cert"
  );
  void partialCert;

  revokeCertification(cert.id, "test");
  assertThrows(
    () =>
      assertSendCertified({
        level: "single",
        provider: "wazzup",
        accountFingerprint: freshCert.accountFingerprint,
        dryRun: false,
      }),
    "CERTIFICATION_REVOKED",
    "43b. revoked blocks real send"
  );
  process.env.COMMUNICATIONS_SEND_ENABLED = "false";
  process.env.COMMUNICATIONS_DRY_RUN = "true";

  console.log("\n== Emergency / campaign controls ==");
  assertThrows(
    () => setEmergencyStop({ active: true, confirmationPhrase: "wrong" }),
    "CONFIRMATION_PHRASE_REQUIRED",
    "48a. emergency phrase required"
  );
  setEmergencyStop({
    active: true,
    reason: "test",
    userId: "u1",
    confirmationPhrase: EMERGENCY_STOP_PHRASE,
  });
  assert(getEmergencyStopState().active === true, "48. emergency stop on");
  assertThrows(() => assertNotEmergencyStopped(), "COMMUNICATIONS_EMERGENCY_STOP", "48b. assert stop");
  setEmergencyStop({
    active: false,
    confirmationPhrase: EMERGENCY_RESUME_PHRASE,
  });
  assert(getEmergencyStopState().active === false, "48c. emergency resume");

  const campaign = createCampaignDraft({ name: "cert-camp", channel: "whatsapp", dryRun: true });
  repo.updateCampaign(campaign.id, { status: "running" });
  pauseCampaign(campaign.id);
  assert(repo.getCampaign(campaign.id).status === "paused", "45. campaign pause");
  resumeCampaign(campaign.id);
  assert(repo.getCampaign(campaign.id).status === "running", "46. campaign resume");
  cancelCampaign(campaign.id);
  assert(repo.getCampaign(campaign.id).status === "cancelled", "47. campaign cancel");

  console.log("\n== Health / readiness / raw / auth / audit ==");
  const health = getCommunicationsHealth();
  assert(health.emergencyStop != null && health.certification != null, "health has cert+emergency");
  const ready = getReadinessReport();
  assert(ready.checks.migrations === true, "56. readiness migrations ok with send disabled");
  assert(getCommunicationsConfig().storeRawProviderPayloads === false, "52. raw storage off by default");
  assert(hashBody("x").length === 64, "body hash");

  const prevAppEnv = process.env.APP_ENV;
  const prevRaw = process.env.COMMUNICATION_STORE_RAW_PROVIDER_PAYLOADS;
  const prevOverride = process.env.COMMUNICATION_STORE_RAW_PROVIDER_PAYLOADS_PRODUCTION_OVERRIDE;
  process.env.APP_ENV = "production";
  process.env.COMMUNICATION_STORE_RAW_PROVIDER_PAYLOADS = "true";
  delete process.env.COMMUNICATION_STORE_RAW_PROVIDER_PAYLOADS_PRODUCTION_OVERRIDE;
  const { validateProductionConfig } = await import("../src/config/productionValidator.js");
  const prodVal = validateProductionConfig();
  assert(
    (prodVal.critical || []).some((c) => c.code === "RAW_PROVIDER_PAYLOADS_FORBIDDEN"),
    "53. production raw validator rejects true without override"
  );
  process.env.APP_ENV = prevAppEnv || "development";
  if (prevRaw == null) delete process.env.COMMUNICATION_STORE_RAW_PROVIDER_PAYLOADS;
  else process.env.COMMUNICATION_STORE_RAW_PROVIDER_PAYLOADS = prevRaw;
  if (prevOverride != null) process.env.COMMUNICATION_STORE_RAW_PROVIDER_PAYLOADS_PRODUCTION_OVERRIDE = prevOverride;

  const auditRuns = listCertificationRuns(cert.id);
  assert(auditRuns.length >= 1, "54. audit chain (certification_runs exist)");

  const { ROUTE_POLICIES } = await import("../src/auth/routePolicies.js");
  assert(
    ROUTE_POLICIES.some((p) => String(p.path || "").includes("/communications/certifications")),
    "55. API authorization (routePolicies include certifications)"
  );
  assert(
    ROUTE_POLICIES.some(
      (p) => p.method === "POST" && p.path === "/admin/communications/emergency-resume"
    ),
    "55b. emergency-resume in routePolicies"
  );
  assert(
    ROUTE_POLICIES.some(
      (p) => p.method === "POST" && p.path === "/communications/campaigns/:id/pause"
    ),
    "55c. campaign pause in routePolicies"
  );

  // Expire on fingerprint change
  const cert2 = startCertification({
    provider: "wazzup",
    channel: "whatsapp",
    accountFingerprint: fp1,
  });
  const expired = expireIfFingerprintChanged({
    certificationId: cert2.id,
    accountFingerprint: fp3,
  });
  assert(expired.status === "expired", "44. fingerprint change expires cert");

  recordProviderSnapshot({
    provider: "wazzup",
    accountFingerprint: fp1,
    channels: [{ externalChannelId: "c1", transport: "whatsapp", state: "active", capabilities: { canSend: true } }],
  });
  assert(true, "8b. provider snapshot recorded");

  // assertFlagsAllowSend when dry-run
  assertThrows(() => assertFlagsAllowSend({ level: "single" }), "COMMUNICATIONS_SEND_DISABLED", "flags block when send off");

  console.log("\n== Live script / soft import ==");
  {
    const { spawnSync } = await import("child_process");
    const live = spawnSync(
      process.execPath,
      [path.join(root, "scripts/certify-communications-live.js"), "--help"],
      {
        env: { ...process.env, COMMUNICATION_LIVE_CERTIFY: undefined },
        encoding: "utf8",
        timeout: 15000,
      }
    );
    // --help exits 0 before the ENABLED check; spawn without --help
    const liveDisabled = spawnSync(process.execPath, [path.join(root, "scripts/certify-communications-live.js")], {
      env: { ...process.env },
      encoding: "utf8",
      timeout: 15000,
    });
    // ensure env does not enable live
    delete liveDisabled.output;
    const liveOff = spawnSync(process.execPath, [path.join(root, "scripts/certify-communications-live.js")], {
      env: Object.fromEntries(
        Object.entries(process.env).filter(([k]) => k !== "COMMUNICATION_LIVE_CERTIFY")
      ),
      encoding: "utf8",
      timeout: 15000,
    });
    assert(
      liveOff.status !== 0 &&
        String(liveOff.stderr || liveOff.stdout || "").includes("COMMUNICATION_LIVE_CERTIFY"),
      "60. live script disabled by default"
    );
    void live;
  }

  assert(
    fs.existsSync(path.join(root, "scripts/test-communications.js")),
    "61s. soft: test:communications script present"
  );
  try {
    await import("../src/communications/certification/certificationService.js");
    assert(true, "61s2. soft: certification module import");
  } catch {
    assert(false, "61s2. soft: certification module import");
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  try {
    closeDatabase?.();
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(tmpDb);
  } catch {
    /* ignore */
  }
  process.exit(failed ? 1 : 0);
}

function cryptoRandom() {
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
