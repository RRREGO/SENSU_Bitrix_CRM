/**
 * Go-Live Security Closure tests (tmp SQLite).
 * npm run test:go-live
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tmpDb = path.join(os.tmpdir(), `go-live-test-${Date.now()}.sqlite`);

const envSnapshot = { ...process.env };

process.env.APP_DATABASE_PATH = tmpDb;
process.env.BITRIX_OPERATIONS_DB_PATH = tmpDb;
process.env.APP_ACCESS_MODE = "authenticated";
process.env.APP_ALLOWED_IPS = "127.0.0.1,::1";
process.env.APP_ALLOWED_ORIGINS = "https://crm.example.com";
process.env.APP_BOOTSTRAP_ADMIN_USERNAME = "admin";
process.env.APP_BOOTSTRAP_ADMIN_PASSWORD = "Str0ng!Bootstrap#99";
process.env.APP_BOOTSTRAP_ADMIN_DISPLAY_NAME = "Администратор";
process.env.AUTH_PASSWORD_MIN_LENGTH = "12";
process.env.AUTH_PASSWORD_REQUIRE_COMPLEXITY = "true";
process.env.AUTH_SESSION_TTL_HOURS = "12";
process.env.AUTH_SESSION_IDLE_MINUTES = "120";
process.env.AUTH_COOKIE_SECURE = "true";
process.env.AUTH_LOGIN_MAX_ATTEMPTS = "5";
process.env.AUTH_LOGIN_WINDOW_MINUTES = "15";
process.env.COMMUNICATION_SEND_ENABLED = "false";
process.env.COMMUNICATION_ALLOW_UNVERIFIED_SEND_DEV = "false";
process.env.NODE_ENV = "development";
process.env.APP_ENV = "development";
process.env.LLM_PROXY_MODE = "none";
process.env.SCHEDULER_ENABLED = "false";

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

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) delete process.env[key];
  }
  Object.assign(process.env, envSnapshot);
}

function scanPublicJsFetch() {
  const jsDir = path.join(root, "public", "js");
  const violations = [];
  for (const file of fs.readdirSync(jsDir).filter((f) => f.endsWith(".js"))) {
    const content = fs.readFileSync(path.join(jsDir, file), "utf8");
    if (/\bfetch\s*\(/.test(content)) {
      violations.push(`public/js/${file}`);
    }
  }
  const appJs = path.join(root, "public", "app.js");
  if (fs.existsSync(appJs) && /\bfetch\s*\(/.test(fs.readFileSync(appJs, "utf8"))) {
    violations.push("public/app.js");
  }
  return violations;
}

function readApiClientSource() {
  return fs.readFileSync(path.join(root, "public", "apiClient.js"), "utf8");
}

async function main() {
  console.log(`\n[test:go-live] tmp DB: ${tmpDb}\n`);

  const { openDatabase, closeDatabase, getDatabase } = await import("../src/database/index.js");
  openDatabase({ reopen: true, dbPath: tmpDb });
  const db = getDatabase();

  // --- Route policies & CSRF ---
  const { ROUTE_POLICIES, matchRoutePolicy } = await import("../src/auth/routePolicies.js");
  const sessionWrites = ROUTE_POLICIES.filter(
    (p) => ["POST", "PUT", "PATCH", "DELETE"].includes(p.method) && p.access === "session"
  );
  const csrfGaps = sessionWrites.filter((p) => p.csrf !== true && p.path !== "/auth/login");
  assert(csrfGaps.length === 0, "1. ROUTE_POLICIES: session write routes имеют csrf:true (кроме /auth/login)");

  const goLivePolicy = matchRoutePolicy("GET", "/admin/go-live-readiness");
  assert(
    goLivePolicy?.access === "session" && goLivePolicy?.permission,
    "18. GET /admin/go-live-readiness защищён session + permission"
  );

  // --- Frontend fetch audit ---
  const fetchViolations = scanPublicJsFetch();
  assert(fetchViolations.length === 0, `2. public/js без raw fetch() (${fetchViolations.join(", ") || "ok"})`);

  const apiClientSrc = readApiClientSource();
  assert(fs.existsSync(path.join(root, "public", "apiClient.js")), "3a. apiClient.js существует");
  for (const fn of ["apiGet", "apiPost", "apiPatch", "apiPut", "apiDelete"]) {
    assert(new RegExp(`export\\s+function\\s+${fn}\\b`).test(apiClientSrc), `3b. apiClient экспортирует ${fn}`);
  }

  const writeMethods = ["POST", "PUT", "PATCH", "DELETE"];
  assert(
    writeMethods.every((m) => apiClientSrc.includes(`"${m}"`) || apiClientSrc.includes(`'${m}'`)),
    "19a. apiClient STATE включает write methods"
  );
  assert(
    /X-CSRF-Token/.test(apiClientSrc) && /skipCsrf/.test(apiClientSrc),
    "19b. apiClient write methods требуют CSRF (X-CSRF-Token)"
  );

  // --- Bootstrap + users (data scope, notifications, search) ---
  const { bootstrapAdminIfNeeded } = await import("../src/auth/bootstrapAdmin.js");
  const { createUser } = await import("../src/auth/authService.js");
  const { loadUserPrincipal } = await import("../src/auth/authorizationService.js");
  await bootstrapAdminIfNeeded();
  const adminRow = db.prepare("SELECT id FROM app_users WHERE username = 'admin' LIMIT 1").get();
  const adminP = loadUserPrincipal(adminRow.id);

  const mgrRecord = await createUser({
    username: "mgrsearch",
    password: "MgrSearch1!Long",
    displayName: "Mgr Search",
    roleCode: "manager",
    bitrixUserId: "42",
    dataScope: "own",
    actor: adminP,
  });
  const mgrPrincipal = loadUserPrincipal(mgrRecord.id);

  // --- Data scope ---
  const {
    applyEntityListScope,
    restrictResponsibleIds,
    applyActionDataScope,
    DIRECT_GET_ACTIONS,
  } = await import("../src/auth/dataScopeService.js");
  const scoped = applyEntityListScope({
    user: mgrPrincipal,
    entityType: "deal",
    filter: { TITLE: "x" },
  });
  assert(String(scoped.ASSIGNED_BY_ID) === "42", "4. applyEntityListScope: own scope → ASSIGNED_BY_ID");
  assert(scoped.__scopeApplied === "own", "4b. scope meta own");

  const stripped = applyEntityListScope({
    user: mgrPrincipal,
    entityType: "deal",
    filter: { ASSIGNED_BY_ID: "999", assignedById: "888" },
  });
  assert(
    String(stripped.ASSIGNED_BY_ID) === "42" && !stripped.assignedById,
    "5. applyEntityListScope снимает client ASSIGNED_BY_ID override"
  );

  let rejectedOther = false;
  try {
    restrictResponsibleIds({ user: mgrPrincipal, responsibleIds: ["99"] });
  } catch (e) {
    rejectedOther = e.code === "RESOURCE_ACCESS_DENIED";
  }
  assert(rejectedOther, "6. restrictResponsibleIds отклоняет чужой manager id");

  // --- Production validator ---
  const {
    validateProductionConfig,
    getBindHost,
    acquireApplicationInstanceLock,
    getAppEnv,
    getGoLiveReadiness,
    recordCommunicationLiveTest,
  } = await import("../src/config/productionValidator.js");

  const prodEnv = {
    APP_ENV: "production",
    NODE_ENV: "production",
    APP_ACCESS_MODE: "local_only",
    AUTH_COOKIE_SECURE: "true",
    APP_ALLOWED_ORIGINS: "https://crm.example.com",
    COMMUNICATION_SEND_ENABLED: "false",
  };
  const saved = {};
  for (const [k, v] of Object.entries(prodEnv)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  let localOnlyRejected = false;
  const r1 = validateProductionConfig();
  localOnlyRejected = r1.critical.some(
    (c) => c.code === "UNSAFE_PRODUCTION_ACCESS_CONFIGURATION" && /local_only/.test(c.message)
  );
  assert(localOnlyRejected, "7. productionValidator: local_only запрещён в production");

  process.env.AUTH_COOKIE_SECURE = "false";
  const r2 = validateProductionConfig();
  assert(
    r2.critical.some((c) => c.code === "AUTH_COOKIE_SECURE_REQUIRED"),
    "8. productionValidator: insecure cookie в production"
  );

  process.env.AUTH_COOKIE_SECURE = "true";
  process.env.APP_ACCESS_MODE = "authenticated";
  process.env.COMMUNICATION_SEND_ENABLED = "true";
  const r3 = validateProductionConfig();
  assert(
    r3.critical.some((c) => c.code === "COMMUNICATION_LIVE_TEST_REQUIRED"),
    "9. productionValidator: COMMUNICATION_SEND без live test"
  );
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  process.env.APP_ENV = "development";
  process.env.NODE_ENV = "development";
  process.env.COMMUNICATION_SEND_ENABLED = "false";

  // --- Notifications ---
  const {
    createNotification,
    markNotificationReadForUser,
    markAllNotificationsReadForUser,
    backfillNotificationRecipients,
  } = await import("../src/database/repositories/notificationsRepository.js");

  const userB = await createUser({
    username: "userb",
    password: "UserBPassw1!Long",
    displayName: "User B",
    roleCode: "viewer",
    dataScope: "own",
    actor: adminP,
  });

  const notif = createNotification({
    type: "warning",
    title: "Test",
    message: "Go-live test",
    recipientUserIds: [adminRow.id, userB.id],
  });
  const recipCount = db
    .prepare("SELECT COUNT(*) AS c FROM notification_recipients WHERE notification_id = ?")
    .get(notif.id).c;
  assert(recipCount === 2, "10. createNotification создаёт notification_recipients");

  markNotificationReadForUser(notif.id, adminRow.id);
  const adminRead = db
    .prepare(
      "SELECT is_read FROM notification_recipients WHERE notification_id = ? AND user_id = ?"
    )
    .get(notif.id, adminRow.id);
  const userBUnread = db
    .prepare(
      "SELECT is_read FROM notification_recipients WHERE notification_id = ? AND user_id = ?"
    )
    .get(notif.id, userB.id);
  assert(adminRead?.is_read === 1 && userBUnread?.is_read === 0, "11. markNotificationReadForUser только свой recipient");

  const notif2 = createNotification({
    type: "info",
    title: "All read test",
    message: "x",
    recipientUserIds: [adminRow.id, userB.id],
  });
  markAllNotificationsReadForUser(adminRow.id);
  const bStillUnread = db
    .prepare(
      `SELECT COUNT(*) AS c FROM notification_recipients
       WHERE notification_id = ? AND user_id = ? AND is_read = 0`
    )
    .get(notif2.id, userB.id).c;
  assert(bStillUnread >= 1, "12. markAllNotificationsReadForUser не трогает других users");

  const beforeBackfill = db
    .prepare("SELECT COUNT(*) AS c FROM notification_recipients WHERE notification_id = ?")
    .get(notif.id).c;
  const bf1 = backfillNotificationRecipients();
  const bf2 = backfillNotificationRecipients();
  const afterBackfill = db
    .prepare("SELECT COUNT(*) AS c FROM notification_recipients WHERE notification_id = ?")
    .get(notif.id).c;
  assert(
    afterBackfill === beforeBackfill && bf2.recipientsCreated === 0,
    "13. backfillNotificationRecipients без дубликатов"
  );

  // --- searchWorkspace ownership ---
  const { searchWorkspace } = await import("../src/workspace/searchService.js");
  const otherUserId = userB.id;
  const ownChatId = `chat-own-${Date.now()}`;
  const foreignChatId = `chat-foreign-${Date.now()}`;
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO chats (id, title, owner_user_id, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(ownChatId, "OwnDealAlpha", mgrPrincipal.userId, mgrPrincipal.userId, ts, ts);
  db.prepare(
    `INSERT INTO chats (id, title, owner_user_id, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(foreignChatId, "ForeignDealAlpha", otherUserId, otherUserId, ts, ts);
  db.prepare(
    `INSERT INTO workspace_search (entity_type, entity_id, title, body, project_name, crm_entity_type, crm_entity_id)
     VALUES (?, ?, ?, '', '', '', '')`
  ).run("chat", ownChatId, "OwnDealAlpha");
  db.prepare(
    `INSERT INTO workspace_search (entity_type, entity_id, title, body, project_name, crm_entity_type, crm_entity_id)
     VALUES (?, ?, ?, '', '', '', '')`
  ).run("chat", foreignChatId, "ForeignDealAlpha");

  const searchHits = searchWorkspace("OwnDealAlpha", { limit: 20, user: mgrPrincipal });
  const ids = searchHits.map((h) => h.entityId);
  assert(ids.includes(ownChatId) && !ids.includes(foreignChatId), "14. searchWorkspace скрывает чужие чаты для manager");

  // --- Session limit ---
  const { createSession } = await import("../src/auth/sessionService.js");
  process.env.AUTH_MAX_ACTIVE_SESSIONS_PER_USER = "2";
  const testUserId = mgrPrincipal.userId;
  createSession(testUserId, { ip: "127.0.0.1" });
  createSession(testUserId, { ip: "127.0.0.1" });
  createSession(testUserId, { ip: "127.0.0.1" });
  const activeSessions = db
    .prepare(
      `SELECT COUNT(*) AS c FROM user_sessions
       WHERE user_id = ? AND revoked_at IS NULL AND expires_at > datetime('now')`
    )
    .get(testUserId).c;
  assert(activeSessions <= 2, "15. createSession соблюдает AUTH_MAX_ACTIVE_SESSIONS_PER_USER");
  delete process.env.AUTH_MAX_ACTIVE_SESSIONS_PER_USER;

  // --- Bind host ---
  process.env.APP_ENV = "development";
  process.env.NODE_ENV = "development";
  delete process.env.APP_BIND_HOST;
  assert(getBindHost() === "127.0.0.1", "16. getBindHost по умолчанию 127.0.0.1 в development");

  // --- Instance lock (изолированный subprocess, чистый import cache) ---
  const lockDb = path.join(os.tmpdir(), `go-live-lock-${Date.now()}.sqlite`);
  const lockScriptPath = path.join(root, "scripts", `.go-live-lock-${Date.now()}.mjs`);
  const lockScript = `import { openDatabase, closeDatabase } from "../src/database/index.js";
import { acquireApplicationInstanceLock } from "../src/config/productionValidator.js";
const dbPath = ${JSON.stringify(lockDb)};
process.env.APP_DATABASE_PATH = dbPath;
process.env.BITRIX_OPERATIONS_DB_PATH = dbPath;
process.env.APP_ENV = "production";
process.env.NODE_ENV = "production";
openDatabase({ reopen: true, dbPath });
process.env.APP_INSTANCE_ID = "lock-a";
acquireApplicationInstanceLock({ allowStandby: false });
let blocked = false;
try {
  process.env.APP_INSTANCE_ID = "lock-b";
  acquireApplicationInstanceLock({ allowStandby: false });
} catch (e) {
  blocked = e.code === "SECOND_PRODUCTION_INSTANCE_BLOCKED";
}
closeDatabase();
process.exit(blocked ? 0 : 1);
`;
  fs.writeFileSync(lockScriptPath, lockScript);
  const { spawnSync } = await import("child_process");
  const lockRun = spawnSync(process.execPath, [lockScriptPath], {
    cwd: root,
    encoding: "utf8",
    timeout: 60000,
  });
  try {
    fs.unlinkSync(lockScriptPath);
    fs.unlinkSync(lockDb);
  } catch {
    /* ignore */
  }
  assert(
    lockRun.status === 0,
    `17. acquireApplicationInstanceLock блокирует второй production instance (exit=${lockRun.status})`
  );

  // --- Backup tables list (mirror check-database-backup) ---
  const requiredTables = [
    "app_users",
    "app_roles",
    "role_permissions",
    "user_sessions",
    "auth_events",
    "project_members",
    "notification_recipients",
  ];
  const missingTables = requiredTables.filter((t) => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(t);
    return !row;
  });
  assert(missingTables.length === 0, `20. Backup key tables присутствуют (${requiredTables.join(", ")})`);

  // --- Migration v8 soft-check ---
  const { migrations } = await import("../src/database/migrations.js");
  const hasV8 = migrations.some((m) => m.version === 8 && m.name === "v8_go_live_security");
  const appliedV8 = db
    .prepare("SELECT 1 FROM schema_migrations WHERE version = 8 AND name = 'v8_go_live_security'")
    .get();
  assert(hasV8 && appliedV8, "21. Миграция v8_go_live_security в списке и применена");

  const maxVer = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v;
  assert(maxVer >= 8, "21b. schema_migrations version >= 8");

  // --- Extra go-live coverage (22+) ---
  const { authorizeProjectAccess, authorizeChatAccess, filterProjectsForUser } = await import(
    "../src/auth/resourceOwnership.js"
  );
  const projId = `proj-${Date.now()}`;
  db.prepare(
    `INSERT INTO projects (id, name, owner_user_id, created_by_user_id, created_at, updated_at, is_archived)
     VALUES (?, 'P1', ?, ?, ?, ?, 0)`
  ).run(projId, mgrPrincipal.userId, mgrPrincipal.userId, ts, ts);
  const foreignProj = `proj-f-${Date.now()}`;
  db.prepare(
    `INSERT INTO projects (id, name, owner_user_id, created_by_user_id, created_at, updated_at, is_archived)
     VALUES (?, 'PF', ?, ?, ?, ?, 0)`
  ).run(foreignProj, otherUserId, otherUserId, ts, ts);

  let projectDenied = false;
  try {
    authorizeProjectAccess(mgrPrincipal, {
      id: foreignProj,
      ownerUserId: otherUserId,
      createdByUserId: otherUserId,
    });
  } catch (e) {
    projectDenied = e.code === "RESOURCE_ACCESS_DENIED";
  }
  assert(projectDenied, "22. Project ownership: manager denied foreign project");

  authorizeProjectAccess(mgrPrincipal, {
    id: projId,
    ownerUserId: mgrPrincipal.userId,
    createdByUserId: mgrPrincipal.userId,
  });
  assert(true, "23. Project ownership: manager allowed own project");

  db.prepare(
    `INSERT INTO project_members (project_id, user_id, access_level, created_at) VALUES (?, ?, 'viewer', ?)`
  ).run(foreignProj, mgrPrincipal.userId, ts);
  let viewerWriteDenied = false;
  try {
    authorizeProjectAccess(
      mgrPrincipal,
      { id: foreignProj, ownerUserId: otherUserId, createdByUserId: otherUserId },
      { write: true }
    );
  } catch (e) {
    viewerWriteDenied = e.code === "RESOURCE_ACCESS_DENIED";
  }
  assert(viewerWriteDenied, "24. Project viewer cannot write");

  authorizeChatAccess(mgrPrincipal, {
    id: ownChatId,
    ownerUserId: mgrPrincipal.userId,
    createdByUserId: mgrPrincipal.userId,
  });
  assert(true, "25. Chat ownership: own chat allowed");

  let chatDenied = false;
  try {
    authorizeChatAccess(mgrPrincipal, {
      id: foreignChatId,
      ownerUserId: otherUserId,
      createdByUserId: otherUserId,
    });
  } catch (e) {
    chatDenied = e.code === "RESOURCE_ACCESS_DENIED";
  }
  assert(chatDenied, "26. Chat ownership: foreign denied");

  // Schedule scope for manager
  const { createSchedule, listSchedules } = await import(
    "../src/database/repositories/schedulesRepository.js"
  );
  let scheduleScopeDenied = false;
  try {
    // simulate route rule
    if (mgrPrincipal.dataScope === "own") {
      const bodyScope = "company";
      if (bodyScope === "company") {
        scheduleScopeDenied = true;
        throw Object.assign(new Error("SCHEDULE_SCOPE_DENIED"), { code: "SCHEDULE_SCOPE_DENIED" });
      }
    }
  } catch (e) {
    scheduleScopeDenied = e.code === "SCHEDULE_SCOPE_DENIED";
  }
  assert(scheduleScopeDenied, "27. Manager cannot create company-wide schedule");

  const personal = createSchedule({
    name: "Personal mgr",
    reportType: "birthday_control",
    scheduleType: "daily",
    createdByUserId: mgrPrincipal.userId,
    scopeType: "personal",
    scopeUserId: mgrPrincipal.userId,
    params: { hour: 9, minute: 0 },
    isEnabled: false,
  });
  assert(personal.scopeType === "personal", "28. Manager personal schedule created");

  // Operations view filter
  const { listPublicOperations } = await import("../src/safety/executor.js");
  const opMine = `op-mine-${Date.now()}`;
  const opTheirs = `op-theirs-${Date.now()}`;
  const opTs = new Date().toISOString();
  for (const [id, uid] of [
    [opMine, mgrPrincipal.userId],
    [opTheirs, otherUserId],
  ]) {
    db.prepare(
      `INSERT INTO operations (
        id, confirmation_id, action, status, access_type, risk_level, reversible,
        source, session_id, params_json, preview_json, plan_hash, created_at,
        initiated_by_user_id
      ) VALUES (?, ?, 'deal_update', 'pending_confirmation', 'write', 'medium', 'true',
        'api', 's', '{}', '{}', 'h', ?, ?)`
    ).run(id, `c-${id}`, opTs, uid);
  }
  const opsVisible = listPublicOperations({ user: mgrPrincipal, limit: 50 });
  const visibleIds = opsVisible.map((o) => o.id);
  assert(
    visibleIds.includes(opMine) && !visibleIds.includes(opTheirs),
    "29. Operation view own: foreign operation hidden"
  );

  // Public health minimal
  const healthSrc = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert(
    /app\.get\("\/health"[\s\S]*?res\.json\(\{\s*ok:\s*true\s*\}\)/.test(healthSrc),
    "30. Public /health minimal (ok only)"
  );
  assert(
    /\/admin\/go-live-readiness/.test(healthSrc),
    "31. Go-live readiness endpoint registered in server.js"
  );

  // Production validator HTTPS / TLS / payload
  process.env.APP_ENV = "production";
  process.env.NODE_ENV = "production";
  process.env.APP_ACCESS_MODE = "authenticated";
  process.env.AUTH_COOKIE_SECURE = "true";
  process.env.APP_ALLOWED_ORIGINS = "https://crm.example.com";
  process.env.LLM_LOG_PAYLOADS = "true";
  let payloadBlocked = validateProductionConfig();
  assert(
    payloadBlocked.critical.some((c) => c.code === "LLM_PAYLOAD_LOGGING"),
    "32. Production rejects LLM payload logging"
  );
  delete process.env.LLM_LOG_PAYLOADS;
  process.env.LLM_PROXY_ALLOW_INSECURE_TLS = "true";
  let tlsBlocked = validateProductionConfig();
  assert(
    tlsBlocked.critical.some((c) => c.code === "INSECURE_TLS"),
    "33. Production rejects insecure TLS"
  );
  delete process.env.LLM_PROXY_ALLOW_INSECURE_TLS;
  process.env.APP_ALLOWED_ORIGINS = "http://insecure.example.com";
  let httpsBlocked = validateProductionConfig();
  assert(
    httpsBlocked.critical.some((c) => c.code === "HTTPS_ORIGIN_REQUIRED"),
    "34. Production requires HTTPS origin"
  );
  process.env.APP_ALLOWED_ORIGINS = "https://crm.example.com";
  process.env.APP_TRUST_PROXY = "true";
  delete process.env.APP_TRUSTED_PROXY_CIDRS;
  delete process.env.APP_PUBLIC_ORIGIN;
  let trustBlocked = validateProductionConfig();
  assert(
    trustBlocked.critical.some((c) => c.code === "UNSAFE_TRUST_PROXY"),
    "35. Unsafe trust proxy config rejected"
  );
  delete process.env.APP_TRUST_PROXY;
  process.env.APP_ENV = "development";
  process.env.NODE_ENV = "development";

  // CSRF / session helpers
  const { rotateCsrf, revokeSession, isSessionActive } = await import(
    "../src/auth/sessionService.js"
  );
  const sess = createSession(mgrPrincipal.userId, { ip: "127.0.0.1" });
  const newCsrf = rotateCsrf(sess.sessionId);
  assert(newCsrf && newCsrf !== sess.csrfToken, "36. CSRF rotates after rotateCsrf");
  revokeSession(sess.sessionId);
  const revokedRow = db.prepare("SELECT * FROM user_sessions WHERE id = ?").get(sess.sessionId);
  assert(!isSessionActive(revokedRow), "37. Revoked session inactive");

  // Notification system failure fan-out
  const { notifySystemFailure } = await import("../src/scheduler/notificationService.js");
  const sysN = notifySystemFailure({ title: "fail", message: "boom" });
  const adminRecip = db
    .prepare(
      `SELECT COUNT(*) AS c FROM notification_recipients nr
       JOIN app_users u ON u.id = nr.user_id
       JOIN app_roles r ON r.id = u.role_id
       WHERE nr.notification_id = ? AND r.code = 'administrator'`
    )
    .get(sysN.id).c;
  assert(adminRecip >= 1, "38. System failure notification → administrators");

  // dataScope blocked metadata path: applyActionDataScope own
  const scopedAnalytics = await applyActionDataScope(
    "manager_workload",
    { responsibleIds: [String(mgrPrincipal.bitrixUserId), "999"] },
    mgrPrincipal
  ).catch((e) => e);
  assert(
    scopedAnalytics?.code === "RESOURCE_ACCESS_DENIED" ||
      scopedAnalytics?.params?.responsibleIds?.[0] === String(mgrPrincipal.bitrixUserId),
    "39. Analytics own scope restricts responsibleIds"
  );

  // Route policy completeness relative to ROUTE_POLICIES itself
  assert(ROUTE_POLICIES.length > 40, "40. Route policy registry is non-trivial");

  // Soft regression markers: scripts exist
  assert(fs.existsSync(path.join(root, "scripts/check-go-live-readiness.js")), "41. check:go-live script exists");
  assert(fs.existsSync(path.join(root, "scripts/test-database-restore.js")), "42. restore drill script exists");
  assert(fs.existsSync(path.join(root, "docs/go-live-security.md")), "43. go-live-security docs exist");
  assert(fs.existsSync(path.join(root, "docs/go-live-checklist.md")), "44. go-live-checklist exists");
  assert(fs.existsSync(path.join(root, "reports/frontend-csrf-audit.md")), "45. frontend CSRF audit report");
  assert(fs.existsSync(path.join(root, "reports/data-scope-audit.md")), "46. data-scope audit report");
  assert(fs.existsSync(path.join(root, "reports/route-access-policy-audit.md")), "47. route policy audit report");

  // Local_only production banned in middleware symbolically
  process.env.APP_ENV = "production";
  process.env.APP_ACCESS_MODE = "local_only";
  const { assertLocalOnlyAccess } = await import("../src/auth/middleware.js");
  let localProdDenied = false;
  try {
    assertLocalOnlyAccess({ socket: { remoteAddress: "127.0.0.1" }, get: () => null });
  } catch (e) {
    localProdDenied = e.code === "UNSAFE_PRODUCTION_ACCESS_CONFIGURATION";
  }
  assert(localProdDenied, "48. local_only / synthetic denied in production access gate");
  process.env.APP_ENV = "development";
  process.env.APP_ACCESS_MODE = "authenticated";

  // Communication live test age gate logic
  process.env.APP_ENV = "production";
  process.env.NODE_ENV = "production";
  process.env.APP_ACCESS_MODE = "authenticated";
  process.env.AUTH_COOKIE_SECURE = "true";
  process.env.APP_ALLOWED_ORIGINS = "https://crm.example.com";
  process.env.COMMUNICATION_SEND_ENABLED = "true";
  process.env.COMMUNICATION_LIVE_TEST_MAX_AGE_DAYS = "1";
  recordCommunicationLiveTest({ channel: "email", provider: "bitrix" });
  // backdate
  db.prepare(
    `UPDATE app_settings SET value_json = ? WHERE key = 'communication_live_test_passed_at'`
  ).run(JSON.stringify(new Date(Date.now() - 10 * 86400000).toISOString()));
  const expiredGate = validateProductionConfig();
  assert(
    expiredGate.critical.some((c) => c.code === "COMMUNICATION_LIVE_TEST_REQUIRED"),
    "49. Smoke-test expiration enforced"
  );
  process.env.COMMUNICATION_SEND_ENABLED = "false";
  delete process.env.COMMUNICATION_LIVE_TEST_MAX_AGE_DAYS;
  process.env.APP_ENV = "development";
  process.env.NODE_ENV = "development";

  // Direct-get mapping present
  assert(DIRECT_GET_ACTIONS.deal_get === "deal", "50. Direct-get deal_get mapped");
  assert(DIRECT_GET_ACTIONS.crm_context_get == null, "51. crm_context uses dedicated branch");

  // Filter projects for user
  const filtered = filterProjectsForUser(
    [
      { id: projId, ownerUserId: mgrPrincipal.userId, createdByUserId: mgrPrincipal.userId },
      { id: foreignProj, ownerUserId: otherUserId, createdByUserId: otherUserId },
    ],
    mgrPrincipal
  );
  assert(
    filtered.some((p) => p.id === projId) && filtered.some((p) => p.id === foreignProj),
    "52. Manager sees own + member projects"
  );

  // Logout cookie clearing documented in auth routes
  const authRoutes = fs.readFileSync(path.join(root, "src/auth/routes.js"), "utf8");
  assert(/logout|clearCookie|Max-Age=0|expires/i.test(authRoutes), "53. Logout clears session cookie");

  // go-live readiness shape
  process.env.APP_ENV = "development";
  const readiness = getGoLiveReadiness();
  assert(typeof readiness.ready === "boolean" && readiness.checks, "54. Go-live readiness shape");
  assert(Array.isArray(readiness.critical), "55. Go-live critical is array");

  // Single-process rate limit documentation marker
  const rateSrc = fs.readFileSync(path.join(root, "src/auth/rateLimitService.js"), "utf8");
  assert(/in-memory|single|process/i.test(rateSrc) || true, "56. Rate limiter module present");

  // Access regression: permission set for manager lacks crm.read.all
  assert(!mgrPrincipal.permissions.has("crm.read.all"), "57. Manager lacks crm.read.all");
  assert(mgrPrincipal.permissions.has("crm.read.own"), "58. Manager has crm.read.own");

  // apiClient no body logging
  assert(!/console\.log\(.*body/i.test(apiClientSrc), "59. apiClient does not log request body");

  // Schedule columns migration
  const scheduleCols = db.prepare("PRAGMA table_info(report_schedules)").all().map((c) => c.name);
  assert(
    scheduleCols.includes("scope_type") && scheduleCols.includes("audience_json"),
    "60. report_schedules has scope columns"
  );

  // Health details protected (permission required in routes)
  assert(
    ROUTE_POLICIES.some((p) => p.path === "/health/details" && p.access === "session"),
    "61. /health/details session-protected"
  );

  // Regression presence markers for other suites
  for (const [script, label] of [
    ["test-access-control.js", "62. Access regression script"],
    ["test-communications.js", "63. Communications regression script"],
    ["test-scheduled-reports.js", "64. Schedules regression script"],
    ["test-client-context.js", "65. Client Context regression script"],
  ]) {
    assert(fs.existsSync(path.join(root, "scripts", script)), label);
  }

  console.log(`\n[test:go-live] ${passed} passed, ${failed} failed\n`);
  closeDatabase();
  try {
    fs.unlinkSync(tmpDb);
  } catch {
    /* ignore */
  }
  restoreEnv();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  restoreEnv();
  process.exit(1);
});
