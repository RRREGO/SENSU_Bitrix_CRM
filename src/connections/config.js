/**
 * Feature flags for AI connections, proxy, voice, email send.
 * Conflicts force safe mode (send off / dry-run on) and are reported.
 */

function boolEnv(name, fallback) {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(v));
}

function envSet(name) {
  const v = process.env[name];
  return v != null && String(v).trim() !== "";
}

/**
 * @returns {{
 *   customProxyEnabled: boolean,
 *   promptProfilesEnabled: boolean,
 *   userAiProvidersEnabled: boolean,
 *   chatModelSelectionEnabled: boolean,
 *   voiceInputEnabled: boolean,
 *   voiceOutputEnabled: boolean,
 *   wazzupChatSendEnabled: boolean,
 *   emailSendEnabled: boolean,
 *   emailDryRun: boolean,
 *   flagsConflict: boolean,
 *   conflictReasons: string[]
 * }}
 */
export function getConnectionsFeatureFlags() {
  const conflictReasons = [];
  let emailSendEnabled = boolEnv("EMAIL_SEND_ENABLED", false);
  let emailDryRun = boolEnv("EMAIL_DRY_RUN", true);
  let flagsConflict = false;

  // Safe conflict: if EMAIL_SEND_ENABLED=true but EMAIL_DRY_RUN explicitly false
  // while COMMUNICATIONS_SEND_ENABLED is false — force dry-run.
  if (emailSendEnabled && envSet("COMMUNICATIONS_SEND_ENABLED")) {
    const commSend = boolEnv("COMMUNICATIONS_SEND_ENABLED", false);
    if (!commSend && !emailDryRun) {
      flagsConflict = true;
      emailDryRun = true;
      conflictReasons.push("EMAIL_SEND_ENABLED with COMMUNICATIONS_SEND_ENABLED=false forces EMAIL_DRY_RUN");
    }
  }

  if (emailSendEnabled && boolEnv("COMMUNICATIONS_DRY_RUN", true) && !envSet("EMAIL_DRY_RUN")) {
    emailDryRun = true;
  }

  return {
    // User/UI proxy profiles disabled; proxy is configured only via LLM_PROXY_* / ANTHROPIC_PROXY.
    customProxyEnabled: boolEnv("CUSTOM_PROXY_ENABLED", false),
    promptProfilesEnabled: boolEnv("PROMPT_PROFILES_ENABLED", true),
    userAiProvidersEnabled: boolEnv("USER_AI_PROVIDERS_ENABLED", true),
    chatModelSelectionEnabled: boolEnv("CHAT_MODEL_SELECTION_ENABLED", true),
    voiceInputEnabled: boolEnv("VOICE_INPUT_ENABLED", true),
    voiceOutputEnabled: boolEnv("VOICE_OUTPUT_ENABLED", false),
    wazzupChatSendEnabled: boolEnv("WAZZUP_CHAT_SEND_ENABLED", true),
    emailSendEnabled,
    emailDryRun,
    flagsConflict,
    conflictReasons,
  };
}

export function getSecretsMasterKey() {
  return process.env.SECRETS_MASTER_KEY || process.env.APP_SECRETS_MASTER_KEY || "";
}

export function requireFeature(flagName) {
  const flags = getConnectionsFeatureFlags();
  if (!flags[flagName]) {
    const { ConnectionError, CONNECTION_ERROR_CODES } = requireFeature._errs || {};
    // lazy import avoided — callers check flags
    return false;
  }
  return true;
}
