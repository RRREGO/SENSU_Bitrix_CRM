/**
 * Клиент Bitrix24 REST API.
 * Read: retry + timeout. Write: no blind retry; unknown network result → WRITE_RESULT_UNKNOWN.
 */

import {
  isWriteMethod,
  isReadMethod,
  classifyBitrixMethod,
  batchContainsWrite,
} from "./safety/writeMethods.js";
import {
  getSafetyExecutionContext,
  hasValidSafetyExecutionContext,
  WriteOutsideSafetyError,
} from "./safety/executionContext.js";
import { normalizeBitrixError, BitrixAppError, isRetryableBitrixError } from "./bitrix/errors.js";
import { withRetry, getBitrixRetryConfig } from "./bitrix/retry.js";

let lastReadStatus = "unknown";

export function getLastBitrixReadStatus() {
  return lastReadStatus;
}

function getWebhookUrl() {
  const url = process.env.BITRIX_WEBHOOK_URL;
  if (!url || !url.trim()) {
    throw new Error("BITRIX_WEBHOOK_URL is not configured");
  }
  return url.endsWith("/") ? url : `${url}/`;
}

async function requestBitrixOnce(method, params = {}, { signal = undefined, classifyAsWrite = false } = {}) {
  const webhookUrl = getWebhookUrl();
  const url = `${webhookUrl}${method}.json`;

  console.log(`Запрос к Bitrix24 отправлен: ${method}`);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal,
    });
  } catch (error) {
    const normalized = normalizeBitrixError(error, { method, phase: "network" });
    if (classifyAsWrite && (normalized.code === "BITRIX_NETWORK_ERROR" || normalized.code === "BITRIX_TIMEOUT")) {
      throw new BitrixAppError("WRITE_RESULT_UNKNOWN", normalized.message, {
        retryable: false,
        details: { method, technical: error.message },
      });
    }
    throw normalized;
  }

  let rawText = "";
  try {
    rawText = await response.text();
  } catch (error) {
    throw normalizeBitrixError(error, { method, httpStatus: response.status, phase: "body" });
  }

  if (!rawText || !rawText.trim()) {
    throw normalizeBitrixError(new Error("empty response"), {
      method,
      httpStatus: response.status,
      phase: "empty",
    });
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw normalizeBitrixError(new Error("invalid JSON"), {
      method,
      httpStatus: response.status,
      phase: "json",
    });
  }

  if (!response.ok) {
    const message = data?.error_description || data?.error || `HTTP ${response.status}`;
    throw normalizeBitrixError(new Error(message), {
      method,
      httpStatus: response.status,
      phase: "http",
    });
  }

  if (data.error || data.error_description) {
    const message = data.error_description || data.error;
    throw normalizeBitrixError(new Error(String(message)), {
      method,
      httpStatus: response.status,
      phase: "api",
    });
  }

  return data;
}

/**
 * Низкоуровневый запрос. mode: read | write
 */
export async function requestBitrix(method, params = {}, { mode = "read" } = {}) {
  if (mode === "write") {
    try {
      return await requestBitrixOnce(method, params, { classifyAsWrite: true });
    } catch (error) {
      throw normalizeBitrixError(error, { method, phase: "write" });
    }
  }

  try {
    const data = await withRetry(
      (signal) => requestBitrixOnce(method, params, { signal }),
      {
        label: method,
        shouldRetry: (error) => isRetryableBitrixError(error),
      }
    );
    lastReadStatus = "ok";
    return data;
  } catch (error) {
    lastReadStatus = "error";
    throw normalizeBitrixError(error, { method, phase: "read" });
  }
}

function assertNoClientToken(options = {}) {
  if (
    options.executionToken != null ||
    options.safetyExecutionId != null ||
    options.__executionToken != null
  ) {
    throw new WriteOutsideSafetyError("client_supplied_token");
  }
}

function requireSafetyContext(method) {
  if (!hasValidSafetyExecutionContext()) {
    throw new WriteOutsideSafetyError(method);
  }
  const ctx = getSafetyExecutionContext();
  console.log(
    `[Safety] write method=${method} operationId=${ctx.operationId} action=${ctx.action}`
  );
}

export async function callReadMethod(method, params = {}) {
  if (method === "batch") {
    if (batchContainsWrite(params.cmd)) {
      throw new WriteOutsideSafetyError("batch");
    }
    const data = await requestBitrix(method, params, { mode: "read" });
    return data.result !== undefined ? data.result : data;
  }

  const kind = classifyBitrixMethod(method);
  if (kind !== "read") {
    throw new WriteOutsideSafetyError(method);
  }
  const data = await requestBitrix(method, params, { mode: "read" });
  return data.result !== undefined ? data.result : data;
}

export async function callWriteMethod(method, params = {}, options = {}) {
  assertNoClientToken(options);
  requireSafetyContext(method);
  // No automatic write retry: unknown network outcome is WRITE_RESULT_UNKNOWN.
  const data = await requestBitrix(method, params, { mode: "write" });
  return data.result !== undefined ? data.result : data;
}

export async function callBitrixMethod(method, params = {}, options = {}) {
  assertNoClientToken(options);

  if (method === "batch") {
    if (batchContainsWrite(params.cmd)) {
      return callWriteMethod(method, params, options);
    }
    return callReadMethod("batch", params);
  }

  if (isWriteMethod(method)) {
    return callWriteMethod(method, params, options);
  }
  return callReadMethod(method, params);
}

export async function callBitrixMethodFull(method, params = {}, options = {}) {
  assertNoClientToken(options);

  if (isWriteMethod(method)) {
    requireSafetyContext(method);
  } else if (classifyBitrixMethod(method) === "unknown") {
    requireSafetyContext(method);
  }

  const mode = isWriteMethod(method) ? "write" : "read";
  const data = await requestBitrix(method, params, { mode });
  return {
    result: data.result !== undefined ? data.result : data,
    next: data.next ?? null,
    total: data.total ?? null,
  };
}

export async function callBitrixBatch(calls, options = {}) {
  return callBitrixMethod(
    "batch",
    {
      halt: options.halt ?? 0,
      cmd: calls,
    },
    options
  );
}

export async function getDeal(dealId) {
  try {
    return await callReadMethod("crm.item.get", {
      entityTypeId: 2,
      id: Number(dealId),
    });
  } catch (error) {
    if (error instanceof WriteOutsideSafetyError) throw error;
    console.warn("crm.item.get failed, trying crm.deal.get fallback:", error.message);
    return callReadMethod("crm.deal.get", {
      id: Number(dealId),
    });
  }
}

export async function addDealTimelineComment(dealId, comment) {
  const primaryPayload = {
    fields: {
      ENTITY_ID: Number(dealId),
      ENTITY_TYPE: "deal",
      COMMENT: comment,
    },
  };

  try {
    const result = await callWriteMethod("crm.timeline.comment.add", primaryPayload);
    console.log("Комментарий в Bitrix24 добавлен (ENTITY_ID/ENTITY_TYPE)");
    return result;
  } catch (primaryError) {
    if (primaryError instanceof WriteOutsideSafetyError) throw primaryError;
    if (primaryError?.code === "WRITE_RESULT_UNKNOWN") throw primaryError;
    console.warn("crm.timeline.comment.add primary format failed:", primaryError.message);

    const fallbackPayload = {
      fields: {
        OWNER_ID: Number(dealId),
        OWNER_TYPE: "DEAL",
        COMMENT: comment,
      },
    };

    try {
      const result = await callWriteMethod("crm.timeline.comment.add", fallbackPayload);
      console.log("Комментарий в Bitrix24 добавлен (OWNER_ID/OWNER_TYPE)");
      return result;
    } catch (fallbackError) {
      if (fallbackError instanceof WriteOutsideSafetyError) throw fallbackError;
      throw new Error(
        `Не удалось добавить комментарий в таймлайн сделки. ` +
          `Primary: ${primaryError.message}. Fallback: ${fallbackError.message}`
      );
    }
  }
}

export {
  isWriteMethod,
  isReadMethod,
  classifyBitrixMethod,
  WriteOutsideSafetyError,
  BitrixAppError,
  getBitrixRetryConfig,
};
