import express from "express";
import {
  listSchedules,
  getScheduleById,
  createSchedule,
  updateSchedule,
  setScheduleEnabled,
} from "../database/repositories/schedulesRepository.js";
import {
  listRunsForSchedule,
  getRunById,
} from "../database/repositories/reportRunsRepository.js";
import {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  getNotificationById,
} from "./notificationService.js";
import { executeScheduleRun, retryFailedRun } from "./reportRunner.js";
import { listScheduledReportTypes, assertKnownReportType } from "./reportRegistry.js";
import { describeSchedule, validateCronExpression } from "./scheduleCalculator.js";
import { getSchedulerConfig, SchedulerError } from "./config.js";
import { getSchedulerHealth } from "./schedulerService.js";
import { hasPermission } from "../auth/authorizationService.js";

function sendError(res, error) {
  if (error instanceof SchedulerError) {
    return res.status(400).json(error.toJSON());
  }
  return res.status(500).json({
    success: false,
    error: { code: "SCHEDULER_ERROR", message: error.message },
  });
}

export function createSchedulerRouter() {
  const router = express.Router();

  router.get("/scheduled-report-types", (_req, res) => {
    res.json({ success: true, types: listScheduledReportTypes() });
  });

  router.get("/scheduled-reports", (req, res) => {
    let schedules = listSchedules();
    const user = req.user;
    if (user && !user.isLocalOnlySynthetic && !hasPermission(user, "schedules.manage")) {
      schedules = schedules.filter(
        (s) =>
          s.createdByUserId === user.userId ||
          s.scopeUserId === user.userId ||
          (s.scopeType === "personal" && s.scopeUserId === user.userId)
      );
    }
    res.json({ success: true, schedules, health: getSchedulerHealth().scheduler });
  });

  router.post("/scheduled-reports", (req, res) => {
    try {
      const body = req.body || {};
      assertKnownReportType(body.reportType);
      if (body.scheduleType === "cron") {
        validateCronExpression(body.cronExpression, getSchedulerConfig().minIntervalMinutes);
      }
      const user = req.user;
      const canCompanyWide =
        user &&
        (hasPermission(user, "schedules.manage") ||
          user.role === "administrator" ||
          user.role === "director");
      let scopeType = body.scopeType || "company";
      let scopeUserId = body.scopeUserId || null;
      if (user && !user.isLocalOnlySynthetic && !canCompanyWide) {
        scopeType = "personal";
        scopeUserId = user.userId;
        if (body.scopeType === "company" || body.scopeType === "all") {
          throw new SchedulerError(
            "SCHEDULE_SCOPE_DENIED",
            "Менеджер может создавать только personal schedule."
          );
        }
      }
      const schedule = createSchedule({
        ...body,
        createdByUserId: user?.userId || null,
        updatedByUserId: user?.userId || null,
        scopeType,
        scopeUserId,
        audience: body.audience || (scopeType === "personal" ? { userIds: [scopeUserId] } : null),
      });
      res.json({ success: true, schedule, description: describeSchedule(schedule) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/scheduled-reports/:id", (req, res) => {
    const schedule = getScheduleById(req.params.id);
    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: { code: "SCHEDULE_NOT_FOUND", message: "Расписание не найдено." },
      });
    }
    res.json({ success: true, schedule });
  });

  router.patch("/scheduled-reports/:id", (req, res) => {
    try {
      const schedule = updateSchedule(req.params.id, req.body || {});
      if (!schedule) {
        return res.status(404).json({
          success: false,
          error: { code: "SCHEDULE_NOT_FOUND", message: "Расписание не найдено." },
        });
      }
      res.json({ success: true, schedule });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/scheduled-reports/:id/enable", (req, res) => {
    const schedule = setScheduleEnabled(req.params.id, true);
    if (!schedule) {
      return res.status(404).json({ success: false, error: { code: "SCHEDULE_NOT_FOUND" } });
    }
    res.json({ success: true, schedule });
  });

  router.post("/scheduled-reports/:id/disable", (req, res) => {
    const schedule = setScheduleEnabled(req.params.id, false);
    if (!schedule) {
      return res.status(404).json({ success: false, error: { code: "SCHEDULE_NOT_FOUND" } });
    }
    res.json({ success: true, schedule });
  });

  router.post("/scheduled-reports/:id/run-now", async (req, res) => {
    try {
      const result = await executeScheduleRun(req.params.id, {
        scheduledFor: new Date().toISOString(),
        force: true,
      });
      res.json({ success: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/scheduled-reports/:id/runs", (req, res) => {
    res.json({
      success: true,
      runs: listRunsForSchedule(req.params.id, { limit: req.query.limit }),
    });
  });

  router.get("/scheduled-report-runs/:id", (req, res) => {
    const run = getRunById(req.params.id);
    if (!run) {
      return res.status(404).json({
        success: false,
        error: { code: "RUN_NOT_FOUND", message: "Запуск не найден." },
      });
    }
    res.json({ success: true, run });
  });

  router.post("/scheduled-report-runs/:id/retry", async (req, res) => {
    try {
      const result = await retryFailedRun(req.params.id);
      res.json({ success: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/notifications", (req, res) => {
    const userId = req.user?.userId;
    if (!userId || req.user?.isLocalOnlySynthetic) {
      return res.json({ success: true, notifications: [], unread: { unread: 0, unreadCritical: 0 } });
    }
    const isRead =
      req.query.isRead === "true" ? true : req.query.isRead === "false" ? false : undefined;
    // Ignore any client-supplied userId
    res.json({
      success: true,
      notifications: listNotifications({
        userId,
        severity: req.query.severity,
        isRead,
        type: req.query.type,
        scheduleId: req.query.scheduleId,
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
        limit: req.query.limit,
      }),
      unread: getUnreadCount(userId),
    });
  });

  router.get("/notifications/unread-count", (req, res) => {
    const userId = req.user?.userId;
    if (!userId || req.user?.isLocalOnlySynthetic) {
      return res.json({ success: true, unread: 0, unreadCritical: 0 });
    }
    res.json({ success: true, ...getUnreadCount(userId) });
  });

  router.post("/notifications/:id/read", (req, res) => {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: { code: "AUTHENTICATION_REQUIRED" } });
    }
    const n = markNotificationRead(req.params.id, userId);
    if (!n) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND" } });
    }
    res.json({ success: true, notification: n });
  });

  router.post("/notifications/read-all", (req, res) => {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: { code: "AUTHENTICATION_REQUIRED" } });
    }
    res.json({ success: true, ...markAllNotificationsRead(userId) });
  });

  router.get("/notifications/:id", (req, res) => {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: { code: "AUTHENTICATION_REQUIRED" } });
    }
    const n = getNotificationById(req.params.id, userId);
    if (!n) return res.status(404).json({ success: false, error: { code: "NOT_FOUND" } });
    res.json({ success: true, notification: n });
  });

  return router;
}
