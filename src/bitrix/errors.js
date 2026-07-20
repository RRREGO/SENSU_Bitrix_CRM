/**
 * Нормализация ошибок Bitrix24 REST.
 */

export class BitrixAppError extends Error {
  constructor(code, message, { httpStatus = null, retryable = false, details = undefined } = {}) {
    super(message);
    this.name = "BitrixAppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
    this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

const USER_MESSAGES = {
  BITRIX_NETWORK_ERROR: "Не удалось связаться с Bitrix24. Повторите попытку позже.",
  BITRIX_TIMEOUT: "Превышено время ожидания ответа Bitrix24.",
  BITRIX_RATE_LIMITED: "Bitrix24 временно ограничил частоту запросов. Повторите позже.",
  BITRIX_TEMPORARY_ERROR: "Временная ошибка Bitrix24. Повторите попытку позже.",
  BITRIX_INVALID_JSON: "Bitrix24 вернул некорректный ответ. Повторите попытку позже.",
  BITRIX_ACCESS_DENIED: "Недостаточно прав для выполнения запроса к Bitrix24.",
  BITRIX_INSUFFICIENT_SCOPE: "У webhook Bitrix24 недостаточно прав (scope).",
  BITRIX_INVALID_PARAMETER: "Некорректные параметры запроса к Bitrix24.",
  BITRIX_ENTITY_NOT_FOUND: "Сущность Bitrix24 не найдена.",
  WRITE_RESULT_UNKNOWN:
    "Не удалось определить результат изменяющего запроса. Требуется проверка состояния CRM.",
};

function detectBizError(raw) {
  const text = String(raw || "").toLowerCase();
  if (/access denied|access_denied|permission|права/.test(text)) {
    return "BITRIX_ACCESS_DENIED";
  }
  if (/insufficient_scope|wrong_auth_type|no auth|scope/.test(text)) {
    return "BITRIX_INSUFFICIENT_SCOPE";
  }
  if (/not found|not_found|entity not found|не найден/.test(text)) {
    return "BITRIX_ENTITY_NOT_FOUND";
  }
  if (/invalid|argument|parameter|wrong|обязател/.test(text)) {
    return "BITRIX_INVALID_PARAMETER";
  }
  return null;
}

/**
 * @param {unknown} error
 * @param {{ method?: string, httpStatus?: number, phase?: string }} [context]
 * @returns {BitrixAppError}
 */
export function normalizeBitrixError(error, context = {}) {
  if (error instanceof BitrixAppError) return error;

  const httpStatus = context.httpStatus ?? error?.httpStatus ?? null;
  const rawMessage = error?.message || String(error || "Unknown error");
  const lower = rawMessage.toLowerCase();

  let code = "BITRIX_TEMPORARY_ERROR";
  let retryable = false;

  if (error?.name === "AbortError" || /timeout|aborted/.test(lower)) {
    code = "BITRIX_TIMEOUT";
    retryable = true;
  } else if (/network error|fetch failed|econnreset|enotfound|econnrefused|socket/.test(lower)) {
    code = "BITRIX_NETWORK_ERROR";
    retryable = true;
  } else if (/invalid json|unexpected token|empty response/.test(lower)) {
    code = "BITRIX_INVALID_JSON";
    retryable = true;
  } else if (httpStatus === 429 || /rate limit|too many requests|query_limit/.test(lower)) {
    code = "BITRIX_RATE_LIMITED";
    retryable = true;
  } else if ([502, 503, 504].includes(Number(httpStatus)) || /bad gateway|unavailable|gateway/.test(lower)) {
    code = "BITRIX_TEMPORARY_ERROR";
    retryable = true;
  } else {
    const biz = detectBizError(rawMessage);
    if (biz) {
      code = biz;
      retryable = false;
    } else if (error?.code === "WRITE_RESULT_UNKNOWN") {
      code = "WRITE_RESULT_UNKNOWN";
      retryable = false;
    }
  }

  const message = USER_MESSAGES[code] || USER_MESSAGES.BITRIX_TEMPORARY_ERROR;
  console.warn(
    `[Bitrix] method=${context.method || "—"} code=${code} retryable=${retryable} raw=${rawMessage.slice(0, 200)}`
  );

  return new BitrixAppError(code, message, {
    httpStatus,
    retryable,
    details: {
      method: context.method || null,
      phase: context.phase || null,
      technical: rawMessage.slice(0, 300),
    },
  });
}

export function isRetryableBitrixError(error) {
  const normalized = normalizeBitrixError(error);
  return normalized.retryable;
}
