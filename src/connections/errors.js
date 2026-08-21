/**
 * Unified external-connection error codes (safe for clients).
 */

export const CONNECTION_ERROR_CODES = Object.freeze({
  AUTHENTICATION_FAILED: "AUTHENTICATION_FAILED",
  CONNECTION_FAILED: "CONNECTION_FAILED",
  TIMEOUT: "TIMEOUT",
  RATE_LIMITED: "RATE_LIMITED",
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
  MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
  UNSUPPORTED_CAPABILITY: "UNSUPPORTED_CAPABILITY",
  INVALID_CONFIGURATION: "INVALID_CONFIGURATION",
  PROXY_CONNECTION_FAILED: "PROXY_CONNECTION_FAILED",
  PROVIDER_CONTRACT_CHANGED: "PROVIDER_CONTRACT_CHANGED",
  EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",
});

function defaultHttpStatus(code) {
  switch (code) {
    case CONNECTION_ERROR_CODES.AUTHENTICATION_FAILED:
      return 401;
    case CONNECTION_ERROR_CODES.RATE_LIMITED:
      return 429;
    case CONNECTION_ERROR_CODES.TIMEOUT:
      return 504;
    case CONNECTION_ERROR_CODES.MODEL_NOT_FOUND:
    case CONNECTION_ERROR_CODES.MODEL_UNAVAILABLE:
    case CONNECTION_ERROR_CODES.INVALID_CONFIGURATION:
    case CONNECTION_ERROR_CODES.UNSUPPORTED_CAPABILITY:
      return 400;
    default:
      return 502;
  }
}

export class ConnectionError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "ConnectionError";
    this.code = code || CONNECTION_ERROR_CODES.EXTERNAL_SERVICE_ERROR;
    this.details = details;
    const fromDetails = Number(details?.httpStatus);
    this.httpStatus =
      fromDetails >= 400 && fromDetails < 600 ? fromDetails : defaultHttpStatus(this.code);
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && typeof this.details === "object"
          ? { details: sanitizeDetails(this.details) }
          : {}),
      },
    };
  }
}

function sanitizeDetails(details) {
  const out = {};
  for (const [k, v] of Object.entries(details)) {
    if (/password|secret|token|authorization|api[_-]?key|cookie/i.test(k)) continue;
    if (typeof v === "string" && v.length > 500) out[k] = `${v.slice(0, 500)}…`;
    else out[k] = v;
  }
  return out;
}

export function mapHttpStatusToConnectionCode(status) {
  if (status === 401 || status === 403) return CONNECTION_ERROR_CODES.AUTHENTICATION_FAILED;
  if (status === 404) return CONNECTION_ERROR_CODES.MODEL_NOT_FOUND;
  if (status === 408 || status === 504) return CONNECTION_ERROR_CODES.TIMEOUT;
  if (status === 429) return CONNECTION_ERROR_CODES.RATE_LIMITED;
  if (status >= 500) return CONNECTION_ERROR_CODES.EXTERNAL_SERVICE_ERROR;
  return CONNECTION_ERROR_CODES.CONNECTION_FAILED;
}

export function mapNetworkErrorToConnectionCode(error) {
  const cause = error?.cause || {};
  const msg = String(error?.message || error || "").toLowerCase();
  const causeMsg = String(cause.message || "").toLowerCase();
  const code = String(error?.code || cause.code || "").toLowerCase();
  const blob = `${msg} ${causeMsg} ${code}`;
  if (code === "aborterror" || /aborted|timeout|etimedout/.test(blob) || code.includes("timeout")) {
    return CONNECTION_ERROR_CODES.TIMEOUT;
  }
  if (/407|proxy authentication|proxy|socks|cancelled/.test(blob) || code.includes("proxy") || code.includes("socks")) {
    return CONNECTION_ERROR_CODES.PROXY_CONNECTION_FAILED;
  }
  if (/enotfound|econnrefused|econnreset|network/.test(blob)) {
    return CONNECTION_ERROR_CODES.CONNECTION_FAILED;
  }
  return CONNECTION_ERROR_CODES.EXTERNAL_SERVICE_ERROR;
}
