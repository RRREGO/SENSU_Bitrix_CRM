/**
 * Редактирование секретов перед записью в audit/SQLite.
 */

const SENSITIVE_KEY =
  /(PHONE|EMAIL|MAIL|WEBHOOK|TOKEN|PASSWORD|SECRET|API[_-]?KEY|PROXY|AUTHORIZATION|COOKIE|CARD|PASSPORT)/i;

const SENSITIVE_VALUE =
  /(https?:\/\/[^\s]+\/rest\/[^\s]+)|(sk-ant-[a-zA-Z0-9_-]+)|(Bearer\s+\S+)/i;

export function redactValue(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    if (SENSITIVE_VALUE.test(value)) return "[redacted]";
    if (value.length > 500) return `${value.slice(0, 200)}…[truncated]`;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (typeof value === "object") {
    return redactObject(value);
  }
  return value;
}

export function redactObject(input) {
  if (input == null || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(redactValue);

  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = "[redacted]";
    } else {
      out[key] = redactValue(value);
    }
  }
  return out;
}

/**
 * Оставляет только указанные поля сущности для before/after.
 */
export function pickFields(entity, fields) {
  if (!entity || typeof entity !== "object") return {};
  const out = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(entity, field)) {
      out[field] = entity[field];
    } else {
      const upper = String(field).toUpperCase();
      const lower = String(field).toLowerCase();
      if (Object.prototype.hasOwnProperty.call(entity, upper)) out[field] = entity[upper];
      else if (Object.prototype.hasOwnProperty.call(entity, lower)) out[field] = entity[lower];
    }
  }
  return redactObject(out);
}
