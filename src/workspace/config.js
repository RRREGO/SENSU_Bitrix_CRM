function intEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

export function getWorkspaceConfig() {
  return {
    recentMessagesLimit: intEnv("CHAT_RECENT_MESSAGES_LIMIT", 30),
    contextMaxChars: intEnv("CHAT_CONTEXT_MAX_CHARS", 120000),
    projectContextMaxChars: intEnv("PROJECT_CONTEXT_MAX_CHARS", 80000),
    projectFileMaxBytes: intEnv("PROJECT_FILE_MAX_BYTES", 2_097_152),
    projectFilesMaxCount: intEnv("PROJECT_FILES_MAX_COUNT", 50),
    autoSummaryEnabled: boolEnv("CHAT_AUTO_SUMMARY_ENABLED", true),
    autoSummaryThreshold: intEnv("CHAT_AUTO_SUMMARY_THRESHOLD_MESSAGES", 40),
  };
}

export class WorkspaceError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}
