/**
 * Конфигурация Client Context / Meeting Workflow.
 */

function intEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function getClientContextConfig() {
  return {
    maxChars: intEnv("CLIENT_CONTEXT_MAX_CHARS", 100000),
    timelineMaxEvents: intEnv("CLIENT_TIMELINE_MAX_EVENTS", 150),
    transcriptMaxChars: intEnv("MEETING_TRANSCRIPT_MAX_CHARS", 200000),
    cacheTtlSeconds: intEnv("CLIENT_CONTEXT_CACHE_TTL_SECONDS", 60),
    defaultActivityLimit: intEnv("CLIENT_CONTEXT_ACTIVITIES_LIMIT", 100),
    defaultTaskLimit: intEnv("CLIENT_CONTEXT_TASKS_LIMIT", 50),
    defaultTimelineLimit: intEnv("CLIENT_CONTEXT_TIMELINE_LIMIT", 100),
  };
}

export class ClientContextError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "ClientContextError";
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
