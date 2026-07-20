/**
 * Admin / operational routes: errors, metrics, modes, status.
 */

import express from "express";
import {
  listApplicationErrors,
  getApplicationErrorById,
  resolveApplicationError,
} from "../database/repositories/applicationErrorsRepository.js";
import { getMetricsSnapshot } from "./metricsService.js";
import { getOperationalModes, setRuntimeMode } from "./operationalModes.js";
import { getReleaseMetadata } from "../config/paths.js";
import { getDiskSnapshot, evaluateDiskThresholds } from "./diskMonitor.js";
import { getGoLiveReadiness } from "../config/productionValidator.js";
import { getLastBitrixReadStatus } from "../bitrixClient.js";
import { getLlmTransportConfig } from "../llm/transport.js";
import { getSchedulerHealth } from "../scheduler/schedulerService.js";
import { getAuthConfig } from "../auth/config.js";
import { recordAuthEvent } from "../auth/authorizationService.js";
import {
  requireAuthentication,
  requirePermissionMiddleware,
} from "../auth/middleware.js";
import {
  getEmergencyStopState,
  setEmergencyStop,
} from "../communications/certification/certificationService.js";
import { CommunicationError } from "../communications/config.js";

export function createObservabilityRouter() {
  const router = express.Router();
  const auth = requireAuthentication();
  const canView = [
    auth,
    requirePermissionMiddleware("settings.view"),
    requirePermissionMiddleware("audit.view"),
  ];
  const canManage = [auth, requirePermissionMiddleware("settings.manage")];

  router.get("/admin/system/status", ...canView, (_req, res) => {
    const modes = getOperationalModes();
    const metrics = getMetricsSnapshot();
    const llmCfg = getLlmTransportConfig();
    res.json({
      success: true,
      release: getReleaseMetadata(),
      modes,
      bitrix: { lastReadStatus: getLastBitrixReadStatus() },
      llm: {
        configured: llmCfg.configured,
        proxyMode: llmCfg.mode,
        enabled: modes.llmEnabled,
      },
      database: metrics.database,
      scheduler: getSchedulerHealth().scheduler,
      safety: metrics.safety,
      communications: {
        sendEnabled: modes.communicationSendEnabled && getAuthConfig().communicationSendEnabled,
        drafts: metrics.communications.drafts,
        sent: metrics.communications.sent,
        verificationRequired: metrics.communications.verificationRequired,
        failed: metrics.communications.failed,
      },
      readiness: getGoLiveReadiness(),
      disk: getDiskSnapshot(),
      uptimeSeconds: metrics.uptimeSeconds,
    });
  });

  router.get("/admin/system/metrics", ...canView, (_req, res) => {
    res.json({ success: true, metrics: getMetricsSnapshot() });
  });

  router.get("/admin/errors", ...canView, (req, res) => {
    res.json({
      success: true,
      errors: listApplicationErrors({
        source: req.query.source,
        severity: req.query.severity,
        unresolvedOnly: req.query.unresolved === "true",
        limit: req.query.limit,
      }),
    });
  });

  router.get("/admin/errors/:id", ...canView, (req, res) => {
    const error = getApplicationErrorById(req.params.id);
    if (!error) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Ошибка не найдена.", requestId: req.requestId },
      });
    }
    res.json({ success: true, error });
  });

  router.post("/admin/errors/:id/resolve", ...canManage, (req, res) => {
    const error = resolveApplicationError(req.params.id, {
      note: req.body?.note,
      userId: req.user?.userId,
    });
    if (!error) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND" } });
    }
    recordAuthEvent({
      userId: req.user?.userId,
      eventType: "error_resolved",
      result: "success",
      details: { errorId: error.id },
    });
    res.json({ success: true, error });
  });

  router.post("/admin/system/read-only/enable", ...canManage, (req, res) => {
    const modes = setRuntimeMode(
      { readOnlyMode: true },
      { userId: req.user?.userId, reason: req.body?.reason || "manual" }
    );
    recordAuthEvent({
      userId: req.user?.userId,
      eventType: "read_only_enabled",
      result: "success",
      details: { reason: req.body?.reason || "manual" },
    });
    res.json({ success: true, modes });
  });

  router.post("/admin/system/read-only/disable", ...canManage, (req, res) => {
    const modes = setRuntimeMode(
      { readOnlyMode: false },
      { userId: req.user?.userId, reason: req.body?.reason || "manual" }
    );
    recordAuthEvent({
      userId: req.user?.userId,
      eventType: "read_only_disabled",
      result: "success",
      details: { reason: req.body?.reason || "manual" },
    });
    res.json({ success: true, modes });
  });

  router.post("/admin/system/maintenance/enable", ...canManage, (req, res) => {
    const modes = setRuntimeMode(
      { maintenanceMode: true },
      { userId: req.user?.userId, reason: req.body?.reason || "manual" }
    );
    recordAuthEvent({
      userId: req.user?.userId,
      eventType: "maintenance_enabled",
      result: "success",
    });
    res.json({ success: true, modes });
  });

  router.post("/admin/system/maintenance/disable", ...canManage, (req, res) => {
    const modes = setRuntimeMode(
      { maintenanceMode: false },
      { userId: req.user?.userId, reason: req.body?.reason || "manual" }
    );
    recordAuthEvent({
      userId: req.user?.userId,
      eventType: "maintenance_disabled",
      result: "success",
    });
    res.json({ success: true, modes });
  });

  router.get("/admin/system/disk", ...canView, (_req, res) => {
    res.json({ success: true, ...evaluateDiskThresholds() });
  });

  router.post("/admin/communications/emergency-stop", ...canManage, (req, res) => {
    try {
      if (req.user?.role !== "administrator") {
        return res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "Только administrator." },
        });
      }
      const state = setEmergencyStop({
        active: true,
        reason: req.body?.reason || "manual emergency stop",
        userId: req.user?.userId,
        confirmationPhrase: req.body?.confirmationPhrase || req.body?.phrase,
      });
      recordAuthEvent({
        userId: req.user?.userId,
        eventType: "communications_emergency_stop",
        result: "success",
        details: { reason: state.reason },
      });
      res.json({ success: true, emergencyStop: state });
    } catch (error) {
      const status = error instanceof CommunicationError ? 400 : 500;
      res.status(status).json(
        error instanceof CommunicationError
          ? error.toJSON()
          : { success: false, error: { code: "INTERNAL", message: error.message } }
      );
    }
  });

  router.post("/admin/communications/emergency-resume", ...canManage, (req, res) => {
    try {
      if (req.user?.role !== "administrator") {
        return res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "Только administrator." },
        });
      }
      const state = setEmergencyStop({
        active: false,
        reason: req.body?.reason || "manual resume",
        userId: req.user?.userId,
        confirmationPhrase: req.body?.confirmationPhrase || req.body?.phrase,
      });
      recordAuthEvent({
        userId: req.user?.userId,
        eventType: "communications_emergency_resume",
        result: "success",
        details: { reason: state.reason },
      });
      res.json({ success: true, emergencyStop: state });
    } catch (error) {
      const status = error instanceof CommunicationError ? 400 : 500;
      res.status(status).json(
        error instanceof CommunicationError
          ? error.toJSON()
          : { success: false, error: { code: "INTERNAL", message: error.message } }
      );
    }
  });

  return router;
}
