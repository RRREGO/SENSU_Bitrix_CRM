/**

 * Operational modes and kill switches.

 */



import { getCommunicationsConfig } from "../communications/config.js";



function boolEnv(name, fallback = false) {

  const v = process.env[name];

  if (v == null || v === "") return fallback;

  return /^(1|true|yes|on)$/i.test(String(v));

}



/** Runtime overrides (admin API) — do not persist secrets */

const runtime = {

  maintenanceMode: null,

  readOnlyMode: null,

  bitrixWriteEnabled: null,

  schedulerEnabled: null,

  llmEnabled: null,

  communicationSendEnabled: null,

  reason: null,

  updatedAt: null,

  updatedBy: null,

};



export function getOperationalModes() {

  // Same resolved sendEnabled as Communications Hub (canonical + deprecated alias + conflict → false)

  let resolvedSend = false;

  try {

    resolvedSend = Boolean(getCommunicationsConfig().sendEnabled);

  } catch {

    resolvedSend = boolEnv("COMMUNICATIONS_SEND_ENABLED", false);

  }



  return {

    maintenanceMode:

      runtime.maintenanceMode != null ? runtime.maintenanceMode : boolEnv("APP_MAINTENANCE_MODE", false),

    readOnlyMode: runtime.readOnlyMode != null ? runtime.readOnlyMode : boolEnv("APP_READ_ONLY_MODE", false),

    bitrixWriteEnabled:

      runtime.bitrixWriteEnabled != null

        ? runtime.bitrixWriteEnabled

        : boolEnv("BITRIX_WRITE_ENABLED", true),

    schedulerEnabled:

      runtime.schedulerEnabled != null

        ? runtime.schedulerEnabled

        : boolEnv("SCHEDULER_ENABLED", true),

    llmEnabled: runtime.llmEnabled != null ? runtime.llmEnabled : boolEnv("LLM_ENABLED", true),

    communicationSendEnabled:

      runtime.communicationSendEnabled != null

        ? runtime.communicationSendEnabled

        : resolvedSend,

    reason: runtime.reason,

    updatedAt: runtime.updatedAt,

    updatedBy: runtime.updatedBy,

  };

}



export function setRuntimeMode(patch = {}, { userId = null, reason = null } = {}) {

  if (patch.maintenanceMode != null) runtime.maintenanceMode = Boolean(patch.maintenanceMode);

  if (patch.readOnlyMode != null) runtime.readOnlyMode = Boolean(patch.readOnlyMode);

  if (patch.bitrixWriteEnabled != null) runtime.bitrixWriteEnabled = Boolean(patch.bitrixWriteEnabled);

  if (patch.schedulerEnabled != null) runtime.schedulerEnabled = Boolean(patch.schedulerEnabled);

  if (patch.llmEnabled != null) runtime.llmEnabled = Boolean(patch.llmEnabled);

  if (patch.communicationSendEnabled != null) {

    runtime.communicationSendEnabled = Boolean(patch.communicationSendEnabled);

  }

  runtime.reason = reason || null;

  runtime.updatedAt = new Date().toISOString();

  runtime.updatedBy = userId;

  return getOperationalModes();

}



export function assertWritesAllowed(context = "write") {

  const modes = getOperationalModes();

  if (modes.maintenanceMode) {

    const err = new Error("Приложение в режиме обслуживания. Запись запрещена.");

    err.code = "MAINTENANCE_MODE";

    throw err;

  }

  if (modes.readOnlyMode) {

    const err = new Error("Приложение в режиме только чтения. Запись запрещена.");

    err.code = "READ_ONLY_MODE";

    throw err;

  }

  if (!modes.bitrixWriteEnabled && context === "bitrix_write") {

    const err = new Error("Запись в Bitrix24 отключена (BITRIX_WRITE_ENABLED=false).");

    err.code = "BITRIX_WRITE_DISABLED";

    throw err;

  }

  if (!modes.communicationSendEnabled && context === "communication_send") {

    const err = new Error("Отправка сообщений отключена.");

    err.code = "COMMUNICATION_SEND_DISABLED";

    throw err;

  }

  return true;

}



export function assertLlmAllowed() {

  if (!getOperationalModes().llmEnabled) {

    const err = new Error("LLM отключён (LLM_ENABLED=false). Числовая аналитика доступна.");

    err.code = "LLM_DISABLED";

    throw err;

  }

}


