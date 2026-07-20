/**
 * Внутренний контекст выполнения write-операций.
 * executionToken генерируется только сервером и живёт в AsyncLocalStorage
 * на время commit — клиент не может его подставить.
 */

import { AsyncLocalStorage } from "async_hooks";
import crypto from "crypto";

const storage = new AsyncLocalStorage();
/** @type {Set<string>} */
const liveTokens = new Set();

export function createExecutionToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * @param {{
 *  operationId: string,
 *  confirmationId?: string,
 *  action: string,
 *  source?: string,
 * }} context
 * @param {(ctx: object) => Promise<any>} fn
 */
export async function runWithSafetyContext(context, fn) {
  const executionToken = createExecutionToken();
  const full = {
    operationId: context.operationId,
    confirmationId: context.confirmationId || null,
    action: context.action,
    source: context.source || "executor",
    executionToken,
    startedAt: Date.now(),
  };

  liveTokens.add(executionToken);
  try {
    return await storage.run(full, () => fn(full));
  } finally {
    liveTokens.delete(executionToken);
  }
}

export function getSafetyExecutionContext() {
  return storage.getStore() || null;
}

export function hasValidSafetyExecutionContext() {
  const ctx = getSafetyExecutionContext();
  return Boolean(ctx?.executionToken && liveTokens.has(ctx.executionToken));
}

/**
 * Удаляет попытки подставить executionToken из пользовательских params.
 */
export function stripClientExecutionToken(params) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return params;
  }
  const {
    executionToken: _t,
    safetyExecutionId: _s,
    __executionToken: _u,
    ...rest
  } = params;
  return rest;
}

export class WriteOutsideSafetyError extends Error {
  constructor(method) {
    super(
      "Изменяющий вызов Bitrix24 заблокирован: отсутствует контекст безопасной операции."
    );
    this.name = "WriteOutsideSafetyError";
    this.code = "WRITE_CALL_OUTSIDE_SAFETY_EXECUTOR";
    this.method = method;
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        details: { method: this.method },
      },
    };
  }
}
