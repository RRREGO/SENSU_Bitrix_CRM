import "dotenv/config";
import express from "express";
import { getDeal } from "./src/bitrixClient.js";
import { askClaude } from "./src/claudeClient.js";
import { CRM_SYSTEM_PROMPT, buildDealAnalysisPrompt } from "./src/prompts.js";
import { getActionCatalog } from "./src/actions/index.js";
import { handleChatMessage, handleChatConfirmation, handleChatReset } from "./src/chatAgent.js";
import { generateDocument, listSavedDocuments, listTemplates } from "./src/documents/documentService.js";
import { exportReportFromObject } from "./src/documents/exportService.js";
import { listQuickReports, buildQuickReportOutput, runQuickReportAsDocument } from "./src/reports/quickReports.js";
import { buildDocumentCard } from "./src/resultCards.js";
import { getActionHistory } from "./src/actionHistory.js";
import { openDatabase, getDatabase, getSearchMode } from "./src/database/index.js";
import {
  executeAction,
  commitAction,
  cancelAction,
  prepareAction,
  prepareRollback,
  commitRollback,
  listPublicOperations,
  getPublicOperation,
} from "./src/safety/executor.js";
import { listPolicies } from "./src/safety/policies.js";
import {
  recoverOperationsOnStartup,
  listPendingOperations,
  analyzeOperationRecovery,
  getRecoveryCounts,
} from "./src/safety/recovery.js";
import { createWorkspaceRouter } from "./src/workspace/routes.js";
import { createClientContextRouter } from "./src/clientContext/routes.js";
import { createSchedulerRouter } from "./src/scheduler/routes.js";
import { createCommunicationsRouter } from "./src/communications/routes.js";
import { getCommunicationsHealth } from "./src/communications/capabilityService.js";
import { startCommunicationScheduler } from "./src/communications/communicationScheduler.js";
import {
  getCommunicationsConfig,
  resolveCommunicationSendFlags,
} from "./src/communications/config.js";
import { countVerificationRequired } from "./src/database/repositories/messageDraftsRepository.js";
import { startScheduler, getSchedulerHealth } from "./src/scheduler/schedulerService.js";
import { listProfiles } from "./src/database/repositories/profilesRepository.js";
import { listProjects } from "./src/database/repositories/projectsRepository.js";
import { listChats } from "./src/database/repositories/chatsRepository.js";
import { getLastBitrixReadStatus } from "./src/bitrixClient.js";
import { getLlmTransportConfig, testLlmTransport, assertLlmTransportSafeForBoot } from "./src/llm/transport.js";
import {
  safeLogObject,
  extractDealIdFromEvent,
  isDuplicateDealEvent,
  verifyOutboundToken,
} from "./src/utils.js";
import {
  createAuthRouter,
  bootstrapAdminIfNeeded,
  accessGateMiddleware,
  securityHeadersMiddleware,
  optionalAuthMiddleware,
  requireAuthentication,
  requirePermissionMiddleware,
  getAuthConfig,
  AuthError,
} from "./src/auth/index.js";
import {
  assertSafeToBoot,
  acquireApplicationInstanceLock,
  getBindHost,
  getGoLiveReadiness,
  getAppEnv,
} from "./src/config/productionValidator.js";
import { auditRoutePolicies } from "./src/auth/routePolicies.js";
import { backfillNotificationRecipients } from "./src/scheduler/notificationService.js";
import { createObservabilityRouter } from "./src/observability/adminRoutes.js";
import { createCrmSchemaRouter } from "./src/crmSchema/routes.js";
import { createConnectionsRouter } from "./src/connections/routes.js";
import { requestContextMiddleware, maintenanceMiddleware } from "./src/observability/requestContext.js";
import { getReadinessReport } from "./src/observability/readiness.js";
import {
  installProcessHandlers,
  registerHttpServer,
  registerInstanceLock,
  isShuttingDown,
} from "./src/observability/shutdown.js";
import { startHealthProbes, stopHealthProbes } from "./src/observability/healthProbes.js";
import { startDiskMonitor } from "./src/observability/diskMonitor.js";
import { logger } from "./src/observability/logger.js";
import { recordApplicationError } from "./src/database/repositories/applicationErrorsRepository.js";
import { checkEnvFilePermissions, getReleaseMetadata } from "./src/config/paths.js";
import { getOperationalModes } from "./src/observability/operationalModes.js";

// Safety layer DB (migrations on start)
openDatabase();
assertLlmTransportSafeForBoot();
assertSafeToBoot();
const envPerms = checkEnvFilePermissions(process.env.DOTENV_CONFIG_PATH || ".env");
if (!envPerms.ok) {
  logger.error("startup.env_permissions", envPerms);
  if (getAppEnv() === "production") {
    throw Object.assign(new Error(envPerms.message), { code: "ENV_FILE_PERMISSIONS_TOO_OPEN" });
  }
  console.warn(`[Security] ${envPerms.code}: ${envPerms.message}`);
}
const instanceLock = acquireApplicationInstanceLock({
  allowStandby: process.env.APP_STANDBY_MODE === "true",
});
registerInstanceLock(instanceLock);
recoverOperationsOnStartup();
await bootstrapAdminIfNeeded();
try {
  backfillNotificationRecipients();
} catch (error) {
  logger.warn("notifications.backfill_failed", { message: error.message });
}

const app = express();
const PORT = process.env.PORT || 3005;
const BIND_HOST = getBindHost();
const authCfg = getAuthConfig();
if (authCfg.trustProxy) {
  if (!authCfg.trustedProxyCidrs?.length || !authCfg.publicOrigin) {
    throw Object.assign(
      new Error("При APP_TRUST_PROXY=true нужны APP_TRUSTED_PROXY_CIDRS и APP_PUBLIC_ORIGIN"),
      { code: "UNSAFE_TRUST_PROXY" }
    );
  }
  app.set("trust proxy", 1);
}

app.use(express.json({ limit: "3mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(requestContextMiddleware);
app.use(securityHeadersMiddleware);
app.use(accessGateMiddleware);
app.use(optionalAuthMiddleware);
app.use(maintenanceMiddleware);
app.use(express.static("public"));
app.use("/reports", express.static("reports"));
app.use(createAuthRouter());

const apiAuth = requireAuthentication();

app.use((req, res, next) => {
  if (isShuttingDown()) {
    return res.status(503).json({
      success: false,
      error: { code: "SHUTTING_DOWN", message: "Сервер завершает работу.", requestId: req.requestId },
    });
  }
  // Service webhooks skip browser auth
  if (
    req.path.startsWith("/communication-events/") ||
    req.path.startsWith("/webhooks/wazzup/") ||
    req.path.startsWith("/webhooks/max/") ||
    req.path === "/bitrix/event" ||
    req.path === "/auth/login" ||
    req.path === "/health" ||
    req.path === "/health/readiness"
  ) {
    return next();
  }
  // Static assets already served
  if (req.method === "GET" && (req.path === "/" || req.path.match(/\.(js|css|html|svg|png|ico)$/))) {
    return next();
  }
  return apiAuth(req, res, next);
});

app.use(createWorkspaceRouter());
app.use(createClientContextRouter());
app.use(createSchedulerRouter());
app.use(createCommunicationsRouter());
app.use(createConnectionsRouter());
app.use(createObservabilityRouter());
app.use(createCrmSchemaRouter());

/**
 * Read-only анализ сделки Claude. Bitrix24 не изменяется.
 */
async function analyzeDealReadOnly(dealId) {
  console.log(`Анализ сделки (read-only) ID=${dealId}`);

  const deal = await getDeal(dealId);
  const userPrompt = buildDealAnalysisPrompt(deal);

  const analysis = await askClaude({
    systemPrompt: CRM_SYSTEM_PROMPT,
    userPrompt,
  });

  return {
    deal,
    analysis,
    savedToTimeline: false,
  };
}

function buildTimelineCommentFromAnalysis(analysis) {
  return `
Анализ Claude:

${analysis}
`.trim();
}

// --- Endpoints ---

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/health/readiness", (_req, res) => {
  const report = getReadinessReport();
  res.status(report.ready ? 200 : 503).json({
    ok: report.ready,
    ready: report.ready,
    critical: report.critical,
    warnings: report.warnings,
    checks: report.checks,
    releaseId: getReleaseMetadata().releaseId,
  });
});

app.get(
  "/admin/go-live-readiness",
  requireAuthentication(),
  requirePermissionMiddleware("settings.view"),
  requirePermissionMiddleware("audit.view"),
  (_req, res) => {
    res.json(getGoLiveReadiness());
  }
);

app.get("/health/details", requireAuthentication(), requirePermissionMiddleware("settings.view"), (_req, res) => {
  let database = {
    connected: false,
    journalMode: null,
    migrationVersion: null,
  };

  try {
    const db = getDatabase();
    const journalMode = String(db.pragma("journal_mode", { simple: true }) || "").toLowerCase();
    const row = db
      .prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .get();
    database = {
      connected: true,
      journalMode,
      migrationVersion: row?.version ?? null,
    };
  } catch {
    database.connected = false;
  }

  const blockedActions = listPolicies().filter((p) => p.blocked).length;
  let workspace = {
    profiles: false,
    projects: false,
    chats: false,
    search: getSearchMode(),
  };
  try {
    workspace = {
      profiles: listProfiles().length >= 0,
      projects: listProjects().length >= 0,
      chats: listChats({ limit: 1 }).length >= 0,
      search: getSearchMode(),
    };
  } catch {
    /* tables may be mid-migration */
  }

  const llm = getLlmTransportConfig();
  let recovery = { pendingOperations: 0, recoveryRequired: 0, verificationRequired: 0 };
  try {
    recovery = getRecoveryCounts();
  } catch {
    /* ignore */
  }

  const schedHealth = (() => {
    try {
      return getSchedulerHealth();
    } catch {
      return {
        scheduler: { enabled: false, running: false, activeSchedules: 0, runningJobs: 0, nextRunAt: null },
        notifications: { unreadCritical: 0 },
      };
    }
  })();

  const commHealth = (() => {
    try {
      const base = getCommunicationsHealth();
      return {
        ...base,
        verificationRequired: countVerificationRequired(),
      };
    } catch {
      return { detectedChannels: 0, sendAvailable: 0, verificationRequired: 0 };
    }
  })();

  res.json({
    ok: true,
    service: "bitrix-claude-local-bridge",
    accessMode: getAuthConfig().accessMode,
    database,
    safety: {
      enabled: true,
      blockedActions,
    },
    workspace,
    bitrix: {
      configured: Boolean(process.env.BITRIX_WEBHOOK_URL?.trim()),
      lastReadStatus: getLastBitrixReadStatus(),
    },
    llmTransport: {
      proxyMode: llm.mode,
      configured: llm.configured,
      tlsVerification: llm.tlsVerification,
    },
    context: {
      dynamicActionCatalog: true,
    },
    recovery: {
      pendingOperations: recovery.pendingOperations,
      recoveryRequired: recovery.recoveryRequired,
    },
    scheduler: schedHealth.scheduler,
    notifications: schedHealth.notifications,
    communications: {
      ...commHealth,
      sendEnabled: getAuthConfig().communicationSendEnabled,
    },
  });
});

app.post("/test/claude", async (req, res, next) => {
  try {
    const text = req.body?.text;
    if (!text || typeof text !== "string") {
      return res.status(400).json({
        ok: false,
        error: 'Request body must contain a non-empty "text" field',
      });
    }

    const result = await askClaude({
      systemPrompt: CRM_SYSTEM_PROMPT,
      userPrompt: text,
    });

    res.json({
      ok: true,
      result,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/bitrix/deal/:id", async (req, res, next) => {
  try {
    const dealId = req.params.id;
    const deal = await getDeal(dealId);

    res.json({
      ok: true,
      dealId,
      deal,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/bitrix/deal/:id/analyze", async (req, res, next) => {
  try {
    const dealId = req.params.id;
    const { analysis } = await analyzeDealReadOnly(dealId);

    res.json({
      ok: true,
      success: true,
      dealId: Number(dealId) || dealId,
      analysis,
      savedToTimeline: false,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Prepare сохранения анализа в таймлайн через общий safety executor.
 */
app.post("/bitrix/deal/:id/analyze/save/prepare", async (req, res, next) => {
  try {
    const dealId = req.params.id;
    const analysis =
      typeof req.body?.analysis === "string" && req.body.analysis.trim()
        ? req.body.analysis.trim()
        : null;

    if (!analysis) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: {
          code: "ANALYSIS_REQUIRED",
          message: "Передайте analysis в теле запроса (результат POST /bitrix/deal/:id/analyze).",
        },
      });
    }

    const comment = buildTimelineCommentFromAnalysis(analysis);
    const result = await prepareAction(
      "timeline_comment_add",
      {
        entityType: "deal",
        entityId: Number(dealId),
        comment,
      },
      {
        source: "deal_analyze_save",
        sessionId: req.body?.sessionId || null,
      }
    );

    res.status(result.success === false ? 400 : 200).json({
      ok: result.success !== false,
      dealId: Number(dealId) || dealId,
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

/** Список всех доступных Bitrix24 actions. */
app.get("/bitrix/actions", (_req, res) => {
  res.json({
    ok: true,
    count: getActionCatalog().length,
    actions: getActionCatalog(),
  });
});

/** Универсальный endpoint для вызова Bitrix24 actions (через safety layer). */
app.post("/bitrix/action", async (req, res) => {
  const {
    action,
    params = {},
    confirmationId = null,
    confirm,
    bulkConfirmationPhrase = null,
    confirmationPhrase = null,
    sessionId = null,
    executionToken: _ignoredToken,
    safetyExecutionId: _ignoredSafetyId,
  } = req.body || {};

  if (!action && !confirmationId) {
    return res.status(400).json({
      ok: false,
      error: "action or confirmationId is required",
    });
  }

  // confirm:true без plan — недостаточно
  if (confirm === true && !confirmationId) {
    return res.status(400).json({
      ok: false,
      success: false,
      error: {
        code: "CONFIRMATION_ID_REQUIRED",
        message:
          "confirm:true недостаточно. Сначала выполните prepare (без confirmationId), затем commit с confirmationId.",
      },
    });
  }

  try {
    let result;
    if (confirmationId && !action) {
      result = await commitAction(confirmationId, {
        source: "bitrix_action",
        sessionId,
        bulkConfirmationPhrase,
        confirmationPhrase: confirmationPhrase || bulkConfirmationPhrase,
        user: req.user || null,
      });
    } else {
      result = await executeAction(action, params, {
        source: "bitrix_action",
        sessionId,
        confirmationId,
        bulkConfirmationPhrase,
        confirmationPhrase: confirmationPhrase || bulkConfirmationPhrase,
        user: req.user || null,
      });
    }

    const statusCode = result?.success === false ? 400 : 200;
    res.status(statusCode).json({
      ok: result?.success !== false,
      action: action || undefined,
      ...result,
    });
  } catch (error) {
    console.error(`Ошибка action ${action}:`, error.message);
    res.status(500).json({
      ok: false,
      action,
      error: error.message,
    });
  }
});

/** Список операций safety layer. */
app.get("/operations", (req, res) => {
  const filters = {
    status: req.query.status,
    action: req.query.action,
    sessionId: req.query.sessionId,
    source: req.query.source,
    reversible: req.query.reversible,
    dateFrom: req.query.dateFrom,
    dateTo: req.query.dateTo,
    limit: req.query.limit,
    user: req.user || null,
  };
  res.json({
    ok: true,
    operations: listPublicOperations(filters),
  });
});

/** Pending / recovery operations after restart. */
app.get("/operations/pending", (req, res) => {
  const pending = listPendingOperations({ limit: Number(req.query.limit) || 50 });
  const filtered = listPublicOperations({
    user: req.user || null,
    limit: 500,
  }).filter((op) => pending.some((p) => p.id === op.id));
  res.json({
    ok: true,
    success: true,
    operations: filtered.length ? filtered : pending.filter((op) => {
      if (!req.user || req.user.isLocalOnlySynthetic || req.user.permissions?.has?.("operations.view.all")) {
        return true;
      }
      return op.initiatedByUserId === req.user.userId;
    }),
  });
});

/** Analyze interrupted operation — does not mutate CRM. */
app.post("/operations/:id/recover", (req, res) => {
  const result = analyzeOperationRecovery(req.params.id);
  if (!result.success) {
    return res.status(404).json(result);
  }
  res.json({ ok: true, ...result });
});

/** Проверка LLM-транспорта по серверной конфигурации (без password из frontend). */
app.post("/settings/llm-transport/test", async (_req, res) => {
  const result = await testLlmTransport();
  res.status(result.success ? 200 : 500).json({ ok: result.success, ...result });
});

/** Детали операции (безопасный просмотр). */
app.get("/operations/:id", (req, res) => {
  const operation = getPublicOperation(req.params.id, req.user || null);
  if (!operation) {
    return res.status(404).json({ ok: false, error: "Operation not found" });
  }
  res.json({ ok: true, operation });
});

/** Отмена pending operation. */
app.post("/operations/:id/cancel", async (req, res) => {
  try {
    const operation = getPublicOperation(req.params.id, req.user || null);
    if (!operation) {
      return res.status(404).json({ ok: false, error: "Operation not found" });
    }
    if (
      req.user &&
      !req.user.isLocalOnlySynthetic &&
      !req.user.permissions?.has?.("operations.view.all") &&
      operation.initiatedByUserId &&
      operation.initiatedByUserId !== req.user.userId
    ) {
      return res.status(403).json({
        ok: false,
        success: false,
        error: { code: "RESOURCE_ACCESS_DENIED", message: "Нельзя отменить чужую операцию." },
      });
    }
    const result = await cancelAction(operation.confirmationId, {
      source: req.body?.source || "api",
      sessionId: req.body?.sessionId,
      user: req.user || null,
    });
    res.status(result.success ? 200 : 400).json({ ok: result.success, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/** Подготовка отката. */
app.post("/operations/:id/rollback/prepare", async (req, res) => {
  try {
    const result = await prepareRollback(req.params.id, {
      source: req.body?.source || "api",
      sessionId: req.body?.sessionId,
    });
    res.status(result.success ? 200 : 400).json({ ok: result.success !== false, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/** Commit отката по confirmationId. */
app.post("/operations/rollback/commit", async (req, res) => {
  try {
    const confirmationId = req.body?.confirmationId;
    if (!confirmationId) {
      return res.status(400).json({
        ok: false,
        error: { code: "CONFIRMATION_ID_REQUIRED", message: "confirmationId обязателен." },
      });
    }
    const result = await commitRollback(confirmationId, {
      source: req.body?.source || "api",
      sessionId: req.body?.sessionId,
    });
    res.status(result.success ? 200 : 400).json({ ok: result.success !== false, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/** Чат с CRM-ассистентом на естественном языке. */
app.post("/chat", async (req, res, next) => {
  try {
    const message = req.body?.message;
    const sessionId = req.body?.sessionId || "default";
    const chatId = req.body?.chatId || null;
    const projectId = req.body?.projectId || null;

    const result = await handleChatMessage({
      message,
      sessionId,
      chatId,
      projectId,
      user: req.user || null,
    });

    res.json({
      ok: true,
      success: true,
      ...result,
    });
  } catch (error) {
    const correlationId = req.requestId || "unknown";
    if (error?.code === "PREPARE_FAILED" || error?.name === "DealCreateError") {
      return res.status(400).json({
        ok: false,
        success: false,
        error: {
          code: error.code || "DEAL_CREATE_FAILED",
          message: error.message,
          requestId: correlationId,
        },
      });
    }
    next(error);
  }
});

/** Подтверждение опасных или изменяющих действий в чате. */
app.post("/chat/confirm", async (req, res, next) => {
  try {
    const sessionId = req.body?.sessionId || "default";
    const chatId = req.body?.chatId || null;
    const confirmationId = req.body?.confirmationId;
    const confirm = Boolean(req.body?.confirm);
    const confirmationPhrase = req.body?.confirmationPhrase || null;

    const result = await handleChatConfirmation({
      sessionId,
      chatId,
      confirmationId,
      confirm,
      confirmationPhrase,
      user: req.user || null,
    });

    res.json({
      ok: true,
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

/** Сброс runtime-контекста и создание нового чата (без физического удаления истории). */
app.post("/chat/reset", async (req, res, next) => {
  try {
    const result = await handleChatReset({
      sessionId: req.body?.sessionId || "default",
      projectId: req.body?.projectId || null,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

/** Список шаблонов документов. */
app.get("/documents/templates", (_req, res) => {
  res.json({
    ok: true,
    templates: listTemplates(),
  });
});

/** Список сохранённых документов в reports/. */
app.get("/documents/list", async (_req, res, next) => {
  try {
    const documents = await listSavedDocuments();
    res.json({ ok: true, documents });
  } catch (error) {
    next(error);
  }
});

/** Генерация документа по шаблону. */
app.post("/documents/generate", async (req, res, next) => {
  try {
    const type = req.body?.type;
    const params = req.body?.params || {};

    if (!type) {
      return res.status(400).json({
        ok: false,
        error: 'Request body must contain "type"',
      });
    }

    const document = await generateDocument({ type, params });

    res.json({
      ok: true,
      documentId: document.documentId,
      title: document.title,
      html: document.html,
      text: document.text,
      download: document.download,
      resultCard: buildDocumentCard(document),
    });
  } catch (error) {
    next(error);
  }
});

/** Быстрые отчёты — список. */
app.get("/reports/quick", (_req, res) => {
  res.json({
    ok: true,
    reports: listQuickReports(),
  });
});

/** Запуск быстрого отчёта. */
app.post("/reports/quick/:id/run", async (req, res, next) => {
  try {
    const reportId = req.params.id;
    const params = req.body?.params || {};
    const funnel = req.body?.funnel || null;
    const asDocument = Boolean(req.body?.asDocument);
    const documentStyle = req.body?.documentStyle || "strict";

    if (asDocument) {
      const document = await runQuickReportAsDocument(reportId, params, funnel, {
        documentStyle,
      });
      return res.json({
        ok: true,
        document,
        report: document.report,
        resultCard: buildDocumentCard(document),
      });
    }

    const { report, html, text } = await buildQuickReportOutput(reportId, params, funnel, {
      documentStyle,
    });

    res.json({
      ok: true,
      report,
      html,
      text,
    });
  } catch (error) {
    next(error);
  }
});

/** Экспорт отчёта в HTML-файл. */
app.post("/documents/export-html", async (req, res, next) => {
  try {
    const report = req.body?.report;
    if (!report) {
      return res.status(400).json({
        ok: false,
        error: 'Request body must contain "report"',
      });
    }

    const documentStyle = req.body?.documentStyle || "strict";
    const exported = await exportReportFromObject(report, { documentStyle });

    res.json({
      ok: true,
      file: exported.file,
      fileName: exported.fileName,
      html: exported.html,
      text: exported.text,
    });
  } catch (error) {
    next(error);
  }
});

/** История выполненных действий. */
app.get("/actions/history", (req, res) => {
  const sessionId = req.query.sessionId;
  const limit = Number(req.query.limit) || 50;

  res.json({
    ok: true,
    history: getActionHistory({ sessionId, limit }),
  });
});

app.post("/bitrix/event", async (req, res, next) => {
  try {
    const payload = req.body;

    console.log("Получено событие Bitrix24");
    safeLogObject("Bitrix24 event payload:", payload);

    const tokenCheck = verifyOutboundToken(payload);
    if (!tokenCheck.ok) {
      return res.status(401).json({
        ok: false,
        error: tokenCheck.error,
      });
    }

    const dealId = extractDealIdFromEvent(payload);

    if (!dealId) {
      return res.status(200).json({
        ok: false,
        error: "Deal ID was not found in Bitrix24 event payload",
      });
    }

    console.log(`Получен ID сделки: ${dealId}`);

    if (isDuplicateDealEvent(dealId)) {
      return res.json({
        ok: true,
        skipped: true,
        reason: "Duplicate event ignored",
        dealId,
      });
    }

    // Системные write из webhook на этом этапе запрещены.
    // Только лог + рекомендация (без изменения CRM).
    console.log(
      `[Safety] webhook event for deal ${dealId}: automatic CRM writes are blocked`
    );

    res.json({
      ok: true,
      dealId,
      written: false,
      blockedWrite: true,
      recommendation: {
        code: "WEBHOOK_WRITE_BLOCKED",
        message:
          "Автоматическая запись в CRM из исходящего webhook отключена. Выполните анализ вручную через POST /bitrix/deal/:id/analyze и сохраните комментарий через safety layer.",
        suggestedFlow: [
          "POST /bitrix/deal/:id/analyze",
          "POST /bitrix/deal/:id/analyze/save/prepare",
          "POST /bitrix/action с confirmationId",
        ],
      },
    });
  } catch (error) {
    next(error);
  }
});

// Общая обработка ошибок
app.use((error, req, res, _next) => {
  logger.error("http.unhandled_error", {
    requestId: req.requestId,
    message: error.message,
    code: error.code,
  });
  try {
    recordApplicationError({
      requestId: req.requestId,
      source: "http",
      errorCode: error.code || "INTERNAL_ERROR",
      severity: "error",
      messageSafe: "Внутренняя ошибка HTTP.",
      userId: req.user?.userId || null,
    });
  } catch {
    /* ignore */
  }

  if (error?.code && typeof error.toJSON === "function") {
    const status =
      error.code === "CHAT_NOT_FOUND" ||
      error.code === "PROJECT_NOT_FOUND" ||
      error.code === "PROFILE_NOT_FOUND"
        ? 404
        : 400;
    const body = error.toJSON();
    if (body.error) body.error.requestId = req.requestId;
    return res.status(status).json(body);
  }

  res.status(500).json({
    ok: false,
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Произошла внутренняя ошибка.",
      requestId: req.requestId,
    },
  });
});

installProcessHandlers();

const server = app.listen(PORT, BIND_HOST, () => {
  const sendFlags = resolveCommunicationSendFlags();
  const commCfg = getCommunicationsConfig();
  if (sendFlags.usedDeprecatedAlias) {
    console.warn(
      "[Communications] COMMUNICATION_SEND_ENABLED is deprecated; use COMMUNICATIONS_SEND_ENABLED"
    );
  }
  if (sendFlags.flagsConflict || commCfg.flagsConflict) {
    console.error(
      "[Communications] CRITICAL: COMMUNICATION_FLAGS_CONFLICT — forcing safe mode (sendEnabled=false, dryRun=true)"
    );
  } else {
    console.log(
      `[Communications] flags enabled=${commCfg.enabled} send=${commCfg.sendEnabled} dryRun=${commCfg.dryRun} requireCert=${commCfg.requireCertification}`
    );
  }

  const audit = auditRoutePolicies(app, { isProduction: getAppEnv() === "production" });
  if (audit.missing.length) {
    console.warn(
      `[RoutePolicies] missing policies (${audit.missing.length}):`,
      audit.missing.slice(0, 20).map((m) => `${m.method} ${m.path}`)
    );
  } else {
    console.log(`[RoutePolicies] all ${audit.registeredCount} routes classified`);
  }
  const modes = getOperationalModes();
  if (!instanceLock.standby && modes.schedulerEnabled && !modes.maintenanceMode) {
    startScheduler();
  } else {
    console.warn("[Scheduler] not started (standby/maintenance/disabled)");
  }
  if (!instanceLock.standby && !modes.maintenanceMode) {
    startCommunicationScheduler();
  }
  startHealthProbes();
  startDiskMonitor();
  registerHttpServer(server);
  logger.info("server.started", {
    bindHost: BIND_HOST,
    port: Number(PORT),
    releaseId: getReleaseMetadata().releaseId,
    accessMode: authCfg.accessMode,
  });
  console.log(`Сервер запущен: http://${BIND_HOST}:${PORT}`);
  console.log(`APP_ENV=${getAppEnv()} access=${authCfg.accessMode} release=${getReleaseMetadata().releaseId}`);
});
