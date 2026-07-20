/**
 * Request correlation + HTTP metrics middleware.
 */

import crypto from "crypto";
import { getAuthConfig } from "../auth/config.js";
import { recordHttpRequest, incHttpActive } from "./metricsService.js";
import { logger } from "./logger.js";

export function createRequestId() {
  return crypto.randomUUID();
}

export function requestContextMiddleware(req, res, next) {
  const cfg = getAuthConfig();
  const incoming = req.get("x-request-id");
  const trustIncoming = Boolean(cfg.trustProxy && cfg.trustedProxyCidrs?.length && incoming);
  req.requestId = trustIncoming ? String(incoming).slice(0, 64) : createRequestId();
  res.setHeader("X-Request-Id", req.requestId);

  const started = Date.now();
  incHttpActive(1);

  res.on("finish", () => {
    incHttpActive(-1);
    const durationMs = Date.now() - started;
    recordHttpRequest({ status: res.statusCode, durationMs });
    if (res.statusCode >= 500) {
      logger.error("http.request.failed", {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs,
        userId: req.user?.userId || null,
      });
    } else if (process.env.LOG_HTTP_ACCESS === "true") {
      logger.info("http.request.completed", {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs,
      });
    }
  });

  next();
}

export function maintenanceMiddleware(req, res, next) {
  // Imported lazily to avoid cycles
  import("./operationalModes.js").then(({ getOperationalModes }) => {
    const modes = getOperationalModes();
    if (!modes.maintenanceMode) return next();
    if (req.path === "/health" || req.path === "/health/readiness") return next();
    if (req.path.startsWith("/auth/login") || req.path.startsWith("/auth/me") || req.path.startsWith("/auth/csrf")) {
      return next();
    }
    if (req.user?.role === "administrator" || req.user?.permissions?.has?.("settings.manage")) {
      return next();
    }
    if (req.method === "GET" && (req.path === "/" || /\.(js|css|html|svg|png|ico)$/.test(req.path))) {
      return next();
    }
    return res.status(503).json({
      success: false,
      error: {
        code: "MAINTENANCE_MODE",
        message: "Приложение на обслуживании. Повторите позже.",
        requestId: req.requestId,
      },
    });
  }).catch(next);
}
