/**
 * Конфигурация safety layer из .env
 */

function boolEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

function intEnv(name, defaultValue) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultValue;
}

export function getSafetyConfig() {
  return {
    bulkEnabled: boolEnv("BITRIX_BULK_ACTIONS_ENABLED", false),
    bulkMaxItems: intEnv("BITRIX_BULK_MAX_ITEMS", 20),
    bulkChunkSize: intEnv("BITRIX_BULK_CHUNK_SIZE", 10),
    confirmationTtlMinutes: intEnv("BITRIX_CONFIRMATION_TTL_MINUTES", 15),
    rollbackTtlHours: intEnv("BITRIX_ROLLBACK_TTL_HOURS", 24),
  };
}

export function confirmationExpiresAt(from = new Date()) {
  const { confirmationTtlMinutes } = getSafetyConfig();
  return new Date(from.getTime() + confirmationTtlMinutes * 60_000).toISOString();
}

export function rollbackExpiresAt(from = new Date()) {
  const { rollbackTtlHours } = getSafetyConfig();
  return new Date(from.getTime() + rollbackTtlHours * 3600_000).toISOString();
}
