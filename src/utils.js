// Ключи, которые не должны попадать в логи
const SECRET_KEYS = new Set([
  "authorization",
  "api_key",
  "apikey",
  "token",
  "secret",
  "password",
  "x-api-key",
  "anthropic_api_key",
  "bitrix_webhook_url",
]);

// In-memory защита от повторной обработки одной сделки
const recentDealEvents = new Map();
const DUPLICATE_TTL_MS = 60_000;

/**
 * Логирует объект, скрывая потенциально секретные поля.
 */
export function safeLogObject(label, object) {
  const sanitized = sanitizeObject(object);
  console.log(label, JSON.stringify(sanitized, null, 2));
}

function sanitizeObject(value, depth = 0) {
  if (depth > 5) return "[max depth]";
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeObject(item, depth + 1));
  }

  const result = {};
  for (const [key, val] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    if (SECRET_KEYS.has(lowerKey) || lowerKey.includes("token") || lowerKey.includes("secret")) {
      result[key] = "[hidden]";
      continue;
    }
    if (typeof val === "string" && val.includes("bitrix24") && val.includes("/rest/")) {
      result[key] = "[hidden webhook url]";
      continue;
    }
    result[key] = sanitizeObject(val, depth + 1);
  }
  return result;
}

/**
 * Извлекает ID сделки из разных форматов payload исходящего вебхука Bitrix24.
 */
export function extractDealIdFromEvent(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidates = [
    payload?.data?.FIELDS?.ID,
    payload?.data?.ID,
    payload?.FIELDS?.ID,
    payload?.ID,
    extractFromDocumentId(payload?.document_id),
    payload?.entity_id,
  ];

  for (const candidate of candidates) {
    const id = normalizeDealId(candidate);
    if (id !== null) {
      return id;
    }
  }

  return null;
}

function extractFromDocumentId(documentId) {
  if (documentId === undefined || documentId === null) {
    return null;
  }

  if (Array.isArray(documentId)) {
    // Пробуем последний элемент массива
    const last = documentId[documentId.length - 1];
    const fromLast = normalizeDealId(last);
    if (fromLast !== null) {
      return fromLast;
    }

    // Ищем первое число в массиве
    for (const item of documentId) {
      const id = normalizeDealId(item);
      if (id !== null) {
        return id;
      }
    }
    return null;
  }

  return normalizeDealId(documentId);
}

function normalizeDealId(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value));
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      return trimmed;
    }

    // Иногда document_id приходит как "DEAL_123"
    const match = trimmed.match(/(\d+)$/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Проверяет, не обрабатывалась ли сделка недавно (защита от дублей событий).
 */
export function isDuplicateDealEvent(dealId) {
  const key = String(dealId);
  const now = Date.now();
  const lastSeen = recentDealEvents.get(key);

  if (lastSeen && now - lastSeen < DUPLICATE_TTL_MS) {
    return true;
  }

  recentDealEvents.set(key, now);

  // Периодическая очистка устаревших записей
  for (const [id, timestamp] of recentDealEvents.entries()) {
    if (now - timestamp >= DUPLICATE_TTL_MS) {
      recentDealEvents.delete(id);
    }
  }

  return false;
}

/**
 * Проверяет токен исходящего вебхука Bitrix24, если он задан в .env.
 */
export function verifyOutboundToken(payload) {
  const expectedToken = process.env.BITRIX_OUTBOUND_TOKEN;

  if (!expectedToken) {
    return { ok: true };
  }

  const receivedToken =
    payload?.auth?.application_token ??
    payload?.application_token ??
    payload?.token;

  if (!receivedToken) {
    return {
      ok: false,
      error: "Outbound webhook token is missing in request",
    };
  }

  if (receivedToken !== expectedToken) {
    return {
      ok: false,
      error: "Invalid outbound webhook token",
    };
  }

  return { ok: true };
}
