/**
 * Уведомления по результатам плановых отчётов с fan-out recipients.
 */

import {
  createNotification,
  listNotificationsForUser,
  listNotifications as listNotificationsRaw,
  getUnreadCountForUser,
  getUnreadCount as getUnreadCountRaw,
  markNotificationReadForUser,
  markNotificationRead as markNotificationReadLegacy,
  markAllNotificationsReadForUser,
  markAllNotificationsRead as markAllNotificationsReadLegacy,
  getNotificationById,
  listActiveUserIdsByRoles,
  listActiveUserIdsWithPermission,
  findUserIdByBitrixUserId,
  backfillNotificationRecipients,
} from "../database/repositories/notificationsRepository.js";
import { getDatabase } from "../database/index.js";

export {
  getNotificationById,
  backfillNotificationRecipients,
};

export function listNotifications(opts = {}) {
  if (opts.userId) return listNotificationsForUser(opts.userId, opts);
  // system/admin tooling & unit tests without session
  return listNotificationsRaw(opts);
}

export function getUnreadCount(userId) {
  if (userId) return getUnreadCountForUser(userId);
  return getUnreadCountRaw();
}

export function markNotificationRead(id, userId) {
  if (userId) return markNotificationReadForUser(id, userId);
  return markNotificationReadLegacy(id);
}

export function markAllNotificationsRead(userId) {
  if (!userId) return markAllNotificationsReadLegacy();
  return markAllNotificationsReadForUser(userId);
}

function scheduleOwnerId(schedule) {
  return schedule?.createdByUserId || schedule?.created_by_user_id || null;
}

function resolveCompanyWideRecipients() {
  const ids = new Set([
    ...listActiveUserIdsByRoles(["administrator"]),
    ...listActiveUserIdsWithPermission("notifications.view").filter((id) => {
      const row = getDatabase()
        .prepare(
          `SELECT r.code FROM app_users u JOIN app_roles r ON r.id = u.role_id WHERE u.id = ?`
        )
        .get(id);
      return row && (row.code === "director" || row.code === "administrator");
    }),
  ]);
  return [...ids];
}

function resolveManagerAlertRecipients(bitrixUserId) {
  const ids = new Set([
    ...listActiveUserIdsByRoles(["administrator", "director"]),
  ]);
  const mapped = findUserIdByBitrixUserId(bitrixUserId);
  if (mapped) ids.add(mapped);
  return [...ids];
}

function resolveAudience(schedule, report) {
  const scopeType = schedule?.scopeType || schedule?.params?.scopeType || "company";
  if (scopeType === "personal" || scopeType === "own") {
    const owner = scheduleOwnerId(schedule);
    return owner ? [owner] : resolveCompanyWideRecipients();
  }
  const audience = schedule?.audience || schedule?.params?.audience;
  if (Array.isArray(audience?.userIds) && audience.userIds.length) {
    return audience.userIds;
  }
  // Manager-specific alert with responsible in report
  const managerId =
    report?.scope?.bitrixUserId ||
    report?.responsibleId ||
    schedule?.params?.responsibleId ||
    schedule?.scopeUserId;
  if (scopeType === "manager" || managerId) {
    return resolveManagerAlertRecipients(managerId);
  }
  return resolveCompanyWideRecipients();
}

export function notifyReportReady(run, schedule, report) {
  const critical = (report?.criticalAlerts || []).length;
  return createNotification({
    reportRunId: run.id,
    scheduleId: schedule.id,
    type: report?.partial ? "partial_report" : "report_ready",
    severity: critical > 0 ? "critical" : report?.partial ? "warning" : "info",
    title: report?.partial
      ? `Частичный отчёт: ${schedule.name}`
      : `Отчёт готов: ${schedule.name}`,
    message: critical
      ? `Сформирован отчёт. Критических алертов: ${critical}.`
      : `Сформирован отчёт «${schedule.name}».`,
    data: {
      reportType: schedule.reportType,
      runId: run.id,
      status: run.status,
      criticalCount: critical,
    },
    recipientUserIds: resolveAudience(schedule, report),
  });
}

export function notifyCriticalAlerts(run, schedule, alerts) {
  const list = (alerts || []).filter((a) => a.severity === "critical");
  if (!list.length) return null;
  return createNotification({
    reportRunId: run.id,
    scheduleId: schedule.id,
    type: "critical_alert",
    severity: "critical",
    title: `Критические нарушения: ${schedule.name}`,
    message: list
      .slice(0, 5)
      .map((a) => `${a.title || a.code}: ${a.count ?? "—"}`)
      .join("; "),
    data: { alerts: list.slice(0, 20), runId: run.id },
    recipientUserIds: resolveAudience(schedule, { criticalAlerts: list }),
  });
}

export function notifyScheduleFailed(run, schedule, error) {
  return createNotification({
    reportRunId: run?.id || null,
    scheduleId: schedule?.id || null,
    type: "schedule_failed",
    severity: "critical",
    title: `Ошибка расписания: ${schedule?.name || "отчёт"}`,
    message: error?.message || "Не удалось сформировать плановый отчёт.",
    data: { code: error?.code || "SCHEDULE_FAILED", runId: run?.id },
    recipientUserIds: listActiveUserIdsByRoles(["administrator"]),
  });
}

export function notifyWarning(run, schedule, warning) {
  return createNotification({
    reportRunId: run?.id || null,
    scheduleId: schedule?.id || null,
    type: "warning",
    severity: "warning",
    title: warning?.title || `Предупреждение: ${schedule?.name || "отчёт"}`,
    message: warning?.message || String(warning),
    data: warning,
    recipientUserIds: resolveAudience(schedule, {}),
  });
}

export function notifySystemFailure({ title, message, data = null }) {
  return createNotification({
    type: "system_failure",
    severity: "critical",
    title: title || "Системная ошибка",
    message: message || "Сбой приложения",
    data,
    recipientUserIds: listActiveUserIdsByRoles(["administrator"]),
  });
}

export function notifyCommunicationStatus({
  title,
  message,
  authorUserId,
  confirmerUserId,
  data = null,
}) {
  const ids = new Set();
  if (authorUserId) ids.add(authorUserId);
  if (confirmerUserId) ids.add(confirmerUserId);
  const elevated = listActiveUserIdsWithPermission("communications.view.all");
  for (const id of elevated) {
    const row = getDatabase()
      .prepare(
        `SELECT r.code FROM app_users u JOIN app_roles r ON r.id = u.role_id WHERE u.id = ?`
      )
      .get(id);
    if (row && (row.code === "director" || row.code === "administrator")) {
      ids.add(id);
    }
  }
  return createNotification({
    type: "communication_status",
    severity: "info",
    title,
    message,
    data,
    recipientUserIds: [...ids],
  });
}
