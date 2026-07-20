/**
 * Восстановление pending/interrupted operations после рестарта.
 */

import {
  listOperations,
  getOperationById,
  getOperationItems,
  updateOperation,
  addOperationEvent,
  toPublicOperationDetail,
} from "../database/repositories/operationsRepository.js";

const PENDING_STATUSES = [
  "pending_confirmation",
  "rollback_pending_confirmation",
  "executing",
  "partially_completed",
];

function isExpired(operation, now = Date.now()) {
  if (!operation.expiresAt) return false;
  return new Date(operation.expiresAt).getTime() < now;
}

/**
 * На старте сервера: expire TTL, mark interrupted executing as recovery_required.
 * Не повторяет write автоматически.
 */
export function recoverOperationsOnStartup() {
  const ops = listOperations({ limit: 500 });
  const summary = {
    expired: 0,
    recoveryRequired: 0,
    pendingAlive: 0,
  };

  for (const op of ops) {
    if (!PENDING_STATUSES.includes(op.status) && op.status !== "executing") continue;

    if (op.status === "pending_confirmation" || op.status === "rollback_pending_confirmation") {
      if (isExpired(op)) {
        updateOperation(op.id, { status: "expired" });
        addOperationEvent(op.id, "expired_after_restart", {
          previousStatus: op.status,
        });
        summary.expired += 1;
      } else {
        summary.pendingAlive += 1;
      }
      continue;
    }

    if (op.status === "executing") {
      // Interrupted crash — never auto-retry write
      updateOperation(op.id, {
        status: "recovery_required",
        error: {
          code: "RECOVERY_REQUIRED",
          message:
            "Выполнение операции было прервано. Автоматический повтор не выполняется. Требуется проверка состояния CRM.",
        },
      });
      addOperationEvent(op.id, "recovery_required_after_restart", {
        previousStatus: "executing",
        hasResult: op.result != null,
        itemCount: getOperationItems(op.id).length,
      });
      summary.recoveryRequired += 1;
    }

    if (op.status === "partially_completed") {
      // Keep as-is; already visible to operators
      summary.pendingAlive += 1;
    }
  }

  console.log(
    `[Recovery] pendingAlive=${summary.pendingAlive} expired=${summary.expired} recoveryRequired=${summary.recoveryRequired}`
  );
  return summary;
}

export function listPendingOperations({ limit = 50 } = {}) {
  const statuses = [
    "pending_confirmation",
    "rollback_pending_confirmation",
    "partially_completed",
    "recovery_required",
    "verification_required",
  ];
  const out = [];
  for (const status of statuses) {
    const rows = listOperations({ status, limit });
    out.push(...rows);
  }
  return out
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit)
    .map((op) => {
      const full = getOperationById(op.id);
      const items = getOperationItems(op.id);
      return toPublicOperationDetail(full, items);
    });
}

export function getRecoveryCounts() {
  const pending = listOperations({ status: "pending_confirmation", limit: 200 }).length;
  const rollbackPending = listOperations({
    status: "rollback_pending_confirmation",
    limit: 200,
  }).length;
  const recoveryRequired = listOperations({ status: "recovery_required", limit: 200 }).length;
  const verificationRequired = listOperations({
    status: "verification_required",
    limit: 200,
  }).length;
  return {
    pendingOperations: pending + rollbackPending,
    recoveryRequired,
    verificationRequired,
  };
}

/**
 * Analyze interrupted operation — never mutates CRM.
 */
export function analyzeOperationRecovery(operationId) {
  const operation = getOperationById(operationId);
  if (!operation) {
    return {
      success: false,
      error: { code: "OPERATION_NOT_FOUND", message: "Операция не найдена." },
    };
  }

  const items = getOperationItems(operationId);
  const hasResult = operation.result != null;
  const hasItemsCompleted = items.some((i) => i.status === "completed");
  const hasItemsPending = items.some((i) => i.status === "pending");

  let recommendedAction = "manual_review";
  const options = [];

  if (operation.status === "pending_confirmation" && !isExpired(operation)) {
    recommendedAction = "continue";
    options.push("continue", "cancel");
  } else if (operation.status === "pending_confirmation" && isExpired(operation)) {
    recommendedAction = "cancel";
    options.push("cancel");
  } else if (operation.status === "recovery_required" || operation.status === "verification_required") {
    if (hasResult && !hasItemsPending) {
      recommendedAction = "mark_completed";
      options.push("mark_completed", "manual_review", "prepare_rollback");
    } else if (hasItemsCompleted && hasItemsPending) {
      recommendedAction = "manual_review";
      options.push("manual_review", "prepare_rollback");
    } else {
      recommendedAction = "manual_review";
      options.push("manual_review", "cancel");
    }
  } else if (operation.status === "partially_completed") {
    recommendedAction = "prepare_rollback";
    options.push("prepare_rollback", "manual_review");
  } else if (["completed", "rolled_back"].includes(operation.status)) {
    recommendedAction = "mark_completed";
    options.push("mark_completed");
  }

  return {
    success: true,
    operationId: operation.id,
    status: operation.status,
    recommendedAction,
    options,
    analysis: {
      hasResult,
      hasItemsCompleted,
      hasItemsPending,
      itemCount: items.length,
      chatId: operation.chatId || null,
      crmChangedUnknown: operation.status === "recovery_required" || operation.status === "verification_required",
      canSafelyDetermineState: Boolean(hasResult && !hasItemsPending),
    },
    note:
      "recover не изменяет CRM автоматически. Выберите действие вручную после проверки.",
  };
}
