/**
 * Конфигурация методологии контактов (только через env, без хардкода ID портала).
 */

function parseCsvIds(value) {
  if (!value || !String(value).trim()) return [];
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseCsvPatterns(value, fallback = []) {
  if (!value || !String(value).trim()) return [...fallback];
  return String(value)
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

/** Конфиг методологии контактов из process.env. */
export function getContactMethodologyConfig() {
  return {
    statusField: (process.env.BITRIX_CONTACT_STATUS_FIELD || "").trim() || null,
    warmupField:
      (process.env.BITRIX_CONTACT_WARMUP_FIELD || process.env.BITRIX_CONTACT_WARMUP_STEP_FIELD || "").trim() ||
      null,
    birthdayField: (process.env.BITRIX_CONTACT_BIRTHDAY_FIELD || "BIRTHDATE").trim() || "BIRTHDATE",
    statusWarmupValues: parseCsvIds(process.env.BITRIX_CONTACT_STATUS_WARMUP_VALUES),
    statusCycleValues: parseCsvIds(process.env.BITRIX_CONTACT_STATUS_CYCLE_VALUES),
    statusCommunicationValues: parseCsvIds(process.env.BITRIX_CONTACT_STATUS_COMMUNICATION_VALUES),
    statusLeadValues: parseCsvIds(process.env.BITRIX_CONTACT_STATUS_LEAD_VALUES),
    statusCongratsOnlyValues: parseCsvIds(process.env.BITRIX_CONTACT_STATUS_CONGRATS_ONLY_VALUES),
    statusNoContactValues: parseCsvIds(process.env.BITRIX_CONTACT_STATUS_NO_CONTACT_VALUES),
    statusPersonalValues: parseCsvIds(process.env.BITRIX_CONTACT_STATUS_PERSONAL_VALUES),
    statusSpamValues: parseCsvIds(process.env.BITRIX_CONTACT_STATUS_SPAM_VALUES),
    statusDoNotContactValues: parseCsvIds(process.env.BITRIX_CONTACT_STATUS_DO_NOT_CONTACT_VALUES),
    birthdayActivityPatterns: parseCsvPatterns(process.env.BITRIX_BIRTHDAY_ACTIVITY_PATTERNS, [
      "день рождения",
      "поздравить",
      "поздравление",
    ]),
  };
}

export function configError(code, message, details = {}) {
  return {
    success: false,
    error: {
      code,
      message,
      details,
    },
  };
}

export function requireStatusField(config = getContactMethodologyConfig()) {
  if (!config.statusField) {
    return configError(
      "CONTACT_STATUS_FIELD_NOT_CONFIGURED",
      "Не настроено пользовательское поле статуса контакта.",
      { recommendedAction: "contact_field_audit", env: "BITRIX_CONTACT_STATUS_FIELD" }
    );
  }
  return null;
}

export function requireCycleValues(config = getContactMethodologyConfig()) {
  const statusError = requireStatusField(config);
  if (statusError) return statusError;
  if (!config.statusCycleValues.length) {
    return configError(
      "CONTACT_STATUS_CYCLE_VALUES_NOT_CONFIGURED",
      "Не настроены значения статуса «Цикл».",
      {
        recommendedAction: "contact_field_audit",
        env: "BITRIX_CONTACT_STATUS_CYCLE_VALUES",
      }
    );
  }
  return null;
}
