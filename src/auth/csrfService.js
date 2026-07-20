/**
 * CSRF — сравнение hash токена с записью сессии.
 */

import { AuthError } from "./config.js";
import { verifyCsrf } from "./sessionService.js";

export function assertCsrf(req, sessionRow) {
  const token = req.get("x-csrf-token") || req.body?.csrfToken || null;
  if (!verifyCsrf(sessionRow, token)) {
    throw new AuthError(
      "CSRF_VALIDATION_FAILED",
      "Запрос отклонён системой защиты сессии."
    );
  }
}

export function isStateChanging(method) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(String(method || "").toUpperCase());
}
