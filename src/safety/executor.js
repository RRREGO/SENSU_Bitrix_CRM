/**
 * Центральный слой безопасного выполнения actions:
 * prepare → preview → confirmation → commit → audit → rollback
 */

import crypto from "crypto";
import { getActionHandler } from "../actions/index.js";
import {
  getActionPolicy,
  hasActionPolicy,
  isReadPolicy,
  isBlockedPolicy,
} from "./policies.js";
import { computePlanHash } from "./planHash.js";
import { redactObject } from "./redact.js";
import {
  confirmationExpiresAt,
  getSafetyConfig,
  rollbackExpiresAt,
} from "./config.js";
import { buildOperationPlan, reloadAndCompare, fetchCrmEntity, fetchTask, getField } from "./preview.js";
import {
  createOperation,
  getOperationByConfirmationId,
  getOperationById,
  getOperationItems,
  getOperationEvents,
  updateOperation,
  updateOperationItem,
  transitionOperationStatus,
  addOperationEvent,
  listOperations,
  toPublicOperationSummary,
  toPublicOperationDetail,
} from "../database/repositories/operationsRepository.js";
import { logAction } from "../actionHistory.js";
import { verifyWriteResult } from "./verification.js";
import { BitrixAppError } from "../bitrix/errors.js";
import {
  runWithSafetyContext,
  stripClientExecutionToken,
} from "./executionContext.js";
import { addMessage } from "../database/repositories/messagesRepository.js";
import { getDatabase } from "../database/index.js";

function safetyError(code, message, details = undefined) {
  const error = {
    code,
    message,
  };
  if (details !== undefined) error.details = details;
  return { success: false, error };
}

function normalizeReversible(value) {
  if (value === true || value === "true") return "true";
  if (value === false || value === "false") return "false";
  if (value === "conditional") return "conditional";
  return String(value ?? "false");
}

/**
 * Единая точка входа для всех источников (/chat, /bitrix/action, reports, ...).
 */
export async function executeAction(actionName, params = {}, context = {}) {
  const {
    source = "unknown",
    sessionId = null,
    confirmationId = null,
    mode = "auto", // auto | prepare | commit | cancel
    bulkConfirmationPhrase = null,
    confirmationPhrase = null,
    deps = {},
  } = context;

  // Клиент не может передать executionToken
  const cleanIncoming = stripClientExecutionToken(params);

  if (!actionName || typeof actionName !== "string") {
    return safetyError("ACTION_REQUIRED", "Параметр action обязателен.");
  }

  const policy = getActionPolicy(actionName);
  if (!policy) {
    return safetyError("ACTION_BLOCKED_BY_SAFETY_POLICY", "Действие заблокировано политикой безопасности.", {
      action: actionName,
      reason: "unsafe_missing_policy",
    });
  }

  if (isBlockedPolicy(policy)) {
    return safetyError("ACTION_BLOCKED_BY_SAFETY_POLICY", policy.blockReason || "Действие заблокировано политикой безопасности.", {
      action: actionName,
    });
  }

  if (policy.bulk) {
    const cfg = getSafetyConfig();
    if (!cfg.bulkEnabled) {
      return safetyError("ACTION_BLOCKED_BY_SAFETY_POLICY", "Массовые действия отключены (BITRIX_BULK_ACTIONS_ENABLED=false).", {
        action: actionName,
      });
    }
  }

  if (mode === "commit" || confirmationId) {
    return commitAction(confirmationId || cleanIncoming.confirmationId, {
      source,
      sessionId,
      bulkConfirmationPhrase,
      confirmationPhrase,
      user: context.user || null,
      deps,
    });
  }

  if (mode === "cancel") {
    return cancelAction(confirmationId || cleanIncoming.confirmationId, { source, sessionId });
  }

  if (isReadPolicy(policy)) {
    return runReadAction(actionName, cleanIncoming, {
      source,
      sessionId,
      deps,
      user: context.user || null,
    });
  }

  // Write / destructive → только prepare (даже если params.confirm === true)
  return prepareAction(actionName, cleanIncoming, {
    source,
    sessionId,
    deps,
    bulkConfirmationPhrase,
    user: context.user || null,
  });
}

async function runReadAction(actionName, params, { source, sessionId, deps, user = null }) {
  const handler = deps.runHandler || getActionHandler(actionName);
  if (!handler) {
    return safetyError("UNKNOWN_ACTION", `Неизвестный action: ${actionName}`);
  }

  let scopedParams = params;
  let scopeMeta = null;
  try {
    if (user) {
      const { applyActionDataScope } = await import("../auth/dataScopeService.js");
      const scoped = await applyActionDataScope(actionName, params, user);
      scopedParams = scoped.params;
      scopeMeta = scoped.scopeMeta;
    }
    const result = await handler(scopedParams);
    if (source === "chat" || source === "bitrix_action") {
      logAction({
        sessionId: sessionId || "default",
        action: actionName,
        params: redactObject(scopedParams),
        status: "success",
      });
    }
    const out = { success: true, status: "completed", action: actionName, result };
    if (scopeMeta && (user?.role === "administrator" || user?.permissions?.has("audit.view"))) {
      out.scope = scopeMeta;
    }
    return out;
  } catch (error) {
    if (error?.code === "RESOURCE_ACCESS_DENIED" || error?.code === "BITRIX_USER_MAPPING_REQUIRED") {
      return safetyError(error.code, error.message, { action: actionName });
    }
    if (source === "chat" || source === "bitrix_action") {
      logAction({
        sessionId: sessionId || "default",
        action: actionName,
        params: redactObject(params),
        status: "error",
        error: error.message,
      });
    }
    return safetyError("ACTION_FAILED", error.message, { action: actionName });
  }
}

/**
 * Prepare: snapshot + preview + SQLite plan. Bitrix24 не изменяется.
 */
export async function prepareAction(actionName, params = {}, context = {}) {
  const {
    source = "unknown",
    sessionId = null,
    chatId = null,
    messageId = null,
    projectId = null,
    deps = {},
    bulkConfirmationPhrase = null,
    user = null,
  } = context;
  const policy = getActionPolicy(actionName);

  if (!policy) {
    return safetyError("ACTION_BLOCKED_BY_SAFETY_POLICY", "Действие заблокировано политикой безопасности.", {
      action: actionName,
      reason: "unsafe_missing_policy",
    });
  }

  if (!policy.requiredPermissions?.length) {
    return safetyError(
      "ACTION_BLOCKED_BY_SAFETY_POLICY",
      "Action не имеет authorization policy.",
      { action: actionName, reason: "unsafe_missing_authorization_policy" }
    );
  }

  if (user && !user.isLocalOnlySynthetic) {
    const perms = user.permissions;
    const ok = (policy.requiredPermissions || []).every((p) => perms?.has?.(p));
    if (!ok) {
      return safetyError("PERMISSION_DENIED", "Недостаточно прав для prepare.", {
        action: actionName,
        requiredPermissions: policy.requiredPermissions,
      });
    }
  }

  // Write scope check before plan
  if (user && params?.id && policy.dataScope === "crm_entity") {
    try {
      const { authorizeEntityWrite, DIRECT_GET_ACTIONS } = await import("../auth/dataScopeService.js");
      const entityType =
        DIRECT_GET_ACTIONS[actionName] ||
        (actionName.startsWith("deal_")
          ? "deal"
          : actionName.startsWith("lead_")
            ? "lead"
            : actionName.startsWith("contact_")
              ? "contact"
              : actionName.startsWith("company_")
                ? "company"
                : actionName.includes("task")
                  ? "task"
                  : null);
      if (entityType) {
        await authorizeEntityWrite({
          user,
          entityType,
          entityId: params.id || params.taskId || params.entityId,
        });
      }
    } catch (error) {
      if (error?.code) {
        return safetyError(error.code, error.message, { action: actionName });
      }
      throw error;
    }
  }

  if (actionName === "client_message_send") {
    const { getAuthConfig } = await import("../auth/config.js");
    const cfg = getAuthConfig();
    if (!cfg.communicationSendEnabled) {
      // allow prepare for preview, but mark commit blocked
      // kill switch enforced on commit
    }
  }

  if (isBlockedPolicy(policy)) {
    return safetyError("ACTION_BLOCKED_BY_SAFETY_POLICY", policy.blockReason || "Действие заблокировано политикой безопасности.", {
      action: actionName,
    });
  }

  if (isReadPolicy(policy)) {
    return runReadAction(actionName, params, { source, sessionId, deps });
  }

  const handler = getActionHandler(actionName);
  if (!handler) {
    return safetyError("UNKNOWN_ACTION", `Неизвестный action: ${actionName}`);
  }

  // Strip client-side confirm — недостаточно без operation plan
  const cleanParams = stripClientExecutionToken({ ...params });
  delete cleanParams.confirm;
  delete cleanParams.confirmationId;
  // Фразу подтверждения формирует только server plan — не принимать от клиента до prepare
  delete cleanParams.confirmationPhrase;
  delete cleanParams.requiredConfirmationPhrase;
  delete cleanParams.bulkConfirmationPhrase;

  if (policy.bulk) {
    const bulkCheck = validateBulk(cleanParams, bulkConfirmationPhrase);
    if (!bulkCheck.ok) return bulkCheck.error;
  }

  let plan;
  try {
    const builder = deps.buildPlan || buildOperationPlan;
    plan = await builder(actionName, cleanParams, policy);
  } catch (error) {
    return safetyError("PREPARE_FAILED", error.message, { action: actionName });
  }

  const safeParams = redactObject(cleanParams);
  const expiresAt = confirmationExpiresAt();
  const planHash = computePlanHash({
    action: actionName,
    params: safeParams,
    entityIds: plan.entityIds,
    before: plan.before,
    after: plan.after,
    affectedCount: plan.affectedCount,
  });

  const preview = {
    ...plan.preview,
    risk: policy.risk,
    reversible: policy.reversible,
    expiresAt,
    rollbackExpiresAt: plan.preview.rollbackExpiresAt || rollbackExpiresAt(),
  };

  if (user) {
    preview.initiatedBy = {
      userId: user.userId,
      displayName: user.displayName,
      role: user.role,
      bitrixUserId: user.bitrixUserId || null,
    };
    const { getAuthConfig } = await import("../auth/config.js");
    const authCfg = getAuthConfig();
    if (
      (authCfg.requireSeparateApproverCritical && policy.risk === "critical") ||
      (authCfg.requireSeparateApproverExternalMessages && actionName === "client_message_send")
    ) {
      preview.approval = {
        mode: "separate_approver",
        initiatorUserId: user.userId,
        allowedRoles: ["director", "administrator"],
      };
    }
  }

  const operation = createOperation({
    confirmationId: crypto.randomUUID(),
    action: actionName,
    accessType: policy.access,
    riskLevel: policy.risk,
    status: "pending_confirmation",
    reversible: normalizeReversible(policy.reversible),
    source,
    sessionId,
    chatId,
    messageId,
    projectId,
    initiatedByUserId: user?.userId && !user.isLocalOnlySynthetic ? user.userId : null,
    params: {
      ...safeParams,
      __execPlan: plan.execPlan,
      ...(user
        ? {
            __initiatedBy: {
              userId: user.userId,
              displayName: user.displayName,
              role: user.role,
              bitrixUserId: user.bitrixUserId || null,
            },
          }
        : {}),
    },
    preview: redactObject(preview),
    before: redactObject(plan.before),
    after: redactObject(plan.after),
    planHash,
    expiresAt,
    items: plan.items.map((item) => ({
      entityType: item.entityType,
      entityId: item.entityId,
      before: redactObject(item.before),
      after: redactObject(item.after),
      status: "pending",
    })),
  });

  return {
    success: true,
    status: "confirmation_required",
    confirmationId: operation.confirmationId,
    expiresAt,
    operation: {
      id: operation.id,
      risk: policy.risk,
      affectedCount: plan.affectedCount,
      reversible: policy.reversible,
      access: policy.access,
    },
    preview,
  };
}

function validateBulk(params, phrase) {
  const cfg = getSafetyConfig();
  if (!cfg.bulkEnabled) {
    return {
      ok: false,
      error: safetyError("ACTION_BLOCKED_BY_SAFETY_POLICY", "Массовые действия отключены.", {}),
    };
  }

  const ids = params.ids || params.entityIds || [];
  const count = Array.isArray(ids) ? ids.length : Number(params.limit) || 0;
  if (count > cfg.bulkMaxItems) {
    return {
      ok: false,
      error: safetyError("BULK_LIMIT_EXCEEDED", `Превышен лимит массовой операции (${cfg.bulkMaxItems}).`, {
        requested: count,
        max: cfg.bulkMaxItems,
      }),
    };
  }

  const expected = `ПОДТВЕРЖДАЮ ИЗМЕНЕНИЕ ${count} СДЕЛОК`;
  if (!phrase || String(phrase).trim().toUpperCase() !== expected) {
    return {
      ok: false,
      error: safetyError("BULK_PHRASE_REQUIRED", `Для массовой операции требуется фраза: ${expected}`, {
        expectedPhrase: expected,
      }),
    };
  }

  return { ok: true };
}

/**
 * Commit сохранённого operation plan. Новые params не принимаются.
 */
export async function commitAction(confirmationId, context = {}) {
  const { source = "unknown", sessionId = null, deps = {}, user = null } = context;

  try {
    const { assertWritesAllowed } = await import("../observability/operationalModes.js");
    assertWritesAllowed("bitrix_write");
  } catch (error) {
    if (error?.code) {
      return safetyError(error.code, error.message);
    }
    throw error;
  }

  if (!confirmationId) {
    return safetyError("CONFIRMATION_ID_REQUIRED", "Для выполнения изменения требуется confirmationId сохранённого operation plan.");
  }

  const operation = getOperationByConfirmationId(confirmationId);
  if (!operation) {
    return safetyError("OPERATION_NOT_FOUND", "Операция не найдена.");
  }

  // Authorization: confirm own / any
  if (user && !user.isLocalOnlySynthetic) {
    const policy = getActionPolicy(operation.action);
    const initiatorId = operation.initiatedByUserId || operation.params?.__initiatedBy?.userId;
    const canAny = user.permissions?.has("operations.confirm.any");
    const canOwn = user.permissions?.has("operations.confirm.own");
    if (operation.action === "client_message_send") {
      const { getAuthConfig } = await import("../auth/config.js");
      const authCfg = getAuthConfig();
      if (!authCfg.communicationSendEnabled) {
        const liveOk = getDatabase()
          .prepare(
            `SELECT value_json FROM app_settings WHERE key = 'communication_live_test_passed_at'`
          )
          .get();
        if (!authCfg.allowUnverifiedSendDev || authCfg.isProduction) {
          return safetyError(
            "COMMUNICATION_SEND_DISABLED",
            "Отправка сообщений отключена администратором."
          );
        }
        if (!liveOk && authCfg.isProduction) {
          return safetyError(
            "COMMUNICATION_SEND_DISABLED",
            "Отправка сообщений отключена администратором."
          );
        }
      }
      // Re-check CRM scope of recipient contact before send commit
      try {
        const draftId = operation.params?.draftId;
        if (draftId && user) {
          const draft = getDatabase()
            .prepare("SELECT * FROM message_drafts WHERE id = ?")
            .get(draftId);
          if (draft?.entity_type && draft?.entity_id) {
            const { authorizeEntityRead } = await import("../auth/dataScopeService.js");
            await authorizeEntityRead({
              user,
              entityType: draft.entity_type,
              entityId: draft.entity_id,
            });
          }
          if (
            draft?.created_by_user_id &&
            String(draft.created_by_user_id) !== String(user.userId) &&
            !user.permissions?.has("communications.view.all") &&
            !user.permissions?.has("communications.send")
          ) {
            return safetyError("RESOURCE_ACCESS_DENIED", "Нельзя отправить чужой draft.");
          }
        }
      } catch (scopeErr) {
        if (scopeErr?.code) {
          return safetyError(scopeErr.code, scopeErr.message);
        }
        throw scopeErr;
      }
      if (authCfg.requireSeparateApproverExternalMessages && String(initiatorId) === String(user.userId)) {
        return safetyError(
          "PERMISSION_DENIED",
          "Требуется отдельный согласующий для внешней отправки."
        );
      }
    }
    if (initiatorId && String(initiatorId) !== String(user.userId) && !canAny) {
      return safetyError("PERMISSION_DENIED", "Нельзя подтвердить чужую операцию.");
    }
    if (!canOwn && !canAny) {
      return safetyError("PERMISSION_DENIED", "Нет права подтверждения операций.");
    }
    if (policy?.confirmPermissions?.length) {
      const ok = policy.confirmPermissions.some((p) => user.permissions?.has(p)) || canAny;
      if (!ok) {
        return safetyError("PERMISSION_DENIED", "Недостаточно прав для подтверждения.");
      }
    }
  }

  // Идемпотентность: уже выполнено
  if (["completed", "partially_completed"].includes(operation.status)) {
    return {
      success: true,
      status: operation.status,
      confirmationId,
      operationId: operation.id,
      result: operation.result,
      idempotent: true,
    };
  }

  if (operation.status === "cancelled") {
    return safetyError("OPERATION_CANCELLED", "Операция отменена и не может быть выполнена.");
  }

  if (operation.status === "expired") {
    return safetyError("OPERATION_EXPIRED", "Срок действия operation plan истёк.");
  }

  if (operation.status !== "pending_confirmation" && operation.status !== "executing") {
    return safetyError("OPERATION_INVALID_STATUS", `Недопустимый статус операции: ${operation.status}`);
  }

  if (operation.expiresAt && new Date(operation.expiresAt).getTime() < Date.now()) {
    updateOperation(operation.id, { status: "expired" });
    addOperationEvent(operation.id, "failed", { reason: "expired" });
    return safetyError("OPERATION_EXPIRED", "Срок действия operation plan истёк.");
  }

  // Усиленное подтверждение для внешних сообщений (фраза только из plan, не из prepare params клиента)
  const requiredPhrase =
    operation.preview?.requiredConfirmationPhrase ||
    operation.params?.requiredConfirmationPhrase ||
    null;
  if (requiredPhrase) {
    const provided =
      context.confirmationPhrase ||
      context.bulkConfirmationPhrase ||
      null;
    if (
      !provided ||
      String(provided).trim().toUpperCase() !== String(requiredPhrase).trim().toUpperCase()
    ) {
      return safetyError(
        "BULK_PHRASE_REQUIRED",
        `Для отправки требуется подтверждающая фраза: ${requiredPhrase}`,
        { expectedPhrase: requiredPhrase }
      );
    }
  }

  // Проверка plan hash
  const recomputed = computePlanHash({
    action: operation.action,
    params: stripExecPlan(operation.params),
    entityIds: collectEntityIds(operation),
    before: operation.before,
    after: operation.after,
    affectedCount: operation.preview?.affectedCount || 0,
  });

  if (recomputed !== operation.planHash) {
    return safetyError("OPERATION_PLAN_INVALID", "План операции изменён или повреждён.");
  }

  // Захват выполнения (идемпотентность)
  const claimed = transitionOperationStatus(
    operation.id,
    ["pending_confirmation"],
    "executing",
    { confirmedAt: new Date().toISOString() }
  );

  if (claimed && user?.userId && !user.isLocalOnlySynthetic) {
    updateOperation(operation.id, { confirmedByUserId: user.userId });
  }

  if (!claimed) {
    const again = getOperationById(operation.id);
    if (["completed", "partially_completed"].includes(again?.status)) {
      return {
        success: true,
        status: again.status,
        confirmationId,
        operationId: again.id,
        result: again.result,
        idempotent: true,
      };
    }
    return safetyError("OPERATION_INVALID_STATUS", "Операция уже обрабатывается или недоступна.");
  }

  addOperationEvent(operation.id, "confirmed", { source, sessionId });
  addOperationEvent(operation.id, "execution_started", {});

  const execPlan = operation.params?.__execPlan;
  const items = getOperationItems(operation.id);

  // Optimistic locking
  try {
    const compare = deps.reloadAndCompare || reloadAndCompare;
    const check = await compare(execPlan, operation.before);
    if (!check.ok) {
      updateOperation(operation.id, {
        status: "failed",
        error: {
          code: "OPERATION_STATE_CHANGED",
          message: "Данные CRM изменились после формирования предпросмотра. Сформируйте операцию заново.",
          details: { conflictingFields: check.conflictingFields },
        },
      });
      addOperationEvent(operation.id, "failed", {
        code: "OPERATION_STATE_CHANGED",
        conflictingFields: check.conflictingFields,
      });
      return safetyError("OPERATION_STATE_CHANGED", "Данные CRM изменились после формирования предпросмотра. Сформируйте операцию заново.", {
        conflictingFields: check.conflictingFields,
      });
    }
  } catch (error) {
    updateOperation(operation.id, {
      status: "failed",
      error: { code: "LOCK_CHECK_FAILED", message: error.message },
    });
    addOperationEvent(operation.id, "failed", { message: error.message });
    return safetyError("LOCK_CHECK_FAILED", error.message);
  }

  // Execute inside safety context (executionToken)
  let result;
  let itemStats = { ok: 0, fail: 0 };
  let verification = null;

  try {
    const run = deps.runExecPlan || executePlan;
    const execResult = await runWithSafetyContext(
      {
        operationId: operation.id,
        confirmationId,
        action: operation.action,
        source,
      },
      async () => run(operation, execPlan, items, deps)
    );
    result = execResult.result;
    itemStats = execResult.itemStats;

    try {
      const verify = deps.verifyWriteResult || verifyWriteResult;
      verification = await verify({
        execPlan,
        result,
        afterExpected: operation.after,
      });
    } catch {
      verification = { verified: false, verificationRequired: true };
    }

    let finalStatus =
      itemStats.fail > 0 && itemStats.ok > 0
        ? "partially_completed"
        : itemStats.fail > 0 && itemStats.ok === 0
          ? "failed"
          : "completed";

    updateOperation(operation.id, {
      status: finalStatus,
      result: redactObject({
        ...(result && typeof result === "object" ? result : { value: result }),
        verification,
      }),
      executedAt: new Date().toISOString(),
      error:
        finalStatus === "failed"
          ? { code: "ACTION_FAILED", message: "Выполнение завершилось ошибкой." }
          : null,
    });

    addOperationEvent(
      operation.id,
      finalStatus === "partially_completed"
        ? "partially_completed"
        : finalStatus === "failed"
          ? "failed"
          : "completed",
      { itemStats, verification }
    );

    logAction({
      sessionId: sessionId || operation.sessionId || "default",
      action: operation.action,
      params: redactObject(stripExecPlan(operation.params)),
      status: finalStatus === "failed" ? "error" : "success",
    });

    try {
      const { invalidateClientContextCache } = await import(
        "../clientContext/cache.js"
      );
      const entityType =
        operation.params?.entityType ||
        operation.preview?.entity?.type ||
        null;
      const entityId =
        operation.params?.entityId ||
        operation.params?.id ||
        operation.preview?.entity?.id ||
        null;
      if (entityType && entityId) {
        invalidateClientContextCache(String(entityType).toLowerCase(), entityId);
      }
    } catch {
      /* ignore */
    }

    notifyChatAboutOperation(operation, {
      kind: finalStatus === "failed" ? "error" : "result",
      text:
        finalStatus === "failed"
          ? `Операция «${operation.action}» завершилась ошибкой.`
          : `Операция «${operation.action}» выполнена.`,
    });

    if (finalStatus === "failed") {
      return {
        success: false,
        status: finalStatus,
        confirmationId,
        operationId: operation.id,
        error: { code: "ACTION_FAILED", message: "Выполнение завершилось ошибкой.", details: result },
        result,
        verification,
      };
    }

    return {
      success: true,
      status: finalStatus,
      confirmationId,
      operationId: operation.id,
      result,
      verification,
      rollbackAvailable: ["true", "conditional"].includes(String(operation.reversible)),
    };
  } catch (error) {
    if (error?.code === "WRITE_RESULT_UNKNOWN" || error instanceof BitrixAppError && error.code === "WRITE_RESULT_UNKNOWN") {
      updateOperation(operation.id, {
        status: "verification_required",
        error: {
          code: "WRITE_RESULT_UNKNOWN",
          message:
            "Не удалось определить результат изменяющего запроса. Требуется проверка состояния CRM.",
        },
        executedAt: new Date().toISOString(),
      });
      addOperationEvent(operation.id, "verification_required", {
        code: "WRITE_RESULT_UNKNOWN",
      });
      notifyChatAboutOperation(operation, {
        kind: "error",
        text: "Не удалось определить результат изменения CRM. Проверьте операцию вручную.",
      });
      return {
        success: false,
        partial: true,
        status: "verification_required",
        confirmationId,
        operationId: operation.id,
        error: {
          code: "WRITE_RESULT_UNKNOWN",
          message:
            "Не удалось определить результат изменяющего запроса. Требуется проверка состояния CRM.",
        },
      };
    }

    updateOperation(operation.id, {
      status: "failed",
      error: { code: "ACTION_FAILED", message: error.message },
      executedAt: new Date().toISOString(),
    });
    addOperationEvent(operation.id, "failed", { message: error.message });
    logAction({
      sessionId: sessionId || operation.sessionId || "default",
      action: operation.action,
      params: redactObject(stripExecPlan(operation.params)),
      status: "error",
      error: error.message,
    });
    notifyChatAboutOperation(operation, {
      kind: "error",
      text: `Операция «${operation.action}» завершилась ошибкой.`,
    });
    return safetyError("ACTION_FAILED", error.message, { operationId: operation.id });
  }
}

function notifyChatAboutOperation(operation, { kind, text }) {
  if (!operation?.chatId || !text) return;
  try {
    addMessage(operation.chatId, {
      role: "system_note",
      content: text,
      messageType: kind === "error" ? "error" : "operation_result",
      metadata: {
        operationId: operation.id,
        confirmationId: operation.confirmationId,
        action: operation.action,
      },
    });
  } catch {
    /* ignore */
  }
}

async function executePlan(operation, execPlan, items, deps = {}) {
  const itemStats = { ok: 0, fail: 0 };

  if (execPlan?.kind === "entity_delete") {
    const { entityType, entityId } = execPlan;
    let action;
    if (entityType === "task") action = "delete_task";
    else if (entityType === "deal") action = "deal_delete";
    else if (entityType === "lead") action = "lead_delete";
    else throw new Error(`Удаление ${entityType} для отката не поддерживается.`);

    const handler = deps.runHandler || getActionHandler(action);
    const result = await handler({ id: Number(entityId), taskId: Number(entityId), confirm: true });
    if (items[0]) {
      updateOperationItem(items[0].id, {
        status: "completed",
        result: redactObject(result),
        executedAt: new Date().toISOString(),
        rolledBackAt: new Date().toISOString(),
      });
      addOperationEvent(operation.id, "rollback_item_succeeded", { itemId: items[0].id });
    }
    itemStats.ok += 1;
    return { result, itemStats };
  }

  if (!execPlan || execPlan.kind === "raw_handler") {
    const action = execPlan?.action || operation.action;
    const params = execPlan?.params || stripExecPlan(operation.params);
    const handler = deps.runHandler || getActionHandler(action);
    if (!handler) throw new Error(`Handler not found: ${action}`);

    const result = await handler(params);
    if (items[0]) {
      updateOperationItem(items[0].id, {
        status: "completed",
        result: redactObject(result),
        executedAt: new Date().toISOString(),
      });
      addOperationEvent(operation.id, "item_succeeded", { itemId: items[0].id });
      itemStats.ok += 1;
    } else {
      itemStats.ok += 1;
    }
    return { result, itemStats };
  }

  if (execPlan.kind === "entity_update") {
    const handlerName =
      execPlan.entityType === "deal"
        ? "deal_update"
        : execPlan.entityType === "lead"
          ? "lead_update"
          : execPlan.entityType === "contact"
            ? "contact_update"
            : "company_update";
    const handler = deps.runHandler || getActionHandler(handlerName);
    const result = await handler({
      id: Number(execPlan.entityId),
      fields: execPlan.fields,
    });
    if (items[0]) {
      updateOperationItem(items[0].id, {
        status: "completed",
        result: redactObject(result),
        executedAt: new Date().toISOString(),
      });
      addOperationEvent(operation.id, "item_succeeded", { itemId: items[0].id });
    }
    itemStats.ok += 1;
    return { result, itemStats };
  }

  if (execPlan.kind === "task_update") {
    const handler = deps.runHandler || getActionHandler("update_task");
    const result = await handler({
      taskId: Number(execPlan.entityId),
      fields: execPlan.fields,
    });
    if (items[0]) {
      updateOperationItem(items[0].id, {
        status: "completed",
        result: redactObject(result),
        executedAt: new Date().toISOString(),
      });
      addOperationEvent(operation.id, "item_succeeded", { itemId: items[0].id });
    }
    itemStats.ok += 1;
    return { result, itemStats };
  }

  if (execPlan.kind === "entity_create" || execPlan.kind === "task_create") {
    const action =
      execPlan.kind === "task_create"
        ? "create_task"
        : execPlan.entityType === "deal"
          ? "create_deal"
          : execPlan.entityType === "lead"
            ? "lead_create"
            : execPlan.entityType === "contact"
              ? "contact_create"
              : "company_create";
    const handler = deps.runHandler || getActionHandler(action);
    const result = await handler(
      execPlan.kind === "task_create"
        ? { fields: execPlan.fields }
        : execPlan.entityType === "deal"
          ? { fields: execPlan.fields }
          : { fields: execPlan.fields }
    );

    const createdId =
      result?.item?.id ||
      result?.result?.item?.id ||
      result?.result?.ID ||
      result?.ID ||
      result?.id ||
      result?.task?.id ||
      result?.result?.task?.id;

    if (items[0]) {
      updateOperationItem(items[0].id, {
        status: "completed",
        result: redactObject({ ...result, createdId }),
        after: { ...(items[0].after || {}), id: createdId },
        executedAt: new Date().toISOString(),
      });
      addOperationEvent(operation.id, "item_succeeded", { itemId: items[0].id, createdId });
    }

    // Persist created id into operation.after for conditional rollback
    updateOperation(operation.id, {
      after: {
        ...operation.after,
        entityId: createdId != null ? String(createdId) : null,
        fields: operation.after?.fields || execPlan.fields,
      },
    });

    itemStats.ok += 1;
    return { result: { ...result, createdId }, itemStats };
  }

  throw new Error(`Unsupported execPlan kind: ${execPlan.kind}`);
}

export async function cancelAction(confirmationId, context = {}) {
  if (!confirmationId) {
    return safetyError("CONFIRMATION_ID_REQUIRED", "confirmationId обязателен.");
  }

  const operation = getOperationByConfirmationId(confirmationId);
  if (!operation) {
    return safetyError("OPERATION_NOT_FOUND", "Операция не найдена.");
  }

  if (operation.status !== "pending_confirmation") {
    return safetyError("OPERATION_INVALID_STATUS", `Нельзя отменить операцию в статусе ${operation.status}`);
  }

  updateOperation(operation.id, {
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
  });
  addOperationEvent(operation.id, "cancelled", { source: context.source });
  notifyChatAboutOperation(operation, {
    kind: "result",
    text: "Действие отменено пользователем.",
  });

  return {
    success: true,
    status: "cancelled",
    confirmationId,
    operationId: operation.id,
  };
}

/**
 * Prepare rollback — тоже через confirmation.
 */
export async function prepareRollback(operationId, context = {}) {
  const { source = "unknown", sessionId = null } = context;
  const operation = getOperationById(operationId);
  if (!operation) {
    return safetyError("OPERATION_NOT_FOUND", "Операция не найдена.");
  }

  if (!["completed", "partially_completed", "rollback_pending"].includes(operation.status)) {
    return safetyError("ROLLBACK_NOT_AVAILABLE", "Откат недоступен для текущего статуса операции.");
  }

  if (operation.reversible === "false") {
    return {
      success: false,
      rollbackAvailable: false,
      reason: "Операция не поддерживает откат.",
      error: {
        code: "ROLLBACK_NOT_AVAILABLE",
        message: "Операция не поддерживает откат.",
      },
    };
  }

  const execPlan = operation.params?.__execPlan;
  const rollbackPlan = await buildRollbackPlan(operation, execPlan);
  if (!rollbackPlan.available) {
    return {
      success: false,
      rollbackAvailable: false,
      reason: rollbackPlan.reason,
      error: {
        code: "ROLLBACK_NOT_AVAILABLE",
        message: rollbackPlan.reason,
      },
    };
  }

  const expiresAt = confirmationExpiresAt();
  const params = {
    __rollbackOf: operation.id,
    __execPlan: rollbackPlan.execPlan,
  };

  const planHash = computePlanHash({
    action: `rollback:${operation.action}`,
    params,
    entityIds: rollbackPlan.entityIds,
    before: rollbackPlan.before,
    after: rollbackPlan.after,
    affectedCount: rollbackPlan.affectedCount,
  });

  const rollbackOp = createOperation({
    confirmationId: crypto.randomUUID(),
    action: `rollback:${operation.action}`,
    accessType: "write",
    riskLevel: "high",
    status: "pending_confirmation",
    reversible: "false",
    source,
    sessionId,
    params,
    preview: {
      title: `Откат: ${operation.preview?.title || operation.action}`,
      entity: operation.preview?.entity || null,
      changes: rollbackPlan.changes,
      affectedCount: rollbackPlan.affectedCount,
      risk: "high",
      reversible: false,
      expiresAt,
    },
    before: rollbackPlan.before,
    after: rollbackPlan.after,
    planHash,
    expiresAt,
    items: rollbackPlan.items,
  });

  addOperationEvent(operation.id, "rollback_prepared", {
    rollbackConfirmationId: rollbackOp.confirmationId,
  });

  return {
    success: true,
    status: "confirmation_required",
    confirmationId: rollbackOp.confirmationId,
    expiresAt,
    rollbackOf: operation.id,
    preview: rollbackOp.preview,
    operation: {
      id: rollbackOp.id,
      risk: "high",
      affectedCount: rollbackPlan.affectedCount,
      reversible: false,
    },
  };
}

async function buildRollbackPlan(operation, execPlan) {
  if (!execPlan) {
    return { available: false, reason: "Нет сохранённого плана для отката." };
  }

  if (execPlan.kind === "entity_update" || execPlan.kind === "task_update") {
    const beforeFields = operation.before?.fields || {};
    const afterFields = operation.after?.fields || {};
    const entityType = execPlan.entityType || operation.before?.entityType;
    const entityId = execPlan.entityId || operation.before?.entityId;

    // Conflict check: current should still match after
    let current;
    if (execPlan.kind === "task_update") {
      current = await fetchTask(entityId);
    } else {
      current = await fetchCrmEntity(entityType, entityId);
    }

    const conflictingFields = [];
    for (const field of Object.keys(afterFields)) {
      const expected = afterFields[field];
      const actual = getField(current, field);
      if (JSON.stringify(expected ?? null) !== JSON.stringify(actual ?? null)) {
        conflictingFields.push(field);
      }
    }

    if (conflictingFields.length) {
      updateOperation(operation.id, { status: "rollback_conflict" });
      addOperationEvent(operation.id, "rollback_conflict", { conflictingFields });
      return {
        available: false,
        reason: "После операции данные были дополнительно изменены. Автоматический откат остановлен.",
        conflictingFields,
      };
    }

    const changes = Object.keys(beforeFields).map((field) => ({
      field,
      fieldName: field,
      before: afterFields[field] ?? null,
      after: beforeFields[field] ?? null,
    }));

    return {
      available: true,
      reason: null,
      changes,
      before: { entityType, entityId, fields: afterFields },
      after: { entityType, entityId, fields: beforeFields },
      items: [
        {
          entityType,
          entityId: String(entityId),
          before: afterFields,
          after: beforeFields,
          status: "pending",
        },
      ],
      entityIds: [String(entityId)],
      affectedCount: 1,
      execPlan: {
        kind: execPlan.kind,
        entityType,
        entityId,
        fields: beforeFields,
      },
    };
  }

  if (execPlan.kind === "entity_create" || execPlan.kind === "task_create") {
    const createdId = operation.after?.entityId;
    if (!createdId) {
      return { available: false, reason: "Не удалось определить ID созданной сущности." };
    }

    const entityType = execPlan.entityType || (execPlan.kind === "task_create" ? "task" : null);
    let current;
    try {
      current =
        entityType === "task" ? await fetchTask(createdId) : await fetchCrmEntity(entityType, createdId);
    } catch {
      return { available: false, reason: "Созданная сущность не найдена." };
    }

    // Conditional: entity must not have been further modified beyond create fields
    const createdFields = operation.after?.fields || execPlan.fields || {};
    const watchFields = Object.keys(createdFields);
    const conflictingFields = [];
    for (const field of watchFields) {
      const expected = createdFields[field];
      const actual = getField(current, field);
      if (expected != null && JSON.stringify(expected) !== JSON.stringify(actual ?? null)) {
        conflictingFields.push(field);
      }
    }

    if (conflictingFields.length) {
      return {
        available: false,
        reason: "Созданная сущность была изменена после выполнения операции.",
        conflictingFields,
      };
    }

    return {
      available: true,
      reason: null,
      changes: [
        {
          field: "_delete",
          fieldName: "Удаление созданной записи",
          before: "существует",
          after: "будет удалено",
        },
      ],
      before: { entityType, entityId: String(createdId), fields: pickSafe(current) },
      after: { entityType, entityId: String(createdId), deleted: true },
      items: [
        {
          entityType,
          entityId: String(createdId),
          before: pickSafe(current),
          after: { deleted: true },
          status: "pending",
        },
      ],
      entityIds: [String(createdId)],
      affectedCount: 1,
      execPlan: {
        kind: "entity_delete",
        entityType,
        entityId: String(createdId),
      },
    };
  }

  return { available: false, reason: "Откат для этого типа операции не поддерживается." };
}

function pickSafe(entity) {
  if (!entity) return {};
  const out = {};
  for (const key of ["ID", "id", "TITLE", "title", "STAGE_ID", "STATUS_ID", "ASSIGNED_BY_ID"]) {
    if (entity[key] !== undefined) out[key] = entity[key];
  }
  return redactObject(out);
}

export async function commitRollback(confirmationId, context = {}) {
  try {
    const { assertWritesAllowed } = await import("../observability/operationalModes.js");
    assertWritesAllowed("bitrix_write");
  } catch (error) {
    if (error?.code) {
      return safetyError(error.code, error.message);
    }
    throw error;
  }
  const result = await commitAction(confirmationId, context);
  if (!result.success) {
    if (result.error?.code === "OPERATION_STATE_CHANGED") {
      return safetyError(
        "ROLLBACK_CONFLICT",
        "После операции данные были дополнительно изменены. Автоматический откат остановлен.",
        result.error.details
      );
    }
    return result;
  }

  const rollbackOp = getOperationByConfirmationId(confirmationId);
  const originalId = rollbackOp?.params?.__rollbackOf;
  if (originalId && result.success) {
    updateOperation(originalId, {
      status: "rolled_back",
      rolledBackAt: new Date().toISOString(),
    });
    addOperationEvent(originalId, "rolled_back", {
      rollbackOperationId: rollbackOp.id,
    });
  }

  return result;
}

function stripExecPlan(params) {
  if (!params || typeof params !== "object") return {};
  const { __execPlan, __rollbackOf, ...rest } = params;
  return rest;
}

function collectEntityIds(operation) {
  if (operation.before?.entityId != null) return [String(operation.before.entityId)];
  if (Array.isArray(operation.before?.items)) {
    return operation.before.items.map((i) => i.entityId).filter(Boolean).map(String);
  }
  const items = getOperationItems(operation.id);
  return items.map((i) => i.entityId).filter(Boolean).map(String);
}

export function listPublicOperations(filters = {}) {
  const { user, ...rest } = filters;
  const ops = listOperations(rest);
  let list = ops.map((op) => {
    const items = getOperationItems(op.id);
    return toPublicOperationSummary(op, items);
  });
  if (user && !user.isLocalOnlySynthetic) {
    const canAll =
      user.permissions?.has?.("operations.view.all") ||
      user.role === "administrator" ||
      user.role === "director";
    if (!canAll) {
      list = list.filter((op) => {
        const initiator = op.initiatedByUserId || op.initiatedBy?.userId;
        const confirmer = op.confirmedByUserId;
        return initiator === user.userId || confirmer === user.userId;
      });
    }
  }
  return list;
}

export function getPublicOperation(id, user = null) {
  const op = getOperationById(id);
  if (!op) return null;
  if (user && !user.isLocalOnlySynthetic) {
    const canAll =
      user.permissions?.has?.("operations.view.all") ||
      user.role === "administrator" ||
      user.role === "director";
    const initiator = op.initiatedByUserId;
    const confirmer = op.confirmedByUserId;
    if (!canAll && initiator !== user.userId && confirmer !== user.userId) {
      return null;
    }
  }
  const items = getOperationItems(op.id);
  const events = getOperationEvents(op.id);
  return toPublicOperationDetail(op, items, events);
}
